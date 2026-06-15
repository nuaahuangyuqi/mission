<script setup>
import 'cesium/Build/Cesium/Widgets/widgets.css';
import * as Cesium from 'cesium';
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { commandStyleMap, detectionSensorTypeMap, detectionSensorTypes, unitTypeMap } from '../data/situationCatalog';
import { tiandituToken } from '../config/mapSettings';

const props = defineProps({
  entities: { type: Array, default: () => [] },
  environment: { type: Array, default: () => [] },
  basemap: { type: String, default: 'offline' },
  mapMode: { type: String, default: '3D' },
  terrainMode: { type: String, default: 'flat' },
  terrainExaggeration: { type: Number, default: 1 },
  layerVisibility: { type: Object, required: true },
  drawTool: { type: Object, required: true },
  activeEntityId: { type: String, default: '' },
  canManage: { type: Boolean, default: false },
  imageOverlays: { type: Array, default: () => [] },
});

const emit = defineEmits([
  'draw-progress',
  'draw-complete',
  'entity-selected',
  'entity-edit-request',
  'entity-delete-request',
  'entity-dragged',
  'entity-drop-create',
  'measurement-state-change',
]);

const globeRef = ref(null);
const globeWrapRef = ref(null);
const basemapState = ref({ requested: 'auto', resolved: 'offline', message: '正在初始化底图...' });
const terrainState = ref({ requested: 'flat', resolved: 'flat', message: '当前地形：平面椭球' });
const contextMenu = reactive({
  visible: false,
  mode: 'entity',
  x: 0,
  y: 0,
  entityId: '',
  longitude: 0,
  latitude: 0,
  altitude: 0,
});
const selectionMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  items: [],
});

const terrainUrlFromEnv = import.meta.env.VITE_TDT_TERRAIN_URL;

function getTiandituToken() {
  return String(tiandituToken.value || '').trim();
}

let viewer;
let drawHandler;
let situationSource;
let environmentSource;
let imageOverlaySource;
let draftSource;
let measurementSource;
let measurementDraftSource;
let draftPoints = [];
let measurementRecords = [];
let measurementDraftPoints = [];
let measurementCursorPoint = null;
let measurementSequence = 1;
let offlineTileConfig = {
  available: false,
  baseUrl: '/dem',
  extension: 'png',
  minimumLevel: 0,
  maximumLevel: 10,
  useReverseY: false,
};
let offlineTerrainConfig = {
  available: false,
  url: '',
  rectangle: null,
  coverageRectangle: null,
  focusRectangle: null,
  tilingScheme: null,
  scheme: 'tms',
  availableRanges: [],
  minimumLevel: 0,
  maximumLevel: 0,
};
let imageOverlayLayers = [];
let tiandituImageryProbe = {
  token: '',
  ok: null,
  checkedAt: 0,
};
const defaultDetectionFillLayers = [
  { scale: 0.92, alpha: 0.18 },
  { scale: 0.78, alpha: 0.14 },
  { scale: 0.64, alpha: 0.1 },
  { scale: 0.5, alpha: 0.07 },
];
const detectionVisualProfiles = {
  radar: {
    shellAlpha: 0.24,
    fillLayers: defaultDetectionFillLayers,
    ray: { material: 'glow', width: 3.2, alpha: 0.96, glowPower: 0.18 },
    envelopes: [
      { scale: 1, material: 'glow', width: 4.2, alpha: 0.98, glowPower: 0.2 },
      { scale: 0.82, material: 'outline', width: 2.2, alpha: 0.72, outlineWidth: 1.2 },
    ],
  },
  infrared: {
    shellAlpha: 0.22,
    fillLayers: [
      { scale: 0.9, alpha: 0.18 },
      { scale: 0.72, alpha: 0.13 },
      { scale: 0.56, alpha: 0.09 },
      { scale: 0.42, alpha: 0.06 },
    ],
    ray: { material: 'dash', width: 3.1, alpha: 0.95, dashLength: 18, dashPattern: 3855 },
    envelopes: [
      { scale: 1, material: 'dash', width: 3.2, alpha: 0.96, dashLength: 22, dashPattern: 65280 },
      { scale: 0.78, material: 'dash', width: 2.1, alpha: 0.7, dashLength: 10, dashPattern: 61680 },
    ],
  },
  electroOptical: {
    shellAlpha: 0.2,
    fillLayers: [
      { scale: 0.88, alpha: 0.16 },
      { scale: 0.74, alpha: 0.12 },
      { scale: 0.6, alpha: 0.09 },
      { scale: 0.46, alpha: 0.06 },
    ],
    ray: { material: 'outline', width: 3.4, alpha: 0.98, outlineWidth: 1.4 },
    envelopes: [
      { scale: 1, material: 'outline', width: 2.8, alpha: 0.96, outlineWidth: 1.6 },
      { scale: 0.9, material: 'solid', width: 1.9, alpha: 0.88 },
      { scale: 0.72, material: 'dash', width: 1.5, alpha: 0.62, dashLength: 8, dashPattern: 43690 },
    ],
  },
  acoustic: {
    shellAlpha: 0.18,
    fillLayers: [
      { scale: 0.94, alpha: 0.16 },
      { scale: 0.82, alpha: 0.12 },
      { scale: 0.68, alpha: 0.09 },
      { scale: 0.54, alpha: 0.07 },
    ],
    ray: { material: 'glow', width: 3.8, alpha: 0.7, glowPower: 0.26 },
    envelopes: [
      { scale: 1, material: 'glow', width: 4.8, alpha: 0.88, glowPower: 0.28 },
      { scale: 0.9, material: 'glow', width: 3, alpha: 0.58, glowPower: 0.18 },
      { scale: 0.76, material: 'outline', width: 1.8, alpha: 0.42, outlineWidth: 1 },
    ],
  },
};
let dragging = false;
let dragMode = '';
let draggedEntityId = '';
let draggedEntitySnapshot = null;
let draggedCoordinates = null;
let draggedVertexIndex = -1;
let draftCursorPoint = null;
let removeMorphCompleteListener;
const measurementState = reactive({
  active: false,
  type: '',
  count: 0,
});

function emitMeasurementState() {
  emit('measurement-state-change', {
    active: measurementState.active,
    type: measurementState.type,
    count: measurementState.count,
  });
}

function normalizeTerrainExaggeration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(10, Math.max(0.1, Math.round(numeric * 10) / 10));
}

function applyTerrainExaggeration() {
  if (!viewer) return;
  viewer.scene.verticalExaggeration = normalizeTerrainExaggeration(props.terrainExaggeration);
  viewer.scene.verticalExaggerationRelativeHeight = 0;
  viewer.scene.requestRender();
}

function getColor(color, alpha = 1) {
  return Cesium.Color.fromCssColorString(color).withAlpha(alpha);
}

function resolveEnvironmentRiskColor(riskLevel = '') {
  const normalized = String(riskLevel || '').toLowerCase();
  if (normalized.includes('high') || normalized.includes('高') || normalized.includes('危')) return '#ef4444';
  if (normalized.includes('medium') || normalized.includes('中')) return '#f97316';
  if (normalized.includes('low') || normalized.includes('低')) return '#facc15';
  return '#86efac';
}

function resolveEnvironmentStyle(item = {}) {
  const meta = item.meta || {};
  if (meta.fillColor || meta.outlineColor) {
    return {
      fillColor: meta.fillColor || resolveEnvironmentRiskColor(item.riskLevel),
      fillAlpha: Number(meta.fillAlpha ?? 0.14),
      outlineColor: meta.outlineColor || meta.fillColor || resolveEnvironmentRiskColor(item.riskLevel),
      outlineAlpha: Number(meta.outlineAlpha ?? 0.9),
    };
  }

  if (item.kind === 'weather') {
    return {
      fillColor: '#93c5fd',
      fillAlpha: 0.12,
      outlineColor: '#bfdbfe',
      outlineAlpha: 0.92,
    };
  }

  if (item.kind === 'electromagnetic') {
    return {
      fillColor: '#a78bfa',
      fillAlpha: 0.12,
      outlineColor: '#a78bfa',
      outlineAlpha: 0.82,
    };
  }

  if (item.kind === 'threat-sector') {
    return {
      fillColor: '#f59e0b',
      fillAlpha: 0.14,
      outlineColor: '#fbbf24',
      outlineAlpha: 0.92,
    };
  }

  const riskColor = resolveEnvironmentRiskColor(item.riskLevel);
  return {
    fillColor: riskColor,
    fillAlpha: item.kind === 'threat-heat' ? 0.18 : 0.12,
    outlineColor: riskColor,
    outlineAlpha: item.kind === 'threat-heat' ? 0.96 : 0.9,
  };
}

function buildEnvironmentLabel(item = {}) {
  if (item.kind === 'threat-heat') {
    return Number(item.meta?.intensity || 0) >= 0.75 ? item.name : '';
  }
  return item.name || item.weather || '';
}

function getMeta(entity, key, fallback = null) {
  return entity?.meta && entity.meta[key] !== undefined ? entity.meta[key] : fallback;
}

function getDetectionSensorType(meta = {}) {
  return detectionSensorTypeMap[meta?.sensorType] ? meta.sensorType : 'radar';
}

function getDetectionVisualProfile(meta = {}) {
  const sensorType = getDetectionSensorType(meta);
  const catalogProfile = detectionSensorTypeMap[sensorType] || detectionSensorTypeMap.radar;
  const visualProfile = detectionVisualProfiles[sensorType] || detectionVisualProfiles.radar;
  return {
    sensorType,
    ...visualProfile,
    defaultColor: catalogProfile?.color || '#38bdf8',
  };
}

function createDetectionPolylineMaterial(color, spec = {}) {
  const alpha = Number(spec.alpha ?? 0.92);
  if (spec.material === 'dash') {
    return new Cesium.PolylineDashMaterialProperty({
      color: getColor(color, alpha),
      gapColor: getColor(color, Math.max(0.06, alpha * 0.18)),
      dashLength: Number(spec.dashLength || 16),
      dashPattern: Number(spec.dashPattern || 255),
    });
  }

  if (spec.material === 'outline') {
    return new Cesium.PolylineOutlineMaterialProperty({
      color: getColor(color, alpha),
      outlineColor: getColor('#020617', Number(spec.outlineAlpha ?? 0.32)),
      outlineWidth: Number(spec.outlineWidth || 1),
    });
  }

  if (spec.material === 'glow') {
    return new Cesium.PolylineGlowMaterialProperty({
      color: getColor(color, alpha),
      glowPower: Number(spec.glowPower ?? 0.16),
      taperPower: Number(spec.taperPower ?? 0.9),
    });
  }

  return getColor(color, alpha);
}

function symbolMarkupForSubtype(unitSubtype, color) {
  const symbols = {
    tank: `<ellipse cx="20" cy="20" rx="8" ry="5" fill="none" stroke="${color}" stroke-width="2" /><line x1="12" y1="26" x2="28" y2="26" stroke="${color}" stroke-width="2" />`,
    infantry: `<path d="M14 14 L26 26 M26 14 L14 26" stroke="${color}" stroke-width="2.2" stroke-linecap="round" /><line x1="20" y1="10" x2="20" y2="30" stroke="${color}" stroke-width="1.8" />`,
    artillery: `<line x1="11" y1="24" x2="29" y2="24" stroke="${color}" stroke-width="2.2" /><circle cx="14" cy="27" r="2" fill="none" stroke="${color}" stroke-width="1.5" /><circle cx="26" cy="27" r="2" fill="none" stroke="${color}" stroke-width="1.5" /><line x1="21" y1="24" x2="29" y2="14" stroke="${color}" stroke-width="1.8" />`,
    apc: `<rect x="12" y="16" width="16" height="9" rx="2" fill="none" stroke="${color}" stroke-width="2" /><circle cx="15" cy="27" r="2" fill="none" stroke="${color}" stroke-width="1.5" /><circle cx="25" cy="27" r="2" fill="none" stroke="${color}" stroke-width="1.5" />`,
    missile: `<path d="M20 11 L27 22 L20 20 L13 22 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" /><line x1="20" y1="20" x2="20" y2="30" stroke="${color}" stroke-width="1.8" />`,
    engineer: `<path d="M12 24 L17 18 L20 24 L23 18 L28 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><line x1="20" y1="12" x2="20" y2="30" stroke="${color}" stroke-width="1.6" />`,
    command: `<path d="M13 29 L13 11 L27 15 L13 19" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" /><circle cx="13" cy="29" r="1.8" fill="${color}" />`,
    radar: `<path d="M20 26 L20 14" stroke="${color}" stroke-width="1.8" /><path d="M14 22 A8 8 0 0 1 26 22" fill="none" stroke="${color}" stroke-width="2" /><path d="M11 18 A11 11 0 0 1 29 18" fill="none" stroke="${color}" stroke-width="1.6" />`,
    transport: `<rect x="11" y="17" width="14" height="8" rx="1.5" fill="none" stroke="${color}" stroke-width="2" /><rect x="25" y="19" width="4" height="6" fill="none" stroke="${color}" stroke-width="2" /><circle cx="15" cy="27" r="2" fill="none" stroke="${color}" stroke-width="1.5" /><circle cx="25" cy="27" r="2" fill="none" stroke="${color}" stroke-width="1.5" />`,
    medic: `<line x1="20" y1="12" x2="20" y2="28" stroke="${color}" stroke-width="2.4" /><line x1="12" y1="20" x2="28" y2="20" stroke="${color}" stroke-width="2.4" />`,
    helicopter: `<ellipse cx="20" cy="22" rx="6" ry="3.5" fill="none" stroke="${color}" stroke-width="2" /><line x1="10" y1="16" x2="30" y2="16" stroke="${color}" stroke-width="1.8" /><line x1="26" y1="22" x2="31" y2="20" stroke="${color}" stroke-width="1.6" />`,
    attackHelicopter: `<ellipse cx="19" cy="22" rx="6" ry="3.5" fill="none" stroke="${color}" stroke-width="2" /><line x1="9" y1="16" x2="29" y2="16" stroke="${color}" stroke-width="1.8" /><line x1="13" y1="23" x2="9" y2="26" stroke="${color}" stroke-width="1.5" /><line x1="25" y1="23" x2="29" y2="26" stroke="${color}" stroke-width="1.5" />`,
    transportAircraft: `<path d="M10 23 L19 18 L19 13 L21 13 L21 18 L30 23 L21 22 L21 28 L19 28 L19 22 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />`,
    fighter: `<path d="M12 25 L19 19 L20 12 L21 19 L28 25 L22 23 L20 29 L18 23 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />`,
    bomber: `<path d="M11 24 L17 18 L20 12 L23 18 L29 24 L24 23 L20 28 L16 23 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />`,
    uav: `<path d="M10 22 L20 16 L30 22" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" /><line x1="20" y1="16" x2="20" y2="28" stroke="${color}" stroke-width="1.8" />`,
    awacs: `<path d="M11 24 L20 18 L29 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" /><ellipse cx="20" cy="14" rx="6" ry="2.6" fill="none" stroke="${color}" stroke-width="1.8" />`,
    airDefense: `<path d="M20 12 L28 26 L12 26 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" /><line x1="12" y1="29" x2="28" y2="29" stroke="${color}" stroke-width="1.8" />`,
    ewAircraft: `<path d="M10 24 L20 18 L30 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" /><path d="M12 15 C15 12, 17 12, 20 15" fill="none" stroke="${color}" stroke-width="1.6" /><path d="M20 15 C23 12, 25 12, 28 15" fill="none" stroke="${color}" stroke-width="1.6" />`,
    refueler: `<path d="M11 24 L20 18 L29 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" /><line x1="20" y1="24" x2="20" y2="30" stroke="${color}" stroke-width="1.8" /><circle cx="20" cy="31" r="1.6" fill="none" stroke="${color}" stroke-width="1.2" />`,
    destroyer: `<path d="M10 25 L15 18 L28 18 L31 25 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" /><line x1="20" y1="18" x2="20" y2="12" stroke="${color}" stroke-width="1.6" />`,
    frigate: `<path d="M11 25 L16 19 L27 19 L30 25 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" /><line x1="17" y1="19" x2="17" y2="13" stroke="${color}" stroke-width="1.4" /><line x1="23" y1="19" x2="23" y2="14" stroke="${color}" stroke-width="1.4" />`,
    corvette: `<path d="M12 25 L17 20 L26 20 L29 25 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" /><line x1="20" y1="20" x2="20" y2="15" stroke="${color}" stroke-width="1.4" />`,
    carrier: `<path d="M9 24 L13 17 L30 17 L31 24 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" /><line x1="14" y1="20" x2="29" y2="20" stroke="${color}" stroke-width="1.6" />`,
    submarine: `<path d="M11 22 Q20 16 29 22 Q20 28 11 22 Z" fill="none" stroke="${color}" stroke-width="2" /><line x1="20" y1="17" x2="20" y2="12" stroke="${color}" stroke-width="1.4" />`,
    amphibious: `<path d="M10 25 L15 18 L28 18 L31 25 Z" fill="none" stroke="${color}" stroke-width="2" /><path d="M18 25 L20 21 L22 25" fill="none" stroke="${color}" stroke-width="1.6" />`,
    patrolBoat: `<path d="M12 24 L17 19 L27 21 L29 24 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" /><line x1="15" y1="27" x2="28" y2="27" stroke="${color}" stroke-width="1.4" />`,
    mineCounter: `<path d="M11 25 L16 19 L27 19 L30 25 Z" fill="none" stroke="${color}" stroke-width="2" /><circle cx="14" cy="15" r="2.2" fill="none" stroke="${color}" stroke-width="1.2" /><circle cx="26" cy="15" r="2.2" fill="none" stroke="${color}" stroke-width="1.2" />`,
    supportShip: `<path d="M10 25 L15 18 L28 18 L31 25 Z" fill="none" stroke="${color}" stroke-width="2" /><rect x="16" y="12" width="8" height="5" fill="none" stroke="${color}" stroke-width="1.6" />`,
    coastBattery: `<line x1="10" y1="28" x2="30" y2="28" stroke="${color}" stroke-width="2" /><path d="M14 24 L20 18 L26 24" fill="none" stroke="${color}" stroke-width="2" /><line x1="20" y1="18" x2="27" y2="14" stroke="${color}" stroke-width="1.6" />`,
  };
  return symbols[unitSubtype] || symbols.tank;
}

