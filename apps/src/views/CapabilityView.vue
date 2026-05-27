<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CalculationModuleFrame from '../components/CalculationModuleFrame.vue';
import { logout } from '../auth';
import { useCalculationSharedTask } from '../modules/calculationSharedTask';
import { useCapabilityWorkflow } from '../modules/capabilityWorkflow';

const router = useRouter();
const route = useRoute();
const { loadRemoteTask } = useCalculationSharedTask();
const {
  state,
  currentUser,
  activeTask,
  hasLeafIndicators,
  workflowSummary,
  initializeCapabilityWorkflow,
} = useCapabilityWorkflow();

const baseStepItems = [
  {
    key: 'library',
    name: 'capability-library',
    short: '01',
    title: '指标库管理',
    description: '维护一级、二级、三级指标定义与层级关系。',
  },
  {
    key: 'tree',
    name: 'capability-tree',
    short: '02',
    title: '构建指标树并录入',
    description: '从指标库构建当前任务树，并录入权重与三级指标值。',
  },
  {
    key: 'results',
    name: 'capability-results',
    short: '03',
    title: '生成评估结果',
    description: '选择算法生成排序、分项得分与可视化结果。',
  },
];

const currentStepIndex = computed(() => {
  const index = baseStepItems.findIndex((item) => item.name === route.name);
  return index >= 0 ? index : 0;
});

const stepAvailability = computed(() => ({
  library: {
    enabled: true,
    reason: baseStepItems[0].description,
  },
  tree: {
    enabled: true,
    reason: baseStepItems[1].description,
  },
  results: {
    enabled: hasLeafIndicators.value,
    reason: hasLeafIndicators.value ? baseStepItems[2].description : '请先完成指标树构建并录入三级指标值。',
  },
}));

function isStepAvailable(step) {
  return step ? (stepAvailability.value[step.key]?.enabled ?? true) : false;
}

function resolveStepStatus(step, index) {
  if (!isStepAvailable(step)) return '待解锁';
  if (index < currentStepIndex.value) return '已完成';
  if (index === currentStepIndex.value) return '进行中';
  return '下一步';
}

const stepItems = computed(() => baseStepItems.map((step, index) => ({
  ...step,
  description: stepAvailability.value[step.key]?.reason || step.description,
  statusLabel: resolveStepStatus(step, index),
  available: isStepAvailable(step),
  isComplete: index < currentStepIndex.value,
})));

const currentStep = computed(() => stepItems.value[currentStepIndex.value] || stepItems.value[0]);
const previousStep = computed(() => stepItems.value[currentStepIndex.value - 1] || null);
const nextStep = computed(() => stepItems.value[currentStepIndex.value + 1] || null);

const moduleTabs = computed(() => ([
  { key: 'capability', label: '能力评估', routeName: 'capability-library', active: true },
  { key: 'action', label: '行动计算', routeName: 'action-task', active: false },
  { key: 'consumption', label: '消耗计算', routeName: 'consumption-scenario', active: false },
]));

const summaryItems = computed(() => ([
  {
    label: '当前阶段',
    value: currentStep.value?.title || '--',
    meta: `步骤 ${currentStep.value?.short || '--'}`,
  },
  {
    label: '当前任务',
    value: activeTask.value?.assessmentName || '未命名任务',
    meta: activeTask.value?.sourceTemplateName || '使用当前指标体系',
  },
  {
    label: '评估对象',
    value: workflowSummary.value.schemeCount || 0,
    meta: `模板库 ${workflowSummary.value.templateCount || 0} 套`,
  },
]));

const statusLines = computed(() => {
  const lines = [];

  if (state.calculating) {
    lines.push('正在执行能力评估计算...');
  } else if (activeTask.value?.resultsDirty) {
    lines.push('指标树或录入参数已变化，请重新生成评估结果。');
  } else if (!activeTask.value?.results) {
    lines.push('当前还未生成评估结果。');
  } else {
    lines.push('评估结果已生成，可切换算法查看排序、得分和图表。');
  }

  if (state.feedbackMessage) {
    lines.push(state.feedbackMessage);
  }

  return lines;
});

const railTitle = computed(() => activeTask.value?.assessmentName || '能力评估任务');
const railDescription = computed(() => `当前指标树包含 ${workflowSummary.value.coreCount || 0} 个一级指标，可直接沿左侧流程推进到结果生成。`);
const railStats = computed(() => ([
  {
    label: '一级指标',
    value: workflowSummary.value.coreCount || 0,
    meta: `二级 ${workflowSummary.value.secondaryCount || 0} / 三级 ${workflowSummary.value.tertiaryCount || 0}`,
  },
  {
    label: '评估对象',
    value: workflowSummary.value.schemeCount || 0,
    meta: `版本 ${workflowSummary.value.versionCount || 0}`,
  },
  {
    label: '模板库',
    value: workflowSummary.value.templateCount || 0,
    meta: '复用指标定义与树结构',
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
  if (!step || step.available === false) {
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
  await initializeCapabilityWorkflow();
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
    module-key="capability"
    module-path-label="模块 / 能力计算模块 / 能力评估"
    module-title="能力评估"
    module-description="围绕共同任务统一维护指标体系、构建树状评估对象，并输出多算法融合结果。"
    task-module="capability"
    usage-hint="这里定义的是三类计算共享的任务背景。变更任务类型、目标或敌我装备后，行动与消耗子模块都会同步读取这份上下文。"
    :module-tabs="moduleTabs"
    :summary-items="summaryItems"
    :status-lines="statusLines"
    :error-message="state.errorMessage"
    :current-user="currentUser"
    :rail-title="railTitle"
    :rail-description="railDescription"
    :rail-stats="railStats"
    :step-items="stepItems"
    :current-step="currentStep"
    :previous-step="previousStep"
    :next-step="nextStep"
    :loading="isLoading"
    loading-text="正在加载能力计算模板..."
    @go-home="router.push('/')"
    @logout="handleLogout"
    @navigate-module="navigateToModule"
    @navigate-step="navigateToStep"
  >
    <router-view />
  </CalculationModuleFrame>
</template>
