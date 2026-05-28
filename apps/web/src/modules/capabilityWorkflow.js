import { computed, reactive } from 'vue';
import { api } from '../api';
import { authState } from '../auth';
import {
  CAPABILITY_LEGACY_DEFAULT_UNIT,
  annotateTree,
  applyInputDataRows,
  buildInputDataColumns,
  buildInputDataRows,
  buildResultsRows,
  buildTreeTableRows,
  clamp,
  cloneData,
  collectLeafIds,
  createId,
  createTaskFromTemplate,
  createTemplateEntry,
  createTreeVersion,
  downloadTextFile,
  formatScore,
  formatTimestamp,
  findNodeById,
  findNodeContext,
  normalizeWeightInput,
  nowIso,
  normalizeIndicatorUnit,
  parseDelimited,
  parseTreeImportContent,
  readFileAsText,
  roundWeight,
  safeArray,
  sanitizeIndicatorTree,
  serializeDelimited,
  slugifyFilename,
  syncSchemesToTree,
  summarizeIndicatorTree,
  syncCodes,
  validateWeightGroups,
  visitNodes,
} from './capabilityShared';

const STORAGE_KEY = 'mission-capability-workflow-v2';
const STORAGE_WARNING_MESSAGE = '浏览器本地存储空间不足，当前修改仅保留在内存中，建议尽快导出或同步到服务端。';
const LEGACY_SCHEME_NAME_MAP = {
  baseline: {
    legacy: '联合基线方案',
    current: '评估对象 A（均衡型）',
  },
  'precision-strike': {
    legacy: '精确打击强化方案',
    current: '评估对象 B（打击强化型）',
  },
  'rapid-mobility': {
    legacy: '快速机动保障方案',
    current: '评估对象 C（机动保障型）',
  },
};

function resolveSchemeName(id, name, index) {
  const normalizedName = String(name || '').trim();
  const legacyMeta = LEGACY_SCHEME_NAME_MAP[id];
  if (!normalizedName) {
    return legacyMeta?.current || `评估对象 ${index + 1}`;
  }

  if (legacyMeta && normalizedName === legacyMeta.legacy) {
    return legacyMeta.current;
  }

  return normalizedName;
}

function summarizeScheme(scheme) {
  const values = Object.values(scheme?.scores || {})
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));

  if (!values.length) {
    return { average: 0, high: 0, low: 0, spread: 0 };
  }

  const average = values.reduce((sum, item) => sum + item, 0) / values.length;
  const high = Math.max(...values);
  const low = Math.min(...values);

  return {
    average,
    high,
    low,
    spread: high - low,
  };
}

function readStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const scopedKey = buildScopedStorageKey(STORAGE_KEY);
    const raw = window.localStorage.getItem(scopedKey);
    if (raw) {
      return JSON.parse(raw);
    }

    if (authState.user?.id) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const legacyRaw = window.localStorage.getItem(STORAGE_KEY);
    return legacyRaw ? JSON.parse(legacyRaw) : null;
  } catch {
    return null;
  }
}

function resolveStorageScope() {
  const userId = authState.user?.id;
  if (userId === undefined || userId === null || userId === '') {
    return 'anonymous';
  }
  return `user-${String(userId)}`;
}

function buildScopedStorageKey(baseKey) {
  return `${baseKey}:${resolveStorageScope()}`;
}

function removeNodeFromTree(nodes, nodeId) {
  const list = safeArray(nodes);
  const index = list.findIndex((node) => node.id === nodeId);
  if (index >= 0) {
    const [removed] = list.splice(index, 1);
    return removed;
  }

  for (const node of list) {
    const removed = removeNodeFromTree(node.children, nodeId);
    if (removed) {
      return removed;
    }
  }

  return null;
}

function createDefaultLeaf(index) {
  return {
    id: createId('tertiary'),
    code: '',
    name: `三级指标 ${index + 1}`,
    weight: 0,
    description: '请补充三级指标说明',
    unit: '',
    children: [],
  };
}

function createDefaultCore(index) {
  return {
    id: createId('core'),
    code: '',
    name: `一级能力 ${index + 1}`,
    weight: 0,
    description: '请补充一级能力说明',
    children: [],
  };
}

function createDefaultSecondary(index) {
  return {
    id: createId('secondary'),
    code: '',
    name: `二级能力 ${index + 1}`,
    weight: 0,
    description: '请补充二级能力说明',
    children: [],
  };
}

function buildLeafUnitLookup(nodes) {
  const lookup = new Map();
  visitNodes(nodes, (node) => {
    if (safeArray(node.children).length) {
      return;
    }

    lookup.set(String(node.id), normalizeIndicatorUnit(node.unit));
  });
  return lookup;
}

function restoreLeafUnits(nodes, unitLookup, options = {}) {
  const overwriteLegacyDefault = options.overwriteLegacyDefault === true;
  if (!unitLookup?.size) {
    return;
  }

  visitNodes(nodes, (node) => {
    if (safeArray(node.children).length) {
      return;
    }

    const currentUnit = normalizeIndicatorUnit(node.unit);
    const templateUnit = normalizeIndicatorUnit(unitLookup.get(String(node.id)));
    const shouldRestoreBlank = !currentUnit && Boolean(templateUnit);
    const shouldRestoreLegacyDefault = overwriteLegacyDefault
      && currentUnit === CAPABILITY_LEGACY_DEFAULT_UNIT
      && Boolean(templateUnit)
      && templateUnit !== CAPABILITY_LEGACY_DEFAULT_UNIT;

    node.unit = shouldRestoreBlank || shouldRestoreLegacyDefault ? templateUnit : currentUnit;
  });
}

function sanitizeTemplateEntry(entry, index = 0) {
  const indicatorTree = sanitizeIndicatorTree(cloneData(entry?.indicatorTree || entry?.tree || entry?.indicators || []));
  syncCodes(indicatorTree);
  return createTemplateEntry(indicatorTree, {
    id: entry?.id || createId('tree-template'),
    name: entry?.name || `指标树模板 ${index + 1}`,
    description: entry?.description || '',
    source: entry?.source || 'custom',
    createdAt: entry?.createdAt || nowIso(),
  });
}

function buildDefaultTemplateEntry(payload) {
  const indicatorTree = sanitizeIndicatorTree(cloneData(payload?.indicators || []));
  syncCodes(indicatorTree);
  return createTemplateEntry(indicatorTree, {
    id: 'system-default-template',
    name: '系统默认指标树',
    description: payload?.description || '系统内置指标树模板',
    source: 'system',
    createdAt: nowIso(),
  });
}

