<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PlanningForceGroupingPanel from '../../components/PlanningForceGroupingPanel.vue';
import PlanningThreatMapPanel from '../../components/PlanningThreatMapPanel.vue';
import { usePlanningWorkflow } from '../../modules/planningWorkflow';

const props = defineProps({
  stepOverride: {
    type: Object,
    default: null,
  },
  generatedAtOverride: {
    type: String,
    default: '',
  },
  embedded: {
    type: Boolean,
    default: false,
  },
});

const route = useRoute();
const router = useRouter();
const {
  state,
  executionSteps,
  resultsGeneratedAt,
  calculatePlanningAssessment,
  downloadPlanningFile,
  formatVariantType,
} = usePlanningWorkflow();

const FIELD_LABELS = {
  id: '编号',
  name: '名称',
  title: '标题',
  key: '键',
  type: '类型',
  category: '类别',
  status: '状态',
  score: '评分',
  threatLevel: '威胁等级',
  threatScore: '威胁得分',
  enemyUnitCount: '敌方单位',
  identifiedThreatNodeCount: '威胁节点',
  evidenceCount: '证据条目',
  evidenceEntryCount: '证据条目',
  selectedSourceCount: '资源文件',
  uploadedFileCount: '上传文件',
  redIntelligenceCount: '敌方情报',
  environmentCount: '环境要素',
  targetCount: '目标数',
  groupCount: '群组数',
  actualGroupCount: '实际群组',
  candidateCount: '候选数',
  routeCount: '航路数',
  checkpointCount: '检查点',
  coverageRate: '覆盖率',
  gapCount: '缺口',
  reserveRatio: '预备比例',
  sourceName: '来源名称',
  sourceType: '来源类型',
  fileName: '文件名',
  extractedAt: '抽取时间',
  summary: '摘要',
  description: '说明',
  detail: '细节',
  notes: '备注',
  center: '中心坐标',
  location: '位置',
  coordinates: '坐标',
  coverageKm: '覆盖半径',
  radiusMeters: '半径',
  threatValue: '威胁值',
  strength: '强度',
  confidence: '置信度',
  level: '等级',
  role: '角色',
  posture: '态势',
  methodLabel: '方法',
  methodKey: '方法键',
  builtinMethodLabel: '执行方法',
  builtinMethodKey: '方法键',
  mode: '模式',
  resolution: '分辨率',
  projectionMode: '投影模式',
  projectionEpsg: '投影 EPSG',
  maxRawThreat: '原始峰值',
  normalizationThreshold: '归一化阈值',
  sampledFeatureCount: '采样网格点',
  enemy_force_type: '敌方类型',
  enemy_force_type_confidence: '类型置信度',
  enemy_force_type_basis: '类型判断依据',
  extraction_source: '抽取来源',
  evidence_count: '证据数量',
  totalThreat: '总威胁',
  totalThreatNormalized: '归一化威胁',
  total_threat: '总威胁',
  total_threat_normalized: '归一化威胁',
  threat_sources: '贡献来源',
  decay_model: '衰减模型',
  distance_km: '距离(km)',
  contribution: '贡献值',
  base_threat: '基础威胁',
  effective_radius_km: '有效半径(km)',
};

const SECTION_LABELS = {
  inputSummary: '输入摘要',
  appliedOptions: '执行配置',
  algorithmModel: '算法模型',
  sourceCompatibility: '外部算法适配',
  preferredScheme: '推荐编组方案',
  preferredPlan: '推荐方案',
  preferredCandidate: '推荐机降地域',
  planningBasis: '规划依据',
  constraintModel: '约束模型',
  constraintSummary: '约束摘要',
  enemyIntentions: '敌方意图',
  targetEntities: '目标实体',
  threatIndices: '威胁指数',
  deploymentSectors: '部署方向',
  fireCoverage: '火力覆盖',
  airDefenseSystem: '防空体系',
  reconEarlyWarning: '侦察预警',
  antiAirborneFacilities: '反机降设施',
  impactAnalysis: '影响分析',
  selectedSources: '资源库文件',
  importedFiles: '上传文件',
  evidenceTrace: '证据溯源',
  situationMap: 'Situation Map',
  heatmap: '数学威胁场',
  pointThreatEvaluation: '单点威胁评估',
  'preferredScheme.groups': '群组清单',
  'preferredScheme.platforms': '平台清单',
  'preferredPlan.metrics': '方案指标',
  'preferredPlan.assignments': '分配清单',
  'preferredPlan.waves': '波次清单',
  'preferredPlan.routes': '推荐航路',
  'preferredPlan.phases': '阶段时序',
  'preferredPlan.keyActions': '关键行动',
  'preferredPlan.requirements': '保障需求',
  'preferredPlan.allocations': '资源调度',
  'preferredPlan.airspaceWindows': '空域窗口',
  'preferredPlan.matchingAnalysis': '匹配分析',
  'preferredCandidate.metrics': '地域指标',
  'preferredCandidate.riskFactors': '风险因素',
  'preferredCandidate.accessRoutes': '接近路线',
  comparedSchemes: '编组方案对比',
  comparedPlans: '方案对比',
  groups: '群组清单',
  assignments: '分配清单',
  routes: '航路清单',
  checkpoints: '检查点',
  candidates: '候选地域',
  requirements: '保障需求',
  allocations: '资源调度',
  airspaceWindows: '空域窗口',
  recommendations: '建议',
};

const TABLE_SPECS = {
  'enemy-threat-analysis': [
    ['enemyIntentions', '敌方意图'],
    ['targetEntities', '目标实体'],
    ['deploymentSectors', '部署方向'],
    ['fireCoverage', '火力覆盖'],
    ['airDefenseSystem', '防空体系'],
    ['reconEarlyWarning', '侦察预警'],
    ['antiAirborneFacilities', '反机降设施'],
    ['impactAnalysis', '影响分析'],
    ['evidenceTrace', '证据溯源'],
  ],
  'force-grouping': [
    ['targetFirepowerRequirements', '目标威胁火力需求'],
    ['targetCoverage', '目标覆盖情况'],
    ['comparison', '编组方案对比'],
    ['resourceShortfalls', '资源缺口'],
    ['ruleEvidence', '规则证据'],
    ['evidenceTrace', '证据溯源'],
  ],
  'target-allocation': [
    ['preferredPlan.assignments', '推荐分配清单'],
    ['preferredPlan.waves', '打击波次'],
    ['comparedPlans', '分配方案对比'],
    ['validationFindings', '合理性校核'],
    ['adjustmentSuggestions', '调整建议'],
  ],
  'airborne-landing-site-selection': [
    ['candidates', '候选机降地域'],
    ['preferredCandidate.riskFactors', '风险因素'],
    ['preferredCandidate.accessRoutes', '接近路线'],
    ['comparedPlans', '选址方案对比'],
  ],
  'method-planning': [
    ['preferredPlan.routes', '推荐航路'],
    ['preferredPlan.phases', '阶段时序'],
    ['preferredPlan.keyActions', '关键行动'],
    ['comparedPlans', '路径方法对比'],
  ],
  'support-planning': [
    ['preferredPlan.requirements', '保障需求'],
    ['preferredPlan.allocations', '资源调度'],
    ['preferredPlan.airspaceWindows', '空域窗口'],
    ['preferredPlan.matchingAnalysis', '匹配分析'],
    ['comparedPlans', '保障方案对比'],
  ],
};

const OBJECT_SPECS = {
  'enemy-threat-analysis': ['inputSummary', 'appliedOptions', 'algorithmModel', 'sourceCompatibility'],
  'force-grouping': ['inputSummary', 'appliedOptions', 'battlePlannerMetadata', 'constraintSummary', 'threatIntegration'],
  'target-allocation': ['inputSummary', 'appliedOptions', 'planningBasis', 'preferredPlan.metrics'],
  'airborne-landing-site-selection': ['inputSummary', 'appliedOptions', 'preferredCandidate.metrics', 'planningBasis'],
  'method-planning': ['inputSummary', 'appliedOptions', 'preferredPlan.metrics', 'planningBasis'],
  'support-planning': ['inputSummary', 'appliedOptions', 'preferredPlan.metrics', 'preferredPlan.damageForecast'],
};

const hasResultContext = computed(() => Boolean(props.stepOverride || state.results));
const displayGeneratedAt = computed(() => props.generatedAtOverride || resultsGeneratedAt.value);
const currentStepId = computed(() => String(props.stepOverride?.stepId || route.params.stepId || ''));
const currentStepIndex = computed(() => executionSteps.value.findIndex((item) => (
  String(item.stepId) === currentStepId.value
  || String(item.algorithm?.id) === currentStepId.value
)));
const currentStep = computed(() => (
  props.stepOverride || (currentStepIndex.value >= 0 ? executionSteps.value[currentStepIndex.value] : null)
));
const currentOutput = computed(() => currentStep.value?.structuredOutput || {});
const selectedTargetAllocationPlanId = ref('');
const currentStepSummary = computed(() => {
  if (currentStep.value?.algorithm?.id !== 'force-grouping') return currentStep.value?.summary || '';
  const preferred = safeObject(currentOutput.value?.preferredScheme);
  const preferredLabel = preferred.name || preferred.methodLabel || '待确认方案';
  return `智能编组算法完成 ${safeArray(currentOutput.value?.schemes).length} 套方案比选，推荐 ${preferredLabel}。`;
});
const forceGroupingPanelVisible = computed(() => (
  currentStep.value?.algorithm?.id === 'force-grouping'
  && (
    safeArray(currentOutput.value?.schemes).length
    || Object.keys(safeObject(currentOutput.value?.preferredScheme)).length
  )
));
const previousStep = computed(() => (!props.stepOverride && currentStepIndex.value > 0 ? executionSteps.value[currentStepIndex.value - 1] : null));
const nextStep = computed(() => (
  !props.stepOverride && currentStepIndex.value >= 0 && currentStepIndex.value < executionSteps.value.length - 1
    ? executionSteps.value[currentStepIndex.value + 1]
    : null
));

