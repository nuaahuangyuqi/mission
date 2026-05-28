<script setup>
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { authState, logout } from '../auth';
import PageBrand from '../components/PageBrand.vue';

const ResourceWorkbench = defineAsyncComponent(() => import('../components/ResourceWorkbench.vue'));
const SituationWorkbench = defineAsyncComponent(() => import('../components/SituationWorkbench.vue'));

const router = useRouter();
const currentSubmodule = ref('resources');
const overview = ref(null);
const sources = ref([]);
const sourcePreview = ref(null);
const previewLoading = ref(false);
const intelligence = ref([]);
const environment = ref([]);
const extractions = ref([]);
const importBatches = ref([]);
const planningTasks = ref([]);
const graph = ref({ nodes: [], edges: [] });
const situationEntities = ref([]);
const loading = ref(true);
const busy = ref(false);
const graphQuery = ref('');
const graphMode = ref('balanced');
const errorMessage = ref('');

const counts = computed(() => overview.value?.counts || {});
const currentUser = computed(() => authState.user || { username: '', role: 'user' });
const canManage = computed(() => currentUser.value.role === 'admin');

function showError(error) {
  errorMessage.value = error?.message || '操作失败，请稍后重试。';
}

function clearError() {
  errorMessage.value = '';
}

async function refreshOverview() {
  overview.value = await api.getOverview();
}

async function refreshGraph() {
  graph.value = await api.getKnowledgeGraph(graphQuery.value, graphMode.value);
}

async function refreshImportBatches() {
  if (!canManage.value) {
    importBatches.value = [];
    return;
  }
  const response = await api.getResourceImportBatches({ limit: 12, offset: 0 });
  importBatches.value = Array.isArray(response?.batches) ? response.batches : [];
}

async function refreshPlanningTasks() {
  const response = await api.getTasks({
    module: 'planning',
    mine: !canManage.value,
  });
  planningTasks.value = Array.isArray(response?.tasks) ? response.tasks : [];
}

async function loadSourcePreview(sourceId) {
  if (!sourceId) {
    sourcePreview.value = null;
    return;
  }

  previewLoading.value = true;
  try {
    sourcePreview.value = await api.getSourcePreview(sourceId);
  } finally {
    previewLoading.value = false;
  }
}

async function loadDashboard() {
  const [
    overviewData,
    sourcesData,
    intelligenceData,
    environmentData,
    extractionData,
    graphData,
    situationData,
    importBatchData,
    planningTaskData,
  ] = await Promise.all([
    api.getOverview(),
    api.getSources(),
    api.getIntelligence(),
    api.getEnvironment(),
    api.getExtractions(),
    api.getKnowledgeGraph(graphQuery.value, graphMode.value),
    api.getSituationEntities(),
    canManage.value ? api.getResourceImportBatches({ limit: 12, offset: 0 }) : Promise.resolve({ batches: [] }),
    api.getTasks({ module: 'planning', mine: !canManage.value }),
  ]);

  overview.value = overviewData;
  sources.value = sourcesData;
  intelligence.value = intelligenceData;
  environment.value = environmentData;
  extractions.value = extractionData;
  graph.value = graphData;
  situationEntities.value = situationData;
  importBatches.value = Array.isArray(importBatchData?.batches) ? importBatchData.batches : [];
  planningTasks.value = Array.isArray(planningTaskData?.tasks) ? planningTaskData.tasks : [];

  const currentSourceId = sourcePreview.value?.source?.id;
  const targetSourceId = currentSourceId && sourcesData.some((item) => item.id === currentSourceId)
    ? currentSourceId
    : sourcesData[0]?.id;
  await loadSourcePreview(targetSourceId);
}

async function selectSource(sourceId) {
  clearError();
  try {
    await loadSourcePreview(sourceId);
  } catch (error) {
    showError(error);
  }
}

