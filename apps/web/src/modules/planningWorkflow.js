
import { computed, reactive } from 'vue';
import { api } from '../api';
import { authState } from '../auth';

const RESULT_SNAPSHOTS_STORAGE_KEY = 'mission-planning-result-history';
const SELECTED_TASK_INSTANCE_STORAGE_KEY = 'mission-planning-selected-task-instance';
const PLANNING_LLM_CONFIG_STORAGE_KEY = 'mission-planning-llm-config';
const THREAT_LLM_METHOD_KEY = 'llm-analysis';
const RESULT_SNAPSHOT_LIMIT = 20;
const VALID_PLANNING_STAGES = ['library', 'flow', 'execute'];

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueList(list = []) {
  return [...new Set(safeArray(list).map((item) => String(item || '').trim()).filter(Boolean))];
}

function uniqueNumberList(list = []) {
  return [...new Set(safeArray(list).map((item) => Number(item)).filter((item) => Number.isFinite(item)))];
}

function normalizeStageKey(value, fallback = 'library') {
  const next = String(value || fallback).trim();
  return VALID_PLANNING_STAGES.includes(next) ? next : fallback;
}

function resolveStorageScope() {
  const userId = authState.user?.id;
  return userId === undefined || userId === null || userId === '' ? 'anonymous' : `user-${String(userId)}`;
}

function buildScopedStorageKey(baseKey) {
  return `${baseKey}:${resolveStorageScope()}`;
}

function readArrayFromStorage(storageKey) {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function readPersistedResultSnapshots() {
  if (typeof window === 'undefined') return [];
  try {
    return readArrayFromStorage(buildScopedStorageKey(RESULT_SNAPSHOTS_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persistResultSnapshots(entries = []) {
  if (typeof window === 'undefined') return;
  try {
    const key = buildScopedStorageKey(RESULT_SNAPSHOTS_STORAGE_KEY);
    if (!safeArray(entries).length) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(safeArray(entries).slice(0, RESULT_SNAPSHOT_LIMIT)));
  } catch {
    // ignore
  }
}

function readPersistedSelectedTaskInstanceId() {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem(buildScopedStorageKey(SELECTED_TASK_INSTANCE_STORAGE_KEY)) || '');
  } catch {
    return '';
  }
}

function persistSelectedTaskInstanceId(taskId = '') {
  if (typeof window === 'undefined') return;
  try {
    const key = buildScopedStorageKey(SELECTED_TASK_INSTANCE_STORAGE_KEY);
    if (!taskId) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, String(taskId));
  } catch {
    // ignore
  }
}

function createDefaultPlanningLlmConfig() {
  return {
    apiKey: '',
    baseUrl: '',
  };
}

function normalizePlanningLlmConfig(value = {}) {
  const current = safeObject(value);
  return {
    apiKey: String(current.apiKey || '').trim(),
    baseUrl: String(current.baseUrl || '').trim(),
  };
}

function readPersistedPlanningLlmConfig() {
  if (typeof window === 'undefined') return createDefaultPlanningLlmConfig();
  try {
    const raw = window.localStorage.getItem(buildScopedStorageKey(PLANNING_LLM_CONFIG_STORAGE_KEY));
    return normalizePlanningLlmConfig(raw ? JSON.parse(raw) : {});
  } catch {
    return createDefaultPlanningLlmConfig();
  }
}

function persistPlanningLlmConfig(config = {}) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      buildScopedStorageKey(PLANNING_LLM_CONFIG_STORAGE_KEY),
      JSON.stringify(normalizePlanningLlmConfig(config)),
    );
  } catch {
    // ignore
  }
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function createUploadedFilePayload(file, fileContentBase64) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: file.name,
    fileExtension: file.name.includes('.') ? `.${file.name.split('.').pop().toLowerCase()}` : '',
    size: Number(file.size || 0),
    fileContentBase64,
  };
}

const state = reactive({
  loading: false,
  calculating: false,
  initialized: false,
  initializingPromise: null,
  errorMessage: '',
  template: null,
  taskTemplates: [],
  taskInstances: [],
  selectedTaskInstanceId: null,
  selectedTaskId: '',
  planningStageKey: 'library',
  assessmentName: '智能任务规划任务',
  algorithmBindings: {},
  algorithmInputs: {},
  resources: { sources: [], intelligence: [], environment: [], extractions: [] },
  results: null,
  resultsDirty: true,
  activeResultRunId: null,
  runHistory: [],
  runHistoryLoading: false,
  selectedRunDetail: null,
  savedResultSnapshots: [],
  storageScope: '',
  executionProcessEvents: [],
  executionOutputEvents: [],
  activeExecutionStep: null,
  executionProgress: 0,
  planningLlmConfig: createDefaultPlanningLlmConfig(),
});

let persistTimer = null;

