<script setup>
import { computed, reactive, ref } from 'vue';
import CesiumGlobe from './CesiumGlobe.vue';

const props = defineProps({
  title: { type: String, default: '威胁态势三维展示' },
  description: { type: String, default: '展示敌情威胁区域、覆盖圈和重点部署方向。' },
  entities: { type: Array, default: () => [] },
  environment: { type: Array, default: () => [] },
  threatField: { type: Object, default: null },
});

const CATEGORY_STYLES = {
  '防空阵地': { color: '#ef4444', label: '防空' },
  '火力节点': { color: '#fb7185', label: '火力' },
  '侦察预警': { color: '#facc15', label: '预警' },
  '反机降设施': { color: '#f59e0b', label: '反机降' },
  'C2指挥': { color: '#38bdf8', label: 'C2' },
  '综合目标': { color: '#a3e635', label: '综合' },
};

const layerVisibility = reactive({
  environment: true,
  blueUnits: true,
  redUnits: true,
  detection: true,
  orders: true,
  symbols: true,
});

const inactiveDrawTool = reactive({
  active: false,
  type: 'unit',
  color: '#38bdf8',
  radius: 30000,
  zoneShape: 'polygon',
});

const activeCategory = ref('all');
const activeDetail = ref('targets');
const selectedEntityId = ref('');
const showHeatmap = ref(true);
const showCoverage = ref(true);
const showSectors = ref(true);

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(digits)));
}

