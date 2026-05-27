<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const saving = ref(false);
const actionBusy = ref(false);
const errorMessage = ref('');
const recentRuns = ref([]);

const taskForm = reactive({
  id: '',
  name: '',
  moduleKey: 'planning',
  planningTemplateId: 'fire-strike-task',
  status: 'draft',
  description: '',
  updatedAt: '',
  createdAt: '',
  sharedContext: {
    name: '',
    missionType: 'fire-strike',
    objective: '',
    description: '',
  },
});

const planningTemplateOptions = [
  { key: 'fire-strike-task', label: '火力打击任务' },
  { key: 'air-assault-task', label: '机降突击任务' },
];

const moduleOptions = [
  { key: 'planning', label: '规划任务' },
  { key: 'capability', label: '能力评估' },
  { key: 'action', label: '行动计算' },
  { key: 'consumption', label: '消耗计算' },
];

const statusLabel = computed(() => {
  if (taskForm.status === 'submitted') return '已提交';
  if (taskForm.status === 'archived') return '已归档';
  return '草稿';
});

const taskId = computed(() => String(route.params.id || '').trim());

function applyTaskPayload(task = {}, runs = []) {
  taskForm.id = String(task.id || '');
  taskForm.name = String(task.name || '');
  taskForm.moduleKey = String(task.moduleKey || 'planning');
  taskForm.planningTemplateId = String(task.planningTemplateId || 'fire-strike-task');
  taskForm.status = String(task.status || 'draft');
  taskForm.description = String(task.description || '');
  taskForm.updatedAt = String(task.updatedAt || '');
  taskForm.createdAt = String(task.createdAt || '');
  taskForm.sharedContext = {
    name: String(task?.sharedContext?.name || task.name || ''),
    missionType: String(task?.sharedContext?.missionType || 'fire-strike'),
    objective: String(task?.sharedContext?.objective || ''),
    description: String(task?.sharedContext?.description || ''),
  };
  recentRuns.value = Array.isArray(runs) ? runs : [];
}

