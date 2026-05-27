<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api';

const router = useRouter();
const route = useRoute();

const loading = ref(false);
const creating = ref(false);
const errorMessage = ref('');
const tasks = ref([]);

const filters = reactive({
  module: '',
  status: '',
  query: '',
});

const creator = reactive({
  name: '',
  moduleKey: 'planning',
  planningTemplateId: 'fire-strike-task',
  description: '',
  missionType: 'fire-strike',
});

const moduleOptions = [
  { key: '', label: '全部模块' },
  { key: 'planning', label: '规划任务' },
  { key: 'capability', label: '能力评估' },
  { key: 'action', label: '行动计算' },
  { key: 'consumption', label: '消耗计算' },
];

const statusOptions = [
  { key: '', label: '全部状态' },
  { key: 'draft', label: '草稿' },
  { key: 'submitted', label: '已提交' },
  { key: 'archived', label: '已归档' },
];

const planningTemplateOptions = [
  { key: 'fire-strike-task', label: '火力打击任务' },
  { key: 'air-assault-task', label: '机降突击任务' },
];

const taskCountLabel = computed(() => `共 ${tasks.value.length} 条任务`);

function formatStatus(status = '') {
  if (status === 'submitted') return '已提交';
  if (status === 'archived') return '已归档';
  return '草稿';
}

function formatModule(moduleKey = '') {
  return moduleOptions.find((item) => item.key === moduleKey)?.label || moduleKey || '未分类';
}

function syncFiltersFromRoute() {
  filters.module = typeof route.query.module === 'string' ? route.query.module : '';
}

async function loadTasks() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const payload = await api.getTasks({
      module: filters.module || undefined,
      status: filters.status || undefined,
      query: filters.query || undefined,
    });
    tasks.value = payload?.tasks || [];
  } catch (error) {
    errorMessage.value = error.message || '任务列表加载失败。';
  } finally {
    loading.value = false;
  }
}

function openTask(taskId) {
  router.push({ name: 'task-center-detail', params: { id: taskId } });
}

async function submitTask(taskId) {
  try {
    await api.submitTask(taskId);
    await loadTasks();
  } catch (error) {
    errorMessage.value = error.message || '任务提交失败。';
  }
}

async function archiveTask(taskId) {
  try {
    await api.archiveTask(taskId);
    await loadTasks();
  } catch (error) {
    errorMessage.value = error.message || '任务归档失败。';
  }
}

async function createTask() {
  creating.value = true;
  errorMessage.value = '';
  try {
    const payload = await api.createTask({
      name: creator.name || undefined,
      moduleKey: creator.moduleKey,
      planningTemplateId: creator.planningTemplateId,
      description: creator.description,
      sharedContext: {
        name: creator.name || undefined,
        missionType: creator.missionType,
      },
    });
    const taskId = payload?.task?.id;
    if (taskId) {
      router.push({ name: 'task-center-detail', params: { id: taskId } });
      return;
    }
    await loadTasks();
  } catch (error) {
    errorMessage.value = error.message || '任务创建失败。';
  } finally {
    creating.value = false;
  }
}

function handleSearch() {
  void loadTasks();
}

onMounted(async () => {
  syncFiltersFromRoute();
  await loadTasks();
});

watch(() => route.query.module, async () => {
  syncFiltersFromRoute();
  await loadTasks();
});
</script>

