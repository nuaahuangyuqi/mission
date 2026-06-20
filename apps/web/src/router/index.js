import { createRouter, createWebHistory } from 'vue-router';
import { authState, restoreSession } from '../auth';

const DYNAMIC_IMPORT_RELOAD_KEY = 'mission-router-dynamic-import-reload';
const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'auth', component: () => import('../views/AuthView.vue'), meta: { guestOnly: true } },
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { requiresAuth: true } },
    { path: '/capability', redirect: { name: 'capability-library' } },
    {
      path: '/capability/evaluation',
      component: () => import('../views/CapabilityView.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'capability-library' } },
        { path: 'library', name: 'capability-library', component: () => import('../views/capability/CapabilityLibraryStep.vue'), meta: { requiresAuth: true } },
        { path: 'framework', name: 'capability-framework', redirect: { name: 'capability-tree' }, meta: { requiresAuth: true } },
        { path: 'tree', name: 'capability-tree', component: () => import('../views/capability/CapabilityTreeStep.vue'), meta: { requiresAuth: true } },
        { path: 'input', name: 'capability-input', redirect: { name: 'capability-tree' }, meta: { requiresAuth: true } },
        { path: 'results', name: 'capability-results', component: () => import('../views/capability/CapabilityResultsStep.vue'), meta: { requiresAuth: true } },
      ],
    },
    {
      path: '/capability/action',
      component: () => import('../views/ActionView.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'action-task' } },
        { path: 'task', name: 'action-task', component: () => import('../views/action/ActionTaskStep.vue'), meta: { requiresAuth: true } },
        { path: 'validation', name: 'action-validation', redirect: { name: 'action-model' }, meta: { requiresAuth: true } },
        { path: 'model', name: 'action-model', component: () => import('../views/action/ActionModelStep.vue'), meta: { requiresAuth: true } },
        { path: 'results', name: 'action-results', component: () => import('../views/action/ActionResultsStep.vue'), meta: { requiresAuth: true } },
      ],
    },
    {
      path: '/capability/consumption',
      component: () => import('../views/ConsumptionView.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'consumption-scenario' } },
        { path: 'scenario', name: 'consumption-scenario', component: () => import('../views/consumption/ConsumptionScenarioStep.vue'), meta: { requiresAuth: true } },
        { path: 'equipment', name: 'consumption-equipment', component: () => import('../views/consumption/ConsumptionEquipmentStep.vue'), meta: { requiresAuth: true } },
        { path: 'mission', name: 'consumption-mission', component: () => import('../views/consumption/ConsumptionMissionStep.vue'), meta: { requiresAuth: true } },
        { path: 'results', name: 'consumption-results', component: () => import('../views/consumption/ConsumptionResultsStep.vue'), meta: { requiresAuth: true } },
      ],
    },
    {
      path: '/planning',
      component: () => import('../views/PlanningView.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'planning-algorithms' } },
        { path: 'algorithms', name: 'planning-algorithms', component: () => import('../views/planning/PlanningAlgorithmsStep.vue'), meta: { requiresAuth: true } },
        { path: 'step-execution', name: 'planning-step-execution', component: () => import('../views/planning/PlanningStepExecutionStep.vue'), meta: { requiresAuth: true } },
        {
          path: 'tasks',
          component: () => import('../views/planning/PlanningTasksStep.vue'),
          meta: { requiresAuth: true },
          children: [
            { path: '', redirect: { name: 'planning-tasks-library' } },
            { path: 'library', name: 'planning-tasks-library', component: () => import('../views/planning/PlanningTaskLibraryStep.vue'), meta: { requiresAuth: true } },
            { path: 'flow', name: 'planning-tasks-flow', component: () => import('../views/planning/PlanningTaskFlowStep.vue'), meta: { requiresAuth: true } },
            {
              path: 'execute',
              component: () => import('../views/planning/PlanningTaskExecuteStep.vue'),
              meta: { requiresAuth: true },
              children: [
                {
                  path: '',
                  name: 'planning-tasks-execute',
                  component: () => import('../views/planning/PlanningTaskExecutionOverview.vue'),
                  meta: { requiresAuth: true },
                },
                {
                  path: 'step/:stepId',
                  name: 'planning-tasks-execute-step',
                  component: () => import('../views/planning/PlanningTaskExecutionResultStep.vue'),
                  props: true,
                  meta: { requiresAuth: true },
                },
              ],
            },
          ],
        },
        { path: 'results', redirect: { name: 'planning-tasks-execute' } },
      ],
    },
    {
      path: '/tasks',
      name: 'task-center-list',
      component: () => import('../views/tasks/TaskCenterListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tasks/:id',
      name: 'task-center-detail',
      component: () => import('../views/tasks/TaskCenterDetailView.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/capability/library', redirect: { name: 'capability-library' } },
    { path: '/capability/framework', redirect: { name: 'capability-tree' } },
    { path: '/capability/tree', redirect: { name: 'capability-tree' } },
    { path: '/capability/input', redirect: { name: 'capability-tree' } },
    { path: '/capability/results', redirect: { name: 'capability-results' } },
    { path: '/action', redirect: { name: 'action-task' } },
    { path: '/action/task', redirect: { name: 'action-task' } },
    { path: '/action/validation', redirect: { name: 'action-model' } },
    { path: '/action/model', redirect: { name: 'action-model' } },
    { path: '/action/results', redirect: { name: 'action-results' } },
    { path: '/consumption', redirect: { name: 'consumption-scenario' } },
    { path: '/consumption/scenario', redirect: { name: 'consumption-scenario' } },
    { path: '/consumption/equipment', redirect: { name: 'consumption-equipment' } },
    { path: '/consumption/mission', redirect: { name: 'consumption-mission' } },
    { path: '/consumption/results', redirect: { name: 'consumption-results' } },
    { path: '/data-service', name: 'data-service', component: () => import('../views/DataServiceView.vue'), meta: { requiresAuth: true } },
  ],
});

router.beforeEach(async (to) => {
  if (!authState.ready) {
    await restoreSession();
  }

  if (to.meta.requiresAuth && !authState.user) {
    return {
      name: 'auth',
      query: { redirect: to.fullPath },
    };
  }

  if (to.meta.guestOnly && authState.user) {
    return { name: 'home' };
  }

  return true;
});

router.afterEach(() => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_KEY);
});

router.onError((error, to) => {
  if (typeof window === 'undefined') return;
  const message = String(error?.message || error || '');
  const isDynamicImportError = DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
  if (!isDynamicImportError || !to?.fullPath) return;

  const lastReloadTarget = window.sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY);
  if (lastReloadTarget === to.fullPath) {
    window.sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_KEY);
    return;
  }

  window.sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, to.fullPath);
  window.location.assign(to.fullPath);
});

export default router;