function sanitizeTask(task, templatePayload, templateLibrary, index = 0) {
  const sourceTemplate = templateLibrary.find((item) => item.id === task?.sourceTemplateId) || templateLibrary[0];
  const templateUnitLookup = buildLeafUnitLookup(sourceTemplate?.indicatorTree || templatePayload?.indicators || []);
  const shouldOverwriteLegacyDefaultUnit = sourceTemplate?.source === 'system';
  const indicatorTree = sanitizeIndicatorTree(cloneData(task?.indicatorTree || sourceTemplate?.indicatorTree || templatePayload?.indicators || []));
  restoreLeafUnits(indicatorTree, templateUnitLookup, {
    overwriteLegacyDefault: shouldOverwriteLegacyDefaultUnit,
  });
  syncCodes(indicatorTree);

  const leafIds = collectLeafIds(indicatorTree);
  const persistedSchemes = safeArray(task?.schemes).map((scheme, schemeIndex) => {
    const scores = {};
    for (const leafId of leafIds) {
      scores[leafId] = clamp(scheme?.scores?.[leafId] ?? templatePayload?.schemes?.[schemeIndex]?.scores?.[leafId] ?? 70, 0, 100);
    }

    return {
      id: scheme?.id || createId('scheme'),
      name: resolveSchemeName(scheme?.id, scheme?.name, schemeIndex),
      description: scheme?.description || '',
      scores,
    };
  });
  const schemes = persistedSchemes.length ? persistedSchemes : safeArray(templatePayload?.schemes).map((scheme, schemeIndex) => ({
    id: scheme.id || createId('scheme'),
    name: resolveSchemeName(scheme?.id, scheme?.name, schemeIndex),
    description: scheme.description || '',
    scores: Object.fromEntries(leafIds.map((leafId) => [leafId, clamp(scheme?.scores?.[leafId] ?? 70, 0, 100)])),
  }));

  const versions = safeArray(task?.treeVersions).map((version, versionIndex) => {
    const versionTree = sanitizeIndicatorTree(cloneData(version?.indicatorTree || version?.tree || []));
    restoreLeafUnits(versionTree, templateUnitLookup, {
      overwriteLegacyDefault: shouldOverwriteLegacyDefaultUnit,
    });
    syncCodes(versionTree);
    return {
      id: version?.id || createId('tree-version'),
      name: version?.name || `V${versionIndex + 1}`,
      note: '版本变更记录',
      createdAt: version?.createdAt || nowIso(),
      sourceTemplateId: version?.sourceTemplateId || sourceTemplate?.id || '',
      sourceTemplateName: version?.sourceTemplateName || sourceTemplate?.name || '',
      indicatorTree: versionTree,
      summary: summarizeIndicatorTree(versionTree),
    };
  });

  if (!versions.length) {
    versions.push(createTreeVersion(indicatorTree, {
      index: 1,
      name: 'V1',
      note: '版本变更记录',
      sourceTemplateId: sourceTemplate?.id || '',
      sourceTemplateName: sourceTemplate?.name || '',
    }));
  }

  const methodKeys = safeArray(templatePayload?.methods).map((item) => item.key);
  const activeEngine = safeArray(templatePayload?.engines).find((item) => item.status === 'active')?.key || 'builtin';
  const selectedMethods = safeArray(task?.selectedMethods).filter((item, itemIndex, source) => methodKeys.includes(item) && source.indexOf(item) === itemIndex);
  const methods = selectedMethods.length ? selectedMethods : (methodKeys.length ? methodKeys : ['ahp', 'fuzzy', 'topsis']);

  return {
    id: task?.id || createId('capability-task'),
    name: task?.name || `评估任务 ${index + 1}`,
    description: task?.description || '',
    assessmentName: task?.assessmentName || task?.name || `评估任务 ${index + 1}`,
    selectedEngine: safeArray(templatePayload?.engines).some((item) => item.key === task?.selectedEngine) ? task.selectedEngine : activeEngine,
    selectedMethods: methods,
    selectedMethod: methods.includes(task?.selectedMethod) ? task.selectedMethod : methods[0],
    selectedSchemeId: schemes.find((scheme) => scheme.id === task?.selectedSchemeId)?.id || schemes[0]?.id || '',
    selectedTreeVersionId: versions.find((version) => version.id === task?.selectedTreeVersionId)?.id || versions[versions.length - 1]?.id || '',
    sourceTemplateId: sourceTemplate?.id || '',
    sourceTemplateName: sourceTemplate?.name || '',
    indicatorTree,
    schemes,
    results: null,
    resultsDirty: true,
    treeVersions: versions,
    createdAt: task?.createdAt || nowIso(),
    updatedAt: task?.updatedAt || nowIso(),
  };
}

function parseInputImportPayload(text, extension) {
  if (extension === 'json') {
    return JSON.parse(text);
  }

  const delimiter = extension === 'tsv' ? '\t' : ',';
  return {
    rows: parseDelimited(text, delimiter),
  };
}

function buildResultsInsight(task, selectedSchemeResult) {
  if (!selectedSchemeResult) {
    return {
      label: '结果状态',
      value: '--',
      hint: '请先执行能力评估计算',
    };
  }
  if (task?.selectedMethod === 'topsis') {
    return {
      label: '贴近度',
      value: Number(selectedSchemeResult.closeness || 0).toFixed(4),
      hint: '越接近 1 表示越优',
    };
  }
  if (task?.selectedMethod === 'fuzzy') {
    return {
      label: '综合等级',
      value: selectedSchemeResult.grade || '--',
      hint: `综合得分 ${Number(selectedSchemeResult.overallScore || 0).toFixed(2)}`,
    };
  }
  return {
    label: '权重状态',
    value: '需人工检查',
    hint: '计算前会校验每个分支的权重和是否为 1',
  };
}
function buildIndicatorLibrary(indicators) {
  const library = sanitizeIndicatorTree(cloneData(indicators || []));
  syncCodes(library);
  return library;
}

function cloneLibraryCore(core, options = {}) {
  const nextSource = cloneData(core);
  if (options.includeChildren === false) {
    nextSource.children = [];
  }

  const [nextCore] = sanitizeIndicatorTree([nextSource]);
  return nextCore;
}

function cloneLibrarySecondary(secondary, options = {}) {
  const nextSource = cloneData(secondary);
  if (options.includeChildren === false) {
    nextSource.children = [];
  }

  const [nextSecondary] = sanitizeIndicatorTree([nextSource], 2);
  return nextSecondary;
}

function cloneLibraryLeaf(leaf) {
  const [nextLeaf] = sanitizeIndicatorTree([cloneData(leaf)], 3);
  return nextLeaf;
}