const metricCards = computed(() => buildMetricCards(currentStep.value, currentOutput.value));
const previewItems = computed(() => {
  if (currentStep.value?.algorithm?.id === 'force-grouping') {
    const preferred = safeObject(currentOutput.value?.preferredScheme);
    const preferredLabel = preferred.name || preferred.methodLabel || '--';
    const metrics = safeObject(preferred.metrics);
    const battlePlannerResult = safeObject(currentOutput.value?.battlePlannerResult);
    const threatIntegration = safeObject(currentOutput.value?.threatIntegration);
    if (Object.keys(battlePlannerResult).length) {
      return [
        `推荐方案：${preferredLabel} / ${preferred.score ?? '--'} 分`,
        `编组数量：${safeArray(preferred.groups).length || preferred.actualGroupCount || '--'}`,
        `Battle Planner 任务组：${safeArray(battlePlannerResult.task_groups).length} / 总编组 ${battlePlannerResult.total_groups ?? '--'}`,
        `资源与约束告警：${safeArray(battlePlannerResult.warnings).length}`,
        `约束状态：${currentOutput.value?.constraintSummary?.overallStatus || preferred.constraintEvaluation?.overallStatus || '--'}`,
      ];
    }
    return [
      `推荐方案：${preferredLabel} / ${preferred.score ?? '--'} 分`,
      `编组数量：${safeArray(preferred.groups).length || preferred.actualGroupCount || '--'}`,
      `威胁压力：${threatIntegration.threatPressure ?? '--'} / 高威胁覆盖 ${metrics.highThreatCoverage ?? '--'}`,
      `风险控制：${metrics.threatRiskControl ?? '--'} / 算法 ${currentOutput.value?.algorithmModel || '--'}`,
      `约束状态：${currentOutput.value?.constraintSummary?.overallStatus || preferred.constraintEvaluation?.overallStatus || '--'}`,
    ];
  }
  const previews = currentStep.value?.outputPreview;
  if (Array.isArray(previews) && previews.length) return previews;
  return [currentStep.value?.summary].filter(Boolean);
});
const artifactItems = computed(() => Array.isArray(currentStep.value?.artifacts) ? currentStep.value.artifacts : []);
const threatAnalysisFile = computed(() => (
  currentStep.value?.algorithm?.id === 'enemy-threat-analysis'
    ? buildThreatAnalysisFile(currentStep.value, currentOutput.value, displayGeneratedAt.value)
    : null
));
const generatedFileItems = computed(() => buildGeneratedFileItems(
  currentStep.value,
  currentOutput.value,
  artifactItems.value,
  displayGeneratedAt.value,
));
const structuredOutputFile = computed(() => buildJsonFile({
  key: 'structured-output',
  name: `${currentStep.value?.algorithm?.name || '算法'}结构化输出`,
  description: '当前单算法结果页展示的完整结构化输出。',
  fileName: buildGeneratedFileName(currentStep.value, '结构化输出', 'json', displayGeneratedAt.value),
  data: currentOutput.value,
}));
const mapData = computed(() => resolveVisualization(currentOutput.value));
const threatFieldPanel = computed(() => buildThreatFieldPanel(currentStep.value, currentOutput.value));
const mapEntities = computed(() => {
  const derivedThreatEntities = safeArray(threatFieldPanel.value?.entities);
  if (currentStep.value?.algorithm?.id === 'enemy-threat-analysis' && derivedThreatEntities.length) {
    return derivedThreatEntities;
  }
  return mergeEntities(safeArray(mapData.value.entities), derivedThreatEntities);
});
const targetAllocationPlanOptions = computed(() => buildTargetAllocationPlanOptions(currentOutput.value));
const preferredTargetAllocationPlanId = computed(() => {
  const options = targetAllocationPlanOptions.value;
  const explicitId = String(currentOutput.value?.preferredPlanId || currentOutput.value?.preferredPlan?.id || '');
  if (explicitId && options.some((item) => item.__viewId === explicitId)) return explicitId;
  const explicitMethod = String(currentOutput.value?.preferredPlanMethodKey || currentOutput.value?.preferredPlan?.methodKey || '');
  const explicitStrategy = String(currentOutput.value?.preferredStrategyKey || currentOutput.value?.preferredPlan?.strategyKey || '');
  const matched = options.find((item) => (
    String(item.methodKey || '') === explicitMethod
    && (!explicitStrategy || String(item.strategyKey || '') === explicitStrategy)
  ));
  return matched?.__viewId || options[0]?.__viewId || '';
});
const targetAllocationPanel = computed(() => buildTargetAllocationPanel(
  currentStep.value,
  currentOutput.value,
  selectedTargetAllocationPlanId.value,
));
watch(preferredTargetAllocationPlanId, (value) => {
  selectedTargetAllocationPlanId.value = value || targetAllocationPlanOptions.value[0]?.__viewId || '';
}, { immediate: true });
watch(targetAllocationPlanOptions, (options) => {
  if (!options.some((item) => item.__viewId === selectedTargetAllocationPlanId.value)) {
    selectedTargetAllocationPlanId.value = preferredTargetAllocationPlanId.value || options[0]?.__viewId || '';
  }
});
const objectSections = computed(() => buildObjectSections(currentStep.value, currentOutput.value));
const tableSections = computed(() => buildTableSections(currentStep.value, currentOutput.value));
const formattedStructuredOutput = computed(() => JSON.stringify(currentOutput.value || {}, null, 2));
const heatmapCanvasCache = new WeakMap();
const HEATMAP_DISPLAY_VERSION = 'soft-continuous-v2';
const EMBEDDED_OUTPUT_FIELDS = new Set([
  'assessmentDocxBase64',
  'heatmapBase64',
  'targetMapBase64',
  'combinedMapBase64',
]);
const THREAT_GENERATED_IMAGE_FILES = [
  { key: 'heatmapBase64', name: '威胁热力图', suffix: '威胁热力图', description: '敌情威胁算法生成的透明威胁场热力图。' },
  { key: 'targetMapBase64', name: '目标分布图', suffix: '目标分布图', description: '敌情威胁算法生成的目标位置与评分分布图。' },
  { key: 'combinedMapBase64', name: '综合威胁分析图', suffix: '综合威胁分析图', description: '敌情目标与威胁场叠加后的综合分析图。' },
];
const ARTIFACT_EXPORT_RULES = [
  { pattern: /威胁模型|结构化结果/, keys: ['threatLevel', 'threatScore', 'targetAssessments', 'enemyIntentions', 'deploymentSectors', 'fireCoverage', 'airDefenseSystem', 'reconEarlyWarning', 'antiAirborneFacilities', 'impactAnalysis', 'evidenceTrace'] },
  { pattern: /影响分析/, keys: ['impactAnalysis', 'recommendations', 'evidenceTrace'] },
  { pattern: /热力图|三维|路线/, keys: ['visualization', 'heatmap', 'heatmapGeojson', 'bounds', 'situationMap', 'preferredPlan', 'preferredCandidate'] },
  { pattern: /编组方案/, keys: ['schemes', 'preferredScheme', 'systemBestScheme', 'constraintSummary', 'explanation'] },
  { pattern: /方案比选|方案对比|约束评估|对比表/, keys: ['comparison', 'comparedSchemes', 'comparedPlans', 'schemes', 'constraintModel', 'constraintSummary', 'validationSummary'] },
  { pattern: /推荐结果解释|调整建议|联动建议/, keys: ['explanation', 'recommendations', 'adjustmentSuggestions', 'linkageAnalysis', 'evidenceTrace'] },
  { pattern: /目标分配方案/, keys: ['candidateTargets', 'platforms', 'groups', 'comparedPlans', 'preferredPlan'] },
  { pattern: /合理性验证/, keys: ['validationSummary', 'validation'] },
  { pattern: /候选|地域排序/, keys: ['candidates', 'rankedCandidates', 'preferredCandidate', 'methodComparison', 'linkageAnalysis'] },
  { pattern: /作战方法方案/, keys: ['comparedPlans', 'preferredPlan', 'planningBasis', 'explanation'] },
  { pattern: /时序/, keys: ['preferredPlan', 'planningBasis'] },
  { pattern: /保障需求/, keys: ['preferredPlan', 'damageForecast'] },
  { pattern: /保障资源调度/, keys: ['preferredPlan', 'resourcePool', 'damageForecast'] },
  { pattern: /保障匹配/, keys: ['preferredPlan', 'resourcePool', 'damageForecast'] },
  { pattern: /日志/, keys: ['algorithmModel', 'sourceCompatibility', 'assessmentReport', 'evidenceTrace'] },
];

const THREAT_CATEGORY_META = {
  fire_unit: { label: '火力节点', color: '#fb7185', unitSubtype: 'artillery', coverage: true, sensorType: 'electroOptical' },
  fireCoverage: { label: '火力节点', color: '#fb7185', unitSubtype: 'artillery', coverage: true, sensorType: 'electroOptical' },
  air_defense: { label: '防空阵地', color: '#ef4444', unitSubtype: 'airDefense', coverage: true, sensorType: 'radar' },
  airDefenseSystem: { label: '防空阵地', color: '#ef4444', unitSubtype: 'airDefense', coverage: true, sensorType: 'radar' },
  recon_sensor: { label: '侦察预警', color: '#facc15', unitSubtype: 'radar', coverage: true, sensorType: 'radar' },
  electronic_warfare: { label: '侦察预警', color: '#facc15', unitSubtype: 'radar', coverage: true, sensorType: 'electroOptical' },
  reconEarlyWarning: { label: '侦察预警', color: '#facc15', unitSubtype: 'radar', coverage: true, sensorType: 'radar' },
  fortification: { label: '反机降设施', color: '#f59e0b', unitSubtype: 'engineer', coverage: false },
  antiAirborneFacilities: { label: '反机降设施', color: '#f59e0b', unitSubtype: 'engineer', coverage: false },
  command_control: { label: 'C2指挥', color: '#38bdf8', unitSubtype: 'command', coverage: false },
  mobility_unit: { label: '综合目标', color: '#a3e635', unitSubtype: 'apc', coverage: false },
  logistics_support: { label: '综合目标', color: '#a3e635', unitSubtype: 'transport', coverage: false },
  unknown: { label: '综合目标', color: '#a3e635', unitSubtype: 'tank', coverage: false },
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeGeneratedFilePart(value, fallback = '规划结果') {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72) || fallback;
}

