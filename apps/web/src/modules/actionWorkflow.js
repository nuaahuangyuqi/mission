import { computed, reactive, watch } from 'vue';
import { api } from '../api';
import { authState } from '../auth';
import {
  mergeActionSchemesWithSharedTask,
  resolveSharedActionTaskId,
  useCalculationSharedTask,
} from './calculationSharedTask';

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safePositive(value, fallback = 1) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) {
    return fallback;
  }
  return next;
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

const RESOURCE_META = {
  attackHelicopters: { label: '攻击直升机', unit: '架', mode: 'platform' },
  transportHelicopters: { label: '运输直升机', unit: '架', mode: 'platform' },
  escortHelicopters: { label: '掩护直升机', unit: '架', mode: 'platform' },
  reconHelicopters: { label: '侦察直升机', unit: '架', mode: 'platform' },
  commandSeats: { label: '指挥席位', unit: '席', mode: 'platform' },
  medicalTeams: { label: '卫勤分组', unit: '组', mode: 'platform' },
  troops: { label: '突击兵力', unit: '人', mode: 'payload' },
  rockets: { label: '火箭弹', unit: '枚', mode: 'consumable' },
  missiles: { label: '导弹', unit: '枚', mode: 'consumable' },
  fuel: { label: '航油', unit: '升', mode: 'consumable' },
};

const ENVIRONMENT_META = [
  { key: 'weather', label: '天气系数', hint: '天气越复杂，飞行与协同成本越高。' },
  { key: 'threat', label: '威胁系数', hint: '敌防空与火力威胁上升时，时间与消耗会增加。' },
  { key: 'terrain', label: '地形系数', hint: '复杂地形会增加路径迂回与飞行负担。' },
  { key: 'coordination', label: '协同系数', hint: '协同越顺畅，关键节点执行越高效。' },
];

const {
  missionTask,
  missionTypeMeta,
  missionSignature,
  missionSyncSignature,
} = useCalculationSharedTask();

function formatResourceLabel(key) {
  const meta = RESOURCE_META[key];
  if (meta) {
    return meta.label;
  }
  return String(key || '').replace(/([A-Z])/g, ' $1').trim() || '未命名资源';
}

function normalizeResources(resourceMap = {}) {
  const normalized = {};
  const keys = new Set([...Object.keys(RESOURCE_META), ...Object.keys(resourceMap || {})]);
  for (const key of keys) {
    normalized[key] = Math.max(Number(resourceMap[key]) || 0, 0);
  }
  return normalized;
}

function ensureNodeAdjustments(nodes, source = {}) {
  const adjustments = {};
  for (const node of safeArray(nodes)) {
    const current = source?.[node.id] || {};
    adjustments[node.id] = {
      tempo: safePositive(current.tempo, 1),
      resource: safePositive(current.resource, 1),
      path: safePositive(current.path, 1),
    };
  }
  return adjustments;
}

function normalizeTask(task = {}) {
  return {
    id: String(task.id || ''),
    name: String(task.name || ''),
    description: String(task.description || ''),
    category: String(task.category || ''),
    initialInputs: cloneData(task.initialInputs || []),
    links: cloneData(task.links || []),
    nodes: cloneData(task.nodes || []),
  };
}

function normalizeScheme(task, scheme, index) {
  return {
    id: String(scheme?.id || `scheme-${index + 1}`),
    name: String(scheme?.name || `方案 ${index + 1}`),
    description: String(scheme?.description || ''),
    availableResources: normalizeResources(scheme?.availableResources || {}),
    environment: {
      weather: safePositive(scheme?.environment?.weather, 1),
      threat: safePositive(scheme?.environment?.threat, 1),
      terrain: safePositive(scheme?.environment?.terrain, 1),
      coordination: safePositive(scheme?.environment?.coordination, 1),
    },
    nodeAdjustments: ensureNodeAdjustments(task.nodes, scheme?.nodeAdjustments),
  };
}

function buildNodeMap(nodes) {
  return new Map(safeArray(nodes).map((node) => [String(node.id), node]));
}

