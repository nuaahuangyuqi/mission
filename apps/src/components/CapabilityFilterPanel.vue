<script setup>
import { computed } from 'vue';

const props = defineProps({
  title: {
    type: String,
    default: '指标块定位',
  },
  description: {
    type: String,
    default: '',
  },
  scopeHint: {
    type: String,
    default: '仅作用于当前步骤',
  },
  coreOptions: {
    type: Array,
    default: () => [],
  },
  activeCoreId: {
    type: String,
    default: '',
  },
  secondaryOptions: {
    type: Array,
    default: () => [],
  },
  activeSecondaryId: {
    type: String,
    default: '',
  },
  allowSecondaryAll: {
    type: Boolean,
    default: true,
  },
  secondaryAllLabel: {
    type: String,
    default: '查看当前一级块下全部二级能力块',
  },
});

const emit = defineEmits(['update:activeCoreId', 'update:activeSecondaryId']);

const activeCore = computed(() => props.coreOptions.find((item) => item.id === props.activeCoreId) || null);
const activeSecondary = computed(() => props.secondaryOptions.find((item) => item.id === props.activeSecondaryId) || null);
const focusStepLabel = computed(() => {
  if (!activeCore.value) {
    return '先选择一级能力块';
  }

  if (activeSecondary.value) {
    return '已聚焦到一个二级能力块';
  }

  return props.allowSecondaryAll ? '当前正在查看整个一级能力块' : '请继续选择二级能力块';
});
const summaryText = computed(() => {
  if (!activeCore.value) {
    return '请先选择一级能力块';
  }

  if (activeSecondary.value) {
    return `${activeCore.value.name} / ${activeSecondary.value.name}`;
  }

  return `${activeCore.value.name} / 全部二级能力块`;
});

function selectCore(coreId) {
  if (props.activeCoreId === coreId) {
    return;
  }

  emit('update:activeCoreId', coreId);
  emit('update:activeSecondaryId', '');
}

function selectSecondary(secondaryId) {
  if (props.activeSecondaryId === secondaryId && props.allowSecondaryAll) {
    emit('update:activeSecondaryId', '');
    return;
  }

  emit('update:activeSecondaryId', secondaryId);
}

function resetSecondary() {
  emit('update:activeSecondaryId', '');
}
</script>

<template>
  <article class="capability-filter-panel">
    <div class="capability-filter-panel__header">
      <div class="capability-filter-panel__copy">
        <span class="eyebrow">{{ scopeHint }}</span>
        <h3>{{ title }}</h3>
        <p v-if="description">{{ description }}</p>
      </div>

      <div class="capability-filter-panel__summary">
        <span>当前定位</span>
        <strong>{{ summaryText }}</strong>
        <small>{{ focusStepLabel }}</small>
      </div>
    </div>

    <div class="capability-filter-panel__progress">
      <span class="capability-filter-panel__step" :class="{ active: Boolean(activeCore) }">1. 一级能力块</span>
      <span
        class="capability-filter-panel__step capability-filter-panel__step--secondary"
        :class="{ active: Boolean(activeSecondary) || (!allowSecondaryAll && secondaryOptions.length > 0) }"
      >
        2. 二级能力块
      </span>
      <span class="pill pill-muted">{{ coreOptions.length }} 个一级块</span>
      <span v-if="activeCore" class="pill pill-muted">{{ secondaryOptions.length }} 个二级块</span>
    </div>

    <div class="capability-filter-panel__selectors">
      <div v-if="coreOptions.length" class="capability-filter-panel__group">
        <div class="capability-filter-panel__group-head">
          <span class="capability-filter-panel__label">先选一级能力块</span>
          <small>{{ activeCore ? activeCore.name : '未选择' }}</small>
        </div>

        <div class="capability-filter-panel__chips">
          <button
            v-for="core in coreOptions"
            :key="core.id"
            class="button button-ghost capability-filter-chip"
            :class="{ active: activeCoreId === core.id }"
            @click="selectCore(core.id)"
          >
            <strong>{{ core.code || core.id }}</strong>
            <small>{{ core.name }}</small>
          </button>
        </div>
      </div>

      <div v-if="activeCore && secondaryOptions.length" class="capability-filter-panel__group">
        <div class="capability-filter-panel__group-head">
          <span class="capability-filter-panel__label">再选二级能力块</span>
          <small>{{ activeSecondary ? activeSecondary.name : (allowSecondaryAll ? secondaryAllLabel : '请选择') }}</small>
        </div>

        <div class="capability-filter-panel__chips capability-filter-panel__chips--secondary">
          <button
            v-if="allowSecondaryAll"
            class="button button-ghost capability-filter-chip capability-filter-chip--secondary"
            :class="{ active: !activeSecondaryId }"
            @click="resetSecondary"
          >
            <strong>全部</strong>
            <small>{{ activeCore.name }}</small>
          </button>

          <button
            v-for="secondary in secondaryOptions"
            :key="secondary.id"
            class="button button-ghost capability-filter-chip capability-filter-chip--secondary"
            :class="{ active: activeSecondaryId === secondary.id }"
            @click="selectSecondary(secondary.id)"
          >
            <strong>{{ secondary.code || secondary.id }}</strong>
            <small>{{ secondary.name }}</small>
          </button>
        </div>

        <button
          v-if="allowSecondaryAll"
          class="button button-ghost capability-filter-panel__reset"
          :disabled="!activeSecondaryId"
          @click="resetSecondary"
        >
          {{ secondaryAllLabel }}
        </button>
      </div>
    </div>
  </article>
</template>
