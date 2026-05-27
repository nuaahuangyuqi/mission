<script setup>
import { computed, reactive, ref, watch } from 'vue';
import CesiumGlobe from './CesiumGlobe.vue';
import MapServiceConfigPanel from './MapServiceConfigPanel.vue';
import { exportKml, exportViewerToPdf, exportViewerToPng } from '../utils/exporters';
import { commandStyles, detectionSensorTypes, unitTypeGroups, zoneShapes } from '../data/situationCatalog';
import { loadMapServiceConfig, resetMapServiceConfig, saveMapServiceConfig } from '../modules/mapServiceConfig';

const props = defineProps({
  entities: { type: Array, default: () => [] },
  environment: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false },
});

const emit = defineEmits(['create-entity', 'update-entity', 'delete-entity']);

const globeRef = ref(null);
const mapStageRef = ref(null);
const basemap = ref('auto');
const mapMode = ref('3D');
const terrainMode = ref('offline');
const terrainExaggeration = ref(1);
const mapServiceConfig = ref(loadMapServiceConfig());
const activeMeasurementMode = ref('');
const activeEntityId = ref('');
const drawStepCount = ref(0);
const drawTool = reactive({ active: false, type: 'unit', color: '#7dd3fc', radius: 30000, zoneShape: 'polygon' });
const layerVisibility = reactive({
  environment: true,
  blueUnits: true,
  redUnits: true,
  detection: true,
  orders: true,
  symbols: true,
});
const editor = reactive({
  id: '',
  name: '新建态势元素',
  type: 'unit',
  camp: 'blue',
  layerKey: 'units',
  color: '#7dd3fc',
  radius: 30000,
  annotation: '',
  visible: true,
  geometryType: 'point',
  longitude: 120.18,
  latitude: 30.28,
  altitude: 0,
  unitSubtype: 'tank',
  sensorType: 'radar',
  detectionHeadingStart: 0,
  detectionHeadingEnd: 360,
  detectionPitchStart: 0,
  detectionPitchEnd: 180,
  commandStyle: 'assault',
  zoneShape: 'polygon',
});
const quickEditor = reactive({ visible: false, x: 24, y: 24 });

const unitPaletteCamps = [
  { key: 'blue', label: '蓝方单位', color: '#38bdf8' },
  { key: 'red', label: '红方单位', color: '#f97316' },
];

const entityStats = computed(() => ({
  blueUnits: props.entities.filter((item) => item.layerKey === 'units' && item.camp === 'blue').length,
  redUnits: props.entities.filter((item) => item.layerKey === 'units' && item.camp === 'red').length,
  detection: props.entities.filter((item) => item.layerKey === 'detection').length,
  orders: props.entities.filter((item) => item.layerKey === 'orders').length,
}));

const filteredExportEntities = computed(() => props.entities.filter((item) => item.visible && isEntityVisible(item)));

function clampTerrainExaggeration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(10, Math.max(0.1, Math.round(numeric * 10) / 10));
}

function setTerrainExaggeration(value) {
  terrainExaggeration.value = clampTerrainExaggeration(value);
}

function saveOnlineMapConfig(config) {
  mapServiceConfig.value = saveMapServiceConfig(config);
  if (mapServiceConfig.value.ionToken || mapServiceConfig.value.imageryUrl || mapServiceConfig.value.token) {
    basemap.value = 'online';
  }
  if (mapServiceConfig.value.ionToken || mapServiceConfig.value.terrainUrl) {
    terrainMode.value = 'online';
  }
}

function resetOnlineMapConfig() {
  mapServiceConfig.value = resetMapServiceConfig();
}

watch(() => props.entities, (list) => {
  if (!list.length) {
    resetEditor();
    closeQuickEditor();
    return;
  }

  const existing = list.find((item) => item.id === activeEntityId.value);
  if (existing) {
    loadEntity(existing);
    return;
  }

  if (!editor.id) return;
  const current = list.find((item) => item.id === editor.id);
  if (current) {
    loadEntity(current);
    return;
  }

  loadEntity(list[0]);
}, { immediate: true, deep: true });

function isEntityVisible(entity) {
  if (!entity.visible) return false;
  if (entity.layerKey === 'units') {
    if (entity.camp === 'blue') return layerVisibility.blueUnits;
    if (entity.camp === 'red') return layerVisibility.redUnits;
    return layerVisibility.blueUnits || layerVisibility.redUnits;
  }
  return Boolean(layerVisibility[entity.layerKey]);
}

function resolveLayerKey(type) {
  if (type === 'unit') return 'units';
  if (type === 'detection') return 'detection';
  if (type === 'order') return 'orders';
  return 'symbols';
}

function resolveGeometryType(type) {
  if (type === 'unit') return 'point';
  if (type === 'detection') return 'circle';
  if (type === 'order') return 'polyline';
  return 'polygon';
}