const currentUser = computed(() => authState.user || { username: '', role: 'user' });
const algorithmLibrary = computed(() => state.template?.algorithms || []);
const taskOptions = computed(() => state.taskTemplates || []);
const taskInstances = computed(() => state.taskInstances || []);
const selectedTaskInstance = computed(() => state.taskInstances.find((item) => Number(item.id) === Number(state.selectedTaskInstanceId)) || null);

function getAlgorithmById(algorithmId) {
  return algorithmLibrary.value.find((item) => item.id === algorithmId) || null;
}

function normalizePlanningVariantId(variantId = '') {
  return String(variantId || '');
}

function getVariant(algorithm, variantId) {
  const requestedId = normalizePlanningVariantId(variantId);
  return safeArray(algorithm?.variants).find((item) => item.id === requestedId)
    || safeArray(algorithm?.variants).find((item) => safeArray(item.legacyKeys).includes(variantId))
    || safeArray(algorithm?.variants)[0]
    || null;
}

function normalizeTaskTemplate(task = {}, origin = 'builtin') {
  const steps = safeArray(task.steps).map((step, index) => ({
    id: String(step.id || `${task.id || 'task'}-step-${index + 1}`),
    order: Number(step.order || index + 1),
    name: String(step.name || step.algorithmId || `步骤 ${index + 1}`),
    algorithmId: String(step.algorithmId || ''),
    objective: String(step.objective || ''),
    consumes: cloneData(step.consumes || []),
    produces: cloneData(step.produces || []),
  })).sort((a, b) => a.order - b.order).map((step, index) => ({ ...step, order: index + 1 }));

  return {
    id: String(task.id || ''),
    name: String(task.name || '未命名任务模板'),
    category: String(task.category || '任务模板'),
    description: String(task.description || ''),
    initialInputs: uniqueList(task.initialInputs || steps.flatMap((step) => step.consumes)),
    finalDeliverables: uniqueList(task.finalDeliverables || ['任务规划方案', '阶段产物汇总']),
    steps,
    defaultBindings: Object.fromEntries(Object.entries({
      ...Object.fromEntries(steps.map((step) => [step.id, `${step.algorithmId}:builtin`])),
      ...safeObject(task.defaultBindings),
    }).map(([stepId, variantId]) => [stepId, normalizePlanningVariantId(variantId)])),
    origin,
  };
}

function resolveTemplateTaskById(taskId) {
  return taskOptions.value.find((item) => item.id === String(taskId || '')) || taskOptions.value[0] || null;
}

function serializeTaskDefinition(task = {}) {
  return {
    id: String(task.id || ''),
    name: String(task.name || ''),
    category: String(task.category || ''),
    description: String(task.description || ''),
    initialInputs: cloneData(task.initialInputs || []),
    finalDeliverables: cloneData(task.finalDeliverables || []),
    steps: cloneData(task.steps || []),
    defaultBindings: cloneData(task.defaultBindings || {}),
  };
}

function buildDefaultAlgorithmInputs(template) {
  return Object.fromEntries(safeArray(template?.algorithms).map((algorithm) => [algorithm.id, cloneData(algorithm.defaultConfig || {
    builtinMethodKey: '',
    selectedSourceIds: [],
    uploadedFiles: [],
    options: {},
  })]));
}

function mergeAlgorithmInputsWithDefaults(rawInputs = {}) {
  const defaults = buildDefaultAlgorithmInputs(state.template);
  return Object.fromEntries(Object.entries(defaults).map(([algorithmId, defaultInput]) => {
    const current = safeObject(rawInputs[algorithmId]);
    return [algorithmId, {
      ...cloneData(defaultInput),
      ...cloneData(current),
      selectedSourceIds: uniqueNumberList(current.selectedSourceIds ?? defaultInput.selectedSourceIds ?? []),
      uploadedFiles: safeArray(current.uploadedFiles ?? defaultInput.uploadedFiles),
      options: { ...safeObject(defaultInput.options), ...safeObject(current.options) },
    }];
  }));
}
function buildBindingsForTask(task) {
  const bindings = {};
  for (const step of safeArray(task?.steps)) {
    const algorithm = getAlgorithmById(step.algorithmId);
    bindings[step.id] = task.defaultBindings?.[step.id] || algorithm?.defaultVariantId || `${step.algorithmId}:builtin`;
  }
  return bindings;
}

function normalizeBindingsForTask(task, rawBindings = {}) {
  const normalizedBindings = Object.fromEntries(
    Object.entries(safeObject(rawBindings)).map(([stepId, variantId]) => [
      stepId,
      normalizePlanningVariantId(variantId),
    ]),
  );
  return { ...buildBindingsForTask(task), ...normalizedBindings };
}

const selectedTask = computed(() => {
  if (selectedTaskInstance.value) {
    const persisted = safeObject(selectedTaskInstance.value.planningTaskDefinition);
    if (safeArray(persisted.steps).length) {
      return normalizeTaskTemplate(persisted, 'instance');
    }
    return normalizeTaskTemplate(resolveTemplateTaskById(selectedTaskInstance.value.planningTemplateId) || {}, 'builtin');
  }
  return resolveTemplateTaskById(state.selectedTaskId);
});