async function importSource(payload) {
  clearError();
  busy.value = true;
  try {
    const created = await api.importSource(payload);
    const [sourcesData, extractionData] = await Promise.all([
      api.getSources(),
      api.getExtractions(),
      refreshOverview(),
      refreshGraph(),
      refreshImportBatches(),
    ]);
    sources.value = sourcesData;
    extractions.value = extractionData;
    await loadSourcePreview(created.source.id);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function importSourceBatch(payload) {
  clearError();
  busy.value = true;
  try {
    const response = await api.importSourcesBatch(payload);
    const [sourcesData, extractionData] = await Promise.all([
      api.getSources(),
      api.getExtractions(),
      refreshOverview(),
      refreshGraph(),
      refreshImportBatches(),
      refreshPlanningTasks(),
    ]);
    sources.value = sourcesData;
    extractions.value = extractionData;

    const firstSucceeded = (response?.batch?.items || []).find((item) => item.status === 'succeeded' && item.sourceId);
    if (firstSucceeded?.sourceId) {
      await loadSourcePreview(firstSucceeded.sourceId);
    }
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function retryImportBatchItem({ batchId, itemId }) {
  clearError();
  busy.value = true;
  try {
    const response = await api.retryResourceImportBatchItem(batchId, itemId);
    const [sourcesData, extractionData] = await Promise.all([
      api.getSources(),
      api.getExtractions(),
      refreshOverview(),
      refreshGraph(),
      refreshImportBatches(),
    ]);
    sources.value = sourcesData;
    extractions.value = extractionData;
    if (response?.item?.status === 'succeeded' && response?.item?.sourceId) {
      await loadSourcePreview(response.item.sourceId);
    }
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function deleteSource(sourceId) {
  clearError();
  busy.value = true;
  try {
    await api.deleteSource(sourceId);
    const [sourcesData, extractionData] = await Promise.all([
      api.getSources(),
      api.getExtractions(),
      refreshOverview(),
      refreshGraph(),
    ]);
    sources.value = sourcesData;
    extractions.value = extractionData;
    const nextSourceId = sourcesData[0]?.id;
    await loadSourcePreview(nextSourceId);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function createIntelligence(payload) {
  clearError();
  busy.value = true;
  try {
    await api.createIntelligence(payload);
    intelligence.value = await api.getIntelligence();
    await Promise.all([refreshGraph(), refreshOverview()]);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function updateIntelligence({ id, payload }) {
  clearError();
  busy.value = true;
  try {
    await api.updateIntelligence(id, payload);
    intelligence.value = await api.getIntelligence();
    await Promise.all([refreshGraph(), refreshOverview()]);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function deleteIntelligence(id) {
  clearError();
  busy.value = true;
  try {
    await api.deleteIntelligence(id);
    intelligence.value = await api.getIntelligence();
    await Promise.all([refreshGraph(), refreshOverview()]);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function createEnvironmentRecord(payload) {
  clearError();
  busy.value = true;
  try {
    await api.createEnvironment(payload);
    environment.value = await api.getEnvironment();
    await Promise.all([refreshGraph(), refreshOverview()]);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function updateEnvironmentRecord({ id, payload }) {
  clearError();
  busy.value = true;
  try {
    await api.updateEnvironment(id, payload);
    environment.value = await api.getEnvironment();
    await Promise.all([refreshGraph(), refreshOverview()]);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function deleteEnvironmentRecord(id) {
  clearError();
  busy.value = true;
  try {
    await api.deleteEnvironment(id);
    environment.value = await api.getEnvironment();
    await Promise.all([refreshGraph(), refreshOverview()]);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function searchGraph(payload) {
  clearError();
  try {
    if (typeof payload === 'string') {
      graphQuery.value = payload;
    } else {
      graphQuery.value = payload?.query || '';
      graphMode.value = payload?.mode || graphMode.value;
    }
    await refreshGraph();
  } catch (error) {
    showError(error);
  }
}

async function createEntity(payload) {
  clearError();
  busy.value = true;
  try {
    await api.createSituationEntity(payload);
    situationEntities.value = await api.getSituationEntities();
    await refreshOverview();
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function updateEntity({ id, payload }) {
  clearError();
  busy.value = true;
  try {
    await api.updateSituationEntity(id, payload);
    situationEntities.value = await api.getSituationEntities();
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function deleteEntity(id) {
  clearError();
  busy.value = true;
  try {
    await api.deleteSituationEntity(id);
    situationEntities.value = await api.getSituationEntities();
    await refreshOverview();
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}

async function handleLogout() {
  await logout();
  router.replace('/login');
}

onMounted(async () => {
  try {
    await loadDashboard();
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-shell data-service-shell">
    <header class="glass-card module-topbar">
      <div class="module-topbar__row">
        <div class="module-topbar__intro">
          <div class="module-topbar__nav">
            <button class="back-link module-topbar__back" @click="router.push('/')">返回首页</button>
            <span class="eyebrow">模块 / 数据信息服务</span>
          </div>
          <div class="module-topbar__title">
            <h1>数据信息服务</h1>
          </div>
        </div>

        <div class="module-topbar__stats">
          <div class="module-topbar__stat">
            <span>数据源</span>
            <strong>{{ loading ? '...' : counts.sources || 0 }}</strong>
          </div>
          <div class="module-topbar__stat">
            <span>情报</span>
            <strong>{{ loading ? '...' : counts.intelligence || 0 }}</strong>
          </div>
          <div class="module-topbar__stat">
            <span>环境</span>
            <strong>{{ loading ? '...' : counts.environment || 0 }}</strong>
          </div>
        </div>

        <div class="module-topbar__side">
          <PageBrand compact />
          <div class="module-topbar__session">
            <span>当前账号</span>
            <strong>{{ currentUser.username }}</strong>
            <small>{{ canManage ? '管理员' : '用户' }}</small>
            <button class="back-link module-topbar__logout" @click="handleLogout">退出登录</button>
          </div>
        </div>
      </div>

      <div class="module-topbar__bottom">
        <div class="segmented-row segmented-row--compact module-topbar__tabs">
          <button class="segmented" :class="{ active: currentSubmodule === 'resources' }" @click="currentSubmodule = 'resources'">信息资源子模块</button>
          <button class="segmented" :class="{ active: currentSubmodule === 'situation' }" @click="currentSubmodule = 'situation'">专题态势子模块</button>
        </div>

        <div class="module-topbar__status">
          <p class="muted-text" v-if="busy">正在处理数据...</p>
          <p class="muted-text" v-else-if="!canManage">只读模式</p>
          <p class="muted-text module-topbar__error" v-if="errorMessage">{{ errorMessage }}</p>
        </div>
      </div>
    </header>

    <section class="panel-section" v-if="currentSubmodule === 'resources'">
      <ResourceWorkbench
        :sources="sources"
        :source-preview="sourcePreview"
        :preview-loading="previewLoading"
        :intelligence="intelligence"
        :environment="environment"
        :graph="graph"
        :graph-mode="graphMode"
        :extractions="extractions"
        :import-batches="importBatches"
        :planning-tasks="planningTasks"
        :busy="busy"
        :can-manage="canManage"
        @select-source="selectSource"
        @import-source="importSource"
        @import-source-batch="importSourceBatch"
        @retry-import-item="retryImportBatchItem"
        @delete-source="deleteSource"
        @create-intelligence="createIntelligence"
        @update-intelligence="updateIntelligence"
        @delete-intelligence="deleteIntelligence"
        @create-environment="createEnvironmentRecord"
        @update-environment="updateEnvironmentRecord"
        @delete-environment="deleteEnvironmentRecord"
        @search-graph="searchGraph"
      />
    </section>

    <section class="panel-section" v-else>
      <SituationWorkbench
        :entities="situationEntities"
        :environment="environment"
        :can-manage="canManage"
        @create-entity="createEntity"
        @update-entity="updateEntity"
        @delete-entity="deleteEntity"
      />
    </section>
  </div>
</template>

