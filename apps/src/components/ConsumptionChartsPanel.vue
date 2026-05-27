<script setup>
import * as echarts from 'echarts';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  ranking: {
    type: Array,
    default: () => [],
  },
  schemes: {
    type: Object,
    default: () => ({}),
  },
  selectedSchemeId: {
    type: String,
    default: '',
  },
});

const damageRef = ref(null);
const comparisonRef = ref(null);
const phaseRef = ref(null);

let damageChart = null;
let comparisonChart = null;
let phaseChart = null;

const schemeEntries = computed(() => Object.values(props.schemes || {}));
const schemeResult = computed(() => props.schemes?.[props.selectedSchemeId] || schemeEntries.value[0] || null);
const hasData = computed(() => props.ranking.length > 0 && Boolean(schemeResult.value));

function normalizeSmallBetter(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return 100;
  }
  return Number((((max - value) / (max - min)) * 100).toFixed(2));
}

const comparisonMetrics = computed(() => {
  const ranking = props.ranking || [];
  if (!ranking.length) return [];

  const losses = ranking.map((item) => Number(item.totalLossRate || 0));
  const casualties = ranking.map((item) => Number(item.casualties || 0));
  const ammoValues = ranking.map((item) => Number(item.ammoEquivalent || 0));
  const fuelValues = ranking.map((item) => Number(item.fuelUsed || 0));

  return ranking.map((item) => ({
    name: item.name,
    lossEfficiency: normalizeSmallBetter(item.totalLossRate, Math.min(...losses), Math.max(...losses)),
    casualtyEfficiency: normalizeSmallBetter(item.casualties, Math.min(...casualties), Math.max(...casualties)),
    ammoEfficiency: normalizeSmallBetter(item.ammoEquivalent, Math.min(...ammoValues), Math.max(...ammoValues)),
    fuelEfficiency: normalizeSmallBetter(item.fuelUsed, Math.min(...fuelValues), Math.max(...fuelValues)),
    sustainabilityScore: Number(item.sustainabilityScore || 0),
  }));
});

function ensureDamageChart() {
  if (!damageRef.value) return null;
  if (!damageChart) damageChart = echarts.init(damageRef.value);
  return damageChart;
}

function ensureComparisonChart() {
  if (!comparisonRef.value) return null;
  if (!comparisonChart) comparisonChart = echarts.init(comparisonRef.value);
  return comparisonChart;
}

function ensurePhaseChart() {
  if (!phaseRef.value) return null;
  if (!phaseChart) phaseChart = echarts.init(phaseRef.value);
  return phaseChart;
}

function clearCharts() {
  damageChart?.clear();
  comparisonChart?.clear();
  phaseChart?.clear();
}

function disposeCharts() {
  damageChart?.dispose();
  comparisonChart?.dispose();
  phaseChart?.dispose();
  damageChart = null;
  comparisonChart = null;
  phaseChart = null;
}

function renderDamageChart() {
  const instance = ensureDamageChart();
  const data = schemeResult.value?.equipmentBreakdown || [];
  if (!instance || !data.length) return;

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, textStyle: { color: '#dce8df' } },
    grid: { left: 48, right: 20, top: 52, bottom: 36 },
    xAxis: {
      type: 'category',
      data: data.map((item) => item.label),
      axisLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.24)' } },
      axisLabel: { color: '#dce8df' },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#a7b8a8' },
      splitLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.12)' } },
    },
    series: [
      {
        name: '自然损耗',
        type: 'bar',
        stack: 'damage',
        data: data.map((item) => item.naturalLoss.units),
        itemStyle: { color: '#38bdf8', borderRadius: [8, 8, 0, 0] },
      },
      {
        name: '任务战损',
        type: 'bar',
        stack: 'damage',
        data: data.map((item) => item.taskLoss.units),
        itemStyle: { color: '#f97316', borderRadius: [8, 8, 0, 0] },
      },
    ],
  });
}

function renderComparisonChart() {
  const instance = ensureComparisonChart();
  const data = comparisonMetrics.value;
  if (!instance || !data.length) return;

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, textStyle: { color: '#dce8df' } },
    grid: { left: 48, right: 20, top: 52, bottom: 40 },
    xAxis: {
      type: 'category',
      data: data.map((item) => item.name),
      axisLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.24)' } },
      axisLabel: { color: '#dce8df' },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: '#a7b8a8' },
      splitLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.12)' } },
    },
    series: [
      {
        name: '装备保持效率',
        type: 'bar',
        data: data.map((item) => item.lossEfficiency),
        itemStyle: { color: '#38bdf8', borderRadius: [8, 8, 0, 0] },
      },
      {
        name: '伤亡控制效率',
        type: 'bar',
        data: data.map((item) => item.casualtyEfficiency),
        itemStyle: { color: '#22c55e', borderRadius: [8, 8, 0, 0] },
      },
      {
        name: '持续作战评分',
        type: 'line',
        smooth: true,
        data: data.map((item) => item.sustainabilityScore),
        lineStyle: { color: '#f59e0b', width: 3 },
        itemStyle: { color: '#f59e0b' },
      },
    ],
  });
}