function buildGeneratedTimestamp(value = '') {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  const pad = (item) => String(item).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function buildGeneratedFileName(step, suffix, extension = 'json', generatedAt = '') {
  const stepName = sanitizeGeneratedFilePart(step?.stepName || step?.algorithm?.name || '算法结果');
  const fileSuffix = sanitizeGeneratedFilePart(suffix || '生成文件');
  const timestamp = buildGeneratedTimestamp(generatedAt);
  return `${stepName}-${fileSuffix}${timestamp ? `-${timestamp}` : ''}.${extension}`;
}

function buildJsonFile({
  key,
  name,
  description,
  fileName,
  data,
  status = 'available',
  source = 'artifact',
}) {
  return {
    key,
    name,
    description,
    status,
    source,
    format: 'json',
    fileName,
    package: {
      fileName,
      format: 'json',
      mimeType: 'application/json;charset=utf-8',
      data,
    },
  };
}

function buildThreatAnalysisFile(step, output, generatedAt = '') {
  const docxBase64 = String(output?.assessmentDocxBase64 || '').trim();
  if (docxBase64) {
    const fileName = String(output?.assessmentDocxFileName || '').trim()
      || buildGeneratedFileName(step, '敌情威胁研判分析报告', 'docx', generatedAt);
    return {
      key: 'enemy-threat-assessment-docx',
      name: '敌情威胁研判分析文件',
      description: '敌情威胁算法生成的作战企图、部署态势与威胁摘要 DOCX 研判报告。',
      status: 'available',
      source: 'generated-file',
      format: 'docx',
      fileName,
      package: {
        fileName,
        format: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentBase64: docxBase64,
      },
    };
  }

  return buildJsonFile({
    key: 'enemy-threat-analysis-json',
    name: '敌情威胁分析文件',
    description: '当前结果未包含 DOCX 报告，已提供可归档的结构化分析文件。',
    fileName: buildGeneratedFileName(step, '敌情威胁分析文件', 'json', generatedAt),
    data: withoutEmbeddedFiles(output),
    source: 'generated-file',
  });
}

function withoutEmbeddedFiles(output = {}) {
  return Object.fromEntries(Object.entries(safeObject(output))
    .filter(([key]) => !EMBEDDED_OUTPUT_FIELDS.has(key) && !key.endsWith('Path')));
}

function pickArtifactOutput(output, keys = []) {
  return Object.fromEntries(keys
    .map((key) => [key, output?.[key]])
    .filter(([, value]) => typeof value !== 'undefined' && value !== null));
}

function resolveArtifactOutput(output, artifactName = '') {
  const rule = ARTIFACT_EXPORT_RULES.find((item) => item.pattern.test(String(artifactName || '')));
  if (!rule) return withoutEmbeddedFiles(output);
  const selected = pickArtifactOutput(output, rule.keys);
  return Object.keys(selected).length ? selected : withoutEmbeddedFiles(output);
}

function buildArtifactFile(step, output, artifact, index, generatedAt = '') {
  const directPackage = safeObject(artifact?.download || artifact?.export || artifact);
  const directFileName = String(directPackage.fileName || '').trim();
  const directContentBase64 = String(directPackage.contentBase64 || '').trim();
  const hasDirectContent = directContentBase64
    || typeof directPackage.content === 'string'
    || typeof directPackage.data !== 'undefined';

  if (directFileName && hasDirectContent) {
    return {
      key: `artifact-direct-${index}-${directFileName}`,
      name: artifact.name || directPackage.label || directFileName,
      description: artifact.description || directPackage.description || '算法生成文件。',
      status: artifact.status || 'available',
      source: 'artifact',
      format: directPackage.format || directFileName.split('.').pop() || 'file',
      fileName: directFileName,
      package: {
        ...directPackage,
        fileName: directFileName,
      },
    };
  }

  const artifactName = artifact?.name || `阶段产物 ${index + 1}`;
  return buildJsonFile({
    key: `artifact-json-${index}-${artifactName}`,
    name: artifactName,
    description: artifact?.description || '算法生成的结构化阶段产物。',
    status: artifact?.status || 'available',
    fileName: buildGeneratedFileName(step, artifactName, 'json', generatedAt),
    data: {
      schemaVersion: 'planning-artifact-export-v1',
      generatedAt,
      step: {
        stepId: step?.stepId || '',
        stepName: step?.stepName || '',
        algorithmId: step?.algorithm?.id || '',
        algorithmName: step?.algorithm?.name || '',
        summary: step?.summary || '',
        outputPreview: safeArray(step?.outputPreview),
        binding: safeObject(step?.binding),
        gateway: safeObject(step?.gateway),
        config: safeObject(step?.config),
      },
      artifact: {
        name: artifactName,
        description: artifact?.description || '',
        status: artifact?.status || 'available',
      },
      output: resolveArtifactOutput(output, artifactName),
    },
  });
}

function buildGeneratedFileItems(step, output, artifacts = [], generatedAt = '') {
  if (!step) return [];
  const files = [];
  if (step.algorithm?.id === 'enemy-threat-analysis') {
    files.push(buildThreatAnalysisFile(step, output, generatedAt));
    THREAT_GENERATED_IMAGE_FILES.forEach((spec) => {
      const contentBase64 = String(output?.[spec.key] || '').trim();
      if (!contentBase64) return;
      const fileName = buildGeneratedFileName(step, spec.suffix, 'png', generatedAt);
      files.push({
        key: `enemy-threat-${spec.key}`,
        name: spec.name,
        description: spec.description,
        status: 'available',
        source: 'generated-file',
        format: 'png',
        fileName,
        package: {
          fileName,
          format: 'png',
          mimeType: 'image/png',
          contentBase64,
        },
      });
    });
    if (output?.heatmapGeojson && Object.keys(safeObject(output.heatmapGeojson)).length) {
      const fileName = buildGeneratedFileName(step, '威胁场空间数据', 'geojson', generatedAt);
      files.push({
        key: 'enemy-threat-heatmap-geojson',
        name: '威胁场空间数据',
        description: '敌情威胁算法生成的 GeoJSON 威胁场空间成果。',
        status: 'available',
        source: 'generated-file',
        format: 'geojson',
        fileName,
        package: {
          fileName,
          format: 'geojson',
          mimeType: 'application/geo+json',
          data: output.heatmapGeojson,
        },
      });
    }
  }

  safeArray(artifacts).forEach((artifact, index) => {
    files.push(buildArtifactFile(step, output, artifact, index, generatedAt));
  });
  return files;
}

function isPrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function readPath(source, path) {
  return String(path || '').split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[key];
  }, source);
}

function labelForKey(key) {
  const raw = String(key || '');
  if (FIELD_LABELS[raw]) return FIELD_LABELS[raw];
  if (SECTION_LABELS[raw]) return SECTION_LABELS[raw];
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim() || '--';
}

function formatCoordinate(value) {
  if (!Array.isArray(value) || value.length < 2) return '--';
  return value.slice(0, 3).map((item) => Number(item || 0).toFixed(4)).join(', ');
}

function normalizeCoordinate(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    const altitude = Number(value[2] || 0);
    return Number.isFinite(longitude) && Number.isFinite(latitude)
      ? [longitude, latitude, Number.isFinite(altitude) ? altitude : 0]
      : null;
  }
  if (value && typeof value === 'object') {
    return normalizeCoordinate(value.coordinates || value.center || value.location);
  }
  const numbers = String(value || '').match(/[+-]?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (numbers.length < 2) return null;
  const [longitude, latitude, altitude = 0] = numbers;
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude, altitude] : null;
}

function isValidLonLat(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  return Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && Math.abs(longitude) <= 180
    && Math.abs(latitude) <= 90;
}

function coordinateKey(coordinates) {
  if (!isValidLonLat(coordinates)) return '';
  return `${Number(coordinates[0]).toFixed(5)}:${Number(coordinates[1]).toFixed(5)}`;
}

function targetAllocationUnitSubtype(type = '') {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('air-defense') || normalized.includes('防空')) return 'airDefense';
  if (normalized.includes('recon') || normalized.includes('radar') || normalized.includes('侦察') || normalized.includes('预警')) return 'radar';
  if (normalized.includes('anti-airborne') || normalized.includes('engineer') || normalized.includes('反机降') || normalized.includes('工程')) return 'engineer';
  if (normalized.includes('command') || normalized.includes('指挥')) return 'command';
  if (normalized.includes('transport') || normalized.includes('logistics') || normalized.includes('后勤')) return 'transport';
  return 'artillery';
}

function buildOriginalTargetEntity(rawTarget = {}, index = 0) {
  const coordinates = normalizeCoordinate(rawTarget.coordinates || rawTarget.location?.coordinates || rawTarget.location || rawTarget.center);
  if (!isValidLonLat(coordinates)) return null;
  const id = String(rawTarget.id || rawTarget.sourceTargetId || rawTarget.targetId || rawTarget.allocationTargetId || `original-target-${index + 1}`);
  const name = String(rawTarget.name || rawTarget.sourceTargetName || rawTarget.targetName || rawTarget.label || id);
  const type = String(rawTarget.type || rawTarget.typeLabel || rawTarget.targetType || rawTarget.category || '');
  return {
    id: `allocation-original-target-${id}`,
    name: `原始目标-${name}`,
    type: 'unit',
    camp: 'red',
    layerKey: 'units',
    color: '#ef4444',
    geometryType: 'point',
    coordinates: [coordinates[0], coordinates[1], Number(coordinates[2] || 70)],
    radius: null,
    annotation: `原始目标：${name}；类型：${type || '--'}`,
    visible: true,
    meta: {
      unitSubtype: targetAllocationUnitSubtype(type),
      targetId: id,
      allocationTargetId: String(rawTarget.allocationTargetId || rawTarget.id || ''),
      originalTarget: true,
      showLabel: true,
    },
  };
}

