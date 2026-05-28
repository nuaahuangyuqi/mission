<script setup>
import * as echarts from 'echarts';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import CesiumGlobe from './CesiumGlobe.vue';
import MapServiceConfigPanel from './MapServiceConfigPanel.vue';
import { loadMapServiceConfig, resetMapServiceConfig, saveMapServiceConfig } from '../modules/mapServiceConfig';

const props = defineProps({
  sources: { type: Array, default: () => [] },
  sourcePreview: { type: Object, default: null },
  previewLoading: { type: Boolean, default: false },
  intelligence: { type: Array, default: () => [] },
  environment: { type: Array, default: () => [] },
  graph: { type: Object, default: () => ({ nodes: [], edges: [] }) },
  graphMode: { type: String, default: 'balanced' },
  extractions: { type: Array, default: () => [] },
  importBatches: { type: Array, default: () => [] },
  planningTasks: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  canManage: { type: Boolean, default: false },
});

const emit = defineEmits([
  'select-source',
  'import-source',
  'import-source-batch',
  'retry-import-item',
  'delete-source',
  'create-intelligence',
  'update-intelligence',
  'delete-intelligence',
  'create-environment',
  'update-environment',
  'delete-environment',
  'search-graph',
]);

const basemap = ref('auto');
const mapMode = ref('3D');
const terrainMode = ref('offline');
const terrainExaggeration = ref(1);
const mapServiceConfig = ref(loadMapServiceConfig());
const rightTab = ref('preview');
const importType = ref('database');
const graphKeyword = ref('');
const graphModeDraft = ref('balanced');
const recordType = ref('intelligence');
const selectedRecordId = ref('');
const selectedGraphNode = ref(null);
const selectedWorkbookSheet = ref(0);
const fileInputRef = ref(null);
const selectedImportTaskId = ref('');
const importBatchDrafts = ref([]);
const chartRef = ref(null);
let chart;

const importForm = reactive({
  name: '',
  format: 'JSON / CSV',
  description: '',
  endpointUrl: '',
  textContent: '',
  fileName: '',
  fileExtension: '',
  fileContentBase64: '',
  imageDataUrl: '',
});

const editor = reactive({
  id: '',
  camp: 'blue',
  category: '侦察',
  name: '',
  role: '',
  readiness: '待机',
  strength: 1,
  latitude: 18.5,
  longitude: 148.5,
  sourceId: '',
  notes: '',
  tagsText: '',
  kind: 'terrain',
  geometryType: 'circle',
  radius: 9000,
  polygonText: '',
  weather: '通用环境',
  riskLevel: 'Medium',
});

const previewLayerVisibility = reactive({
  environment: true,
  blueUnits: true,
  redUnits: true,
  detection: false,
  orders: false,
  symbols: false,
});

const inactiveDrawTool = reactive({ active: false, type: 'unit', color: '#7dd3fc', radius: 30000, zoneShape: 'polygon' });

const sourceTypeOptions = [
  { key: 'database', label: '数据库' },
  { key: 'api', label: 'API 接口' },
  { key: 'imagery', label: '遥感影像' },
  { key: 'word', label: 'Word 文档' },
  { key: 'excel', label: 'Excel 表格' },
  { key: 'text', label: '文本文件' },
];

const environmentKindOptions = [
  { key: 'terrain', label: '地形环境' },
  { key: 'weather', label: '气象环境' },
  { key: 'electromagnetic', label: '电磁环境' },
  { key: 'sea', label: '海况环境' },
];

const riskLevelOptions = ['Low', 'Medium', 'High'];
const graphModeOptions = [
  { key: 'balanced', label: '平衡模式', description: '保留来源、环境和核心对位关系，适合常规浏览。' },
  { key: 'compact', label: '紧凑模式', description: '优先保留强关联，减少无效交叉连线。' },
  { key: 'mining', label: '文本挖掘优先', description: '强化文本共现和语义关联，适合线索分析。' },
];

const previewEntities = computed(() => props.intelligence.map((item) => ({
  id: `intel-${item.id}`,
  name: item.name,
  type: 'unit',
  camp: item.camp,
  layerKey: 'units',
  color: item.camp === 'blue' ? '#38bdf8' : '#f97316',
  geometryType: 'point',
  coordinates: [item.longitude, item.latitude, 0],
  radius: null,
  annotation: `${item.category} · ${item.role}`,
  visible: true,
  meta: {
    unitSubtype: item.camp === 'blue' ? 'uav' : 'tank',
  },
})));

const fileInputLabel = computed(() => {
  if (importType.value === 'imagery') return '选择影像文件';
  if (importType.value === 'api') return '选择接口样例文件';
  if (importType.value === 'word') return '选择 Word 文件';
  if (importType.value === 'excel') return '选择 Excel 文件';
  return '选择本地文件';
});

const fileInputAccept = computed(() => {
  if (importType.value === 'imagery') return '.png,.jpg,.jpeg,.webp,.tif,.tiff';
  if (importType.value === 'word') return '.doc,.docx';
  if (importType.value === 'excel') return '.xls,.xlsx,.csv';
  if (importType.value === 'api') return '.json,.txt';
  if (importType.value === 'database') return '.json,.csv,.txt';
  return '.txt,.md,.markdown';
});