const orderedTaskSteps = computed(() => [...safeArray(selectedTask.value?.steps)].sort((a, b) => a.order - b.order));
const executionSteps = computed(() => state.results?.execution?.steps || []);
const executionSummary = computed(() => state.results?.execution?.summary || {
  completedSteps: 0,
  builtinSteps: 0,
  externalSteps: 0,
  implementedSteps: 0,
  placeholderSteps: 0,
});
const finalResult = computed(() => state.results?.result || null);
const resultOutputPackages = computed(() => state.results?.result?.outputPackages || {});
const resultsGeneratedAt = computed(() => state.results?.generatedAt || '');
const savedResultSnapshotCount = computed(() => safeArray(state.savedResultSnapshots).length);
const latestSavedResultSnapshot = computed(() => safeArray(state.savedResultSnapshots)[0] || null);
const sourceOptions = computed(() => state.resources.sources || []);
const intelligenceRecords = computed(() => state.resources.intelligence || []);
const environmentRecords = computed(() => state.resources.environment || []);
const extractionRecords = computed(() => state.resources.extractions || []);
const runHistory = computed(() => state.runHistory || []);
const executionProcessEvents = computed(() => state.executionProcessEvents || []);
const executionOutputEvents = computed(() => {
  if (safeArray(state.executionOutputEvents).length) {
    return state.executionOutputEvents;
  }

  return executionSteps.value.flatMap((step) => {
    const preview = safeArray(step.outputPreview).length ? step.outputPreview : [step.summary].filter(Boolean);
    return preview.map((message, index) => ({
      id: `${step.stepId || step.algorithm?.id || 'step'}-${index}`,
      emittedAt: resultsGeneratedAt.value || '',
      phase: 'result:preview',
      channel: 'output',
      level: step.structuredOutput?.implementationStatus === 'implemented' ? 'success' : 'warning',
      title: step.algorithm?.name || step.stepName || '算法输出',
      message,
      step: {
        order: step.order,
        stepId: step.stepId,
        stepName: step.stepName,
        algorithmId: step.algorithm?.id,
        algorithmName: step.algorithm?.name,
        bindingName: step.binding?.name,
      },
    }));
  });
});
const activeExecutionStep = computed(() => state.activeExecutionStep || null);
const planningLlmConfig = computed(() => state.planningLlmConfig || createDefaultPlanningLlmConfig());
const planningLlmConfigReady = computed(() => Boolean(
  String(planningLlmConfig.value.apiKey || '').trim()
  && String(planningLlmConfig.value.baseUrl || '').trim(),
));
const planningRequiresLlmConfig = computed(() => {
  const threatStep = orderedTaskSteps.value.find((step) => step.algorithmId === 'enemy-threat-analysis');
  if (!threatStep) return false;
  const algorithm = getAlgorithmById('enemy-threat-analysis');
  const requestedVariantId = normalizePlanningVariantId(
    state.algorithmBindings?.[threatStep.id]
    || selectedTask.value?.defaultBindings?.[threatStep.id]
    || algorithm?.defaultVariantId
    || '',
  );
  if (!requestedVariantId.endsWith(':builtin')) return false;
  return getAlgorithmInput('enemy-threat-analysis').builtinMethodKey === THREAT_LLM_METHOD_KEY;
});

const resourceSummary = computed(() => ({
  sourceCount: sourceOptions.value.length,
  intelligenceCount: intelligenceRecords.value.length,
  blueIntelligenceCount: intelligenceRecords.value.filter((item) => item.camp === 'blue').length,
  redIntelligenceCount: intelligenceRecords.value.filter((item) => item.camp === 'red').length,
  environmentCount: environmentRecords.value.length,
  extractionCount: extractionRecords.value.length,
}));

function getAlgorithmInput(algorithmId) {
  const algorithm = getAlgorithmById(algorithmId);
  const defaultConfig = cloneData(algorithm?.defaultConfig || {
    builtinMethodKey: '', selectedSourceIds: [], uploadedFiles: [], options: {},
  });
  const current = safeObject(state.algorithmInputs?.[algorithmId]);
  return {
    ...defaultConfig,
    ...current,
    selectedSourceIds: uniqueNumberList(current.selectedSourceIds ?? defaultConfig.selectedSourceIds ?? []),
    uploadedFiles: safeArray(current.uploadedFiles ?? defaultConfig.uploadedFiles),
    options: { ...safeObject(defaultConfig.options), ...safeObject(current.options) },
  };
}

const taskStepBindings = computed(() => orderedTaskSteps.value.map((step) => {
  const algorithm = getAlgorithmById(step.algorithmId);
  const requestedVariantId = normalizePlanningVariantId(state.algorithmBindings?.[step.id] || selectedTask.value?.defaultBindings?.[step.id] || algorithm?.defaultVariantId || '');
  const variant = getVariant(algorithm, requestedVariantId);
  const inputConfig = getAlgorithmInput(step.algorithmId);
  const builtinMethod = safeArray(algorithm?.builtinMethods).find((item) => item.key === inputConfig.builtinMethodKey)
    || safeArray(algorithm?.builtinMethods)[0] || null;
  return {
    step,
    algorithm,
    variant,
    variantId: variant?.id || requestedVariantId,
    requestedVariantId,
    variants: safeArray(algorithm?.variants),
    inputConfig,
    builtinMethod,
  };
}));

