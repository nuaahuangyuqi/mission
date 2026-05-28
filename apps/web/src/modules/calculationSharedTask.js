import { computed, reactive } from 'vue';
import { api } from '../api';
import { authState } from '../auth';

const STORAGE_KEY = 'mission-calculation-shared-task-v1';
const PANEL_STORAGE_KEY = 'mission-calculation-shared-task-panel-v1';
const REMOTE_TASK_META_STORAGE_KEY = 'mission-calculation-shared-task-remote-v1';
const STORAGE_WARNING_MESSAGE = '浏览器本地存储空间不足，共同任务仅保留在当前会话内存状态。';
const CALCULATION_TASK_MODULE_KEYS = ['capability', 'action', 'consumption'];

export const MISSION_TYPE_OPTIONS = [
  {
    key: 'fire-strike',
    label: '火力打击',
    description: '以压制敌关键节点、打开火力通道为主的打击任务。',
    actionTaskId: 'helicopter-fire-strike',
    consumptionStrikeMode: 'combined-fire',
  },
  {
    key: 'air-assault',
    label: '机降突击',
    description: '以低空突入、机降夺控和接应撤收为主的突击任务。',
    actionTaskId: 'helicopter-air-assault',
    consumptionStrikeMode: 'precision-strike',
  },
];

export const BLUE_EQUIPMENT_FIELDS = [
  { key: 'attackHelicopters', label: '攻击直升机', unit: '架' },
  { key: 'transportHelicopters', label: '运输直升机', unit: '架' },
  { key: 'escortHelicopters', label: '护航直升机', unit: '架' },
  { key: 'reconHelicopters', label: '侦察直升机', unit: '架' },
  { key: 'groundVehicles', label: '地面车辆', unit: '辆' },
  { key: 'supportEquipment', label: '保障装备', unit: '套' },
  { key: 'commandSeats', label: '指挥席位', unit: '席' },
  { key: 'medicalTeams', label: '医疗分队', unit: '组' },
  { key: 'troops', label: '投入兵力', unit: '人' },
  { key: 'rockets', label: '火箭弹', unit: '枚' },
  { key: 'missiles', label: '导弹', unit: '枚' },
  { key: 'fuel', label: '航油', unit: '升' },
];

export const RED_EQUIPMENT_FIELDS = [
  { key: 'airDefenseUnits', label: '防空节点', unit: '个' },
  { key: 'fireStrikeUnits', label: '火力单元', unit: '个' },
  { key: 'armoredUnits', label: '装甲单元', unit: '个' },
  { key: 'reconNodes', label: '侦察预警点', unit: '个' },
  { key: 'electronicWarfareNodes', label: '电子压制点', unit: '个' },
];

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function clampNonNegative(value) {
  return Math.max(Number(value) || 0, 0);
}