function renderPhaseChart() {
  const instance = ensurePhaseChart();
  const data = schemeResult.value?.phaseTrend || [];
  if (!instance || !data.length) return;

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, textStyle: { color: '#dce8df' } },
    grid: { left: 48, right: 48, top: 56, bottom: 40 },
    xAxis: {
      type: 'category',
      data: data.map((item) => item.label),
      axisLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.24)' } },
      axisLabel: { color: '#dce8df' },
    },
    yAxis: [
      {
        type: 'value',
        name: '战损 / 伤亡',
        axisLabel: { color: '#a7b8a8' },
        splitLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.12)' } },
      },
      {
        type: 'value',
        name: '消耗当量',
        axisLabel: { color: '#a7b8a8' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '自然损耗',
        type: 'bar',
        stack: 'loss',
        data: data.map((item) => item.naturalLoss),
        itemStyle: { color: '#38bdf8' },
      },
      {
        name: '任务战损',
        type: 'bar',
        stack: 'loss',
        data: data.map((item) => item.taskLoss),
        itemStyle: { color: '#f97316' },
      },
      {
        name: '人员伤亡',
        type: 'line',
        smooth: true,
        data: data.map((item) => item.casualties),
        lineStyle: { color: '#fb7185', width: 3 },
        itemStyle: { color: '#fb7185' },
      },
      {
        name: '弹药当量 / 1000',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: data.map((item) => Number((item.ammoEquivalent / 1000).toFixed(2))),
        lineStyle: { color: '#22c55e', width: 3 },
        itemStyle: { color: '#22c55e' },
      },
      {
        name: '油料 / 1000',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: data.map((item) => Number((item.fuelUsed / 1000).toFixed(2))),
        lineStyle: { color: '#f59e0b', width: 3 },
        itemStyle: { color: '#f59e0b' },
      },
    ],
  });
}

async function renderAllCharts() {
  if (!hasData.value) return;
  await nextTick();
  if (!hasData.value) return;

  renderDamageChart();
  renderComparisonChart();
  renderPhaseChart();
  damageChart?.resize();
  comparisonChart?.resize();
  phaseChart?.resize();
}

function handleResize() {
  damageChart?.resize();
  comparisonChart?.resize();
  phaseChart?.resize();
}

onMounted(() => {
  if (hasData.value) void renderAllCharts();
  window.addEventListener('resize', handleResize);
});

watch(hasData, (value) => {
  if (value) {
    void renderAllCharts();
    return;
  }
  clearCharts();
});

watch(() => props.schemes, () => {
  if (hasData.value) void renderAllCharts();
}, { deep: true });

watch(() => props.ranking, () => {
  if (hasData.value) void renderAllCharts();
}, { deep: true });

watch(() => props.selectedSchemeId, () => {
  if (hasData.value) void renderAllCharts();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  disposeCharts();
});
</script>

<template>
  <section class="glass-card capability-chart-shell action-chart-shell consumption-chart-shell">
    <div class="section-heading compact">
      <div>
        <h3>战损与消耗图表</h3>
      </div>
      <span v-if="schemeResult" class="pill pill-active">{{ schemeResult.name }}</span>
    </div>

    <div v-show="!hasData" class="detail-card compact-empty-state">
      <p class="muted-text">生成结果后显示图表</p>
    </div>

    <div v-show="hasData" class="action-chart-grid consumption-chart-grid">
      <article class="detail-card capability-chart-card">
        <div class="section-heading compact">
          <div>
            <h4>分类战损分布</h4>
          </div>
        </div>
        <div ref="damageRef" class="capability-chart"></div>
      </article>

      <article class="detail-card capability-chart-card">
        <div class="section-heading compact">
          <div>
            <h4>方案持续作战对比</h4>
          </div>
        </div>
        <div ref="comparisonRef" class="capability-chart"></div>
      </article>

      <article class="detail-card capability-chart-card capability-chart-card--wide">
        <div class="section-heading compact">
          <div>
            <h4>阶段趋势</h4>
          </div>
        </div>
        <div ref="phaseRef" class="capability-chart capability-chart--line"></div>
      </article>
    </div>
  </section>
</template>