const workflowSummary = computed(() => ({
  algorithmCount: algorithmLibrary.value.length,
  taskCount: taskOptions.value.length,
  taskInstanceCount: taskInstances.value.length,
  stepCount: orderedTaskSteps.value.length,
  builtinVariantCount: algorithmLibrary.value.reduce((t, item) => t + safeArray(item.variants).filter((v) => v.type === 'builtin').length, 0),
  externalVariantCount: algorithmLibrary.value.reduce((t, item) => t + safeArray(item.variants).filter((v) => v.type === 'external-model').length, 0),
  implementedAlgorithmCount: algorithmLibrary.value.filter((item) => item.implementationStatus === 'implemented').length,
  activeBindingCount: taskStepBindings.value.filter((item) => item.variant?.status === 'active').length,
  runCount: state.runHistory.length,
}));

function clearError() {
  state.errorMessage = '';
}

function markResultsDirty() {
  state.resultsDirty = true;
}

function normalizeExecutionEvent(rawEvent = {}) {
  const step = safeObject(rawEvent.step);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: String(rawEvent.type || 'progress'),
    emittedAt: String(rawEvent.emittedAt || new Date().toISOString()),
    phase: String(rawEvent.phase || ''),
    channel: String(rawEvent.channel || 'process'),
    level: String(rawEvent.level || 'info'),
    title: String(rawEvent.title || ''),
    message: String(rawEvent.message || ''),
    progress: Number.isFinite(Number(rawEvent.progress)) ? Number(rawEvent.progress) : null,
    preview: safeArray(rawEvent.preview),
    step: Object.keys(step).length ? step : null,
    runId: rawEvent.runId || null,
  };
}

function resetExecutionWorkbench() {
  state.executionProcessEvents = [];
  state.executionOutputEvents = [];
  state.activeExecutionStep = null;
  state.executionProgress = 0;
}

function appendExecutionWorkbenchEvent(rawEvent = {}) {
  const event = normalizeExecutionEvent(rawEvent);
  const targetKey = event.channel === 'output' ? 'executionOutputEvents' : 'executionProcessEvents';
  state[targetKey] = [...safeArray(state[targetKey]), event].slice(-160);
  if (event.step) {
    state.activeExecutionStep = event.step;
  }
  if (event.progress !== null) {
    state.executionProgress = Math.max(0, Math.min(100, event.progress));
  }
}

function setPlanningLlmConfig(patch = {}) {
  state.planningLlmConfig = normalizePlanningLlmConfig({
    ...safeObject(state.planningLlmConfig),
    ...safeObject(patch),
  });
  persistPlanningLlmConfig(state.planningLlmConfig);
  clearError();
}

function formatPlanningError(error) {
  const type = String(error?.type || '').trim();
  const message = String(error?.message || '智能任务规划失败。');
  if (type === 'missing_data') return `缺少数据或输入配置：${message}`;
  if (type === 'missing_upstream') return `缺少上游步骤产物：${message}`;
  if (type === 'permission_denied') return `权限不足：${message}`;
  if (type === 'algorithm_failed') return `算法执行失败：${message}`;
  return message;
}

function applyTaskInstanceToState(instance) {
  if (!instance) {
    state.selectedTaskInstanceId = null;
    state.selectedTaskId = taskOptions.value[0]?.id || '';
    state.algorithmBindings = buildBindingsForTask(selectedTask.value || {});
    state.algorithmInputs = mergeAlgorithmInputsWithDefaults({});
    state.planningStageKey = 'library';
    state.results = null;
    state.resultsDirty = true;
    resetExecutionWorkbench();
    state.runHistory = [];
    state.activeResultRunId = null;
    state.selectedRunDetail = null;
    persistSelectedTaskInstanceId('');
    return;
  }

  state.selectedTaskInstanceId = Number(instance.id);
  state.selectedTaskId = String(instance.planningTemplateId || instance.planningTaskDefinition?.id || taskOptions.value[0]?.id || '');
  state.planningStageKey = normalizeStageKey(instance.planningStageKey, 'library');
  state.assessmentName = String(instance.planningAssessmentName || instance.name || selectedTask.value?.name || '智能任务规划任务');
  const task = selectedTask.value || resolveTemplateTaskById(state.selectedTaskId) || {};
  state.algorithmBindings = normalizeBindingsForTask(task, instance.planningBindings || {});
  state.algorithmInputs = mergeAlgorithmInputsWithDefaults(instance.planningAlgorithmInputs || {});
  state.results = null;
  state.resultsDirty = true;
  resetExecutionWorkbench();
  state.activeResultRunId = null;
  state.selectedRunDetail = null;
  persistSelectedTaskInstanceId(String(instance.id));
}