function topologicalSort(nodes, links) {
  const nodeMap = buildNodeMap(nodes);
  const indegree = new Map();
  const adjacency = new Map();

  for (const node of safeArray(nodes)) {
    indegree.set(String(node.id), 0);
    adjacency.set(String(node.id), []);
  }

  const issues = [];
  for (const link of safeArray(links)) {
    const from = String(link.from || '');
    const to = String(link.to || '');
    if (!nodeMap.has(from) || !nodeMap.has(to)) {
      issues.push(`链路 ${link.id || `${from}-${to}`} 引用了不存在的节点。`);
      continue;
    }
    if (from === to) {
      issues.push(`节点 ${from} 存在自环链路。`);
      continue;
    }
    adjacency.get(from).push(to);
    indegree.set(to, (indegree.get(to) || 0) + 1);
  }

  const queue = safeArray(nodes)
    .filter((node) => (indegree.get(String(node.id)) || 0) === 0)
    .map((node) => String(node.id));
  const order = [];

  while (queue.length) {
    const currentId = queue.shift();
    order.push(nodeMap.get(currentId));
    for (const nextId of adjacency.get(currentId) || []) {
      indegree.set(nextId, (indegree.get(nextId) || 0) - 1);
      if ((indegree.get(nextId) || 0) === 0) {
        queue.push(nextId);
      }
    }
  }

  if (order.length !== safeArray(nodes).length) {
    issues.push('功能链存在环路或孤立节点，预览按当前节点顺序显示。');
    return {
      order: safeArray(nodes),
      issues,
    };
  }

  return {
    order,
    issues,
  };
}

function validateActionTask(task, scheme = null) {
  const nodes = safeArray(task?.nodes);
  const links = safeArray(task?.links);
  const issues = [];
  const warnings = [];
  const nodeChecks = [];

  const duplicateIds = new Set();
  const seenIds = new Set();
  for (const node of nodes) {
    if (seenIds.has(String(node.id))) {
      duplicateIds.add(String(node.id));
    }
    seenIds.add(String(node.id));
  }

  if (duplicateIds.size) {
    issues.push(`存在重复节点编号：${[...duplicateIds].join('、')}。`);
  }

  const topology = topologicalSort(nodes, links);
  issues.push(...topology.issues);

  const availableOutputs = new Set(safeArray(task?.initialInputs).map((item) => String(item)));
  const structuralDemand = {};

  for (const node of topology.order) {
    const inputs = safeArray(node.inputs).map((item) => String(item));
    const outputs = safeArray(node.outputs).map((item) => String(item));
    const constraints = safeArray(node.constraints).map((item) => String(item));
    const requirementEntries = Object.entries(node.resourceRequirements || {});
    const missingInputs = inputs.filter((item) => !availableOutputs.has(item));

    if (!inputs.length) {
      issues.push(`节点 ${node.name} 缺少输入定义。`);
    }
    if (!outputs.length) {
      issues.push(`节点 ${node.name} 缺少输出定义。`);
    }
    if (missingInputs.length) {
      issues.push(`节点 ${node.name} 缺少上游输出：${missingInputs.join('、')}。`);
    }
    if (!constraints.length) {
      warnings.push(`节点 ${node.name} 未设置约束条件。`);
    }
    if (!requirementEntries.length) {
      warnings.push(`节点 ${node.name} 未设置资源需求。`);
    }

    for (const output of outputs) {
      availableOutputs.add(output);
    }

    for (const [key, value] of requirementEntries) {
      const meta = RESOURCE_META[key];
      const amount = Math.max(Number(value) || 0, 0);
      if (!meta) {
        structuralDemand[key] = (structuralDemand[key] || 0) + amount;
        continue;
      }
      if (meta.mode === 'consumable') {
        structuralDemand[key] = (structuralDemand[key] || 0) + amount;
      } else {
        structuralDemand[key] = Math.max(structuralDemand[key] || 0, amount);
      }
    }

    nodeChecks.push({
      nodeId: node.id,
      nodeName: node.name,
      inputCount: inputs.length,
      outputCount: outputs.length,
      constraintCount: constraints.length,
      resourceKinds: requirementEntries.length,
      missingInputs,
      passed: !missingInputs.length && inputs.length > 0 && outputs.length > 0,
    });
  }

  const resourceChecks = Object.entries(structuralDemand).map(([key, required]) => {
    const available = scheme ? Math.max(Number(scheme.availableResources[key]) || 0, 0) : 0;
    const sufficient = scheme ? available >= required : true;
    if (scheme && !sufficient) {
      issues.push(`${formatResourceLabel(key)} 需求 ${required.toFixed(1)}，可用 ${available.toFixed(1)}。`);
    }
    return {
      key,
      label: formatResourceLabel(key),
      required: Number(required.toFixed(2)),
      available: Number(available.toFixed(2)),
      sufficient,
      unit: RESOURCE_META[key]?.unit || '',
    };
  });

  return {
    passed: issues.length === 0,
    issueCount: issues.length,
    warningCount: warnings.length,
    issues,
    warnings,
    nodeChecks,
    resourceChecks,
  };
}