const showTextEditor = computed(() => !['imagery', 'word', 'excel'].includes(importType.value));
const selectedSourceId = computed(() => props.sourcePreview?.source?.id || props.sources[0]?.id || null);
const sourceNameMap = computed(() => new Map(props.sources.map((item) => [Number(item.id), item.name])));
const selectedSourceExtractions = computed(() => props.extractions.filter((item) => Number(item.sourceId) === Number(selectedSourceId.value)));
const workbookSheets = computed(() => props.sourcePreview?.preview?.payload?.sheets || []);
const activeWorkbookSheet = computed(() => workbookSheets.value[selectedWorkbookSheet.value] || workbookSheets.value[0] || null);
const planningTaskNameMap = computed(() => new Map((props.planningTasks || []).map((item) => [Number(item.id), item.name])));
const hasImportBatchDraft = computed(() => importBatchDrafts.value.length > 0);
const graphNodeMap = computed(() => new Map((props.graph?.nodes || []).map((node) => [node.id, node])));
const graphRelatedExtractions = computed(() => {
  const node = selectedGraphNode.value;
  if (!node) return [];

  const sourceMatch = String(node.id || '').match(/^src-(\d+)$/);
  if (sourceMatch) {
    const sourceId = Number(sourceMatch[1]);
    return props.extractions.filter((item) => Number(item.sourceId) === sourceId);
  }

  const normalizeMatchText = (value) => String(value || '').toLowerCase().replace(/[\s_\-./，。；、:：()[\]{}"'`]+/g, '');
  const nodeName = normalizeMatchText(node.name);
  if (!nodeName) return [];

  return props.extractions
    .map((item) => {
      const entityMatches = (item.entities || []).filter((entity) => normalizeMatchText(entity) === nodeName).length;
      const textBlob = normalizeMatchText([item.title, item.summary, item.text].filter(Boolean).join(' '));
      const textMatched = textBlob.includes(nodeName);
      const score = entityMatches * 10 + (textMatched ? 4 : 0);

      return {
        ...item,
        relevanceScore: score,
      };
    })
    .filter((item) => item.relevanceScore > 0)
    .sort((left, right) => {
      if (right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }
      return Number(right.id || 0) - Number(left.id || 0);
    });
});

const recordList = computed(() => {
  const intel = props.intelligence.map((item) => ({
    id: String(item.id),
    recordType: 'intelligence',
    title: item.name,
    subtitle: `${item.category} · ${item.readiness}`,
    badge: item.camp === 'blue' ? '蓝方' : '红方',
    badgeClass: item.camp === 'blue' ? 'tag-blue' : 'tag-red',
    raw: item,
    updatedAt: item.updatedAt || '',
  }));

  const env = props.environment.map((item) => ({
    id: String(item.id),
    recordType: 'environment',
    title: item.name,
    subtitle: `${item.kind} · ${item.geometryType}`,
    badge: '环境',
    badgeClass: 'tag-neutral',
    raw: item,
    updatedAt: item.updatedAt || '',
  }));

  return [...intel, ...env].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
});

const visibleRecordList = computed(() => recordList.value.filter((item) => item.recordType === recordType.value));
const selectedSourceRecord = computed(() => (
  props.sourcePreview?.source
  || props.sources.find((item) => Number(item.id) === Number(selectedSourceId.value))
  || null
));
const selectedSourcePreviewType = computed(() => props.sourcePreview?.preview?.previewType || '');
const selectedSourcePreviewTypeLabel = computed(() => {
  if (selectedSourcePreviewType.value === 'table') return '表格预览';
  if (selectedSourcePreviewType.value === 'json') return '结构化 JSON';
  if (selectedSourcePreviewType.value === 'image') return '影像预览';
  if (selectedSourcePreviewType.value === 'document') return '文档段落';
  if (selectedSourcePreviewType.value === 'workbook') return '工作簿';
  return '待分析';
});
const selectedSourceSummary = computed(() => {
  if (!selectedSourceRecord.value) {
    return '当前未锁定数据源，可从左侧源清单选择后进入预览、编辑与图谱分析。';
  }

  const extractionCount = selectedSourceExtractions.value.length;
  const previewType = selectedSourcePreviewTypeLabel.value;
  return `${selectedSourceRecord.value.format || '--'} / ${previewType} / ${extractionCount} 条抽取证据`;
});

function togglePreviewLayer(key) {
  previewLayerVisibility[key] = !previewLayerVisibility[key];
}

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
    basemap.value = 'auto';
  }
  if (mapServiceConfig.value.ionToken || mapServiceConfig.value.terrainUrl) {
    terrainMode.value = 'offline';
  }
}

function resetOnlineMapConfig() {
  mapServiceConfig.value = resetMapServiceConfig();
}

function parsePolygonText(textValue) {
  return String(textValue || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[,，\s]+/).map(Number))
    .filter((parts) => Number.isFinite(parts[0]) && Number.isFinite(parts[1]))
    .map(([longitude, latitude, altitude]) => [longitude, latitude, Number.isFinite(altitude) ? altitude : 0]);
}

function stringifyPolygon(points) {
  return (points || [])
    .map((point) => `${Number(point[0]).toFixed(4)}, ${Number(point[1]).toFixed(4)}, ${Number(point[2] || 0).toFixed(0)}`)
    .join('\n');
}

watch(importType, (value) => {
  if (value === 'database') importForm.format = 'JSON / CSV';
  if (value === 'api') importForm.format = 'REST / JSON';
  if (value === 'imagery') importForm.format = 'GeoTIFF / PNG';
  if (value === 'word') importForm.format = 'DOC / DOCX';
  if (value === 'excel') importForm.format = 'XLS / XLSX / CSV';
  if (value === 'text') importForm.format = 'TXT / Markdown';
  importForm.textContent = '';
  importForm.fileName = '';
  importForm.fileExtension = '';
  importForm.fileContentBase64 = '';
  importForm.imageDataUrl = '';
});

watch(() => props.sources, (list) => {
  if (!editor.sourceId && list.length) {
    editor.sourceId = String(list[0].id);
  }
}, { immediate: true, deep: true });

watch(recordType, () => {
  resetEditor(recordType.value);
});

watch([() => props.intelligence, () => props.environment], () => {
  if (!recordList.value.length) {
    resetEditor(recordType.value);
    return;
  }

  const matched = recordList.value.find((item) => item.recordType === recordType.value && item.id === selectedRecordId.value);
  if (matched) {
    hydrateRecord(matched.raw, matched.recordType);
    return;
  }

  if (!selectedRecordId.value) {
    return;
  }

  const firstOfCurrentType = recordList.value.find((item) => item.recordType === recordType.value);
  if (firstOfCurrentType) {
    hydrateRecord(firstOfCurrentType.raw, firstOfCurrentType.recordType);
  } else {
    resetEditor(recordType.value);
  }
}, { immediate: true, deep: true });

watch(() => props.graph, () => {
  if (selectedGraphNode.value && !graphNodeMap.value.has(selectedGraphNode.value.id)) {
    selectedGraphNode.value = null;
  }
  if (rightTab.value === 'graph') {
    renderChart();
  }
}, { deep: true });

