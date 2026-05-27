<script setup>
import * as echarts from 'echarts';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  methods: {
    type: Object,
    default: () => ({}),
  },
  selectedMethod: {
    type: String,
    default: 'ahp',
  },
  selectedSchemeId: {
    type: String,
    default: '',
  },
});

const radarRef = ref(null);
const barRef = ref(null);
const lineRef = ref(null);

let radarChart = null;
let barChart = null;
let lineChart = null;

const methodOrder = ['ahp', 'fuzzy', 'topsis'];
const methodList = computed(() => methodOrder.filter((key) => props.methods?.[key]));
const activeMethod = computed(() => props.methods?.[props.selectedMethod] || props.methods?.ahp || props.methods?.fuzzy || props.methods?.topsis || null);
const schemeResult = computed(() => activeMethod.value?.schemes?.[props.selectedSchemeId] || null);
const hasData = computed(() => Boolean(activeMethod.value && schemeResult.value));
const comparisonScores = computed(() => methodList.value.map((key) => {
  const method = props.methods[key];
  const scheme = method?.schemes?.[props.selectedSchemeId];
  return {
    key,
    label: method?.label || key.toUpperCase(),
    score: Number(scheme?.overallScore || 0),
  };
}));
const rankingSnapshot = computed(() => (activeMethod.value?.ranking || []).slice(0, 3));

function ensureRadarChart() {
  if (!radarRef.value) return null;
  if (!radarChart) radarChart = echarts.init(radarRef.value);
  return radarChart;
}

function ensureBarChart() {
  if (!barRef.value) return null;
  if (!barChart) barChart = echarts.init(barRef.value);
  return barChart;
}

function ensureLineChart() {
  if (!lineRef.value) return null;
  if (!lineChart) lineChart = echarts.init(lineRef.value);
  return lineChart;
}

function clearCharts() {
  radarChart?.clear();
  barChart?.clear();
  lineChart?.clear();
}

function disposeCharts() {
  radarChart?.dispose();
  barChart?.dispose();
  lineChart?.dispose();
  radarChart = null;
  barChart = null;
  lineChart = null;
}

function renderRadarChart() {
  const instance = ensureRadarChart();
  const coreScores = schemeResult.value?.coreScores || [];
  if (!instance || !coreScores.length) return;

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item' },
    radar: {
      radius: '64%',
      indicator: coreScores.map((item) => ({ name: item.name, max: 100 })),
      splitNumber: 5,
      axisName: { color: '#dce8df', fontSize: 12 },
      splitLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.2)' } },
      splitArea: { areaStyle: { color: ['rgba(163, 230, 53, 0.04)', 'rgba(163, 230, 53, 0.01)'] } },
      axisLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.26)' } },
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: coreScores.map((item) => Number(item.score || 0)),
            name: schemeResult.value?.name || '当前方案',
            areaStyle: { color: 'rgba(56, 189, 248, 0.2)' },
            lineStyle: { color: '#38bdf8', width: 2 },
            symbol: 'circle',
            symbolSize: 8,
            itemStyle: { color: '#38bdf8' },
          },
        ],
      },
    ],
  });
}

function renderBarChart() {
  const instance = ensureBarChart();
  const ranking = [...(activeMethod.value?.ranking || [])].sort((left, right) => left.rank - right.rank);
  if (!instance || !ranking.length) return;

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 48, right: 20, top: 24, bottom: 40 },
    xAxis: {
      type: 'category',
      data: ranking.map((item) => item.name),
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
        type: 'bar',
        barWidth: 42,
        data: ranking.map((item, index) => ({
          value: item.score,
          itemStyle: {
            color: index === 0 ? '#a3e635' : index === 1 ? '#38bdf8' : '#f59e0b',
            borderRadius: [10, 10, 0, 0],
          },
        })),
        label: {
          show: true,
          position: 'top',
          color: '#eef6ef',
          formatter: ({ value }) => Number(value).toFixed(1),
        },
      },
    ],
  });
}

function renderLineChart() {
  const instance = ensureLineChart();
  const data = comparisonScores.value;
  if (!instance || !data.length) return;

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 20, top: 24, bottom: 36 },
    xAxis: {
      type: 'category',
      data: data.map((item) => item.label),
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
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 10,
        data: data.map((item) => item.score),
        lineStyle: { color: '#f97316', width: 3 },
        itemStyle: { color: '#f97316' },
        areaStyle: { color: 'rgba(249, 115, 22, 0.16)' },
        label: {
          show: true,
          color: '#eef6ef',
          formatter: ({ value }) => Number(value).toFixed(1),
        },
      },
    ],
  });
}

async function renderAllCharts() {
  if (!hasData.value) return;
  await nextTick();
  if (!hasData.value) return;

  renderRadarChart();
  renderBarChart();
  renderLineChart();
  radarChart?.resize();
  barChart?.resize();
  lineChart?.resize();
}

function handleResize() {
  radarChart?.resize();
  barChart?.resize();
  lineChart?.resize();
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

watch(() => props.methods, () => {
  if (hasData.value) void renderAllCharts();
}, { deep: true });

watch(() => props.selectedMethod, () => {
  if (hasData.value) void renderAllCharts();
});

watch(() => props.selectedSchemeId, () => {
  if (hasData.value) void renderAllCharts();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  disposeCharts();
});
</script>

<template>
  <section class="glass-card capability-chart-shell">
    <div class="section-heading compact">
      <div>
        <h3>评估结果图表</h3>
      </div>
      <span v-if="activeMethod" class="pill pill-active">{{ activeMethod.label }}</span>
    </div>

    <div v-show="!hasData" class="detail-card compact-empty-state">
      <p class="muted-text">生成结果后显示图表</p>
    </div>

    <div v-show="hasData" class="capability-chart-grid">
      <div class="capability-chart-summary">
        <div v-for="item in comparisonScores" :key="item.key" class="capability-chart-summary__item">
          <span>{{ item.label }}</span>
          <strong>{{ item.score.toFixed(2) }}</strong>
        </div>
      </div>

      <div class="capability-ranking-strip">
        <span class="capability-ranking-strip__label">当前算法前 3 名评估对象</span>
        <div class="capability-ranking-strip__list">
          <span v-for="item in rankingSnapshot" :key="item.schemeId" class="pill pill-muted">
            #{{ item.rank }} {{ item.name }}
          </span>
        </div>
      </div>

      <article class="detail-card capability-chart-card">
        <div class="section-heading compact">
          <div>
            <h4>核心能力雷达图</h4>
          </div>
          <span class="pill pill-muted">{{ schemeResult?.grade || '--' }}</span>
        </div>
        <div ref="radarRef" class="capability-chart"></div>
      </article>

      <article class="detail-card capability-chart-card">
        <div class="section-heading compact">
          <div>
            <h4>方案综合对比</h4>
          </div>
        </div>
        <div ref="barRef" class="capability-chart"></div>
      </article>

      <article class="detail-card capability-chart-card capability-chart-card--wide">
        <div class="section-heading compact">
          <div>
            <h4>算法得分对比</h4>
          </div>
        </div>
        <div ref="lineRef" class="capability-chart capability-chart--line"></div>
      </article>
    </div>
  </section>
</template>