const state = reactive({
  loading: false,
  calculating: false,
  initialized: false,
  initializingPromise: null,
  errorMessage: '',
  feedbackMessage: '',
  feedbackTone: 'info',
  template: null,
  indicatorLibrary: [],
  tasks: [],
  selectedTaskId: '',
  templateLibrary: [],
  storageScope: '',
  storageWriteWarning: '',
});

let persistTimer = null;
let storageWriteWarningShown = false;

function writeStorage() {
  if (typeof window === 'undefined' || !state.initialized) {
    return;
  }

  const payload = {
    version: 3,
    selectedTaskId: state.selectedTaskId,
    indicatorLibrary: state.indicatorLibrary,
    templateLibrary: state.templateLibrary
      .filter((item) => item.source !== 'system')
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        source: item.source,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        indicatorTree: item.indicatorTree,
      })),
    tasks: state.tasks.map((task) => ({
      id: task.id,
      name: task.name,
      description: task.description,
      assessmentName: task.assessmentName,
      selectedEngine: task.selectedEngine,
      selectedMethods: task.selectedMethods,
      selectedMethod: task.selectedMethod,
      selectedSchemeId: task.selectedSchemeId,
      selectedTreeVersionId: task.selectedTreeVersionId,
      sourceTemplateId: task.sourceTemplateId,
      indicatorTree: task.indicatorTree,
      schemes: task.schemes,
      resultsDirty: task.resultsDirty,
      treeVersions: task.treeVersions,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
  };

  try {
    window.localStorage.setItem(buildScopedStorageKey(STORAGE_KEY), JSON.stringify(payload));
    state.storageWriteWarning = '';
    storageWriteWarningShown = false;
  } catch {
    state.storageWriteWarning = STORAGE_WARNING_MESSAGE;
    if (!storageWriteWarningShown) {
      storageWriteWarningShown = true;
      setFeedback(STORAGE_WARNING_MESSAGE, 'warn');
    }
  }
}

function schedulePersist() {
  if (typeof window === 'undefined') {
    return;
  }

  if (persistTimer) {
    window.clearTimeout(persistTimer);
  }

  persistTimer = window.setTimeout(() => {
    writeStorage();
    persistTimer = null;
  }, 120);
}

function setFeedback(message, tone = 'info') {
  state.feedbackMessage = message;
  state.feedbackTone = tone;
}

function clearFeedback() {
  state.feedbackMessage = '';
  state.feedbackTone = 'info';
}

function clearError() {
  state.errorMessage = '';
}

const currentUser = computed(() => authState.user || { username: '', role: 'user' });
const indicatorLibrary = computed(() => state.indicatorLibrary);
const activeTask = computed(() => state.tasks.find((item) => item.id === state.selectedTaskId) || state.tasks[0] || null);
const previewTree = computed(() => annotateTree(activeTask.value?.indicatorTree || []));
const activeScheme = computed(() => {
  const task = activeTask.value;
  return task?.schemes.find((item) => item.id === task.selectedSchemeId) || task?.schemes[0] || null;
});
const currentTreeVersion = computed(() => {
  const task = activeTask.value;
  return task?.treeVersions.find((item) => item.id === task.selectedTreeVersionId) || task?.treeVersions[task?.treeVersions.length - 1] || null;
});
const hasIndicatorTree = computed(() => Boolean(previewTree.value.length));
const hasLeafIndicators = computed(() => Boolean(collectLeafIds(activeTask.value?.indicatorTree || []).length));
const weightIssues = computed(() => validateWeightGroups(activeTask.value?.indicatorTree || []));
const hasValidWeights = computed(() => !weightIssues.value.length);
const canEvaluate = computed(() => hasLeafIndicators.value && hasValidWeights.value);
const availableCoreOptions = computed(() => safeArray(activeTask.value?.indicatorTree).map((item) => ({
  id: item.id,
  code: item.code,
  name: item.name,
})));
const methodOptions = computed(() => state.template?.methods || []);
const engineOptions = computed(() => state.template?.engines || []);
const methodResults = computed(() => activeTask.value?.results?.methods || {});
const visibleMethodTabs = computed(() => methodOptions.value.filter((item) => methodResults.value[item.key]));
const selectedMethodMeta = computed(() => {
  const task = activeTask.value;
  return methodOptions.value.find((item) => item.key === task?.selectedMethod) || null;
});
const selectedMethodResult = computed(() => {
  const task = activeTask.value;
  return task ? methodResults.value[task.selectedMethod] || null : null;
});
const selectedSchemeResult = computed(() => {
  const task = activeTask.value;
  return task ? selectedMethodResult.value?.schemes?.[task.selectedSchemeId] || null : null;
});
const rankingRows = computed(() => selectedMethodResult.value?.ranking || []);
const topScheme = computed(() => rankingRows.value[0] || null);
const resolvedTopScheme = computed(() => (activeTask.value?.results && !activeTask.value?.resultsDirty ? topScheme.value : null));
const selectedMethodLabels = computed(() => {
  const task = activeTask.value;
  return methodOptions.value
    .filter((item) => task?.selectedMethods.includes(item.key))
    .map((item) => item.label);
});
const activeSchemeStats = computed(() => summarizeScheme(activeScheme.value));
const librarySummary = computed(() => summarizeIndicatorTree(indicatorLibrary.value));
const workflowSummary = computed(() => ({
  ...summarizeIndicatorTree(activeTask.value?.indicatorTree || []),
  schemeCount: activeTask.value?.schemes.length || 0,
  versionCount: activeTask.value?.treeVersions.length || 0,
  templateCount: state.templateLibrary.length,
}));
const methodInsight = computed(() => buildResultsInsight(activeTask.value, selectedSchemeResult.value));

function ensureSelectedTask() {
  if (!state.tasks.length) {
    state.selectedTaskId = '';
    return;
  }

  if (!state.tasks.some((item) => item.id === state.selectedTaskId)) {
    state.selectedTaskId = state.tasks[0].id;
  }
}

function markTaskDirty(task = activeTask.value) {
  if (!task) {
    return;
  }

  task.resultsDirty = true;
  task.updatedAt = nowIso();
  schedulePersist();
}

function saveCurrentTaskVersion(options = {}) {
  const task = activeTask.value;
  if (!task) {
    return null;
  }

  const version = createTreeVersion(task.indicatorTree, {
    index: task.treeVersions.length + 1,
    name: options.name || `V${task.treeVersions.length + 1}`,
    note: '版本变更记录',
    sourceTemplateId: options.sourceTemplateId || task.sourceTemplateId,
    sourceTemplateName: options.sourceTemplateName || task.sourceTemplateName,
  });
  task.treeVersions.push(version);
  task.selectedTreeVersionId = version.id;
  task.updatedAt = nowIso();
  schedulePersist();
  return version;
}

function ensureTaskMethod(task) {
  const available = Object.keys(task?.results?.methods || {});
  if (!available.length) {
    if (!task.selectedMethods.includes(task.selectedMethod)) {
      task.selectedMethod = task.selectedMethods[0] || 'ahp';
    }
    return;
  }

  if (!available.includes(task.selectedMethod)) {
    task.selectedMethod = available[0];
  }
}

function hydrateTemplate(payload) {
  const persisted = readStorage();
  state.storageScope = resolveStorageScope();
  state.indicatorLibrary = buildIndicatorLibrary(persisted?.indicatorLibrary || payload?.indicators || []);
  const defaultTemplate = buildDefaultTemplateEntry(payload);
  const customTemplates = safeArray(persisted?.templateLibrary).map((item, index) => sanitizeTemplateEntry(item, index));
  state.templateLibrary = [defaultTemplate, ...customTemplates.filter((item) => item.id !== defaultTemplate.id)];

  const tasks = safeArray(persisted?.tasks).map((task, index) => sanitizeTask(task, payload, state.templateLibrary, index));
  state.tasks = tasks.length
    ? tasks
    : [createTaskFromTemplate(defaultTemplate, payload, {
        name: '评估任务 1',
        index: 1,
        startEmpty: true,
        assessmentName: '评估任务 1',
      })];

  state.selectedTaskId = persisted?.selectedTaskId || state.tasks[0]?.id || '';
  state.template = payload;
  ensureSelectedTask();
  clearError();
  clearFeedback();
}

async function loadCapabilityTemplate() {
  const payload = await api.getCapabilityTemplate();
  hydrateTemplate(payload);
  state.initialized = true;
  schedulePersist();
}

async function initializeCapabilityWorkflow(force = false) {
  const nextScope = resolveStorageScope();
  const needsRehydrateByScope = state.initialized && state.storageScope && state.storageScope !== nextScope;
  const shouldForce = force || needsRehydrateByScope;

  if (state.initialized && !shouldForce) {
    return;
  }

  if (state.initializingPromise && !shouldForce) {
    return state.initializingPromise;
  }

  state.loading = true;
  clearError();
  state.initializingPromise = loadCapabilityTemplate()
    .catch((error) => {
      state.errorMessage = error.message || '能力计算模块初始化失败';
      throw error;
    })
    .finally(() => {
      state.loading = false;
      state.initializingPromise = null;
    });

  return state.initializingPromise;
}

function createTaskFromTemplateId(templateId, options = {}) {
  const templateEntry = state.templateLibrary.find((item) => item.id === templateId) || state.templateLibrary[0];
  if (!templateEntry || !state.template) {
    return;
  }

  const task = createTaskFromTemplate(templateEntry, state.template, {
    name: options.name || `评估任务 ${state.tasks.length + 1}`,
    index: state.tasks.length + 1,
    description: options.description || templateEntry.description,
    startEmpty: options.startEmpty === true,
    assessmentName: options.assessmentName || `评估任务 ${state.tasks.length + 1}`,
  });
  state.tasks.push(task);
  state.selectedTaskId = task.id;
  schedulePersist();
  setFeedback('操作已更新', 'success');
}

function createBlankTask() {
  createTaskFromTemplateId(state.templateLibrary[0]?.id, {
    startEmpty: true,
    description: '从指标库选取指标块后构建指标树',
  });
}

function duplicateTask(taskId = activeTask.value?.id) {
  const source = state.tasks.find((item) => item.id === taskId);
  if (!source || !state.template) {
    return;
  }

  const copy = sanitizeTask({
    ...cloneData(source),
    id: createId('capability-task'),
    name: `${source.name} - 副本`,
    assessmentName: `${source.assessmentName} - 副本`,
    selectedTreeVersionId: '',
    treeVersions: [
      createTreeVersion(source.indicatorTree, {
        index: 1,
        name: 'V1',
        note: '版本变更记录',
        sourceTemplateId: source.sourceTemplateId,
        sourceTemplateName: source.sourceTemplateName,
      }),
    ],
  }, state.template, state.templateLibrary, state.tasks.length);
  state.tasks.push(copy);
  state.selectedTaskId = copy.id;
  schedulePersist();
  setFeedback('操作已更新', 'success');
}

function removeTask(taskId = activeTask.value?.id) {
  if (state.tasks.length <= 1) {
    setFeedback('至少保留一个评估任务', 'warn');
    return;
  }

  const index = state.tasks.findIndex((item) => item.id === taskId);
  if (index < 0) {
    return;
  }

  const [removed] = state.tasks.splice(index, 1);
  state.selectedTaskId = state.tasks[Math.max(0, index - 1)]?.id || state.tasks[0]?.id || '';
  schedulePersist();
  setFeedback('操作已更新', 'success');
}

function setSelectedTask(taskId) {
  state.selectedTaskId = taskId;
  clearError();
  clearFeedback();
  schedulePersist();
}

function resetTaskToTemplate() {
  const task = activeTask.value;
  const templateEntry = state.templateLibrary.find((item) => item.id === task?.sourceTemplateId) || state.templateLibrary[0];
  if (!task || !templateEntry || !state.template) {
    return;
  }

  task.indicatorTree = cloneData(templateEntry.indicatorTree);
  syncCodes(task.indicatorTree);
  task.schemes = safeArray(task.schemes).map((scheme) => ({
    ...scheme,
    scores: Object.fromEntries(collectLeafIds(task.indicatorTree).map((leafId) => [leafId, 70])),
  }));
  task.results = null;
  task.resultsDirty = true;
  saveCurrentTaskVersion({
    note: '版本变更记录',
  });
  markTaskDirty(task);
  setFeedback('操作已更新', 'success');
}

function setAssessmentName(value) {
  const task = activeTask.value;
  if (!task) {
    return;
  }
  task.assessmentName = value;
  if (!task.name) {
    task.name = value;
  }
  markTaskDirty(task);
}

function setTaskName(value) {
  const task = activeTask.value;
  if (!task) {
    return;
  }
  task.name = value;
  markTaskDirty(task);
}

function setTaskDescription(value) {
  const task = activeTask.value;
  if (!task) {
    return;
  }
  task.description = value;
  markTaskDirty(task);
}

function setSelectedEngine(value) {
  const task = activeTask.value;
  if (!task) {
    return;
  }
  task.selectedEngine = value;
  markTaskDirty(task);
}

function setSelectedScheme(id) {
  const task = activeTask.value;
  if (!task) {
    return;
  }
  task.selectedSchemeId = id;
  schedulePersist();
}

function setSelectedMethod(key) {
  const task = activeTask.value;
  if (!task) {
    return;
  }
  task.selectedMethod = key;
  schedulePersist();
}

function toggleMethod(methodKey) {
  const task = activeTask.value;
  if (!task) {
    return;
  }

  if (task.selectedMethods.includes(methodKey)) {
    if (task.selectedMethods.length === 1) {
      return;
    }

    task.selectedMethods = task.selectedMethods.filter((item) => item !== methodKey);
    if (task.selectedMethod === methodKey) {
      task.selectedMethod = task.selectedMethods[0] || 'ahp';
    }
    markTaskDirty(task);
    return;
  }

  task.selectedMethods = [...task.selectedMethods, methodKey];
  markTaskDirty(task);
}

function updateNodeWeight(nodeId, value) {
  const task = activeTask.value;
  const context = task ? findNodeContext(task.indicatorTree, nodeId) : null;
  if (!task || !context?.node) {
    return;
  }

  const requestedWeight = Number(value);
  const normalizedRequestedWeight = Number.isFinite(requestedWeight)
    ? roundWeight(Math.min(1, Math.max(0, requestedWeight)))
    : 0;
  const siblingNodes = context.parent ? safeArray(context.parent.children) : safeArray(task.indicatorTree);
  const siblingWeightSum = siblingNodes.reduce((sum, item) => {
    if (item.id === nodeId) {
      return sum;
    }
    return sum + Math.max(normalizeWeightInput(item.weight), 0);
  }, 0);
  const availableWeight = roundWeight(Math.max(0, 1 - siblingWeightSum));

  context.node.weight = Math.min(normalizedRequestedWeight, availableWeight);
  markTaskDirty(task);
}

function updateNodeField(nodeId, field, value) {
  const task = activeTask.value;
  const node = task ? findNodeById(task.indicatorTree, nodeId) : null;
  if (!task || !node) {
    return;
  }

  node[field] = value;
  markTaskDirty(task);
}

function updateSchemeScore(schemeId, leafId, value) {
  const task = activeTask.value;
  const resolvedSchemeId = schemeId || task?.selectedSchemeId;
  const scheme = task?.schemes.find((item) => item.id === resolvedSchemeId);
  if (!task || !scheme) {
    return;
  }

  const rawValue = String(value ?? '').trim();
  const nextValue = Number(rawValue);
  scheme.scores[leafId] = rawValue !== '' && Number.isFinite(nextValue) && nextValue >= 0 && nextValue <= 100
    ? nextValue
    : 80;
  markTaskDirty(task);
}

function updateSchemeField(schemeId, field, value) {
  const task = activeTask.value;
  const scheme = task?.schemes.find((item) => item.id === schemeId);
  if (!task || !scheme) {
    return;
  }

  scheme[field] = value;
  markTaskDirty(task);
}

function getSecondaryOptions(coreId) {
  const task = activeTask.value;
  const core = task?.indicatorTree.find((item) => item.id === coreId);
  return safeArray(core?.children).map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
  }));
}

