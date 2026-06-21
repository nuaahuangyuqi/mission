<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { usePlanningWorkflow } from '../../modules/planningWorkflow';

const router = useRouter();
const {
  state,
  taskOptions,
  taskInstances,
  selectedTaskInstance,
  setSelectedTask,
  createPlanningTaskInstance,
  selectTaskInstance,
  renameTaskInstance,
  deleteTaskInstances,
  setPlanningStage,
} = usePlanningWorkflow();

const selectedTaskInstanceIds = ref([]);
const visibleTaskIds = computed(() => taskInstances.value.map((task) => Number(task.id)).filter((id) => Number.isInteger(id)));
const visibleTaskIdSet = computed(() => new Set(visibleTaskIds.value));
const selectedVisibleTaskIds = computed(() => selectedTaskInstanceIds.value.filter((id) => visibleTaskIdSet.value.has(Number(id))));
const selectedTaskInstanceIdSet = computed(() => new Set(selectedVisibleTaskIds.value.map((id) => Number(id))));
const selectedTaskCount = computed(() => selectedVisibleTaskIds.value.length);
const allVisibleTaskInstancesSelected = computed(() => Boolean(
  visibleTaskIds.value.length && visibleTaskIds.value.every((id) => selectedTaskInstanceIdSet.value.has(Number(id))),
));

onMounted(() => {
  setPlanningStage('library');
});

async function handleCreateInstance(templateId) {
  try {
    await createPlanningTaskInstance(templateId);
  } catch {
    // shared state shows error
  }
}

async function handleSelectInstance(taskId) {
  try {
    await selectTaskInstance(taskId, { loadLatestRun: true });
  } catch {
    // shared state shows error
  }
}

async function handleRenameInstance(task) {
  if (!task?.id) return;
  const nextName = window.prompt('请输入新的任务实例名称', task.name || '');
  if (nextName === null) return;
  const trimmed = nextName.trim();
  if (!trimmed) {
    state.errorMessage = '任务实例名称不能为空。';
    return;
  }
  try {
    await renameTaskInstance(task.id, trimmed);
  } catch (error) {
    state.errorMessage = error.message || '重命名任务实例失败。';
  }
}

function toggleTaskInstanceSelection(taskId) {
  const id = Number(taskId);
  if (!Number.isInteger(id)) return;
  const selected = new Set(selectedVisibleTaskIds.value.map((item) => Number(item)));
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  selectedTaskInstanceIds.value = [...selected];
}

function toggleAllTaskInstances() {
  selectedTaskInstanceIds.value = allVisibleTaskInstancesSelected.value ? [] : [...visibleTaskIds.value];
}

function buildDeleteConfirmMessage(ids = []) {
  const includesOpenedTask = ids.some((id) => Number(id) === Number(selectedTaskInstance.value?.id));
  const openedTaskText = includesOpenedTask
    ? `任务 #${selectedTaskInstance.value.id}「${selectedTaskInstance.value.name || '未命名任务'}」已打开，是否继续删除？\n\n`
    : '';
  return `${openedTaskText}确定删除 ${ids.length} 个作战任务实例吗？删除后执行结果、任务附件和分步执行中间产物将同步删除，且不能再作为前置文件选择；正在运行的任务会自动跳过。`;
}