function round(value, digits = 2) {
  return Number((Number(value) || 0).toFixed(digits));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePositiveId(value) {
  const next = Number(value);
  return Number.isInteger(next) && next > 0 ? next : null;
}

function normalizeTaskModuleKey(value, fallback = '') {
  const normalized = String(value || fallback).trim();
  return normalized || fallback;
}

function normalizeCalculationTaskModule(value, fallback = 'capability') {
  const normalized = normalizeTaskModuleKey(value, fallback);
  return CALCULATION_TASK_MODULE_KEYS.includes(normalized) ? normalized : fallback;
}

function isCalculationTaskModule(value) {
  return CALCULATION_TASK_MODULE_KEYS.includes(normalizeTaskModuleKey(value));
}

function defaultBlueEquipment() {
  return {
    attackHelicopters: 6,
    transportHelicopters: 6,
    escortHelicopters: 2,
    reconHelicopters: 1,
    groundVehicles: 18,
    supportEquipment: 14,
    commandSeats: 4,
    medicalTeams: 2,
    troops: 96,
    rockets: 96,
    missiles: 24,
    fuel: 3600,
  };
}

function defaultRedEquipment() {
  return {
    airDefenseUnits: 6,
    fireStrikeUnits: 8,
    armoredUnits: 14,
    reconNodes: 5,
    electronicWarfareNodes: 3,
  };
}

function createDefaultTask() {
  return {
    name: '联合任务 1',
    missionType: 'fire-strike',
    objective: '压制目标区域防空与火力节点，形成后续行动通道。',
    description: '能力、行动、消耗三个子模块共享该任务底座，用于统一任务背景、敌我输入和行动链生成。',
    blueEquipment: defaultBlueEquipment(),
    redEquipment: defaultRedEquipment(),
  };
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

function readPanelStorage() {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    const scopedKey = buildScopedStorageKey(PANEL_STORAGE_KEY);
    const raw = window.localStorage.getItem(scopedKey);
    if (!raw) {
      if (authState.user?.id) {
        window.localStorage.removeItem(PANEL_STORAGE_KEY);
        return true;
      }

      const legacyRaw = window.localStorage.getItem(PANEL_STORAGE_KEY);
      if (!legacyRaw) {
        return true;
      }
      const parsedLegacy = JSON.parse(legacyRaw);
      return typeof parsedLegacy === 'boolean' ? parsedLegacy : true;
    }

    const parsed = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : true;
  } catch {
    return true;
  }
}

function readRemoteTaskMeta() {
  if (typeof window === 'undefined') {
    return {
      taskId: null,
      moduleKey: '',
    };
  }

  try {
    const scopedKey = buildScopedStorageKey(REMOTE_TASK_META_STORAGE_KEY);
    const raw = window.localStorage.getItem(scopedKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const taskId = normalizePositiveId(parsed?.taskId);
      return {
        taskId,
        moduleKey: taskId ? normalizeTaskModuleKey(parsed?.moduleKey) : '',
      };
    }

    if (authState.user?.id) {
      window.localStorage.removeItem(REMOTE_TASK_META_STORAGE_KEY);
    }
  } catch {
    return {
      taskId: null,
      moduleKey: '',
    };
  }

  return {
    taskId: null,
    moduleKey: '',
  };
}

function buildEquipmentState(fields, source = {}, fallback = {}) {
  return Object.fromEntries(fields.map((field) => [
    field.key,
    clampNonNegative(source?.[field.key] ?? fallback?.[field.key] ?? 0),
  ]));
}

function sanitizeSharedTask(source = {}) {
  const fallback = createDefaultTask();
  const missionType = MISSION_TYPE_OPTIONS.some((item) => item.key === source?.missionType)
    ? source.missionType
    : fallback.missionType;

  return {
    name: String(source?.name || fallback.name),
    missionType,
    objective: String(source?.objective || fallback.objective),
    description: String(source?.description || fallback.description),
    blueEquipment: buildEquipmentState(BLUE_EQUIPMENT_FIELDS, source?.blueEquipment, fallback.blueEquipment),
    redEquipment: buildEquipmentState(RED_EQUIPMENT_FIELDS, source?.redEquipment, fallback.redEquipment),
  };
}

function normalizeRemoteTaskEntry(source = {}) {
  const taskId = normalizePositiveId(source?.id);
  const sharedContext = sanitizeSharedTask({
    ...source?.sharedContext,
    name: source?.sharedContext?.name || source?.name || '',
    description: source?.sharedContext?.description || source?.description || '',
  });

  return {
    id: taskId,
    name: String(source?.name || sharedContext.name || ''),
    moduleKey: normalizeTaskModuleKey(source?.moduleKey),
    status: String(source?.status || 'draft'),
    description: String(source?.description || sharedContext.description || ''),
    updatedAt: String(source?.updatedAt || ''),
    sharedContext,
  };
}

const state = reactive({
  task: createDefaultTask(),
  panelCollapsed: true,
  storageScope: '',
  storageWriteWarning: '',
  remoteTaskId: null,
  remoteTaskModuleKey: '',
  remoteTasks: [],
  remoteTasksLoaded: false,
  remoteTasksLoading: false,
  remoteTasksSaving: false,
  remoteTaskListVisible: false,
  remoteErrorMessage: '',
  remoteFeedbackMessage: '',
});

let persistTimer = null;

function writeStorage() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(buildScopedStorageKey(STORAGE_KEY), JSON.stringify(state.task));
    state.storageWriteWarning = '';
  } catch {
    state.storageWriteWarning = STORAGE_WARNING_MESSAGE;
  }
}

function writePanelStorage() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(buildScopedStorageKey(PANEL_STORAGE_KEY), JSON.stringify(Boolean(state.panelCollapsed)));
  } catch {
    state.storageWriteWarning = STORAGE_WARNING_MESSAGE;
  }
}