function upsertTaskInstance(task) {
  const list = safeArray(state.taskInstances);
  const index = list.findIndex((item) => Number(item.id) === Number(task.id));
  if (index >= 0) {
    const next = [...list];
    next[index] = task;
    state.taskInstances = next;
    return;
  }
  state.taskInstances = [task, ...list];
}

function taskInstanceHasDetail(task) {
  return Boolean(
    task
    && Object.prototype.hasOwnProperty.call(task, 'planningTaskDefinition')
    && Object.prototype.hasOwnProperty.call(task, 'planningBindings')
    && Object.prototype.hasOwnProperty.call(task, 'planningAlgorithmInputs'),
  );
}

async function ensureTaskInstanceDetail(task) {
  if (!task?.id || taskInstanceHasDetail(task)) {
    return task || null;
  }

  const detail = await api.getTask(task.id);
  const detailedTask = detail?.task || null;
  if (detailedTask) {
    upsertTaskInstance(detailedTask);
  }
  return detailedTask;
}

function removeTaskInstance(taskId) {
  state.taskInstances = safeArray(state.taskInstances).filter((item) => Number(item.id) !== Number(taskId));
}

async function loadPlanningTemplate() {
  const payload = await api.getPlanningTemplate();
  state.template = payload;
  state.taskTemplates = safeArray(payload.tasks).map((task) => normalizeTaskTemplate(task, 'builtin'));
  if (!state.selectedTaskId && state.taskTemplates.length) state.selectedTaskId = state.taskTemplates[0].id;
  if (!state.assessmentName) state.assessmentName = payload.title || '智能任务规划任务';
  state.algorithmInputs = Object.keys(state.algorithmInputs).length ? mergeAlgorithmInputsWithDefaults(state.algorithmInputs) : buildDefaultAlgorithmInputs(payload);
}

async function loadPlanningResources() {
  const [sources, intelligence, environment, extractions] = await Promise.all([
    api.getSources(), api.getIntelligence(), api.getEnvironment(), api.getExtractions(),
  ]);
  state.resources = { sources, intelligence, environment, extractions };
}

async function loadPlanningTaskInstances({ preserveSelection = true } = {}) {
  const response = await api.getTasks({ module: 'planning', mine: true });
  state.taskInstances = safeArray(response?.tasks);
  const preferred = preserveSelection ? (state.selectedTaskInstanceId || Number(readPersistedSelectedTaskInstanceId() || 0) || null) : null;
  const fallback = state.taskInstances[0] || null;
  let nextTask = preferred ? state.taskInstances.find((item) => Number(item.id) === Number(preferred)) || fallback : fallback;
  nextTask = await ensureTaskInstanceDetail(nextTask);
  applyTaskInstanceToState(nextTask);
  return state.taskInstances;
}
async function loadTaskRuns(taskId = state.selectedTaskInstanceId, limit = 30, offset = 0) {
  if (!taskId) {
    state.runHistory = [];
    return [];
  }

  state.runHistoryLoading = true;
  try {
    const response = await api.getTaskRuns(taskId, { limit, offset });
    state.runHistory = safeArray(response?.runs);
    return state.runHistory;
  } finally {
    state.runHistoryLoading = false;
  }
}

async function replayTaskRun(runId, { silent = false } = {}) {
  if (!state.selectedTaskInstanceId || !runId) {
    return null;
  }

  const detail = await api.getTaskRunDetail(state.selectedTaskInstanceId, runId);
  state.selectedRunDetail = detail;
  const resultPayload = detail?.result?.resultPayload;
  if (resultPayload && typeof resultPayload === 'object') {
    resetExecutionWorkbench();
    state.results = cloneData(resultPayload);
    state.resultsDirty = false;
    state.activeResultRunId = Number(runId);
    if (!silent) clearError();
    return state.results;
  }

  if (!silent) state.errorMessage = '该执行记录暂无可回放结果。';
  return null;
}

function buildTaskUpdatePayloadFromState() {
  const taskDefinition = serializeTaskDefinition(selectedTask.value || {});
  return {
    moduleKey: 'planning',
    name: selectedTaskInstance.value?.name || taskDefinition.name || `规划任务-${state.selectedTaskInstanceId}`,
    description: selectedTaskInstance.value?.description || taskDefinition.description || '',
    planningTemplateId: state.selectedTaskId || taskDefinition.id || selectedTaskInstance.value?.planningTemplateId || 'fire-strike-task',
    planningAssessmentName: state.assessmentName,
    planningStageKey: normalizeStageKey(state.planningStageKey, 'library'),
    planningTaskDefinition: taskDefinition,
    planningBindings: cloneData(state.algorithmBindings),
    planningAlgorithmInputs: cloneData(state.algorithmInputs),
  };
}