async function loadTaskDetail() {
  if (!taskId.value) {
    errorMessage.value = '任务 ID 无效。';
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  try {
    const payload = await api.getTask(taskId.value);
    applyTaskPayload(payload?.task || {}, payload?.recentRuns || []);
  } catch (error) {
    errorMessage.value = error.message || '任务详情加载失败。';
  } finally {
    loading.value = false;
  }
}

async function saveTask() {
  if (!taskForm.id) return;
  saving.value = true;
  errorMessage.value = '';
  try {
    const payload = await api.updateTask(taskForm.id, {
      name: taskForm.name,
      moduleKey: taskForm.moduleKey,
      planningTemplateId: taskForm.planningTemplateId,
      description: taskForm.description,
      sharedContext: taskForm.sharedContext,
    });
    applyTaskPayload(payload?.task || taskForm, recentRuns.value);
  } catch (error) {
    errorMessage.value = error.message || '任务保存失败。';
  } finally {
    saving.value = false;
  }
}

async function submitTask() {
  if (!taskForm.id) return;
  actionBusy.value = true;
  errorMessage.value = '';
  try {
    const payload = await api.submitTask(taskForm.id);
    applyTaskPayload(payload?.task || taskForm, recentRuns.value);
  } catch (error) {
    errorMessage.value = error.message || '任务提交失败。';
  } finally {
    actionBusy.value = false;
  }
}

async function archiveTask() {
  if (!taskForm.id) return;
  actionBusy.value = true;
  errorMessage.value = '';
  try {
    const payload = await api.archiveTask(taskForm.id);
    applyTaskPayload(payload?.task || taskForm, recentRuns.value);
  } catch (error) {
    errorMessage.value = error.message || '任务归档失败。';
  } finally {
    actionBusy.value = false;
  }
}

function goPlanningExecute() {
  router.push({ name: 'planning-tasks-execute', query: { taskId: taskForm.id } });
}

function goCapability() {
  router.push({ name: 'capability-library', query: { taskId: taskForm.id } });
}

function goAction() {
  router.push({ name: 'action-task', query: { taskId: taskForm.id } });
}

function goConsumption() {
  router.push({ name: 'consumption-scenario', query: { taskId: taskForm.id } });
}

onMounted(async () => {
  await loadTaskDetail();
});

watch(taskId, async () => {
  await loadTaskDetail();
});
</script>

<template>
  <div class="page-shell">
    <section class="panel-section">
      <div class="glass-card">
        <div class="section-heading">
          <div>
            <h2>任务详情</h2>
            <p class="muted-text">任务 ID：#{{ taskForm.id || '--' }}</p>
          </div>
          <div class="toolbar-row wrap">
            <button class="button button-ghost" @click="router.push({ name: 'task-center-list' })">返回任务中心</button>
            <span class="pill pill-active">{{ statusLabel }}</span>
          </div>
        </div>

        <p v-if="errorMessage" class="muted-text">{{ errorMessage }}</p>

        <div v-if="loading" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">任务详情加载中...</p>
        </div>

        <div v-else class="form-grid capability-stage-form top-gap">
          <label>
            任务名称
            <input v-model="taskForm.name" type="text" />
          </label>
          <label>
            所属模块
            <select v-model="taskForm.moduleKey">
              <option v-for="item in moduleOptions" :key="`module-${item.key}`" :value="item.key">{{ item.label }}</option>
            </select>
          </label>
          <label>
            规划模板
            <select v-model="taskForm.planningTemplateId">
              <option v-for="item in planningTemplateOptions" :key="`template-${item.key}`" :value="item.key">{{ item.label }}</option>
            </select>
          </label>
          <label>
            共同任务类型
            <select v-model="taskForm.sharedContext.missionType">
              <option value="fire-strike">火力打击</option>
              <option value="air-assault">机降突击</option>
            </select>
          </label>
          <label class="full-span">
            任务说明
            <textarea v-model="taskForm.description" rows="2"></textarea>
          </label>
          <label class="full-span">
            共同任务目标
            <textarea v-model="taskForm.sharedContext.objective" rows="2"></textarea>
          </label>
          <label class="full-span">
            共同任务背景
            <textarea v-model="taskForm.sharedContext.description" rows="2"></textarea>
          </label>
          <label class="full-span">
            <span>&nbsp;</span>
            <div class="toolbar-row wrap">
              <button class="button" type="button" :disabled="saving" @click="saveTask">{{ saving ? '保存中...' : '保存任务' }}</button>
              <button class="button button-ghost" type="button" :disabled="actionBusy || taskForm.status !== 'draft'" @click="submitTask">提交任务</button>
              <button class="button button-danger" type="button" :disabled="actionBusy || taskForm.status === 'archived'" @click="archiveTask">归档任务</button>
            </div>
          </label>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <div class="glass-card">
        <div class="section-heading compact">
          <div>
            <h3>执行入口</h3>
            <p class="muted-text">从任务中心进入业务子模块，复用同一任务上下文。</p>
          </div>
        </div>

        <div class="toolbar-row wrap top-gap">
          <button class="button" @click="goPlanningExecute">进入规划执行</button>
          <button class="button button-ghost" @click="goCapability">进入能力评估</button>
          <button class="button button-ghost" @click="goAction">进入行动计算</button>
          <button class="button button-ghost" @click="goConsumption">进入消耗计算</button>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <div class="glass-card">
        <div class="section-heading compact">
          <div>
            <h3>最近执行记录摘要</h3>
          </div>
        </div>

        <div v-if="!recentRuns.length" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">暂无执行记录。</p>
        </div>

        <div v-else class="action-validation-issues top-gap">
          <article v-for="item in recentRuns" :key="`run-${item.id}`" class="action-check-card" :class="item.status === 'failed' ? 'issue' : 'pass'">
            <strong>Run #{{ item.id }}</strong>
            <p>状态：{{ item.status }}</p>
            <small class="muted-text">执行时间：{{ item.createdAt || '--' }}</small>
            <small class="muted-text">摘要：{{ item.summary?.assessmentName || item.summary?.message || '无' }}</small>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>