function svgForCamp(camp, color, unitSubtype = "tank") {
  const frame = camp === "blue"
    ? `<rect x="3" y="4" width="34" height="32" rx="4" fill="none" stroke="${color}" stroke-width="3" />`
    : camp === "red"
      ? `<polygon points="20,3 37,20 20,37 3,20" fill="none" stroke="${color}" stroke-width="3" />`
      : `<rect x="5" y="7" width="30" height="26" rx="6" fill="none" stroke="${color}" stroke-width="3" />`;
  const type = unitTypeMap[unitSubtype] || unitTypeMap.tank;
  const icon = symbolMarkupForSubtype(unitSubtype, color)
    + `<text x="20" y="34" text-anchor="middle" font-size="8.5" font-weight="700" fill="${color}" font-family="Arial, sans-serif">${type?.code || "UN"}</text>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">${frame}${icon}</svg>`);
}

function svgForArrow(styleKey, color) {
  const arrow = commandStyleMap[styleKey]?.arrow || 'solid';
  const shapes = {
    solid: '<polygon points="4,20 26,6 26,14 36,14 36,26 26,26 26,34" fill="' + color + '" />',
    split: '<path d="M4 20 L22 8 L22 15 L36 10 L36 18 L24 20 L36 22 L36 30 L22 25 L22 32 Z" fill="' + color + '" />',
    long: '<polygon points="3,20 24,7 24,13 37,13 37,27 24,27 24,33" fill="' + color + '" />',
    double: '<path d="M2 20 L16 8 L16 14 L28 14 L28 8 L38 20 L28 32 L28 26 L16 26 L16 32 Z" fill="' + color + '" />',
    hollow: '<path d="M4 20 L26 6 L26 14 L36 14 L36 26 L26 26 L26 34 Z" fill="none" stroke="' + color + '" stroke-width="3" />',
    barb: '<path d="M5 20 L26 8 L26 15 L36 20 L26 25 L26 32 Z" fill="' + color + '" />',
    block: '<path d="M6 20 L22 9 L22 14 L34 14 L34 26 L22 26 L22 31 Z" fill="' + color + '" /><rect x="2" y="14" width="6" height="12" fill="' + color + '" />',
    needle: '<path d="M4 20 L31 8 L31 15 L37 20 L31 25 L31 32 Z" fill="' + color + '" />',
    wing: '<path d="M3 20 L22 8 L22 14 L37 10 L28 20 L37 30 L22 26 L22 32 Z" fill="' + color + '" />',
    tail: '<path d="M6 20 L26 8 L26 14 L36 20 L26 26 L26 32 Z" fill="' + color + '" /><path d="M4 14 L10 20 L4 26" fill="none" stroke="' + color + '" stroke-width="3" />',
  };
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><g transform="translate(40 0) scale(-1 1)">' + (shapes[arrow] || shapes.solid) + '</g></svg>');
}

function computeLineHeadingRadians(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const start = points[points.length - 2];
  const end = points[points.length - 1];
  const dx = Number(end[0]) - Number(start[0]);
  const dy = Number(end[1]) - Number(start[1]);
  return Math.atan2(dy, dx);
}

function normalizeHeadingDegrees(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = numeric % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function clampDetectionPitch(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(180, Math.max(-180, numeric));
}

function hasDetectionValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function resolveDetectionSectorMeta(meta = {}) {
  const hasHeadingStart = hasDetectionValue(meta.detectionHeadingStart);
  const hasHeadingEnd = hasDetectionValue(meta.detectionHeadingEnd);
  const hasHeading = hasDetectionValue(meta.detectionHeading);
  const rawHeadingStart = Number(hasHeadingStart ? meta.detectionHeadingStart : (hasHeading ? meta.detectionHeading : 0));
  const rawHeadingEnd = Number(hasHeadingEnd ? meta.detectionHeadingEnd : (hasHeading ? meta.detectionHeading : (hasHeadingStart ? rawHeadingStart : 360)));
  const headingStart = normalizeHeadingDegrees(rawHeadingStart, 0);
  const headingSpan = Math.abs(rawHeadingEnd - rawHeadingStart) >= 360
    ? 360
    : ((normalizeHeadingDegrees(rawHeadingEnd, headingStart) - headingStart + 360) % 360);
  const headingEnd = headingSpan >= 360
    ? headingStart
    : normalizeHeadingDegrees(rawHeadingEnd, headingStart);
  const hasPitchStart = hasDetectionValue(meta.detectionPitchStart);
  const hasPitchEnd = hasDetectionValue(meta.detectionPitchEnd);
  const hasPitch = hasDetectionValue(meta.detectionPitch);
  const pitchStart = clampDetectionPitch(hasPitchStart ? meta.detectionPitchStart : (hasPitch ? meta.detectionPitch : 0), 0);
  const pitchEnd = clampDetectionPitch(hasPitchEnd ? meta.detectionPitchEnd : (hasPitch ? meta.detectionPitch : (hasPitchStart ? pitchStart : 180)), pitchStart);

  return {
    headingStart,
    headingEnd,
    headingSpan,
    pitchStart: Math.min(pitchStart, pitchEnd),
    pitchEnd: Math.max(pitchStart, pitchEnd),
  };
}

function isFullHeadingRange(headingSpan) {
  return Math.abs(Number(headingSpan || 0) - 360) < 0.0001;
}

function headingToClockRadians(headingDegrees) {
  return Cesium.Math.zeroToTwoPi(Cesium.Math.toRadians(90 - normalizeHeadingDegrees(headingDegrees, 0)));
}

function pitchToConeRadians(pitchDegrees) {
  const pitch = clampDetectionPitch(pitchDegrees, 0);
  const coneDegrees = pitch >= 0
    ? 90 - ((pitch / 180) * 90)
    : 90 + ((Math.abs(pitch) / 180) * 90);
  return Cesium.Math.toRadians(coneDegrees);
}

function buildDetectionConeRange(pitchStart, pitchEnd) {
  const startCone = pitchToConeRadians(pitchStart);
  const endCone = pitchToConeRadians(pitchEnd);
  return {
    minimumCone: Math.min(startCone, endCone),
    maximumCone: Math.max(startCone, endCone),
  };
}

function pitchToFootprintRadiusFactor(pitchDegrees) {
  const pitch = clampDetectionPitch(pitchDegrees, 0);
  if (pitch > 0) return 0;
  const downwardAngle = Cesium.Math.toRadians((Math.abs(pitch) / 180) * 90);
  return Math.max(0, Math.cos(downwardAngle));
}

function pitchToProjectionRadiusFactor(pitchDegrees) {
  const pitch = clampDetectionPitch(pitchDegrees, 0);
  const projectionAngle = Cesium.Math.toRadians((Math.abs(pitch) / 180) * 90);
  return Math.max(0, Math.cos(projectionAngle));
}

function projectSurfacePoint(anchor, distance, headingDegrees = 0) {
  const longitude = Number(anchor[0] || 0);
  const latitude = Number(anchor[1] || 0);
  const altitude = Number(anchor[2] || 0);
  const heading = Cesium.Math.toRadians(Number(headingDegrees || 0));
  const earthRadius = 6378137;
  const lat1 = Cesium.Math.toRadians(latitude);
  const lon1 = Cesium.Math.toRadians(longitude);
  const angularDistance = Math.max(0, Number(distance || 0)) / earthRadius;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(heading));
  const lon2 = lon1 + Math.atan2(Math.sin(heading) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return [Cesium.Math.toDegrees(lon2), Cesium.Math.toDegrees(lat2), altitude];
}

function projectDetectionPoint(anchor, distance, headingDegrees = 0, pitchDegrees = 0) {
  const pitch = clampDetectionPitch(pitchDegrees, 0);
  const normalizedAngle = Cesium.Math.toRadians((Math.abs(pitch) / 180) * 90);
  const horizontalDistance = Math.max(0, Number(distance || 0) * Math.cos(normalizedAngle));
  const verticalDistance = Number(distance || 0) * Math.sin(normalizedAngle) * (pitch >= 0 ? 1 : -1);
  const surfacePoint = projectSurfacePoint(anchor, horizontalDistance, headingDegrees);
  return [surfacePoint[0], surfacePoint[1], Number(anchor?.[2] || 0) + verticalDistance];
}

function buildHeadingSamples(startHeading, headingSpan, sampleCount) {
  const count = Math.max(1, sampleCount);
  if (isFullHeadingRange(headingSpan)) {
    return Array.from({ length: count }, (_, index) => normalizeHeadingDegrees(startHeading + ((360 / count) * index), startHeading));
  }

  return Array.from({ length: count + 1 }, (_, index) => normalizeHeadingDegrees(startHeading + ((headingSpan * index) / count), startHeading));
}

function buildDetectionClockRange(meta = {}) {
  const { headingStart, headingEnd, headingSpan } = resolveDetectionSectorMeta(meta);
  if (isFullHeadingRange(headingSpan)) {
    return { minimumClock: 0, maximumClock: Cesium.Math.TWO_PI };
  }

  const minimumClock = headingToClockRadians(headingEnd);
  let maximumClock = headingToClockRadians(headingStart);
  if (maximumClock <= minimumClock) {
    maximumClock += Cesium.Math.TWO_PI;
  }

  return { minimumClock, maximumClock };
}

function resolveDetectionGroundFootprint(center, radius, meta = {}, scale = 1) {
  const { headingStart, headingSpan, pitchStart, pitchEnd } = resolveDetectionSectorMeta(meta);
  if (pitchStart >= 0) return null;
  if (!isFullHeadingRange(headingSpan) && headingSpan <= 0) return null;

  const groundPitchStart = Math.min(0, pitchStart);
  const groundPitchEnd = Math.min(0, pitchEnd);
  const outerRadius = Math.max(0, Number(radius || 0) * scale * pitchToFootprintRadiusFactor(groundPitchEnd));
  const innerRadius = Math.max(0, Number(radius || 0) * scale * pitchToFootprintRadiusFactor(groundPitchStart));

  if (outerRadius <= 0) return null;

  const sampleCount = Math.max(16, Math.ceil((isFullHeadingRange(headingSpan) ? 360 : Math.max(headingSpan, 12)) / 6));
  const headings = buildHeadingSamples(headingStart, headingSpan, sampleCount);
  const outerRing = headings.map((heading) => projectSurfacePoint(center, outerRadius, heading));
  const innerRing = innerRadius > 1
    ? headings.slice().reverse().map((heading) => projectSurfacePoint(center, innerRadius, heading))
    : [];

  return {
    center,
    outerRing,
    innerRing,
    fullHeading: isFullHeadingRange(headingSpan),
  };
}

function resolveDetectionProjectedFootprint(center, radius, meta = {}, scale = 1) {
  const { headingStart, headingSpan, pitchStart, pitchEnd } = resolveDetectionSectorMeta(meta);
  if (!isFullHeadingRange(headingSpan) && headingSpan <= 0) return null;

  const containsZero = pitchStart <= 0 && pitchEnd >= 0;
  const minimumPitchMagnitude = containsZero ? 0 : Math.min(Math.abs(pitchStart), Math.abs(pitchEnd));
  const maximumPitchMagnitude = Math.max(Math.abs(pitchStart), Math.abs(pitchEnd));
  const outerRadius = Math.max(0, Number(radius || 0) * scale * pitchToProjectionRadiusFactor(minimumPitchMagnitude));
  const innerRadius = Math.max(0, Number(radius || 0) * scale * pitchToProjectionRadiusFactor(maximumPitchMagnitude));

  if (outerRadius <= 0) return null;

  const sampleCount = Math.max(24, Math.ceil((isFullHeadingRange(headingSpan) ? 360 : Math.max(headingSpan, 12)) / 5));
  const headings = buildHeadingSamples(headingStart, headingSpan, sampleCount);
  const outerRing = headings.map((heading) => projectSurfacePoint(center, outerRadius, heading));
  const innerRing = innerRadius > 1 && innerRadius < outerRadius
    ? headings.slice().reverse().map((heading) => projectSurfacePoint(center, innerRadius, heading))
    : [];

  return {
    center,
    outerRing,
    innerRing,
    fullHeading: isFullHeadingRange(headingSpan),
  };
}

function resolveDetectionDirectionPoint(center, radius, detectionSector) {
  const heading = normalizeHeadingDegrees(
    detectionSector.headingStart + (detectionSector.headingSpan / 2),
    detectionSector.headingStart,
  );
  const pitch = (detectionSector.pitchStart + detectionSector.pitchEnd) / 2;
  return props.mapMode === '2D'
    ? projectSurfacePoint(center, radius, heading)
    : projectDetectionPoint(center, radius, heading, pitch);
}

function buildDetectionFootprintHierarchy(center, radius, meta = {}) {
  if (props.mapMode === '2D') {
    const footprint = resolveDetectionProjectedFootprint(center, radius, meta);
    if (!footprint) return null;

    if (footprint.fullHeading) {
      if (footprint.innerRing.length) {
        return new Cesium.PolygonHierarchy(
          footprint.outerRing.map(toCartesian),
          [new Cesium.PolygonHierarchy(footprint.innerRing.map(toCartesian))],
        );
      }

      return new Cesium.PolygonHierarchy(footprint.outerRing.map(toCartesian));
    }

    if (footprint.innerRing.length) {
      return new Cesium.PolygonHierarchy([...footprint.outerRing, ...footprint.innerRing].map(toCartesian));
    }

    return new Cesium.PolygonHierarchy([footprint.center, ...footprint.outerRing].map(toCartesian));
  }

  const footprint = resolveDetectionGroundFootprint(center, radius, meta);
  if (!footprint) return null;

  if (footprint.fullHeading) {
    if (footprint.innerRing.length) {
      return new Cesium.PolygonHierarchy(
        footprint.outerRing.map(toCartesian),
        [new Cesium.PolygonHierarchy(footprint.innerRing.map(toCartesian))],
      );
    }

    return new Cesium.PolygonHierarchy(footprint.outerRing.map(toCartesian));
  }

  if (footprint.innerRing.length) {
    return new Cesium.PolygonHierarchy([...footprint.outerRing, ...footprint.innerRing].map(toCartesian));
  }

  return new Cesium.PolygonHierarchy([footprint.center, ...footprint.outerRing].map(toCartesian));
}

function buildDetectionEnvelopePositions(center, radius, meta = {}, scale = 1) {
  if (props.mapMode === '2D') {
    const footprint = resolveDetectionProjectedFootprint(center, radius, meta, scale);
    if (!footprint) return null;

    const boundary = footprint.fullHeading
      ? [...footprint.outerRing, footprint.outerRing[0]]
      : footprint.innerRing.length
        ? [...footprint.outerRing, ...footprint.innerRing, footprint.outerRing[0]]
        : [footprint.center, ...footprint.outerRing, footprint.center];
    return boundary.map(toCartesian);
  }

  const footprint = resolveDetectionGroundFootprint(center, radius, meta, scale);
  if (!footprint) return null;

  const boundary = footprint.fullHeading
    ? [...footprint.outerRing, footprint.outerRing[0]]
    : footprint.innerRing.length
      ? [...footprint.outerRing, ...footprint.innerRing, footprint.outerRing[0]]
      : [footprint.center, ...footprint.outerRing, footprint.center];

  return boundary.map(toCartesian);
}

function computePolygonCentroid(coordinates = []) {
  if (!coordinates.length) return [0, 0, 0];
  const sums = coordinates.reduce((accumulator, point) => {
    accumulator.longitude += Number(point[0] || 0);
    accumulator.latitude += Number(point[1] || 0);
    accumulator.altitude += Number(point[2] || 0);
    return accumulator;
  }, { longitude: 0, latitude: 0, altitude: 0 });
  const count = coordinates.length;
  return [sums.longitude / count, sums.latitude / count, sums.altitude / count];
}

function measurementVertexId(recordId, vertexIndex) {
  return `measurement-${recordId}__vertex-${vertexIndex}`;
}

function measurementSegmentLabelId(recordId, segmentIndex) {
  return `measurement-${recordId}__segment-${segmentIndex}`;
}

function measurementTotalLabelId(recordId) {
  return `measurement-${recordId}__total`;
}

function measurementAreaLabelId(recordId) {
  return `measurement-${recordId}__area`;
}

function measurementAreaOutlineId(recordId) {
  return `measurement-${recordId}__outline`;
}

function isMeasurementType(type) {
  return ['distance', 'area'].includes(String(type || ''));
}

function isMeasurementActive() {
  return measurementState.active && isMeasurementType(measurementState.type);
}

function getMeasurementColor(type = measurementState.type) {
  return type === 'area' ? '#34d399' : '#fbbf24';
}

function getMeasurementTitle() {
  if (measurementState.active) {
    return measurementState.type === 'area' ? '面积测量中' : '距离测量中';
  }
  return '测量结果';
}

function getMeasurementHint() {
  if (measurementState.active) {
    if (measurementState.type === 'area') {
      return `左击连续采点，双击或右击完成面积测量；当前已采集 ${measurementDraftPoints.length} 个点。`;
    }
    return `左击连续采点，右击完成多段距离测量；当前已采集 ${measurementDraftPoints.length} 个点。`;
  }

  if (measurementState.count) {
    return `当前地图已保留 ${measurementState.count} 条测量结果，可继续新增或手动清空。`;
  }

  return '支持多段距离测量与多边形面积测量，结果仅保留在当前地图会话中。';
}

function toCartographic(point) {
  return Cesium.Cartographic.fromDegrees(
    Number(point?.[0] || 0),
    Number(point?.[1] || 0),
    Number(point?.[2] || 0),
  );
}

function computeSegmentDistance(start, end) {
  if (!start || !end) return 0;

  const startLongitude = Number(start[0] || 0);
  const startLatitude = Number(start[1] || 0);
  const endLongitude = Number(end[0] || 0);
  const endLatitude = Number(end[1] || 0);
  const heightDelta = Number(end[2] || 0) - Number(start[2] || 0);

  if (Math.abs(startLongitude - endLongitude) < 0.0000001 && Math.abs(startLatitude - endLatitude) < 0.0000001) {
    return Math.abs(heightDelta);
  }

  const geodesic = new Cesium.EllipsoidGeodesic(toCartographic(start), toCartographic(end));
  const surfaceDistance = Number.isFinite(geodesic.surfaceDistance)
    ? geodesic.surfaceDistance
    : Cesium.Cartesian3.distance(toCartesian(start), toCartesian(end));

  return Math.hypot(surfaceDistance, heightDelta);
}

function computePolylineDistance(points = []) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  return points.slice(1).reduce((total, point, index) => total + computeSegmentDistance(points[index], point), 0);
}