async function persistCurrentTaskConfig({ silent = false } = {}) {
  if (!state.selectedTaskInstanceId) return null;
  const response = await api.updateTask(state.selectedTaskInstanceId, buildTaskUpdatePayloadFromState());
  if (response?.task) upsertTaskInstance(response.task);
  if (!silent) clearError();
  return response?.task || null;
}

function queuePersistCurrentTaskConfig() {
  if (!state.selectedTaskInstanceId) return;
  if (persistTimer) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistTimer = window.setTimeout(async () => {
    try {
      await persistCurrentTaskConfig({ silent: true });
    } catch (error) {
      state.errorMessage = formatPlanningError(error);
    } finally {
      persistTimer = null;
    }
  }, 240);
}

async function initializePlanningWorkflow(force = false) {
  const nextScope = resolveStorageScope();
  const shouldForce = force || (state.initialized && state.storageScope && state.storageScope !== nextScope);
  if (state.initialized && !shouldForce) return;
  if (state.initializingPromise && !shouldForce) return state.initializingPromise;

  state.loading = true;
  clearError();
  state.storageScope = nextScope;
  state.savedResultSnapshots = readPersistedResultSnapshots();
  state.planningLlmConfig = readPersistedPlanningLlmConfig();

  state.initializingPromise = Promise.all([loadPlanningTemplate(), loadPlanningResources()])
    .then(() => loadPlanningTaskInstances({ preserveSelection: true }))
    .then(async () => {
      state.initialized = true;
      if (state.selectedTaskInstanceId) {
        await loadTaskRuns(state.selectedTaskInstanceId);
        const latestRun = state.runHistory[0];
        if (latestRun?.hasResult) await replayTaskRun(latestRun.id, { silent: true });
      }
    })
    .catch((error) => {
      state.errorMessage = formatPlanningError(error);
      throw error;
    })
    .finally(() => {
      state.loading = false;
      state.initializingPromise = null;
    });

  return state.initializingPromise;
}

async function createPlanningTaskInstance(templateId = state.selectedTaskId) {
  const templateTask = resolveTemplateTaskById(templateId);
  if (!templateTask) throw new Error('未找到可用任务模板，无法创建任务实例。');

  const response = await api.createTask({
    moduleKey: 'planning',
    status: 'draft',
    name: `${templateTask.name}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`,
    description: templateTask.description,
    planningTemplateId: templateTask.id,
    planningAssessmentName: `${templateTask.name}规划任务`,
    planningStageKey: 'library',
    planningTaskDefinition: serializeTaskDefinition(templateTask),
    planningBindings: buildBindingsForTask(templateTask),
    planningAlgorithmInputs: buildDefaultAlgorithmInputs(state.template),
  });

  if (!response?.task) throw new Error('创建规划任务实例失败。');
  upsertTaskInstance(response.task);
  applyTaskInstanceToState(response.task);
  await loadTaskRuns(response.task.id);
  clearError();
  return response.task;
}

async function selectTaskInstance(taskId, { loadLatestRun = true } = {}) {
  if (!taskId) {
    applyTaskInstanceToState(null);
    return null;
  }

  let task = state.taskInstances.find((item) => Number(item.id) === Number(taskId)) || null;
  task = await ensureTaskInstanceDetail(task);
  if (!task) {
    const detail = await api.getTask(taskId);
    task = detail?.task || null;
    if (!task) throw new Error('未找到指定规划任务实例。');
    upsertTaskInstance(task);
  }

  applyTaskInstanceToState(task);
  await loadTaskRuns(task.id);
  if (loadLatestRun) {
    const latest = state.runHistory[0];
    if (latest?.hasResult) await replayTaskRun(latest.id, { silent: true });
  }
  clearError();
  return task;
}

async function archiveTaskInstance(taskId = state.selectedTaskInstanceId) {
  if (!taskId) return;
  await api.archiveTask(taskId);
  removeTaskInstance(taskId);
  const fallback = await ensureTaskInstanceDetail(state.taskInstances[0] || null);
  applyTaskInstanceToState(fallback);
  if (fallback) await loadTaskRuns(fallback.id);
  clearError();
}

async function calculatePlanningAssessment() {
  if (!state.selectedTaskInstanceId) {
    const error = new Error('请先从模板创建任务实例，再执行规划。');
    error.type = 'missing_data';
    state.errorMessage = formatPlanningError(error);
    throw error;
  }

  state.calculating = true;
  resetExecutionWorkbench();
  clearError();

  try {
    await persistCurrentTaskConfig({ silent: true });
    const response = await api.evaluatePlanningStream(
      {
        taskCenterId: state.selectedTaskInstanceId,
        assessmentName: state.assessmentName,
        llmConfig: planningRequiresLlmConfig.value ? normalizePlanningLlmConfig(state.planningLlmConfig) : {},
      },
      { onEvent: appendExecutionWorkbenchEvent },
    );

    state.results = response;
    state.resultsDirty = false;
    state.activeResultRunId = Number(response?.runId || 0) || null;

    await loadPlanningTaskInstances({ preserveSelection: true });
    await loadTaskRuns(state.selectedTaskInstanceId);
    if (state.activeResultRunId) await replayTaskRun(state.activeResultRunId, { silent: true });
  } catch (error) {
    state.errorMessage = formatPlanningError(error);
    appendExecutionWorkbenchEvent({
      type: 'error',
      phase: 'client:error',
      channel: 'process',
      level: 'error',
      title: '执行请求失败',
      message: state.errorMessage,
      progress: state.executionProgress || 100,
    });
    throw error;
  } finally {
    state.calculating = false;
  }
}

