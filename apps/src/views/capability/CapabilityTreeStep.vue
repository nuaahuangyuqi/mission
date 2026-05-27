<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { findNodeById, visitNodes } from '../../modules/capabilityShared';
import { useCapabilityWorkflow } from '../../modules/capabilityWorkflow';

const {
  state,
  indicatorLibrary,
  activeTask,
  activeScheme,
  activeSchemeStats,
  currentTreeVersion,
  workflowSummary,
  weightIssues,
  hasValidWeights,
  saveTreeVersion,
  restoreTreeVersion,
  clearIndicatorTree,
  isLibraryCoreSelected,
  isLibrarySecondarySelected,
  isLibraryLeafSelected,
  insertCoreFromLibrary,
  insertSecondaryFromLibrary,
  insertLeafFromLibrary,
  moveCoreNode,
  moveSecondaryNode,
  moveLeafNode,
  addCoreFromLibrary,
  addSecondaryFromLibrary,
  addLeafFromLibrary,
  removeIndicator,
  canRemoveIndicator,
  createBlankTask,
  duplicateTask,
  removeTask,
  setSelectedTask,
  resetTaskToTemplate,
  setAssessmentName,
  setTaskName,
  setTaskDescription,
  setSelectedEngine,
  setSelectedScheme,
  updateNodeWeight,
  updateSchemeScore,
  updateSchemeField,
  importTreeFile,
  importInputDataFile,
  exportTree,
  exportInputData,
  applyTemplateToTask,
  createTaskFromTemplateId,
  saveCurrentTreeAsTemplate,
  deleteTemplate,
  summarizeScheme,
  formatScore,
} = useCapabilityWorkflow();

const treeImportRef = ref(null);
const inputImportRef = ref(null);
const canvasViewportRef = ref(null);
const canvasMapRef = ref(null);
const templateDraftName = ref('');
const versionDraftName = ref('');
const versionNote = ref('');
const utilityTab = ref('tasks');
const libraryLevelFilter = ref('all');
const selectedLibraryEntryKey = ref('');
const dragState = ref(null);
const dragOverKey = ref('');
const weightDrafts = reactive({});
const scoreDrafts = reactive({});
let canvasFitFrame = 0;
let canvasResizeObserver = null;
const canvasView = reactive({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  minScale: 0.4,
  maxScale: 1.6,
  pointerId: null,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
  isPanning: false,
});

const treeCores = computed(() => activeTask.value?.indicatorTree || []);
const treeSummary = computed(() => ({
  coreCount: treeCores.value.length,
  secondaryCount: treeCores.value.reduce((total, core) => total + core.children.length, 0),
  tertiaryCount: treeCores.value.reduce((total, core) => total + countTertiary(core), 0),
}));
const canvasTransformStyle = computed(() => ({
  transform: `translate(${canvasView.offsetX}px, ${canvasView.offsetY}px) scale(${canvasView.scale})`,
}));
const canvasScaleLabel = computed(() => `${Math.round(canvasView.scale * 100)}%`);
const librarySummary = computed(() => ({
  coreCount: indicatorLibrary.value.length,
  secondaryCount: indicatorLibrary.value.reduce((total, core) => total + core.children.length, 0),
  tertiaryCount: indicatorLibrary.value.reduce((total, core) => total + countTertiary(core), 0),
}));
const libraryLevelOptions = [
  { key: 'all', label: '全部指标' },
  { key: 'core', label: '一级指标' },
  { key: 'secondary', label: '二级指标' },
  { key: 'leaf', label: '三级指标' },
];
const libraryEntries = computed(() => {
  const entries = [];

  indicatorLibrary.value.forEach((core) => {
    entries.push({
      key: `core:${core.id}`,
      level: 'core',
      levelLabel: '一级',
      coreId: core.id,
      secondaryId: '',
      leafId: '',
      name: core.name,
      parentLabel: '--',
      detail: core.description || '未填写说明',
    });

    core.children.forEach((secondary) => {
      entries.push({
        key: `secondary:${secondary.id}`,
        level: 'secondary',
        levelLabel: '二级',
        coreId: core.id,
        secondaryId: secondary.id,
        leafId: '',
        name: secondary.name,
        parentLabel: core.name,
        detail: describeLeafPreview(secondary),
      });

      secondary.children.forEach((leaf) => {
        entries.push({
          key: `leaf:${leaf.id}`,
          level: 'leaf',
          levelLabel: '三级',
          coreId: core.id,
          secondaryId: secondary.id,
          leafId: leaf.id,
          name: leaf.name,
          parentLabel: `${core.name} / ${secondary.name}`,
          detail: leaf.unit ? `单位：${leaf.unit}` : '未设置单位',
        });
      });
    });
  });

  return entries;
});
const filteredLibraryEntries = computed(() => (
  libraryEntries.value.filter((entry) => (
    libraryLevelFilter.value === 'all' || entry.level === libraryLevelFilter.value
  ))
));
const selectedLibraryEntry = computed(() => (
  libraryEntries.value.find((entry) => entry.key === selectedLibraryEntryKey.value) || null
));
const canAddSelectedLibraryEntry = computed(() => canAddLibraryEntry(selectedLibraryEntry.value));
const selectedLibraryEntryHint = computed(() => {
  const entry = selectedLibraryEntry.value;
  if (!entry) {
    return '请先在列表中选中一个指标，再执行添加。';
  }

  if (isLibraryEntryAdded(entry)) {
    return '该指标已经在当前画布中，无需重复添加。';
  }

  if (entry.level === 'secondary') {
    return '添加二级指标时会自动补齐其所属一级指标。';
  }

  if (entry.level === 'leaf' && !isLibrarySecondarySelected(entry.coreId, entry.secondaryId)) {
    return '请先添加该三级指标所属的二级指标。';
  }

  return '已满足添加条件，可直接加入画布。';
});
const engineDescription = computed(() => state.template?.engines?.find((item) => item.key === activeTask.value?.selectedEngine)?.description || '');
const treeLayoutSignature = computed(() => JSON.stringify(
  treeCores.value.map((core) => ({
    id: core.id,
    name: core.name,
    weight: core.weight,
    children: core.children.map((secondary) => ({
      id: secondary.id,
      name: secondary.name,
      weight: secondary.weight,
      children: secondary.children.map((leaf) => ({
        id: leaf.id,
        name: leaf.name,
        weight: leaf.weight,
      })),
    })),
  })),
));
const treeNodeValueMap = computed(() => {
  const valueMap = new Map();
  const schemeScores = activeScheme.value?.scores || {};

  function resolveNodeValue(node) {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (!children.length) {
      const leafValue = Number(schemeScores?.[node.id]);
      const resolvedLeafValue = Number.isFinite(leafValue) ? leafValue : null;
      valueMap.set(node.id, resolvedLeafValue);
      return resolvedLeafValue;
    }

    const childValues = children
      .map((child) => ({
        value: resolveNodeValue(child),
        weight: Number(child?.weight),
      }))
      .filter((item) => Number.isFinite(item.value));

    if (!childValues.length) {
      valueMap.set(node.id, null);
      return null;
    }

    const weightedChildren = childValues.filter((item) => item.weight > 0);
    const aggregateValue = weightedChildren.length
      ? weightedChildren.reduce((sum, item) => sum + (item.value * item.weight), 0)
        / weightedChildren.reduce((sum, item) => sum + item.weight, 0)
      : childValues.reduce((sum, item) => sum + item.value, 0) / childValues.length;

    const resolvedAggregateValue = Number.isFinite(aggregateValue) ? Number(aggregateValue.toFixed(2)) : null;
    valueMap.set(node.id, resolvedAggregateValue);
    return resolvedAggregateValue;
  }

  treeCores.value.forEach((core) => {
    resolveNodeValue(core);
  });

  return valueMap;
});
const canvasHint = computed(() => {
  if (dragState.value?.type === 'library-core') {
    return '将一级指标拖到根节点插槽后可直接加入画布。';
  }
  if (dragState.value?.type === 'library-secondary') {
    return '将二级指标拖到所属一级指标的分支插槽中。';
  }
  if (dragState.value?.type === 'library-leaf') {
    return '将三级指标拖到所属二级指标的分支插槽中。';
  }
  if (dragState.value?.type === 'core') {
    return '正在调整一级指标顺序，可拖到其他一级指标前后。';
  }
  if (dragState.value?.type === 'secondary') {
    return '正在调整二级指标顺序，但只能在所属一级指标内移动。';
  }
  if (dragState.value?.type === 'leaf') {
    return '正在调整三级指标顺序，但只能在所属二级指标内移动。';
  }
  return '从右侧指标列表中选中条目并点击添加，加入画布后可继续拖动调整顺序或删除。';
});