async function handleDeleteInstances(taskIds) {
  const ids = [...new Set((taskIds || []).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
  if (!ids.length) return;
  const confirmed = window.confirm(buildDeleteConfirmMessage(ids));
  if (!confirmed) return;
  try {
    const response = await deleteTaskInstances(ids);
    selectedTaskInstanceIds.value = selectedVisibleTaskIds.value;
    const skippedIds = Array.isArray(response?.skippedRunningTaskIds) ? response.skippedRunningTaskIds : [];
    if (skippedIds.length) {
      const deletedCount = Number(response?.deletedCount || 0);
      state.errorMessage = deletedCount
        ? `已删除 ${deletedCount} 个任务；任务 #${skippedIds.join('、#')} 当前正在运行，已自动跳过。`
        : `任务 #${skippedIds.join('、#')} 当前正在运行，已自动跳过删除。`;
    }
  } catch (error) {
    state.errorMessage = error.message || '删除任务实例失败。';
  }
}

function handleDeleteSelectedInstances() {
  return handleDeleteInstances(selectedVisibleTaskIds.value);
}

function goToFlow() {
  router.push({ name: 'planning-tasks-flow' });
}
</script>

<template>
  <article class="capability-stage-card">
    <div class="section-heading compact">
      <div>
        <h3>任务模板</h3>
      </div>

      <div class="planning-task-actions">
        <button class="button button-ghost" disabled>上一步</button>
        <button class="button" :disabled="!selectedTaskInstance" @click="goToFlow">下一步</button>
      </div>
    </div>

    <div class="capability-stage-pill-row top-gap">
      <span class="pill pill-active">模板 {{ taskOptions.length }}</span>
      <span class="pill pill-muted">实例 {{ taskInstances.length }}</span>
      <span class="pill pill-muted">{{ selectedTaskInstance ? `当前实例 #${selectedTaskInstance.id}` : '未选择任务实例' }}</span>
    </div>

    <div class="action-task-grid top-gap">
      <article
        v-for="template in taskOptions"
        :key="`template-${template.id}`"
        class="action-template-card"
      >
        <div class="action-template-card__head">
          <div>
            <span class="pill pill-active">{{ template.category }}</span>
            <h4>{{ template.name }}</h4>
          </div>
          <button class="button button-ghost" @click="setSelectedTask(template.id)">设为当前模板</button>
        </div>
        <div class="action-template-card__stats">
          <div><span>步骤</span><strong>{{ template.steps.length }}</strong></div>
          <div><span>输入</span><strong>{{ template.initialInputs.length }}</strong></div>
          <div><span>交付物</span><strong>{{ template.finalDeliverables.length }}</strong></div>
        </div>
        <div class="toolbar-row top-gap wrap">
          <button class="button" @click="handleCreateInstance(template.id)">创建实例</button>
        </div>
      </article>
    </div>
  </article>

  <article class="capability-stage-card top-gap">
    <div class="section-heading compact">
      <div>
        <h3>我的任务实例</h3>
      </div>
      <div class="planning-task-actions">
        <button class="button button-ghost" :disabled="!taskInstances.length" @click="toggleAllTaskInstances">
          {{ allVisibleTaskInstancesSelected ? '取消全选' : '全选' }}
        </button>
        <button class="button button-danger" :disabled="!selectedTaskCount" @click="handleDeleteSelectedInstances">
          {{ selectedTaskCount ? `删除所选 (${selectedTaskCount})` : '删除所选' }}
        </button>
      </div>
    </div>

    <div v-if="!taskInstances.length" class="detail-card compact-empty-state top-gap">
      <p class="muted-text">暂无任务实例。</p>
    </div>

    <div v-else class="action-task-grid top-gap">
      <article
        v-for="task in taskInstances"
        :key="`instance-${task.id}`"
        class="action-template-card"
        :class="{ active: Number(selectedTaskInstance?.id) === Number(task.id) }"
      >
        <div class="action-template-card__head">
          <div>
            <label class="planning-task-select">
              <input
                type="checkbox"
                :checked="selectedTaskInstanceIdSet.has(Number(task.id))"
                @change="toggleTaskInstanceSelection(task.id)"
              />
              <span class="pill" :class="Number(selectedTaskInstance?.id) === Number(task.id) ? 'pill-active' : 'pill-muted'">
                #{{ task.id }}
              </span>
            </label>
            <h4>{{ task.name }}</h4>
          </div>
          <span class="pill pill-muted">{{ task.status }}</span>
        </div>
        <div class="action-template-card__stats">
          <div><span>模板</span><strong>{{ task.planningTemplateId || '--' }}</strong></div>
          <div><span>阶段</span><strong>{{ task.planningStageKey || 'library' }}</strong></div>
          <div><span>更新时间</span><strong>{{ task.updatedAt || '--' }}</strong></div>
        </div>
        <div class="toolbar-row top-gap wrap">
          <button class="button button-ghost" @click="handleSelectInstance(task.id)">打开实例</button>
          <button class="button button-secondary" @click="handleRenameInstance(task)">重命名</button>
          <button class="button button-danger" @click="handleDeleteInstances([task.id])">删除</button>
        </div>
      </article>
    </div>

    <p v-if="state.errorMessage" class="auth-error capability-inline-error top-gap">{{ state.errorMessage }}</p>
  </article>
</template>
