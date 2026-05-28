import { computed, reactive, watch } from 'vue';
import { api } from '../api';
import { authState } from '../auth';
import {
  mergeConsumptionSchemesWithSharedTask,
  useCalculationSharedTask,
} from './calculationSharedTask';

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + (Number(item) || 0), 0) / values.length;
}

function normalizeScheme(source = {}, index = 0) {
  return {
    id: String(source.id || `scheme-${index + 1}`),
    name: String(source.name || `方案 ${index + 1}`),
    description: String(source.description || ''),
    durationDays: clamp(source.durationDays, 1, 30),
    operatingHours: clamp(source.operatingHours, 6, 24),
    mission: {
      enemyFireIntensity: clamp(source?.mission?.enemyFireIntensity, 20, 100),
      strikeMode: String(source?.mission?.strikeMode || ''),
    },
    personnel: {
      deployed: Math.max(Number(source?.personnel?.deployed) || 0, 0),
      medicalSupportLevel: clamp(source?.personnel?.medicalSupportLevel, 30, 100),
      evacuationEfficiency: clamp(source?.personnel?.evacuationEfficiency, 30, 100),
    },
    equipment: cloneData(source.equipment || {}),
  };
}

function summarizeScheme(scheme) {
  const equipment = Object.values(scheme?.equipment || {});
  const totalEquipment = equipment.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  return {
    totalEquipment,
    averageMaintenance: mean(equipment.map((item) => item.maintenanceLevel)),
    averageProtection: mean(equipment.map((item) => item.protectionCapability)),
    averageAge: mean(equipment.map((item) => item.serviceYears)),
    averageUsage: mean(equipment.map((item) => item.usageFrequency)),
  };
}

const {
  missionTask,
  missionTypeMeta,
  missionSignature,
  missionSyncSignature,
} = useCalculationSharedTask();

const state = reactive({
  loading: false,
  calculating: false,
  initialized: false,
  initializingPromise: null,
  errorMessage: '',
  template: null,
  schemes: [],
  assessmentName: '消耗计算任务',
  selectedSchemeId: '',
  selectedEngine: 'builtin',
  results: null,
  resultsDirty: true,
});

const currentUser = computed(() => authState.user || { username: '', role: 'user' });
const engineOptions = computed(() => state.template?.engines || []);
const naturalModels = computed(() => state.template?.naturalModels || []);
const missionModels = computed(() => state.template?.missionModels || []);
const predictionModels = computed(() => state.template?.predictionModels || []);
const strikeModes = computed(() => state.template?.strikeModes || []);
const phases = computed(() => state.template?.phases || []);
const equipmentTypes = computed(() => state.template?.equipmentTypes || []);
const activeScheme = computed(() => state.schemes.find((item) => item.id === state.selectedSchemeId) || state.schemes[0] || null);
const selectedEngineMeta = computed(() => engineOptions.value.find((item) => item.key === state.selectedEngine) || engineOptions.value[0] || null);
const selectedStrikeModeMeta = computed(() => strikeModes.value.find((item) => item.key === activeScheme.value?.mission?.strikeMode) || strikeModes.value[0] || null);
const rankingRows = computed(() => state.results?.comparison?.ranking || []);
const recommendedScheme = computed(() => rankingRows.value[0] || null);
const selectedSchemeResult = computed(() => state.results?.schemes?.[state.selectedSchemeId] || null);
const resultsGeneratedAt = computed(() => state.results?.generatedAt || '');
const workflowSummary = computed(() => ({
  equipmentTypeCount: equipmentTypes.value.length,
  schemeCount: state.schemes.length,
  phaseCount: phases.value.length,
  modelCount: naturalModels.value.length + missionModels.value.length + predictionModels.value.length,
}));
const activeSchemeSummary = computed(() => summarizeScheme(activeScheme.value || {}));

function clearError() {
  state.errorMessage = '';
}

function markResultsDirty() {
  state.resultsDirty = true;
}

function applyMissionDrivenSchemes(sourceSchemes = state.template?.schemes || []) {
  const mergedSchemes = mergeConsumptionSchemesWithSharedTask(sourceSchemes, state.schemes);
  state.schemes = safeArray(mergedSchemes).map((scheme, index) => normalizeScheme(scheme, index));
  state.selectedSchemeId = state.schemes.find((item) => item.id === state.selectedSchemeId)?.id || state.schemes[0]?.id || '';
  state.results = null;
  state.resultsDirty = true;
}

function hydrateTemplate(payload) {
  state.template = payload;
  state.selectedEngine = payload.engines?.find((item) => item.status === 'active')?.key || payload.engines?.[0]?.key || 'builtin';
  state.assessmentName = `${missionTask.value.name} 消耗评估`;
  applyMissionDrivenSchemes(payload.schemes);
}

async function loadConsumptionTemplate() {
  const payload = await api.getConsumptionTemplate();
  hydrateTemplate(payload);
  state.initialized = true;
}