function writeRemoteTaskMeta() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const scopedKey = buildScopedStorageKey(REMOTE_TASK_META_STORAGE_KEY);
    if (!state.remoteTaskId) {
      window.localStorage.removeItem(scopedKey);
      return;
    }

    window.localStorage.setItem(scopedKey, JSON.stringify({
      taskId: state.remoteTaskId,
      moduleKey: state.remoteTaskModuleKey,
    }));
  } catch {
    state.storageWriteWarning = STORAGE_WARNING_MESSAGE;
  }
}

function hydrateSharedTaskFromStorage() {
  const scope = resolveStorageScope();
  if (state.storageScope === scope) {
    return;
  }

  const remoteMeta = readRemoteTaskMeta();

  state.storageScope = scope;
  state.task = sanitizeSharedTask(readStorage());
  state.panelCollapsed = readPanelStorage();
  state.remoteTaskId = remoteMeta.taskId;
  state.remoteTaskModuleKey = remoteMeta.moduleKey;
  state.remoteTasks = [];
  state.remoteTasksLoaded = false;
  state.remoteTasksLoading = false;
  state.remoteTasksSaving = false;
  state.remoteTaskListVisible = false;
  state.remoteErrorMessage = '';
  state.remoteFeedbackMessage = '';
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

function clearRemoteTaskMessages() {
  state.remoteErrorMessage = '';
  state.remoteFeedbackMessage = '';
}

function applySharedTask(source = {}, options = {}) {
  const {
    remoteTaskId,
    remoteTaskModuleKey,
    persist = true,
    closeTaskList = false,
  } = options;

  state.task = sanitizeSharedTask(source);

  if (Object.prototype.hasOwnProperty.call(options, 'remoteTaskId')) {
    state.remoteTaskId = normalizePositiveId(remoteTaskId);
    state.remoteTaskModuleKey = state.remoteTaskId
      ? normalizeTaskModuleKey(remoteTaskModuleKey, state.remoteTaskModuleKey)
      : '';
    writeRemoteTaskMeta();
  }

  if (closeTaskList) {
    state.remoteTaskListVisible = false;
  }

  if (persist) {
    schedulePersist();
  }
}

function updateTaskField(field, value) {
  if (!['name', 'missionType', 'objective', 'description'].includes(field)) {
    return;
  }

  clearRemoteTaskMessages();

  if (field === 'missionType') {
    state.task.missionType = MISSION_TYPE_OPTIONS.some((item) => item.key === value) ? value : MISSION_TYPE_OPTIONS[0].key;
  } else {
    state.task[field] = String(value || '');
  }

  schedulePersist();
}

function updateEquipmentField(camp, key, value) {
  const target = camp === 'red' ? state.task.redEquipment : state.task.blueEquipment;
  if (!Object.prototype.hasOwnProperty.call(target, key)) {
    return;
  }

  clearRemoteTaskMessages();
  target[key] = clampNonNegative(value);
  schedulePersist();
}

function resetSharedTask() {
  clearRemoteTaskMessages();
  applySharedTask(createDefaultTask(), {
    remoteTaskId: null,
    remoteTaskModuleKey: '',
    persist: true,
  });
}

function setSharedTaskPanelCollapsed(value) {
  state.panelCollapsed = Boolean(value);
  writePanelStorage();
}

function toggleSharedTaskPanel() {
  setSharedTaskPanelCollapsed(!state.panelCollapsed);
}

function resolveMissionTypeMeta(task = state.task) {
  return MISSION_TYPE_OPTIONS.find((item) => item.key === task?.missionType) || MISSION_TYPE_OPTIONS[0];
}

function totalEquipmentAmount(equipment = {}) {
  return Object.values(equipment).reduce((sum, value) => sum + clampNonNegative(value), 0);
}

function upsertRemoteTask(task) {
  if (!task?.id) {
    return;
  }

  const nextTasks = [...state.remoteTasks];
  const index = nextTasks.findIndex((item) => item.id === task.id);
  if (index >= 0) {
    nextTasks.splice(index, 1, task);
  } else {
    nextTasks.unshift(task);
  }
  state.remoteTasks = nextTasks;
}

async function refreshRemoteTasks(options = {}) {
  const { force = false, silent = false } = options;
  if (state.remoteTasksLoading) {
    return state.remoteTasks;
  }
  if (state.remoteTasksLoaded && !force) {
    return state.remoteTasks;
  }

  state.remoteTasksLoading = true;
  if (!silent) {
    state.remoteErrorMessage = '';
  }

  try {
    const payload = await api.getTasks({ mine: true });
    state.remoteTasks = safeArray(payload?.tasks)
      .filter((item) => CALCULATION_TASK_MODULE_KEYS.includes(String(item?.moduleKey || '').trim()))
      .map((item) => normalizeRemoteTaskEntry(item))
      .filter((item) => item.id);
    state.remoteTasksLoaded = true;
    return state.remoteTasks;
  } catch (error) {
    if (!silent) {
      state.remoteErrorMessage = error.message || '已保存任务列表读取失败。';
    }
    return [];
  } finally {
    state.remoteTasksLoading = false;
  }
}

async function toggleRemoteTaskList() {
  state.remoteTaskListVisible = !state.remoteTaskListVisible;
  if (state.remoteTaskListVisible) {
    await refreshRemoteTasks();
  }
}

function buildRemoteTaskSavePayload(taskModule = 'capability') {
  const normalizedTask = sanitizeSharedTask(state.task);
  const moduleKey = isCalculationTaskModule(state.remoteTaskModuleKey)
    ? normalizeCalculationTaskModule(state.remoteTaskModuleKey, taskModule)
    : normalizeCalculationTaskModule(taskModule, 'capability');

  return {
    name: String(normalizedTask.name || '').trim() || '联合任务',
    moduleKey,
    description: String(normalizedTask.description || '').trim(),
    sharedContext: cloneData(normalizedTask),
  };
}

async function saveRemoteTask(taskModule = 'capability') {
  if (state.remoteTasksSaving) {
    return null;
  }

  state.remoteTasksSaving = true;
  state.remoteErrorMessage = '';

  try {
    const payload = buildRemoteTaskSavePayload(taskModule);
    const boundTaskId = isCalculationTaskModule(state.remoteTaskModuleKey) ? state.remoteTaskId : null;
    const response = boundTaskId
      ? await api.updateTask(boundTaskId, payload)
      : await api.createTask(payload);

    const task = normalizeRemoteTaskEntry(response?.task || {});
    applySharedTask(task.sharedContext, {
      remoteTaskId: task.id,
      remoteTaskModuleKey: task.moduleKey,
      persist: true,
    });
    upsertRemoteTask(task);
    state.remoteTasksLoaded = true;
    state.remoteFeedbackMessage = `共同任务已保存到服务端任务“${task.name || state.task.name}”。`;
    await refreshRemoteTasks({ force: true, silent: true });
    return task;
  } catch (error) {
    state.remoteErrorMessage = error.message || '共同任务保存失败。';
    return null;
  } finally {
    state.remoteTasksSaving = false;
  }
}

async function loadRemoteTask(taskId, options = {}) {
  const {
    allowAnyModule = false,
    closeTaskList = true,
  } = options;
  const normalizedTaskId = normalizePositiveId(taskId);
  if (!normalizedTaskId) {
    state.remoteErrorMessage = '任务 ID 无效。';
    return null;
  }

  state.remoteErrorMessage = '';

  let task = state.remoteTasks.find((item) => item.id === normalizedTaskId) || null;
  if (!task) {
    try {
      const payload = await api.getTask(normalizedTaskId);
      task = normalizeRemoteTaskEntry(payload?.task || {});
      if (!allowAnyModule && !isCalculationTaskModule(task.moduleKey)) {
        state.remoteErrorMessage = '所选任务不是能力计算共同任务。';
        return null;
      }
      if (isCalculationTaskModule(task.moduleKey)) {
        upsertRemoteTask(task);
        state.remoteTasksLoaded = true;
      }
    } catch (error) {
      state.remoteErrorMessage = error.message || '任务读取失败。';
      return null;
    }
  }

  if (!allowAnyModule && !isCalculationTaskModule(task.moduleKey)) {
    state.remoteErrorMessage = '所选任务不是能力计算共同任务。';
    return null;
  }

  applySharedTask(task.sharedContext, {
    remoteTaskId: task.id,
    remoteTaskModuleKey: task.moduleKey,
    persist: true,
    closeTaskList,
  });
  state.remoteFeedbackMessage = `已读取任务“${task.name || state.task.name}”。`;
  return task;
}

export function resolveSharedEnemyFireIntensity(task = state.task) {
  const red = task?.redEquipment || {};
  const weightedThreat = (
    (clampNonNegative(red.airDefenseUnits) * 4)
    + (clampNonNegative(red.fireStrikeUnits) * 5)
    + (clampNonNegative(red.armoredUnits) * 3)
    + (clampNonNegative(red.reconNodes) * 2)
    + (clampNonNegative(red.electronicWarfareNodes) * 2)
  );
  return Math.max(20, Math.min(100, Math.round(20 + (weightedThreat * 0.45))));
}

export function resolveSharedActionTaskId(task = state.task) {
  return resolveMissionTypeMeta(task).actionTaskId;
}

export function resolveSharedConsumptionStrikeMode(task = state.task) {
  return resolveMissionTypeMeta(task).consumptionStrikeMode;
}

export function buildSharedActionResourceBaseline(task = state.task) {
  const blue = task?.blueEquipment || {};
  return {
    attackHelicopters: clampNonNegative(blue.attackHelicopters),
    transportHelicopters: clampNonNegative(blue.transportHelicopters),
    escortHelicopters: clampNonNegative(blue.escortHelicopters),
    reconHelicopters: clampNonNegative(blue.reconHelicopters),
    commandSeats: clampNonNegative(blue.commandSeats),
    medicalTeams: clampNonNegative(blue.medicalTeams),
    troops: clampNonNegative(blue.troops),
    rockets: clampNonNegative(blue.rockets),
    missiles: clampNonNegative(blue.missiles),
    fuel: clampNonNegative(blue.fuel),
  };
}

export function buildSharedConsumptionPreset(task = state.task) {
  const blue = task?.blueEquipment || {};
  return {
    mission: {
      enemyFireIntensity: resolveSharedEnemyFireIntensity(task),
      strikeMode: resolveSharedConsumptionStrikeMode(task),
    },
    personnel: {
      deployed: clampNonNegative(blue.troops),
    },
    equipment: {
      groundVehicles: {
        quantity: clampNonNegative(blue.groundVehicles),
      },
      helicopters: {
        quantity: clampNonNegative(blue.attackHelicopters)
          + clampNonNegative(blue.transportHelicopters)
          + clampNonNegative(blue.escortHelicopters)
          + clampNonNegative(blue.reconHelicopters),
      },
      supportEquipment: {
        quantity: clampNonNegative(blue.supportEquipment)
          + clampNonNegative(blue.commandSeats)
          + clampNonNegative(blue.medicalTeams),
      },
    },
  };
}

function scaleRelative(sharedValue, schemeValue, baseValue) {
  const shared = clampNonNegative(sharedValue);
  const scheme = clampNonNegative(schemeValue);
  const base = clampNonNegative(baseValue);
  if (shared === 0) {
    return 0;
  }
  if (base > 0 && scheme > 0) {
    return round(shared * (scheme / base), 0);
  }
  return round(shared, 0);
}

export function mergeActionSchemesWithSharedTask(taskTemplate = {}, previousSchemes = []) {
  const defaultSchemes = Array.isArray(taskTemplate?.defaultSchemes) ? cloneData(taskTemplate.defaultSchemes) : [];
  if (!defaultSchemes.length) {
    return [];
  }

  const baseScheme = defaultSchemes[0];
  const baseline = buildSharedActionResourceBaseline();

  return defaultSchemes.map((scheme) => {
    const previous = previousSchemes.find((item) => item.id === scheme.id) || null;
    const availableResources = { ...(previous?.availableResources || {}), ...(scheme.availableResources || {}) };

    Object.keys(baseline).forEach((key) => {
      availableResources[key] = scaleRelative(
        baseline[key],
        scheme?.availableResources?.[key],
        baseScheme?.availableResources?.[key],
      );
    });

    return {
      ...scheme,
      description: previous?.description || scheme.description || '',
      availableResources,
      environment: previous?.environment ? cloneData(previous.environment) : cloneData(scheme.environment || {}),
      nodeAdjustments: previous?.nodeAdjustments ? cloneData(previous.nodeAdjustments) : cloneData(scheme.nodeAdjustments || {}),
    };
  });
}

export function mergeConsumptionSchemesWithSharedTask(templateSchemes = [], previousSchemes = []) {
  const defaultSchemes = Array.isArray(templateSchemes) ? cloneData(templateSchemes) : [];
  if (!defaultSchemes.length) {
    return [];
  }

  const baseScheme = defaultSchemes[0];
  const preset = buildSharedConsumptionPreset();

  return defaultSchemes.map((scheme) => {
    const previous = previousSchemes.find((item) => item.id === scheme.id) || null;
    const nextScheme = {
      ...scheme,
      description: previous?.description || scheme.description || '',
      durationDays: previous?.durationDays ?? scheme.durationDays,
      operatingHours: previous?.operatingHours ?? scheme.operatingHours,
      mission: cloneData(previous?.mission || scheme.mission || {}),
      personnel: cloneData(previous?.personnel || scheme.personnel || {}),
      equipment: cloneData(previous?.equipment || scheme.equipment || {}),
    };

    nextScheme.mission.strikeMode = preset.mission.strikeMode;
    nextScheme.mission.enemyFireIntensity = scaleRelative(
      preset.mission.enemyFireIntensity,
      scheme?.mission?.enemyFireIntensity,
      baseScheme?.mission?.enemyFireIntensity,
    );
    nextScheme.personnel.deployed = scaleRelative(
      preset.personnel.deployed,
      scheme?.personnel?.deployed,
      baseScheme?.personnel?.deployed,
    );

    ['groundVehicles', 'helicopters', 'supportEquipment'].forEach((key) => {
      const sharedQuantity = preset.equipment?.[key]?.quantity ?? 0;
      const schemeQuantity = scheme?.equipment?.[key]?.quantity ?? 0;
      const baseQuantity = baseScheme?.equipment?.[key]?.quantity ?? 0;
      if (!nextScheme.equipment[key]) {
        nextScheme.equipment[key] = {};
      }
      nextScheme.equipment[key].quantity = scaleRelative(sharedQuantity, schemeQuantity, baseQuantity);
    });

    return nextScheme;
  });
}

const missionTask = computed(() => state.task);
const missionTypeMeta = computed(() => resolveMissionTypeMeta(state.task));
const missionSummary = computed(() => ({
  missionTypeLabel: missionTypeMeta.value.label,
  blueTotal: totalEquipmentAmount(state.task.blueEquipment),
  redTotal: totalEquipmentAmount(state.task.redEquipment),
  enemyFireIntensity: resolveSharedEnemyFireIntensity(state.task),
}));
const isSharedTaskPanelCollapsed = computed(() => state.panelCollapsed);
const missionSignature = computed(() => JSON.stringify(state.task));
const missionSyncSignature = computed(() => JSON.stringify({
  missionType: state.task.missionType,
  blueEquipment: state.task.blueEquipment,
  redEquipment: state.task.redEquipment,
}));
const remoteTaskBinding = computed(() => (
  state.remoteTaskId
    ? {
      id: state.remoteTaskId,
      moduleKey: state.remoteTaskModuleKey,
    }
    : null
));
const remoteTaskEntries = computed(() => state.remoteTasks);
const isRemoteTaskListVisible = computed(() => state.remoteTaskListVisible);
const isRemoteTaskListLoading = computed(() => state.remoteTasksLoading);
const isRemoteTaskSaving = computed(() => state.remoteTasksSaving);
const remoteTaskErrorMessage = computed(() => state.remoteErrorMessage);
const remoteTaskFeedbackMessage = computed(() => state.remoteFeedbackMessage);
const storageWriteWarning = computed(() => state.storageWriteWarning);

export function useCalculationSharedTask() {
  hydrateSharedTaskFromStorage();

  return {
    state,
    missionTask,
    missionTypeOptions: MISSION_TYPE_OPTIONS,
    missionTypeMeta,
    blueEquipmentFields: BLUE_EQUIPMENT_FIELDS,
    redEquipmentFields: RED_EQUIPMENT_FIELDS,
    missionSummary,
    isSharedTaskPanelCollapsed,
    missionSignature,
    missionSyncSignature,
    remoteTaskBinding,
    remoteTaskEntries,
    isRemoteTaskListVisible,
    isRemoteTaskListLoading,
    isRemoteTaskSaving,
    remoteTaskErrorMessage,
    remoteTaskFeedbackMessage,
    storageWriteWarning,
    updateTaskField,
    updateEquipmentField,
    resetSharedTask,
    setSharedTaskPanelCollapsed,
    toggleSharedTaskPanel,
    refreshRemoteTasks,
    toggleRemoteTaskList,
    saveRemoteTask,
    loadRemoteTask,
  };
}