function normalizeHeadingInput(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = numeric % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function clampPitchInput(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(180, Math.max(-180, numeric));
}

function hasDetectionValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function resolveDetectionRangeMeta(meta = {}) {
  const hasHeadingStart = hasDetectionValue(meta.detectionHeadingStart);
  const hasHeadingEnd = hasDetectionValue(meta.detectionHeadingEnd);
  const hasHeading = hasDetectionValue(meta.detectionHeading);
  const rawHeadingStart = Number(hasHeadingStart ? meta.detectionHeadingStart : (hasHeading ? meta.detectionHeading : 0));
  const rawHeadingEnd = Number(hasHeadingEnd ? meta.detectionHeadingEnd : (hasHeading ? meta.detectionHeading : (hasHeadingStart ? rawHeadingStart : 360)));
  const detectionHeadingStart = normalizeHeadingInput(rawHeadingStart, 0);
  const headingSpan = Math.abs(rawHeadingEnd - rawHeadingStart) >= 360
    ? 360
    : ((normalizeHeadingInput(rawHeadingEnd, detectionHeadingStart) - detectionHeadingStart + 360) % 360);
  const detectionHeadingEnd = headingSpan >= 360
    ? 360
    : normalizeHeadingInput(rawHeadingEnd, detectionHeadingStart);
  const hasPitchStart = hasDetectionValue(meta.detectionPitchStart);
  const hasPitchEnd = hasDetectionValue(meta.detectionPitchEnd);
  const hasPitch = hasDetectionValue(meta.detectionPitch);
  const pitchStart = clampPitchInput(hasPitchStart ? meta.detectionPitchStart : (hasPitch ? meta.detectionPitch : 0), 0);
  const pitchEnd = clampPitchInput(hasPitchEnd ? meta.detectionPitchEnd : (hasPitch ? meta.detectionPitch : (hasPitchStart ? pitchStart : 180)), pitchStart);
  const detectionPitchStart = Math.min(pitchStart, pitchEnd);
  const detectionPitchEnd = Math.max(pitchStart, pitchEnd);
  return {
    detectionHeadingStart,
    detectionHeadingEnd,
    detectionPitchStart,
    detectionPitchEnd,
    detectionHeading: headingSpan >= 360
      ? detectionHeadingStart
      : normalizeHeadingInput(detectionHeadingStart + (headingSpan / 2), detectionHeadingStart),
    detectionPitch: (detectionPitchStart + detectionPitchEnd) / 2,
  };
}

function buildMeta() {
  const detectionMeta = resolveDetectionRangeMeta(editor);
  return {
    unitSubtype: editor.unitSubtype,
    sensorType: editor.sensorType,
    detectionHeadingStart: detectionMeta.detectionHeadingStart,
    detectionHeadingEnd: detectionMeta.detectionHeadingEnd,
    detectionPitchStart: detectionMeta.detectionPitchStart,
    detectionPitchEnd: detectionMeta.detectionPitchEnd,
    detectionHeading: detectionMeta.detectionHeading,
    detectionPitch: detectionMeta.detectionPitch,
    commandStyle: editor.commandStyle,
    zoneShape: editor.zoneShape,
  };
}
function getEntityAnchor(entity) {
  if (!entity) return { longitude: 120.18, latitude: 30.28, altitude: 0 };

  if (entity.geometryType === 'point' || entity.geometryType === 'circle') {
    return {
      longitude: Number(entity.coordinates[0] || 120.18),
      latitude: Number(entity.coordinates[1] || 30.28),
      altitude: Number(entity.coordinates[2] || 0),
    };
  }

  const first = entity.coordinates?.[0] || [120.18, 30.28, 0];
  return {
    longitude: Number(first[0] || 120.18),
    latitude: Number(first[1] || 30.28),
    altitude: Number(first[2] || 0),
  };
}

function normalizeDrawCoordinates(geometryType, coordinates) {
  if (geometryType === 'point' || geometryType === 'circle') {
    return [Number(coordinates[0]), Number(coordinates[1]), Number(coordinates[2] ?? editor.altitude ?? 0)];
  }
  return coordinates.map((point) => [Number(point[0]), Number(point[1]), Number(point[2] ?? editor.altitude ?? 0)]);
}

function translateCoordinates(entity, nextAnchor) {
  const currentAnchor = getEntityAnchor(entity);
  const deltaLongitude = nextAnchor.longitude - currentAnchor.longitude;
  const deltaLatitude = nextAnchor.latitude - currentAnchor.latitude;
  const deltaAltitude = nextAnchor.altitude - currentAnchor.altitude;

  if (entity.geometryType === 'point' || entity.geometryType === 'circle') {
    return [nextAnchor.longitude, nextAnchor.latitude, nextAnchor.altitude];
  }

  return entity.coordinates.map((point) => [
    Number(point[0] || 0) + deltaLongitude,
    Number(point[1] || 0) + deltaLatitude,
    Number(point[2] || 0) + deltaAltitude,
  ]);
}

function resetEditor() {
  editor.id = '';
  editor.name = '新建态势元素';
  editor.type = 'unit';
  editor.camp = 'blue';
  editor.layerKey = 'units';
  editor.color = '#7dd3fc';
  editor.radius = 30000;
  editor.annotation = '';
  editor.visible = true;
  editor.geometryType = 'point';
  editor.longitude = 120.18;
  editor.latitude = 30.28;
  editor.altitude = 0;
  editor.unitSubtype = 'tank';
  editor.sensorType = 'radar';
  editor.detectionHeadingStart = 0;
  editor.detectionHeadingEnd = 360;
  editor.detectionPitchStart = 0;
  editor.detectionPitchEnd = 180;
  editor.commandStyle = 'assault';
  editor.zoneShape = 'polygon';
  activeEntityId.value = '';
  drawTool.active = false;
  drawStepCount.value = 0;
}

function loadEntity(entity) {
  activeEntityId.value = entity.id;
  const anchor = getEntityAnchor(entity);
  editor.id = entity.id;
  editor.name = entity.name;
  editor.type = entity.type;
  editor.camp = entity.camp;
  editor.layerKey = entity.layerKey;
  editor.color = entity.color;
  editor.radius = entity.radius || 30000;
  editor.annotation = entity.annotation || '';
  editor.visible = entity.visible;
  editor.geometryType = entity.geometryType;
  editor.longitude = anchor.longitude;
  editor.latitude = anchor.latitude;
  editor.altitude = anchor.altitude;
  editor.unitSubtype = entity.meta?.unitSubtype || 'tank';
  editor.sensorType = entity.meta?.sensorType || 'radar';
  const detectionMeta = resolveDetectionRangeMeta(entity.meta || {});
  editor.detectionHeadingStart = detectionMeta.detectionHeadingStart;
  editor.detectionHeadingEnd = detectionMeta.detectionHeadingEnd;
  editor.detectionPitchStart = detectionMeta.detectionPitchStart;
  editor.detectionPitchEnd = detectionMeta.detectionPitchEnd;
  editor.commandStyle = entity.meta?.commandStyle || 'assault';
  editor.zoneShape = entity.meta?.zoneShape || 'polygon';
  drawTool.active = false;
  drawStepCount.value = 0;
}

function prepareDraw() {
  if (!props.canManage) return;
  globeRef.value?.cancelMeasurement?.();
  editor.layerKey = resolveLayerKey(editor.type);
  editor.geometryType = resolveGeometryType(editor.type);
  drawTool.active = true;
  drawTool.type = editor.type;
  drawTool.color = editor.color;
  drawTool.radius = Number(editor.radius) || 30000;
  drawTool.zoneShape = editor.zoneShape;
  drawStepCount.value = 0;
  closeQuickEditor();
}

function onDrawProgress(payload) {
  drawStepCount.value = payload.count;
}

function onDrawComplete(payload) {
  if (!props.canManage) return;
  const created = {
    name: editor.name,
    type: editor.type,
    camp: editor.camp,
    layerKey: resolveLayerKey(editor.type),
    color: editor.color,
    geometryType: payload.geometryType,
    coordinates: normalizeDrawCoordinates(payload.geometryType, payload.coordinates),
    radius: payload.geometryType === 'circle' ? Number(payload.radius || editor.radius || 30000) : null,
    annotation: editor.annotation,
    visible: editor.visible,
    meta: buildMeta(),
  };

  const anchor = getEntityAnchor(created);
  editor.longitude = anchor.longitude;
  editor.latitude = anchor.latitude;
  editor.altitude = anchor.altitude;
  drawTool.active = false;
  drawStepCount.value = 0;
  emit('create-entity', created);
}

function saveCurrent() {
  if (!props.canManage || !editor.id) return;
  const current = props.entities.find((item) => item.id === editor.id);
  if (!current) return;

  const nextCoordinates = translateCoordinates(current, {
    longitude: Number(editor.longitude),
    latitude: Number(editor.latitude),
    altitude: Number(editor.altitude),
  });

  emit('update-entity', {
    id: editor.id,
    payload: {
      name: editor.name,
      type: editor.type,
      camp: editor.camp,
      layerKey: resolveLayerKey(editor.type),
      color: editor.color,
      geometryType: resolveGeometryType(editor.type),
      coordinates: nextCoordinates,
      radius: editor.type === 'detection' ? Number(editor.radius || 30000) : null,
      annotation: editor.annotation,
      visible: editor.visible,
      meta: buildMeta(),
    },
  });
}

function reverseOrderDirection() {
  if (!props.canManage || !editor.id || editor.type !== 'order') return;
  const current = props.entities.find((item) => item.id === editor.id);
  if (!current || !Array.isArray(current.coordinates) || current.coordinates.length < 2) return;

  const reversedCoordinates = [...current.coordinates].reverse().map((point) => [...point]);
  const anchor = getEntityAnchor({ ...current, coordinates: reversedCoordinates });
  editor.longitude = anchor.longitude;
  editor.latitude = anchor.latitude;
  editor.altitude = anchor.altitude;

  emit('update-entity', {
    id: editor.id,
    payload: {
      coordinates: reversedCoordinates,
    },
  });
}

function removeCurrent() {
  if (!props.canManage || !editor.id) return;
  emit('delete-entity', editor.id);
  resetEditor();
  closeQuickEditor();
}

function closeQuickEditor() {
  quickEditor.visible = false;
}

function openQuickEditor(x = 24, y = 24) {
  const stage = mapStageRef.value;
  if (!stage || !editor.id) return;
  const maxX = Math.max(24, stage.clientWidth - 360);
  const maxY = Math.max(24, stage.clientHeight - 460);
  quickEditor.x = Math.min(Math.max(Number(x || 24), 16), maxX);
  quickEditor.y = Math.min(Math.max(Number(y || 24), 16), maxY);
  quickEditor.visible = true;
}
function handleEntitySelected(id) {
  if (!id) return;
  const target = props.entities.find((item) => item.id === id);
  if (target) loadEntity(target);
}

function handleEntityEditRequest(request) {
  const payload = typeof request === 'string' ? { id: request, x: 36, y: 36 } : request;
  if (!payload?.id) return;
  handleEntitySelected(payload.id);
  if (props.canManage) openQuickEditor((payload.x || 24) + 12, (payload.y || 24) + 12);
}

function handleEntityDeleteRequest(id) {
  if (!props.canManage) return;
  emit('delete-entity', id);
  if (editor.id === id) {
    resetEditor();
    closeQuickEditor();
  }
}

function handleEntityDragged({ id, coordinates }) {
  if (!props.canManage) return;
  const current = props.entities.find((item) => item.id === id);
  if (!current) return;

  emit('update-entity', { id, payload: { coordinates } });

  if (editor.id === id) {
    const anchor = getEntityAnchor({ ...current, coordinates });
    editor.longitude = anchor.longitude;
    editor.latitude = anchor.latitude;
    editor.altitude = anchor.altitude;
  }
}

function resolveTemplateCoordinates(template, longitude, latitude, altitude) {
  if (template.type === 'unit' || template.type === 'detection') {
    return [longitude, latitude, altitude];
  }

  if (template.type === 'order') {
    return [
      [longitude - 0.18, latitude - 0.08, altitude],
      [longitude + 0.18, latitude + 0.08, altitude],
    ];
  }

  if (template.meta?.zoneShape === 'rectangle') {
    return [
      [longitude - 0.14, latitude - 0.10, altitude],
      [longitude + 0.14, latitude - 0.10, altitude],
      [longitude + 0.14, latitude + 0.10, altitude],
      [longitude - 0.14, latitude + 0.10, altitude],
    ];
  }

  return [
    [longitude - 0.12, latitude - 0.06, altitude],
    [longitude + 0.08, latitude - 0.10, altitude],
    [longitude + 0.16, latitude + 0.02, altitude],
    [longitude + 0.02, latitude + 0.14, altitude],
    [longitude - 0.14, latitude + 0.06, altitude],
  ];
}

function createEntityFromTemplate({ template, longitude, latitude, altitude }) {
  if (!props.canManage) return;
  const payload = {
    name: template?.name || '新建态势元素',
    type: template?.type || 'unit',
    camp: template?.camp || 'blue',
    layerKey: resolveLayerKey(template?.type || 'unit'),
    color: template?.color || '#7dd3fc',
    geometryType: resolveGeometryType(template?.type || 'unit'),
    coordinates: resolveTemplateCoordinates(template, Number(longitude), Number(latitude), Number(altitude || 0)),
    radius: template?.type === 'detection' ? Number(template?.radius || 30000) : null,
    annotation: template?.annotation || '由地图快捷创建',
    visible: true,
    meta: {
      unitSubtype: template?.meta?.unitSubtype || 'tank',
      sensorType: template?.meta?.sensorType || 'radar',
      ...resolveDetectionRangeMeta(template?.meta || {}),
      commandStyle: template?.meta?.commandStyle || 'assault',
      zoneShape: template?.meta?.zoneShape || 'polygon',
    },
  };

  emit('create-entity', payload);
}

function startPaletteDrag(item, event) {
  if (!props.canManage || !event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('application/mission-entity', JSON.stringify(item));
  event.dataTransfer.setData('text/plain', JSON.stringify(item));
}

async function doExportPng() {
  const viewer = globeRef.value?.getViewer?.();
  if (viewer) await exportViewerToPng(viewer, '态势图.png');
}

async function doExportPdf() {
  const viewer = globeRef.value?.getViewer?.();
  if (viewer) await exportViewerToPdf(viewer, '态势图.pdf');
}

function doExportKml() {
  exportKml(filteredExportEntities.value, '态势图.kml');
}

function startDistanceMeasurement() {
  if (drawTool.active) return;
  globeRef.value?.startMeasurement?.('distance');
}

function startAreaMeasurement() {
  if (drawTool.active) return;
  globeRef.value?.startMeasurement?.('area');
}

function clearMapMeasurements() {
  globeRef.value?.clearMeasurements?.();
}

function handleMeasurementStateChange(state) {
  activeMeasurementMode.value = state?.active ? String(state.type || '') : '';
}
</script>
<template>
  <div class="situation-layout">
    <section class="glass-card map-card">
      <div class="section-heading compact">
        <div>
          <h3>态势编辑与展示</h3>
        </div>
      </div>

      <div ref="mapStageRef" class="map-stage">
        <CesiumGlobe
          ref="globeRef"
          :entities="entities"
          :environment="environment"
          :basemap="basemap"
          :map-mode="mapMode"
          :terrain-mode="terrainMode"
          :terrain-exaggeration="terrainExaggeration"
          :map-service-config="mapServiceConfig"
          :layer-visibility="layerVisibility"
          :draw-tool="drawTool"
          :active-entity-id="activeEntityId"
          :can-manage="canManage"
          @draw-progress="onDrawProgress"
          @draw-complete="onDrawComplete"
          @entity-selected="handleEntitySelected"
          @entity-edit-request="handleEntityEditRequest"
          @entity-delete-request="handleEntityDeleteRequest"
          @entity-dragged="handleEntityDragged"
          @entity-drop-create="createEntityFromTemplate"
          @measurement-state-change="handleMeasurementStateChange"
        />

        <div v-if="quickEditor.visible && editor.id" class="entity-edit-popover" :style="{ left: `${quickEditor.x}px`, top: `${quickEditor.y}px` }">
          <div class="entity-edit-popover__header">
            <strong>属性编辑</strong>
            <button class="button-icon" type="button" @click="closeQuickEditor">×</button>
          </div>
          <div class="entity-edit-popover__body">
            <label>
              名称
              <input v-model="editor.name" type="text" />
            </label>
            <label>
              元素类型
              <select v-model="editor.type">
                <option value="unit">单位点</option>
                <option value="detection">探测球</option>
                <option value="order">命令线</option>
                <option value="zone">区域标绘</option>
              </select>
            </label>
            <label>
              阵营
              <select v-model="editor.camp">
                <option value="blue">蓝方</option>
                <option value="red">红方</option>
                <option value="neutral">中立</option>
              </select>
            </label>
            <label>
              颜色
              <input v-model="editor.color" type="color" />
            </label>
            <label v-if="editor.type === 'unit'">
              单位类型
              <select v-model="editor.unitSubtype">
                <optgroup v-for="group in unitTypeGroups" :key="group.key" :label="group.label">
                  <option v-for="item in group.items" :key="item.key" :value="item.key">{{ item.label }}</option>
                </optgroup>
              </select>
            </label>
            <label v-if="editor.type === 'detection'">
              传感器类型
              <select v-model="editor.sensorType">
                <option v-for="sensor in detectionSensorTypes" :key="sensor.key" :value="sensor.key">{{ sensor.label }}</option>
              </select>
            </label>
            <label v-if="editor.type === 'detection'">
              方位起始（度）
              <input v-model.number="editor.detectionHeadingStart" type="number" min="0" max="360" step="1" />
            </label>
            <label v-if="editor.type === 'detection'">
              方位结束（度）
              <input v-model.number="editor.detectionHeadingEnd" type="number" min="0" max="360" step="1" />
            </label>
            <label v-if="editor.type === 'detection'">
              俯仰起始（度，正上负下）
              <input v-model.number="editor.detectionPitchStart" type="number" min="-180" max="180" step="1" />
            </label>
            <label v-if="editor.type === 'detection'">
              俯仰结束（度，正上负下）
              <input v-model.number="editor.detectionPitchEnd" type="number" min="-180" max="180" step="1" />
            </label>
            <label v-if="editor.type === 'order'">
              箭头样式
              <select v-model="editor.commandStyle">
                <option v-for="style in commandStyles" :key="style.key" :value="style.key">{{ style.label }}</option>
              </select>
            </label>
            <label v-if="editor.type === 'order'">
              方向调整
              <button class="button button-ghost" type="button" @click="reverseOrderDirection">反转命令线方向</button>
            </label>
            <label v-if="editor.type === 'zone'">
              区域形状
              <select v-model="editor.zoneShape">
                <option v-for="shape in zoneShapes" :key="shape.key" :value="shape.key">{{ shape.label }}</option>
              </select>
            </label>
            <label>
              经度
              <input v-model.number="editor.longitude" type="number" step="0.0001" />
            </label>
            <label>
              纬度
              <input v-model.number="editor.latitude" type="number" step="0.0001" />
            </label>
            <label>
              高度（米）
              <input v-model.number="editor.altitude" type="number" step="1" />
            </label>
            <label v-if="editor.type === 'detection'">
              半径（米）
              <input v-model.number="editor.radius" type="number" min="100" />
            </label>
            <label class="full-span">
              注释
              <textarea v-model="editor.annotation" rows="3" />
            </label>
          </div>
          <div class="toolbar-row wrap">
            <button class="button" @click="saveCurrent(); closeQuickEditor()">保存</button>
            <button v-if="editor.type === 'order'" class="button button-ghost" type="button" @click="reverseOrderDirection">反转方向</button>
            <button class="button button-ghost" @click="closeQuickEditor">收起</button>
          </div>
        </div>
      </div>

    </section>

    <section class="glass-card sidebar-card">
      <div class="section-heading compact">
        <div>
          <h3>态势交互与导出</h3>
        </div>
      </div>

      <div class="stats-strip compact-grid four-up">
        <div class="mini-stat"><span>蓝方单位</span><strong>{{ entityStats.blueUnits }}</strong></div>
        <div class="mini-stat"><span>红方单位</span><strong>{{ entityStats.redUnits }}</strong></div>
        <div class="mini-stat"><span>探测球</span><strong>{{ entityStats.detection }}</strong></div>
        <div class="mini-stat"><span>命令线</span><strong>{{ entityStats.orders }}</strong></div>
      </div>

      <div class="panel-group top-gap">
        <h4>视图模式</h4>
        <div class="segmented-row">
          <button class="segmented" :class="{ active: mapMode === '3D' }" @click="mapMode = '3D'">三维地球</button>
          <button class="segmented" :class="{ active: mapMode === '2D' }" @click="mapMode = '2D'">二维地图</button>
        </div>
      </div>

      <div class="panel-group top-gap">
        <h4>底图选择</h4>
        <div class="segmented-row">
          <button class="segmented" :class="{ active: basemap === 'auto' }" @click="basemap = 'auto'">自动</button>
          <button class="segmented" :class="{ active: basemap === 'offline' }" @click="basemap = 'offline'">离线瓦片</button>
          <button class="segmented" :class="{ active: basemap === 'online' }" @click="basemap = 'online'">在线 API</button>
        </div>
      </div>

      <div class="panel-group top-gap">
        <h4>地形数据</h4>
        <div class="segmented-row">
          <button class="segmented" :class="{ active: terrainMode === 'flat' }" @click="terrainMode = 'flat'">平面</button>
          <button class="segmented" :class="{ active: terrainMode === 'offline' }" @click="terrainMode = 'offline'">离线 DEM</button>
          <button class="segmented" :class="{ active: terrainMode === 'online' }" @click="terrainMode = 'online'">在线 DEM</button>
        </div>
        <div class="terrain-exaggeration-control top-gap">
          <div class="terrain-exaggeration-control__header">
            <span>夸张程度</span>
            <strong>{{ terrainExaggeration.toFixed(1) }}×</strong>
          </div>
          <div class="terrain-exaggeration-control__row">
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              :value="terrainExaggeration"
              @input="setTerrainExaggeration($event.target.value)"
            />
            <input
              class="terrain-exaggeration-control__value"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              :value="terrainExaggeration"
              @change="setTerrainExaggeration($event.target.value)"
            />
            <button class="button button-ghost" @click="setTerrainExaggeration(1)">1×</button>
          </div>
        </div>
        <MapServiceConfigPanel
          :model-value="mapServiceConfig"
          @save="saveOnlineMapConfig"
          @reset="resetOnlineMapConfig"
        />
      </div>

      <div class="panel-group top-gap">
        <h4>图层控制</h4>
        <div class="switch-grid">
          <label><input v-model="layerVisibility.environment" type="checkbox" /> 环境图层</label>
          <label><input v-model="layerVisibility.blueUnits" type="checkbox" /> 蓝方单位</label>
          <label><input v-model="layerVisibility.redUnits" type="checkbox" /> 红方单位</label>
          <label><input v-model="layerVisibility.detection" type="checkbox" /> 探测球</label>
          <label><input v-model="layerVisibility.orders" type="checkbox" /> 命令线</label>
          <label><input v-model="layerVisibility.symbols" type="checkbox" /> 区域标绘</label>
        </div>
      </div>

      <div class="panel-group top-gap">
        <h4>地图测量</h4>
        <div class="toolbar-row wrap top-gap">
          <button
            :class="activeMeasurementMode === 'distance' ? 'button' : 'button button-ghost'"
            @click="startDistanceMeasurement"
            :disabled="drawTool.active"
          >
            距离测量
          </button>
          <button
            :class="activeMeasurementMode === 'area' ? 'button' : 'button button-ghost'"
            @click="startAreaMeasurement"
            :disabled="drawTool.active"
          >
            面积测量
          </button>
          <button class="button button-ghost" @click="clearMapMeasurements">清空测量</button>
        </div>
      </div>

      <div class="panel-group top-gap">
        <h4>元素列表</h4>

        <div class="palette-stack">
          <details v-for="camp in unitPaletteCamps" :key="camp.key" class="palette-section" open>
            <summary>{{ camp.label }}</summary>
            <div class="palette-stack top-gap">
              <details v-for="section in unitTypeGroups" :key="`${camp.key}-${section.key}`" class="palette-subsection" open>
                <summary>{{ section.label }}</summary>
                <div class="palette-grid palette-grid--compact top-gap">
                  <button
                    v-for="group in section.items"
                    :key="`${camp.key}-${section.key}-${group.key}`"
                    class="palette-item"
                    :draggable="canManage"
                    :disabled="!canManage"
                    @dragstart="startPaletteDrag({ name: `${camp.label}-${group.label}`, type: 'unit', camp: camp.key, color: camp.color, meta: { unitSubtype: group.key }, annotation: `${camp.label} / ${group.label}` }, $event)"
                  >
                    <div class="palette-item__head">
                      <span class="palette-code" :class="camp.key === 'blue' ? 'palette-code--blue' : 'palette-code--red'">{{ group.code }}</span>
                      <span class="palette-meta">{{ section.label }}</span>
                    </div>
                    <strong>{{ group.label }}</strong>
                    <small>{{ group.role }}</small>
                  </button>
                </div>
              </details>
            </div>
          </details>

          <details class="palette-section" open>
            <summary>探测球</summary>
            <div class="palette-grid palette-grid--compact top-gap">
              <button
                v-for="sensor in detectionSensorTypes"
                :key="sensor.key"
                class="palette-item"
                :draggable="canManage"
                :disabled="!canManage"
                @dragstart="startPaletteDrag({ name: sensor.label, type: 'detection', camp: 'blue', color: sensor.color, radius: 30000, meta: { sensorType: sensor.key, detectionHeadingStart: 0, detectionHeadingEnd: 360, detectionPitchStart: 0, detectionPitchEnd: 180 }, annotation: sensor.description }, $event)"
              >
                <div class="palette-item__head">
                  <span class="palette-code palette-code--sensor">{{ sensor.code }}</span>
                  <span class="palette-meta">Sensor</span>
                </div>
                <strong>{{ sensor.label }}</strong>
                <small>{{ sensor.description }}</small>
              </button>
            </div>
          </details>

          <details class="palette-section" open>
            <summary>命令线样式</summary>
            <div class="palette-grid palette-grid--compact top-gap">
              <button
                v-for="style in commandStyles"
                :key="style.key"
                class="palette-item"
                :draggable="canManage"
                :disabled="!canManage"
                @dragstart="startPaletteDrag({ name: style.label, type: 'order', camp: 'neutral', color: '#facc15', meta: { commandStyle: style.key }, annotation: style.label }, $event)"
              >
                <div class="palette-item__head">
                  <span class="palette-code palette-code--order">ORD</span>
                  <span class="palette-meta">Style</span>
                </div>
                <strong>{{ style.label }}</strong>
                <small>{{ style.key }}</small>
              </button>
            </div>
          </details>

          <details class="palette-section" open>
            <summary>区域标绘</summary>
            <div class="palette-grid palette-grid--compact top-gap">
              <button
                v-for="shape in zoneShapes"
                :key="shape.key"
                class="palette-item"
                :draggable="canManage"
                :disabled="!canManage"
                @dragstart="startPaletteDrag({ name: shape.label, type: 'zone', camp: 'neutral', color: '#c084fc', meta: { zoneShape: shape.key }, annotation: shape.label }, $event)"
              >
                <div class="palette-item__head">
                  <span class="palette-code palette-code--zone">AREA</span>
                  <span class="palette-meta">Zone</span>
                </div>
                <strong>{{ shape.label }}</strong>
                <small>{{ shape.key }}</small>
              </button>
            </div>
          </details>
        </div>
      </div>

      <div class="panel-group top-gap">
        <h4>态势编辑器</h4>
        <fieldset class="permission-fieldset" :disabled="!canManage">
          <div class="form-grid">
            <label>
              名称
              <input v-model="editor.name" type="text" />
            </label>
            <label>
              元素类型
              <select v-model="editor.type">
                <option value="unit">单位点</option>
                <option value="detection">探测球</option>
                <option value="order">命令线</option>
                <option value="zone">区域标绘</option>
              </select>
            </label>
            <label>
              阵营
              <select v-model="editor.camp">
                <option value="blue">蓝方</option>
                <option value="red">红方</option>
                <option value="neutral">中立</option>
              </select>
            </label>
            <label>
              颜色
              <input v-model="editor.color" type="color" />
            </label>
            <label v-if="editor.type === 'unit'">
              单位类型
              <select v-model="editor.unitSubtype">
                <optgroup v-for="group in unitTypeGroups" :key="group.key" :label="group.label">
                  <option v-for="item in group.items" :key="item.key" :value="item.key">{{ item.label }}</option>
                </optgroup>
              </select>
            </label>
            <label v-if="editor.type === 'detection'">
              传感器类型
              <select v-model="editor.sensorType">
                <option v-for="sensor in detectionSensorTypes" :key="sensor.key" :value="sensor.key">{{ sensor.label }}</option>
              </select>
            </label>
            <label v-if="editor.type === 'detection'">
              方位起始（度）
              <input v-model.number="editor.detectionHeadingStart" type="number" min="0" max="360" step="1" />
            </label>
            <label v-if="editor.type === 'detection'">
              方位结束（度）
              <input v-model.number="editor.detectionHeadingEnd" type="number" min="0" max="360" step="1" />
            </label>
            <label v-if="editor.type === 'detection'">
              俯仰起始（度，正上负下）
              <input v-model.number="editor.detectionPitchStart" type="number" min="-180" max="180" step="1" />
            </label>
            <label v-if="editor.type === 'detection'">
              俯仰结束（度，正上负下）
              <input v-model.number="editor.detectionPitchEnd" type="number" min="-180" max="180" step="1" />
            </label>
            <label v-if="editor.type === 'order'">
              箭头样式
              <select v-model="editor.commandStyle">
                <option v-for="style in commandStyles" :key="style.key" :value="style.key">{{ style.label }}</option>
              </select>
            </label>
            <label v-if="editor.type === 'order'">
              方向调整
              <button class="button button-ghost" type="button" @click="reverseOrderDirection">反转命令线方向</button>
            </label>
            <label v-if="editor.type === 'zone'">
              区域形状
              <select v-model="editor.zoneShape">
                <option v-for="shape in zoneShapes" :key="shape.key" :value="shape.key">{{ shape.label }}</option>
              </select>
            </label>
            <label>
              经度
              <input v-model.number="editor.longitude" type="number" step="0.0001" />
            </label>
            <label>
              纬度
              <input v-model.number="editor.latitude" type="number" step="0.0001" />
            </label>
            <label>
              高度（米）
              <input v-model.number="editor.altitude" type="number" step="1" />
            </label>
            <label v-if="editor.type === 'detection'">
              半径（米）
              <input v-model.number="editor.radius" type="number" min="100" />
            </label>
            <label>
              显示状态
              <select v-model="editor.visible">
                <option :value="true">显示</option>
                <option :value="false">隐藏</option>
              </select>
            </label>
            <label class="full-span">
              注释
              <textarea v-model="editor.annotation" rows="3" />
            </label>
          </div>

          <div class="toolbar-row top-gap wrap">
            <button class="button" @click="prepareDraw" :disabled="!canManage">开始绘制</button>
            <button class="button button-ghost" @click="saveCurrent" :disabled="!canManage || !editor.id">保存修改</button>
            <button v-if="editor.type === 'order'" class="button button-ghost" type="button" @click="reverseOrderDirection" :disabled="!canManage || !editor.id">反转方向</button>
            <button class="button button-danger" @click="removeCurrent" :disabled="!canManage || !editor.id">删除元素</button>
            <button class="button button-ghost" @click="resetEditor" :disabled="!canManage">新建态势</button>
          </div>
        </fieldset>
      </div>

      <div class="panel-group top-gap">
        <h4>已编辑态势</h4>
        <div class="entity-list">
          <button v-for="item in entities" :key="item.id" class="entity-item" :class="{ active: item.id === activeEntityId }" @click="loadEntity(item)">
            <div>
              <strong>{{ item.name }}</strong>
              <small>{{ item.layerKey }} · {{ item.geometryType }}</small>
            </div>
            <span class="tag" :class="item.camp === 'blue' ? 'tag-blue' : item.camp === 'red' ? 'tag-red' : 'tag-neutral'">{{ item.camp }}</span>
          </button>
        </div>
      </div>

      <div class="panel-group top-gap">
        <h4>导出</h4>
        <div class="toolbar-row wrap">
          <button class="button" @click="doExportPng">导出 PNG</button>
          <button class="button" @click="doExportPdf">导出 PDF</button>
          <button class="button" @click="doExportKml">导出 KML</button>
        </div>
      </div>
    </section>
  </div>
</template>