function truncateText(value, limit = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text || '--';
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function targetIdOf(target = {}) {
  return String(target.target_id || target.targetId || target.id || '');
}

function categoryOf(target = {}) {
  return String(target.target_category || target.category || target.type || '综合目标');
}

function coordinateOf(target = {}) {
  const coordinates = target.coordinates || target.location || target.center;
  return Array.isArray(coordinates) && coordinates.length >= 2 ? coordinates : null;
}

function colorForCategory(category) {
  return CATEGORY_STYLES[category]?.color || '#a3e635';
}

function normalizeTargets(threatField = {}) {
  const directTargets = safeArray(threatField.targets);
  const situationTargets = safeArray(safeObject(threatField.situationMap).targets);
  const sourceTargets = directTargets.length ? directTargets : situationTargets;
  return sourceTargets
    .map((target, index) => {
      const coordinates = coordinateOf(target);
      if (!coordinates || !isFiniteNumber(coordinates[0]) || !isFiniteNumber(coordinates[1])) return null;
      const category = categoryOf(target);
      return {
        ...target,
        id: targetIdOf(target) || `target-${index + 1}`,
        target_id: targetIdOf(target) || `T-${index + 1}`,
        target_category: category,
        target_name: target.target_name || target.name || category,
        coordinates,
        threat_index: Number(target.threat_index ?? target.threatIndex ?? 0),
        confidence: Number(target.confidence ?? 0),
        color: colorForCategory(category),
      };
    })
    .filter(Boolean);
}

function entityTargetId(entity = {}) {
  const fromId = String(entity.id || '').replace(/^threat-target-/, '');
  return String(entity.meta?.targetId || entity.targetId || fromId);
}

function selectTarget(target = {}) {
  const targetId = targetIdOf(target);
  selectedEntityId.value = targetId ? `threat-target-${targetId}` : '';
}

function filterByTargetCategory(items, category) {
  if (category === 'all') return items;
  const allowedIds = new Set(filteredTargets.value.map((target) => target.target_id));
  return items.filter((item) => {
    const itemCategory = item.target_category || item.category || item.meta?.targetCategory;
    if (itemCategory) return itemCategory === category;
    const itemTargetId = item.targetId || item.target_id || item.meta?.targetId || entityTargetId(item);
    return allowedIds.has(String(itemTargetId));
  });
}

function resolveRows(section) {
  const threatField = safeObject(props.threatField);
  if (section === 'targets') return filteredTargets.value;
  if (section === 'situation') {
    const situationMap = safeObject(threatField.situationMap);
    return [
      { label: '敌方类型', value: situationMap.enemy_force_type },
      { label: '类型置信度', value: formatNumber(situationMap.enemy_force_type_confidence) },
      { label: '抽取来源', value: situationMap.extraction_source },
      { label: '证据数量', value: situationMap.evidence_count },
      { label: '研判摘要', value: situationMap.summary },
      { label: '判断依据', value: situationMap.enemy_force_type_basis },
    ].filter((row) => row.value !== undefined && row.value !== null && row.value !== '');
  }
  if (section === 'matrix') {
    const heatmap = safeObject(threatField.heatmap);
    const matrix = safeObject(heatmap.matrixSummary);
    const projection = safeObject(heatmap.projection);
    return [
      { label: '威胁场模式', value: heatmap.mode },
      { label: '矩阵分辨率', value: heatmap.resolution || matrix.resolution },
      { label: '目标源数量', value: matrix.sourceCount },
      { label: '原始峰值', value: formatNumber(matrix.maxRawThreat, 4) },
      { label: '归一化阈值', value: formatNumber(matrix.normalizationThreshold, 4) },
      { label: 'GeoJSON 采样', value: threatField.geojsonFeatureCount || matrix.sampledFeatureCount },
      { label: '投影模式', value: projection.mode },
      { label: '投影 EPSG', value: projection.epsg },
    ].filter((row) => row.value !== undefined && row.value !== null && row.value !== '');
  }
  const pointEvaluation = safeObject(threatField.pointThreatEvaluation);
  const sources = safeArray(pointEvaluation.threatSources || pointEvaluation.threat_sources);
  return [
    { label: '评估经度', value: pointEvaluation.longitude },
    { label: '评估纬度', value: pointEvaluation.latitude },
    { label: '总威胁', value: formatNumber(pointEvaluation.totalThreat ?? pointEvaluation.total_threat, 4) },
    { label: '归一化威胁', value: formatNumber(pointEvaluation.totalThreatNormalized ?? pointEvaluation.total_threat_normalized, 4) },
    { label: '贡献源数量', value: pointEvaluation.sourceCount },
    ...sources.slice(0, 6).map((source, index) => ({
      label: `贡献 ${index + 1}`,
      value: `${source.target_id || source.target_name || '--'} / ${formatNumber(source.contribution, 4)} / ${formatNumber(source.distance_km)} km`,
    })),
  ].filter((row) => row.value !== undefined && row.value !== null && row.value !== '');
}

const threatFieldData = computed(() => safeObject(props.threatField));
const threatTargets = computed(() => normalizeTargets(threatFieldData.value));
const categories = computed(() => {
  const grouped = new Map();
  threatTargets.value.forEach((target) => {
    const category = categoryOf(target);
    const current = grouped.get(category) || {
      key: category,
      label: CATEGORY_STYLES[category]?.label || category,
      color: colorForCategory(category),
      count: 0,
      maxThreat: 0,
    };
    current.count += 1;
    current.maxThreat = Math.max(current.maxThreat, Number(target.threat_index || 0));
    grouped.set(category, current);
  });
  return [
    {
      key: 'all',
      label: '全部',
      color: '#a3e635',
      count: threatTargets.value.length,
      maxThreat: Math.max(0, ...threatTargets.value.map((target) => Number(target.threat_index || 0))),
    },
    ...Array.from(grouped.values()).sort((left, right) => right.maxThreat - left.maxThreat),
  ];
});
const filteredTargets = computed(() => (
  activeCategory.value === 'all'
    ? threatTargets.value
    : threatTargets.value.filter((target) => categoryOf(target) === activeCategory.value)
));
const rankedTargets = computed(() => (
  [...filteredTargets.value].sort((left, right) => Number(right.threat_index || 0) - Number(left.threat_index || 0))
));
const filteredEntities = computed(() => {
  const entities = safeArray(props.entities);
  const targetEntities = filterByTargetCategory(
    entities.filter((entity) => (
      entity.id?.startsWith?.('threat-target-')
      || entity.meta?.targetId
      || entity.targetId
    )),
    activeCategory.value,
  );
  const targetIds = new Set(targetEntities.map((entity) => entityTargetId(entity)));
  return entities.filter((entity) => {
    if (!showCoverage.value && entity.layerKey === 'detection') return false;
    if (!showSectors.value && entity.layerKey === 'symbols') return false;
    if (activeCategory.value === 'all') return true;
    if (entity.id?.startsWith?.('threat-target-') || entity.meta?.targetId || entity.targetId) {
      return targetEntities.some((item) => item.id === entity.id);
    }
    if (entity.layerKey === 'detection') {
      const id = String(entity.targetId || entity.meta?.targetId || entity.id || '');
      return targetIds.size ? Array.from(targetIds).some((targetId) => id.includes(targetId)) : true;
    }
    return true;
  });
});
const filteredEnvironment = computed(() => {
  if (showCoverage.value) return safeArray(props.environment);
  return safeArray(props.environment).filter((item) => item.kind !== 'threat-heat');
});
const heatmapOverlay = computed(() => {
  const threatField = threatFieldData.value;
  const bounds = safeObject(threatField.bounds || safeObject(threatField.heatmap).bounds);
  const imageBase64 = threatField.heatmapImage || threatField.heatmapBase64 || safeObject(threatField.heatmap).base64Png;
  if (!showHeatmap.value || !imageBase64 || !isFiniteNumber(bounds.west) || !isFiniteNumber(bounds.east)) return [];
  return [{ id: 'threat-spatial-field', imageBase64, bounds, alpha: 0.76 }];
});
const summaryStats = computed(() => {
  const heatmap = safeObject(threatFieldData.value.heatmap);
  const matrix = safeObject(heatmap.matrixSummary);
  const point = safeObject(threatFieldData.value.pointThreatEvaluation);
  return [
    ['目标', filteredTargets.value.length],
    ['类别', Math.max(categories.value.length - 1, 0)],
    ['网格', matrix.resolution || heatmap.resolution || '--'],
    ['点威胁', formatNumber(point.totalThreatNormalized ?? point.total_threat_normalized, 3)],
  ];
});
const detailRows = computed(() => resolveRows(activeDetail.value));
const hasThreatField = computed(() => Boolean(Object.keys(threatFieldData.value).length));
</script>

<template>
  <article class="detail-card planning-threat-map-panel" :class="{ 'planning-threat-map-panel--field': hasThreatField }">
    <div class="section-heading compact planning-threat-map-panel__head">
      <div>
        <h4>{{ title }}</h4>
        <p class="muted-text">{{ description }}</p>
      </div>
      <div v-if="hasThreatField" class="planning-threat-map-panel__stats">
        <span v-for="item in summaryStats" :key="item[0]">
          {{ item[0] }} <strong>{{ item[1] }}</strong>
        </span>
      </div>
    </div>

    <template v-if="hasThreatField">
      <div class="planning-threat-map-panel__toolbar">
        <div class="planning-threat-category-tabs" aria-label="威胁类别切换">
          <button
            v-for="category in categories"
            :key="category.key"
            type="button"
            :class="{ active: activeCategory === category.key }"
            :style="{ '--category-color': category.color }"
            @click="activeCategory = category.key"
          >
            <span>{{ category.label }}</span>
            <strong>{{ category.count }}</strong>
          </button>
        </div>

        <div class="planning-threat-layer-toggles">
          <label>
            <input v-model="showHeatmap" type="checkbox" />
            <span>威胁场</span>
          </label>
          <label>
            <input v-model="showCoverage" type="checkbox" />
            <span>覆盖圈</span>
          </label>
          <label>
            <input v-model="showSectors" type="checkbox" />
            <span>部署区</span>
          </label>
        </div>
      </div>

      <div class="planning-threat-map-workbench">
        <div class="planning-threat-map-stage">
          <CesiumGlobe
            :entities="filteredEntities"
            :environment="filteredEnvironment"
            :image-overlays="heatmapOverlay"
            basemap="auto"
            map-mode="3D"
            terrain-mode="offline"
            :terrain-exaggeration="1"
            :layer-visibility="layerVisibility"
            :draw-tool="inactiveDrawTool"
            :active-entity-id="selectedEntityId"
          />
        </div>

        <aside class="planning-threat-map-side">
          <div class="planning-threat-detail-tabs">
            <button type="button" :class="{ active: activeDetail === 'targets' }" @click="activeDetail = 'targets'">目标</button>
            <button type="button" :class="{ active: activeDetail === 'situation' }" @click="activeDetail = 'situation'">态势</button>
            <button type="button" :class="{ active: activeDetail === 'matrix' }" @click="activeDetail = 'matrix'">矩阵</button>
            <button type="button" :class="{ active: activeDetail === 'point' }" @click="activeDetail = 'point'">点位</button>
          </div>

          <div v-if="activeDetail === 'targets'" class="planning-threat-target-list">
            <button
              v-for="(target, index) in rankedTargets"
              :key="target.target_id"
              type="button"
              class="planning-threat-target-card"
              :class="{ active: selectedEntityId === `threat-target-${target.target_id}` }"
              :style="{ '--target-color': target.color }"
              @click="selectTarget(target)"
            >
              <span class="planning-threat-target-card__rank">#{{ index + 1 }}</span>
              <span class="planning-threat-target-card__body">
                <strong>{{ target.target_id }}</strong>
                <small>{{ target.target_name }} / {{ target.target_category }}</small>
              </span>
              <span class="planning-threat-target-card__score">{{ formatNumber((target.threat_index || 0) * 100, 0) }}</span>
            </button>
            <p v-if="!rankedTargets.length" class="muted-text">当前类别没有可定位目标。</p>
          </div>

          <div v-else class="planning-threat-detail-list">
            <div v-for="row in detailRows" :key="row.label" class="planning-threat-detail-row">
              <span>{{ row.label }}</span>
              <strong>{{ truncateText(row.value, activeDetail === 'situation' ? 180 : 120) }}</strong>
            </div>
            <p v-if="!detailRows.length" class="muted-text">当前类别没有可视化数据。</p>
          </div>
        </aside>
      </div>
    </template>

    <CesiumGlobe
      v-else
      :entities="entities"
      :environment="environment"
      basemap="auto"
      map-mode="3D"
      terrain-mode="offline"
      :terrain-exaggeration="1"
      :layer-visibility="layerVisibility"
      :draw-tool="inactiveDrawTool"
      active-entity-id=""
    />
  </article>
</template>