function getLibrarySecondaryOptions(coreId) {
  const core = indicatorLibrary.value.find((item) => item.id === coreId);
  return safeArray(core?.children).map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
  }));
}

function getLibraryLeafOptions(secondaryId) {
  const secondary = findNodeById(indicatorLibrary.value, secondaryId);
  return safeArray(secondary?.children).map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    unit: item.unit || '',
  }));
}

function clampInsertIndex(index, length) {
  const next = Number(index);
  if (!Number.isFinite(next)) {
    return length;
  }

  return Math.max(0, Math.min(Math.trunc(next), length));
}

function rebuildTaskTree(task) {
  if (!task) {
    return;
  }

  syncCodes(task.indicatorTree);
  task.schemes = syncSchemesToTree(task.schemes, task.indicatorTree, cloneData(state.template?.schemes || []));
  task.results = null;
  markTaskDirty(task);
}

function rebuildIndicatorLibrary() {
  syncCodes(state.indicatorLibrary);
  schedulePersist();
}

function updateLibraryNodeField(nodeId, field, value) {
  const node = findNodeById(state.indicatorLibrary, nodeId);
  if (!node) {
    return;
  }

  node[field] = value;
  rebuildIndicatorLibrary();
}

function addCoreToLibrary() {
  state.indicatorLibrary.push(createDefaultCore(state.indicatorLibrary.length));
  rebuildIndicatorLibrary();
  setFeedback('操作已更新', 'success');
}