function replaceDraftMap(target, nextEntries) {
  Object.keys(target).forEach((key) => {
    delete target[key];
  });

  Object.entries(nextEntries).forEach(([key, value]) => {
    target[key] = value;
  });
}

function formatDraftValue(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}

function syncWeightDrafts() {
  const nextEntries = {};
  visitNodes(treeCores.value, (node) => {
    nextEntries[node.id] = formatDraftValue(node.weight, '0');
  });
  replaceDraftMap(weightDrafts, nextEntries);
}

function syncScoreDrafts() {
  const nextEntries = {};
  visitNodes(treeCores.value, (node) => {
    if (Array.isArray(node?.children) && node.children.length) {
      return;
    }

    nextEntries[node.id] = formatDraftValue(activeScheme.value?.scores?.[node.id] ?? 80, '80');
  });
  replaceDraftMap(scoreDrafts, nextEntries);
}

function commitNodeWeight(nodeId) {
  updateNodeWeight(nodeId, weightDrafts[nodeId]);
  const node = findNodeById(activeTask.value?.indicatorTree || [], nodeId);
  weightDrafts[nodeId] = formatDraftValue(node?.weight, '0');
}

function commitSchemeScore(leafId) {
  updateSchemeScore(activeTask.value?.selectedSchemeId, leafId, scoreDrafts[leafId]);
  scoreDrafts[leafId] = formatDraftValue(activeScheme.value?.scores?.[leafId] ?? 80, '80');
}

function countTertiary(core) {
  if (!core) {
    return 0;
  }

  return core.children.reduce((total, secondary) => total + secondary.children.length, 0);
}

function formatTreeValue(value) {
  return Number.isFinite(value) ? formatScore(value, 1) : '--';
}

function resolveTreeNodeValue(nodeId) {
  return formatTreeValue(treeNodeValueMap.value.get(nodeId));
}

function describeLeafPreview(secondary) {
  const names = secondary.children.slice(0, 3).map((leaf) => leaf.name);
  if (secondary.children.length > 3) {
    names.push(`共 ${secondary.children.length} 项`);
  }
  return names.join(' / ') || '暂无三级指标';
}

function isLibraryEntryAdded(entry) {
  if (!entry) {
    return false;
  }

  if (entry.level === 'core') {
    return isLibraryCoreSelected(entry.coreId);
  }

  if (entry.level === 'secondary') {
    return isLibrarySecondarySelected(entry.coreId, entry.secondaryId);
  }

  return isLibraryLeafSelected(entry.secondaryId, entry.leafId);
}

function canAddLibraryEntry(entry) {
  if (!entry || isLibraryEntryAdded(entry)) {
    return false;
  }

  if (entry.level === 'leaf') {
    return isLibrarySecondarySelected(entry.coreId, entry.secondaryId);
  }

  return true;
}

function selectLibraryEntry(entryKey) {
  selectedLibraryEntryKey.value = entryKey;
}

function addSelectedLibraryEntry() {
  const entry = selectedLibraryEntry.value;
  if (!canAddLibraryEntry(entry)) {
    return;
  }

  if (entry.level === 'core') {
    addCoreFromLibrary(entry.coreId);
    return;
  }

  if (entry.level === 'secondary') {
    addSecondaryFromLibrary(entry.coreId, entry.secondaryId);
    return;
  }

  addLeafFromLibrary(entry.secondaryId, entry.leafId);
}

function triggerTreeImport() {
  treeImportRef.value?.click();
}

function triggerInputImport() {
  inputImportRef.value?.click();
}

async function handleTreeImport(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    await importTreeFile(file);
  } finally {
    event.target.value = '';
  }
}

async function handleInputImport(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    await importInputDataFile(file);
  } finally {
    event.target.value = '';
  }
}

function handleSaveVersion() {
  saveTreeVersion({
    name: versionDraftName.value || undefined,
    note: versionNote.value || '',
  });
  versionDraftName.value = '';
  versionNote.value = '';
}

function handleSaveTemplate() {
  saveCurrentTreeAsTemplate({
    name: templateDraftName.value || `${activeTask.value?.name || '当前任务'} 模板`,
    description: activeTask.value?.description || '',
  });
  templateDraftName.value = '';
}

function handleDeleteTemplate(templateId, templateName) {
  if (window.confirm(`确认删除模板“${templateName}”吗？`)) {
    deleteTemplate(templateId);
  }
}

function handleRemoveTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }

  if (window.confirm(`确认删除评估任务“${task.name}”吗？`)) {
    removeTask(taskId);
  }
}

function moveCoreUp(coreId, coreIndex) {
  moveCoreNode(coreId, Math.max(0, coreIndex - 1));
}

function moveCoreDown(coreId, coreIndex) {
  moveCoreNode(coreId, Math.min(treeCores.value.length, coreIndex + 2));
}

function moveSecondaryUp(core, secondaryId, secondaryIndex) {
  moveSecondaryNode(secondaryId, core.id, Math.max(0, secondaryIndex - 1));
}

function moveSecondaryDown(core, secondaryId, secondaryIndex) {
  moveSecondaryNode(secondaryId, core.id, Math.min(core.children.length, secondaryIndex + 2));
}

function moveLeafUp(secondary, leafId, leafIndex) {
  moveLeafNode(leafId, secondary.id, Math.max(0, leafIndex - 1));
}

function moveLeafDown(secondary, leafId, leafIndex) {
  moveLeafNode(leafId, secondary.id, Math.min(secondary.children.length, leafIndex + 2));
}

function setDragState(payload) {
  dragState.value = payload;
}

function clearDragState() {
  dragState.value = null;
  dragOverKey.value = '';
}

function handleDragStart(payload, event) {
  setDragState(payload);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify(payload));
  }
}

function clampCanvasScale(value) {
  return Math.min(canvasView.maxScale, Math.max(canvasView.minScale, Number(value.toFixed(2))));
}

function getCanvasFocusPoint() {
  const rect = canvasViewportRef.value?.getBoundingClientRect();
  if (!rect) {
    return { x: 0, y: 0 };
  }

  return {
    x: rect.width / 2,
    y: rect.height / 2,
  };
}

function applyCanvasScale(nextScale, focusPoint = getCanvasFocusPoint()) {
  const previousScale = canvasView.scale;
  const clampedScale = clampCanvasScale(nextScale);
  if (clampedScale === previousScale) {
    return;
  }

  const worldX = (focusPoint.x - canvasView.offsetX) / previousScale;
  const worldY = (focusPoint.y - canvasView.offsetY) / previousScale;

  canvasView.scale = clampedScale;
  canvasView.offsetX = focusPoint.x - (worldX * clampedScale);
  canvasView.offsetY = focusPoint.y - (worldY * clampedScale);
}

function zoomInCanvas() {
  applyCanvasScale(canvasView.scale * 1.1);
}

function zoomOutCanvas() {
  applyCanvasScale(canvasView.scale / 1.1);
}

function centerCanvasAtScale(nextScale) {
  const viewport = canvasViewportRef.value;
  const map = canvasMapRef.value;
  if (!viewport || !map) {
    return;
  }

  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  const contentWidth = map.offsetWidth;
  const contentHeight = map.offsetHeight;
  if (!viewportWidth || !viewportHeight || !contentWidth || !contentHeight) {
    return;
  }

  const clampedScale = clampCanvasScale(nextScale);
  canvasView.scale = clampedScale;
  canvasView.offsetX = Math.round(((viewportWidth - (contentWidth * clampedScale)) / 2) - map.offsetLeft);
  canvasView.offsetY = Math.round(((viewportHeight - (contentHeight * clampedScale)) / 2) - map.offsetTop);
  canvasView.pointerId = null;
  canvasView.isPanning = false;
}

function fitCanvasToTree() {
  const viewport = canvasViewportRef.value;
  const map = canvasMapRef.value;
  if (!viewport || !map) {
    return;
  }

  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  const contentWidth = map.offsetWidth;
  const contentHeight = map.offsetHeight;
  if (!viewportWidth || !viewportHeight || !contentWidth || !contentHeight) {
    return;
  }

  const horizontalPadding = Math.max(28, Math.min(64, viewportWidth * 0.06));
  const verticalPadding = Math.max(24, Math.min(56, viewportHeight * 0.06));
  const fittedScale = Math.min(
    (viewportWidth - (horizontalPadding * 2)) / contentWidth,
    (viewportHeight - (verticalPadding * 2)) / contentHeight,
    1,
  );

  centerCanvasAtScale(fittedScale);
}

function resetCanvasView() {
  centerCanvasAtScale(1);
}

function clearCanvasFitSchedule() {
  if (!canvasFitFrame) {
    return;
  }

  window.cancelAnimationFrame(canvasFitFrame);
  canvasFitFrame = 0;
}

function scheduleCanvasFit() {
  nextTick(() => {
    clearCanvasFitSchedule();
    canvasFitFrame = window.requestAnimationFrame(() => {
      canvasFitFrame = 0;
      fitCanvasToTree();
    });
  });
}

function shouldIgnoreCanvasPan(target) {
  return target instanceof Element && Boolean(
    target.closest('button, input, textarea, select, a, .capability-tree-node, .capability-tree-slot'),
  );
}

function finishCanvasPan(event) {
  const pointerId = canvasView.pointerId;
  if (pointerId !== null && event?.currentTarget?.hasPointerCapture?.(pointerId)) {
    event.currentTarget.releasePointerCapture(pointerId);
  }

  canvasView.pointerId = null;
  canvasView.isPanning = false;
}