async function initializeConsumptionWorkflow(force = false) {
  if (state.initialized && !force) {
    return;
  }

  if (state.initializingPromise && !force) {
    return state.initializingPromise;
  }

  state.loading = true;
  clearError();
  state.initializingPromise = loadConsumptionTemplate()
    .catch((error) => {
      state.errorMessage = error.message || '消耗计算模块初始化失败。';
      throw error;
    })
    .finally(() => {
      state.loading = false;
      state.initializingPromise = null;
    });

  return state.initializingPromise;
}

async function calculateConsumptionAssessment() {
  state.calculating = true;
  clearError();

  try {
    state.results = await api.evaluateConsumption({
      assessmentName: state.assessmentName.trim() || '消耗计算任务',
      engine: state.selectedEngine,
      missionContext: cloneData(missionTask.value),
      schemes: cloneData(state.schemes),
    });
    state.resultsDirty = false;
  } catch (error) {
    state.errorMessage = error.message || '消耗计算评估失败。';
    throw error;
  } finally {
    state.calculating = false;
  }
}

function resetCurrentSchemes() {
  if (!state.template) return;
  applyMissionDrivenSchemes(state.template.schemes);
  clearError();
}

function setAssessmentName(value) {
  state.assessmentName = value;
  markResultsDirty();
}

function setSelectedEngine(value) {
  state.selectedEngine = value;
  markResultsDirty();
}

function setSelectedScheme(schemeId) {
  state.selectedSchemeId = schemeId;
}

function updateSchemeField(schemeId, field, value) {
  const scheme = state.schemes.find((item) => item.id === schemeId);
  if (!scheme) return;
  scheme[field] = value;
  markResultsDirty();
}

function updateSchemeNumberField(schemeId, field, value, min, max) {
  const scheme = state.schemes.find((item) => item.id === schemeId);
  if (!scheme) return;
  scheme[field] = clamp(value, min, max);
  markResultsDirty();
}

function updateMissionField(schemeId, field, value) {
  const scheme = state.schemes.find((item) => item.id === schemeId);
  if (!scheme) return;

  if (field === 'strikeMode') {
    scheme.mission.strikeMode = value;
  } else if (field === 'enemyFireIntensity') {
    scheme.mission.enemyFireIntensity = clamp(value, 20, 100);
  }

  markResultsDirty();
}

function updatePersonnelField(schemeId, field, value) {
  const scheme = state.schemes.find((item) => item.id === schemeId);
  if (!scheme) return;

  if (field === 'deployed') {
    scheme.personnel[field] = Math.max(Number(value) || 0, 0);
  } else {
    scheme.personnel[field] = clamp(value, 30, 100);
  }

  markResultsDirty();
}

function updateEquipmentField(schemeId, equipmentKey, field, value) {
  const scheme = state.schemes.find((item) => item.id === schemeId);
  if (!scheme?.equipment?.[equipmentKey]) return;

  if (field === 'quantity') {
    scheme.equipment[equipmentKey][field] = Math.max(Number(value) || 0, 0);
  } else if (field === 'serviceYears') {
    scheme.equipment[equipmentKey][field] = clamp(value, 1, 30);
  } else if (field === 'maintenanceLevel' || field === 'protectionCapability') {
    scheme.equipment[equipmentKey][field] = clamp(value, 20, 100);
  } else if (field === 'usageFrequency') {
    scheme.equipment[equipmentKey][field] = clamp(value, 1, 12);
  }

  markResultsDirty();
}

function formatScore(value, digits = 1) {
  return Number(value || 0).toFixed(digits);
}

function formatPercent(value, digits = 1) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

watch(missionSignature, () => {
  if (!state.template) {
    return;
  }

  state.assessmentName = `${missionTask.value.name} 消耗评估`;
  markResultsDirty();
  clearError();
});

watch(missionSyncSignature, () => {
  if (!state.template) {
    return;
  }

  applyMissionDrivenSchemes(state.template.schemes);
  clearError();
});

export function useConsumptionWorkflow() {
  return {
    state,
    currentUser,
    missionTask,
    missionTypeMeta,
    engineOptions,
    naturalModels,
    missionModels,
    predictionModels,
    strikeModes,
    phases,
    equipmentTypes,
    activeScheme,
    selectedEngineMeta,
    selectedStrikeModeMeta,
    rankingRows,
    recommendedScheme,
    selectedSchemeResult,
    resultsGeneratedAt,
    workflowSummary,
    activeSchemeSummary,
    summarizeScheme,
    initializeConsumptionWorkflow,
    calculateConsumptionAssessment,
    resetCurrentSchemes,
    setAssessmentName,
    setSelectedEngine,
    setSelectedScheme,
    updateSchemeField,
    updateSchemeNumberField,
    updateMissionField,
    updatePersonnelField,
    updateEquipmentField,
    formatScore,
    formatPercent,
  };
}