function setPlanningStage(stageKey) {
  state.planningStageKey = normalizeStageKey(stageKey, state.planningStageKey);
  queuePersistCurrentTaskConfig();
}

function setAssessmentName(value) {
  state.assessmentName = String(value || '');
  markResultsDirty();
  queuePersistCurrentTaskConfig();
}

function setSelectedTask(taskId) {
  const templateTask = resolveTemplateTaskById(taskId);
  if (!templateTask) return;

  state.selectedTaskId = templateTask.id;
  if (!state.selectedTaskInstanceId) {
    state.algorithmBindings = buildBindingsForTask(templateTask);
    markResultsDirty();
    return;
  }

  const nextBindings = buildBindingsForTask(templateTask);
  state.algorithmBindings = nextBindings;
  state.assessmentName = `${templateTask.name}规划任务`;
  state.taskInstances = safeArray(state.taskInstances).map((item) => (
    Number(item.id) === Number(state.selectedTaskInstanceId)
      ? {
        ...item,
        planningTemplateId: templateTask.id,
        planningTaskDefinition: serializeTaskDefinition(templateTask),
        planningBindings: cloneData(nextBindings),
        planningAssessmentName: state.assessmentName,
      }
      : item
  ));

  markResultsDirty();
  queuePersistCurrentTaskConfig();
}

function updateAlgorithmInputState(algorithmId, nextValue) {
  state.algorithmInputs = { ...state.algorithmInputs, [algorithmId]: nextValue };
}
function setAlgorithmBinding(stepId, variantId) {
  state.algorithmBindings = { ...state.algorithmBindings, [stepId]: normalizePlanningVariantId(variantId) };
  markResultsDirty();
  clearError();
  queuePersistCurrentTaskConfig();
}

function setAlgorithmBuiltinMethod(algorithmId, builtinMethodKey) {
  const current = getAlgorithmInput(algorithmId);
  updateAlgorithmInputState(algorithmId, { ...current, builtinMethodKey });
  markResultsDirty();
  clearError();
  queuePersistCurrentTaskConfig();
}

function toggleAlgorithmSource(algorithmId, sourceId) {
  const current = getAlgorithmInput(algorithmId);
  const selectedSourceIds = new Set(current.selectedSourceIds || []);
  const nextSourceId = Number(sourceId);
  if (selectedSourceIds.has(nextSourceId)) selectedSourceIds.delete(nextSourceId);
  else selectedSourceIds.add(nextSourceId);
  updateAlgorithmInputState(algorithmId, { ...current, selectedSourceIds: [...selectedSourceIds] });
  markResultsDirty();
  clearError();
  queuePersistCurrentTaskConfig();
}

function updateAlgorithmOptions(algorithmId, patch = {}) {
  const current = getAlgorithmInput(algorithmId);
  updateAlgorithmInputState(algorithmId, {
    ...current,
    options: { ...safeObject(current.options), ...safeObject(patch) },
  });
  markResultsDirty();
  clearError();
  queuePersistCurrentTaskConfig();
}

function updateAlgorithmRuntimeOptions(algorithmId, runtimeKey, patch = {}) {
  const current = getAlgorithmInput(algorithmId);
  const options = safeObject(current.options);
  const runtimeOptions = safeObject(options.runtimeOptions);
  const key = String(runtimeKey || '').trim();
  if (!key) return;

  updateAlgorithmInputState(algorithmId, {
    ...current,
    options: {
      ...options,
      runtimeOptions: {
        ...runtimeOptions,
        [key]: {
          ...safeObject(runtimeOptions[key]),
          ...safeObject(patch),
        },
      },
    },
  });
  markResultsDirty();
  clearError();
  queuePersistCurrentTaskConfig();
}

async function addAlgorithmFiles(algorithmId, fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  try {
    const uploadedFiles = [];
    for (const file of files) {
      const buffer = await readFileAsArrayBuffer(file);
      uploadedFiles.push(createUploadedFilePayload(file, arrayBufferToBase64(buffer)));
    }

    const current = getAlgorithmInput(algorithmId);
    updateAlgorithmInputState(algorithmId, {
      ...current,
      uploadedFiles: [...safeArray(current.uploadedFiles), ...uploadedFiles],
    });

    markResultsDirty();
    clearError();
    queuePersistCurrentTaskConfig();
  } catch (error) {
    state.errorMessage = formatPlanningError(error);
    throw error;
  }
}

