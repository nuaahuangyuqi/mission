<script setup>
import { onMounted } from 'vue';
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
  archiveTaskInstance,
  setPlanningStage,
} = usePlanningWorkflow();

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

async function handleArchiveInstance(taskId) {
  try {
    await archiveTaskInstance(taskId);
  } catch {
    // shared state shows error
  }
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
            <span class="pill" :class="Number(selectedTaskInstance?.id) === Number(task.id) ? 'pill-active' : 'pill-muted'">
              #{{ task.id }}
            </span>
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
          <button class="button button-danger" @click="handleArchiveInstance(task.id)">归档</button>
        </div>
      </article>
    </div>

    <p v-if="state.errorMessage" class="auth-error capability-inline-error top-gap">{{ state.errorMessage }}</p>
  </article>
</template>
