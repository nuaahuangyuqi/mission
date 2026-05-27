<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlanningWorkflow } from '../../modules/planningWorkflow';

const router = useRouter();
const route = useRoute();
const {
  state,
  selectedTask,
  selectedTaskInstance,
  workflowSummary,
} = usePlanningWorkflow();

const taskSubPages = [
  {
    key: 'library',
    name: 'planning-tasks-library',
    short: '01',
    title: '任务模板',
  },
  {
    key: 'flow',
    name: 'planning-tasks-flow',
    short: '02',
    title: '流程编排',
  },
  {
    key: 'execute',
    name: 'planning-tasks-execute',
    short: '03',
    title: '任务执行',
  },
];

const activeSubPage = computed(() => {
  if (route.name === 'planning-tasks-execute-step') {
    return taskSubPages.find((item) => item.key === 'execute') || taskSubPages[0];
  }
  return taskSubPages.find((item) => item.name === route.name) || taskSubPages[0];
});
const activeSubPageIndex = computed(() => taskSubPages.findIndex((item) => item.name === activeSubPage.value.name));

function isPageLocked(page) {
  return !selectedTaskInstance.value && page.key !== 'library';
}

function navigateSubPage(page) {
  if (!page || isPageLocked(page)) return;
  router.push({ name: page.name });
}
</script>

<template>
  <section class="capability-stage action-stage">
    <article class="capability-stage-card">
      <div class="segmented-row planning-task-subnav">
        <button
          v-for="page in taskSubPages"
          :key="page.key"
          class="segmented"
          :class="{ active: activeSubPage.name === page.name }"
          :disabled="isPageLocked(page)"
          @click="navigateSubPage(page)"
        >
          {{ page.short }} {{ page.title }}
        </button>
      </div>

      <div class="capability-stage-pill-row top-gap">
        <span class="pill pill-active">{{ activeSubPage.title }}</span>
        <span class="pill pill-muted">阶段 {{ activeSubPageIndex + 1 }} / {{ taskSubPages.length }}</span>
        <span class="pill pill-muted">{{ selectedTaskInstance ? `实例 #${selectedTaskInstance.id}` : '未选择任务实例' }}</span>
        <span class="pill pill-muted">模板 {{ workflowSummary.taskCount }}</span>
        <span class="pill pill-muted">实例 {{ workflowSummary.taskInstanceCount }}</span>
        <span class="pill pill-muted">步骤 {{ workflowSummary.stepCount }}</span>
        <span class="pill pill-muted">{{ state.results ? (state.resultsDirty ? '结果待刷新' : '已有结果') : '未执行' }}</span>
      </div>
    </article>

    <router-view />
  </section>
</template>