function removeAlgorithmFile(algorithmId, fileId) {
  const current = getAlgorithmInput(algorithmId);
  updateAlgorithmInputState(algorithmId, {
    ...current,
    uploadedFiles: safeArray(current.uploadedFiles).filter((item) => item.id !== fileId),
  });
  markResultsDirty();
  clearError();
  queuePersistCurrentTaskConfig();
}

function resolveOutputPackageContent(outputPackage = {}) {
  if (typeof outputPackage.contentBase64 === 'string' && outputPackage.contentBase64) {
    const binary = window.atob(outputPackage.contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  if (typeof outputPackage.content === 'string') {
    return outputPackage.mimeType?.includes('csv') ? `\uFEFF${outputPackage.content}` : outputPackage.content;
  }
  if (typeof outputPackage.data !== 'undefined') {
    return JSON.stringify(outputPackage.data, null, 2);
  }
  return '';
}

function triggerPackageDownload(outputPackage = {}) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([resolveOutputPackageContent(outputPackage)], { type: outputPackage.mimeType || 'application/octet-stream' });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = outputPackage.fileName || 'planning-output';
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function saveCurrentResultSnapshot() {
  const snapshotPackage = safeObject(resultOutputPackages.value.storageSnapshot);
  if (typeof snapshotPackage.data === 'undefined') {
    throw new Error('当前没有可保存的规划结果快照。');
  }

  const snapshotData = cloneData(snapshotPackage.data);
  const savedAt = new Date().toISOString();
  const entryId = `${snapshotData.generatedAt || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextEntries = [
    {
      id: entryId,
      assessmentName: snapshotData.assessmentName || state.assessmentName,
      taskName: snapshotData.task?.name || '',
      generatedAt: snapshotData.generatedAt || '',
      savedAt,
      data: snapshotData,
    },
    ...safeArray(state.savedResultSnapshots).filter((item) => item.generatedAt !== snapshotData.generatedAt),
  ].slice(0, RESULT_SNAPSHOT_LIMIT);

  state.savedResultSnapshots = nextEntries;
  persistResultSnapshots(nextEntries);
  clearError();
  return nextEntries[0];
}

function downloadResultPackage(packageKey) {
  const outputPackage = safeObject(resultOutputPackages.value[packageKey]);
  if (!outputPackage.fileName) {
    throw new Error('当前没有可导出的规划输出包。');
  }

  triggerPackageDownload(outputPackage);
  clearError();
}

function formatVariantType(type) {
  return type === 'external-model' ? '外部算法工程' : '内置算法';
}

function formatStatusLabel(status) {
  return status === 'active' ? '可用' : '预留';
}

function getAlgorithmUsageCount(algorithmId) {
  return taskOptions.value.reduce((total, task) => total + safeArray(task.steps).filter((step) => step.algorithmId === algorithmId).length, 0);
}

async function createTaskTemplate(payload = {}) {
  const templateId = payload.templateId || state.selectedTaskId || taskOptions.value[0]?.id;
  return createPlanningTaskInstance(templateId);
}

async function updateTaskTemplate(taskId, payload = {}) {
  if (!state.selectedTaskInstanceId) throw new Error('当前没有可更新的任务实例。');
  if (payload?.templateId) setSelectedTask(payload.templateId);
  await persistCurrentTaskConfig({ silent: false });
}

async function deleteTaskTemplate(taskId) {
  await archiveTaskInstance(taskId);
}

export function usePlanningWorkflow() {
  return {
    state,
    currentUser,
    algorithmLibrary,
    taskOptions,
    taskInstances,
    selectedTaskInstance,
    selectedTask,
    orderedTaskSteps,
    taskStepBindings,
    executionSteps,
    executionSummary,
    finalResult,
    resultOutputPackages,
    resultsGeneratedAt,
    savedResultSnapshotCount,
    latestSavedResultSnapshot,
    sourceOptions,
    intelligenceRecords,
    environmentRecords,
    extractionRecords,
    runHistory,
    executionProcessEvents,
    executionOutputEvents,
    activeExecutionStep,
    planningLlmConfig,
    planningLlmConfigReady,
    resourceSummary,
    workflowSummary,
    initializePlanningWorkflow,
    createPlanningTaskInstance,
    selectTaskInstance,
    archiveTaskInstance,
    loadTaskRuns,
    replayTaskRun,
    calculatePlanningAssessment,
    saveCurrentResultSnapshot,
    downloadResultPackage,
    setPlanningStage,
    setAssessmentName,
    setSelectedTask,
    createTaskTemplate,
    updateTaskTemplate,
    deleteTaskTemplate,
    setAlgorithmBinding,
    setAlgorithmBuiltinMethod,
    toggleAlgorithmSource,
    updateAlgorithmOptions,
    updateAlgorithmRuntimeOptions,
    setPlanningLlmConfig,
    addAlgorithmFiles,
    removeAlgorithmFile,
    getAlgorithmInput,
    formatVariantType,
    formatStatusLabel,
    getAlgorithmUsageCount,
  };
}
