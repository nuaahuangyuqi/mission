const ROOT_LABEL = '总体能力';
export const WEIGHT_TOLERANCE = 0.0001;
export const CAPABILITY_LEGACY_DEFAULT_UNIT = '分';
export const CAPABILITY_COMMON_UNITS = [
  '%',
  '分',
  '秒',
  '分钟',
  '小时',
  '次',
  '个',
  '架',
  '枚',
  '套',
  '人',
  '公里',
  '米',
  '吨',
  '批次',
];

export function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toFiniteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(toFiniteNumber(value, min), min), max);
}

export function nowIso() {
  return new Date().toISOString();
}

export function formatTimestamp(value) {
  const source = value ? new Date(value) : new Date();
  if (Number.isNaN(source.getTime())) {
    return nowIso().slice(0, 16).replace('T', ' ');
  }
  return source.toISOString().slice(0, 16).replace('T', ' ');
}

export function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-6)}`;
}

export function normalizeIndicatorUnit(value) {
  return String(value ?? '').trim();
}

export function roundWeight(value) {
  return Number(toFiniteNumber(value, 0).toFixed(4));
}

export function normalizeWeightInput(value) {
  const next = toFiniteNumber(value, 0);
  if (next > 1 && next <= 100) {
    return roundWeight(next / 100);
  }
  return roundWeight(Math.max(next, 0));
}

export function formatWeight(value, digits = 4) {
  return Number(toFiniteNumber(value, 0)).toFixed(digits);
}

export function formatScore(value, digits = 1) {
  return Number(toFiniteNumber(value, 0)).toFixed(digits);
}

export function visitNodes(nodes, visitor, parents = []) {
  for (const node of safeArray(nodes)) {
    visitor(node, parents);
    visitNodes(node.children, visitor, [...parents, node]);
  }
}

export function findNodeById(nodes, nodeId) {
  for (const node of safeArray(nodes)) {
    if (node.id === nodeId) {
      return node;
    }

    const child = findNodeById(node.children, nodeId);
    if (child) {
      return child;
    }
  }

  return null;
}

export function findNodeContext(nodes, nodeId, parent = null, parents = []) {
  for (const node of safeArray(nodes)) {
    if (node.id === nodeId) {
      return { node, parent, parents };
    }

    const child = findNodeContext(node.children, nodeId, node, [...parents, node]);
    if (child) {
      return child;
    }
  }

  return null;
}

export function collectLeafIds(nodes) {
  const leafIds = [];
  visitNodes(nodes, (node) => {
    if (!safeArray(node.children).length) {
      leafIds.push(node.id);
    }
  });
  return leafIds;
}

export function summarizeIndicatorTree(nodes) {
  return safeArray(nodes).reduce((summary, core) => {
    const secondaryCount = safeArray(core.children).length;
    const tertiaryCount = safeArray(core.children).reduce(
      (total, secondary) => total + safeArray(secondary.children).length,
      0,
    );

    return {
      coreCount: summary.coreCount + 1,
      secondaryCount: summary.secondaryCount + secondaryCount,
      tertiaryCount: summary.tertiaryCount + tertiaryCount,
    };
  }, {
    coreCount: 0,
    secondaryCount: 0,
    tertiaryCount: 0,
  });
}

export function syncCodes(nodes, prefix = 'C') {
  safeArray(nodes).forEach((node, index) => {
    node.code = prefix === 'C' ? `C${index + 1}` : `${prefix}-${index + 1}`;
    if (safeArray(node.children).length) {
      syncCodes(node.children, node.code);
    }
  });
}

function applyNormalizedWeights(nodes, weights) {
  const list = safeArray(nodes);
  if (!list.length) {
    return;
  }

  const rounded = weights.map((item) => roundWeight(item));
  const total = rounded.reduce((sum, item) => sum + item, 0);
  const diff = roundWeight(1 - total);
  rounded[rounded.length - 1] = roundWeight(Math.max(rounded[rounded.length - 1] + diff, 0));

  list.forEach((node, index) => {
    node.weight = rounded[index];
  });
}

export function normalizeSiblingWeightsEvenly(nodes) {
  const list = safeArray(nodes);
  if (!list.length) {
    return;
  }

  applyNormalizedWeights(list, list.map(() => 1 / list.length));
}

export function normalizeSiblingWeightsByCurrent(nodes) {
  const list = safeArray(nodes);
  if (!list.length) {
    return;
  }

  const current = list.map((node) => Math.max(normalizeWeightInput(node.weight), 0));
  const total = current.reduce((sum, item) => sum + item, 0);

  if (total <= 0) {
    normalizeSiblingWeightsEvenly(list);
    return;
  }

  applyNormalizedWeights(list, current.map((item) => item / total));
}

export function normalizeTreeWeightsByCurrent(nodes) {
  normalizeSiblingWeightsByCurrent(nodes);
  visitNodes(nodes, (node) => {
    if (safeArray(node.children).length) {
      normalizeSiblingWeightsByCurrent(node.children);
    }
  });
}

export function annotateTree(nodes, parentPath = [ROOT_LABEL], parentGlobalWeight = 1) {
  const list = safeArray(nodes);
  const weights = list.map((node) => Math.max(normalizeWeightInput(node.weight), 0));
  const total = weights.reduce((sum, item) => sum + item, 0) || list.length || 1;

  return list.map((node, index) => {
    const normalizedWeight = weights[index] / total;
    const currentPath = [...parentPath, node.name];
    return {
      ...node,
      weight: weights[index],
      normalizedWeight,
      globalWeight: parentGlobalWeight * normalizedWeight,
      path: currentPath,
      children: annotateTree(node.children, currentPath, parentGlobalWeight * normalizedWeight),
    };
  });
}

export function validateWeightGroups(nodes, parentPath = [ROOT_LABEL]) {
  const issues = [];
  const list = safeArray(nodes);

  if (list.length) {
    const sum = list.reduce((total, node) => total + normalizeWeightInput(node.weight), 0);
    if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
      issues.push({
        path: parentPath.join(' / '),
        sum: roundWeight(sum),
        ids: list.map((node) => node.id),
        names: list.map((node) => node.name),
      });
    }
  }

  for (const node of list) {
    if (safeArray(node.children).length) {
      issues.push(...validateWeightGroups(node.children, [...parentPath, node.name]));
    }
  }

  return issues;
}

function scoreDefaultMap(sourceSchemes = []) {
  return new Map(safeArray(sourceSchemes).map((scheme) => [scheme.id, scheme]));
}

export function syncSchemesToTree(schemes, indicatorTree, fallbackSchemes = []) {
  const leafIds = collectLeafIds(indicatorTree);
  const fallbackLookup = scoreDefaultMap(fallbackSchemes);
  const baseSchemes = safeArray(schemes).length ? safeArray(schemes) : safeArray(fallbackSchemes);

  return baseSchemes.map((scheme, index) => {
    const fallback = fallbackLookup.get(scheme.id) || fallbackSchemes[index] || fallbackSchemes[0] || {};
    const scores = {};

    for (const leafId of leafIds) {
      scores[leafId] = clamp(
        scheme?.scores?.[leafId] ?? fallback?.scores?.[leafId] ?? 70,
        0,
        100,
      );
    }

    return {
      id: scheme?.id || fallback.id || createId('scheme'),
      name: scheme?.name || fallback.name || `评估对象 ${index + 1}`,
      description: scheme?.description || fallback.description || '',
      scores,
    };
  });
}

function inferLabelByLevel(level, index) {
  if (level === 1) return `一级能力 ${index + 1}`;
  if (level === 2) return `二级能力 ${index + 1}`;
  return `三级指标 ${index + 1}`;
}

function sanitizeIndicatorNode(node, level, index) {
  const normalizedChildren = sanitizeIndicatorTree(node?.children, level + 1);
  const normalized = {
    id: String(node?.id || createId(level === 1 ? 'core' : level === 2 ? 'secondary' : 'tertiary')),
    code: String(node?.code || ''),
    name: String(node?.name || inferLabelByLevel(level, index)),
    description: String(node?.description || ''),
    weight: normalizeWeightInput(node?.weight || 0),
    children: level >= 3 ? [] : normalizedChildren,
  };

  if (level === 3) {
    normalized.unit = normalizeIndicatorUnit(node?.unit);
  }

  return normalized;
}

export function sanitizeIndicatorTree(nodes, level = 1) {
  return safeArray(nodes).map((node, index) => sanitizeIndicatorNode(node, level, index));
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildRowLookup(row) {
  const lookup = new Map();
  Object.entries(row || {}).forEach(([key, value]) => {
    lookup.set(normalizeKey(key), value);
  });
  return lookup;
}

function pickRowValue(row, keys) {
  const lookup = buildRowLookup(row);
  for (const key of keys) {
    if (lookup.has(normalizeKey(key))) {
      return lookup.get(normalizeKey(key));
    }
  }
  return '';
}

function weightFromCell(row, keys, fallback = 0) {
  const value = pickRowValue(row, keys);
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }
  return normalizeWeightInput(value);
}

function escapeDelimitedCell(value, delimiter) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!text.includes(delimiter) && !text.includes('"') && !text.includes('\n') && !text.includes('\r')) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeDelimited(rows, columns, delimiter = ',') {
  const header = columns.map((column) => escapeDelimitedCell(column, delimiter)).join(delimiter);
  const body = safeArray(rows).map((row) => columns
    .map((column) => escapeDelimitedCell(row?.[column] ?? '', delimiter))
    .join(delimiter));
  return [header, ...body].join('\n');
}

export function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(current);
      current = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((item) => String(item || '').trim());
  return dataRows
    .filter((dataRow) => dataRow.some((item) => String(item || '').trim() !== ''))
    .map((dataRow) => Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ''])));
}

function buildPathKey(parts) {
  return parts.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).join(' / ');
}

export function buildTreeTableRows(nodes) {
  const rows = [];
  safeArray(nodes).forEach((core) => {
    safeArray(core.children).forEach((secondary) => {
      safeArray(secondary.children).forEach((leaf) => {
        rows.push({
          coreId: core.id,
          coreCode: core.code,
          coreName: core.name,
          coreWeight: core.weight,
          coreDescription: core.description || '',
          secondaryId: secondary.id,
          secondaryCode: secondary.code,
          secondaryName: secondary.name,
          secondaryWeight: secondary.weight,
          secondaryDescription: secondary.description || '',
          leafId: leaf.id,
          leafCode: leaf.code,
          leafName: leaf.name,
          leafWeight: leaf.weight,
          leafUnit: leaf.unit || '',
          leafDescription: leaf.description || '',
        });
      });
    });
  });
  return rows;
}

function buildTreeFromRows(rows) {
  const coreMap = new Map();

  safeArray(rows).forEach((row) => {
    const coreName = String(pickRowValue(row, ['coreName', '一级能力', '一级指标', 'level1Name', 'core']) || '').trim();
    const secondaryName = String(pickRowValue(row, ['secondaryName', '二级能力', '二级指标', 'level2Name', 'secondary']) || '').trim();
    const leafName = String(pickRowValue(row, ['leafName', '三级指标', '三级能力', 'level3Name', 'leaf']) || '').trim();

    if (!coreName || !secondaryName || !leafName) {
      return;
    }

    const rawCoreId = String(pickRowValue(row, ['coreId', '一级能力ID', 'level1Id']) || '').trim();
    const rawSecondaryId = String(pickRowValue(row, ['secondaryId', '二级能力ID', 'level2Id']) || '').trim();
    const coreId = rawCoreId || createId('core');
    const secondaryId = rawSecondaryId || createId('secondary');
    const leafId = String(pickRowValue(row, ['leafId', '三级能力ID', '三级指标ID', 'level3Id']) || createId('tertiary'));
    const coreKey = rawCoreId || coreName;
    const secondaryKey = `${coreKey}:${rawSecondaryId || secondaryName}`;

    if (!coreMap.has(coreKey)) {
      coreMap.set(coreKey, {
        id: coreId,
        code: String(pickRowValue(row, ['coreCode', '一级编码', 'level1Code']) || ''),
        name: coreName,
        weight: weightFromCell(row, ['coreWeight', '一级权重', 'level1Weight'], 0),
        description: String(pickRowValue(row, ['coreDescription', '一级说明', 'level1Description']) || ''),
        childrenMap: new Map(),
      });
    }

    const core = coreMap.get(coreKey);
    if (!core.childrenMap.has(secondaryKey)) {
      core.childrenMap.set(secondaryKey, {
        id: secondaryId,
        code: String(pickRowValue(row, ['secondaryCode', '二级编码', 'level2Code']) || ''),
        name: secondaryName,
        weight: weightFromCell(row, ['secondaryWeight', '二级权重', 'level2Weight'], 0),
        description: String(pickRowValue(row, ['secondaryDescription', '二级说明', 'level2Description']) || ''),
        children: [],
      });
    }

    const secondary = core.childrenMap.get(secondaryKey);
    secondary.children.push({
      id: leafId,
      code: String(pickRowValue(row, ['leafCode', '三级编码', 'level3Code']) || ''),
      name: leafName,
      weight: weightFromCell(row, ['leafWeight', '三级权重', 'level3Weight'], 0),
      description: String(pickRowValue(row, ['leafDescription', '三级说明', 'level3Description', 'description']) || ''),
      unit: normalizeIndicatorUnit(pickRowValue(row, ['leafUnit', '单位', 'unit'])),
      children: [],
    });
  });

  const tree = Array.from(coreMap.values()).map((core) => ({
    id: core.id,
    code: core.code,
    name: core.name,
    weight: core.weight,
    description: core.description,
    children: Array.from(core.childrenMap.values()),
  }));

  if (!tree.length) {
    throw new Error('导入文件中未识别到有效的指标树数据');
  }

  const normalized = sanitizeIndicatorTree(tree);
  syncCodes(normalized);
  return normalized;
}

function parseTreeJson(text) {
  const parsed = JSON.parse(text);
  const tree = Array.isArray(parsed)
    ? parsed
    : parsed?.indicatorTree || parsed?.tree || parsed?.indicators || parsed?.payload?.indicatorTree;

  if (!Array.isArray(tree)) {
    throw new Error('JSON 文件中未找到指标树数据');
  }

  const normalized = sanitizeIndicatorTree(cloneData(tree));
  syncCodes(normalized);
  return normalized;
}

export function parseTreeImportContent(text, extension = 'json') {
  if (extension === 'json') {
    return parseTreeJson(text);
  }

  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    const delimiter = extension === 'tsv' ? '\t' : ',';
    const rows = parseDelimited(text, delimiter);
    return buildTreeFromRows(rows);
  }

  try {
    return parseTreeJson(text);
  } catch {
    const rows = parseDelimited(text, ',');
    return buildTreeFromRows(rows);
  }
}

export function buildInputDataRows(indicatorTree, schemes) {
  return buildTreeTableRows(indicatorTree).map((row) => {
    const nextRow = { ...row };
    safeArray(schemes).forEach((scheme) => {
      nextRow[`score:${scheme.id}`] = scheme?.scores?.[row.leafId] ?? 0;
    });
    return nextRow;
  });
}

export function buildInputDataColumns(schemes) {
  return [
    'coreId',
    'coreCode',
    'coreName',
    'coreWeight',
    'secondaryId',
    'secondaryCode',
    'secondaryName',
    'secondaryWeight',
    'leafId',
    'leafCode',
    'leafName',
    'leafWeight',
    'leafUnit',
    ...safeArray(schemes).map((scheme) => `score:${scheme.id}`),
  ];
}

function buildLeafLookups(indicatorTree) {
  const byId = new Map();
  const byPath = new Map();

  safeArray(indicatorTree).forEach((core) => {
    safeArray(core.children).forEach((secondary) => {
      safeArray(secondary.children).forEach((leaf) => {
        byId.set(leaf.id, { core, secondary, leaf });
        byPath.set(buildPathKey([core.name, secondary.name, leaf.name]), { core, secondary, leaf });
      });
    });
  });

  return { byId, byPath };
}

export function applyInputDataRows(indicatorTree, schemes, rows) {
  const { byId, byPath } = buildLeafLookups(indicatorTree);
  const schemeLookup = new Map(safeArray(schemes).map((scheme) => [scheme.id, scheme]));
  let matchedRows = 0;

  safeArray(rows).forEach((row) => {
    const leafId = String(pickRowValue(row, ['leafId', '三级能力ID', '三级指标ID', 'level3Id']) || '').trim();
    const coreName = pickRowValue(row, ['coreName', '一级能力', '一级指标', 'level1Name']);
    const secondaryName = pickRowValue(row, ['secondaryName', '二级能力', '二级指标', 'level2Name']);
    const leafName = pickRowValue(row, ['leafName', '三级指标', '三级能力', 'level3Name']);
    const context = byId.get(leafId) || byPath.get(buildPathKey([coreName, secondaryName, leafName]));

    if (!context) {
      return;
    }

    matchedRows += 1;
    context.core.weight = weightFromCell(row, ['coreWeight', '一级权重', 'level1Weight'], context.core.weight);
    context.secondary.weight = weightFromCell(row, ['secondaryWeight', '二级权重', 'level2Weight'], context.secondary.weight);
    context.leaf.weight = weightFromCell(row, ['leafWeight', '三级权重', 'level3Weight'], context.leaf.weight);
    context.leaf.unit = normalizeIndicatorUnit(
      pickRowValue(row, ['leafUnit', '单位', 'unit']) || context.leaf.unit,
    );

    Object.entries(row).forEach(([key, value]) => {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey.startsWith('score:')) {
        return;
      }

      const schemeId = normalizedKey.slice('score:'.length);
      const scheme = schemeLookup.get(schemeId);
      if (!scheme) {
        return;
      }

      scheme.scores[context.leaf.id] = clamp(value, 0, 100);
    });

    safeArray(schemes).forEach((scheme) => {
      const directValue = pickRowValue(row, [
        `score:${scheme.id}`,
        scheme.id,
        scheme.name,
      ]);

      if (directValue !== '') {
        scheme.scores[context.leaf.id] = clamp(directValue, 0, 100);
      }
    });
  });

  syncCodes(indicatorTree);
  return matchedRows;
}

export function buildResultsRows(results) {
  const rows = [];
  const methods = results?.methods || {};

  Object.entries(methods).forEach(([methodKey, method]) => {
    const rankingLookup = new Map(safeArray(method?.ranking).map((item) => [item.schemeId, item]));
    Object.values(method?.schemes || {}).forEach((scheme) => {
      const ranking = rankingLookup.get(scheme.id) || {};
      rows.push({
        methodKey,
        methodLabel: method?.label || methodKey.toUpperCase(),
        level: 'overall',
        schemeId: scheme.id,
        schemeName: scheme.name,
        rank: ranking.rank || '',
        overallScore: scheme.overallScore ?? '',
        score: scheme.overallScore ?? '',
        grade: scheme.grade || '',
        closeness: scheme.closeness ?? '',
      });

      safeArray(scheme.coreScores).forEach((core) => {
        rows.push({
          methodKey,
          methodLabel: method?.label || methodKey.toUpperCase(),
          level: 'core',
          schemeId: scheme.id,
          schemeName: scheme.name,
          coreId: core.id,
          coreName: core.name,
          rank: ranking.rank || '',
          overallScore: scheme.overallScore ?? '',
          score: core.score ?? '',
          grade: core.grade || '',
          closeness: core.closeness ?? scheme.closeness ?? '',
        });
      });
    });
  });

  return rows;
}

export function downloadTextFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

function sanitizeName(value, fallback) {
  return String(value || '').trim() || fallback;
}

export function createTreeVersion(indicatorTree, options = {}) {
  return {
    id: createId('tree-version'),
    name: sanitizeName(options.name, `V${options.index || 1}`),
    note: String(options.note || ''),
    createdAt: nowIso(),
    sourceTemplateId: options.sourceTemplateId || '',
    sourceTemplateName: options.sourceTemplateName || '',
    indicatorTree: cloneData(indicatorTree),
    summary: summarizeIndicatorTree(indicatorTree),
  };
}

export function createTemplateEntry(indicatorTree, options = {}) {
  return {
    id: options.id || createId('tree-template'),
    name: sanitizeName(options.name, '自定义指标树模板'),
    description: String(options.description || ''),
    source: options.source || 'custom',
    createdAt: options.createdAt || nowIso(),
    updatedAt: nowIso(),
    indicatorTree: cloneData(indicatorTree),
    summary: summarizeIndicatorTree(indicatorTree),
  };
}

export function createTaskFromTemplate(templateEntry, templatePayload, options = {}) {
  const methods = safeArray(templatePayload?.methods).map((item) => item.key);
  const engines = safeArray(templatePayload?.engines);
  const activeEngine = engines.find((item) => item.status === 'active')?.key || 'builtin';
  const tree = cloneData(options.startEmpty ? [] : (templateEntry.indicatorTree || templatePayload?.indicators || []));
  syncCodes(tree);
  const schemes = syncSchemesToTree(
    cloneData(templatePayload?.schemes || []),
    tree,
    cloneData(templatePayload?.schemes || []),
  );
  const firstVersion = createTreeVersion(tree, {
    index: 1,
    name: 'V1',
    note: `基于模板「${templateEntry.name}」创建`,
    sourceTemplateId: templateEntry.id,
    sourceTemplateName: templateEntry.name,
  });

  return {
    id: options.id || createId('capability-task'),
    name: sanitizeName(options.name, `评估任务 ${options.index || 1}`),
    description: String(options.description || templateEntry.description || ''),
    assessmentName: sanitizeName(options.assessmentName, sanitizeName(options.name, `评估任务 ${options.index || 1}`)),
    selectedEngine: options.selectedEngine || activeEngine,
    selectedMethods: methods.length ? methods : ['ahp', 'fuzzy', 'topsis'],
    selectedMethod: methods[0] || 'ahp',
    selectedSchemeId: schemes[0]?.id || '',
    selectedTreeVersionId: firstVersion.id,
    sourceTemplateId: templateEntry.id,
    sourceTemplateName: templateEntry.name,
    indicatorTree: tree,
    schemes,
    results: null,
    resultsDirty: true,
    treeVersions: [firstVersion],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function slugifyFilename(value, fallback = 'capability') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || fallback;
}
