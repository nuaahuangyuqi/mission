<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PlanningThreatMapPanel from '../../components/PlanningThreatMapPanel.vue';
import { usePlanningWorkflow } from '../../modules/planningWorkflow';

const route = useRoute();
const router = useRouter();
const {
  state,
  executionSteps,
  calculatePlanningAssessment,
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
    ['preferredScheme.groups', '推荐编组群'],
    ['preferredScheme.platforms', '推荐平台'],
    ['comparedSchemes', '编组方案对比'],
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
  'force-grouping': ['inputSummary', 'appliedOptions', 'resolvedRuleProfile', 'constraintModel', 'constraintSummary'],
  'target-allocation': ['inputSummary', 'appliedOptions', 'planningBasis', 'preferredPlan.metrics'],
  'airborne-landing-site-selection': ['inputSummary', 'appliedOptions', 'preferredCandidate.metrics', 'planningBasis'],
  'method-planning': ['inputSummary', 'appliedOptions', 'preferredPlan.metrics', 'planningBasis'],
  'support-planning': ['inputSummary', 'appliedOptions', 'preferredPlan.metrics', 'preferredPlan.damageForecast'],
};

const currentStepId = computed(() => String(route.params.stepId || ''));
const currentStepIndex = computed(() => executionSteps.value.findIndex((item) => (
  String(item.stepId) === currentStepId.value
  || String(item.algorithm?.id) === currentStepId.value
)));
const currentStep = computed(() => (
  currentStepIndex.value >= 0 ? executionSteps.value[currentStepIndex.value] : null
));
const currentOutput = computed(() => currentStep.value?.structuredOutput || {});
const previousStep = computed(() => (currentStepIndex.value > 0 ? executionSteps.value[currentStepIndex.value - 1] : null));
const nextStep = computed(() => (
  currentStepIndex.value >= 0 && currentStepIndex.value < executionSteps.value.length - 1
    ? executionSteps.value[currentStepIndex.value + 1]
    : null
));

