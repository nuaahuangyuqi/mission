<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageBrand from '../components/PageBrand.vue';
import { logout } from '../auth';
import { usePlanningWorkflow } from '../modules/planningWorkflow';

const router = useRouter();
const route = useRoute();
const {
  state,
  currentUser,
  selectedTask,
  selectedTaskInstance,
  workflowSummary,
  initializePlanningWorkflow,
  selectTaskInstance,
} = usePlanningWorkflow();

const moduleItems = [
  {
    key: 'algorithms',
    name: 'planning-algorithms',
    routeNames: ['planning-algorithms'],
    short: 'ALG',
    title: '规划算法库',
  },
  {
    key: 'tasks',
    name: 'planning-tasks-library',
    routeNames: ['planning-tasks-library', 'planning-tasks-flow', 'planning-tasks-execute', 'planning-tasks-execute-step'],
    short: 'TASK',
    title: '作战任务库',
  },
  {
    key: 'step-execution',
    name: 'planning-step-execution',
    routeNames: ['planning-step-execution'],
    short: 'STEP',
    title: '分步执行',
  },
];

const taskStageMap = {
  'planning-tasks-library': { short: '01', title: '任务模板' },
  'planning-tasks-flow': { short: '02', title: '流程编排' },
  'planning-tasks-execute': { short: '03', title: '任务执行' },
  'planning-tasks-execute-step': { short: '03', title: '任务执行' },
};

const currentModuleIndex = computed(() => {
  const routeName = String(route.name || '');
  const index = moduleItems.findIndex((item) => item.routeNames.includes(routeName));
  return index >= 0 ? index : 0;
});
const currentModule = computed(() => moduleItems[currentModuleIndex.value] || moduleItems[0]);
const currentTaskStage = computed(() => taskStageMap[String(route.name || '')] || null);
const currentViewTitle = computed(() => (
  currentTaskStage.value ? `${currentModule.value.title} / ${currentTaskStage.value.title}` : currentModule.value.title
));
const currentViewEyebrow = computed(() => (
  currentTaskStage.value ? `阶段 ${currentTaskStage.value.short}` : '模块'
));
function navigateToModule(module) {
  if (!module) return;
  router.push({ name: module.name });
}

function resolveRouteTaskId(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const taskId = Number(rawValue);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}

async function syncRouteTaskSelection(taskIdValue) {
  const taskId = resolveRouteTaskId(taskIdValue);
  if (!taskId || Number(selectedTaskInstance.value?.id) === taskId) {
    return;
  }

  try {
    await selectTaskInstance(taskId, { loadLatestRun: true });
  } catch (error) {
    state.errorMessage = error.message || '读取指定规划任务失败。';
  }
}

async function handleLogout() {
  await logout();
  router.replace('/login');
}

onMounted(async () => {
  await initializePlanningWorkflow();
  await syncRouteTaskSelection(route.query.taskId);
});

watch(() => route.query.taskId, async (taskIdValue) => {
  if (!state.initialized) {
    return;
  }

  await syncRouteTaskSelection(taskIdValue);
});
</script>

