
import { computed, reactive } from 'vue';
import { api } from '../api';
import { authState } from '../auth';

const RESULT_SNAPSHOTS_STORAGE_KEY = 'mission-planning-result-history';
const SELECTED_TASK_INSTANCE_STORAGE_KEY = 'mission-planning-selected-task-instance';
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

function createExecutionStreamState() {
  return {
    active: false,
    done: false,
    cancelRequested: false,
    terminated: false,
    progress: 0,
    currentStepId: '',
    currentStepName: '',
    currentEvent: '',
    runId: null,
    taskCenterId: null,
    terminalLines: [],
    llmChunks: [],
    stepStates: [],
    events: [],
    errorMessage: '',
  };
}

function createStepExecutionState() {
  return {
    activeView: 'config',
    selectedAlgorithmId: '',
    selectedBindingId: '',
    inputResultRefsByAlgorithm: {},
    upstreamResults: [],
    upstreamResultsLoading: false,
    upstreamQuery: '',
    currentArtifact: null,
    selectedArtifact: null,
    latestResult: null,
    calculating: false,
    executionStream: createExecutionStreamState(),
    errorMessage: '',
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
  executionStream: createExecutionStreamState(),
  stepExecution: createStepExecutionState(),
});

let persistTimer = null;
let planningExecutionAbortController = null;
let stepExecutionAbortController = null;

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
const stepExecutionSelectedAlgorithm = computed(() => (
  getAlgorithmById(state.stepExecution.selectedAlgorithmId) || algorithmLibrary.value[0] || null
));
const stepExecutionSelectedStep = computed(() => {
  const algorithmId = stepExecutionSelectedAlgorithm.value?.id || '';
  return orderedTaskSteps.value.find((step) => step.algorithmId === algorithmId) || {
    id: algorithmId ? `realtime-${algorithmId}` : '',
    order: 1,
    name: stepExecutionSelectedAlgorithm.value?.name || '分步执行算法',
    algorithmId,
    objective: stepExecutionSelectedAlgorithm.value?.description || '',
    consumes: cloneData(stepExecutionSelectedAlgorithm.value?.expectedInputs || []),
    produces: cloneData(stepExecutionSelectedAlgorithm.value?.expectedOutputs || []),
  };
});
const stepExecutionSelectedVariant = computed(() => {
  const algorithm = stepExecutionSelectedAlgorithm.value;
  const step = stepExecutionSelectedStep.value;
  if (!algorithm) return null;
  const variantId = state.stepExecution.selectedBindingId
    || (step?.id ? state.algorithmBindings?.[step.id] : '')
    || algorithm.defaultVariantId
    || `${algorithm.id}:builtin`;
  return getVariant(algorithm, variantId);
});
const stepExecutionRequiredUpstreamIds = computed(() => {
  const algorithmId = stepExecutionSelectedAlgorithm.value?.id || '';
  const algorithm = stepExecutionSelectedAlgorithm.value || {};
  const required = new Set(safeArray(algorithm.requiredUpstreamAlgorithmIds));
  const previousAlgorithmIds = orderedTaskSteps.value
    .filter((step) => Number(step.order || 0) < Number(stepExecutionSelectedStep.value?.order || 0))
    .map((step) => step.algorithmId);
  if (algorithmId === 'support-planning' && previousAlgorithmIds.includes('airborne-landing-site-selection')) {
    required.add('airborne-landing-site-selection');
  }
  return [...required];
});
const stepExecutionOptionalUpstreamIds = computed(() => {
  const algorithm = stepExecutionSelectedAlgorithm.value || {};
  const required = new Set(stepExecutionRequiredUpstreamIds.value);
  return safeArray(algorithm.optionalUpstreamAlgorithmIds).filter((item) => !required.has(item));
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

function formatPlanningError(error) {
  const type = String(error?.type || '').trim();
  const message = String(error?.message || '智能任务规划失败。');
  if (type === 'missing_data') return `缺少数据或输入配置：${message}`;
  if (type === 'missing_upstream') return `缺少上游步骤产物：${message}`;
  if (type === 'permission_denied') return `权限不足：${message}`;
  if (type === 'algorithm_failed') return `算法执行失败：${message}`;
  return message;
}

function resetExecutionStream() {
  state.executionStream = createExecutionStreamState();
}

function resetStepExecutionStream() {
  state.stepExecution.executionStream = createExecutionStreamState();
}

function isAbortError(error) {
  return error?.name === 'AbortError'
    || error?.code === 'ABORT_ERR'
    || String(error?.message || '').toLowerCase().includes('abort');
}

function markPlanningExecutionTerminated(message = '规划任务已终止。') {
  state.executionStream.active = false;
  state.executionStream.done = true;
  state.executionStream.cancelRequested = true;
  state.executionStream.terminated = true;
  state.executionStream.errorMessage = message;
  state.errorMessage = message;
  appendTerminalLine({
    stream: 'system',
    message,
    timestamp: new Date().toISOString(),
  });
}

function pushExecutionEvent(eventType, payload = {}) {
  const entry = {
    type: eventType,
    timestamp: payload.timestamp || new Date().toISOString(),
    message: payload.message || payload.summary || '',
  };
  state.executionStream.events = [...state.executionStream.events, entry].slice(-120);
  state.executionStream.currentEvent = eventType;
}

function updateStreamStep(stepId, patch = {}) {
  const normalizedStepId = String(stepId || patch.stepId || '');
  if (!normalizedStepId) return;
  const list = [...safeArray(state.executionStream.stepStates)];
  const index = list.findIndex((item) => item.stepId === normalizedStepId);
  const next = {
    ...(index >= 0 ? list[index] : {}),
    stepId: normalizedStepId,
    stepName: patch.stepName || (index >= 0 ? list[index].stepName : ''),
    algorithmId: patch.algorithmId || (index >= 0 ? list[index].algorithmId : ''),
    bindingName: patch.bindingName || (index >= 0 ? list[index].bindingName : ''),
    order: patch.order ?? (index >= 0 ? list[index].order : list.length + 1),
    status: patch.status || (index >= 0 ? list[index].status : 'pending'),
    summary: patch.summary || (index >= 0 ? list[index].summary : ''),
    durationMs: patch.durationMs ?? (index >= 0 ? list[index].durationMs : null),
  };
  if (index >= 0) {
    list[index] = next;
  } else {
    list.push(next);
  }
  state.executionStream.stepStates = list.sort((left, right) => {
    const leftOrder = Number(left.order || 0);
    const rightOrder = Number(right.order || 0);
    return leftOrder - rightOrder;
  });
}

function appendTerminalLineToStream(streamState, payload = {}) {
  const rawMessage = String(payload.message || payload.raw || '').trimEnd();
  if (!rawMessage) return;
  const lines = rawMessage.split(/\r?\n/).filter(Boolean).map((line) => ({
    timestamp: payload.timestamp || new Date().toISOString(),
    stepName: payload.stepName || streamState.currentStepName || '',
    stream: payload.stream || 'terminal',
    message: line,
  }));
  streamState.terminalLines = [...safeArray(streamState.terminalLines), ...lines].slice(-320);
}

function appendTerminalLine(payload = {}) {
  appendTerminalLineToStream(state.executionStream, payload);
}

function appendLlmChunkToStream(streamState, payload = {}) {
  const content = String(payload.content || payload.raw || '');
  if (!content) return;
  let chunks = [...safeArray(streamState.llmChunks), {
    timestamp: payload.timestamp || new Date().toISOString(),
    stepName: payload.stepName || streamState.currentStepName || '',
    content,
  }];
  while (chunks.reduce((total, item) => total + String(item.content || '').length, 0) > 16000) {
    chunks = chunks.slice(1);
  }
  streamState.llmChunks = chunks;
}

function appendLlmChunk(payload = {}) {
  appendLlmChunkToStream(state.executionStream, payload);
}

function handlePlanningStreamEvent(eventType, payload = {}) {
  pushExecutionEvent(eventType, payload);
  if (payload.runId) state.executionStream.runId = Number(payload.runId);
  if (payload.taskCenterId) state.executionStream.taskCenterId = Number(payload.taskCenterId);

  if (eventType === 'run-start') {
    state.executionStream.active = true;
    state.executionStream.done = false;
    state.executionStream.currentEvent = payload.phase || eventType;
    state.executionStream.progress = Math.max(state.executionStream.progress, 1);
    appendTerminalLine({ ...payload, stream: 'system', message: payload.phase === 'created' ? '规划执行记录已创建。' : '规划流式执行已启动。' });
    return;
  }

  if (eventType === 'validation') {
    state.executionStream.active = true;
    state.executionStream.progress = payload.status === 'succeeded' ? Math.max(state.executionStream.progress, 6) : Math.max(state.executionStream.progress, 3);
    appendTerminalLine({ ...payload, stream: 'system', message: payload.message || '规划前置校验更新。' });
    return;
  }

  if (eventType === 'step-start') {
    state.executionStream.active = true;
    state.executionStream.currentStepId = payload.stepId || '';
    state.executionStream.currentStepName = payload.stepName || '';
    updateStreamStep(payload.stepId, { ...payload, status: 'running' });
    appendTerminalLine({ ...payload, stream: 'system', message: `开始执行：${payload.stepName || payload.algorithmName || '规划步骤'}` });
    return;
  }

  if (eventType === 'progress') {
    state.executionStream.progress = Math.max(0, Math.min(100, Number(payload.progress || state.executionStream.progress)));
    state.executionStream.currentStepId = payload.currentStepId || state.executionStream.currentStepId;
    state.executionStream.currentStepName = payload.currentStepName || state.executionStream.currentStepName;
    return;
  }

  if (eventType === 'terminal') {
    appendTerminalLine(payload);
    return;
  }

  if (eventType === 'llm-chunk') {
    appendLlmChunk(payload);
    return;
  }

  if (eventType === 'step-complete') {
    state.executionStream.progress = Math.max(state.executionStream.progress, Number(payload.progress || 0));
    updateStreamStep(payload.stepId, { ...payload, status: 'completed' });
    appendTerminalLine({ ...payload, stream: 'system', message: `完成步骤：${payload.stepName || '规划步骤'}。${payload.summary || ''}` });
    return;
  }

  if (eventType === 'final') {
    state.results = payload;
    state.resultsDirty = false;
    state.activeResultRunId = Number(payload?.runId || 0) || null;
    state.executionStream.progress = 100;
    appendTerminalLine({ ...payload, stream: 'system', message: '规划结果已生成并归档。' });
    return;
  }

  if (eventType === 'error') {
    state.executionStream.errorMessage = payload.message || '规划执行失败。';
    if (payload.stepId) updateStreamStep(payload.stepId, { ...payload, status: 'failed', summary: payload.message || '' });
    appendTerminalLine({ ...payload, stream: 'error', message: payload.message || '规划执行失败。' });
    return;
  }

  if (eventType === 'done') {
    state.executionStream.active = false;
    state.executionStream.done = true;
    if (payload.status === 'succeeded') state.executionStream.progress = 100;
  }
}

function pushStepExecutionEvent(eventType, payload = {}) {
  const streamState = state.stepExecution.executionStream;
  const entry = {
    type: eventType,
    timestamp: payload.timestamp || new Date().toISOString(),
    message: payload.message || payload.summary || '',
  };
  streamState.events = [...safeArray(streamState.events), entry].slice(-120);
  streamState.currentEvent = eventType;
}

function updateStepExecutionStreamStep(stepId, patch = {}) {
  const streamState = state.stepExecution.executionStream;
  const normalizedStepId = String(stepId || patch.stepId || '');
  if (!normalizedStepId) return;
  const list = [...safeArray(streamState.stepStates)];
  const index = list.findIndex((item) => item.stepId === normalizedStepId);
  const next = {
    ...(index >= 0 ? list[index] : {}),
    stepId: normalizedStepId,
    stepName: patch.stepName || (index >= 0 ? list[index].stepName : ''),
    algorithmId: patch.algorithmId || (index >= 0 ? list[index].algorithmId : ''),
    bindingName: patch.bindingName || (index >= 0 ? list[index].bindingName : ''),
    order: patch.order ?? (index >= 0 ? list[index].order : list.length + 1),
    status: patch.status || (index >= 0 ? list[index].status : 'pending'),
    summary: patch.summary || (index >= 0 ? list[index].summary : ''),
    durationMs: patch.durationMs ?? (index >= 0 ? list[index].durationMs : null),
  };
  if (index >= 0) list[index] = next;
  else list.push(next);
  streamState.stepStates = list.sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
}

function handleStepExecutionStreamEvent(eventType, payload = {}) {
  const streamState = state.stepExecution.executionStream;
  pushStepExecutionEvent(eventType, payload);
  if (payload.runId) streamState.runId = Number(payload.runId);
  if (payload.taskCenterId) streamState.taskCenterId = Number(payload.taskCenterId);

  if (eventType === 'run-start') {
    streamState.active = true;
    streamState.done = false;
    streamState.currentEvent = payload.phase || eventType;
    streamState.progress = Math.max(streamState.progress, 1);
    appendTerminalLineToStream(streamState, { ...payload, stream: 'system', message: payload.realtime ? '分步执行流已启动。' : '规划流式执行已启动。' });
    return;
  }

  if (eventType === 'step-start') {
    streamState.active = true;
    streamState.currentStepId = payload.stepId || '';
    streamState.currentStepName = payload.stepName || '';
    updateStepExecutionStreamStep(payload.stepId, { ...payload, status: 'running' });
    appendTerminalLineToStream(streamState, { ...payload, stream: 'system', message: `开始执行：${payload.stepName || payload.algorithmName || '规划步骤'}` });
    return;
  }

  if (eventType === 'progress') {
    streamState.progress = Math.max(0, Math.min(100, Number(payload.progress || streamState.progress)));
    streamState.currentStepId = payload.currentStepId || streamState.currentStepId;
    streamState.currentStepName = payload.currentStepName || streamState.currentStepName;
    return;
  }

  if (eventType === 'terminal') {
    appendTerminalLineToStream(streamState, payload);
    return;
  }

  if (eventType === 'llm-chunk') {
    appendLlmChunkToStream(streamState, payload);
    return;
  }

  if (eventType === 'step-complete') {
    streamState.progress = Math.max(streamState.progress, Number(payload.progress || 0));
    updateStepExecutionStreamStep(payload.stepId, { ...payload, status: 'completed' });
    appendTerminalLineToStream(streamState, { ...payload, stream: 'system', message: `完成步骤：${payload.stepName || '规划步骤'}。${payload.summary || ''}` });
    return;
  }

  if (eventType === 'final') {
    state.stepExecution.latestResult = payload.result || null;
    state.stepExecution.currentArtifact = payload.artifact || null;
    state.stepExecution.selectedArtifact = payload.artifact || null;
    streamState.progress = 100;
    appendTerminalLineToStream(streamState, { ...payload, stream: 'system', message: '分步执行结果已生成并归档。' });
    return;
  }

  if (eventType === 'error') {
    streamState.errorMessage = payload.message || '分步执行失败。';
    state.stepExecution.errorMessage = streamState.errorMessage;
    if (payload.stepId) updateStepExecutionStreamStep(payload.stepId, { ...payload, status: 'failed', summary: payload.message || '' });
    appendTerminalLineToStream(streamState, { ...payload, stream: 'error', message: payload.message || '分步执行失败。' });
    return;
  }

  if (eventType === 'done') {
    streamState.active = false;
    streamState.done = true;
    if (payload.status === 'succeeded') streamState.progress = 100;
  }
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
    state.runHistory = [];
    state.activeResultRunId = null;
    state.selectedRunDetail = null;
    resetExecutionStream();
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
  state.activeResultRunId = null;
  state.selectedRunDetail = null;
  resetExecutionStream();
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
  if (!state.stepExecution.selectedAlgorithmId && safeArray(payload.algorithms).length) {
    state.stepExecution.selectedAlgorithmId = payload.algorithms[0].id;
  }
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
  clearError();
  resetExecutionStream();
  planningExecutionAbortController = new AbortController();

  try {
    await persistCurrentTaskConfig({ silent: true });
    const response = await api.evaluatePlanningStream(
      { taskCenterId: state.selectedTaskInstanceId, assessmentName: state.assessmentName },
      {
        onEvent: handlePlanningStreamEvent,
        signal: planningExecutionAbortController.signal,
      },
    );
    if (!response) {
      const streamError = new Error(state.executionStream.errorMessage || '规划执行流未返回最终结果。');
      streamError.type = 'algorithm_failed';
      throw streamError;
    }

    state.results = response;
    state.resultsDirty = false;
    state.activeResultRunId = Number(response?.runId || 0) || null;

    await loadPlanningTaskInstances({ preserveSelection: true });
    await loadTaskRuns(state.selectedTaskInstanceId);
    if (state.activeResultRunId) await replayTaskRun(state.activeResultRunId, { silent: true });
  } catch (error) {
    if (state.executionStream.cancelRequested || isAbortError(error)) {
      markPlanningExecutionTerminated();
      if (state.selectedTaskInstanceId) {
        window.setTimeout(() => {
          loadTaskRuns(state.selectedTaskInstanceId).catch(() => {});
        }, 600);
      }
      return null;
    }
    state.executionStream.active = false;
    state.executionStream.done = true;
    state.executionStream.errorMessage = state.executionStream.errorMessage || error.message || '规划执行失败。';
    state.errorMessage = formatPlanningError(error);
    throw error;
  } finally {
    planningExecutionAbortController = null;
    state.calculating = false;
  }
}

function terminatePlanningExecution() {
  if (!state.calculating && !state.executionStream.active) return;
  state.executionStream.cancelRequested = true;
  if (planningExecutionAbortController) {
    planningExecutionAbortController.abort();
  }
  markPlanningExecutionTerminated();
}

function setStepExecutionView(view = 'config') {
  state.stepExecution.activeView = view === 'run' ? 'run' : 'config';
}

function setStepExecutionAlgorithm(algorithmId) {
  const algorithm = getAlgorithmById(algorithmId);
  if (!algorithm) return;
  state.stepExecution.selectedAlgorithmId = algorithm.id;
  state.stepExecution.selectedBindingId = '';
  state.stepExecution.inputResultRefsByAlgorithm = {};
  state.stepExecution.latestResult = null;
  state.stepExecution.currentArtifact = null;
  state.stepExecution.selectedArtifact = null;
  state.stepExecution.errorMessage = '';
  resetStepExecutionStream();
}

function setStepExecutionBinding(variantId) {
  state.stepExecution.selectedBindingId = normalizePlanningVariantId(variantId);
  state.stepExecution.errorMessage = '';
}

function setStepExecutionUpstreamQuery(value) {
  state.stepExecution.upstreamQuery = String(value || '');
}

function selectStepExecutionInputResult(upstreamAlgorithmId, resultRef = null) {
  const key = String(upstreamAlgorithmId || '').trim();
  if (!key) return;
  const next = { ...safeObject(state.stepExecution.inputResultRefsByAlgorithm) };
  if (!resultRef) delete next[key];
  else next[key] = cloneData(resultRef);
  state.stepExecution.inputResultRefsByAlgorithm = next;
  state.stepExecution.errorMessage = '';
}

function selectStepExecutionArtifact(artifact = null) {
  state.stepExecution.selectedArtifact = artifact || null;
  const resultPayload = safeObject(artifact?.resultPayload);
  state.stepExecution.latestResult = resultPayload?.step ? resultPayload : state.stepExecution.latestResult;
}

async function loadStepExecutionUpstreamResults(filters = {}) {
  state.stepExecution.upstreamResultsLoading = true;
  try {
    const response = await api.getPlanningUpstreamResults({
      query: filters.query ?? state.stepExecution.upstreamQuery,
      limit: filters.limit || 160,
      offset: filters.offset || 0,
    });
    state.stepExecution.upstreamResults = safeArray(response?.results);
    return state.stepExecution.upstreamResults;
  } catch (error) {
    state.stepExecution.errorMessage = formatPlanningError(error);
    throw error;
  } finally {
    state.stepExecution.upstreamResultsLoading = false;
  }
}

async function loadStepExecutionArtifact(artifactId) {
  if (!artifactId) return null;
  const response = await api.getPlanningRealtimeArtifact(artifactId);
  const artifact = response?.artifact || null;
  if (artifact) selectStepExecutionArtifact(artifact);
  return artifact;
}

function buildStepExecutionPayload() {
  const algorithm = stepExecutionSelectedAlgorithm.value;
  const step = stepExecutionSelectedStep.value;
  const variant = stepExecutionSelectedVariant.value;
  if (!selectedTaskInstance.value) {
    const error = new Error('请先选择或创建一个规划任务实例，再进行分步执行。');
    error.type = 'missing_data';
    throw error;
  }
  if (!algorithm?.id) {
    const error = new Error('请选择要执行的规划算法。');
    error.type = 'missing_data';
    throw error;
  }
  if (!variant?.id) {
    const error = new Error('请选择可用的算法实现。');
    error.type = 'missing_data';
    throw error;
  }

  const selectedRefs = Object.values(safeObject(state.stepExecution.inputResultRefsByAlgorithm)).filter(Boolean);
  const missingRequired = stepExecutionRequiredUpstreamIds.value.filter((algorithmId) => (
    !selectedRefs.some((ref) => String(ref.algorithmId || '') === algorithmId)
  ));
  if (missingRequired.length) {
    const error = new Error(`缺少前置算法结果：${missingRequired.join(' / ')}。`);
    error.type = 'missing_upstream';
    throw error;
  }

  const displayName = `${algorithm.name}-${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
  return {
    taskCenterId: selectedTaskInstance.value.id,
    assessmentName: state.assessmentName,
    algorithmId: algorithm.id,
    stepId: step?.id || '',
    bindingId: variant.id,
    algorithmInput: getAlgorithmInput(algorithm.id),
    inputResultRefs: selectedRefs.map((ref) => cloneData(ref)),
    displayName,
    description: selectedRefs.length ? `前置结果 ${selectedRefs.length} 个` : '无前置结果单步执行',
  };
}

function markStepExecutionTerminated(message = '分步执行已终止。') {
  const streamState = state.stepExecution.executionStream;
  streamState.active = false;
  streamState.done = true;
  streamState.cancelRequested = true;
  streamState.terminated = true;
  streamState.errorMessage = message;
  state.stepExecution.errorMessage = message;
  appendTerminalLineToStream(streamState, {
    stream: 'system',
    message,
    timestamp: new Date().toISOString(),
  });
}

async function executePlanningRealtimeStep() {
  state.stepExecution.calculating = true;
  state.stepExecution.errorMessage = '';
  resetStepExecutionStream();
  stepExecutionAbortController = new AbortController();

  try {
    await persistCurrentTaskConfig({ silent: true });
    const payload = buildStepExecutionPayload();
    const response = await api.evaluatePlanningRealtimeStepStream(payload, {
      onEvent: handleStepExecutionStreamEvent,
      signal: stepExecutionAbortController.signal,
    });
    if (!response?.result) {
      const error = new Error(state.stepExecution.executionStream.errorMessage || '分步执行流未返回最终结果。');
      error.type = 'algorithm_failed';
      throw error;
    }
    state.stepExecution.latestResult = response.result;
    state.stepExecution.currentArtifact = response.artifact || null;
    state.stepExecution.selectedArtifact = response.artifact || null;
    state.stepExecution.activeView = 'run';
    await loadStepExecutionUpstreamResults({ limit: 160 });
    return response;
  } catch (error) {
    if (state.stepExecution.executionStream.cancelRequested || isAbortError(error)) {
      markStepExecutionTerminated();
      return null;
    }
    state.stepExecution.executionStream.active = false;
    state.stepExecution.executionStream.done = true;
    state.stepExecution.executionStream.errorMessage = state.stepExecution.executionStream.errorMessage || error.message || '分步执行失败。';
    state.stepExecution.errorMessage = formatPlanningError(error);
    throw error;
  } finally {
    stepExecutionAbortController = null;
    state.stepExecution.calculating = false;
  }
}

function terminatePlanningRealtimeStep() {
  if (!state.stepExecution.calculating && !state.stepExecution.executionStream.active) return;
  state.stepExecution.executionStream.cancelRequested = true;
  if (stepExecutionAbortController) {
    stepExecutionAbortController.abort();
  }
  markStepExecutionTerminated();
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
    const encoded = outputPackage.contentBase64.includes(',')
      ? outputPackage.contentBase64.slice(outputPackage.contentBase64.indexOf(',') + 1)
      : outputPackage.contentBase64;
    const binary = window.atob(encoded);
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
  downloadPlanningFile(outputPackage);
}

function downloadPlanningFile(outputPackage = {}) {
  if (!outputPackage.fileName) {
    throw new Error('当前没有可导出的文件。');
  }

  triggerPackageDownload(outputPackage);
  clearError();
}

function formatVariantType(type) {
  return type === 'external-model' ? '扩展算法实现' : '内置算法';
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
    stepExecutionSelectedAlgorithm,
    stepExecutionSelectedStep,
    stepExecutionSelectedVariant,
    stepExecutionRequiredUpstreamIds,
    stepExecutionOptionalUpstreamIds,
    resourceSummary,
    workflowSummary,
    initializePlanningWorkflow,
    createPlanningTaskInstance,
    selectTaskInstance,
    archiveTaskInstance,
    loadTaskRuns,
    replayTaskRun,
    calculatePlanningAssessment,
    terminatePlanningExecution,
    loadStepExecutionUpstreamResults,
    loadStepExecutionArtifact,
    executePlanningRealtimeStep,
    terminatePlanningRealtimeStep,
    setStepExecutionView,
    setStepExecutionAlgorithm,
    setStepExecutionBinding,
    setStepExecutionUpstreamQuery,
    selectStepExecutionInputResult,
    selectStepExecutionArtifact,
    saveCurrentResultSnapshot,
    downloadResultPackage,
    downloadPlanningFile,
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
    addAlgorithmFiles,
    removeAlgorithmFile,
    getAlgorithmInput,
    formatVariantType,
    formatStatusLabel,
    getAlgorithmUsageCount,
  };
}