function buildTargetAllocationMapEntities(output = {}, visualization = {}) {
  const sourceEntities = safeArray(visualization.entities).map((entity) => ({
    ...entity,
    meta: { ...(entity.meta || {}) },
  }));
  const existingOriginals = sourceEntities.filter((entity) => String(entity.id || '').startsWith('allocation-original-target-'));
  const syntheticOriginals = existingOriginals.length
    ? []
    : (safeArray(output.originalTargets).length ? safeArray(output.originalTargets) : safeArray(output.candidateTargets))
      .map(buildOriginalTargetEntity)
      .filter(Boolean);
  const originalEntities = existingOriginals.length ? existingOriginals : syntheticOriginals;
  const originalCoordinateKeys = new Set(originalEntities
    .map((entity) => coordinateKey(entity.coordinates))
    .filter(Boolean));
  const originalTargetIds = new Set(originalEntities.flatMap((entity) => [
    entity.meta?.targetId,
    entity.meta?.allocationTargetId,
    String(entity.id || '').replace(/^allocation-original-target-/, ''),
  ].map((item) => String(item || '').trim()).filter(Boolean)));

  const prepared = [...sourceEntities, ...syntheticOriginals].map((entity) => {
    const id = String(entity.id || '');
    const next = {
      ...entity,
      meta: { ...(entity.meta || {}) },
    };
    if (id.startsWith('allocation-original-target-')) {
      next.visible = true;
      next.color = next.color || '#ef4444';
      next.meta.originalTarget = true;
      next.meta.showLabel = true;
      return next;
    }
    if (id.startsWith('allocation-group-') || id.startsWith('allocation-order-')) {
      next.meta.showLabel = false;
      return next;
    }
    if (id.startsWith('allocation-target-')) {
      const targetId = String(next.meta?.targetId || id.replace(/^allocation-target-/, ''));
      const coveredByOriginal = originalTargetIds.has(targetId) || originalCoordinateKeys.has(coordinateKey(next.coordinates));
      next.visible = coveredByOriginal ? false : next.visible !== false;
      next.meta.showLabel = false;
      next.meta.coveredByOriginalTarget = coveredByOriginal;
      return next;
    }
    return next;
  });

  const seen = new Set();
  return prepared.filter((entity) => {
    const id = String(entity.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeBounds(bounds = {}) {
  const source = safeObject(bounds);
  const west = Number(source.west ?? source.minLon);
  const south = Number(source.south ?? source.minLat);
  const east = Number(source.east ?? source.maxLon);
  const north = Number(source.north ?? source.maxLat);
  return Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)
    ? { west, south, east, north }
    : source;
}

function isValidBounds(bounds = {}) {
  return Number.isFinite(Number(bounds.west))
    && Number.isFinite(Number(bounds.south))
    && Number.isFinite(Number(bounds.east))
    && Number.isFinite(Number(bounds.north))
    && Number(bounds.east) > Number(bounds.west)
    && Number(bounds.north) > Number(bounds.south);
}

function heatmapDisplayRange(heatmap = {}) {
  const scores = safeArray(heatmap.grid)
    .map((item) => Number(item?.threatScore || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const statMax = Number(heatmap.statistics?.maxThreat || 0);
  const maxScore = Math.max(statMax, scores[scores.length - 1] || 0, 1);
  if (!scores.length) return { floor: 0, maxScore };
  const percentileIndex = Math.floor((scores.length - 1) * 0.35);
  const percentileFloor = scores[percentileIndex] || 0;
  return {
    floor: Math.min(Math.max(percentileFloor, maxScore * 0.18), maxScore * 0.75),
    maxScore,
  };
}

function heatmapDisplayValue(score, heatmap = {}, displayRange = null) {
  const statistics = safeObject(heatmap.statistics);
  const maxScore = Math.max(Number(displayRange?.maxScore || statistics.maxThreat || 0), 1);
  const floor = Number(displayRange?.floor ?? 0);
  const numericScore = Number(score || 0);
  const rawValue = numericScore / maxScore;
  const floorRatio = floor > 0 ? floor / maxScore : 0;
  const softValue = floorRatio > 0 && rawValue <= floorRatio
    ? 0.1 * (rawValue / Math.max(floorRatio, 1e-9))
    : floorRatio > 0
      ? 0.1 + ((rawValue - floorRatio) / Math.max(1 - floorRatio, 1e-9)) * 0.9
      : rawValue;
  const value = Math.max(0, Math.min(softValue, 1));
  return value <= 0.004 ? 0 : value;
}

function heatmapColor(score, heatmap = {}, displayRange = null) {
  const value = heatmapDisplayValue(score, heatmap, displayRange);
  if (value <= 0) return [0, 0, 0, 0];
  const colorValue = Math.sqrt(value);
  if (colorValue < 0.33) {
    const ratio = colorValue / 0.33;
    return [
      Math.round(34 + ratio * (234 - 34)),
      Math.round(197 + ratio * (179 - 197)),
      Math.round(94 + ratio * (8 - 94)),
      Math.round((value ** 0.85) * 224),
    ];
  }
  if (colorValue < 0.66) {
    const ratio = (colorValue - 0.33) / 0.33;
    return [
      Math.round(234 + ratio * (249 - 234)),
      Math.round(179 + ratio * (115 - 179)),
      Math.round(8 + ratio * (22 - 8)),
      Math.round((value ** 0.85) * 224),
    ];
  }
  const ratio = (colorValue - 0.66) / 0.34;
  return [
    Math.round(249 + ratio * (185 - 249)),
    Math.round(115 + ratio * (28 - 115)),
    Math.round(22 + ratio * (28 - 22)),
    Math.round((value ** 0.85) * 224),
  ];
}

function buildHeatmapCanvasDataUrl(heatmap = {}) {
  if (typeof document === 'undefined' || !heatmap || typeof heatmap !== 'object') return '';
  if (heatmapCanvasCache.has(heatmap)) return heatmapCanvasCache.get(heatmap);
  const grid = safeArray(heatmap.grid);
  const gridSize = Math.round(Math.sqrt(grid.length));
  if (!grid.length || gridSize <= 0 || gridSize * gridSize !== grid.length) return '';

  const imageSize = 960;
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = gridSize;
  sourceCanvas.height = gridSize;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) return '';
  const imageData = sourceContext.createImageData(gridSize, gridSize);
  const displayRange = heatmapDisplayRange(heatmap);
  grid.forEach((item) => {
    const pointId = String(item?.point?.id || '');
    const pointIdParts = pointId.split('-');
    const rowText = pointIdParts[pointIdParts.length - 2];
    const colText = pointIdParts[pointIdParts.length - 1];
    const row = Number(rowText);
    const col = Number(colText);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return;
    const [red, green, blue, alpha] = heatmapColor(item.threatScore, heatmap, displayRange);
    if (alpha <= 0) return;
    const offset = ((gridSize - row - 1) * gridSize + col) * 4;
    imageData.data[offset] = red;
    imageData.data[offset + 1] = green;
    imageData.data[offset + 2] = blue;
    imageData.data[offset + 3] = alpha;
  });
  sourceContext.putImageData(imageData, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = imageSize;
  canvas.height = imageSize;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const blurRadius = Math.max(2, Math.min(18, Math.round((imageSize / gridSize) * 0.72)));
  if ('filter' in context) {
    const padding = Math.ceil(blurRadius * 3);
    const paddedCanvas = document.createElement('canvas');
    paddedCanvas.width = imageSize + padding * 2;
    paddedCanvas.height = imageSize + padding * 2;
    const paddedContext = paddedCanvas.getContext('2d');
    if (!paddedContext) return '';
    paddedContext.imageSmoothingEnabled = true;
    paddedContext.imageSmoothingQuality = 'high';
    paddedContext.drawImage(sourceCanvas, padding, padding, imageSize, imageSize);
    context.filter = `blur(${blurRadius}px)`;
    context.drawImage(paddedCanvas, -padding, -padding);
    context.filter = 'none';
  } else {
    context.drawImage(sourceCanvas, 0, 0, imageSize, imageSize);
  }
  const dataUrl = canvas.toDataURL('image/png');
  heatmapCanvasCache.set(heatmap, dataUrl);
  return dataUrl;
}

function normalizeThreatScore(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return 0;
  return number > 1 ? Math.max(0, Math.min(number / 100, 1)) : Math.max(0, Math.min(number, 1));
}

function threatCategoryMeta(category) {
  return THREAT_CATEGORY_META[String(category || '')] || THREAT_CATEGORY_META.unknown;
}

function booleanOrDefault(value, defaultValue = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return defaultValue;
  if (['false', '0', 'no', '否', '无'].includes(text)) return false;
  if (['true', '1', 'yes', '是', '有'].includes(text)) return true;
  return defaultValue;
}

function textList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

function normalizeThreatTarget(rawTarget = {}, fallbackCategory = 'unknown', index = 0) {
  const coordinates = normalizeCoordinate(
    rawTarget.coordinates
      || rawTarget.center
      || rawTarget.location?.coordinates
      || rawTarget.location
      || rawTarget.geometry?.coordinates,
  );
  if (!isValidLonLat(coordinates)) return null;
  const rawCategory = String(rawTarget.target_category || rawTarget.category || fallbackCategory || 'unknown');
  const meta = threatCategoryMeta(rawCategory);
  const sourceUnitId = rawTarget.sourceUnitId || rawTarget.source_unit_id || rawTarget.sourceTarget?.id || rawTarget.targetId;
  const id = String(rawTarget.target_id || rawTarget.targetId || sourceUnitId || rawTarget.id || `target-${index + 1}`);
  const name = rawTarget.target_name || rawTarget.targetName || rawTarget.name || rawTarget.title || id;
  const coverage = safeObject(rawTarget.coverage);
  const radius = Number(rawTarget.radiusMeters || rawTarget.radius || coverage.radiusMeters || 0);
  const coverageTypes = textList(rawTarget.coverageTypes ?? coverage.coverageTypes);
  return {
    ...rawTarget,
    id,
    target_id: id,
    target_name: name,
    target_category: meta.label,
    sourceCategory: rawCategory,
    coordinates,
    radiusMeters: Number.isFinite(radius) ? radius : 0,
    hasCoverage: booleanOrDefault(rawTarget.hasCoverage ?? coverage.hasCoverage, radius > 0),
    coverageTypes,
    visualizationType: rawTarget.visualizationType || coverage.visualizationType || '',
    threat_index: normalizeThreatScore(
      rawTarget.threat_index
        ?? rawTarget.threatIndex
        ?? rawTarget.threatScore
        ?? rawTarget.threatValue
        ?? rawTarget.strength
        ?? rawTarget.confidence,
    ),
    confidence: normalizeThreatScore(rawTarget.confidenceScore ?? rawTarget.confidence, 0.6),
    color: meta.color,
  };
}

function buildThreatTargets(output = {}) {
  const candidates = [];
  safeArray(output.targetEntities).forEach((item, index) => candidates.push(normalizeThreatTarget(item, item.category, index)));
  safeArray(output.targetAssessments).forEach((item, index) => candidates.push(normalizeThreatTarget(item, item.category, index)));
  [
    ['fireCoverage', 'fireCoverage'],
    ['airDefenseSystem', 'airDefenseSystem'],
    ['reconEarlyWarning', 'reconEarlyWarning'],
    ['antiAirborneFacilities', 'antiAirborneFacilities'],
  ].forEach(([key, category]) => {
    safeArray(output[key]).forEach((item, index) => candidates.push(normalizeThreatTarget(item, category, index)));
  });

  const deduped = new Map();
  candidates.filter(Boolean).forEach((target) => {
    const key = String(target.sourceUnitId || target.target_id || target.id);
    if (!deduped.has(key)) {
      deduped.set(key, target);
      return;
    }
    const previous = deduped.get(key);
    if (!previous.radiusMeters && target.radiusMeters) {
      deduped.set(key, { ...previous, ...target });
    }
  });
  return Array.from(deduped.values());
}

function shouldRenderCoverage(target = {}) {
  const radius = Number(target.radiusMeters || 0);
  if (!Number.isFinite(radius) || radius <= 0 || target.hasCoverage === false) return false;
  const visualizationType = String(target.visualizationType || '').trim().toLowerCase();
  if (['point', 'marker', 'symbol', 'unit', 'none', '无', '点'].includes(visualizationType)) return false;
  if (['coverage', 'circle', 'range', 'area', '覆盖', '范围', '区域'].includes(visualizationType)) return true;
  const coverageTypeText = safeArray(target.coverageTypes).join(' ').toLowerCase();
  if (/(fire|air.?defense|recon|radar|sensor|electronic|coverage|火力|防空|侦察|雷达|探测|电子)/.test(coverageTypeText)) {
    return true;
  }
  return Boolean(threatCategoryMeta(target.sourceCategory).coverage);
}

function buildThreatEntities(targets = []) {
  return safeArray(targets).flatMap((target) => {
    const baseId = String(target.target_id || target.id);
    const visual = threatCategoryMeta(target.sourceCategory);
    const color = target.color || visual.color;
    const point = {
      id: `threat-target-${baseId}`,
      name: target.target_name || baseId,
      type: 'enemy-unit',
      camp: 'red',
      layerKey: 'units',
      color,
      geometryType: 'point',
      coordinates: target.coordinates,
      radius: 0,
      annotation: `${target.target_category || '威胁目标'} / 威胁 ${Math.round(Number(target.threat_index || 0) * 100)}分`,
      visible: true,
      meta: {
        targetId: baseId,
        targetCategory: target.target_category,
        sourceCategory: target.sourceCategory,
        unitSubtype: visual.unitSubtype,
        priorityScore: target.priorityScore,
        valueScore: target.valueScore,
      },
    };
    const radius = Number(target.radiusMeters || 0);
    if (!shouldRenderCoverage(target)) return [point];
    return [
      point,
      {
        id: `threat-coverage-${baseId}`,
        name: `${target.target_name || baseId}覆盖区`,
        type: 'sensor',
        camp: 'red',
        layerKey: 'detection',
        color,
        geometryType: 'circle',
        coordinates: target.coordinates,
        radius,
        annotation: `覆盖半径 ${Number((radius / 1000).toFixed(1))} km`,
        visible: true,
        targetId: baseId,
        meta: {
          targetId: baseId,
          targetCategory: target.target_category,
          sourceCategory: target.sourceCategory,
          sensorType: visual.sensorType || 'radar',
        },
      },
    ];
  });
}

function mergeEntities(primary = [], fallback = []) {
  const merged = new Map();
  [...safeArray(primary), ...safeArray(fallback)].forEach((entity) => {
    if (!entity?.id) return;
    merged.set(String(entity.id), entity);
  });
  return Array.from(merged.values());
}

function formatValue(value) {
  if (value === null || typeof value === 'undefined' || value === '') return '--';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (value.length && value.every((item) => typeof item === 'number')) return formatCoordinate(value);
    if (value.every(isPrimitive)) return value.map((item) => formatValue(item)).join('、') || '--';
    return `${value.length} 项`;
  }
  if (typeof value === 'object') {
    return value.name || value.title || value.label || value.id || `${Object.keys(value).length} 项字段`;
  }
  return String(value);
}

function formatFirepowerBreakdown(value = {}) {
  const breakdown = safeObject(value);
  if (!Object.keys(breakdown).length) return '';
  return `火力构成：武装装备 ${formatValue(breakdown.weaponEquipmentPower)} / 运输人员 ${formatValue(breakdown.transportPersonnelPower)}`;
}

function assignmentFirepowerSummary(assignment = {}) {
  return assignment.firepowerSummary || formatFirepowerBreakdown(assignment.groupFirepowerBreakdown);
}

function normalizeTargetAllocationPlanId(plan = {}, index = 0) {
  return String(
    plan.id
    || plan.planId
    || [
      plan.methodKey || 'allocation-plan',
      plan.strategyKey || plan.strategyLabel || '',
      index + 1,
    ].filter(Boolean).join('-'),
  );
}

function buildTargetAllocationPlanOptions(output = {}) {
  const candidates = safeArray(output.comparedPlans)
    .filter((item) => item && typeof item === 'object')
    .map((plan, index) => ({
      ...plan,
      __viewId: normalizeTargetAllocationPlanId(plan, index),
    }));
  const preferredPlan = safeObject(output.preferredPlan);
  if (Object.keys(preferredPlan).length) {
    const preferredViewId = normalizeTargetAllocationPlanId(preferredPlan, candidates.length);
    const exists = candidates.some((plan) => (
      plan.__viewId === preferredViewId
      || (
        String(plan.methodKey || '') === String(preferredPlan.methodKey || '')
        && String(plan.strategyKey || '') === String(preferredPlan.strategyKey || '')
      )
    ));
    if (!exists) {
      candidates.push({
        ...preferredPlan,
        __viewId: preferredViewId,
      });
    }
  }
  return candidates;
}

function isTargetAllocationPreferredPlan(output = {}, plan = {}) {
  const preferredId = String(output.preferredPlanId || output.preferredPlan?.id || '');
  if (preferredId && String(plan.__viewId || plan.id || '') === preferredId) return true;
  const preferredMethod = String(output.preferredPlanMethodKey || output.preferredPlan?.methodKey || '');
  const preferredStrategy = String(output.preferredStrategyKey || output.preferredPlan?.strategyKey || '');
  return String(plan.methodKey || '') === preferredMethod
    && (!preferredStrategy || String(plan.strategyKey || '') === preferredStrategy);
}

function isTargetAllocationSystemBestPlan(output = {}, plan = {}) {
  const systemBestId = String(output.systemBestPlanId || output.systemBestPlan?.id || '');
  if (systemBestId && String(plan.__viewId || plan.id || '') === systemBestId) return true;
  const systemBestMethod = String(output.systemBestPlanMethodKey || output.systemBestPlan?.methodKey || '');
  const systemBestStrategy = String(output.systemBestPlan?.strategyKey || '');
  return String(plan.methodKey || '') === systemBestMethod
    && (!systemBestStrategy || String(plan.strategyKey || '') === systemBestStrategy);
}

function targetAllocationPlanTitle(plan = {}) {
  return plan.name || plan.methodLabel || plan.strategyLabel || plan.methodKey || '分配方案';
}

function selectTargetAllocationPlan(plan = {}) {
  selectedTargetAllocationPlanId.value = plan.__viewId || normalizeTargetAllocationPlanId(plan);
}

function truncateText(value, limit = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function normalizePercentValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const percent = number > 0 && number <= 1 ? number * 100 : number;
  return Number(percent.toFixed(1));
}

function resolveTargetAllocationCoverage(plan = {}) {
  const metrics = safeObject(plan.metrics);
  const stats = safeObject(plan.stats);
  const objectives = safeObject(plan.objectives);
  return normalizePercentValue(
    metrics.targetCoverageRate
      ?? metrics.coverageRate
      ?? stats.fullCoverRate
      ?? stats.coverRate
      ?? objectives.fullCoverRate
      ?? objectives.partialCoverRate,
  );
}

function buildMetricCards(step, output) {
  const algorithmId = step?.algorithm?.id || '';
  if (algorithmId === 'enemy-threat-analysis') {
    return [
      ['威胁等级', output.threatLevel || '--'],
      ['威胁得分', output.threatScore ?? '--'],
      ['敌方单位', output.enemyUnitCount || 0],
      ['威胁节点', output.identifiedThreatNodeCount || 0],
    ];
  }
  if (algorithmId === 'force-grouping') {
    const metrics = safeObject(output.preferredScheme?.metrics);
    return [
      ['推荐方案', output.preferredScheme?.name || output.preferredScheme?.methodLabel || '--'],
      ['方案得分', output.preferredScheme?.score ?? '--'],
      ['高威胁覆盖', metrics.highThreatCoverage ?? '--'],
      ['风险控制', metrics.threatRiskControl ?? '--'],
    ];
  }
  if (algorithmId === 'target-allocation') {
    const coverage = resolveTargetAllocationCoverage(output.preferredPlan);
    return [
      ['推荐方案', output.preferredPlan?.name || '--'],
      ['方案得分', output.preferredPlan?.score ?? '--'],
      ['分配数量', output.preferredPlan?.assignments?.length || 0],
      ['目标覆盖', coverage === null ? '--' : `${formatValue(coverage)}%`],
    ];
  }
  if (algorithmId === 'airborne-landing-site-selection') {
    return [
      ['推荐地域', output.preferredCandidate?.name || '--'],
      ['地域评分', output.preferredCandidate?.score ?? '--'],
      ['候选数量', output.candidates?.length || 0],
      ['威胁校核', output.preferredCandidate?.metrics?.threatScore ?? '--'],
    ];
  }
  if (algorithmId === 'method-planning') {
    return [
      ['推荐方案', output.preferredPlan?.name || '--'],
      ['方案得分', output.preferredPlan?.score ?? '--'],
      ['航路数量', output.preferredPlan?.routes?.length || 0],
      ['检查点', output.preferredPlan?.metrics?.checkpointCount || 0],
    ];
  }
  if (algorithmId === 'support-planning') {
    return [
      ['推荐方案', output.preferredPlan?.name || '--'],
      ['覆盖率', output.preferredPlan?.metrics?.coverageRate ? `${output.preferredPlan.metrics.coverageRate}%` : '--'],
      ['保障缺口', output.preferredPlan?.metrics?.gapCount || 0],
      ['预备比例', output.preferredPlan?.metrics?.reserveRatio ? `${output.preferredPlan.metrics.reserveRatio}%` : '--'],
    ];
  }
  return [
    ['实现状态', output.implementationStatus || '--'],
    ['执行方法', output.builtinMethodLabel || output.methodLabel || '--'],
    ['结果字段', Object.keys(output || {}).length],
    ['预览条目', previewItems.value.length],
  ];
}

function buildTargetAllocationPanel(step, output = {}, selectedPlanId = '') {
  if (step?.algorithm?.id !== 'target-allocation') return null;
  const planOptions = buildTargetAllocationPlanOptions(output);
  const preferredPlan = safeObject(output.preferredPlan);
  const selectedPlan = planOptions.find((plan) => plan.__viewId === selectedPlanId)
    || planOptions.find((plan) => isTargetAllocationPreferredPlan(output, plan))
    || planOptions[0]
    || preferredPlan;
  const selectedVisualization = safeObject(selectedPlan.visualization || (
    isTargetAllocationPreferredPlan(output, selectedPlan) ? output.visualization : {}
  ));
  const assignments = safeArray(selectedPlan.assignments);
  const comparedPlans = planOptions.map((plan) => {
    const coverage = resolveTargetAllocationCoverage(plan);
    return {
      key: plan.__viewId,
      methodLabel: targetAllocationPlanTitle(plan),
      methodKey: plan.methodKey || '--',
      strategyKey: plan.strategyKey || '',
      strategyLabel: plan.strategyLabel || '',
      score: formatValue(plan.score),
      coverage: coverage === null ? '--' : `${formatValue(coverage)}%`,
      assignmentCount: safeArray(plan.assignments).length,
      usedGroupCount: plan.metrics?.usedGroupCount ?? plan.stats?.usedGroupCount,
      usedUnitCount: plan.metrics?.usedUnitCount ?? plan.stats?.usedUnitCount,
      estimatedLossPercent: plan.metrics?.averageAssignedLossPercent ?? plan.stats?.averageAssignedLossPercent,
      isPreferred: isTargetAllocationPreferredPlan(output, plan),
      isSystemBest: isTargetAllocationSystemBestPlan(output, plan),
      isSelected: String(plan.__viewId || '') === String(selectedPlan.__viewId || ''),
      rawPlan: plan,
    };
  });
  const entities = buildTargetAllocationMapEntities(output, selectedVisualization);
  const environment = safeArray(selectedVisualization.environment);
  if (!Object.keys(preferredPlan).length && !assignments.length && !comparedPlans.length && !entities.length && !environment.length) {
    return null;
  }

  const assignmentArrows = entities.filter((item) => String(item.id || '').startsWith('allocation-order-')).length;
  const coverage = resolveTargetAllocationCoverage(selectedPlan);
  return {
    selectedPlanId: selectedPlan.__viewId || normalizeTargetAllocationPlanId(selectedPlan),
    selectedPlan,
    methodLabel: output.builtinMethodLabel || selectedPlan.methodLabel || '--',
    selectedPlanTitle: targetAllocationPlanTitle(selectedPlan),
    score: formatValue(selectedPlan.score),
    assignmentCount: assignments.length,
    targetCount: safeArray(output.candidateTargets).length,
    groupCount: safeArray(output.groups).length,
    coverage: coverage === null ? '--' : `${formatValue(coverage)}%`,
    entities,
    environment,
    comparedPlans,
    assignments: assignments.slice(0, 8),
    allocationDiagram: buildAllocationDiagram(output, assignments),
    statCards: [
      ['当前方案', selectedPlan.strategyLabel || selectedPlan.methodLabel || '--'],
      ['方案评分', formatValue(selectedPlan.score)],
      ['目标覆盖', coverage === null ? '--' : `${formatValue(coverage)}%`],
      ['分配箭头', assignmentArrows || assignments.length],
      ['使用编组', formatValue(selectedPlan.metrics?.usedGroupCount ?? selectedPlan.stats?.usedGroupCount)],
    ],
  };
}

function buildAllocationDiagram(output = {}, assignments = []) {
  const groupCatalog = new Map(safeArray(output.groups).map((item) => [String(item.id || ''), item]));
  const platformCatalog = new Map(safeArray(output.platforms).map((item) => [String(item.id || ''), item]));
  const targetCatalog = new Map(safeArray(output.candidateTargets).map((item) => [String(item.id || ''), item]));
  const groupMap = new Map();
  const targetMap = new Map();
  const rawLinks = [];

  safeArray(assignments).forEach((assignment, index) => {
    const groupId = String(assignment.groupId || assignment.platformId || `group-${index + 1}`);
    const targetId = String(assignment.targetId || `target-${index + 1}`);
    const group = safeObject(groupCatalog.get(groupId) || platformCatalog.get(String(assignment.platformId || '')) || {});
    const target = safeObject(targetCatalog.get(targetId) || {});

    if (!groupMap.has(groupId)) {
      const firepowerSummary = assignment.firepowerSummary
        || formatFirepowerBreakdown(group.firepowerBreakdown || assignment.groupFirepowerBreakdown);
      const baseMeta = `火力 ${formatValue(group.firepower ?? assignment.groupFirepower)} / 机动 ${formatValue(group.mobility ?? assignment.groupMobility)}`;
      groupMap.set(groupId, {
        id: groupId,
        name: assignment.groupName || group.name || assignment.platformName || groupId,
        subtitle: group.role || group.normalizedRole || assignment.groupRole || assignment.platformRole || '编组',
        meta: firepowerSummary ? `${baseMeta} / ${firepowerSummary}` : baseMeta,
      });
    }
    if (!targetMap.has(targetId)) {
      targetMap.set(targetId, {
        id: targetId,
        name: assignment.targetName || target.name || targetId,
        subtitle: target.typeLabel || target.type || assignment.targetType || '目标',
        meta: `优先级 ${target.priorityLevel || assignment.priorityLevel || '--'} / 重要性 ${formatValue(target.importance ?? assignment.priority)}`,
      });
    }

    rawLinks.push({
      id: assignment.id || `allocation-link-${index + 1}`,
      groupId,
      targetId,
      wave: Number(assignment.wave || 1),
      matchScore: assignment.matchScore,
      feasibilityScore: assignment.feasibilityScore,
      distanceKm: assignment.distanceKm,
      previousTargetId: assignment.previousTargetId,
      previousTargetName: assignment.previousTargetName,
      sequenceOrder: assignment.sequenceOrder,
      sequenceDistanceKm: assignment.sequenceDistanceKm,
      reason: assignment.reason || assignment.summary || '',
      risk: Boolean(
        assignment.reachExceeded
        || assignment.fallbackAssignment
        || assignment.overCapacity
        || assignment.fallbackReason
        || assignment.relaxationLevel
      ),
    });
  });

  const groupNodes = [...groupMap.values()];
  const targetNodes = [...targetMap.values()];
  const nodeWidth = 220;
  const nodeHeight = 76;
  const leftX = 32;
  const rightX = 580;
  const topY = 34;
  const rowGap = 106;
  const rowCount = Math.max(groupNodes.length, targetNodes.length, 1);
  const width = 840;
  const height = Math.max(260, topY * 2 + (rowCount - 1) * rowGap + nodeHeight);

  const layoutNodes = (nodes, x) => nodes.map((node, index) => ({
    ...node,
    x,
    y: topY + index * rowGap,
    width: nodeWidth,
    height: nodeHeight,
    assignmentCount: rawLinks.filter((link) => link.groupId === node.id || link.targetId === node.id).length,
  }));
  const groups = layoutNodes(groupNodes, leftX);
  const targets = layoutNodes(targetNodes, rightX);
  const groupById = new Map(groups.map((node) => [node.id, node]));
  const targetById = new Map(targets.map((node) => [node.id, node]));
  const pairTotals = new Map();
  rawLinks.forEach((link) => {
    const key = `${link.groupId}::${link.targetId}`;
    pairTotals.set(key, (pairTotals.get(key) || 0) + 1);
  });
  const pairSeen = new Map();

  const links = rawLinks
    .map((link) => {
      const group = groupById.get(link.groupId);
      const target = targetById.get(link.targetId);
      if (!group || !target) return null;
      const pairKey = `${link.groupId}::${link.targetId}`;
      const seen = pairSeen.get(pairKey) || 0;
      pairSeen.set(pairKey, seen + 1);
      const total = pairTotals.get(pairKey) || 1;
      const offset = (seen - (total - 1) / 2) * 18;
      const startX = group.x + group.width;
      const startY = group.y + group.height / 2 + offset;
      const endX = target.x;
      const endY = target.y + target.height / 2 - offset;
      const controlPad = Math.max(120, (endX - startX) * 0.42);
      const waveClass = link.wave <= 1 ? 'wave-1' : link.wave === 2 ? 'wave-2' : 'wave-late';
      const color = link.wave <= 1 ? '#facc15' : link.wave === 2 ? '#38bdf8' : '#c084fc';
      return {
        ...link,
        waveClass,
        color,
        markerId: `allocation-arrowhead-${waveClass}`,
        path: `M ${startX} ${startY} C ${startX + controlPad} ${startY}, ${endX - controlPad} ${endY}, ${endX} ${endY}`,
        labelX: (startX + endX) / 2 - 24,
        labelY: (startY + endY) / 2 - 12,
        title: [
          `波次 ${link.wave || '--'}`,
          `匹配 ${link.matchScore ?? '--'}`,
          `可行性 ${link.feasibilityScore ?? '--'}`,
          `距离 ${link.distanceKm ?? '--'} km`,
          link.previousTargetId ? `一波第 ${link.sequenceOrder || '--'} 目标，前序 ${link.previousTargetName || link.previousTargetId}，目标间距 ${link.sequenceDistanceKm ?? '--'} km` : '一波首要目标',
          link.reason,
        ].filter(Boolean).join(' / '),
      };
    })
    .filter(Boolean);

  return {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    groups,
    targets,
    links,
    legend: [
      { key: 'wave-1', label: '第一波', color: '#facc15' },
      { key: 'wave-2', label: '第二波', color: '#38bdf8' },
      { key: 'wave-late', label: '其他波次', color: '#c084fc' },
      { key: 'risk', label: '风险/兜底分配', color: '#fb7185' },
    ],
  };
}

function allocationDiagramCanvasStyle(diagram = {}) {
  return {
    width: `${Number(diagram.width || 840)}px`,
    height: `${Number(diagram.height || 260)}px`,
  };
}

function allocationDiagramNodeStyle(node = {}) {
  return {
    left: `${Number(node.x || 0)}px`,
    top: `${Number(node.y || 0)}px`,
    width: `${Number(node.width || 220)}px`,
    minHeight: `${Number(node.height || 76)}px`,
  };
}

function allocationDiagramRiskStyle(link = {}) {
  return {
    left: `${Number(link.labelX || 0)}px`,
    top: `${Number(link.labelY || 0)}px`,
  };
}

function resolveVisualization(output) {
  const candidates = [
    output.visualization,
    output.preferredPlan?.visualization,
    output.preferredScheme?.visualization,
    output.preferredCandidate?.visualization,
  ].map(safeObject);
  return candidates.find((item) => safeArray(item.entities).length || safeArray(item.environment).length) || {};
}

function resolveOverlayImageBase64(overlay = {}, output = {}, heatmap = {}) {
  const directImage = overlay.imageBase64 || overlay.base64 || overlay.image || overlay.data;
  if (directImage) return directImage;

  const isCurrentHeatmapDisplay = overlay.normalizedForDisplay === true
    && overlay.displayVersion === HEATMAP_DISPLAY_VERSION;
  const field = overlay.imageBase64Field || overlay.base64Field;
  const fieldImage = field ? (output[field] || heatmap[field] || '') : '';
  if (isCurrentHeatmapDisplay && fieldImage) return fieldImage;
  if (!isCurrentHeatmapDisplay) {
    const regeneratedImage = buildHeatmapCanvasDataUrl(heatmap);
    if (regeneratedImage) return regeneratedImage;
  }
  if (fieldImage) return fieldImage;
  return output.heatmapBase64 || heatmap.base64Png || '';
}

function buildHeatmapImageOverlays(output = {}, heatmap = {}, bounds = {}) {
  const visualization = safeObject(output.visualization);
  const explicitOverlays = [
    ...safeArray(visualization.imageOverlays),
    ...safeArray(heatmap.imageOverlays),
  ]
    .map((overlay, index) => {
      const overlayBounds = normalizeBounds(overlay.bounds || overlay.rectangle || overlay.extent || bounds);
      const imageBase64 = resolveOverlayImageBase64(overlay, output, heatmap);
      if (!imageBase64 || !isValidBounds(overlayBounds)) return null;
      return {
        id: overlay.id || `threat-spatial-field-${index + 1}`,
        name: overlay.name || '数学威胁场热力图',
        imageBase64,
        bounds: overlayBounds,
        alpha: Number(overlay.opacity ?? overlay.alpha ?? 0.82),
        zIndex: Number(overlay.zIndex ?? 20),
        visible: overlay.visible !== false,
        displayVersion: overlay.displayVersion || HEATMAP_DISPLAY_VERSION,
      };
    })
    .filter(Boolean);

  if (explicitOverlays.length) return explicitOverlays;

  const imageBase64 = buildHeatmapCanvasDataUrl(heatmap) || output.heatmapBase64 || heatmap.base64Png || '';
  if (!imageBase64 || !isValidBounds(bounds)) return [];
  return [
    {
      id: 'threat-spatial-field',
      name: '数学威胁场热力图',
      imageBase64,
      bounds,
      alpha: 0.82,
      zIndex: 20,
      visible: true,
      displayVersion: HEATMAP_DISPLAY_VERSION,
    },
  ];
}

function buildKeyValueRows(value = {}) {
  return Object.entries(safeObject(value))
    .filter(([, item]) => isPrimitive(item) || Array.isArray(item) || (item && typeof item === 'object'))
    .map(([key, item]) => ({
      key,
      label: labelForKey(key),
      value: formatValue(item),
    }));
}

function buildThreatFieldPanel(step, output) {
  if (step?.algorithm?.id !== 'enemy-threat-analysis') return null;
  const heatmap = safeObject(output.heatmap);
  const matrixSummary = safeObject(heatmap.matrixSummary);
  const projection = safeObject(heatmap.projection);
  const pointEvaluation = safeObject(output.pointThreatEvaluation);
  const situationMap = safeObject(output.situationMap);
  const geojsonFeatureCount = safeArray(output.heatmapGeojson?.features || heatmap.geojson?.features).length;
  const sources = safeArray(pointEvaluation.threatSources || pointEvaluation.threat_sources);
  const targets = buildThreatTargets(output);
  const entities = buildThreatEntities(targets);
  if (!Object.keys(heatmap).length && !Object.keys(pointEvaluation).length && !Object.keys(situationMap).length && !targets.length) return null;
  const bounds = normalizeBounds(output.bounds || heatmap.bounds);
  return {
    heatmap,
    situationMap,
    pointThreatEvaluation: pointEvaluation,
    targets,
    entities,
    bounds,
    imageOverlays: buildHeatmapImageOverlays(output, heatmap, bounds),
    matrixRows: buildKeyValueRows({
      mode: heatmap.mode,
      resolution: heatmap.resolution || matrixSummary.resolution,
      projectionMode: projection.mode,
      projectionEpsg: projection.epsg,
      sourceCount: matrixSummary.sourceCount,
      maxRawThreat: matrixSummary.maxRawThreat,
      normalizationThreshold: matrixSummary.normalizationThreshold,
      sampledFeatureCount: matrixSummary.sampledFeatureCount || geojsonFeatureCount,
    }),
    situationRows: buildKeyValueRows({
      enemy_force_type: situationMap.enemy_force_type,
      enemy_force_type_confidence: situationMap.enemy_force_type_confidence,
      enemy_force_type_basis: situationMap.enemy_force_type_basis,
      extraction_source: situationMap.extraction_source,
      summary: situationMap.summary,
      evidence_count: situationMap.evidence_count,
    }),
    pointRows: buildKeyValueRows({
      longitude: pointEvaluation.longitude,
      latitude: pointEvaluation.latitude,
      totalThreat: pointEvaluation.totalThreat ?? pointEvaluation.total_threat,
      totalThreatNormalized: pointEvaluation.totalThreatNormalized ?? pointEvaluation.total_threat_normalized,
      sourceCount: pointEvaluation.sourceCount,
      projectionMode: pointEvaluation.projection?.mode,
      projectionEpsg: pointEvaluation.projection?.epsg,
    }),
    heatmapImage: output.heatmapBase64 || heatmap.base64Png,
    heatmapBase64: output.heatmapBase64 || heatmap.base64Png,
    heatmapGeojson: output.heatmapGeojson || heatmap.geojson,
    geojsonFeatureCount,
    sources: sources.slice(0, 8),
    sourceColumns: resolveColumns(sources),
  };
}

function buildObjectSections(step, output) {
  const algorithmId = step?.algorithm?.id || '';
  const paths = OBJECT_SPECS[algorithmId] || ['inputSummary', 'appliedOptions'];
  const skippedObjectKeys = algorithmId === 'force-grouping' ? new Set(['preferredScheme']) : new Set();
  const used = new Set();
  return paths.map((path) => {
    const value = safeObject(readPath(output, path));
    if (!Object.keys(value).length) return null;
    used.add(path.split('.')[0]);
    return {
      key: path,
      title: SECTION_LABELS[path] || SECTION_LABELS[path.split('.').at(-1)] || labelForKey(path),
      rows: Object.entries(value)
        .filter(([, item]) => isPrimitive(item) || Array.isArray(item) || (item && typeof item === 'object'))
        .map(([key, item]) => ({
          key,
          label: labelForKey(key),
          value: formatValue(item),
        })),
    };
  }).filter(Boolean).concat(
    Object.entries(output || {})
      .filter(([key, value]) => !used.has(key) && !skippedObjectKeys.has(key) && value && typeof value === 'object' && !Array.isArray(value))
      .filter(([key]) => !['visualization', 'situationMap', 'heatmap', 'pointThreatEvaluation', 'heatmapGeojson', 'bounds', 'assessmentReport'].includes(key))
      .slice(0, 3)
      .map(([key, value]) => ({
        key,
        title: SECTION_LABELS[key] || labelForKey(key),
        rows: Object.entries(value)
          .slice(0, 12)
          .map(([field, item]) => ({ key: field, label: labelForKey(field), value: formatValue(item) })),
      })),
  );
}

function normalizeRows(value) {
  return safeArray(value).map((item, index) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) return item;
    return { id: index + 1, value: item };
  });
}

function resolveColumns(rows) {
  const preferred = [
    'id', 'name', 'title', 'targetName', 'target_id', 'target_category', 'score',
    'threatValue', 'strength', 'confidence', 'coverageKm', 'radiusMeters',
    'level', 'status', 'sourceName', 'sourceType', 'fileName', 'summary',
    'description', 'detail', 'notes',
  ];
  const allKeys = [];
  for (const row of rows.slice(0, 12)) {
    for (const key of Object.keys(row)) {
      if (!allKeys.includes(key) && key !== 'visualization' && key !== 'geometry') {
        allKeys.push(key);
      }
    }
  }
  const ordered = [
    ...preferred.filter((key) => allKeys.includes(key)),
    ...allKeys.filter((key) => !preferred.includes(key)),
  ];
  return ordered.slice(0, 8);
}

function buildTableSections(step, output) {
  const algorithmId = step?.algorithm?.id || '';
  const specs = TABLE_SPECS[algorithmId] || [];
  const skippedArrayKeys = algorithmId === 'force-grouping' ? new Set(['schemes']) : new Set();
  const sections = [];
  const usedTopLevelKeys = new Set();

  for (const [path, title] of specs) {
    const rows = normalizeRows(readPath(output, path));
    if (!rows.length) continue;
    usedTopLevelKeys.add(path.split('.')[0]);
    sections.push({
      key: path,
      title,
      rows,
      columns: resolveColumns(rows),
    });
  }

  for (const [key, value] of Object.entries(output || {})) {
    if (usedTopLevelKeys.has(key) || skippedArrayKeys.has(key) || !Array.isArray(value) || !value.length) continue;
    const rows = normalizeRows(value);
    sections.push({
      key,
      title: SECTION_LABELS[key] || labelForKey(key),
      rows,
      columns: resolveColumns(rows),
    });
  }

  return sections.slice(0, 12);
}

function rowKey(row, index, sectionKey) {
  return `${sectionKey}-${row.id || row.key || row.name || index}`;
}

function goToOverview() {
  router.push({ name: 'planning-tasks-execute', query: route.query });
}

function goToStep(step) {
  if (!step) return;
  router.push({
    name: 'planning-tasks-execute-step',
    params: { stepId: step.stepId || step.algorithm?.id },
    query: route.query,
  });
}

async function handleCalculate() {
  try {
    await calculatePlanningAssessment();
  } catch {
    // Shared workflow state already stores the error message.
  }
}

function handleDownloadFile(file) {
  try {
    downloadPlanningFile(file?.package || file);
  } catch (error) {
    state.errorMessage = error.message || '导出生成文件失败。';
  }
}
</script>

<template>
  <section class="capability-stage action-stage top-gap planning-result-detail-shell">
    <div v-if="!hasResultContext" class="detail-card compact-empty-state">
      <p class="muted-text">尚未执行任务规划，无法查看单算法结果。</p>
      <div v-if="!embedded" class="planning-task-actions top-gap">
        <button class="button" :disabled="state.calculating || state.loading" @click="handleCalculate">
          {{ state.calculating ? '执行中...' : '执行任务模板' }}
        </button>
        <button class="button button-ghost" @click="goToOverview">返回执行总览</button>
      </div>
    </div>

    <div v-else-if="!currentStep" class="detail-card compact-empty-state">
      <p class="muted-text">没有找到该算法步骤结果。</p>
      <div v-if="!embedded" class="planning-task-actions top-gap">
        <button class="button button-ghost" @click="goToOverview">返回执行总览</button>
      </div>
    </div>

    <template v-else>
      <article class="capability-stage-card planning-result-detail-head">
        <div>
          <span class="eyebrow">Algorithm Result</span>
          <h3>{{ currentStep.algorithm.name }}</h3>
          <p>{{ currentStepSummary }}</p>
          <div class="capability-stage-pill-row top-gap">
            <span class="pill pill-active">步骤 {{ currentStep.order }}</span>
            <span class="pill pill-muted">{{ currentStep.stepName }}</span>
            <span class="pill pill-muted">{{ currentStep.binding.name }}</span>
            <span class="pill pill-muted">{{ formatVariantType(currentStep.binding.type) }}</span>
          </div>
        </div>

      <div class="planning-result-nav">
        <button
          v-if="threatAnalysisFile"
          class="button"
          @click="handleDownloadFile(threatAnalysisFile)"
        >
          导出分析文件
        </button>
          <button v-if="!embedded" class="button button-ghost" @click="goToOverview">执行总览</button>
          <button v-if="!embedded" class="button button-ghost" :disabled="!previousStep" @click="goToStep(previousStep)">上一算法</button>
          <button v-if="!embedded" class="button button-secondary" :disabled="!nextStep" @click="goToStep(nextStep)">下一算法</button>
        </div>
      </article>

      <div class="stats-strip compact-grid four-up">
        <div v-for="item in metricCards" :key="item[0]" class="mini-stat">
          <span>{{ item[0] }}</span>
          <strong>{{ item[1] }}</strong>
        </div>
      </div>

      <PlanningForceGroupingPanel
        v-if="forceGroupingPanelVisible"
        class="top-gap"
        :output="currentOutput"
      />

      <article
        v-if="targetAllocationPanel"
        class="capability-stage-card planning-target-allocation-panel top-gap"
      >
        <div class="section-heading compact">
          <div>
            <h3>作战目标分配态势</h3>
            <p>点击下方方案可切换蓝方编组、红方目标、分配箭头、分配清单和方案指标。</p>
          </div>
        </div>

        <div
          v-if="targetAllocationPanel.comparedPlans.length"
          class="planning-grouping-scheme-grid planning-allocation-plan-grid top-gap"
        >
          <button
            v-for="plan in targetAllocationPanel.comparedPlans"
            :key="plan.key"
            type="button"
            class="planning-grouping-scheme-card"
            :class="{ active: plan.isSelected, 'planning-grouping-scheme-card--preferred': plan.isPreferred }"
            :aria-pressed="plan.isSelected"
            @click="selectTargetAllocationPlan(plan.rawPlan)"
          >
            <div class="planning-grouping-scheme-card__head">
              <div>
                <div class="capability-stage-pill-row">
                  <span v-if="plan.isPreferred" class="pill pill-active">推荐</span>
                  <span v-if="plan.isSelected" class="pill pill-muted">当前查看</span>
                  <span v-if="plan.isSystemBest && !plan.isPreferred" class="pill pill-muted">系统最优</span>
                </div>
                <h4>{{ plan.methodLabel }}</h4>
                <small>{{ plan.strategyLabel || plan.methodKey }}</small>
              </div>
              <strong>{{ plan.score }} 分</strong>
            </div>
            <div class="planning-grouping-scheme-card__stats">
              <span>覆盖 {{ plan.coverage }}</span>
              <span>分配 {{ plan.assignmentCount }}</span>
              <span>编组 {{ plan.usedGroupCount ?? '--' }}</span>
              <span>战损 {{ plan.estimatedLossPercent ?? '--' }}</span>
            </div>
          </button>
        </div>

        <div class="stats-strip compact-grid four-up">
          <div v-for="item in targetAllocationPanel.statCards" :key="item[0]" class="mini-stat">
            <span>{{ item[0] }}</span>
            <strong>{{ item[1] }}</strong>
          </div>
        </div>

        <PlanningThreatMapPanel
          v-if="targetAllocationPanel.entities.length || targetAllocationPanel.environment.length"
          class="top-gap planning-target-allocation-map"
          title="作战目标分配态势"
          description="蓝方编组、红方目标和分配箭头来自当前目标分配结构化结果。"
          :entities="targetAllocationPanel.entities"
          :environment="targetAllocationPanel.environment"
          :threat-field="null"
        />

        <article class="detail-card planning-allocation-diagram-card top-gap">
          <div class="planning-allocation-diagram-card__head">
            <div>
              <span class="eyebrow">Assignment Diagram</span>
              <h4>编组-目标分配图</h4>
              <p>左侧为蓝方编组，右侧为红方目标，箭头表示当前查看方案的分配关系。</p>
            </div>
            <div class="planning-allocation-diagram-legend">
              <span
                v-for="item in targetAllocationPanel.allocationDiagram.legend"
                :key="item.key"
              >
                <i :style="{ background: item.color }"></i>{{ item.label }}
              </span>
            </div>
          </div>

          <div
            v-if="targetAllocationPanel.allocationDiagram.links.length"
            class="planning-allocation-diagram-scroll"
          >
            <div
              class="planning-allocation-diagram-canvas"
              :style="allocationDiagramCanvasStyle(targetAllocationPanel.allocationDiagram)"
            >
              <svg
                class="planning-allocation-diagram-svg"
                :viewBox="targetAllocationPanel.allocationDiagram.viewBox"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <marker id="allocation-arrowhead-wave-1" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#facc15"></path>
                  </marker>
                  <marker id="allocation-arrowhead-wave-2" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8"></path>
                  </marker>
                  <marker id="allocation-arrowhead-wave-late" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#c084fc"></path>
                  </marker>
                </defs>
                <path
                  v-for="link in targetAllocationPanel.allocationDiagram.links"
                  :key="link.id"
                  class="planning-allocation-diagram-link"
                  :class="{ 'planning-allocation-diagram-link--risk': link.risk }"
                  :d="link.path"
                  :stroke="link.color"
                  :marker-end="`url(#${link.markerId})`"
                >
                  <title>{{ link.title }}</title>
                </path>
              </svg>

              <div
                v-for="node in targetAllocationPanel.allocationDiagram.groups"
                :key="`group-${node.id}`"
                class="planning-allocation-diagram-node planning-allocation-diagram-node--group"
                :style="allocationDiagramNodeStyle(node)"
              >
                <strong>{{ node.name }}</strong>
                <span>{{ node.subtitle }}</span>
                <small>{{ node.meta }} / 分配 {{ node.assignmentCount }}</small>
              </div>

              <div
                v-for="node in targetAllocationPanel.allocationDiagram.targets"
                :key="`target-${node.id}`"
                class="planning-allocation-diagram-node planning-allocation-diagram-node--target"
                :style="allocationDiagramNodeStyle(node)"
              >
                <strong>{{ node.name }}</strong>
                <span>{{ node.subtitle }}</span>
                <small>{{ node.meta }} / 承担 {{ node.assignmentCount }}</small>
              </div>

              <span
                v-for="link in targetAllocationPanel.allocationDiagram.links.filter((item) => item.risk)"
                :key="`risk-${link.id}`"
                class="planning-allocation-diagram-risk-tag"
                :style="allocationDiagramRiskStyle(link)"
              >
                风险
              </span>
            </div>
          </div>
          <p v-else class="muted-text top-gap">当前推荐方案未返回可绘制分配关系。</p>
        </article>

        <div class="planning-result-two-column top-gap">
          <article class="detail-card">
            <span class="eyebrow">方案指标</span>
            <div v-if="targetAllocationPanel.comparedPlans.length" class="table-shell compact-table top-gap">
              <table>
                <thead>
                  <tr>
                    <th>方法</th>
                    <th>评分</th>
                    <th>覆盖</th>
                    <th>分配</th>
                    <th>标记</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="plan in targetAllocationPanel.comparedPlans"
                    :key="plan.key"
                    :class="{ 'planning-allocation-plan-row--active': plan.isSelected }"
                    @click="selectTargetAllocationPlan(plan.rawPlan)"
                  >
                    <td>{{ plan.methodLabel }}</td>
                    <td>{{ plan.score }}</td>
                    <td>{{ plan.coverage }}</td>
                    <td>{{ plan.assignmentCount }}</td>
                    <td>
                      <span v-if="plan.isSelected" class="pill pill-active">当前查看</span>
                      <span v-else-if="plan.isPreferred" class="pill pill-muted">推荐</span>
                      <span v-else-if="plan.isSystemBest" class="pill pill-muted">系统最优</span>
                      <span v-else class="pill pill-muted">{{ plan.methodKey }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted-text top-gap">当前结果未返回可对比方案。</p>
          </article>

          <article class="detail-card">
            <span class="eyebrow">分配清单</span>
            <div v-if="targetAllocationPanel.assignments.length" class="planning-target-allocation-list top-gap">
              <article
                v-for="(assignment, index) in targetAllocationPanel.assignments"
                :key="assignment.id || `${assignment.groupId}-${assignment.targetId}-${index}`"
                class="planning-target-allocation-item"
              >
                <strong>{{ assignment.groupName || assignment.platformName || assignment.platformId || '编组' }} -> {{ assignment.targetName || assignment.targetId || '目标' }}</strong>
                <p>
                  波次 {{ assignment.wave || '--' }} /
                  匹配 {{ assignment.matchScore ?? '--' }} /
                  可行性 {{ assignment.feasibilityScore ?? '--' }} /
                  距离 {{ assignment.distanceKm ?? '--' }} km
                  <br v-if="assignmentFirepowerSummary(assignment)" />
                  <span v-if="assignmentFirepowerSummary(assignment)">{{ assignmentFirepowerSummary(assignment) }}</span>
                </p>
                <small>{{ assignment.reason || assignment.summary || '结构化分配项' }}</small>
              </article>
            </div>
            <p v-else class="muted-text top-gap">当前推荐方案未返回分配清单。</p>
          </article>
        </div>
      </article>

      <div class="planning-result-two-column top-gap">
        <article class="detail-card">
          <span class="eyebrow">结果预览</span>
          <ul class="action-text-list top-gap">
            <li v-for="item in previewItems" :key="item">{{ item }}</li>
          </ul>
        </article>

        <article class="detail-card">
          <span class="eyebrow">生成文件与阶段产物</span>
          <div v-if="generatedFileItems.length" class="planning-generated-file-list top-gap">
            <article
              v-for="item in generatedFileItems"
              :key="item.key"
              class="planning-generated-file-item"
            >
              <div class="planning-generated-file-copy">
                <div class="planning-generated-file-head">
                  <strong>{{ item.name }}</strong>
                  <span class="pill pill-muted">{{ String(item.format || 'file').toUpperCase() }}</span>
                </div>
                <p>{{ item.description || '算法生成文件。' }}</p>
                <small>{{ item.fileName }} / {{ item.status || '--' }}</small>
              </div>
              <button class="button button-ghost" @click="handleDownloadFile(item)">导出文件</button>
            </article>
          </div>
          <p v-else class="muted-text top-gap">当前算法未声明额外生成文件或阶段产物。</p>
        </article>
      </div>

      <PlanningThreatMapPanel
        v-if="!targetAllocationPanel && (mapEntities.length || mapData.environment?.length || threatFieldPanel)"
        class="top-gap"
        :title="`${currentStep.algorithm.name} 三维结果`"
        description=""
        :entities="mapEntities"
        :environment="mapData.environment || []"
        :threat-field="threatFieldPanel"
      />

      <div v-if="objectSections.length" class="planning-result-two-column top-gap">
        <article v-for="section in objectSections" :key="section.key" class="detail-card">
          <span class="eyebrow">{{ section.title }}</span>
          <div class="table-shell compact-table top-gap">
            <table>
              <tbody>
                <tr v-for="row in section.rows" :key="row.key">
                  <td>{{ row.label }}</td>
                  <td>{{ row.value }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article
        v-for="section in tableSections"
        :key="section.key"
        class="capability-stage-card top-gap"
      >
        <div class="section-heading compact">
          <div>
            <h3>{{ section.title }}</h3>
            <p>{{ section.rows.length }} 条记录，仅展示该算法输出内的结构化明细。</p>
          </div>
        </div>

        <div class="table-shell compact-table top-gap">
          <table>
            <thead>
              <tr>
                <th v-for="column in section.columns" :key="column">{{ labelForKey(column) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in section.rows" :key="rowKey(row, index, section.key)">
                <td v-for="column in section.columns" :key="column">
                  {{ truncateText(formatValue(row[column]), 160) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="detail-card top-gap">
        <div class="planning-generated-files-heading">
          <div>
            <span class="eyebrow">结构化结果文件</span>
            <p class="muted-text">完整保留当前算法输出，便于归档、复核和后续处理。</p>
          </div>
          <button class="button button-ghost" @click="handleDownloadFile(structuredOutputFile)">导出 JSON</button>
        </div>
        <details class="planning-result-json">
          <summary>查看结构化输出 JSON</summary>
          <pre>{{ formattedStructuredOutput }}</pre>
        </details>
      </article>
    </template>
  </section>
</template>
