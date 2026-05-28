<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CalculationModuleFrame from '../components/CalculationModuleFrame.vue';
import { logout } from '../auth';
import { useCalculationSharedTask } from '../modules/calculationSharedTask';
import { useConsumptionWorkflow } from '../modules/consumptionWorkflow';

const router = useRouter();
const route = useRoute();
const { loadRemoteTask } = useCalculationSharedTask();
const {
  state,
  currentUser,
  missionTask,
  missionTypeMeta,
  workflowSummary,
  initializeConsumptionWorkflow,
} = useConsumptionWorkflow();

const baseStepItems = [
  {
    key: 'scenario',
    name: 'consumption-scenario',
    short: '01',
    title: '同步共同任务基线',
    description: '根据共同任务生成消耗评估的初始方案与敌情强度。',
  },
  {
    key: 'equipment',
    name: 'consumption-equipment',
    short: '02',
    title: '录入装备自然损耗参数',
    description: '维护装备数量、年限、维护水平与使用频率。',
  },
  {
    key: 'mission',
    name: 'consumption-mission',
    short: '03',
    title: '配置任务战损参数',
    description: '配置火力强度、打击方式和人员保障参数。',
  },
  {
    key: 'results',
    name: 'consumption-results',
    short: '04',
    title: '生成消耗预测结果',
    description: '输出损耗、伤亡、弹药和油料预测结果。',
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
  { key: 'action', label: '行动计算', routeName: 'action-task', active: false },
  { key: 'consumption', label: '消耗计算', routeName: 'consumption-scenario', active: true },
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
    meta: '兵力和敌情会直接同步到消耗方案',
  },
  {
    label: '作战类型',
    value: missionTypeMeta.value?.label || '--',
    meta: `方案 ${workflowSummary.value.schemeCount || 0} 套`,
  },
]));

const statusLines = computed(() => {
  if (state.calculating) {
    return ['正在执行消耗计算...'];
  }
  if (!state.results) {
    return ['当前还未生成消耗预测结果。'];
  }
  if (state.resultsDirty) {
    return ['共同任务或损耗参数已变化，请重新生成结果。'];
  }
  return [`当前共有 ${workflowSummary.value.schemeCount || 0} 套方案，可直接进入预测结果阅读。`];
});

const railDescription = computed(() => `消耗模块会把共同任务中的我方投入、敌情火力和任务类型回写到方案基线，再继续细化自然损耗与战损参数。`);
const railStats = computed(() => ([
  {
    label: '装备类别',
    value: workflowSummary.value.equipmentTypeCount || 0,
    meta: `阶段 ${workflowSummary.value.phaseCount || 0}`,
  },
  {
    label: '方案数量',
    value: workflowSummary.value.schemeCount || 0,
    meta: '按共同任务同步生成基线',
  },
  {
    label: '预测模型',
    value: workflowSummary.value.modelCount || 0,
    meta: '自然损耗、战损与结果预测联动',
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
  await initializeConsumptionWorkflow();
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
    module-key="consumption"
    module-path-label="模块 / 能力计算模块 / 消耗计算"
    module-title="消耗计算"
    module-description="共同任务先提供兵力与敌情基线，再进入装备自然损耗、战损参数和最终消耗预测。"
    task-module="consumption"
    usage-hint="这里的敌我装备和任务类型会直接改写消耗方案基线。调整全局上下文后，再进入自然损耗和战损配置才有意义。"
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
    loading-text="正在加载消耗计算模板..."
    @go-home="router.push('/')"
    @logout="handleLogout"
    @navigate-module="navigateToModule"
    @navigate-step="navigateToStep"
  >
    <router-view />
  </CalculationModuleFrame>
</template>