function interpolateSegmentMidpoint(start, end) {
  if (!start || !end) return [0, 0, 0];

  const startLongitude = Number(start[0] || 0);
  const startLatitude = Number(start[1] || 0);
  const endLongitude = Number(end[0] || 0);
  const endLatitude = Number(end[1] || 0);

  if (Math.abs(startLongitude - endLongitude) < 0.0000001 && Math.abs(startLatitude - endLatitude) < 0.0000001) {
    return [
      (startLongitude + endLongitude) / 2,
      (startLatitude + endLatitude) / 2,
      (Number(start[2] || 0) + Number(end[2] || 0)) / 2,
    ];
  }

  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(startLongitude, startLatitude),
    Cesium.Cartographic.fromDegrees(endLongitude, endLatitude),
  );
  const midpoint = geodesic.interpolateUsingFraction(0.5);

  return [
    Cesium.Math.toDegrees(midpoint.longitude),
    Cesium.Math.toDegrees(midpoint.latitude),
    (Number(start[2] || 0) + Number(end[2] || 0)) / 2,
  ];
}

function computePolygonArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;

  const cartesians = points.map((point) => Cesium.Cartesian3.fromDegrees(
    Number(point?.[0] || 0),
    Number(point?.[1] || 0),
    Number(point?.[2] || 0),
  ));

  const center = cartesians.reduce((accumulator, point) => new Cesium.Cartesian3(
    accumulator.x + point.x,
    accumulator.y + point.y,
    accumulator.z + point.z,
  ), new Cesium.Cartesian3(0, 0, 0));

  center.x /= cartesians.length;
  center.y /= cartesians.length;
  center.z /= cartesians.length;

  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  const inverse = Cesium.Matrix4.inverseTransformation(transform, new Cesium.Matrix4());
  const localPoints = cartesians.map((point) => Cesium.Matrix4.multiplyByPoint(inverse, point, new Cesium.Cartesian3()));

  let twiceArea = 0;
  for (let index = 0; index < localPoints.length; index += 1) {
    const current = localPoints[index];
    const next = localPoints[(index + 1) % localPoints.length];
    twiceArea += (current.x * next.y) - (next.x * current.y);
  }

  return Math.abs(twiceArea) / 2;
}

function formatDistance(value) {
  const meters = Math.max(0, Number(value || 0));
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(meters >= 10000 ? 1 : 2)} km`;
  }
  return `${meters.toFixed(meters >= 100 ? 0 : 1)} m`;
}

function formatArea(value) {
  const squareMeters = Math.max(0, Number(value || 0));
  if (squareMeters >= 1000000) {
    return `${(squareMeters / 1000000).toFixed(squareMeters >= 10000000 ? 1 : 2)} km虏`;
  }
  return `${squareMeters.toFixed(squareMeters >= 1000 ? 0 : 1)} m虏`;
}

function dedupeSequentialPoints(points = []) {
  return points.reduce((result, point) => {
    const normalizedPoint = [Number(point[0] || 0), Number(point[1] || 0), Number(point[2] || 0)];
    const previous = result[result.length - 1];
    if (!previous) {
      result.push(normalizedPoint);
      return result;
    }

    const isSamePoint = Math.abs(previous[0] - normalizedPoint[0]) < 0.0000001
      && Math.abs(previous[1] - normalizedPoint[1]) < 0.0000001
      && Math.abs(previous[2] - normalizedPoint[2]) < 0.1;

    if (!isSamePoint) {
      result.push(normalizedPoint);
    }

    return result;
  }, []);
}

function polygonVertexHandleId(entityId, vertexIndex) {
  return `${entityId}__vertex-${vertexIndex}`;
}

function polylineVertexHandleId(entityId, vertexIndex) {
  return `${entityId}__line-vertex-${vertexIndex}`;
}

function detectionFillLayerId(entityId, layerIndex) {
  return `${entityId}__sensor-fill-${layerIndex}`;
}

function detectionEnvelopeLayerId(entityId, layerIndex) {
  return `${entityId}__sensor-envelope-${layerIndex}`;
}

function normalizeRenderPoint(point) {
  return [
    Number(point?.[0] || 0),
    Number(point?.[1] || 0),
    props.mapMode === '2D' ? 0 : Number(point?.[2] || 0),
  ];
}

function shouldClampPointToGround(altitude = 0) {
  return props.mapMode !== '2D' && Number(altitude || 0) === 0;
}

function toCartesian(point) {
  const [longitude, latitude, altitude] = normalizeRenderPoint(point);
  return Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude);
}

function buildDetectionEllipsoidConfig(radius, detectionSector, detectionClockRange, material, options = {}) {
  const scale = Math.max(0, Number(options.scale || 1));
  const coneRange = buildDetectionConeRange(detectionSector.pitchStart, detectionSector.pitchEnd);
  return {
    show: props.mapMode !== '2D',
    radii: new Cesium.Cartesian3(radius * scale, radius * scale, radius * scale),
    minimumClock: detectionClockRange.minimumClock,
    maximumClock: detectionClockRange.maximumClock,
    minimumCone: coneRange.minimumCone,
    maximumCone: coneRange.maximumCone,
    material,
    outline: Boolean(options.outline),
    ...(options.outlineColor ? { outlineColor: options.outlineColor } : {}),
  };
}

function syncDetectionEllipsoidGraphic(ellipsoid, radius, detectionSector, detectionClockRange, material, options = {}) {
  if (!ellipsoid) return;
  const scale = Math.max(0, Number(options.scale || 1));
  const coneRange = buildDetectionConeRange(detectionSector.pitchStart, detectionSector.pitchEnd);
  ellipsoid.show = props.mapMode !== '2D';
  ellipsoid.radii = new Cesium.Cartesian3(radius * scale, radius * scale, radius * scale);
  ellipsoid.minimumClock = detectionClockRange.minimumClock;
  ellipsoid.maximumClock = detectionClockRange.maximumClock;
  ellipsoid.minimumCone = coneRange.minimumCone;
  ellipsoid.maximumCone = coneRange.maximumCone;
  ellipsoid.material = material;
  ellipsoid.outline = Boolean(options.outline);
  if (options.outlineColor) {
    ellipsoid.outlineColor = options.outlineColor;
  }
}

function getEntityAnchor(entity) {
  if (!entity) {
    return { longitude: 120.18, latitude: 30.28, altitude: 0 };
  }

  if (entity.geometryType === 'point' || entity.geometryType === 'circle') {
    return {
      longitude: Number(entity.coordinates[0] || 0),
      latitude: Number(entity.coordinates[1] || 0),
      altitude: Number(entity.coordinates[2] || 0),
    };
  }

  const first = entity.coordinates?.[0] || [0, 0, 0];
  return {
    longitude: Number(first[0] || 0),
    latitude: Number(first[1] || 0),
    altitude: Number(first[2] || 0),
  };
}

function translateGeometryCoordinates(entity, nextAnchor) {
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

function buildRectanglePolygon(cornerA, cornerB) {
  const west = Math.min(Number(cornerA?.[0] || 0), Number(cornerB?.[0] || 0));
  const east = Math.max(Number(cornerA?.[0] || 0), Number(cornerB?.[0] || 0));
  const south = Math.min(Number(cornerA?.[1] || 0), Number(cornerB?.[1] || 0));
  const north = Math.max(Number(cornerA?.[1] || 0), Number(cornerB?.[1] || 0));
  const altitude = (Number(cornerA?.[2] || 0) + Number(cornerB?.[2] || 0)) / 2;
  return [
    [west, south, altitude],
    [east, south, altitude],
    [east, north, altitude],
    [west, north, altitude],
  ];
}

function normalizeEntityId(value) {
  return String(value || '').replace(/__(sensor-ray|sensor-footprint|sensor-fill-\d+|sensor-envelope-\d+|order-head|vertex-\d+|line-vertex-\d+)$/, '');
}

function parsePickedEntityRef(picked) {
  if (!picked?.id) return null;
  const rawId = typeof picked.id === 'string' ? picked.id : picked.id.id;
  if (!rawId) return null;

  const polygonVertexMatch = String(rawId).match(/^(.*)__vertex-(\d+)$/);
  if (polygonVertexMatch) {
    return {
      rawId,
      entityId: polygonVertexMatch[1],
      kind: 'vertex',
      vertexIndex: Number(polygonVertexMatch[2]),
    };
  }

  const polylineVertexMatch = String(rawId).match(/^(.*)__line-vertex-(\d+)$/);
  if (polylineVertexMatch) {
    return {
      rawId,
      entityId: polylineVertexMatch[1],
      kind: 'line-vertex',
      vertexIndex: Number(polylineVertexMatch[2]),
    };
  }

  return {
    rawId,
    entityId: normalizeEntityId(rawId),
    kind: 'entity',
    vertexIndex: -1,
  };
}

function isVertexPickRef(ref) {
  return ref?.kind === 'vertex' || ref?.kind === 'line-vertex';
}

function isEntityVisible(entity) {
  if (!entity.visible) return false;
  if (entity.layerKey === 'units') {
    if (entity.camp === 'blue') return Boolean(props.layerVisibility.blueUnits);
    if (entity.camp === 'red') return Boolean(props.layerVisibility.redUnits);
    return Boolean(props.layerVisibility.blueUnits || props.layerVisibility.redUnits);
  }
  return Boolean(props.layerVisibility[entity.layerKey]);
}

function probeImage(url, timeout = 4000) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(false);
      return;
    }

    const image = new Image();
    let finished = false;
    const timer = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve(false);
    }, timeout);

    image.onload = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      resolve(true);
    };

    image.onerror = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      resolve(false);
    };

    image.src = url;
  });
}

async function isTiandituImageryReachable(force = false) {
  const token = getTiandituToken();
  if (!token) return false;
  const now = Date.now();
  if (
    !force
    && tiandituImageryProbe.token === token
    && typeof tiandituImageryProbe.ok === 'boolean'
    && now - tiandituImageryProbe.checkedAt < 60000
  ) {
    return tiandituImageryProbe.ok;
  }

  const sampleUrl = `https://t0.tianditu.gov.cn/DataServer?T=img_w&x=13&y=6&l=4&tk=${encodeURIComponent(token)}`;
  const ok = await probeImage(sampleUrl, 3500);
  tiandituImageryProbe = { token, ok, checkedAt: now };
  return ok;
}

