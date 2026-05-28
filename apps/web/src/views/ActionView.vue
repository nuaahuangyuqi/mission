<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CalculationModuleFrame from '../components/CalculationModuleFrame.vue';
import { logout } from '../auth';
import { useCalculationSharedTask } from '../modules/calculationSharedTask';
import { useActionWorkflow } from '../modules/actionWorkflow';

const router = useRouter();
const route = useRoute();
const { loadRemoteTask } = useCalculationSharedTask();
const {
  state,
  currentUser,
  missionTask,
  missionTypeMeta,
  workflowSummary,
  initializeActionWorkflow,
} = useActionWorkflow();

const baseStepItems = [
  {
    key: 'task',
    name: 'action-task',
    short: '01',
    title: '共同任务生成功能链',
    description: '根据共同任务自动生成固定作战功能链。',
  },
  {
    key: 'model',
    name: 'action-model',
    short: '02',
    title: '配置方案建模参数',
    description: '围绕功能链配置资源、环境与节点参数。',
  },
  {
    key: 'results',
    name: 'action-results',
    short: '03',
    title: '生成预测与推荐结果',
    description: '输出时间、路径、风险和资源代价。',
  },
];

const currentStepIndex = computed(() => {
  const index = baseStepItems.findIndex((item) => item.name === route.name);
  return index >= 0 ? index : 0;
});

function resolveStepStatus(index) {
  if (index < currentStepIndex.value) return '已完成';
  if (index === currentStepIndex.value) return '进行中';
  return '下一步';
}

const stepItems = computed(() => baseStepItems.map((step, index) => ({
  ...step,
  available: true,
  isComplete: index < currentStepIndex.value,
  statusLabel: resolveStepStatus(index),
})));

const currentStep = computed(() => stepItems.value[currentStepIndex.value] || stepItems.value[0]);
const previousStep = computed(() => stepItems.value[currentStepIndex.value - 1] || null);
const nextStep = computed(() => stepItems.value[currentStepIndex.value + 1] || null);

const moduleTabs = computed(() => ([
  { key: 'capability', label: '能力评估', routeName: 'capability-library', active: false },
  { key: 'action', label: '行动计算', routeName: 'action-task', active: true },
  { key: 'consumption', label: '消耗计算', routeName: 'consumption-scenario', active: false },
]));

const summaryItems = computed(() => ([
  {
    label: '当前阶段',
    value: currentStep.value?.title || '--',
    meta: `步骤 ${currentStep.value?.short || '--'}`,
  },
  {
    label: '共同任务',
    value: missionTask.value.name || '未命名任务',
    meta: '由全局上下文统一驱动',
  },
  {
    label: '作战类型',
    value: missionTypeMeta.value?.label || '--',
    meta: `节点 ${workflowSummary.value.nodeCount || 0} / 链路 ${workflowSummary.value.linkCount || 0}`,
  },
]));

const statusLines = computed(() => {
  if (state.calculating) {
    return ['正在执行行动计算...'];
  }
  if (!state.results) {
    return ['当前还未生成行动评估结果。'];
  }
  if (state.resultsDirty) {
    return ['共同任务或方案参数已变化，请重新生成结果。'];
  }
  return [`当前功能链共 ${workflowSummary.value.nodeCount || 0} 个节点，推荐结果可直接进入对比阅读。`];
});

const railDescription = computed(() => `功能链会根据“${missionTypeMeta.value?.label || '当前任务类型'}”自动生成，后续只需围绕节点参数推进建模与预测。`);
const railStats = computed(() => ([
  {
    label: '功能节点',
    value: workflowSummary.value.nodeCount || 0,
    meta: `链路 ${workflowSummary.value.linkCount || 0}`,
  },
  {
    label: '方案数量',
    value: workflowSummary.value.schemeCount || 0,
    meta: `初始输入 ${workflowSummary.value.initialInputCount || 0}`,
  },
  {
    label: '资源类别',
    value: workflowSummary.value.resourceCount || 0,
    meta: '资源、环境与路径参数统一建模',
  },
]));

const isLoading = computed(() => state.loading && !state.template);

function resolveRouteTaskId(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const taskId = Number(rawValue);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}

async function syncRouteTask(taskIdValue) {
  const taskId = resolveRouteTaskId(taskIdValue);
  if (!taskId) {
    return;
  }

  await loadRemoteTask(taskId, {
    allowAnyModule: true,
    closeTaskList: true,
  });
}

function navigateToStep(step) {
  if (!step) {
    return;
  }
  router.push({ name: step.name });
}

function navigateToModule(name) {
  router.push({ name });
}

async function handleLogout() {
  await logout();
  router.replace('/login');
}

onMounted(async () => {
  await initializeActionWorkflow();
  await syncRouteTask(route.query.taskId);
});

watch(() => route.query.taskId, async (taskIdValue) => {
  if (!state.initialized) {
    return;
  }

  await syncRouteTask(taskIdValue);
});
</script>

<template>
  <CalculationModuleFrame
    module-key="action"
    module-path-label="模块 / 能力计算模块 / 行动计算"
    module-title="行动计算"
    module-description="共同任务自动驱动作战功能链，围绕节点资源、环境系数与路径代价生成预测结果。"
    task-module="action"
    usage-hint="行动计算不会单独维护任务背景，当前模块直接读取这里的任务类型、目标和敌我装备基线来生成功能链。"
    :module-tabs="moduleTabs"
    :summary-items="summaryItems"
    :status-lines="statusLines"
    :error-message="state.errorMessage"
    :current-user="currentUser"
    :rail-title="state.assessmentName"
    :rail-description="railDescription"
    :rail-stats="railStats"
    :step-items="stepItems"
    :current-step="currentStep"
    :previous-step="previousStep"
    :next-step="nextStep"
    :loading="isLoading"
    loading-text="正在加载行动计算模板..."
    @go-home="router.push('/')"
    @logout="handleLogout"
    @navigate-module="navigateToModule"
    @navigate-step="navigateToStep"
  >
    <router-view />
  </CalculationModuleFrame>
</template>