function markSchemePreview(node, scheme) {
  const model = node.model || {};
  const adjustments = scheme?.nodeAdjustments?.[node.id] || { tempo: 1, resource: 1, path: 1 };
  const environment = scheme?.environment || {};
  const weather = safePositive(environment.weather, 1);
  const threat = safePositive(environment.threat, 1);
  const terrain = safePositive(environment.terrain, 1);
  const coordination = safePositive(environment.coordination, 1);
  const duration = safePositive(model.baseDuration, 1)
    * safePositive(adjustments.tempo, 1)
    * (1 + ((weather - 1) * safePositive(model.weatherImpact, 0.12)))
    * (1 + ((threat - 1) * safePositive(model.threatImpact, 0.1)))
    * (1 + ((terrain - 1) * safePositive(model.terrainImpact, 0.08)))
    * Math.max(0.72, 1 - ((coordination - 1) * safePositive(model.coordinationImpact, 0.12)));
  const distance = safePositive(model.baseDistance, 1)
    * safePositive(adjustments.path, 1)
    * (1 + ((terrain - 1) * 0.1))
    * (1 + ((threat - 1) * 0.05));

  return {
    duration: Number(duration.toFixed(2)),
    distance: Number(distance.toFixed(2)),
  };
}

function buildResourceFields(task, schemes) {
  const keys = new Set();

  for (const node of safeArray(task?.nodes)) {
    for (const key of Object.keys(node.resourceRequirements || {})) {
      keys.add(key);
    }
  }

  for (const scheme of safeArray(schemes)) {
    for (const key of Object.keys(scheme.availableResources || {})) {
      if ((scheme.availableResources[key] || 0) > 0) {
        keys.add(key);
      }
    }
  }

  const ordered = Object.keys(RESOURCE_META).filter((key) => keys.has(key));
  for (const key of keys) {
    if (!ordered.includes(key)) {
      ordered.push(key);
    }
  }

  return ordered.map((key) => ({
    key,
    label: formatResourceLabel(key),
    unit: RESOURCE_META[key]?.unit || '',
    mode: RESOURCE_META[key]?.mode || 'custom',
  }));
}

function summarizeSchemeResources(scheme) {
  const resources = scheme?.availableResources || {};
  return Object.entries(resources).reduce((summary, [key, value]) => {
    const amount = Math.max(Number(value) || 0, 0);
    if (amount <= 0) {
      return summary;
    }

    const mode = RESOURCE_META[key]?.mode || 'custom';
    if (mode === 'consumable') {
      return {
        ...summary,
        consumables: summary.consumables + amount,
      };
    }

    return {
      ...summary,
      platforms: summary.platforms + amount,
    };
  }, {
    platforms: 0,
    consumables: 0,
  });
}

const state = reactive({
  loading: false,
  calculating: false,
  initialized: false,
  initializingPromise: null,
  errorMessage: '',
  template: null,
  task: null,
  schemes: [],
  assessmentName: '作战行动评估任务',
  selectedTaskId: '',
  selectedSchemeId: '',
  selectedObjective: 'balanced',
  selectedEngine: 'builtin',
  results: null,
  resultsDirty: true,
});