watch(() => props.sourcePreview?.preview?.payload?.sheets, () => {
  selectedWorkbookSheet.value = 0;
});

function hydrateIntelligence(record) {
  recordType.value = 'intelligence';
  selectedRecordId.value = String(record.id);
  editor.id = String(record.id);
  editor.camp = record.camp;
  editor.category = record.category;
  editor.name = record.name;
  editor.role = record.role;
  editor.readiness = record.readiness;
  editor.strength = record.strength;
  editor.latitude = record.latitude;
  editor.longitude = record.longitude;
  editor.sourceId = String(record.sourceId);
  editor.notes = record.notes || '';
  editor.tagsText = (record.tags || []).join(', ');
}

function hydrateEnvironment(record) {
  recordType.value = 'environment';
  selectedRecordId.value = String(record.id);
  editor.id = String(record.id);
  editor.kind = record.kind;
  editor.name = record.name;
  editor.geometryType = record.geometryType;
  editor.weather = record.weather || '通用环境';
  editor.riskLevel = record.riskLevel || 'Medium';
  editor.sourceId = String(record.sourceId || props.sources[0]?.id || '');
  editor.notes = record.notes || '';

  if (record.geometryType === 'circle') {
    editor.longitude = Number(record.geometry?.center?.[0] || 148.5);
    editor.latitude = Number(record.geometry?.center?.[1] || 18.5);
    editor.radius = Number(record.geometry?.radius || 9000);
    editor.polygonText = '';
  } else {
    const points = Array.isArray(record.geometry) ? record.geometry : [];
    const first = points[0] || [148.5, 18.5, 0];
    editor.longitude = Number(first[0] || 148.5);
    editor.latitude = Number(first[1] || 18.5);
    editor.radius = 9000;
    editor.polygonText = stringifyPolygon(points);
  }
}

function hydrateRecord(record, type) {
  if (type === 'environment') {
    hydrateEnvironment(record);
    return;
  }
  hydrateIntelligence(record);
}

function resetEditor(type = recordType.value) {
  recordType.value = type;
  selectedRecordId.value = '';
  editor.id = '';
  editor.sourceId = props.sources[0] ? String(props.sources[0].id) : '';
  editor.notes = '';

  if (type === 'environment') {
    editor.kind = 'terrain';
    editor.name = '';
    editor.geometryType = 'circle';
    editor.longitude = 148.5;
    editor.latitude = 18.5;
    editor.radius = 9000;
    editor.polygonText = '148.40, 18.40, 0\n148.58, 18.42, 0\n148.56, 18.58, 0\n148.42, 18.56, 0';
    editor.weather = '通用环境';
    editor.riskLevel = 'Medium';
    return;
  }

  editor.camp = 'blue';
  editor.category = '侦察';
  editor.name = '';
  editor.role = '';
  editor.readiness = '待机';
  editor.strength = 1;
  editor.latitude = 18.5;
  editor.longitude = 148.5;
  editor.tagsText = '';
}

function chooseSource(sourceId) {
  emit('select-source', sourceId);
  rightTab.value = 'preview';
}

function resetImportForm() {
  importForm.name = '';
  importForm.description = '';
  importForm.endpointUrl = '';
  importForm.textContent = '';
  importForm.fileName = '';
  importForm.fileExtension = '';
  importForm.fileContentBase64 = '';
  importForm.imageDataUrl = '';
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
}