<template>
  <div class="page-shell capability-flow-shell action-flow-shell">
    <header class="glass-card module-topbar capability-flow-topbar action-flow-topbar">
      <div class="module-topbar__row">
        <div class="module-topbar__intro">
          <div class="module-topbar__nav">
            <button class="back-link module-topbar__back" @click="router.push('/')">返回首页</button>
            <span class="eyebrow">模块 / 智能任务规划模块</span>
          </div>
          <div class="module-topbar__title">
            <h1>智能任务规划模块</h1>
          </div>
        </div>

        <div class="module-topbar__stats">
          <div class="module-topbar__stat">
            <span>当前模块</span>
            <strong>{{ currentModule.title }}</strong>
          </div>
          <div class="module-topbar__stat">
            <span>当前任务</span>
            <strong>{{ selectedTask?.name || '--' }}</strong>
          </div>
          <div class="module-topbar__stat">
            <span>任务阶段</span>
            <strong>{{ currentTaskStage ? `${currentTaskStage.short} ${currentTaskStage.title}` : '--' }}</strong>
          </div>
          <div class="module-topbar__stat">
            <span>算法数量</span>
            <strong>{{ workflowSummary.algorithmCount }}</strong>
          </div>
        </div>

        <div class="module-topbar__side">
          <PageBrand compact />
          <div class="module-topbar__session">
            <span>当前账号</span>
            <strong>{{ currentUser.username }}</strong>
            <small>{{ currentUser.role === 'admin' ? '管理员' : '用户' }}</small>
            <button class="back-link module-topbar__logout" @click="handleLogout">退出登录</button>
          </div>
        </div>
      </div>

      <div class="module-topbar__bottom">
        <div class="segmented-row segmented-row--compact">
          <button
            v-for="item in moduleItems"
            :key="item.key"
            class="segmented"
            :class="{ active: currentModule.key === item.key }"
            @click="navigateToModule(item)"
          >
            {{ item.title }}
          </button>
        </div>
        <div class="module-topbar__status">
          <p v-if="state.calculating" class="muted-text">正在执行智能任务规划...</p>
          <p v-else-if="!state.results" class="muted-text">尚未生成任务规划结果。</p>
          <p v-else-if="state.resultsDirty" class="muted-text">参数已变更，请重新生成规划结果。</p>
          <p v-if="state.errorMessage" class="muted-text module-topbar__error">{{ state.errorMessage }}</p>
        </div>
      </div>
    </header>

    <section class="panel-section">
      <div class="capability-flow-layout">
        <aside class="glass-card capability-flow-sidebar action-flow-sidebar">
          <div class="capability-flow-sidebar__hero">
            <span class="eyebrow">Planning</span>
            <h2>{{ state.assessmentName }}</h2>
          </div>

          <nav class="capability-flow-nav">
            <button
              v-for="module in moduleItems"
              :key="module.key"
              class="capability-flow-step"
              :class="{ active: currentModule.key === module.key }"
              @click="navigateToModule(module)"
            >
              <span class="capability-flow-step__index">{{ module.short }}</span>
              <span class="capability-flow-step__body">
                <strong>{{ module.title }}</strong>
              </span>
            </button>
          </nav>

          <div class="capability-flow-sidebar__meta">
            <div class="capability-flow-sidebar__stat">
              <span>规划算法</span>
              <strong>{{ workflowSummary.algorithmCount }}</strong>
            </div>
            <div class="capability-flow-sidebar__stat">
              <span>任务模板</span>
              <strong>{{ workflowSummary.taskCount }}</strong>
            </div>
            <div class="capability-flow-sidebar__stat">
              <span>流程步骤</span>
              <strong>{{ workflowSummary.stepCount }}</strong>
            </div>
            <div class="capability-flow-sidebar__stat">
              <span>外部扩展位</span>
              <strong>{{ workflowSummary.externalVariantCount }}</strong>
            </div>
          </div>
        </aside>

        <main class="capability-flow-main">
          <div class="glass-card capability-step-shell action-step-shell">
            <div class="capability-step-shell__head">
              <div>
                <span class="eyebrow">{{ currentViewEyebrow }}</span>
                <h2>{{ currentViewTitle }}</h2>
              </div>

              <div class="capability-step-shell__actions">
                <span class="pill pill-active">{{ currentModule.title }}</span>
                <span v-if="currentTaskStage" class="pill pill-muted">{{ currentTaskStage.title }}</span>
              </div>
            </div>

            <div v-if="state.loading && !state.template" class="detail-card compact-empty-state">
              <p class="muted-text">正在加载智能任务规划模板...</p>
            </div>

            <router-view v-else />
          </div>
        </main>
      </div>
    </section>
  </div>
</template>