const currentUser = computed(() => authState.user || { username: '', role: 'user' });
const taskOptions = computed(() => state.template?.tasks || []);
const objectiveOptions = computed(() => state.template?.objectives || []);
const engineOptions = computed(() => state.template?.engines || []);
const selectedTask = computed(() => state.task);
const activeScheme = computed(() => state.schemes.find((item) => item.id === state.selectedSchemeId) || state.schemes[0] || null);
const taskTopology = computed(() => topologicalSort(state.task?.nodes || [], state.task?.links || []));
const orderedNodes = computed(() => taskTopology.value.order || []);
const validationPreview = computed(() => validateActionTask(state.task || {}, activeScheme.value));
const resourceFields = computed(() => buildResourceFields(state.task, state.schemes));
const selectedObjectiveMeta = computed(() => objectiveOptions.value.find((item) => item.key === state.selectedObjective) || objectiveOptions.value[0] || null);
const selectedEngineMeta = computed(() => engineOptions.value.find((item) => item.key === state.selectedEngine) || engineOptions.value[0] || null);
const rankingRows = computed(() => state.results?.comparison?.ranking || []);
const recommendedScheme = computed(() => rankingRows.value[0] || null);
const selectedSchemeResult = computed(() => state.results?.schemes?.[state.selectedSchemeId] || null);
const resultsGeneratedAt = computed(() => state.results?.generatedAt || '');
const workflowSummary = computed(() => ({
  nodeCount: safeArray(state.task?.nodes).length,
  linkCount: safeArray(state.task?.links).length,
  schemeCount: state.schemes.length,
  initialInputCount: safeArray(state.task?.initialInputs).length,
  resourceCount: resourceFields.value.length,
}));
const activeSchemeSummary = computed(() => {
  const scheme = activeScheme.value;
  const preview = orderedNodes.value.reduce((summary, node) => {
    const nodePreview = markSchemePreview(node, scheme);
    return {
      time: summary.time + nodePreview.duration,
      path: summary.path + nodePreview.distance,
    };
  }, { time: 0, path: 0 });
  const resources = summarizeSchemeResources(scheme);

  return {
    totalTime: Number(preview.time.toFixed(2)),
    totalPath: Number(preview.path.toFixed(2)),
    platforms: resources.platforms,
    consumables: resources.consumables,
  };
});

function clearError() {
  state.errorMessage = '';
}

function markResultsDirty() {
  state.resultsDirty = true;
}

function applySelectedTask(taskId) {
  const resolvedTaskId = taskId || resolveSharedActionTaskId(missionTask.value);
  const source = taskOptions.value.find((item) => item.id === resolvedTaskId) || taskOptions.value[0];
  if (!source) {
    state.task = null;
    state.schemes = [];
    state.selectedTaskId = '';
    state.selectedSchemeId = '';
    state.results = null;
    state.resultsDirty = true;
    return;
  }

  const task = normalizeTask(source);
  state.task = task;
  state.selectedTaskId = task.id;
  const missionDrivenSchemes = mergeActionSchemesWithSharedTask(source, state.schemes);
  state.schemes = safeArray(missionDrivenSchemes).map((scheme, index) => normalizeScheme(task, scheme, index));
  state.selectedSchemeId = state.schemes.find((item) => item.id === state.selectedSchemeId)?.id || state.schemes[0]?.id || '';
  state.results = null;
  state.resultsDirty = true;
}

function hydrateTemplate(payload) {
  state.template = payload;
  state.selectedEngine = payload.engines?.find((item) => item.status === 'active')?.key || payload.engines?.[0]?.key || 'builtin';
  state.selectedObjective = payload.objectives?.[0]?.key || 'balanced';
  if (!state.assessmentName || state.assessmentName === '作战行动评估任务') {
    state.assessmentName = payload.title || '作战行动评估任务';
  }
  state.assessmentName = `${missionTask.value.name} 行动评估`;
  applySelectedTask(resolveSharedActionTaskId(missionTask.value) || payload.tasks?.[0]?.id || '');
}

async function loadActionTemplate() {
  const payload = await api.getActionTemplate();
  hydrateTemplate(payload);
  state.initialized = true;
}

async function initializeActionWorkflow(force = false) {
  if (state.initialized && !force) {
    return;
  }

  if (state.initializingPromise && !force) {
    return state.initializingPromise;
  }

  state.loading = true;
  clearError();
  state.initializingPromise = loadActionTemplate()
    .catch((error) => {
      state.errorMessage = error.message || '作战行动模块初始化失败。';
      throw error;
    })
    .finally(() => {
      state.loading = false;
      state.initializingPromise = null;
    });

  return state.initializingPromise;
}