function isValidImageOverlayBounds(bounds = {}) {
  const normalized = normalizeImageOverlayBounds(bounds);
  return Boolean(normalized);
}

function normalizeImageOverlayBounds(bounds = {}) {
  if (Array.isArray(bounds) && bounds.length >= 4) {
    const [west, south, east, north] = bounds.map(Number);
    return Number.isFinite(west)
      && Number.isFinite(south)
      && Number.isFinite(east)
      && Number.isFinite(north)
      && east > west
      && north > south
      ? { west, south, east, north }
      : null;
  }

  const source = bounds && typeof bounds === 'object' ? bounds : {};
  const west = Number(source.west ?? source.minLon ?? source.minX);
  const south = Number(source.south ?? source.minLat ?? source.minY);
  const east = Number(source.east ?? source.maxLon ?? source.maxX);
  const north = Number(source.north ?? source.maxLat ?? source.maxY);
  return Number.isFinite(west)
    && Number.isFinite(south)
    && Number.isFinite(east)
    && Number.isFinite(north)
    && east > west
    && north > south
    ? { west, south, east, north }
    : null;
}

function resolveImageOverlayUrl(overlay = {}) {
  const directUrl = String(overlay.url || '').trim();
  if (directUrl) return directUrl;
  const image = String(overlay.imageBase64 || overlay.base64 || '').trim();
  if (!image) return '';
  return image.startsWith('data:image') ? image : `data:image/png;base64,${image}`;
}

function clearImageOverlays() {
  if (imageOverlaySource) {
    imageOverlaySource.entities.removeAll();
  }
  if (!viewer) {
    imageOverlayLayers = [];
    return;
  }
  imageOverlayLayers.forEach((layer) => {
    try {
      if (viewer.imageryLayers.contains(layer)) {
        viewer.imageryLayers.remove(layer, true);
      }
    } catch {
      // Overlay cleanup should not interrupt map rendering.
    }
  });
  imageOverlayLayers = [];
}

function refreshImageOverlays() {
  if (!viewer || !imageOverlaySource) return;
  clearImageOverlays();
  props.imageOverlays
    .filter((overlay) => overlay && overlay.visible !== false)
    .slice()
    .sort((left, right) => Number(left.zIndex || 0) - Number(right.zIndex || 0))
    .forEach((overlay) => {
      const url = resolveImageOverlayUrl(overlay);
      const bounds = normalizeImageOverlayBounds(overlay.bounds || overlay.rectangle || overlay.extent);
      if (!url || !isValidImageOverlayBounds(bounds)) return;
      const rectangle = Cesium.Rectangle.fromDegrees(
        bounds.west,
        bounds.south,
        bounds.east,
        bounds.north,
      );
      const alpha = Math.min(1, Math.max(0, Number(overlay.opacity ?? overlay.alpha ?? 0.82)));
      const provider = new Cesium.SingleTileImageryProvider({
        url,
        rectangle,
        tileWidth: Number(overlay.tileWidth || 960),
        tileHeight: Number(overlay.tileHeight || 960),
      });
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = alpha;
      layer.show = true;
      imageOverlayLayers.push(layer);
    });
  viewer.scene.requestRender();
}

function parseOfflineTileMetadata(xmlText) {
  try {
    const documentNode = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (documentNode.querySelector('parsererror')) {
      return null;
    }

    const tileFormat = documentNode.querySelector('TileFormat');
    const tileSets = [...documentNode.querySelectorAll('TileSet')];
    const extension = tileFormat?.getAttribute('extension')?.trim().toLowerCase() || 'png';
    const orders = tileSets
      .map((item) => Number(item.getAttribute('order')))
      .filter((item) => Number.isFinite(item));

    return {
      extension,
      minimumLevel: orders.length ? Math.min(...orders) : 0,
      maximumLevel: orders.length ? Math.max(...orders) : 10,
      useReverseY: true,
    };
  } catch {
    return null;
  }
}

async function detectOfflineTiles() {
  const nextConfig = {
    available: false,
    baseUrl: '/dem',
    extension: 'png',
    minimumLevel: 0,
    maximumLevel: 10,
    useReverseY: false,
  };

  try {
    const response = await fetch(`${nextConfig.baseUrl}/tilemapresource.xml`, { cache: 'no-store' });
    if (response.ok) {
      const metadata = parseOfflineTileMetadata(await response.text());
      if (metadata) {
        Object.assign(nextConfig, metadata);
      }
    }
  } catch {
    // ignore and continue probing by extension
  }

  const candidates = [nextConfig.extension, 'png', 'jpg', 'jpeg', 'webp', 'svg']
    .filter((item, index, list) => list.indexOf(item) === index);

  for (const extension of candidates) {
    const available = await probeImage(`${nextConfig.baseUrl}/0/0/0.${extension}`);
    if (available) {
      nextConfig.available = true;
      nextConfig.extension = extension;
      return nextConfig;
    }
  }

  return nextConfig;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeTerrainRectangle(bounds) {
  if (Array.isArray(bounds) && bounds.length >= 4 && bounds.every(isFiniteNumber)) {
    return Cesium.Rectangle.fromDegrees(
      Number(bounds[0]),
      Number(bounds[1]),
      Number(bounds[2]),
      Number(bounds[3]),
    );
  }

  if (bounds && typeof bounds === 'object') {
    const west = bounds.west ?? bounds.minX;
    const south = bounds.south ?? bounds.minY;
    const east = bounds.east ?? bounds.maxX;
    const north = bounds.north ?? bounds.maxY;
    if ([west, south, east, north].every(isFiniteNumber)) {
      return Cesium.Rectangle.fromDegrees(
        Number(west),
        Number(south),
        Number(east),
        Number(north),
      );
    }
  }

  return null;
}

function createTerrainTilingScheme(projection = 'EPSG:4326') {
  const normalized = String(projection || 'EPSG:4326').toUpperCase();
  return normalized === 'EPSG:3857'
    ? new Cesium.WebMercatorTilingScheme()
    : new Cesium.GeographicTilingScheme();
}

function terrainSchemeUsesReverseY(scheme = 'tms') {
  return String(scheme || '').toLowerCase() === 'tms';
}

function terrainSchemeYToCesiumY(tileY, level, tilingScheme, scheme = 'tms') {
  const numericY = Number(tileY);
  if (!Number.isFinite(numericY)) return numericY;
  if (!terrainSchemeUsesReverseY(scheme)) return numericY;
  const tilesY = tilingScheme.getNumberOfYTilesAtLevel(level);
  return tilesY - 1 - numericY;
}

function cesiumYToTerrainSchemeY(tileY, level, tilingScheme, scheme = 'tms') {
  const numericY = Number(tileY);
  if (!Number.isFinite(numericY)) return numericY;
  if (!terrainSchemeUsesReverseY(scheme)) return numericY;
  const tilesY = tilingScheme.getNumberOfYTilesAtLevel(level);
  return tilesY - 1 - numericY;
}

function buildTerrainCoverageRectangle(availableRanges, tilingScheme, scheme = 'tms') {
  if (!Array.isArray(availableRanges) || !availableRanges.length || !tilingScheme) {
    return null;
  }

  const targetLevel = [...availableRanges.keys()].reverse().find((level) => {
    const ranges = availableRanges[level];
    return Array.isArray(ranges) && ranges.length > 0;
  });

  if (!Number.isInteger(targetLevel)) {
    return null;
  }

  let rectangle = null;
  const ranges = availableRanges[targetLevel] || [];
  for (const range of ranges) {
    const startX = Number(range?.startX);
    const endX = Number(range?.endX);
    const startY = Number(range?.startY);
    const endY = Number(range?.endY);
    if (![startX, endX, startY, endY].every(Number.isFinite)) {
      continue;
    }

    const westY = terrainSchemeYToCesiumY(endY, targetLevel, tilingScheme, scheme);
    const eastY = terrainSchemeYToCesiumY(startY, targetLevel, tilingScheme, scheme);
    const rangeRectangle = tilingScheme.tileXYToRectangle(startX, westY, targetLevel);
    const oppositeRectangle = tilingScheme.tileXYToRectangle(endX, eastY, targetLevel);
    const candidate = Cesium.Rectangle.fromRadians(
      Math.min(rangeRectangle.west, oppositeRectangle.west),
      Math.min(rangeRectangle.south, oppositeRectangle.south),
      Math.max(rangeRectangle.east, oppositeRectangle.east),
      Math.max(rangeRectangle.north, oppositeRectangle.north),
    );
    rectangle = rectangle ? Cesium.Rectangle.union(rectangle, candidate, new Cesium.Rectangle()) : candidate;
  }

  return rectangle;
}

function buildTerrainFocusRectangle(availableRanges, tilingScheme, scheme = 'tms') {
  if (!Array.isArray(availableRanges) || !availableRanges.length || !tilingScheme) {
    return null;
  }

  const targetLevel = [...availableRanges.keys()].reverse().find((level) => {
    const ranges = availableRanges[level];
    return Array.isArray(ranges) && ranges.length > 0;
  });

  if (!Number.isInteger(targetLevel)) {
    return null;
  }

  const bestRange = (availableRanges[targetLevel] || [])
    .map((range) => ({
      ...range,
      area: (Number(range.endX) - Number(range.startX) + 1) * (Number(range.endY) - Number(range.startY) + 1),
    }))
    .sort((left, right) => right.area - left.area)[0];

  if (!bestRange) {
    return null;
  }

  const northY = terrainSchemeYToCesiumY(bestRange.endY, targetLevel, tilingScheme, scheme);
  const southY = terrainSchemeYToCesiumY(bestRange.startY, targetLevel, tilingScheme, scheme);
  const firstRectangle = tilingScheme.tileXYToRectangle(Number(bestRange.startX), northY, targetLevel);
  const lastRectangle = tilingScheme.tileXYToRectangle(Number(bestRange.endX), southY, targetLevel);

  return Cesium.Rectangle.fromRadians(
    Math.min(firstRectangle.west, lastRectangle.west),
    Math.min(firstRectangle.south, lastRectangle.south),
    Math.max(firstRectangle.east, lastRectangle.east),
    Math.max(firstRectangle.north, lastRectangle.north),
  );
}

function parseTerrainMetadata(layerJson) {
  const tilingScheme = createTerrainTilingScheme(layerJson?.projection);
  const scheme = String(layerJson?.scheme || 'tms').toLowerCase();
  const rectangle = normalizeTerrainRectangle(layerJson?.valid_bounds || layerJson?.bounds);
  const availableRanges = Array.isArray(layerJson?.available) ? layerJson.available : [];
  const coverageRectangle = buildTerrainCoverageRectangle(availableRanges, tilingScheme, scheme) || rectangle;
  const focusRectangle = buildTerrainFocusRectangle(availableRanges, tilingScheme, scheme) || coverageRectangle;

  return {
    rectangle,
    coverageRectangle,
    focusRectangle,
    tilingScheme,
    scheme,
    availableRanges,
    minimumLevel: Number.isFinite(Number(layerJson?.minzoom)) ? Number(layerJson.minzoom) : 0,
    maximumLevel: Number.isFinite(Number(layerJson?.maxzoom))
      ? Number(layerJson.maxzoom)
      : Math.max(0, availableRanges.length - 1),
  };
}

function isPositionCoveredByTerrain(cartographic, terrainConfig) {
  return getTerrainCoverageLevelForPosition(cartographic, terrainConfig) >= 0
    || Boolean(terrainConfig?.coverageRectangle && Cesium.Rectangle.contains(terrainConfig.coverageRectangle, cartographic));
}

function getTerrainCoverageLevelForPosition(cartographic, terrainConfig) {
  if (!cartographic || !terrainConfig?.tilingScheme) {
    return -1;
  }

  if (Array.isArray(terrainConfig.availableRanges) && terrainConfig.availableRanges.length) {
    const highestLevel = Math.min(
      Number.isFinite(terrainConfig.maximumLevel) ? terrainConfig.maximumLevel : terrainConfig.availableRanges.length - 1,
      terrainConfig.availableRanges.length - 1,
    );

    for (let level = highestLevel; level >= 0; level -= 1) {
      const ranges = terrainConfig.availableRanges[level];
      if (!Array.isArray(ranges) || !ranges.length) {
        continue;
      }

      const tileXY = terrainConfig.tilingScheme.positionToTileXY(cartographic, level);
      if (!tileXY) {
        continue;
      }

      const terrainY = cesiumYToTerrainSchemeY(tileXY.y, level, terrainConfig.tilingScheme, terrainConfig.scheme);
      const matched = ranges.some((range) => (
        tileXY.x >= Number(range.startX)
        && tileXY.x <= Number(range.endX)
        && terrainY >= Number(range.startY)
        && terrainY <= Number(range.endY)
      ));
      if (matched) {
        return level;
      }
    }
  }

  return -1;
}

function flyCameraToTerrainCoverage(terrainConfig) {
  const targetRectangle = terrainConfig?.focusRectangle || terrainConfig?.coverageRectangle;
  if (!viewer || !targetRectangle) {
    return false;
  }

  const center = Cesium.Rectangle.center(targetRectangle);
  const lon = Cesium.Math.toDegrees(center.longitude);
  const lat = Cesium.Math.toDegrees(center.latitude);
  const spanMeters = Math.max(
    targetRectangle.width,
    targetRectangle.height,
  ) * 6378137;
  const height = Math.max(140000, spanMeters * 1.8);

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-45),
      roll: 0,
    },
    duration: 1.4,
  });
  return true;
}