function handleCanvasPointerDown(event) {
  const isPrimaryBackground = event.button === 0 && !shouldIgnoreCanvasPan(event.target);
  const isMiddleButton = event.button === 1;
  if (!isPrimaryBackground && !isMiddleButton) {
    return;
  }

  canvasView.pointerId = event.pointerId;
  canvasView.startX = event.clientX;
  canvasView.startY = event.clientY;
  canvasView.originX = canvasView.offsetX;
  canvasView.originY = canvasView.offsetY;
  canvasView.isPanning = true;

  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function handleCanvasPointerMove(event) {
  if (!canvasView.isPanning || canvasView.pointerId !== event.pointerId) {
    return;
  }

  canvasView.offsetX = canvasView.originX + (event.clientX - canvasView.startX);
  canvasView.offsetY = canvasView.originY + (event.clientY - canvasView.startY);
}

function handleCanvasPointerUp(event) {
  if (canvasView.pointerId !== event.pointerId) {
    return;
  }

  finishCanvasPan(event);
}

function handleCanvasWheel(event) {
  if (!canvasViewportRef.value) {
    return;
  }

  const rect = canvasViewportRef.value.getBoundingClientRect();
  const focusPoint = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;

  applyCanvasScale(canvasView.scale * zoomFactor, focusPoint);
}

function isRootDropEnabled() {
  return ['library-core', 'core'].includes(dragState.value?.type);
}

function isCoreDropEnabled() {
  return ['library-secondary', 'secondary'].includes(dragState.value?.type);
}

function isLeafDropEnabled() {
  return ['library-leaf', 'leaf'].includes(dragState.value?.type);
}

function handleDragOver(event, enabled, key) {
  if (!enabled) {
    return;
  }

  event.preventDefault();
  dragOverKey.value = key;
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function handleDragLeave(key) {
  if (dragOverKey.value === key) {
    dragOverKey.value = '';
  }
}

function handleRootDrop(index, event) {
  if (!isRootDropEnabled()) {
    return;
  }

  event.preventDefault();
  const payload = dragState.value;
  if (payload?.type === 'library-core') {
    insertCoreFromLibrary(payload.coreId, index);
  } else if (payload?.type === 'core') {
    moveCoreNode(payload.coreId, index);
  }
  clearDragState();
}

function handleCoreDrop(targetCoreId, index, event) {
  if (!isCoreDropEnabled()) {
    return;
  }

  event.preventDefault();
  const payload = dragState.value;
  if (payload?.type === 'library-secondary') {
    insertSecondaryFromLibrary(payload.coreId, payload.secondaryId, targetCoreId, index);
  } else if (payload?.type === 'secondary') {
    moveSecondaryNode(payload.secondaryId, targetCoreId, index);
  }
  clearDragState();
}

function handleLeafDrop(targetSecondaryId, index, event) {
  if (!isLeafDropEnabled()) {
    return;
  }

  event.preventDefault();
  const payload = dragState.value;
  if (payload?.type === 'library-leaf') {
    insertLeafFromLibrary(payload.secondaryId, payload.leafId, targetSecondaryId, index);
  } else if (payload?.type === 'leaf') {
    moveLeafNode(payload.leafId, targetSecondaryId, index);
  }
  clearDragState();
}

function resolveRootDropLabel() {
  if (dragState.value?.type === 'library-core') {
    return '插入一级';
  }
  if (dragState.value?.type === 'core') {
    return '移动一级';
  }
  return '拖入一级';
}

function resolveCoreDropLabel() {
  if (dragState.value?.type === 'library-secondary') {
    return '插入二级';
  }
  if (dragState.value?.type === 'secondary') {
    return '移动二级';
  }
  return '拖入二级';
}

function resolveLeafDropLabel() {
  if (dragState.value?.type === 'library-leaf') {
    return '插入三级';
  }
  if (dragState.value?.type === 'leaf') {
    return '移动三级';
  }
  return '拖入三级';
}

function isDragOver(key) {
  return dragOverKey.value === key;
}

watch(() => activeTask.value?.id, () => {
  scheduleCanvasFit();
});

watch(treeLayoutSignature, () => {
  scheduleCanvasFit();
});

watch(treeLayoutSignature, () => {
  syncWeightDrafts();
}, { immediate: true });

watch(() => `${activeTask.value?.id || ''}:${activeTask.value?.selectedSchemeId || ''}:${JSON.stringify(activeScheme.value?.scores || {})}`, () => {
  syncScoreDrafts();
}, { immediate: true });

watch(treeLayoutSignature, () => {
  syncScoreDrafts();
}, { immediate: true });

watch(libraryEntries, (entries) => {
  if (!entries.length) {
    selectedLibraryEntryKey.value = '';
    return;
  }

  if (!entries.some((entry) => entry.key === selectedLibraryEntryKey.value)) {
    selectedLibraryEntryKey.value = entries[0].key;
  }
}, { immediate: true });

onMounted(() => {
  scheduleCanvasFit();

  if (typeof ResizeObserver !== 'undefined') {
    canvasResizeObserver = new ResizeObserver(() => {
      scheduleCanvasFit();
    });

    if (canvasViewportRef.value) {
      canvasResizeObserver.observe(canvasViewportRef.value);
    }

    if (canvasMapRef.value) {
      canvasResizeObserver.observe(canvasMapRef.value);
    }
  }
});

onBeforeUnmount(() => {
  clearCanvasFitSchedule();
  canvasResizeObserver?.disconnect();
  canvasResizeObserver = null;
});
</script>

<template>
  <section class="capability-stage capability-stage--tree">
    <article class="capability-stage-brief capability-stage-brief--tree">
      <div class="capability-stage-brief__grid">
        <div class="capability-stage-brief__copy">
          <span class="eyebrow">Step 02 / 指标树与录入</span>
          <h3>构建指标树并录入</h3>

          <div class="capability-stage-pill-row">
            <span class="pill pill-active">当前版本 {{ currentTreeVersion?.name || '--' }}</span>
          </div>
        </div>

        <div class="capability-stage-brief__stats">
          <div class="capability-stage-brief__stat">
            <span>一级指标</span>
            <strong>{{ workflowSummary.coreCount }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>二级指标</span>
            <strong>{{ workflowSummary.secondaryCount }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>三级指标</span>
            <strong>{{ workflowSummary.tertiaryCount }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>版本数量</span>
            <strong>{{ workflowSummary.versionCount }}</strong>
          </div>
        </div>
      </div>
    </article>

    <div class="capability-tree-studio">
      <article class="capability-stage-card capability-tree-canvas-panel">
        <div class="capability-tree-canvas-panel__head">
          <div>
            <h3>指标树画布</h3>
            <p>在画布中直接完成结构调整、权重设置和三级指标值录入。{{ canvasHint }}</p>
          </div>

          <div class="capability-tree-canvas-panel__actions">
            <span class="pill pill-active">一级 {{ treeSummary.coreCount }}</span>
            <span class="pill pill-muted">二级 {{ treeSummary.secondaryCount }}</span>
            <span class="pill pill-muted">三级 {{ treeSummary.tertiaryCount }}</span>
            <span class="pill" :class="hasValidWeights ? 'pill-active' : 'pill-warn'">
              {{ hasValidWeights ? '权重和已校验' : `待修正 ${weightIssues.length} 组` }}
            </span>
            <div class="capability-tree-canvas-panel__viewport">
              <span class="pill pill-muted capability-tree-canvas-panel__zoom">Zoom {{ canvasScaleLabel }}</span>
              <button class="button button-ghost" type="button" @click="zoomOutCanvas">-</button>
              <button class="button button-ghost" type="button" @click="fitCanvasToTree">适配</button>
              <button class="button button-ghost" type="button" @click="resetCanvasView">100%</button>
              <button class="button button-ghost" type="button" @click="zoomInCanvas">+</button>
            </div>
            <button class="button button-danger" @click="clearIndicatorTree">清空画布</button>
          </div>
        </div>

        <div class="capability-tree-editor-strip">
          <div class="capability-flow-object-list capability-flow-object-list--inline">
            <button
              v-for="scheme in activeTask?.schemes || []"
              :key="scheme.id"
              class="capability-flow-object-item"
              :class="{ active: activeTask?.selectedSchemeId === scheme.id }"
              @click="setSelectedScheme(scheme.id)"
            >
              <strong>{{ scheme.name }}</strong>
              <small>均值 {{ formatScore(summarizeScheme(scheme).average) }} / 波动 {{ formatScore(summarizeScheme(scheme).spread) }}</small>
            </button>
          </div>

          <div class="capability-stage-pill-row">
            <span class="pill pill-muted">均值 {{ formatScore(activeSchemeStats.average) }}</span>
            <span class="pill pill-muted">波动区间 {{ formatScore(activeSchemeStats.spread) }}</span>
            <span class="pill pill-muted">异常分值自动回填 80</span>
            <span class="pill pill-muted">权重输入限定 0-1</span>
            <span class="pill pill-muted">同分支权重和需 ≤ 1</span>
            <span class="pill pill-muted">完成后需手动调整到 = 1</span>
          </div>
        </div>

        <div
          ref="canvasViewportRef"
          class="capability-tree-canvas-scroller"
          :class="{ 'is-panning': canvasView.isPanning }"
          @wheel.prevent="handleCanvasWheel"
          @pointerdown="handleCanvasPointerDown"
          @pointermove="handleCanvasPointerMove"
          @pointerup="handleCanvasPointerUp"
          @pointercancel="handleCanvasPointerUp"
        >
          <div class="capability-tree-canvas-surface">
            <div
              ref="canvasMapRef"
              class="capability-tree-map"
              :class="{ 'is-dragging': Boolean(dragState) }"
              :style="canvasTransformStyle"
            >
            <div v-if="treeCores.length" class="capability-tree-root-stage">
              <article class="capability-tree-root-card">
                <span class="eyebrow">Root</span>
                <strong>{{ activeTask?.assessmentName || '能力评估指标树' }}</strong>
                <small>{{ activeTask?.name || '当前评估任务' }}</small>
              </article>
            </div>

            <div v-if="treeCores.length" class="capability-tree-branch-stack">
              <template v-for="(core, coreIndex) in treeCores" :key="core.id">
                <div
                  class="capability-tree-slot capability-tree-slot--root"
                  :data-label="resolveRootDropLabel()"
                  :class="{ 'is-active': isDragOver(`root-${coreIndex}`), 'is-enabled': isRootDropEnabled() }"
                  @dragover="handleDragOver($event, isRootDropEnabled(), `root-${coreIndex}`)"
                  @dragenter="handleDragOver($event, isRootDropEnabled(), `root-${coreIndex}`)"
                  @dragleave="handleDragLeave(`root-${coreIndex}`)"
                  @drop="handleRootDrop(coreIndex, $event)"
                >
                  {{ resolveRootDropLabel() }}
                </div>

                <section class="capability-tree-core-row">
                  <article class="capability-tree-node capability-tree-node--core">
                    <div class="capability-tree-node__copy">
                      <strong>{{ core.name }}</strong>
                      <dl class="capability-tree-node__metrics">
                        <div>
                          <dt>权重</dt>
                          <dd class="capability-tree-node__field">
                            <input
                              :value="weightDrafts[core.id] ?? core.weight"
                              type="number"
                              min="0"
                              max="1"
                              step="0.0001"
                              @input="weightDrafts[core.id] = $event.target.value"
                              @blur="commitNodeWeight(core.id)"
                              @change="commitNodeWeight(core.id)"
                              @keyup.enter.prevent="commitNodeWeight(core.id)"
                            />
                          </dd>
                        </div>
                        <div>
                          <dt>指标值</dt>
                          <dd>{{ resolveTreeNodeValue(core.id) }}</dd>
                        </div>
                      </dl>
                    </div>

                    <div class="capability-tree-node__actions capability-tree-node__actions--tree">
                      <button class="button button-ghost" :disabled="coreIndex === 0" @click="moveCoreUp(core.id, coreIndex)">上移</button>
                      <button class="button button-ghost" :disabled="coreIndex === treeCores.length - 1" @click="moveCoreDown(core.id, coreIndex)">下移</button>
                      <button
                        class="capability-drag-handle"
                        type="button"
                        draggable="true"
                        @dragstart="handleDragStart({ type: 'core', coreId: core.id }, $event)"
                        @dragend="clearDragState"
                      >
                        拖动
                      </button>
                      <button class="button button-danger" :disabled="!canRemoveIndicator(core.id)" @click="removeIndicator(core.id)">删除</button>
                    </div>
                  </article>

                  <div class="capability-tree-secondary-lane">
                    <template v-for="(secondary, secondaryIndex) in core.children" :key="secondary.id">
                      <div
                        class="capability-tree-slot capability-tree-slot--secondary"
                        :data-label="resolveCoreDropLabel()"
                        :class="{ 'is-active': isDragOver(`secondary-${core.id}-${secondaryIndex}`), 'is-enabled': isCoreDropEnabled() }"
                        @dragover="handleDragOver($event, isCoreDropEnabled(), `secondary-${core.id}-${secondaryIndex}`)"
                        @dragenter="handleDragOver($event, isCoreDropEnabled(), `secondary-${core.id}-${secondaryIndex}`)"
                        @dragleave="handleDragLeave(`secondary-${core.id}-${secondaryIndex}`)"
                        @drop="handleCoreDrop(core.id, secondaryIndex, $event)"
                      >
                        {{ resolveCoreDropLabel() }}
                      </div>

                      <div class="capability-tree-secondary-branch">
                        <article class="capability-tree-node capability-tree-node--secondary">
                          <div class="capability-tree-node__copy">
                            <strong>{{ secondary.name }}</strong>
                            <dl class="capability-tree-node__metrics">
                              <div>
                                <dt>权重</dt>
                                <dd class="capability-tree-node__field">
                                  <input
                                    :value="weightDrafts[secondary.id] ?? secondary.weight"
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.0001"
                                    @input="weightDrafts[secondary.id] = $event.target.value"
                                    @blur="commitNodeWeight(secondary.id)"
                                    @change="commitNodeWeight(secondary.id)"
                                    @keyup.enter.prevent="commitNodeWeight(secondary.id)"
                                  />
                                </dd>
                              </div>
                              <div>
                                <dt>指标值</dt>
                                <dd>{{ resolveTreeNodeValue(secondary.id) }}</dd>
                              </div>
                            </dl>
                          </div>

                          <div class="capability-tree-node__actions capability-tree-node__actions--tree">
                            <button class="button button-ghost" :disabled="secondaryIndex === 0" @click="moveSecondaryUp(core, secondary.id, secondaryIndex)">上移</button>
                            <button class="button button-ghost" :disabled="secondaryIndex === core.children.length - 1" @click="moveSecondaryDown(core, secondary.id, secondaryIndex)">下移</button>
                            <button
                              class="capability-drag-handle"
                              type="button"
                              draggable="true"
                              @dragstart="handleDragStart({ type: 'secondary', secondaryId: secondary.id }, $event)"
                              @dragend="clearDragState"
                            >
                              拖动
                            </button>
                            <button class="button button-danger" :disabled="!canRemoveIndicator(secondary.id)" @click="removeIndicator(secondary.id)">删除</button>
                          </div>
                        </article>

                        <div class="capability-tree-leaf-lane">
                          <template v-for="(leaf, leafIndex) in secondary.children" :key="leaf.id">
                            <div
                              class="capability-tree-slot capability-tree-slot--leaf"
                              :data-label="resolveLeafDropLabel()"
                              :class="{ 'is-active': isDragOver(`leaf-${secondary.id}-${leafIndex}`), 'is-enabled': isLeafDropEnabled() }"
                              @dragover="handleDragOver($event, isLeafDropEnabled(), `leaf-${secondary.id}-${leafIndex}`)"
                              @dragenter="handleDragOver($event, isLeafDropEnabled(), `leaf-${secondary.id}-${leafIndex}`)"
                              @dragleave="handleDragLeave(`leaf-${secondary.id}-${leafIndex}`)"
                              @drop="handleLeafDrop(secondary.id, leafIndex, $event)"
                            >
                              {{ resolveLeafDropLabel() }}
                            </div>

                            <article class="capability-tree-node capability-tree-node--leaf">
                              <div class="capability-tree-node__copy">
                                <strong>{{ leaf.name }}</strong>
                                <dl class="capability-tree-node__metrics">
                                  <div>
                                    <dt>权重</dt>
                                    <dd class="capability-tree-node__field">
                                      <input
                                        :value="weightDrafts[leaf.id] ?? leaf.weight"
                                        type="number"
                                        min="0"
                                        max="1"
                                        step="0.0001"
                                        @input="weightDrafts[leaf.id] = $event.target.value"
                                        @blur="commitNodeWeight(leaf.id)"
                                        @change="commitNodeWeight(leaf.id)"
                                        @keyup.enter.prevent="commitNodeWeight(leaf.id)"
                                      />
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>指标值</dt>
                                    <dd class="capability-tree-node__field">
                                      <input
                                        :value="scoreDrafts[leaf.id] ?? activeScheme?.scores?.[leaf.id] ?? 80"
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.1"
                                        @input="scoreDrafts[leaf.id] = $event.target.value"
                                        @blur="commitSchemeScore(leaf.id)"
                                        @change="commitSchemeScore(leaf.id)"
                                        @keyup.enter.prevent="commitSchemeScore(leaf.id)"
                                      />
                                    </dd>
                                  </div>
                                </dl>
                              </div>

                              <div class="capability-tree-node__actions capability-tree-node__actions--tree">
                                <button class="button button-ghost" :disabled="leafIndex === 0" @click="moveLeafUp(secondary, leaf.id, leafIndex)">上移</button>
                                <button class="button button-ghost" :disabled="leafIndex === secondary.children.length - 1" @click="moveLeafDown(secondary, leaf.id, leafIndex)">下移</button>
                                <button
                                  class="capability-drag-handle"
                                  type="button"
                                  draggable="true"
                                  @dragstart="handleDragStart({ type: 'leaf', leafId: leaf.id }, $event)"
                                  @dragend="clearDragState"
                                >
                                  拖动
                                </button>
                                <button class="button button-danger" :disabled="!canRemoveIndicator(leaf.id)" @click="removeIndicator(leaf.id)">删除</button>
                              </div>
                            </article>
                          </template>

                          <div
                            class="capability-tree-slot capability-tree-slot--leaf"
                            :data-label="resolveLeafDropLabel()"
                            :class="{ 'is-active': isDragOver(`leaf-${secondary.id}-end`), 'is-enabled': isLeafDropEnabled(), 'is-empty': !secondary.children.length }"
                            @dragover="handleDragOver($event, isLeafDropEnabled(), `leaf-${secondary.id}-end`)"
                            @dragenter="handleDragOver($event, isLeafDropEnabled(), `leaf-${secondary.id}-end`)"
                            @dragleave="handleDragLeave(`leaf-${secondary.id}-end`)"
                            @drop="handleLeafDrop(secondary.id, secondary.children.length, $event)"
                          >
                            {{ resolveLeafDropLabel() }}
                          </div>
                        </div>
                      </div>
                    </template>

                    <div
                      class="capability-tree-slot capability-tree-slot--secondary"
                      :data-label="resolveCoreDropLabel()"
                      :class="{ 'is-active': isDragOver(`secondary-${core.id}-end`), 'is-enabled': isCoreDropEnabled(), 'is-empty': !core.children.length }"
                      @dragover="handleDragOver($event, isCoreDropEnabled(), `secondary-${core.id}-end`)"
                      @dragenter="handleDragOver($event, isCoreDropEnabled(), `secondary-${core.id}-end`)"
                      @dragleave="handleDragLeave(`secondary-${core.id}-end`)"
                      @drop="handleCoreDrop(core.id, core.children.length, $event)"
                    >
                      {{ resolveCoreDropLabel() }}
                    </div>
                  </div>
                </section>
              </template>

              <div
                class="capability-tree-slot capability-tree-slot--root"
                :data-label="resolveRootDropLabel()"
                :class="{ 'is-active': isDragOver('root-end'), 'is-enabled': isRootDropEnabled() }"
                @dragover="handleDragOver($event, isRootDropEnabled(), 'root-end')"
                @dragenter="handleDragOver($event, isRootDropEnabled(), 'root-end')"
                @dragleave="handleDragLeave('root-end')"
                @drop="handleRootDrop(treeCores.length, $event)"
              >
                {{ resolveRootDropLabel() }}
              </div>
            </div>

            <div
              v-else
              class="capability-tree-empty-shell"
            >
              <div class="capability-tree-empty-shell__copy">
                <strong>画布还是空的</strong>
              </div>

              <div
                class="capability-tree-slot capability-tree-slot--empty"
                :data-label="resolveRootDropLabel()"
                :class="{ 'is-active': isDragOver('root-empty'), 'is-enabled': isRootDropEnabled() }"
                @dragover="handleDragOver($event, isRootDropEnabled(), 'root-empty')"
                @dragenter="handleDragOver($event, isRootDropEnabled(), 'root-empty')"
                @dragleave="handleDragLeave('root-empty')"
                @drop="handleRootDrop(0, $event)"
              >
                {{ resolveRootDropLabel() }}
              </div>
            </div>
            </div>
          </div>
        </div>
      </article>

      <aside class="capability-tree-sidebar">
        <article class="capability-stage-card capability-tree-library-panel">
          <div class="section-heading compact">
            <div>
              <h3>指标体系列表</h3>
            </div>

            <div class="capability-stage-pill-row">
              <span class="pill pill-active">一级 {{ librarySummary.coreCount }}</span>
              <span class="pill pill-muted">二级 {{ librarySummary.secondaryCount }}</span>
              <span class="pill pill-muted">三级 {{ librarySummary.tertiaryCount }}</span>
            </div>
          </div>

          <div class="capability-tree-library-toolbar">
            <div class="segmented-row segmented-row--compact capability-tree-library-filter">
              <button
                v-for="option in libraryLevelOptions"
                :key="option.key"
                class="segmented"
                :class="{ active: libraryLevelFilter === option.key }"
                @click="libraryLevelFilter = option.key"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="capability-tree-flat-list">
            <button
              v-for="entry in filteredLibraryEntries"
              :key="entry.key"
              type="button"
              class="capability-tree-flat-row"
              :class="{
                active: selectedLibraryEntry?.key === entry.key,
                added: isLibraryEntryAdded(entry),
              }"
              @click="selectLibraryEntry(entry.key)"
            >
              <span class="capability-tree-flat-row__level">{{ entry.levelLabel }}</span>
              <strong class="capability-tree-flat-row__name">{{ entry.name }}</strong>
              <span class="capability-tree-flat-row__parent">{{ entry.parentLabel }}</span>
              <span class="capability-tree-flat-row__detail">{{ entry.detail }}</span>
              <span class="pill" :class="isLibraryEntryAdded(entry) ? 'pill-active' : 'pill-muted'">
                {{ isLibraryEntryAdded(entry) ? '已在画布' : '未添加' }}
              </span>
            </button>
            <div v-if="!filteredLibraryEntries.length" class="detail-card compact-empty-state">
              <p class="muted-text">当前筛选条件下暂无指标。</p>
            </div>
          </div>

          <div class="capability-tree-library-actions">
            <div>
              <strong>{{ selectedLibraryEntry?.name || '未选择指标' }}</strong>
            </div>
            <button
              class="button"
              :disabled="!canAddSelectedLibraryEntry"
              @click="addSelectedLibraryEntry"
            >
              添加选中指标
            </button>
          </div>
        </article>

        <article class="capability-stage-card capability-tree-tool-panel">
          <div class="capability-utility-panel__head">
            <div>
              <h3>树工具台</h3>
            </div>

            <div class="segmented-row capability-utility-tabs">
              <button class="segmented" :class="{ active: utilityTab === 'tasks' }" @click="utilityTab = 'tasks'">任务</button>
              <button class="segmented" :class="{ active: utilityTab === 'objects' }" @click="utilityTab = 'objects'">对象</button>
              <button class="segmented" :class="{ active: utilityTab === 'versions' }" @click="utilityTab = 'versions'">版本</button>
              <button class="segmented" :class="{ active: utilityTab === 'templates' }" @click="utilityTab = 'templates'">模板</button>
              <button class="segmented" :class="{ active: utilityTab === 'io' }" @click="utilityTab = 'io'">导入导出</button>
            </div>
          </div>

          <input ref="treeImportRef" type="file" class="capability-file-input" accept=".json,.csv,.tsv,.txt" @change="handleTreeImport" />
          <input ref="inputImportRef" type="file" class="capability-file-input" accept=".json,.csv,.tsv,.txt" @change="handleInputImport" />

          <template v-if="utilityTab === 'tasks'">
            <div class="section-heading compact">
              <div>
                <h4>当前评估任务</h4>
              </div>

              <div class="toolbar-row wrap">
                <button class="button" @click="createBlankTask()">新建空白任务</button>
                <button class="button button-ghost" @click="duplicateTask()">复制当前任务</button>
                <button class="button button-ghost" @click="resetTaskToTemplate">恢复模板内容</button>
              </div>
            </div>

            <div class="form-grid capability-stage-form">
              <label>
                任务名称
                <input
                  :value="activeTask?.name || ''"
                  type="text"
                  placeholder="例如：联合任务能力评估任务"
                  @input="setTaskName($event.target.value)"
                />
              </label>

              <label>
                评估名称
                <input
                  :value="activeTask?.assessmentName || ''"
                  type="text"
                  placeholder="用于结果输出的评估标题"
                  @input="setAssessmentName($event.target.value)"
                />
              </label>

              <label class="full-span">
                任务说明
                <textarea
                  rows="3"
                  :value="activeTask?.description || ''"
                  placeholder="补充当前评估任务的背景、目的和适用场景"
                  @input="setTaskDescription($event.target.value)"
                ></textarea>
              </label>

              <label>
                计算引擎
                <select :value="activeTask?.selectedEngine || 'builtin'" @change="setSelectedEngine($event.target.value)">
                  <option
                    v-for="engine in state.template?.engines || []"
                    :key="engine.key"
                    :value="engine.key"
                    :disabled="engine.status !== 'active'"
                  >
                    {{ engine.label }}{{ engine.status === 'active' ? '' : '（预留）' }}
                  </option>
                </select>
              </label>
            </div>

            <div class="section-heading compact">
              <div>
                <h4>任务切换</h4>
              </div>
            </div>

            <div class="capability-task-grid capability-task-grid--stacked">
              <article
                v-for="task in state.tasks"
                :key="task.id"
                class="capability-task-card"
                :class="{ active: state.selectedTaskId === task.id }"
              >
                <div class="capability-task-card__head">
                  <div>
                    <span class="pill" :class="state.selectedTaskId === task.id ? 'pill-active' : 'pill-muted'">任务</span>
                    <strong>{{ task.name }}</strong>
                  </div>
                  <button class="button button-ghost" @click="setSelectedTask(task.id)">切换</button>
                </div>

                <p>{{ task.description || '未填写任务说明。' }}</p>

                <div class="capability-task-card__stats">
                  <div>
                    <span>对象数</span>
                    <strong>{{ task.schemes.length }}</strong>
                  </div>
                  <div>
                    <span>版本数量</span>
                    <strong>{{ task.treeVersions.length }}</strong>
                  </div>
                </div>

                <div class="toolbar-row wrap">
                  <button class="button button-ghost" @click="duplicateTask(task.id)">复制</button>
                  <button class="button button-danger" :disabled="state.tasks.length <= 1" @click="handleRemoveTask(task.id)">删除</button>
                </div>
              </article>
            </div>
          </template>

          <template v-else-if="utilityTab === 'objects'">
            <div class="section-heading compact">
              <div>
                <h4>对象切换</h4>
              </div>
            </div>

            <div class="capability-workflow-scheme-grid">
              <article
                v-for="(scheme, index) in activeTask?.schemes || []"
                :key="scheme.id"
                class="capability-workflow-scheme-card"
              >
                <div class="capability-workflow-scheme-card__head">
                  <div>
                    <span class="pill" :class="activeTask?.selectedSchemeId === scheme.id ? 'pill-active' : 'pill-muted'">对象 {{ index + 1 }}</span>
                    <strong>{{ scheme.name }}</strong>
                  </div>
                  <button class="button button-ghost" @click="setSelectedScheme(scheme.id)">切换</button>
                </div>

                <div class="capability-workflow-scheme-card__stats">
                  <div>
                    <span>均值</span>
                    <strong>{{ formatScore(summarizeScheme(scheme).average) }}</strong>
                  </div>
                  <div>
                    <span>波动</span>
                    <strong>{{ formatScore(summarizeScheme(scheme).spread) }}</strong>
                  </div>
                </div>

                <label>
                  对象名称
                  <input :value="scheme.name" type="text" @input="updateSchemeField(scheme.id, 'name', $event.target.value)" />
                </label>

                <label>
                  对象说明
                  <textarea rows="3" :value="scheme.description" @input="updateSchemeField(scheme.id, 'description', $event.target.value)"></textarea>
                </label>
              </article>
            </div>
          </template>

          <template v-else-if="utilityTab === 'versions'">
            <div class="form-grid capability-stage-form">
              <label>
                版本名称
                <input v-model="versionDraftName" type="text" placeholder="例如：V2 / 联合作战版" />
              </label>

              <label>
                版本说明
                <input v-model="versionNote" type="text" placeholder="记录本次树结构调整内容" />
              </label>
            </div>

            <div class="toolbar-row wrap">
              <button class="button" @click="handleSaveVersion">保存当前树为新版本</button>
            </div>

            <div class="capability-stage-note">
              <span>当前版本说明</span>
              <p>{{ currentTreeVersion?.note || '当前版本还没有补充说明。' }}</p>
            </div>

            <div class="capability-version-grid capability-version-grid--stacked">
              <article
                v-for="version in activeTask?.treeVersions || []"
                :key="version.id"
                class="capability-version-card"
                :class="{ active: activeTask?.selectedTreeVersionId === version.id }"
              >
                <div class="capability-version-card__head">
                  <div>
                    <span class="pill" :class="activeTask?.selectedTreeVersionId === version.id ? 'pill-active' : 'pill-muted'">{{ version.name }}</span>
                    <strong>{{ version.note || '未填写版本说明' }}</strong>
                  </div>
                  <button class="button button-ghost" @click="restoreTreeVersion(version.id)">恢复版本</button>
                </div>
                <small>{{ version.createdAt }}</small>
                <div class="capability-version-card__stats">
                  <span>一级 {{ version.summary.coreCount }}</span>
                  <span>二级 {{ version.summary.secondaryCount }}</span>
                  <span>三级 {{ version.summary.tertiaryCount }}</span>
                </div>
              </article>
            </div>
          </template>

          <template v-else-if="utilityTab === 'templates'">
            <div class="section-heading compact">
              <div>
                <h4>模板复用</h4>
              </div>
            </div>

            <div class="toolbar-row wrap">
              <label class="capability-inline-field">
                模板名称
                <input v-model="templateDraftName" type="text" placeholder="例如：联合作战标准模板" />
              </label>
              <button class="button" @click="handleSaveTemplate">保存当前任务为模板</button>
            </div>

            <div class="capability-template-grid capability-template-grid--stacked">
              <article
                v-for="templateItem in state.templateLibrary"
                :key="templateItem.id"
                class="capability-template-card"
              >
                <div class="capability-template-card__head">
                  <div>
                    <span class="pill" :class="templateItem.source === 'system' ? 'pill-active' : 'pill-muted'">
                      {{ templateItem.source === 'system' ? '系统模板' : '历史模板' }}
                    </span>
                    <strong>{{ templateItem.name }}</strong>
                  </div>
                  <small>{{ templateItem.summary.coreCount }} / {{ templateItem.summary.secondaryCount }} / {{ templateItem.summary.tertiaryCount }}</small>
                </div>
                <p>{{ templateItem.description || '未填写模板说明。' }}</p>
                <div class="toolbar-row wrap">
                  <button class="button button-ghost" @click="applyTemplateToTask(templateItem.id)">应用到当前任务</button>
                  <button class="button" @click="createTaskFromTemplateId(templateItem.id)">基于模板新建任务</button>
                  <button
                    class="button button-danger"
                    :disabled="templateItem.source === 'system'"
                    @click="handleDeleteTemplate(templateItem.id, templateItem.name)"
                  >
                    删除模板
                  </button>
                </div>
              </article>
            </div>
          </template>

          <template v-else>
            <div class="section-heading compact">
              <div>
                <h4>导入导出</h4>
              </div>
            </div>

            <div class="toolbar-row wrap">
              <button class="button" @click="triggerTreeImport">导入指标树</button>
              <button class="button button-ghost" @click="exportTree('json')">导出 JSON</button>
              <button class="button button-ghost" @click="exportTree('csv')">导出 CSV</button>
              <button class="button button-ghost" @click="exportTree('tsv')">导出 TSV</button>
            </div>

            <div class="toolbar-row wrap">
              <button class="button" @click="triggerInputImport">导入指标值与权重</button>
              <button class="button button-ghost" @click="exportInputData('json')">导出 JSON</button>
              <button class="button button-ghost" @click="exportInputData('csv')">导出 CSV</button>
              <button class="button button-ghost" @click="exportInputData('tsv')">导出 TSV</button>
            </div>
          </template>
        </article>
      </aside>
    </div>
  </section>
</template>