function resolveImportTaskId(rawValue = selectedImportTaskId.value) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function buildImportPayloadFromForm() {
  return {
    type: importType.value,
    name: importForm.name || `${sourceTypeOptions.find((item) => item.key === importType.value)?.label || '数据源'}-${Date.now()}`,
    format: importForm.format,
    description: importForm.description,
    endpointUrl: importForm.endpointUrl,
    textContent: importForm.textContent,
    fileContentBase64: importForm.fileContentBase64,
    fileExtension: importForm.fileExtension,
    imageDataUrl: importForm.imageDataUrl,
    fileName: importForm.fileName,
    taskId: resolveImportTaskId(),
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
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
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function handleFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  importForm.fileName = file.name;
  importForm.fileExtension = file.name.includes('.') ? `.${file.name.split('.').pop().toLowerCase()}` : '';

  if (importType.value === 'imagery') {
    importForm.imageDataUrl = await readFileAsDataUrl(file);
    importForm.fileContentBase64 = '';
    importForm.textContent = '';
    return;
  }

  if (['word', 'excel'].includes(importType.value)) {
    const buffer = await readFileAsArrayBuffer(file);
    importForm.fileContentBase64 = arrayBufferToBase64(buffer);
    importForm.imageDataUrl = '';
    importForm.textContent = '';
    return;
  }

  importForm.textContent = await readFileAsText(file);
  importForm.fileContentBase64 = '';
  importForm.imageDataUrl = '';
}

function submitImport() {
  if (!props.canManage) return;
  emit('import-source', buildImportPayloadFromForm());

  resetImportForm();
}

function addToBatchDraft() {
  if (!props.canManage) return;
  const payload = buildImportPayloadFromForm();
  importBatchDrafts.value = [
    ...importBatchDrafts.value,
    {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceName: payload.name,
      sourceType: payload.type,
      fileName: payload.fileName || '',
      taskId: payload.taskId,
      payload,
    },
  ];
  resetImportForm();
}

function removeBatchDraft(localId) {
  importBatchDrafts.value = importBatchDrafts.value.filter((item) => item.localId !== localId);
}

function clearBatchDraft() {
  importBatchDrafts.value = [];
}

function submitBatchImport() {
  if (!props.canManage || !importBatchDrafts.value.length) return;
  emit('import-source-batch', {
    taskId: resolveImportTaskId(),
    items: importBatchDrafts.value.map((item) => item.payload),
  });
  clearBatchDraft();
}

function resolveTaskName(taskId) {
  const normalized = Number(taskId);
  if (!Number.isInteger(normalized) || normalized <= 0) return '未关联任务';
  return planningTaskNameMap.value.get(normalized) || `任务 #${normalized}`;
}

function formatBatchItemStatus(status = '') {
  if (status === 'pending') return '待处理';
  if (status === 'running') return '处理中';
  if (status === 'succeeded') return '成功';
  if (status === 'failed') return '失败';
  return status || '--';
}

function formatBatchStatus(status = '') {
  if (status === 'running') return '执行中';
  if (status === 'succeeded') return '已完成';
  if (status === 'finished_with_errors') return '部分失败';
  return status || '--';
}

function requestRetryImportItem(batchId, itemId) {
  if (!props.canManage) return;
  emit('retry-import-item', { batchId, itemId });
}

function requestDeleteSource(sourceId = selectedSourceId.value) {
  if (!props.canManage || !sourceId) return;
  emit('delete-source', sourceId);
}

function startNewRecord(type = 'intelligence') {
  rightTab.value = 'editor';
  resetEditor(type);
}

function loadRecord(item) {
  rightTab.value = 'editor';
  hydrateRecord(item.raw, item.recordType);
}

function saveRecord() {
  if (!props.canManage) return;

  if (recordType.value === 'environment') {
    const geometry = editor.geometryType === 'circle'
      ? {
          center: [Number(editor.longitude), Number(editor.latitude), 0],
          radius: Number(editor.radius || 9000),
        }
      : parsePolygonText(editor.polygonText);

    const payload = {
      kind: editor.kind,
      name: editor.name,
      geometryType: editor.geometryType,
      geometry,
      weather: editor.weather,
      riskLevel: editor.riskLevel,
      sourceId: Number(editor.sourceId),
      notes: editor.notes,
    };

    if (selectedRecordId.value) {
      emit('update-environment', { id: selectedRecordId.value, payload });
    } else {
      emit('create-environment', payload);
    }
    return;
  }

  const payload = {
    camp: editor.camp,
    category: editor.category,
    name: editor.name,
    role: editor.role,
    readiness: editor.readiness,
    strength: Number(editor.strength),
    latitude: Number(editor.latitude),
    longitude: Number(editor.longitude),
    sourceId: Number(editor.sourceId),
    notes: editor.notes,
    tags: editor.tagsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
  };

  if (selectedRecordId.value) {
    emit('update-intelligence', { id: selectedRecordId.value, payload });
  } else {
    emit('create-intelligence', payload);
  }
}

function deleteRecord() {
  if (!props.canManage || !selectedRecordId.value) return;

  if (recordType.value === 'environment') {
    emit('delete-environment', selectedRecordId.value);
  } else {
    emit('delete-intelligence', selectedRecordId.value);
  }

  resetEditor(recordType.value);
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function resolveSourceName(sourceId) {
  return sourceNameMap.value.get(Number(sourceId)) || '未关联数据源';
}

function resolvePreviewCell(row, column, columnIndex) {
  if (Array.isArray(row)) {
    return row[columnIndex] ?? '';
  }

  if (row && typeof row === 'object') {
    return row[column] ?? '';
  }

  return row ?? '';
}

function searchGraph() {
  emit('search-graph', {
    query: graphKeyword.value.trim(),
    mode: graphModeDraft.value,
  });
}

function ensureChart() {
  if (!chartRef.value) return null;
  if (!chart) {
    chart = echarts.init(chartRef.value);
    chart.on('click', (params) => {
      if (params.dataType === 'node') {
        selectedGraphNode.value = params.data;
      }
    });
  }
  return chart;
}

function renderChart() {
  const instance = ensureChart();
  if (!instance) return;

  const layoutPreset = graphModeDraft.value === 'compact'
    ? { repulsion: 340, edgeLength: [110, 190], lineOpacity: 0.42 }
    : graphModeDraft.value === 'mining'
      ? { repulsion: 280, edgeLength: [90, 160], lineOpacity: 0.56 }
      : { repulsion: 300, edgeLength: [95, 170], lineOpacity: 0.48 };

  instance.resize();
  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      formatter(params) {
        if (params.dataType === 'edge') {
          return `${params.data.relation}<br/>置信度：${Math.round(params.data.confidence * 100)}%`;
        }
        return `${params.data.name}<br/>${params.data.summary}`;
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        force: { repulsion: layoutPreset.repulsion, edgeLength: layoutPreset.edgeLength },
        symbolSize: (value, params) => 18 + (params.data.score || 60) / 10,
        label: {
          show: true,
          color: '#eef6ef',
          fontSize: 11,
          formatter(params) {
            const isKeyNode = params.data.type === '数据源'
              || String(params.data.type || '').startsWith('环境-')
              || Number(params.data.score || 0) >= 82;
            return isKeyNode ? params.data.name : '';
          },
        },
        lineStyle: { color: 'source', opacity: layoutPreset.lineOpacity, width: 1.6, curveness: 0.1 },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { opacity: 0.9, width: 2.2 },
          label: { show: true },
        },
        categories: [
          { name: '蓝方', itemStyle: { color: '#38bdf8' } },
          { name: '红方', itemStyle: { color: '#f97316' } },
          { name: '中立', itemStyle: { color: '#a3e635' } },
        ],
        data: (props.graph?.nodes || []).map((node) => ({
          ...node,
          category: node.camp === 'blue' ? 0 : node.camp === 'red' ? 1 : 2,
          value: node.score,
        })),
        links: props.graph?.edges || [],
      },
    ],
  });
}

function handleResize() {
  chart?.resize();
}

onMounted(() => {
  window.addEventListener('resize', handleResize);
  if (rightTab.value === 'graph') {
    renderChart();
  }
});

watch(rightTab, async (value) => {
  if (value !== 'graph') return;
  await nextTick();
  renderChart();
});

watch(() => props.graphMode, (mode) => {
  graphModeDraft.value = mode || 'balanced';
}, { immediate: true });

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  chart?.dispose();
});
</script>