async function detectOfflineTerrain() {
  const candidates = ['/terrain', '/dem'];

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}/layer.json`, { cache: 'no-store' });
      if (response.ok) {
        const metadata = parseTerrainMetadata(await response.json());
        return {
          available: true,
          url: baseUrl,
          ...metadata,
        };
      }
    } catch {
      // continue probing
    }
  }

  return {
    available: false,
    url: '',
    rectangle: null,
    coverageRectangle: null,
    focusRectangle: null,
    tilingScheme: null,
    scheme: 'tms',
    availableRanges: [],
    minimumLevel: 0,
    maximumLevel: 0,
  };
}
function getTiandituTerrainUrl() {
  return terrainUrlFromEnv || '';
}

async function resolveTerrainServiceUrl(rawUrl) {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) return '';

  const cleanUrl = normalized.replace(/\/+$/, '');
  const candidates = cleanUrl.includes('layer.json')
    ? [cleanUrl]
    : [`${cleanUrl}/layer.json`, cleanUrl];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: 'no-store' });
      if (response.ok) {
        return cleanUrl;
      }
    } catch {
      // continue probing
    }
  }

  return '';
}

function createImageryProviders(mode) {
  const providers = [new Cesium.GridImageryProvider({ cells: 8, color: Cesium.Color.fromCssColorString('#6f8f52') })];
  const token = getTiandituToken();

  if (mode === 'grid') {
    return providers;
  }

  if (mode === 'offline' && offlineTileConfig.available) {
    const templateY = offlineTileConfig.useReverseY ? '{reverseY}' : '{y}';
    providers.push(new Cesium.UrlTemplateImageryProvider({
      url: `${offlineTileConfig.baseUrl}/{z}/{x}/${templateY}.${offlineTileConfig.extension}`,
      minimumLevel: offlineTileConfig.minimumLevel,
      maximumLevel: offlineTileConfig.maximumLevel,
      credit: `Offline Tiles (${offlineTileConfig.extension.toUpperCase()})`,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
    }));
    return providers;
  }

  if (mode === 'tianditu' && token) {
    const encodedToken = encodeURIComponent(token);
    providers.push(
      new Cesium.UrlTemplateImageryProvider({
        url: `https://t{s}.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk=${encodedToken}`,
        subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
        maximumLevel: 18,
      }),
      new Cesium.UrlTemplateImageryProvider({
        url: `https://t{s}.tianditu.gov.cn/DataServer?T=cia_w&x={x}&y={y}&l={z}&tk=${encodedToken}`,
        subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
        maximumLevel: 18,
      }),
    );
    return providers;
  }

  return providers;
}

async function refreshBasemap() {
  if (!viewer) return;

  clearImageOverlays();
  const currentToken = getTiandituToken();
  basemapState.value = {
    requested: props.basemap,
    resolved: 'grid',
    message: '正在检测底图...',
  };
  offlineTileConfig = await detectOfflineTiles();
  const needsTianditu = props.basemap === 'auto' || props.basemap === 'tianditu' || props.basemap === 'offline';
  const tiandituAvailable = needsTianditu ? await isTiandituImageryReachable(props.basemap === 'tianditu') : false;

  let resolvedMode = props.basemap;
  let fallbackMessage = '';
  if (resolvedMode === 'auto') {
    resolvedMode = offlineTileConfig.available ? 'offline' : (tiandituAvailable ? 'tianditu' : 'grid');
    if (!offlineTileConfig.available && currentToken && !tiandituAvailable) {
      fallbackMessage = '天地图瓦片当前不可用，已自动回退到网格演示底图。';
    }
  }

  if (resolvedMode === 'offline' && !offlineTileConfig.available) {
    resolvedMode = tiandituAvailable ? 'tianditu' : 'grid';
    fallbackMessage = tiandituAvailable
      ? '未检测到离线底图，已自动回退到天地图影像。'
      : '未检测到离线底图，天地图瓦片也不可用，已回退到网格演示底图。';
  }

  if (resolvedMode === 'tianditu' && !currentToken) {
    resolvedMode = offlineTileConfig.available ? 'offline' : 'grid';
    fallbackMessage = '未配置天地图令牌，已自动回退。';
  }

  if (resolvedMode === 'tianditu' && currentToken && !tiandituAvailable) {
    resolvedMode = offlineTileConfig.available ? 'offline' : 'grid';
    fallbackMessage = resolvedMode === 'offline'
      ? '天地图瓦片当前不可用，已回退到离线底图。'
      : '天地图瓦片当前不可用，已回退到网格演示底图。';
  }

  viewer.imageryLayers.removeAll();
  for (const provider of createImageryProviders(resolvedMode)) {
    viewer.imageryLayers.addImageryProvider(provider);
  }
  refreshImageOverlays();

  basemapState.value = {
    requested: props.basemap,
    resolved: resolvedMode,
    message: fallbackMessage || (resolvedMode === 'offline'
      ? `当前底图：离线底图 ${offlineTileConfig.baseUrl} .${offlineTileConfig.extension} / 级别 ${offlineTileConfig.minimumLevel}~${offlineTileConfig.maximumLevel}${offlineTileConfig.useReverseY ? ' / TMS' : ''}`
      : resolvedMode === 'tianditu'
        ? '当前底图：天地图影像'
        : '当前底图：网格演示底图'),
  };
}

async function createOfflineTerrainProvider() {
  return Cesium.CesiumTerrainProvider.fromUrl(offlineTerrainConfig.url, {
    requestVertexNormals: true,
    requestWaterMask: false,
  });
}

async function refreshTerrain() {
  if (!viewer) return;

  if (props.mapMode === '2D') {
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.globe.enableLighting = false;
    terrainState.value = {
      requested: props.terrainMode,
      resolved: 'flat',
      message: '二维地图已自动关闭 DEM，以避免位置漂移。',
    };
    return;
  }

  terrainState.value = {
    requested: props.terrainMode,
    resolved: 'flat',
    message: 'Loading terrain...',
  };

  offlineTerrainConfig = await detectOfflineTerrain();
  let resolvedMode = props.terrainMode;
  let provider = new Cesium.EllipsoidTerrainProvider();
  let message = '当前地形：平面椭球';

  try {
    if (resolvedMode === 'offline') {
      if (!offlineTerrainConfig.available) {
        resolvedMode = 'flat';
        message = '未检测到离线 DEM，请检查 /terrain 或 /dem。';
      } else {
        provider = await createOfflineTerrainProvider();
        message = `当前地形：离线 DEM / ${offlineTerrainConfig.url}`;
      }
    }

    if (resolvedMode === 'tianditu') {
      const terrainUrl = await resolveTerrainServiceUrl(getTiandituTerrainUrl());
      if (!terrainUrl) {
        if (offlineTerrainConfig.available) {
          resolvedMode = 'offline';
          provider = await createOfflineTerrainProvider();
          message = `在线 DEM 不可用，已回退到离线 DEM / ${offlineTerrainConfig.url}`;
        } else {
          resolvedMode = 'flat';
          message = '在线 DEM 不可用，已回退到平面椭球。';
        }
      } else {
        provider = await Cesium.CesiumTerrainProvider.fromUrl(terrainUrl, {
          requestVertexNormals: true,
          requestWaterMask: false,
        });
        message = '当前地形：在线 DEM';
      }
    }
  } catch {
    if (offlineTerrainConfig.available && resolvedMode === 'tianditu') {
      provider = await createOfflineTerrainProvider().catch(() => new Cesium.EllipsoidTerrainProvider());
      resolvedMode = provider instanceof Cesium.EllipsoidTerrainProvider ? 'flat' : 'offline';
      message = resolvedMode === 'offline'
        ? `在线 DEM 加载失败，已回退到离线 DEM / ${offlineTerrainConfig.url}`
        : '地形加载失败，已回退到平面椭球。';
    } else {
      provider = new Cesium.EllipsoidTerrainProvider();
      resolvedMode = 'flat';
      message = '地形加载失败，已回退到平面椭球。';
    }
  }

  viewer.terrainProvider = provider;
  viewer.scene.globe.depthTestAgainstTerrain = resolvedMode !== 'flat';
  viewer.scene.globe.enableLighting = false;

  terrainState.value = {
    requested: props.terrainMode,
    resolved: resolvedMode,
    message,
  };
}

function applyLiveGeometry(entityId, geometryType, coordinates, entityMeta = null, entityRadius = null) {
  const cesiumEntity = situationSource.entities.getById(entityId);
  if (!cesiumEntity) return;

  if (geometryType === 'point' || geometryType === 'circle') {
    cesiumEntity.position = toCartesian(coordinates);
    if (geometryType === 'circle') {
      const currentEntity = props.entities.find((item) => item.id === entityId);
      const radius = Number(entityRadius || currentEntity?.radius || 30000);
      const detectionMeta = entityMeta || currentEntity?.meta || {};
      const detectionProfile = getDetectionVisualProfile(detectionMeta);
      const entityColor = currentEntity?.color || detectionProfile.defaultColor;
      const displayColor = props.activeEntityId && props.activeEntityId === entityId ? '#f8fafc' : entityColor;
      const detectionSector = resolveDetectionSectorMeta(detectionMeta);
      const detectionClockRange = buildDetectionClockRange(detectionMeta);
      const footprintHierarchy = buildDetectionFootprintHierarchy(coordinates, radius, detectionMeta);
      const directionPoint = resolveDetectionDirectionPoint(coordinates, radius, detectionSector);
      if (cesiumEntity.ellipsoid) {
        syncDetectionEllipsoidGraphic(
          cesiumEntity.ellipsoid,
          radius,
          detectionSector,
          detectionClockRange,
          getColor(entityColor, detectionProfile.shellAlpha),
          { outline: true, outlineColor: getColor(displayColor, 0.82) },
        );
      }
      const fillLayers = detectionProfile.fillLayers || defaultDetectionFillLayers;
      fillLayers.forEach((layer, index) => {
        const fillEntity = situationSource.entities.getById(detectionFillLayerId(entityId, index + 1));
        if (fillEntity?.ellipsoid) {
          syncDetectionEllipsoidGraphic(
            fillEntity.ellipsoid,
            radius,
            detectionSector,
            detectionClockRange,
            getColor(entityColor, layer.alpha),
            { scale: layer.scale },
          );
        }
      });
      const footprintEntity = situationSource.entities.getById(`${entityId}__sensor-footprint`);
      if (footprintEntity?.polygon && footprintHierarchy) {
        footprintEntity.position = toCartesian(coordinates);
        footprintEntity.polygon.hierarchy = footprintHierarchy;
        footprintEntity.polygon.material = getColor(entityColor, props.mapMode === '2D' ? 0.34 : 0.18);
        footprintEntity.polygon.outlineColor = getColor(displayColor, 0.96);
      } else if (footprintEntity) {
        situationSource.entities.remove(footprintEntity);
      }
      (detectionProfile.envelopes || []).forEach((spec, index) => {
        const envelopeEntity = situationSource.entities.getById(detectionEnvelopeLayerId(entityId, index + 1));
        const envelopePositions = buildDetectionEnvelopePositions(coordinates, radius, detectionMeta, spec.scale);
        if (envelopeEntity?.polyline && envelopePositions) {
          envelopeEntity.polyline.positions = envelopePositions;
          envelopeEntity.polyline.width = (props.activeEntityId && props.activeEntityId === entityId ? 0.8 : 0) + Number(spec.width || 3);
          envelopeEntity.polyline.material = createDetectionPolylineMaterial(entityColor, spec);
          envelopeEntity.polyline.clampToGround = props.mapMode === '2D';
        } else if (envelopeEntity) {
          situationSource.entities.remove(envelopeEntity);
        }
      });
      const sensorRay = situationSource.entities.getById(`${entityId}__sensor-ray`);
      if (sensorRay?.polyline) {
        sensorRay.polyline.positions = [
          toCartesian(coordinates),
          toCartesian(directionPoint),
        ];
        sensorRay.polyline.width = (props.activeEntityId && props.activeEntityId === entityId ? 0.8 : 0) + Number(detectionProfile.ray?.width || 3);
        sensorRay.polyline.material = createDetectionPolylineMaterial(entityColor, detectionProfile.ray);
        sensorRay.polyline.clampToGround = props.mapMode === '2D';
      }
    }
    return;
  }

  if (geometryType === 'polyline') {
    cesiumEntity.position = toCartesian(coordinates[0]);
    cesiumEntity.polyline.positions = coordinates.map(toCartesian);
    cesiumEntity.polyline.clampToGround = props.mapMode === '2D'
      || coordinates.every((point) => Number(point[2] || 0) === 0);
    const headEntity = situationSource.entities.getById(`${entityId}__order-head`);
    if (headEntity) {
      const currentEntity = props.entities.find((item) => item.id === entityId);
      const styleKey = entityMeta?.commandStyle ?? currentEntity?.meta?.commandStyle ?? 'assault';
      headEntity.position = toCartesian(coordinates[coordinates.length - 1]);
      headEntity.billboard.image = svgForArrow(styleKey, currentEntity?.color || '#facc15');
      headEntity.billboard.rotation = computeLineHeadingRadians(coordinates);
    }
    [...new Set([0, Math.max(coordinates.length - 1, 0)])].forEach((index) => {
      const vertexEntity = situationSource.entities.getById(polylineVertexHandleId(entityId, index));
      if (vertexEntity && coordinates[index]) {
        vertexEntity.position = toCartesian(coordinates[index]);
      }
    });
    return;
  }

  if (geometryType === 'polygon') {
    cesiumEntity.position = toCartesian(coordinates[0]);
    cesiumEntity.polygon.hierarchy = new Cesium.PolygonHierarchy(coordinates.map(toCartesian));
    coordinates.forEach((point, index) => {
      const vertexEntity = situationSource.entities.getById(polygonVertexHandleId(entityId, index));
      if (vertexEntity) {
        vertexEntity.position = toCartesian(point);
      }
    });
  }
}

