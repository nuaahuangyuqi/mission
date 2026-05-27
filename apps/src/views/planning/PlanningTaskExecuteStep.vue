<script setup>
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlanningWorkflow } from '../../modules/planningWorkflow';

const router = useRouter();
const route = useRoute();
const {
  selectedTask,
  selectedTaskInstance,
  state,
  executionSummary,
  resultsGeneratedAt,
  setPlanningStage,
} = usePlanningWorkflow();

const executionStateLabel = computed(() => {
  if (state.calculating) return '执行中';
  if (state.results) return state.resultsDirty ? '待重新执行' : '已有结果';
  return '未执行';
});

const formattedGeneratedAt = computed(() => (
  resultsGeneratedAt.value ? String(resultsGeneratedAt.value).slice(0, 19).replace('T', ' ') : '--'
));

const isResultDetailPage = computed(() => route.name === 'planning-tasks-execute-step');

onMounted(() => {
  setPlanningStage('execute');
});

function goToFlow() {
  router.push({ name: 'planning-tasks-flow', query: route.query });
}

function goToExecutionOverview() {
  router.push({ name: 'planning-tasks-execute', query: route.query });
}
</script>

<template>
  <article class="capability-stage-brief capability-stage-brief--results">
    <div class="capability-stage-brief__grid planning-execute-stage-brief">
      <div class="capability-stage-brief__copy">
        <span class="eyebrow">Execution Deck</span>
        <h3>规划执行与成果归档</h3>
        <p>执行总览只保留运行控制、历史记录和专题入口；每个算法的完整执行结果进入独立页面回看。</p>

        <div class="planning-task-actions top-gap">
          <button class="button button-ghost" :disabled="!selectedTaskInstance" @click="goToFlow">上一步</button>
          <button
            v-if="isResultDetailPage"
            class="button button-secondary"
            @click="goToExecutionOverview"
          >
            返回执行总览
          </button>
          <button v-else class="button" disabled>下一步</button>
        </div>
      </div>

      <div class="capability-stage-brief__stats">
        <div class="capability-stage-brief__stat">
          <span>任务模板</span>
          <strong>{{ selectedTask?.name || '未选择任务模板' }}</strong>
        </div>
        <div class="capability-stage-brief__stat">
          <span>任务实例</span>
          <strong>{{ selectedTaskInstance ? `#${selectedTaskInstance.id}` : '未选择实例' }}</strong>
        </div>
        <div class="capability-stage-brief__stat">
          <span>当前状态</span>
          <strong>{{ executionStateLabel }}</strong>
        </div>
        <div class="capability-stage-brief__stat">
          <span>结果时间</span>
          <strong>{{ formattedGeneratedAt }}</strong>
        </div>
        <div class="capability-stage-brief__stat">
          <span>完成步骤</span>
          <strong>{{ executionSummary.completedSteps }}</strong>
        </div>
        <div class="capability-stage-brief__stat">
          <span>已实现步骤</span>
          <strong>{{ executionSummary.implementedSteps }}</strong>
        </div>
      </div>
    </div>
  </article>

  <router-view />
</template>