<template>
  <div class="resource-workspace">
    <section class="glass-card resource-intake-deck">
      <div class="section-heading">
        <div>
          <h3>多源数据接入</h3>
          <p>这里保留真实有效的接入动作：选择来源类型、关联任务、载入内容并执行单条或批量导入。</p>
        </div>
      </div>

      <div class="segmented-row wrap top-gap">
        <button
          v-for="item in sourceTypeOptions"
          :key="item.key"
          class="segmented"
          :class="{ active: importType === item.key }"
          @click="importType = item.key"
        >
          {{ item.label }}
        </button>
      </div>

      <p v-if="!canManage" class="muted-text top-gap">只读模式：可查看数据源、环境和图谱；数据导入与删除仅管理员可用。</p>

      <fieldset class="permission-fieldset top-gap" :disabled="!canManage">
        <div class="resource-intake-deck__form">
          <label>
            数据源名称
            <input v-model="importForm.name" type="text" placeholder="例如：虚构环境数据快照" />
          </label>
          <label>
            格式
            <input v-model="importForm.format" type="text" />
          </label>
          <label v-if="importType === 'api'">
            接口地址
            <input v-model="importForm.endpointUrl" type="text" placeholder="https://api.example.local/feed" />
          </label>
          <label>
            描述
            <textarea v-model="importForm.description" rows="2" placeholder="说明该数据源用于何种演示场景" />
          </label>
          <label>
            关联任务实例（可选）
            <select v-model="selectedImportTaskId">
              <option value="">不关联任务</option>
              <option v-for="task in planningTasks" :key="task.id" :value="String(task.id)">
                {{ task.name }}（#{{ task.id }}）
              </option>
            </select>
          </label>
          <label v-if="showTextEditor" class="resource-intake-deck__wide">
            文本 / JSON / CSV 内容
            <textarea v-model="importForm.textContent" rows="6" placeholder="可直接粘贴 JSON、CSV 或文本内容，或通过下方文件选择载入" />
          </label>
          <div v-else-if="importType === 'word'" class="detail-card compact-empty-state resource-intake-deck__wide">
            选择 `.doc` / `.docx` 文件后，系统会在服务端提取正文段落并生成关键内容摘要。
          </div>
          <div v-else-if="importType === 'excel'" class="detail-card compact-empty-state resource-intake-deck__wide">
            选择 `.xls` / `.xlsx` / `.csv` 文件后，系统会解析工作表并抽取表格中的关键字段和值。
          </div>
          <label>
            {{ fileInputLabel }}
            <input ref="fileInputRef" :accept="fileInputAccept" type="file" @change="handleFileChange" />
          </label>
          <p class="muted-text">
            {{ importForm.fileName ? `已选择：${importForm.fileName}` : '未选择文件' }}
          </p>
        </div>

        <div class="toolbar-row top-gap wrap">
          <button class="button" @click="submitImport" :disabled="!canManage">单条导入</button>
          <button class="button button-ghost" @click="addToBatchDraft" :disabled="!canManage">加入批量队列</button>
          <button class="button button-secondary" @click="submitBatchImport" :disabled="!canManage || !hasImportBatchDraft">执行批量导入</button>
          <button class="button button-ghost" @click="clearBatchDraft" :disabled="!canManage || !hasImportBatchDraft">清空队列</button>
          <span class="muted-text" v-if="busy">处理中...</span>
        </div>
      </fieldset>

      <article class="detail-card top-gap" v-if="importBatchDrafts.length">
        <div class="section-heading compact">
          <div>
            <h4>待执行批量队列</h4>
            <p>当前队列 {{ importBatchDrafts.length }} 项，点击“执行批量导入”后将逐条返回成功/失败状态。</p>
          </div>
        </div>
        <div class="table-shell compact-table top-gap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>名称</th>
                <th>类型</th>
                <th>文件</th>
                <th>关联任务</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in importBatchDrafts" :key="item.localId">
                <td>{{ index + 1 }}</td>
                <td>{{ item.sourceName }}</td>
                <td>{{ item.sourceType }}</td>
                <td>{{ item.fileName || '--' }}</td>
                <td>{{ resolveTaskName(item.taskId) }}</td>
                <td>
                  <button class="button button-danger button-inline-danger" @click="removeBatchDraft(item.localId)">移除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
      <article class="detail-card top-gap resource-intake-deck__archive">
        <div class="section-heading compact">
          <div>
            <h4>数据源与批量归档</h4>
            <p>接入、已载入数据源和批量执行记录现在统一放在同一工作区里，避免重复切换视线。</p>
          </div>
        </div>

        <div class="section-heading compact top-gap">
          <div>
            <h4>已载入数据源</h4>
            <p>可直接选中查看，也可删除不再需要的数据记录。</p>
          </div>
        </div>

        <div class="toolbar-row wrap">
          <button class="button button-danger" @click="requestDeleteSource()" :disabled="!canManage || !selectedSourceId">删除当前数据源</button>
        </div>

        <div class="resource-source-list top-gap">
          <div
            v-for="source in sources"
            :key="source.id"
            class="entity-item entity-item--split"
            :class="{ active: source.id === selectedSourceId }"
          >
            <button class="entity-item__main" type="button" @click="chooseSource(source.id)">
              <div>
                <strong>{{ source.name }}</strong>
                <small>{{ source.format }} · {{ source.updatedAt }} · {{ resolveTaskName(source.taskId) }}</small>
              </div>
              <span class="tag" :class="source.accessMode === 'imported' ? 'tag-green' : 'tag-neutral'">
                {{ source.accessMode === 'imported' ? '导入' : '示例' }}
              </span>
            </button>
            <button class="button button-danger button-inline-danger" type="button" @click.stop="requestDeleteSource(source.id)" :disabled="!canManage">
              删除
            </button>
          </div>
        </div>

        <template v-if="importBatches.length">
          <div class="section-heading compact top-gap">
            <div>
              <h4>批量导入执行记录</h4>
              <p>记录每个批次的处理状态、失败原因和重试入口。</p>
            </div>
          </div>

          <div class="table-shell compact-table top-gap">
            <table>
              <thead>
                <tr>
                  <th>批次</th>
                  <th>状态</th>
                  <th>关联任务</th>
                  <th>成功/失败/总数</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="batch in importBatches" :key="batch.id">
                  <td>#{{ batch.id }}</td>
                  <td>{{ formatBatchStatus(batch.status) }}</td>
                  <td>{{ resolveTaskName(batch.taskId) }}</td>
                  <td>{{ batch.succeededCount }}/{{ batch.failedCount }}/{{ batch.totalCount }}</td>
                  <td>{{ batch.updatedAt || '--' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-for="batch in importBatches" :key="`items-${batch.id}`" class="table-shell compact-table top-gap">
            <table>
              <thead>
                <tr>
                  <th colspan="7">批次 #{{ batch.id }} 明细</th>
                </tr>
                <tr>
                  <th>序号</th>
                  <th>数据源</th>
                  <th>类型</th>
                  <th>文件</th>
                  <th>状态</th>
                  <th>失败原因</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in (batch.items || [])" :key="item.id">
                  <td>{{ item.itemIndex }}</td>
                  <td>{{ item.sourceName }}</td>
                  <td>{{ item.sourceType }}</td>
                  <td>{{ item.fileName || '--' }}</td>
                  <td>{{ formatBatchItemStatus(item.status) }}</td>
                  <td>{{ item.failureReason || '--' }}</td>
                  <td>
                    <button
                      class="button button-ghost"
                      :disabled="!canManage || item.status !== 'failed' || busy"
                      @click="requestRetryImportItem(batch.id, item.id)"
                    >
                      重试
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </article>
    </section>

    <div class="resource-operating-grid">

      <section class="glass-card resource-map-shell">
      <div class="section-heading compact">
        <div>
          <span class="eyebrow">Spatial Stage</span>
          <h3>环境与情报主舞台</h3>
          <p>先确认空间分布、环境约束与红蓝态势是否与当前数据源口径一致，再进入证据与图谱分析。</p>
        </div>
        <div class="toolbar-stack">
          <div class="segmented-row wrap">
            <button class="segmented" :class="{ active: mapMode === '3D' }" @click="mapMode = '3D'">三维地球</button>
            <button class="segmented" :class="{ active: mapMode === '2D' }" @click="mapMode = '2D'">二维地图</button>
          </div>
          <div class="segmented-row wrap">
            <button class="segmented" :class="{ active: basemap === 'auto' }" @click="basemap = 'auto'">自动</button>
            <button class="segmented" :class="{ active: basemap === 'offline' }" @click="basemap = 'offline'">离线</button>
            <button class="segmented" :class="{ active: basemap === 'online' }" @click="basemap = 'online'">在线 API</button>
          </div>
          <div class="segmented-row segmented-row--compact">
            <button class="segmented" :class="{ active: terrainMode === 'flat' }" @click="terrainMode = 'flat'">平面</button>
            <button class="segmented" :class="{ active: terrainMode === 'offline' }" @click="terrainMode = 'offline'">离线 DEM</button>
            <button class="segmented" :class="{ active: terrainMode === 'online' }" @click="terrainMode = 'online'">在线 DEM</button>
          </div>
          <div class="terrain-exaggeration-control">
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
      </div>

      <div class="resource-stage-toolbar top-gap">
        <div class="resource-stage-toolbar__focus">
          <span class="eyebrow">舞台焦点</span>
          <strong>{{ selectedSourceRecord?.name || '当前未锁定源' }}</strong>
          <small>{{ selectedSourceSummary }}</small>
        </div>

        <div class="resource-layer-toggles">
          <button class="segmented" :class="{ active: previewLayerVisibility.environment }" @click="togglePreviewLayer('environment')">环境层</button>
          <button class="segmented" :class="{ active: previewLayerVisibility.blueUnits }" @click="togglePreviewLayer('blueUnits')">蓝方</button>
          <button class="segmented" :class="{ active: previewLayerVisibility.redUnits }" @click="togglePreviewLayer('redUnits')">红方</button>
          <button class="segmented" :class="{ active: previewLayerVisibility.detection }" @click="togglePreviewLayer('detection')">探测圈</button>
          <button class="segmented" :class="{ active: previewLayerVisibility.orders }" @click="togglePreviewLayer('orders')">命令线</button>
        </div>
      </div>

      <CesiumGlobe
        :entities="previewEntities"
        :environment="environment"
        :basemap="basemap"
        :map-mode="mapMode"
        :terrain-mode="terrainMode"
        :terrain-exaggeration="terrainExaggeration"
        :map-service-config="mapServiceConfig"
        :layer-visibility="previewLayerVisibility"
        :draw-tool="inactiveDrawTool"
        active-entity-id=""
      />

      <div class="stats-strip compact-grid four-up top-gap">
        <div class="mini-stat"><span>情报记录</span><strong>{{ intelligence.length }}</strong></div>
        <div class="mini-stat"><span>环境要素</span><strong>{{ environment.length }}</strong></div>
        <div class="mini-stat"><span>图谱节点</span><strong>{{ graph.nodes.length }}</strong></div>
        <div class="mini-stat"><span>抽取证据</span><strong>{{ selectedSourceExtractions.length }}</strong></div>
      </div>
      </section>

      <section class="glass-card resource-detail-shell">
      <div class="resource-detail-shell__header">
        <div>
          <span class="eyebrow">Evidence Cabin</span>
          <h3>证据与编辑侧舱</h3>
          <p>当前侧舱遵循“先看源快照，再查证据，最后修正记录或追踪关系”的阅读顺序。</p>
        </div>
        <div class="segmented-row wrap">
          <button class="segmented" :class="{ active: rightTab === 'preview' }" @click="rightTab = 'preview'">源数据查看</button>
          <button class="segmented" :class="{ active: rightTab === 'editor' }" @click="rightTab = 'editor'">记录编辑器</button>
          <button class="segmented" :class="{ active: rightTab === 'graph' }" @click="rightTab = 'graph'">知识图谱</button>
        </div>
      </div>

      <div class="resource-detail-shell__summary top-gap">
        <div class="resource-detail-shell__summary-card">
          <span>当前源</span>
          <strong>{{ selectedSourceRecord?.name || '未选择' }}</strong>
          <small>{{ selectedSourceRecord?.description || selectedSourceSummary }}</small>
        </div>
        <div class="resource-detail-shell__summary-card">
          <span>主视图</span>
          <strong>{{ selectedSourcePreviewTypeLabel }}</strong>
          <small>{{ rightTab === 'preview' ? '正在审看快照与证据' : rightTab === 'editor' ? '正在校正结构化记录' : '正在分析知识图谱' }}</small>
        </div>
      </div>

      <div v-show="rightTab === 'preview'" class="resource-panel-body">
        <div class="section-heading compact top-gap">
          <div>
            <h3>源数据查看</h3>
          </div>
        </div>

        <p v-if="previewLoading" class="muted-text top-gap">正在加载源数据内容...</p>
        <template v-else-if="sourcePreview?.preview">
          <div v-if="sourcePreview.preview.previewType === 'table'" class="table-shell compact-table top-gap">
            <table>
              <thead>
                <tr>
                  <th v-for="column in sourcePreview.preview.payload.columns" :key="column">{{ column }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in sourcePreview.preview.payload.rows" :key="rowIndex">
                  <td
                    v-for="(column, columnIndex) in sourcePreview.preview.payload.columns"
                    :key="column"
                  >
                    {{ resolvePreviewCell(row, column, columnIndex) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else-if="sourcePreview.preview.previewType === 'json'" class="code-viewer top-gap">
            <pre>{{ formatJson(sourcePreview.preview.payload) }}</pre>
          </div>
          <div v-else-if="sourcePreview.preview.previewType === 'image'" class="image-preview top-gap">
            <img :src="sourcePreview.preview.payload.imageUrl" :alt="sourcePreview.source.name" />
            <p class="muted-text">{{ sourcePreview.preview.payload.description }}</p>
          </div>
          <div v-else-if="sourcePreview.preview.previewType === 'document'" class="detail-card top-gap">
            <div class="section-heading compact">
              <div>
                <h4>{{ sourcePreview.preview.payload.title || sourcePreview.source.name }}</h4>
                <p class="muted-text">{{ sourcePreview.preview.payload.description }}</p>
              </div>
              <div class="chip-row">
                <span class="chip chip-entity">段落 {{ sourcePreview.preview.payload.stats?.paragraphCount || 0 }}</span>
                <span class="chip chip-relation">字符 {{ sourcePreview.preview.payload.stats?.charCount || 0 }}</span>
              </div>
            </div>
            <div class="document-preview top-gap">
              <p v-for="(paragraph, index) in sourcePreview.preview.payload.paragraphs" :key="`${sourcePreview.source.id}-${index}`">
                {{ paragraph }}
              </p>
              <p v-if="!sourcePreview.preview.payload.paragraphs?.length">
                {{ sourcePreview.preview.payload.content || '暂无可展示内容' }}
              </p>
            </div>
          </div>
          <div v-else-if="sourcePreview.preview.previewType === 'workbook'" class="detail-card top-gap">
            <div class="section-heading compact">
              <div>
                <h4>{{ sourcePreview.preview.payload.title || sourcePreview.source.name }}</h4>
                <p class="muted-text">{{ sourcePreview.preview.payload.description }}</p>
              </div>
              <span class="pill pill-muted">工作表 {{ workbookSheets.length }}</span>
            </div>

            <div v-if="workbookSheets.length" class="segmented-row wrap top-gap">
              <button
                v-for="(sheet, index) in workbookSheets"
                :key="`${sourcePreview.source.id}-${sheet.name}`"
                class="segmented"
                :class="{ active: index === selectedWorkbookSheet }"
                @click="selectedWorkbookSheet = index"
              >
                {{ sheet.name }}
              </button>
            </div>

            <div v-if="activeWorkbookSheet" class="top-gap">
              <p class="muted-text">{{ activeWorkbookSheet.summary }}</p>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th v-for="column in activeWorkbookSheet.columns" :key="column">{{ column }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, rowIndex) in activeWorkbookSheet.rows" :key="`${activeWorkbookSheet.name}-${rowIndex}`">
                      <td
                        v-for="(column, columnIndex) in activeWorkbookSheet.columns"
                        :key="`${column}-${columnIndex}`"
                      >
                        {{ resolvePreviewCell(row, column, columnIndex) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <p v-else class="muted-text top-gap">当前工作簿暂无可展示工作表。</p>
          </div>
          <div v-else class="detail-card top-gap">
            <h4>{{ sourcePreview.preview.payload.title || sourcePreview.source.name }}</h4>
            <p>{{ sourcePreview.preview.payload.content || '暂无可展示内容' }}</p>
          </div>

          <article class="detail-card top-gap">
            <span class="eyebrow">证据抽取条目</span>
            <div v-if="selectedSourceExtractions.length" class="table-shell compact-table top-gap">
              <table>
                <thead>
                  <tr>
                    <th>标题</th>
                    <th>来源类型</th>
                    <th>文件名</th>
                    <th>抽取时间</th>
                    <th>摘要</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in selectedSourceExtractions" :key="item.id">
                    <td>{{ item.title || '--' }}</td>
                    <td>{{ item.sourceType || 'resource-extraction' }}</td>
                    <td>{{ item.fileName || '--' }}</td>
                    <td>{{ item.createdAt || '--' }}</td>
                    <td>{{ item.summary || '--' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted-text top-gap">暂无抽取条目</p>
          </article>
        </template>
        <p v-else class="muted-text top-gap">暂无内容快照</p>
      </div>

      <div v-show="rightTab === 'editor'" class="resource-panel-body">
        <div class="section-heading compact top-gap">
          <div>
            <h3>情报与环境记录管理</h3>
          </div>
          <div class="toolbar-row wrap">
            <button class="button button-ghost" @click="startNewRecord('intelligence')" :disabled="!canManage">新建情报记录</button>
            <button class="button button-ghost" @click="startNewRecord('environment')" :disabled="!canManage">新建环境记录</button>
          </div>
        </div>

        <div class="segmented-row wrap top-gap">
          <button class="segmented" :class="{ active: recordType === 'intelligence' }" @click="recordType = 'intelligence'">情报记录</button>
          <button class="segmented" :class="{ active: recordType === 'environment' }" @click="recordType = 'environment'">环境记录</button>
        </div>

        <div class="resource-source-list compact-record-list top-gap">
          <button
            v-for="record in visibleRecordList"
            :key="`${record.recordType}-${record.id}`"
            class="entity-item"
            :class="{ active: record.id === selectedRecordId && record.recordType === recordType }"
            @click="loadRecord(record)"
          >
            <div>
              <strong>{{ record.title }}</strong>
              <small>{{ record.subtitle }}</small>
            </div>
            <span class="tag" :class="record.badgeClass">{{ record.badge }}</span>
          </button>
          <div v-if="!visibleRecordList.length" class="detail-card compact-empty-state">
            暂无记录
          </div>
        </div>

        <fieldset class="permission-fieldset top-gap" :disabled="!canManage">
          <div v-if="recordType === 'intelligence'" class="form-grid top-gap single-column">
            <label>
              阵营
              <select v-model="editor.camp">
                <option value="blue">蓝方</option>
                <option value="red">红方</option>
              </select>
            </label>
            <label>
              类别
              <input v-model="editor.category" type="text" />
            </label>
            <label>
              名称
              <input v-model="editor.name" type="text" />
            </label>
            <label>
              角色
              <input v-model="editor.role" type="text" />
            </label>
            <label>
              状态
              <input v-model="editor.readiness" type="text" />
            </label>
            <label>
              强度
              <input v-model.number="editor.strength" type="number" min="1" max="10" />
            </label>
            <label>
              纬度
              <input v-model.number="editor.latitude" type="number" step="0.01" />
            </label>
            <label>
              经度
              <input v-model.number="editor.longitude" type="number" step="0.01" />
            </label>
            <label>
              数据源
              <select v-model="editor.sourceId">
                <option v-for="source in sources" :key="source.id" :value="String(source.id)">{{ source.name }}</option>
              </select>
            </label>
            <label>
              标签
              <input v-model="editor.tagsText" type="text" placeholder="使用逗号分隔" />
            </label>
            <label>
              备注
              <textarea v-model="editor.notes" rows="4" />
            </label>
          </div>

          <div v-else class="form-grid top-gap single-column">
            <label>
              环境类型
              <select v-model="editor.kind">
                <option v-for="item in environmentKindOptions" :key="item.key" :value="item.key">{{ item.label }}</option>
              </select>
            </label>
            <label>
              名称
              <input v-model="editor.name" type="text" />
            </label>
            <label>
              几何类型
              <select v-model="editor.geometryType">
                <option value="circle">圆形范围</option>
                <option value="polygon">多边形区域</option>
              </select>
            </label>
            <label>
              数据源
              <select v-model="editor.sourceId">
                <option v-for="source in sources" :key="source.id" :value="String(source.id)">{{ source.name }}</option>
              </select>
            </label>
            <label>
              气象 / 描述
              <input v-model="editor.weather" type="text" />
            </label>
            <label>
              风险等级
              <select v-model="editor.riskLevel">
                <option v-for="level in riskLevelOptions" :key="level" :value="level">{{ level }}</option>
              </select>
            </label>
            <template v-if="editor.geometryType === 'circle'">
              <label>
                纬度
                <input v-model.number="editor.latitude" type="number" step="0.01" />
              </label>
              <label>
                经度
                <input v-model.number="editor.longitude" type="number" step="0.01" />
              </label>
              <label>
                半径（米）
                <input v-model.number="editor.radius" type="number" step="100" min="100" />
              </label>
            </template>
            <label v-else>
              多边形点集
              <textarea v-model="editor.polygonText" rows="6" placeholder="每行一个点：经度, 纬度, 高度" />
            </label>
            <label>
              备注
              <textarea v-model="editor.notes" rows="4" />
            </label>
          </div>

          <div class="toolbar-row top-gap wrap">
            <button class="button" @click="saveRecord" :disabled="!canManage">{{ selectedRecordId ? '更新记录' : '新增记录' }}</button>
            <button class="button button-danger" :disabled="!canManage || !selectedRecordId" @click="deleteRecord">删除记录</button>
            <span class="muted-text" v-if="busy">保存中...</span>
          </div>
        </fieldset>
      </div>

      <div v-show="rightTab === 'graph'" class="resource-panel-body">
        <div class="section-heading compact top-gap">
          <div>
            <h3>知识图谱</h3>
          </div>
        </div>

        <div class="toolbar-row wrap">
          <input v-model="graphKeyword" class="query-input" type="text" placeholder="输入单位、环境或数据源关键字" @keyup.enter="searchGraph" />
          <select v-model="graphModeDraft" @change="searchGraph">
            <option v-for="option in graphModeOptions" :key="option.key" :value="option.key">{{ option.label }}</option>
          </select>
          <button class="button" @click="searchGraph">查询</button>
          <button class="button button-ghost" @click="graphKeyword = ''; searchGraph();">重置</button>
        </div>

        <p class="muted-text top-gap">
          {{ graphModeOptions.find((option) => option.key === graphModeDraft)?.description }}
        </p>

        <div ref="chartRef" class="graph-canvas compact-graph"></div>

        <div class="detail-card top-gap">
          <h4>节点分析</h4>
          <template v-if="selectedGraphNode">
            <p><strong>{{ selectedGraphNode.name }}</strong></p>
            <p>{{ selectedGraphNode.summary }}</p>
            <p class="muted-text">评分：{{ selectedGraphNode.score }}</p>
            <p class="muted-text">关联条目：{{ graphRelatedExtractions.length }}</p>
          </template>
          <p v-else class="muted-text">点击上方节点可查看摘要。</p>
        </div>

        <div v-if="selectedGraphNode && graphRelatedExtractions.length" class="sample-list top-gap compact-samples">
          <article v-for="sample in graphRelatedExtractions" :key="sample.id" class="sample-card">
            <div class="source-card__meta">
              <span class="pill pill-muted">{{ resolveSourceName(sample.sourceId) }}</span>
              <span v-if="sample.title" class="pill pill-active">{{ sample.title }}</span>
            </div>
            <h4>{{ sample.summary || '关键内容提取' }}</h4>
            <p class="muted-text">
              来源类型：{{ sample.sourceType || 'resource-extraction' }}
              · 文件名：{{ sample.fileName || '--' }}
              · 抽取时间：{{ sample.createdAt || '--' }}
            </p>
            <p>{{ sample.text }}</p>
            <div class="chip-row">
              <span v-for="entity in sample.entities" :key="entity" class="chip chip-entity">{{ entity }}</span>
              <span v-for="relation in sample.relations" :key="`${sample.id}-${relation}`" class="chip chip-relation">{{ relation }}</span>
            </div>
          </article>
        </div>
        <div v-else-if="selectedGraphNode" class="detail-card top-gap compact-empty-state">
          暂无关联条目
        </div>
        <div v-else class="detail-card top-gap compact-empty-state">
          选择节点后显示关联条目
        </div>
      </div>
      </section>
    </div>
  </div>
</template>
