<script setup>
import { computed } from 'vue';
import CalculationSharedTaskPanel from './CalculationSharedTaskPanel.vue';
import PageBrand from './PageBrand.vue';

const props = defineProps({
  moduleKey: {
    type: String,
    required: true,
  },
  modulePathLabel: {
    type: String,
    required: true,
  },
  moduleTitle: {
    type: String,
    required: true,
  },
  moduleDescription: {
    type: String,
    default: '',
  },
  taskModule: {
    type: String,
    required: true,
  },
  usageHint: {
    type: String,
    default: '',
  },
  moduleTabs: {
    type: Array,
    default: () => [],
  },
  summaryItems: {
    type: Array,
    default: () => [],
  },
  statusLines: {
    type: Array,
    default: () => [],
  },
  errorMessage: {
    type: String,
    default: '',
  },
  currentUser: {
    type: Object,
    default: () => ({ username: '', role: 'user' }),
  },
  railTitle: {
    type: String,
    default: '',
  },
  railDescription: {
    type: String,
    default: '',
  },
  railStats: {
    type: Array,
    default: () => [],
  },
  stepItems: {
    type: Array,
    default: () => [],
  },
  currentStep: {
    type: Object,
    default: () => null,
  },
  previousStep: {
    type: Object,
    default: null,
  },
  nextStep: {
    type: Object,
    default: null,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  loadingText: {
    type: String,
    default: '正在加载模块配置...',
  },
});

const emit = defineEmits([
  'go-home',
  'logout',
  'navigate-module',
  'navigate-step',
]);

const resolvedStatusLines = computed(() => props.statusLines.filter((item) => String(item || '').trim()));
const currentStepDescription = computed(() => props.currentStep?.description || '');
const currentStepStatus = computed(() => props.currentStep?.statusLabel || '');

function handleModuleNavigate(tab) {
  if (!tab?.routeName || tab.active) {
    return;
  }
  emit('navigate-module', tab.routeName);
}

function handleStepNavigate(step) {
  if (!step?.name || step.available === false) {
    return;
  }
  emit('navigate-step', step);
}
</script>

<template>
  <div class="page-shell calculation-module-shell" :class="`calculation-module-shell--${moduleKey}`">
    <header class="glass-card calculation-module-hero">
      <div class="calculation-module-hero__command">
        <div class="calculation-module-hero__intro">
          <div class="calculation-module-hero__nav">
            <button class="back-link calculation-module-hero__back" @click="emit('go-home')">返回首页</button>
            <span class="eyebrow">{{ modulePathLabel }}</span>
          </div>

          <div class="calculation-module-hero__copy">
            <span class="pill pill-muted">能力计算模块框架</span>
            <h1>{{ moduleTitle }}</h1>
            <p>{{ moduleDescription }}</p>
          </div>
        </div>

        <div class="calculation-module-hero__summary" v-if="summaryItems.length">
          <article
            v-for="item in summaryItems"
            :key="item.label"
            class="calculation-module-hero__summary-card"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <small v-if="item.meta">{{ item.meta }}</small>
          </article>
        </div>

        <div class="calculation-module-hero__session">
          <PageBrand compact />
          <div class="calculation-module-hero__account">
            <span>当前账号</span>
            <strong>{{ currentUser.username }}</strong>
            <small>{{ currentUser.role === 'admin' ? '管理员' : '用户' }}</small>
            <button class="back-link calculation-module-hero__logout" @click="emit('logout')">退出登录</button>
          </div>
        </div>
      </div>

      <div class="calculation-module-hero__footer">
        <div class="segmented-row segmented-row--compact calculation-module-switcher">
          <button
            v-for="tab in moduleTabs"
            :key="tab.key"
            class="segmented"
            :class="{ active: tab.active }"
            :disabled="tab.active"
            @click="handleModuleNavigate(tab)"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="calculation-module-hero__status">
          <p v-for="line in resolvedStatusLines" :key="line" class="muted-text">{{ line }}</p>
          <p v-if="errorMessage" class="muted-text module-topbar__error">{{ errorMessage }}</p>
        </div>
      </div>
    </header>

    <section class="panel-section">
      <CalculationSharedTaskPanel :task-module="taskModule" :usage-hint="usageHint" />
    </section>

    <section class="panel-section">
      <div class="calculation-module-layout">
        <aside class="glass-card calculation-module-rail">
          <div class="calculation-module-rail__hero">
            <span class="eyebrow">流程轨道</span>
            <h2>{{ railTitle }}</h2>
            <p>{{ railDescription }}</p>
          </div>

          <nav class="calculation-module-rail__steps">
            <button
              v-for="step in stepItems"
              :key="step.key"
              class="calculation-module-step"
              :class="{
                'is-active': currentStep?.name === step.name,
                'is-complete': step.isComplete,
                'is-locked': step.available === false,
              }"
              :disabled="step.available === false"
              @click="handleStepNavigate(step)"
            >
              <span class="calculation-module-step__index">{{ step.short }}</span>
              <span class="calculation-module-step__body">
                <small v-if="step.statusLabel">{{ step.statusLabel }}</small>
                <strong>{{ step.title }}</strong>
                <span>{{ step.description }}</span>
              </span>
            </button>
          </nav>

          <div v-if="railStats.length" class="calculation-module-rail__stats">
            <article v-for="item in railStats" :key="item.label" class="calculation-module-rail__stat">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <small v-if="item.meta">{{ item.meta }}</small>
            </article>
          </div>
        </aside>

        <main class="calculation-module-stage">
          <div class="glass-card capability-step-shell calculation-module-stage-shell">
            <div class="capability-step-shell__head calculation-module-stage-shell__head">
              <div class="calculation-module-stage-shell__copy">
                <span class="eyebrow">当前步骤 {{ currentStep?.short }}</span>
                <h2>{{ currentStep?.title }}</h2>
                <p v-if="currentStepDescription">{{ currentStepDescription }}</p>
              </div>

              <div class="calculation-module-stage-shell__actions">
                <span v-if="currentStepStatus" class="pill pill-muted calculation-module-stage-shell__pill">{{ currentStepStatus }}</span>
                <button class="button button-ghost" :disabled="!previousStep" @click="handleStepNavigate(previousStep)">上一步</button>
                <button class="button" :disabled="!nextStep || nextStep.available === false" @click="handleStepNavigate(nextStep)">下一步</button>
              </div>
            </div>

            <div v-if="loading" class="detail-card compact-empty-state">
              <p class="muted-text">{{ loadingText }}</p>
            </div>

            <slot v-else />
          </div>
        </main>
      </div>
    </section>
  </div>
</template>