async function calculateActionAssessment() {
  state.calculating = true;
  clearError();

  try {
    state.results = await api.evaluateAction({
      assessmentName: state.assessmentName.trim() || '作战行动评估任务',
      engine: state.selectedEngine,
      objective: state.selectedObjective,
      missionContext: cloneData(missionTask.value),
      taskId: state.selectedTaskId,
      task: state.task ? {
        ...cloneData(state.task),
        defaultSchemes: [],
      } : null,
      schemes: cloneData(state.schemes),
    });
    state.resultsDirty = false;
  } catch (error) {
    state.errorMessage = error.message || '作战行动评估计算失败。';
    throw error;
  } finally {
    state.calculating = false;
  }
}

function resetCurrentTask() {
  applySelectedTask(state.selectedTaskId);
  clearError();
}

function setAssessmentName(value) {
  state.assessmentName = value;
  markResultsDirty();
}

function setSelectedTask(taskId) {
  applySelectedTask(taskId);
  clearError();
}

function setSelectedScheme(schemeId) {
  state.selectedSchemeId = schemeId;
}

function setSelectedObjective(value) {
  state.selectedObjective = value;
  markResultsDirty();
}

function setSelectedEngine(value) {
  state.selectedEngine = value;
  markResultsDirty();
}

function updateSchemeField(schemeId, field, value) {
  const scheme = state.schemes.find((item) => item.id === schemeId);
  if (!scheme) return;
  scheme[field] = value;
  markResultsDirty();
}

function updateEnvironmentFactor(schemeId, factor, value) {
  const scheme = state.schemes.find((item) => item.id === schemeId);
  if (!scheme) return;
  scheme.environment[factor] = clamp(safePositive(value, 1), 0.5, 2);
  markResultsDirty();
}

function updateAvailableResource(schemeId, resourceKey, value) {
  const scheme = state.schemes.find((item) => item.id === schemeId);
  if (!scheme) return;
  scheme.availableResources[resourceKey] = Math.max(Number(value) || 0, 0);
  markResultsDirty();
}

function updateNodeAdjustment(schemeId, nodeId, field, value) {
  const scheme = state.schemes.find((item) => item.id === schemeId);
  if (!scheme) return;
  if (!scheme.nodeAdjustments[nodeId]) {
    scheme.nodeAdjustments[nodeId] = { tempo: 1, resource: 1, path: 1 };
  }
  scheme.nodeAdjustments[nodeId][field] = clamp(safePositive(value, 1), 0.5, 1.8);
  markResultsDirty();
}

function formatScore(value, digits = 1) {
  return Number(value || 0).toFixed(digits);
}

watch(missionSignature, () => {
  if (!state.template) {
    return;
  }

  state.assessmentName = `${missionTask.value.name} 行动评估`;
  markResultsDirty();
  clearError();
});

watch(missionSyncSignature, () => {
  if (!state.template) {
    return;
  }

  applySelectedTask(resolveSharedActionTaskId(missionTask.value));
  clearError();
});

export function useActionWorkflow() {
  return {
    state,
    currentUser,
    missionTask,
    missionTypeMeta,
    taskOptions,
    objectiveOptions,
    engineOptions,
    selectedTask,
    activeScheme,
    taskTopology,
    orderedNodes,
    validationPreview,
    resourceFields,
    selectedObjectiveMeta,
    selectedEngineMeta,
    rankingRows,
    recommendedScheme,
    selectedSchemeResult,
    resultsGeneratedAt,
    workflowSummary,
    activeSchemeSummary,
    environmentMeta: ENVIRONMENT_META,
    initializeActionWorkflow,
    calculateActionAssessment,
    resetCurrentTask,
    setAssessmentName,
    setSelectedTask,
    setSelectedScheme,
    setSelectedObjective,
    setSelectedEngine,
    updateSchemeField,
    updateEnvironmentFactor,
    updateAvailableResource,
    updateNodeAdjustment,
    formatResourceLabel,
    formatScore,
  };
}