<template>
  <div class="page-shell">
    <section class="panel-section">
      <div class="glass-card">
        <div class="section-heading">
          <div>
            <h2>总任务中心</h2>
            <p class="muted-text">统一管理任务创建、状态流转、上下文维护与执行入口。</p>
          </div>
          <div class="toolbar-row wrap">
            <button class="button button-ghost" @click="router.push('/')">返回首页</button>
            <span class="pill pill-active">{{ taskCountLabel }}</span>
          </div>
        </div>

        <p v-if="errorMessage" class="muted-text">{{ errorMessage }}</p>

        <div class="form-grid capability-stage-form top-gap">
          <label>
            模块筛选
            <select v-model="filters.module" @change="loadTasks">
              <option v-for="item in moduleOptions" :key="`filter-module-${item.key}`" :value="item.key">{{ item.label }}</option>
            </select>
          </label>
          <label>
            状态筛选
            <select v-model="filters.status" @change="loadTasks">
              <option v-for="item in statusOptions" :key="`filter-status-${item.key}`" :value="item.key">{{ item.label }}</option>
            </select>
          </label>
          <label>
            关键字
            <input v-model="filters.query" type="text" placeholder="任务名称或说明" @keyup.enter="handleSearch" />
          </label>
          <label class="full-span">
            <span>&nbsp;</span>
            <button class="button" type="button" :disabled="loading" @click="handleSearch">{{ loading ? '加载中...' : '查询任务' }}</button>
          </label>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <div class="glass-card">
        <div class="section-heading compact">
          <div>
            <h3>创建任务</h3>
            <p class="muted-text">创建后可在任务详情中补全共同任务上下文，再进入对应业务子模块执行。</p>
          </div>
        </div>

        <div class="form-grid capability-stage-form top-gap">
          <label>
            任务名称
            <input v-model="creator.name" type="text" placeholder="例如：东部方向火力打击任务" />
          </label>
          <label>
            所属模块
            <select v-model="creator.moduleKey">
              <option value="planning">规划任务</option>
              <option value="capability">能力评估</option>
              <option value="action">行动计算</option>
              <option value="consumption">消耗计算</option>
            </select>
          </label>
          <label>
            规划模板
            <select v-model="creator.planningTemplateId">
              <option v-for="item in planningTemplateOptions" :key="`creator-template-${item.key}`" :value="item.key">{{ item.label }}</option>
            </select>
          </label>
          <label>
            共同任务类型
            <select v-model="creator.missionType">
              <option value="fire-strike">火力打击</option>
              <option value="air-assault">机降突击</option>
            </select>
          </label>
          <label class="full-span">
            任务说明
            <textarea v-model="creator.description" rows="2" placeholder="补充任务背景与阶段目标"></textarea>
          </label>
          <label class="full-span">
            <span>&nbsp;</span>
            <button class="button" type="button" :disabled="creating" @click="createTask">{{ creating ? '创建中...' : '创建任务' }}</button>
          </label>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <div class="glass-card">
        <div class="section-heading compact">
          <div>
            <h3>任务列表</h3>
          </div>
        </div>

        <div v-if="loading" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">任务加载中...</p>
        </div>

        <div v-else-if="!tasks.length" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">暂无任务，请先创建。</p>
        </div>

        <div v-else class="action-task-grid top-gap">
          <article v-for="task in tasks" :key="task.id" class="action-template-card">
            <div class="action-template-card__head">
              <div>
                <span class="pill pill-active">{{ formatStatus(task.status) }}</span>
                <h4>{{ task.name }}</h4>
              </div>
              <div class="planning-task-actions">
                <button class="button button-ghost" @click="openTask(task.id)">详情</button>
                <button class="button button-ghost" :disabled="task.status !== 'draft'" @click="submitTask(task.id)">提交</button>
                <button class="button button-danger" :disabled="task.status === 'archived'" @click="archiveTask(task.id)">归档</button>
              </div>
            </div>

            <p>{{ task.description || '暂无任务说明。' }}</p>

            <div class="action-template-card__stats">
              <div>
                <span>模块</span>
                <strong>{{ formatModule(task.moduleKey) }}</strong>
              </div>
              <div>
                <span>规划模板</span>
                <strong>{{ task.planningTemplateId || '--' }}</strong>
              </div>
              <div>
                <span>更新时间</span>
                <strong>{{ task.updatedAt || '--' }}</strong>
              </div>
              <div>
                <span>最近执行</span>
                <strong>{{ task.latestRun?.createdAt || '--' }}</strong>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>