function addSituationEntity(entity) {
  const highlighted = props.activeEntityId && props.activeEntityId === entity.id;
  const fallbackColor = entity.type === 'detection'
    ? getDetectionVisualProfile(entity.meta || {}).defaultColor
    : '#7dd3fc';
  const baseColor = entity.color || fallbackColor;
  const color = highlighted ? '#f8fafc' : baseColor;
  const altitude = Number(entity.geometryType === 'point' || entity.geometryType === 'circle'
    ? entity.coordinates[2] || 0
    : entity.coordinates?.[0]?.[2] || 0);
  const useGroundClamp = shouldClampPointToGround(altitude);
  const unitSubtype = getMeta(entity, 'unitSubtype', 'tank');
  const commandStyle = getMeta(entity, 'commandStyle', 'assault');
  const detectionMeta = entity.meta || {};
  const detectionSector = resolveDetectionSectorMeta(detectionMeta);
  const detectionClockRange = buildDetectionClockRange(detectionMeta);

  if (entity.geometryType === 'point') {
    situationSource.entities.add({
      id: entity.id,
      position: toCartesian(entity.coordinates),
      billboard: {
        image: svgForCamp(entity.camp, color, unitSubtype),
        width: highlighted ? 34 : 28,
        height: highlighted ? 34 : 28,
        heightReference: useGroundClamp ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: entity.name,
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#101611').withAlpha(0.72),
        pixelOffset: new Cesium.Cartesian2(0, -26),
        heightReference: useGroundClamp ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
      },
      description: entity.annotation,
    });
    return;
  }

  if (entity.geometryType === 'circle') {
    const radius = Number(entity.radius || 30000);
    const detectionProfile = getDetectionVisualProfile(detectionMeta);
    const sensorColor = entity.color || detectionProfile.defaultColor;
    const fillLayers = detectionProfile.fillLayers || defaultDetectionFillLayers;
    const directionPoint = resolveDetectionDirectionPoint(entity.coordinates, radius, detectionSector);
    const footprintHierarchy = buildDetectionFootprintHierarchy(entity.coordinates, radius, detectionMeta);
    situationSource.entities.add({
      id: entity.id,
      position: toCartesian(entity.coordinates),
      point: {
        pixelSize: highlighted ? 13 : 10,
        color: getColor(color, 0.96),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      ellipsoid: buildDetectionEllipsoidConfig(
        radius,
        detectionSector,
        detectionClockRange,
        getColor(sensorColor, detectionProfile.shellAlpha),
        { outline: true, outlineColor: getColor(color, 0.82) },
      ),
      label: {
        text: entity.name,
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        pixelOffset: new Cesium.Cartesian2(0, -8),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#101611').withAlpha(0.62),
      },
      description: entity.annotation,
    });
    fillLayers.forEach((layer, index) => {
      situationSource.entities.add({
        id: detectionFillLayerId(entity.id, index + 1),
        position: toCartesian(entity.coordinates),
        ellipsoid: buildDetectionEllipsoidConfig(
          radius,
          detectionSector,
          detectionClockRange,
          getColor(sensorColor, layer.alpha),
          { scale: layer.scale },
        ),
      });
    });
    if (footprintHierarchy) {
      situationSource.entities.add({
        id: `${entity.id}__sensor-footprint`,
        position: toCartesian(entity.coordinates),
        polygon: {
          hierarchy: footprintHierarchy,
          material: getColor(sensorColor, props.mapMode === '2D' ? 0.34 : 0.18),
          outline: true,
          outlineColor: getColor(color, 0.92),
          perPositionHeight: props.mapMode !== '2D',
        },
      });
    }
    (detectionProfile.envelopes || []).forEach((spec, index) => {
      const envelopePositions = buildDetectionEnvelopePositions(entity.coordinates, radius, detectionMeta, spec.scale);
      if (!envelopePositions) return;
      situationSource.entities.add({
        id: detectionEnvelopeLayerId(entity.id, index + 1),
        polyline: {
          positions: envelopePositions,
          width: (highlighted ? 0.8 : 0) + Number(spec.width || 3),
          material: createDetectionPolylineMaterial(sensorColor, spec),
          clampToGround: props.mapMode === '2D',
        },
      });
    });
    situationSource.entities.add({
      id: `${entity.id}__sensor-ray`,
      polyline: {
        positions: [toCartesian(entity.coordinates), toCartesian(directionPoint)],
        width: (highlighted ? 0.8 : 0) + Number(detectionProfile.ray?.width || 3),
        material: createDetectionPolylineMaterial(sensorColor, detectionProfile.ray),
        clampToGround: props.mapMode === '2D',
      },
    });
    return;
  }

  if (entity.geometryType === 'polyline') {
    situationSource.entities.add({
      id: entity.id,
      position: toCartesian(entity.coordinates[0]),
      polyline: {
        positions: entity.coordinates.map(toCartesian),
        width: highlighted ? 5 : 3,
        material: getColor(color, 0.95),
        clampToGround: props.mapMode === '2D'
          || entity.coordinates.every((point) => Number(point[2] || 0) === 0),
      },
      label: {
        text: entity.name,
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
      },
      description: entity.annotation,
    });
    situationSource.entities.add({
      id: `${entity.id}__order-head`,
      position: toCartesian(entity.coordinates[entity.coordinates.length - 1]),
      billboard: {
        image: svgForArrow(commandStyle, color),
        width: highlighted ? 34 : 28,
        height: highlighted ? 34 : 28,
        rotation: computeLineHeadingRadians(entity.coordinates),
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    if (highlighted && props.canManage) {
      [...new Set([0, Math.max(entity.coordinates.length - 1, 0)])].forEach((index) => {
        const point = entity.coordinates[index];
        if (!point) return;
        situationSource.entities.add({
          id: polylineVertexHandleId(entity.id, index),
          position: toCartesian(point),
          point: {
            pixelSize: 10,
            color: getColor('#f8fafc', 0.96),
            outlineColor: getColor(entity.color, 0.96),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });
    }
    return;
  }

  if (entity.geometryType === 'polygon') {
    situationSource.entities.add({
      id: entity.id,
      position: toCartesian(entity.coordinates[0]),
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(entity.coordinates.map(toCartesian)),
        perPositionHeight: props.mapMode !== '2D',
        material: getColor(entity.color, 0.18),
        outline: true,
        outlineColor: getColor(color, 0.96),
      },
      label: {
        text: entity.name,
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
      },
      description: entity.annotation,
    });

    if (highlighted && props.canManage) {
      entity.coordinates.forEach((point, index) => {
        situationSource.entities.add({
          id: polygonVertexHandleId(entity.id, index),
          position: toCartesian(point),
          point: {
            pixelSize: 10,
            color: getColor('#f8fafc', 0.96),
            outlineColor: getColor(entity.color, 0.96),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });
    }
  }
}

function refreshEntities() {
  if (!situationSource || !environmentSource) return;
  situationSource.entities.removeAll();
  environmentSource.entities.removeAll();

  if (props.layerVisibility.environment) {
    props.environment.forEach((item) => {
      const style = resolveEnvironmentStyle(item);
      const labelText = buildEnvironmentLabel(item);
      const label = labelText
        ? { text: labelText, font: '13px sans-serif', fillColor: Cesium.Color.WHITE }
        : undefined;

      if (item.geometryType === 'polygon') {
        environmentSource.entities.add({
          id: `env-${item.id}`,
          position: toCartesian(item.geometry[0]),
          polygon: {
            hierarchy: item.geometry.map(toCartesian),
            perPositionHeight: props.mapMode !== '2D',
            material: getColor(style.fillColor, style.fillAlpha),
            outline: true,
            outlineColor: getColor(style.outlineColor, style.outlineAlpha),
          },
          ...(label ? { label } : {}),
        });
      }

      if (item.geometryType === 'circle') {
        environmentSource.entities.add({
          id: `env-${item.id}`,
          position: toCartesian(item.geometry.center),
          ellipse: {
            semiMajorAxis: item.geometry.radius,
            semiMinorAxis: item.geometry.radius,
            height: props.mapMode === '2D' ? 0 : Number(item.geometry.center[2] || 0),
            material: getColor(style.fillColor, style.fillAlpha),
            outline: true,
            outlineColor: getColor(style.outlineColor, style.outlineAlpha),
          },
          ...(label ? { label } : {}),
        });
      }
    });
  }

  props.entities.filter((entity) => isEntityVisible(entity)).forEach(addSituationEntity);
}

function renderMeasurementRecord(record) {
  if (!measurementSource || !record) return;

  const color = getMeasurementColor(record.type);
  const positions = record.points.map(toCartesian);
  const clampToGround = props.mapMode === '2D' || record.points.every((point) => Number(point?.[2] || 0) === 0);

  if (record.type === 'distance') {
    measurementSource.entities.add({
      id: `measurement-${record.id}`,
      polyline: {
        positions,
        width: 3.5,
        material: getColor(color, 0.96),
        clampToGround,
      },
    });

    record.points.forEach((point, index) => {
      measurementSource.entities.add({
        id: measurementVertexId(record.id, index),
        position: toCartesian(point),
        point: {
          pixelSize: 8,
          color: getColor('#f8fafc', 0.96),
          outlineColor: getColor(color, 0.96),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });

    record.segments.forEach((segment, index) => {
      measurementSource.entities.add({
        id: measurementSegmentLabelId(record.id, index),
        position: toCartesian(segment.midpoint),
        label: {
          text: formatDistance(segment.distance),
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#101611').withAlpha(0.74),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new Cesium.Cartesian2(0, -10),
        },
      });
    });

    measurementSource.entities.add({
      id: measurementTotalLabelId(record.id),
      position: toCartesian(record.points[record.points.length - 1]),
      label: {
        text: `鎬婚暱 ${formatDistance(record.totalDistance)}`,
        font: '13px sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString(color).withAlpha(0.28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        pixelOffset: new Cesium.Cartesian2(0, -18),
      },
    });

    return;
  }

  measurementSource.entities.add({
    id: `measurement-${record.id}`,
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(positions),
      perPositionHeight: props.mapMode !== '2D',
      material: getColor(color, props.mapMode === '2D' ? 0.24 : 0.18),
      outline: true,
      outlineColor: getColor(color, 0.92),
    },
  });

  measurementSource.entities.add({
    id: measurementAreaOutlineId(record.id),
    polyline: {
      positions: [...record.points, record.points[0]].map(toCartesian),
      width: 2.8,
      material: getColor(color, 0.96),
      clampToGround,
    },
  });

  record.points.forEach((point, index) => {
    measurementSource.entities.add({
      id: measurementVertexId(record.id, index),
      position: toCartesian(point),
      point: {
        pixelSize: 8,
        color: getColor('#f8fafc', 0.96),
        outlineColor: getColor(color, 0.96),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  });

  measurementSource.entities.add({
    id: measurementAreaLabelId(record.id),
    position: toCartesian(record.centroid),
    label: {
      text: `闈㈢Н ${formatArea(record.area)}`,
      font: '13px sans-serif',
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString(color).withAlpha(0.26),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cesium.Cartesian2(0, -12),
    },
  });
}

function refreshMeasurements() {
  if (!measurementSource) return;
  measurementSource.entities.removeAll();
  measurementRecords.forEach(renderMeasurementRecord);
  measurementState.count = measurementRecords.length;
  emitMeasurementState();
}

function clearMeasurementDraftEntities() {
  measurementDraftSource?.entities.removeAll();
}

function cancelMeasurement() {
  measurementDraftPoints = [];
  measurementCursorPoint = null;
  measurementState.active = false;
  measurementState.type = '';
  emitMeasurementState();
  clearMeasurementDraftEntities();
  viewer?.scene.requestRender();
}

function clearMeasurements() {
  measurementRecords = [];
  measurementState.count = 0;
  cancelMeasurement();
  measurementSource?.entities.removeAll();
  viewer?.scene.requestRender();
}

function startMeasurement(type) {
  if (!viewer || props.drawTool.active || !isMeasurementType(type)) return false;

  closeContextMenu();
  closeSelectionMenu();
  measurementDraftPoints = [];
  measurementCursorPoint = null;
  measurementState.active = true;
  measurementState.type = type;
  emitMeasurementState();
  clearMeasurementDraftEntities();
  viewer.scene.requestRender();
  return true;
}

function clearDraft() {
  draftPoints = [];
  draftCursorPoint = null;
  draftSource?.entities.removeAll();
  emit('draw-progress', { count: 0 });
}

function getMeasurementPreviewPoints() {
  if (!measurementDraftPoints.length) return [];

  if (!measurementCursorPoint) {
    return [...measurementDraftPoints];
  }

  return [...measurementDraftPoints, measurementCursorPoint];
}

function refreshMeasurementDraft() {
  if (!measurementDraftSource) return;
  measurementDraftSource.entities.removeAll();

  if (!isMeasurementActive()) return;

  const previewPoints = getMeasurementPreviewPoints();
  if (!previewPoints.length) return;

  const color = getMeasurementColor();
  const elevatedDraft = previewPoints.map((point) => [point[0], point[1], Number(point[2] || 0)]);

  elevatedDraft.forEach((point, index) => {
    measurementDraftSource.entities.add({
      id: `measurement-draft__vertex-${index}`,
      position: toCartesian(point),
      point: {
        pixelSize: index < measurementDraftPoints.length ? 8 : 7,
        color: getColor('#f8fafc', index < measurementDraftPoints.length ? 0.96 : 0.72),
        outlineColor: getColor(color, 0.92),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  });

  if (measurementState.type === 'distance' && elevatedDraft.length >= 2) {
    measurementDraftSource.entities.add({
      id: 'measurement-draft__distance',
      polyline: {
        positions: elevatedDraft.map(toCartesian),
        width: 3.5,
        material: getColor(color, 0.9),
        clampToGround: props.mapMode === '2D',
      },
    });

    measurementDraftSource.entities.add({
      id: 'measurement-draft__distance-total',
      position: toCartesian(elevatedDraft[elevatedDraft.length - 1]),
      label: {
        text: `预计总长 ${formatDistance(computePolylineDistance(elevatedDraft))}`,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString(color).withAlpha(0.24),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        pixelOffset: new Cesium.Cartesian2(0, -18),
      },
    });
    return;
  }

  if (measurementState.type === 'area') {
    if (elevatedDraft.length === 2) {
      measurementDraftSource.entities.add({
        id: 'measurement-draft__area-line',
        polyline: {
          positions: elevatedDraft.map(toCartesian),
          width: 2.8,
          material: getColor(color, 0.9),
          clampToGround: props.mapMode === '2D',
        },
      });
      return;
    }

    if (elevatedDraft.length >= 3) {
      measurementDraftSource.entities.add({
        id: 'measurement-draft__area-polygon',
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(elevatedDraft.map(toCartesian)),
          perPositionHeight: props.mapMode !== '2D',
          material: getColor(color, props.mapMode === '2D' ? 0.22 : 0.16),
          outline: true,
          outlineColor: getColor(color, 0.92),
        },
      });

      measurementDraftSource.entities.add({
        id: 'measurement-draft__area-label',
        position: toCartesian(computePolygonCentroid(elevatedDraft)),
        label: {
          text: `预计面积 ${formatArea(computePolygonArea(elevatedDraft))}`,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString(color).withAlpha(0.24),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          pixelOffset: new Cesium.Cartesian2(0, -12),
        },
      });
    }
  }
}

function getDraftPreviewPoints() {
  if (!draftPoints.length) return [];

  if (!draftCursorPoint) {
    return [...draftPoints];
  }

  if (props.drawTool.type === 'order') {
    return [...draftPoints, draftCursorPoint];
  }

  if (props.drawTool.type === 'zone' && props.drawTool.zoneShape === 'rectangle') {
    return [draftPoints[0], draftCursorPoint];
  }

  if (props.drawTool.type === 'zone') {
    return [...draftPoints, draftCursorPoint];
  }

  return [...draftPoints];
}

function refreshDraft() {
  if (!draftSource) return;
  draftSource.entities.removeAll();
  const previewPoints = getDraftPreviewPoints();
  if (!previewPoints.length) return;

  const color = props.drawTool.color || '#a3e635';
  const elevatedDraft = previewPoints.map((point) => [point[0], point[1], Number(point[2] || 0)]);

  if (props.drawTool.type === 'order' && elevatedDraft.length >= 2) {
    draftSource.entities.add({
      polyline: {
        positions: elevatedDraft.map(toCartesian),
        width: 3,
        material: getColor(color, 0.9),
      },
    });
    return;
  }

  if (props.drawTool.type === 'zone') {
    if (props.drawTool.zoneShape === 'rectangle' && elevatedDraft.length >= 2) {
      draftSource.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(buildRectanglePolygon(elevatedDraft[0], elevatedDraft[elevatedDraft.length - 1]).map(toCartesian)),
          perPositionHeight: true,
          material: getColor(color, 0.15),
          outline: true,
          outlineColor: getColor(color, 0.9),
        },
      });
      return;
    }

    if (elevatedDraft.length === 2) {
      draftSource.entities.add({
        polyline: {
          positions: elevatedDraft.map(toCartesian),
          width: 2.5,
          material: getColor(color, 0.9),
        },
      });
      return;
    }

    if (elevatedDraft.length >= 3) {
      draftSource.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(elevatedDraft.map(toCartesian)),
          perPositionHeight: true,
          material: getColor(color, 0.15),
          outline: true,
          outlineColor: getColor(color, 0.9),
        },
      });
    }
  }
}

function finalizeDraw() {
  if (!props.drawTool.active) return;
  if (props.drawTool.type === 'order' && draftPoints.length >= 2) {
    emit('draw-complete', { geometryType: 'polyline', coordinates: [...draftPoints] });
    clearDraft();
    return;
  }

  if (props.drawTool.type === 'zone') {
    if (props.drawTool.zoneShape === 'rectangle' && draftPoints.length >= 2) {
      emit('draw-complete', {
        geometryType: 'polygon',
        coordinates: buildRectanglePolygon(draftPoints[0], draftPoints[draftPoints.length - 1]),
      });
      clearDraft();
      return;
    }

    if (draftPoints.length >= 3) {
      emit('draw-complete', { geometryType: 'polygon', coordinates: [...draftPoints] });
      clearDraft();
    }
  }
}

function createDistanceMeasurement(points) {
  const sanitizedPoints = dedupeSequentialPoints(points);
  if (sanitizedPoints.length < 2) return;
  const segments = sanitizedPoints.slice(1).map((point, index) => ({
    distance: computeSegmentDistance(sanitizedPoints[index], point),
    midpoint: interpolateSegmentMidpoint(sanitizedPoints[index], point),
  }));
  const totalDistance = segments.reduce((total, segment) => total + segment.distance, 0);
  const record = {
    id: measurementSequence,
    type: 'distance',
    points: sanitizedPoints,
    segments,
    totalDistance,
  };

  measurementSequence += 1;
  measurementRecords = [...measurementRecords, record];
  refreshMeasurements();
}

function createAreaMeasurement(points) {
  const sanitizedPoints = dedupeSequentialPoints(points);
  if (sanitizedPoints.length < 3) return;
  const record = {
    id: measurementSequence,
    type: 'area',
    points: sanitizedPoints,
    area: computePolygonArea(sanitizedPoints),
    centroid: computePolygonCentroid(sanitizedPoints),
  };

  measurementSequence += 1;
  measurementRecords = [...measurementRecords, record];
  refreshMeasurements();
}

function finalizeMeasurement() {
  if (!isMeasurementActive()) return false;

  if (measurementState.type === 'distance' && measurementDraftPoints.length >= 2) {
    createDistanceMeasurement(measurementDraftPoints);
    cancelMeasurement();
    return true;
  }

  if (measurementState.type === 'area' && measurementDraftPoints.length >= 3) {
    createAreaMeasurement(measurementDraftPoints);
    cancelMeasurement();
    return true;
  }

  return false;
}

function setCameraInputsEnabled(enabled) {
  if (!viewer) return;
  viewer.scene.screenSpaceCameraController.enableRotate = enabled;
  viewer.scene.screenSpaceCameraController.enableTranslate = enabled;
  viewer.scene.screenSpaceCameraController.enableTilt = enabled;
  viewer.scene.screenSpaceCameraController.enableLook = enabled;
}

function pickCartesianFromScreen(position) {
  if (!viewer) return null;

  const scene = viewer.scene;
  if (scene.pickPositionSupported) {
    const pickedPosition = scene.pickPosition(position);
    if (Cesium.defined(pickedPosition)) {
      return pickedPosition;
    }
  }

  const ray = viewer.camera.getPickRay(position);
  if (ray) {
    const globePosition = scene.globe.pick(ray, scene);
    if (Cesium.defined(globePosition)) {
      return globePosition;
    }
  }

  const ellipsoidPosition = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  if (Cesium.defined(ellipsoidPosition)) {
    return ellipsoidPosition;
  }

  return null;
}

function toDegrees(position) {
  const cartesian = pickCartesianFromScreen(position);
  if (!cartesian) return null;

  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  return [
    Cesium.Math.toDegrees(cartographic.longitude),
    Cesium.Math.toDegrees(cartographic.latitude),
    Number.isFinite(cartographic.height) ? cartographic.height : 0,
  ];
}

async function sampleTerrainHeight(longitude, latitude, fallbackHeight = 0) {
  if (!viewer?.terrainProvider || viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
    return Math.max(0, Number(fallbackHeight || 0));
  }

  try {
    const positions = [Cesium.Cartographic.fromDegrees(longitude, latitude)];
    const [result] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, positions);
    return Number.isFinite(result?.height) ? Math.max(0, result.height) : Math.max(0, Number(fallbackHeight || 0));
  } catch {
    return Math.max(0, Number(fallbackHeight || 0));
  }
}

async function pickGroundCoordinates(position) {
  const degrees = toDegrees(position);
  if (!degrees) return null;

  const height = await sampleTerrainHeight(degrees[0], degrees[1], degrees[2]);
  return [degrees[0], degrees[1], height];
}

function getPickedEntityRefs(position) {
  if (!viewer) return [];

  const results = viewer.scene.drillPick(position, 12) || [];
  return results
    .map(parsePickedEntityRef)
    .filter((value, index, list) => value?.entityId && list.findIndex((item) => item?.rawId === value.rawId) === index)
    .filter((value) => props.entities.some((item) => item.id === value.entityId));
}

function getPickedEntityIds(position) {
  return getPickedEntityRefs(position)
    .map((item) => item.entityId)
    .filter((value, index, list) => value && list.indexOf(value) === index);
}

function getPreferredEntityId(position) {
  const pickedIds = getPickedEntityIds(position);
  if (!pickedIds.length) return '';
  if (pickedIds.length === 1) return pickedIds[0];
  if (props.activeEntityId && pickedIds.includes(props.activeEntityId)) {
    return props.activeEntityId;
  }
  return pickedIds[0];
}

function overflowScore(value, min, max) {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

function resolveOverlayPosition(position) {
  const rect = globeWrapRef.value?.getBoundingClientRect();
  if (!rect) {
    return { x: position.x || 0, y: position.y || 0 };
  }

  const canvas = viewer?.canvas;
  const scaleX = canvas?.clientWidth && canvas?.width ? canvas.clientWidth / canvas.width : 1;
  const scaleY = canvas?.clientHeight && canvas?.height ? canvas.clientHeight / canvas.height : 1;
  const candidates = [
    { x: position.x, y: position.y },
    { x: position.x - rect.left, y: position.y - rect.top },
    { x: position.x * scaleX, y: position.y * scaleY },
    { x: (position.x - rect.left) * scaleX, y: (position.y - rect.top) * scaleY },
  ];

  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = overflowScore(candidate.x, 0, rect.width) + overflowScore(candidate.y, 0, rect.height);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function openContextMenu(position, options = {}) {
  const rect = globeWrapRef.value?.getBoundingClientRect();
  if (!rect) return;

  const overlayPosition = resolveOverlayPosition(position);
  const menuWidth = options.mode === 'blank' ? 210 : 188;
  const menuHeight = options.mode === 'blank' ? 178 : 148;

  contextMenu.visible = true;
  contextMenu.mode = options.mode || 'entity';
  contextMenu.entityId = options.entityId || '';
  contextMenu.longitude = Number(options.longitude || 0);
  contextMenu.latitude = Number(options.latitude || 0);
  contextMenu.altitude = Number(options.altitude || 0);
  contextMenu.x = Math.min(Math.max(overlayPosition.x + 10, 12), Math.max(12, rect.width - menuWidth));
  contextMenu.y = Math.min(Math.max(overlayPosition.y + 10, 12), Math.max(12, rect.height - menuHeight));
}

function closeContextMenu() {
  contextMenu.visible = false;
  contextMenu.entityId = '';
}

function openSelectionMenu(position, entityIds) {
  const rect = globeWrapRef.value?.getBoundingClientRect();
  if (!rect) return;

  const overlayPosition = resolveOverlayPosition(position);
  const items = entityIds
    .map((id) => props.entities.find((item) => item.id === id))
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      name: item.name,
      camp: item.camp,
      type: item.type,
    }));

  if (items.length < 2) {
    selectionMenu.visible = false;
    selectionMenu.items = [];
    return;
  }

  selectionMenu.visible = true;
  selectionMenu.items = items;
  selectionMenu.x = Math.min(Math.max(overlayPosition.x + 10, 12), Math.max(12, rect.width - 220));
  selectionMenu.y = Math.min(Math.max(overlayPosition.y + 10, 12), Math.max(12, rect.height - 220));
}

function closeSelectionMenu() {
  selectionMenu.visible = false;
  selectionMenu.items = [];
}

function flyToEntityById(entityId) {
  const target = props.entities.find((item) => item.id === entityId);
  if (!target || !viewer) return;

  if (target.geometryType === 'point' || target.geometryType === 'circle') {
    if (props.mapMode === '2D') {
      const radiusMeters = Math.max(18000, Number(target.radius || 18000));
      const longitude = Number(target.coordinates[0] || 120.18);
      const latitude = Number(target.coordinates[1] || 30.28);
      const latitudeDelta = Math.max(0.08, radiusMeters / 111000);
      const longitudeScale = Math.max(0.2, Math.cos(Cesium.Math.toRadians(latitude)));
      const longitudeDelta = Math.max(0.08, radiusMeters / (111000 * longitudeScale));
      viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(
          longitude - longitudeDelta,
          latitude - latitudeDelta,
          longitude + longitudeDelta,
          latitude + latitudeDelta,
        ),
        duration: 1.2,
      });
      return;
    }

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        target.coordinates[0],
        target.coordinates[1],
        Math.max(90000, Number(target.coordinates[2] || 0) + 90000),
      ),
      duration: 1.2,
    });
    return;
  }

  const sourceEntity = situationSource.entities.getById(entityId);
  if (sourceEntity) {
    viewer.flyTo(sourceEntity, { duration: 1.2 });
  }
}

async function handleDrawClick(position) {
  const point = await pickGroundCoordinates(position);
  if (!point) return;

  if (props.drawTool.type === 'unit') {
    emit('draw-complete', { geometryType: 'point', coordinates: point });
    clearDraft();
    return;
  }

  if (props.drawTool.type === 'detection') {
    emit('draw-complete', {
      geometryType: 'circle',
      coordinates: point,
      radius: props.drawTool.radius || 30000,
    });
    clearDraft();
    return;
  }

  draftCursorPoint = null;
  draftPoints.push(point);
  emit('draw-progress', { count: draftPoints.length });

  if (props.drawTool.type === 'zone' && props.drawTool.zoneShape === 'rectangle' && draftPoints.length >= 2) {
    finalizeDraw();
    return;
  }

  refreshDraft();
}

async function handleMeasurementClick(position) {
  const point = await pickGroundCoordinates(position);
  if (!point || !isMeasurementActive()) return;

  measurementCursorPoint = null;
  measurementDraftPoints.push(point);
  refreshMeasurementDraft();
}

function handleDrawMove(position) {
  if (!props.drawTool.active || !['order', 'zone'].includes(props.drawTool.type)) return;
  const point = toDegrees(position);
  draftCursorPoint = point ? [point[0], point[1], Number(point[2] || 0)] : null;
  refreshDraft();
}

function handleMeasurementMove(position) {
  if (!isMeasurementActive()) return;
  const point = toDegrees(position);
  measurementCursorPoint = point ? [point[0], point[1], Number(point[2] || 0)] : null;
  refreshMeasurementDraft();
}

async function handleSelectionClick(position) {
  closeContextMenu();

  const pickedIds = getPickedEntityIds(position);
  if (!pickedIds.length) {
    closeSelectionMenu();
    return;
  }

  if (pickedIds.length === 1) {
    closeSelectionMenu();
    emit('entity-selected', pickedIds[0]);
    return;
  }

  openSelectionMenu(position, pickedIds);
}

function handleDragStart(position) {
  if (props.drawTool.active || !props.canManage) return;

  closeContextMenu();
  closeSelectionMenu();

  const pickedRefs = getPickedEntityRefs(position);
  let targetRef = null;
  if (pickedRefs.length === 1) {
    [targetRef] = pickedRefs;
  } else if (pickedRefs.length > 1) {
    targetRef = props.activeEntityId
      ? pickedRefs.find((item) => isVertexPickRef(item) && item.entityId === props.activeEntityId)
        || pickedRefs.find((item) => item.entityId === props.activeEntityId)
        || pickedRefs.find(isVertexPickRef)
        || pickedRefs[0]
      : pickedRefs.find(isVertexPickRef) || pickedRefs[0];
  }

  if (!targetRef?.entityId) return;

  const entity = props.entities.find((item) => item.id === targetRef.entityId);
  if (!entity) return;

  dragging = true;
  if (targetRef.kind === 'vertex' && entity.geometryType === 'polygon') {
    dragMode = 'polygon-vertex';
  } else if (targetRef.kind === 'line-vertex' && entity.geometryType === 'polyline') {
    dragMode = 'polyline-vertex';
  } else {
    dragMode = 'entity';
  }
  draggedVertexIndex = dragMode === 'polygon-vertex' || dragMode === 'polyline-vertex' ? targetRef.vertexIndex : -1;
  draggedEntityId = targetRef.entityId;
  draggedEntitySnapshot = JSON.parse(JSON.stringify(entity));
  draggedCoordinates = JSON.parse(JSON.stringify(entity.coordinates));
  emit('entity-selected', targetRef.entityId);
  setCameraInputsEnabled(false);
}

function handleDragMove(position) {
  if (!dragging || !draggedEntitySnapshot) return;
  const point = toDegrees(position);
  if (!point) return;

  if (dragMode === 'polygon-vertex' && draggedEntitySnapshot.geometryType === 'polygon') {
    const nextCoordinates = draggedEntitySnapshot.coordinates.map((item, index) => (
      index === draggedVertexIndex
        ? [point[0], point[1], Number(point[2] || item[2] || 0)]
        : [...item]
    ));
    draggedCoordinates = nextCoordinates;
    applyLiveGeometry(draggedEntityId, draggedEntitySnapshot.geometryType, draggedCoordinates, draggedEntitySnapshot.meta, draggedEntitySnapshot.radius);
    return;
  }

  if (dragMode === 'polyline-vertex' && draggedEntitySnapshot.geometryType === 'polyline') {
    const nextCoordinates = draggedEntitySnapshot.coordinates.map((item, index) => (
      index === draggedVertexIndex
        ? [point[0], point[1], Number(point[2] || item[2] || 0)]
        : [...item]
    ));
    draggedCoordinates = nextCoordinates;
    applyLiveGeometry(draggedEntityId, draggedEntitySnapshot.geometryType, draggedCoordinates, draggedEntitySnapshot.meta, draggedEntitySnapshot.radius);
    return;
  }

  const nextAnchor = {
    longitude: point[0],
    latitude: point[1],
    altitude: Number(point[2] || getEntityAnchor(draggedEntitySnapshot).altitude || 0),
  };

  draggedCoordinates = translateGeometryCoordinates(draggedEntitySnapshot, nextAnchor);
  applyLiveGeometry(draggedEntityId, draggedEntitySnapshot.geometryType, draggedCoordinates, draggedEntitySnapshot.meta, draggedEntitySnapshot.radius);
}

function handleDragEnd() {
  if (props.drawTool.active) return;

  if (!dragging) return;
  setCameraInputsEnabled(true);

  if (draggedEntityId && draggedCoordinates) {
    emit('entity-dragged', { id: draggedEntityId, coordinates: draggedCoordinates });
  }

  dragging = false;
  dragMode = '';
  draggedEntityId = '';
  draggedEntitySnapshot = null;
  draggedCoordinates = null;
  draggedVertexIndex = -1;
}

async function handleRightClick(position) {
  closeSelectionMenu();

  if (isMeasurementActive()) {
    if (!finalizeMeasurement()) {
      cancelMeasurement();
    }
    return;
  }

  if (props.drawTool.active) {
    if (props.canManage && (props.drawTool.type === 'order' || props.drawTool.zoneShape === 'rectangle')) {
      finalizeDraw();
    }
    return;
  }

  const entityId = getPreferredEntityId(position);
  if (entityId) {
    emit('entity-selected', entityId);
    if (!props.canManage) {
      closeContextMenu();
      return;
    }

    const anchor = getEntityAnchor(props.entities.find((item) => item.id === entityId));
    openContextMenu(position, {
      mode: 'entity',
      entityId,
      longitude: anchor.longitude,
      latitude: anchor.latitude,
      altitude: anchor.altitude,
    });
    return;
  }

  if (!props.canManage) {
    closeContextMenu();
    return;
  }

  const point = await pickGroundCoordinates(position);
  if (!point) {
    closeContextMenu();
    return;
  }

  openContextMenu(position, {
    mode: 'blank',
    longitude: point[0],
    latitude: point[1],
    altitude: point[2],
  });
}

function bindDrawing() {
  drawHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  drawHandler.setInputAction((movement) => {
    if (isMeasurementActive()) {
      void handleMeasurementClick(movement.position);
      return;
    }

    if (props.drawTool.active) {
      void handleDrawClick(movement.position);
      return;
    }

    void handleSelectionClick(movement.position);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  drawHandler.setInputAction((movement) => {
    if (isMeasurementActive()) return;
    handleDragStart(movement.position);
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

  drawHandler.setInputAction((movement) => {
    if (isMeasurementActive()) {
      handleMeasurementMove(movement.endPosition);
      return;
    }

    if (props.drawTool.active) {
      handleDrawMove(movement.endPosition);
      return;
    }

    handleDragMove(movement.endPosition);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  drawHandler.setInputAction(() => {
    if (isMeasurementActive()) return;
    handleDragEnd();
  }, Cesium.ScreenSpaceEventType.LEFT_UP);

  drawHandler.setInputAction(() => {
    if (isMeasurementActive() && measurementState.type === 'area') {
      if (!finalizeMeasurement()) {
        cancelMeasurement();
      }
      return;
    }

    if (props.drawTool.active && props.canManage && props.drawTool.type === 'zone' && props.drawTool.zoneShape !== 'rectangle') {
      finalizeDraw();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  drawHandler.setInputAction((movement) => {
    void handleRightClick(movement.position);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function morphScene(mode) {
  if (!viewer) return;
  viewer.scene.globe.showGroundAtmosphere = mode !== '2D';
  if (mode === '2D') {
    viewer.scene.morphTo2D(0.8);
    return;
  }
  viewer.scene.morphTo3D(0.8);
}

function selectEntityFromMenu(entityId) {
  emit('entity-selected', entityId);
  closeSelectionMenu();
}

function editFromMenu() {
  if (!contextMenu.entityId) return;
  emit('entity-edit-request', {
    id: contextMenu.entityId,
    x: contextMenu.x,
    y: contextMenu.y,
  });
  closeContextMenu();
}

function deleteFromMenu() {
  if (!contextMenu.entityId) return;
  emit('entity-delete-request', contextMenu.entityId);
  closeContextMenu();
}

function locateFromMenu() {
  if (!contextMenu.entityId) return;
  flyToEntityById(contextMenu.entityId);
  closeContextMenu();
}

function createFromContextMenu(template) {
  emit('entity-drop-create', {
    template,
    longitude: contextMenu.longitude,
    latitude: contextMenu.latitude,
    altitude: contextMenu.altitude,
  });
  closeContextMenu();
}

function handleNativeDragOver(event) {
  if (!props.canManage) return;
  event.dataTransfer.dropEffect = 'copy';
}

async function handleNativeDrop(event) {
  if (!props.canManage) return;

  const payload = event.dataTransfer?.getData('application/mission-entity')
    || event.dataTransfer?.getData('text/plain');
  if (!payload) return;

  try {
    const template = JSON.parse(payload);
    const rect = globeWrapRef.value?.getBoundingClientRect();
    if (!rect) return;

    const localPosition = new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top);
    const point = await pickGroundCoordinates(localPosition);
    if (!point) return;

    emit('entity-drop-create', {
      template,
      longitude: point[0],
      latitude: point[1],
      altitude: point[2],
    });
    closeContextMenu();
    closeSelectionMenu();
  } catch {
    // ignore malformed drop payload
  }
}

function getViewer() {
  return viewer;
}

onMounted(() => {
  viewer = new Cesium.Viewer(globeRef.value, {
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  });

  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#132116');
  viewer.scene.globe.showGroundAtmosphere = true;
  applyTerrainExaggeration();
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  removeMorphCompleteListener = viewer.scene.morphComplete.addEventListener(() => {
    void refreshTerrain();
    refreshEntities();
    viewer.scene.requestRender();
  });

  situationSource = new Cesium.CustomDataSource('situation');
  environmentSource = new Cesium.CustomDataSource('environment');
  imageOverlaySource = new Cesium.CustomDataSource('image-overlays');
  draftSource = new Cesium.CustomDataSource('draft');
  measurementSource = new Cesium.CustomDataSource('measurement');
  measurementDraftSource = new Cesium.CustomDataSource('measurement-draft');
  viewer.dataSources.add(environmentSource);
  viewer.dataSources.add(imageOverlaySource);
  viewer.dataSources.add(situationSource);
  viewer.dataSources.add(measurementSource);
  viewer.dataSources.add(draftSource);
  viewer.dataSources.add(measurementDraftSource);

  void refreshBasemap();
  void refreshTerrain();
  refreshEntities();
  bindDrawing();
  morphScene(props.mapMode);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(120.18, 30.28, 180000),
    duration: 1.2,
  });
});

watch(() => props.basemap, () => {
  void refreshBasemap();
});
watch(tiandituToken, () => {
  tiandituImageryProbe = { token: '', ok: null, checkedAt: 0 };
  void refreshBasemap();
});
watch(() => props.terrainMode, () => {
  void refreshTerrain();
});
watch(() => props.terrainExaggeration, () => {
  applyTerrainExaggeration();
});
watch(() => props.mapMode, (mode) => {
  if (mode === '2D') {
    void refreshTerrain();
  }
  refreshEntities();
  refreshDraft();
  refreshMeasurements();
  refreshMeasurementDraft();
  morphScene(mode);
  viewer?.scene.requestRender();
});
watch(() => props.entities, () => {
  refreshEntities();
  if (contextMenu.visible && contextMenu.entityId && !props.entities.some((item) => item.id === contextMenu.entityId)) {
    closeContextMenu();
  }
  if (selectionMenu.visible) {
    selectionMenu.items = selectionMenu.items.filter((item) => props.entities.some((entity) => entity.id === item.id));
    if (selectionMenu.items.length < 2) {
      closeSelectionMenu();
    }
  }
}, { deep: true });
watch(() => props.environment, refreshEntities, { deep: true });
watch(() => props.imageOverlays, refreshImageOverlays, { deep: true });
watch(() => props.layerVisibility, refreshEntities, { deep: true });
watch(() => props.activeEntityId, () => {
  refreshEntities();
  if (!props.activeEntityId || !viewer) return;
  flyToEntityById(props.activeEntityId);
});
watch(() => props.drawTool.active, (active) => {
  if (!active) clearDraft();
  closeContextMenu();
  closeSelectionMenu();
});
watch(() => [props.drawTool.type, props.drawTool.color, props.drawTool.radius, props.drawTool.zoneShape], () => {
  refreshDraft();
});

onBeforeUnmount(() => {
  clearImageOverlays();
  removeMorphCompleteListener?.();
  drawHandler?.destroy();
  viewer?.destroy();
});

defineExpose({ getViewer, startMeasurement, clearMeasurements, cancelMeasurement });
</script>

<template>
  <div
    ref="globeWrapRef"
    class="globe-wrap"
    @contextmenu.prevent
    @dragover.prevent="handleNativeDragOver"
    @drop.prevent="handleNativeDrop"
  >
    <div ref="globeRef" class="globe-canvas"></div>

    <div class="globe-overlay">
      <span class="pill pill-active">数字地图工作台</span>
      <span class="pill pill-muted">{{ basemapState.message }}</span>
      <span class="pill pill-muted">{{ terrainState.message }}</span>
    </div>

    <div v-if="measurementState.active || measurementState.count" class="globe-measure-card">
      <strong>{{ getMeasurementTitle() }}</strong>
      <p>{{ getMeasurementHint() }}</p>
    </div>

    <div
      v-if="selectionMenu.visible"
      class="globe-pick-menu"
      :style="{ left: `${selectionMenu.x}px`, top: `${selectionMenu.y}px` }"
    >
      <strong class="globe-context-menu__title">重叠目标选择</strong>
      <button
        v-for="item in selectionMenu.items"
        :key="item.id"
        class="globe-pick-menu__item"
        @click="selectEntityFromMenu(item.id)"
      >
        <span>{{ item.name }}</span>
        <small>{{ item.camp }} / {{ item.type }}</small>
      </button>
    </div>

    <div
      v-if="contextMenu.visible"
      class="globe-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    >
      <strong class="globe-context-menu__title">
        {{ contextMenu.mode === 'entity' ? '地图元素操作' : '地图空白区域' }}
      </strong>

      <template v-if="contextMenu.mode === 'entity'">
        <button class="globe-context-menu__item" @click="editFromMenu">编辑元素</button>
        <button class="globe-context-menu__item" @click="locateFromMenu">定位元素</button>
        <button class="globe-context-menu__item danger" @click="deleteFromMenu">删除元素</button>
      </template>

      <template v-else>
        <button
          class="globe-context-menu__item"
          @click="createFromContextMenu({ type: 'unit', camp: 'blue', color: '#38bdf8', name: '蓝方单位' })"
        >
          添加蓝方单位
        </button>
        <button
          class="globe-context-menu__item"
          @click="createFromContextMenu({ type: 'unit', camp: 'red', color: '#f97316', name: '红方单位' })"
        >
          添加红方单位
        </button>
        <button
          v-for="sensor in detectionSensorTypes"
          :key="sensor.key"
          class="globe-context-menu__item"
          @click="createFromContextMenu({ type: 'detection', camp: 'blue', color: sensor.color, name: sensor.label, radius: 30000, meta: { sensorType: sensor.key, detectionHeadingStart: 0, detectionHeadingEnd: 360, detectionPitchStart: 0, detectionPitchEnd: 180 } })"
        >
          添加{{ sensor.shortLabel }}探测圈
        </button>
      </template>
    </div>
  </div>
</template>