function addSecondaryToLibrary(coreId) {
  const core = findNodeById(state.indicatorLibrary, coreId);
  if (!core) {
    return;
  }

  core.children.push(createDefaultSecondary(core.children.length));
  rebuildIndicatorLibrary();
  setFeedback('操作已更新', 'success');
}

function addLeafToLibrary(secondaryId) {
  const secondary = findNodeById(state.indicatorLibrary, secondaryId);
  if (!secondary) {
    return;
  }

  secondary.children.push(createDefaultLeaf(secondary.children.length));
  rebuildIndicatorLibrary();
  setFeedback('操作已更新', 'success');
}

function removeLibraryIndicator(nodeId) {
  const removed = removeNodeFromTree(state.indicatorLibrary, nodeId);
  if (!removed) {
    return;
  }

  rebuildIndicatorLibrary();
  setFeedback('操作已更新', 'success');
}

function clearIndicatorTree() {
  const task = activeTask.value;
  if (!task) {
    return;
  }

  if (!window.confirm('确认清空当前指标树吗？')) {
    setFeedback('已取消清空指标树', 'warn');
    return;
  }

  task.indicatorTree = [];
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function isLibraryCoreSelected(coreId) {
  return Boolean(activeTask.value?.indicatorTree.find((item) => item.id === coreId));
}

function isLibrarySecondarySelected(coreId, secondaryId) {
  return Boolean(findNodeById(activeTask.value?.indicatorTree || [], secondaryId));
}

function isLibraryLeafSelected(secondaryId, leafId) {
  return Boolean(findNodeById(activeTask.value?.indicatorTree || [], leafId));
}

function insertCoreFromLibrary(coreId, targetIndex = activeTask.value?.indicatorTree.length || 0) {
  const task = activeTask.value;
  const libraryCore = indicatorLibrary.value.find((item) => item.id === coreId);
  if (!task || !libraryCore) {
    return;
  }

  if (task.indicatorTree.find((item) => item.id === coreId)) {
    setFeedback('该一级指标已加入当前指标树', 'warn');
    return;
  }

  task.indicatorTree.splice(
    clampInsertIndex(targetIndex, task.indicatorTree.length),
    0,
    cloneLibraryCore(libraryCore, { includeChildren: false }),
  );
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function insertSecondaryFromLibrary(sourceCoreId, secondaryId, targetCoreId = sourceCoreId, targetIndex) {
  const task = activeTask.value;
  const libraryCore = indicatorLibrary.value.find((item) => item.id === sourceCoreId);
  const librarySecondary = libraryCore?.children.find((item) => item.id === secondaryId);
  if (!task || !libraryCore || !librarySecondary) {
    return;
  }

  if (findNodeById(task.indicatorTree, secondaryId)) {
    setFeedback('该二级指标已加入当前指标树', 'warn');
    return;
  }

  if (targetCoreId !== sourceCoreId) {
    setFeedback('二级指标只能添加到其所属一级指标下', 'warn');
    return;
  }

  let targetCore = task.indicatorTree.find((item) => item.id === targetCoreId);
  if (!targetCore && targetCoreId === sourceCoreId) {
    targetCore = cloneLibraryCore({
      ...libraryCore,
      children: [],
    });
    task.indicatorTree.push(targetCore);
  }

  if (!targetCore) {
    return;
  }

  targetCore.children.splice(
    clampInsertIndex(targetIndex, targetCore.children.length),
    0,
    cloneLibrarySecondary(librarySecondary, { includeChildren: false }),
  );
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function moveCoreNode(coreId, targetIndex) {
  const task = activeTask.value;
  if (!task) {
    return;
  }

  const sourceIndex = task.indicatorTree.findIndex((item) => item.id === coreId);
  if (sourceIndex < 0) {
    return;
  }

  const insertIndex = clampInsertIndex(targetIndex, task.indicatorTree.length);
  const adjustedIndex = sourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
  if (adjustedIndex === sourceIndex) {
    return;
  }

  const [core] = task.indicatorTree.splice(sourceIndex, 1);
  task.indicatorTree.splice(adjustedIndex, 0, core);
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function moveSecondaryNode(secondaryId, targetCoreId, targetIndex) {
  const task = activeTask.value;
  const sourceContext = task ? findNodeContext(task.indicatorTree, secondaryId) : null;
  const sourceCore = sourceContext?.parent;
  const targetCore = task?.indicatorTree.find((item) => item.id === targetCoreId);
  if (!task || !sourceContext?.node || !sourceCore || !targetCore) {
    return;
  }

  if (sourceCore.id !== targetCore.id) {
    setFeedback('二级指标只能在所属一级指标下调整顺序', 'warn');
    return;
  }

  const sourceIndex = sourceCore.children.findIndex((item) => item.id === secondaryId);
  if (sourceIndex < 0) {
    return;
  }

  const insertIndex = clampInsertIndex(targetIndex, targetCore.children.length);
  const adjustedIndex = sourceCore.id === targetCore.id && sourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
  if (sourceCore.id === targetCore.id && adjustedIndex === sourceIndex) {
    return;
  }

  const [secondary] = sourceCore.children.splice(sourceIndex, 1);
  targetCore.children.splice(adjustedIndex, 0, secondary);
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function moveLeafNode(leafId, targetSecondaryId, targetIndex) {
  const task = activeTask.value;
  const sourceContext = task ? findNodeContext(task.indicatorTree, leafId) : null;
  const sourceSecondary = sourceContext?.parent;
  const targetSecondary = task ? findNodeById(task.indicatorTree, targetSecondaryId) : null;
  if (!task || !sourceContext?.node || !sourceSecondary || !targetSecondary) {
    return;
  }

  if (sourceSecondary.id !== targetSecondary.id) {
    setFeedback('三级指标只能在所属二级指标下调整顺序', 'warn');
    return;
  }

  const sourceIndex = sourceSecondary.children.findIndex((item) => item.id === leafId);
  if (sourceIndex < 0) {
    return;
  }

  const insertIndex = clampInsertIndex(targetIndex, targetSecondary.children.length);
  const adjustedIndex = sourceSecondary.id === targetSecondary.id && sourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
  if (sourceSecondary.id === targetSecondary.id && adjustedIndex === sourceIndex) {
    return;
  }

  const [leaf] = sourceSecondary.children.splice(sourceIndex, 1);
  targetSecondary.children.splice(adjustedIndex, 0, leaf);
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function addCoreFromLibrary(coreId) {
  const task = activeTask.value;
  const libraryCore = indicatorLibrary.value.find((item) => item.id === coreId);
  if (!task || !libraryCore) {
    return;
  }

  if (task.indicatorTree.find((item) => item.id === coreId)) {
    setFeedback('该一级指标已加入当前指标树', 'warn');
    return;
  }

  task.indicatorTree.push(cloneLibraryCore(libraryCore, { includeChildren: false }));
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function addSecondaryFromLibrary(coreId, secondaryId) {
  const task = activeTask.value;
  const libraryCore = indicatorLibrary.value.find((item) => item.id === coreId);
  const librarySecondary = libraryCore?.children.find((item) => item.id === secondaryId);
  if (!task || !libraryCore || !librarySecondary) {
    return;
  }

  let targetCore = task.indicatorTree.find((item) => item.id === coreId);
  if (!targetCore) {
    targetCore = cloneLibraryCore({
      ...libraryCore,
      children: [],
    });
    task.indicatorTree.push(targetCore);
  }

  if (targetCore.children.find((item) => item.id === secondaryId)) {
    setFeedback('该二级指标已加入当前指标树', 'warn');
    return;
  }

  targetCore.children.push(cloneLibrarySecondary(librarySecondary, { includeChildren: false }));
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function insertLeafFromLibrary(sourceSecondaryId, leafId, targetSecondaryId = sourceSecondaryId, targetIndex) {
  const task = activeTask.value;
  const librarySecondary = findNodeById(indicatorLibrary.value, sourceSecondaryId);
  const libraryLeaf = librarySecondary?.children.find((item) => item.id === leafId);
  if (!task || !librarySecondary || !libraryLeaf) {
    return;
  }

  if (findNodeById(task.indicatorTree, leafId)) {
    setFeedback('该三级指标已加入当前指标树', 'warn');
    return;
  }

  if (targetSecondaryId !== sourceSecondaryId) {
    setFeedback('三级指标只能添加到其所属二级指标下', 'warn');
    return;
  }

  const targetSecondary = findNodeById(task.indicatorTree, targetSecondaryId);
  if (!targetSecondary) {
    return;
  }

  targetSecondary.children.splice(
    clampInsertIndex(targetIndex, targetSecondary.children.length),
    0,
    cloneLibraryLeaf(libraryLeaf),
  );
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function addLeafFromLibrary(secondaryId, leafId) {
  const task = activeTask.value;
  const librarySecondary = findNodeById(indicatorLibrary.value, secondaryId);
  const libraryLeaf = librarySecondary?.children.find((item) => item.id === leafId);
  const targetSecondary = task ? findNodeById(task.indicatorTree, secondaryId) : null;
  if (!task || !librarySecondary || !libraryLeaf || !targetSecondary) {
    return;
  }

  if (targetSecondary.children.find((item) => item.id === leafId)) {
    setFeedback('该三级指标已加入当前指标树', 'warn');
    return;
  }

  targetSecondary.children.push(cloneLibraryLeaf(libraryLeaf));
  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function canRemoveIndicator(nodeId) {
  return Boolean(findNodeContext(activeTask.value?.indicatorTree || [], nodeId));
}

function removeIndicator(nodeId) {
  const task = activeTask.value;
  const context = task ? findNodeContext(task.indicatorTree, nodeId) : null;
  if (!task || !context || !canRemoveIndicator(nodeId)) {
    return;
  }

  if (!window.confirm('确认删除当前指标吗？')) {
    setFeedback('已取消删除指标', 'warn');
    return;
  }

  const removed = removeNodeFromTree(task.indicatorTree, nodeId);
  if (!removed) {
    return;
  }

  rebuildTaskTree(task);
  setFeedback('操作已更新', 'success');
}

function saveTreeVersion(options = {}) {
  const version = saveCurrentTaskVersion(options);
  if (!version) {
    return;
  }
  setFeedback('操作已更新', 'success');
}

function restoreTreeVersion(versionId) {
  const task = activeTask.value;
  const version = task?.treeVersions.find((item) => item.id === versionId);
  if (!task || !version) {
    return;
  }

  if (!window.confirm('确认恢复到所选版本吗？')) {
    setFeedback('已取消恢复版本', 'warn');
    return;
  }

  task.indicatorTree = cloneData(version.indicatorTree);
  syncCodes(task.indicatorTree);
  task.selectedTreeVersionId = version.id;
  task.resultsDirty = true;
  task.results = null;

  const leafIds = collectLeafIds(task.indicatorTree);
  task.schemes = task.schemes.map((scheme) => ({
    ...scheme,
    scores: Object.fromEntries(leafIds.map((leafId) => [leafId, clamp(scheme?.scores?.[leafId] ?? 70, 0, 100)])),
  }));

  markTaskDirty(task);
  setFeedback('操作已更新', 'success');
}

function saveCurrentTreeAsTemplate(options = {}) {
  const task = activeTask.value;
  if (!task) {
    return;
  }

  const template = createTemplateEntry(task.indicatorTree, {
    name: options.name || `${task.name} 模板`,
    description: options.description || task.description,
    source: 'custom',
  });
  state.templateLibrary.push(template);
  schedulePersist();
  setFeedback('操作已更新', 'success');
}

function applyTemplateToTask(templateId) {
  const task = activeTask.value;
  const templateEntry = state.templateLibrary.find((item) => item.id === templateId);
  if (!task || !templateEntry) {
    return;
  }

  if (!window.confirm('确认用模板覆盖当前指标树吗？')) {
    setFeedback('已取消应用模板', 'warn');
    return;
  }

  task.indicatorTree = cloneData(templateEntry.indicatorTree);
  syncCodes(task.indicatorTree);
  task.sourceTemplateId = templateEntry.id;
  task.sourceTemplateName = templateEntry.name;
  task.schemes = task.schemes.map((scheme) => ({
    ...scheme,
    scores: Object.fromEntries(collectLeafIds(task.indicatorTree).map((leafId) => [leafId, clamp(scheme?.scores?.[leafId] ?? 70, 0, 100)])),
  }));
  task.results = null;
  task.resultsDirty = true;
  saveCurrentTaskVersion({
    note: '版本变更记录',
    sourceTemplateId: templateEntry.id,
    sourceTemplateName: templateEntry.name,
  });
  markTaskDirty(task);
  setFeedback('操作已更新', 'success');
}

function deleteTemplate(templateId) {
  const index = state.templateLibrary.findIndex((item) => item.id === templateId && item.source !== 'system');
  if (index < 0) {
    return;
  }

  const [removed] = state.templateLibrary.splice(index, 1);
  schedulePersist();
  setFeedback('操作已更新', 'success');
}

async function calculateAssessment() {
  const task = activeTask.value;
  if (!task) {
    return;
  }

  if (!collectLeafIds(task.indicatorTree).length) {
    const message = '当前任务尚未从指标库构建指标树，无法执行评估计算';
    state.errorMessage = message;
    throw new Error(message);
  }

  if (!hasValidWeights.value) {
    const message = '当前存在权重组系数和不为 1 的问题，请先手动调整权重后再计算';
    state.errorMessage = message;
    throw new Error(message);
  }

  state.calculating = true;
  clearError();

  try {
    task.results = await api.evaluateCapability({
      assessmentName: task.assessmentName.trim() || task.name || '能力评估任务',
      engine: task.selectedEngine,
      methods: task.selectedMethods,
      indicators: task.indicatorTree,
      schemes: task.schemes,
    });
    task.resultsDirty = false;
    ensureTaskMethod(task);
    schedulePersist();
    setFeedback('操作已更新', 'success');
  } catch (error) {
    state.errorMessage = error.message || '能力评估计算失败';
    throw error;
  } finally {
    state.calculating = false;
  }
}

async function importTreeFile(file) {
  const task = activeTask.value;
  if (!task || !file) {
    return;
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || 'json';
  const content = await readFileAsText(file);
  const indicatorTree = parseTreeImportContent(content, extension);
  task.indicatorTree = indicatorTree;
  task.schemes = task.schemes.map((scheme) => ({
    ...scheme,
    scores: Object.fromEntries(collectLeafIds(indicatorTree).map((leafId) => [leafId, clamp(scheme?.scores?.[leafId] ?? 70, 0, 100)])),
  }));
  task.results = null;
  task.resultsDirty = true;
  saveCurrentTaskVersion({
    note: '版本变更记录',
  });
  markTaskDirty(task);
  setFeedback('操作已更新', 'success');
}

async function importInputDataFile(file) {
  const task = activeTask.value;
  if (!task || !file) {
    return;
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || 'json';
  const content = await readFileAsText(file);
  const payload = parseInputImportPayload(content, extension);

  if (payload?.indicatorTree) {
    task.indicatorTree = sanitizeIndicatorTree(cloneData(payload.indicatorTree));
    syncCodes(task.indicatorTree);
    task.schemes = safeArray(payload.schemes).length
      ? safeArray(payload.schemes).map((scheme, index) => ({
          id: scheme?.id || task.schemes[index]?.id || createId('scheme'),
          name: scheme?.name || task.schemes[index]?.name || `评估对象 ${index + 1}`,
          description: scheme?.description || task.schemes[index]?.description || '',
          scores: Object.fromEntries(collectLeafIds(task.indicatorTree).map((leafId) => [leafId, clamp(scheme?.scores?.[leafId] ?? 70, 0, 100)])),
        }))
      : task.schemes.map((scheme) => ({
          ...scheme,
          scores: Object.fromEntries(collectLeafIds(task.indicatorTree).map((leafId) => [leafId, clamp(scheme?.scores?.[leafId] ?? 70, 0, 100)])),
        }));
    task.results = null;
    task.resultsDirty = true;
    markTaskDirty(task);
    setFeedback('操作已更新', 'success');
    return;
  }

  const matchedRows = applyInputDataRows(task.indicatorTree, task.schemes, payload?.rows || []);
  task.resultsDirty = true;
  task.results = null;
  markTaskDirty(task);
  setFeedback('操作已更新', 'success');
}

function exportTree(format) {
  const task = activeTask.value;
  if (!task) {
    return;
  }

  const basename = slugifyFilename(task.name || task.assessmentName || 'capability-tree', 'capability-tree');
  if (format === 'json') {
    downloadTextFile(JSON.stringify({
      type: 'capability-indicator-tree',
      version: 1,
      exportedAt: nowIso(),
      taskId: task.id,
      taskName: task.name,
      indicatorTree: task.indicatorTree,
    }, null, 2), `${basename}.json`, 'application/json;charset=utf-8');
    setFeedback('操作已更新', 'success');
    return;
  }

  const delimiter = format === 'tsv' ? '\t' : ',';
  const rows = buildTreeTableRows(task.indicatorTree);
  const columns = [
    'coreId',
    'coreCode',
    'coreName',
    'coreWeight',
    'coreDescription',
    'secondaryId',
    'secondaryCode',
    'secondaryName',
    'secondaryWeight',
    'secondaryDescription',
    'leafId',
    'leafCode',
    'leafName',
    'leafWeight',
    'leafUnit',
    'leafDescription',
  ];
  downloadTextFile(
    serializeDelimited(rows, columns, delimiter),
    `${basename}.${format === 'tsv' ? 'tsv' : 'csv'}`,
    'text/plain;charset=utf-8',
  );
  setFeedback('操作已更新', 'success');
}

function exportInputData(format) {
  const task = activeTask.value;
  if (!task) {
    return;
  }

  const basename = slugifyFilename(`${task.name || task.assessmentName}-weights-data`, 'capability-data');
  if (format === 'json') {
    downloadTextFile(JSON.stringify({
      type: 'capability-input-data',
      version: 1,
      exportedAt: nowIso(),
      taskId: task.id,
      taskName: task.name,
      indicatorTree: task.indicatorTree,
      schemes: task.schemes,
    }, null, 2), `${basename}.json`, 'application/json;charset=utf-8');
    setFeedback('操作已更新', 'success');
    return;
  }

  const delimiter = format === 'tsv' ? '\t' : ',';
  const rows = buildInputDataRows(task.indicatorTree, task.schemes);
  const columns = buildInputDataColumns(task.schemes);
  downloadTextFile(
    serializeDelimited(rows, columns, delimiter),
    `${basename}.${format === 'tsv' ? 'tsv' : 'csv'}`,
    'text/plain;charset=utf-8',
  );
  setFeedback('操作已更新', 'success');
}

function exportResults(format) {
  const task = activeTask.value;
  if (!task?.results) {
    setFeedback('请先生成评估结果再导出', 'warn');
    return;
  }

  const basename = slugifyFilename(`${task.name || task.assessmentName}-results`, 'capability-results');
  if (format === 'json') {
    downloadTextFile(JSON.stringify({
      type: 'capability-results',
      version: 1,
      exportedAt: nowIso(),
      taskId: task.id,
      taskName: task.name,
      generatedAt: task.results.generatedAt,
      results: task.results,
    }, null, 2), `${basename}.json`, 'application/json;charset=utf-8');
    setFeedback('操作已更新', 'success');
    return;
  }

  const delimiter = format === 'tsv' ? '\t' : ',';
  const rows = buildResultsRows(task.results);
  const columns = ['methodKey', 'methodLabel', 'level', 'schemeId', 'schemeName', 'coreId', 'coreName', 'rank', 'overallScore', 'score', 'grade', 'closeness'];
  downloadTextFile(
    serializeDelimited(rows, columns, delimiter),
    `${basename}.${format === 'tsv' ? 'tsv' : 'csv'}`,
    'text/plain;charset=utf-8',
  );
  setFeedback('操作已更新', 'success');
}

export function useCapabilityWorkflow() {
  return {
    state,
    currentUser,
    indicatorLibrary,
    activeTask,
    previewTree,
    hasIndicatorTree,
    hasLeafIndicators,
    activeScheme,
    currentTreeVersion,
    weightIssues,
    hasValidWeights,
    canEvaluate,
    availableCoreOptions,
    methodOptions,
    engineOptions,
    methodResults,
    visibleMethodTabs,
    selectedMethodMeta,
    selectedMethodResult,
    selectedSchemeResult,
    rankingRows,
    topScheme,
    resolvedTopScheme,
    selectedMethodLabels,
    activeSchemeStats,
    librarySummary,
    workflowSummary,
    methodInsight,
    summarizeScheme,
    formatScore,
    formatTimestamp,
    getSecondaryOptions,
    getLibrarySecondaryOptions,
    getLibraryLeafOptions,
    initializeCapabilityWorkflow,
    addCoreToLibrary,
    addSecondaryToLibrary,
    addLeafToLibrary,
    updateLibraryNodeField,
    removeLibraryIndicator,
    createBlankTask,
    createTaskFromTemplateId,
    duplicateTask,
    removeTask,
    setSelectedTask,
    resetTaskToTemplate,
    setAssessmentName,
    setTaskName,
    setTaskDescription,
    setSelectedEngine,
    setSelectedScheme,
    setSelectedMethod,
    toggleMethod,
    updateNodeWeight,
    updateNodeField,
    removeIndicator,
    canRemoveIndicator,
    saveTreeVersion,
    restoreTreeVersion,
    saveCurrentTreeAsTemplate,
    applyTemplateToTask,
    deleteTemplate,
    updateSchemeScore,
    updateSchemeField,
    clearIndicatorTree,
    isLibraryCoreSelected,
    isLibrarySecondarySelected,
    isLibraryLeafSelected,
    insertCoreFromLibrary,
    insertSecondaryFromLibrary,
    insertLeafFromLibrary,
    moveCoreNode,
    moveSecondaryNode,
    moveLeafNode,
    addCoreFromLibrary,
    addSecondaryFromLibrary,
    addLeafFromLibrary,
    calculateAssessment,
    importTreeFile,
    importInputDataFile,
    exportTree,
    exportInputData,
    exportResults,
    clearFeedback,
  };
}