const metricCards = computed(() => buildMetricCards(currentStep.value, currentOutput.value));
const previewItems = computed(() => {
  const previews = currentStep.value?.outputPreview;
  if (Array.isArray(previews) && previews.length) return previews;
  return [currentStep.value?.summary].filter(Boolean);
});
const artifactItems = computed(() => Array.isArray(currentStep.value?.artifacts) ? currentStep.value.artifacts : []);
const mapData = computed(() => resolveVisualization(currentOutput.value));
const objectSections = computed(() => buildObjectSections(currentStep.value, currentOutput.value));
const tableSections = computed(() => buildTableSections(currentStep.value, currentOutput.value));
const formattedStructuredOutput = computed(() => JSON.stringify(currentOutput.value || {}, null, 2));
const threatFieldPanel = computed(() => buildThreatFieldPanel(currentStep.value, currentOutput.value));

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function truncateText(value, limit = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
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
    return [
      ['推荐方案', output.preferredScheme?.name || '--'],
      ['方案得分', output.preferredScheme?.score ?? '--'],
      ['实际群组', output.actualGroupCount || output.preferredScheme?.groups?.length || 0],
      ['候选单元', output.inputSummary?.candidateCount || output.candidateCount || 0],
    ];
  }
  if (algorithmId === 'target-allocation') {
    return [
      ['推荐方案', output.preferredPlan?.name || '--'],
      ['方案得分', output.preferredPlan?.score ?? '--'],
      ['分配数量', output.preferredPlan?.assignments?.length || 0],
      ['目标覆盖', output.preferredPlan?.metrics?.targetCoverageRate ? `${output.preferredPlan.metrics.targetCoverageRate}%` : '--'],
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

function resolveVisualization(output) {
  const candidates = [
    output.visualization,
    output.preferredPlan?.visualization,
    output.preferredScheme?.visualization,
    output.preferredCandidate?.visualization,
  ].map(safeObject);
  return candidates.find((item) => safeArray(item.entities).length || safeArray(item.environment).length) || {};
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
  if (!Object.keys(heatmap).length && !Object.keys(pointEvaluation).length && !Object.keys(situationMap).length) return null;
  return {
    heatmap,
    situationMap,
    pointThreatEvaluation: pointEvaluation,
    targets: safeArray(output.targetEntities),
    bounds: output.bounds || heatmap.bounds,
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
      .filter(([key, value]) => !used.has(key) && value && typeof value === 'object' && !Array.isArray(value))
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
    if (usedTopLevelKeys.has(key) || !Array.isArray(value) || !value.length) continue;
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
</script>

<template>
  <section class="capability-stage action-stage top-gap planning-result-detail-shell">
    <div v-if="!state.results" class="detail-card compact-empty-state">
      <p class="muted-text">尚未执行任务规划，无法查看单算法结果。</p>
      <div class="planning-task-actions top-gap">
        <button class="button" :disabled="state.calculating || state.loading" @click="handleCalculate">
          {{ state.calculating ? '执行中...' : '执行任务模板' }}
        </button>
        <button class="button button-ghost" @click="goToOverview">返回执行总览</button>
      </div>
    </div>

    <div v-else-if="!currentStep" class="detail-card compact-empty-state">
      <p class="muted-text">没有找到该算法步骤结果。</p>
      <div class="planning-task-actions top-gap">
        <button class="button button-ghost" @click="goToOverview">返回执行总览</button>
      </div>
    </div>

    <template v-else>
      <article class="capability-stage-card planning-result-detail-head">
        <div>
          <span class="eyebrow">Algorithm Result</span>
          <h3>{{ currentStep.algorithm.name }}</h3>
          <p>{{ currentStep.summary }}</p>
          <div class="capability-stage-pill-row top-gap">
            <span class="pill pill-active">步骤 {{ currentStep.order }}</span>
            <span class="pill pill-muted">{{ currentStep.stepName }}</span>
            <span class="pill pill-muted">{{ currentStep.binding.name }}</span>
            <span class="pill pill-muted">{{ formatVariantType(currentStep.binding.type) }}</span>
          </div>
        </div>

        <div class="planning-result-nav">
          <button class="button button-ghost" @click="goToOverview">执行总览</button>
          <button class="button button-ghost" :disabled="!previousStep" @click="goToStep(previousStep)">上一算法</button>
          <button class="button button-secondary" :disabled="!nextStep" @click="goToStep(nextStep)">下一算法</button>
        </div>
      </article>

      <div class="stats-strip compact-grid four-up">
        <div v-for="item in metricCards" :key="item[0]" class="mini-stat">
          <span>{{ item[0] }}</span>
          <strong>{{ item[1] }}</strong>
        </div>
      </div>

      <div class="planning-result-two-column top-gap">
        <article class="detail-card">
          <span class="eyebrow">结果预览</span>
          <ul class="action-text-list top-gap">
            <li v-for="item in previewItems" :key="item">{{ item }}</li>
          </ul>
        </article>

        <article class="detail-card">
          <span class="eyebrow">产物状态</span>
          <ul v-if="artifactItems.length" class="action-text-list top-gap">
            <li v-for="item in artifactItems" :key="item.name">
              {{ item.name }} / {{ item.status || '--' }} / {{ item.description || '--' }}
            </li>
          </ul>
          <p v-else class="muted-text top-gap">当前算法未声明额外产物。</p>
        </article>
      </div>

      <PlanningThreatMapPanel
        v-if="mapData.entities?.length || mapData.environment?.length || threatFieldPanel"
        class="top-gap"
        :title="`${currentStep.algorithm.name} 三维结果`"
        description=""
        :entities="mapData.entities || []"
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
        <details class="planning-result-json">
          <summary>结构化输出 JSON</summary>
          <pre>{{ formattedStructuredOutput }}</pre>
        </details>
      </article>
    </template>
  </section>
</template>
