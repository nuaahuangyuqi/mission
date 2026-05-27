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

const radarRef = ref(null);
const comparisonRef = ref(null);
const timelineRef = ref(null);
const resourceRef = ref(null);

let radarChart = null;
let comparisonChart = null;
let timelineChart = null;
let resourceChart = null;

const schemeEntries = computed(() => Object.values(props.schemes || {}));
const schemeResult = computed(() => props.schemes?.[props.selectedSchemeId] || schemeEntries.value[0] || null);
const hasData = computed(() => props.ranking.length > 0 && Boolean(schemeResult.value));

function normalizeSmallBetter(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return 100;
  }
  return Number((((max - value) / (max - min)) * 100).toFixed(2));
}

const radarMetrics = computed(() => {
  const entries = schemeEntries.value;
  const current = schemeResult.value;
  if (!entries.length || !current) {
    return [];
  }

  const times = entries.map((item) => item.totals.totalTime);
  const paths = entries.map((item) => item.totals.totalDistance);
  const resources = entries.map((item) => item.totals.resourceCost);
  const risks = entries.map((item) => item.totals.averageRisk);

  return [
    {
      key: 'time',
      label: '时间效率',
      value: normalizeSmallBetter(current.totals.totalTime, Math.min(...times), Math.max(...times)),
    },
    {
      key: 'path',
      label: '路径效率',
      value: normalizeSmallBetter(current.totals.totalDistance, Math.min(...paths), Math.max(...paths)),
    },
    {
      key: 'resource',
      label: '资源效率',
      value: normalizeSmallBetter(current.totals.resourceCost, Math.min(...resources), Math.max(...resources)),
    },
    {
      key: 'risk',
      label: '风险控制',
      value: normalizeSmallBetter(current.totals.averageRisk, Math.min(...risks), Math.max(...risks)),
    },
  ];
});

function ensureRadarChart() {
  if (!radarRef.value) return null;
  if (!radarChart) radarChart = echarts.init(radarRef.value);
  return radarChart;
}

function ensureComparisonChart() {
  if (!comparisonRef.value) return null;
  if (!comparisonChart) comparisonChart = echarts.init(comparisonRef.value);
  return comparisonChart;
}

function ensureTimelineChart() {
  if (!timelineRef.value) return null;
  if (!timelineChart) timelineChart = echarts.init(timelineRef.value);
  return timelineChart;
}

function ensureResourceChart() {
  if (!resourceRef.value) return null;
  if (!resourceChart) resourceChart = echarts.init(resourceRef.value);
  return resourceChart;
}

function clearCharts() {
  radarChart?.clear();
  comparisonChart?.clear();
  timelineChart?.clear();
  resourceChart?.clear();
}

function disposeCharts() {
  radarChart?.dispose();
  comparisonChart?.dispose();
  timelineChart?.dispose();
  resourceChart?.dispose();
  radarChart = null;
  comparisonChart = null;
  timelineChart = null;
  resourceChart = null;
}

function renderRadarChart() {
  const instance = ensureRadarChart();
  const metrics = radarMetrics.value;
  if (!instance || !metrics.length) return;

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item' },
    radar: {
      radius: '64%',
      indicator: metrics.map((item) => ({ name: item.label, max: 100 })),
      splitNumber: 5,
      axisName: { color: '#dce8df', fontSize: 12 },
      splitLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.18)' } },
      splitArea: { areaStyle: { color: ['rgba(56, 189, 248, 0.04)', 'rgba(56, 189, 248, 0.01)'] } },
      axisLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.24)' } },
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: metrics.map((item) => item.value),
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

function renderComparisonChart() {
  const instance = ensureComparisonChart();
  const ranking = props.ranking || [];
  if (!instance || !ranking.length) return;

  const times = ranking.map((item) => item.totalTime);
  const distances = ranking.map((item) => item.totalDistance);

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, textStyle: { color: '#dce8df' } },
    grid: { left: 48, right: 48, top: 52, bottom: 38 },
    xAxis: {
      type: 'category',
      data: ranking.map((item) => item.name),
      axisLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.24)' } },
      axisLabel: { color: '#dce8df' },
    },
    yAxis: [
      {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: '#a7b8a8' },
        splitLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.12)' } },
      },
      {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: '#a7b8a8' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '时间效率',
        type: 'bar',
        barMaxWidth: 30,
        data: ranking.map((item) => normalizeSmallBetter(item.totalTime, Math.min(...times), Math.max(...times))),
        itemStyle: { color: '#38bdf8', borderRadius: [8, 8, 0, 0] },
      },
      {
        name: '路径效率',
        type: 'bar',
        barMaxWidth: 30,
        data: ranking.map((item) => normalizeSmallBetter(item.totalDistance, Math.min(...distances), Math.max(...distances))),
        itemStyle: { color: '#a3e635', borderRadius: [8, 8, 0, 0] },
      },
      {
        name: '推荐分',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: ranking.map((item) => item.recommendationScore),
        lineStyle: { color: '#f97316', width: 3 },
        itemStyle: { color: '#f97316' },
      },
    ],
  });
}

function renderTimelineChart() {
  const instance = ensureTimelineChart();
  const nodes = schemeResult.value?.nodes || [];
  if (!instance || !nodes.length) return;

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: '#dce8df' } },
    grid: { left: 48, right: 20, top: 52, bottom: 42 },
    xAxis: {
      type: 'category',
      data: nodes.map((item) => item.name),
      axisLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.24)' } },
      axisLabel: { color: '#dce8df', interval: 0, rotate: 20 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#a7b8a8' },
      splitLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.12)' } },
    },
    series: [
      {
        name: '节点时长',
        type: 'line',
        smooth: true,
        data: nodes.map((item) => item.duration),
        lineStyle: { color: '#38bdf8', width: 3 },
        itemStyle: { color: '#38bdf8' },
        areaStyle: { color: 'rgba(56, 189, 248, 0.14)' },
      },
      {
        name: '累计时间',
        type: 'line',
        smooth: true,
        data: nodes.map((item) => item.endTime),
        lineStyle: { color: '#f59e0b', width: 3 },
        itemStyle: { color: '#f59e0b' },
      },
    ],
  });
}

function renderResourceChart() {
  const instance = ensureResourceChart();
  const resources = (schemeResult.value?.resourceUsage || []).slice().sort((left, right) => right.utilization - left.utilization);
  if (!instance || !resources.length) return;

  instance.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 120, right: 20, top: 24, bottom: 24 },
    xAxis: {
      type: 'value',
      max: 1.2,
      axisLabel: {
        color: '#a7b8a8',
        formatter: (value) => `${Math.round(value * 100)}%`,
      },
      splitLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.12)' } },
    },
    yAxis: {
      type: 'category',
      data: resources.map((item) => item.label),
      axisLine: { lineStyle: { color: 'rgba(176, 214, 179, 0.24)' } },
      axisLabel: { color: '#dce8df' },
    },
    series: [
      {
        type: 'bar',
        barWidth: 18,
        data: resources.map((item) => ({
          value: item.utilization,
          itemStyle: {
            color: item.utilization >= 1 ? '#f97316' : item.utilization >= 0.85 ? '#f59e0b' : '#22c55e',
            borderRadius: [0, 10, 10, 0],
          },
        })),
        label: {
          show: true,
          position: 'right',
          color: '#eef6ef',
          formatter: ({ value }) => `${Math.round(Number(value) * 100)}%`,
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
  renderComparisonChart();
  renderTimelineChart();
  renderResourceChart();
  radarChart?.resize();
  comparisonChart?.resize();
  timelineChart?.resize();
  resourceChart?.resize();
}

function handleResize() {
  radarChart?.resize();
  comparisonChart?.resize();
  timelineChart?.resize();
  resourceChart?.resize();
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
  <section class="glass-card capability-chart-shell action-chart-shell">
    <div class="section-heading compact">
      <div>
        <h3>行动评估图表</h3>
      </div>
      <span v-if="schemeResult" class="pill pill-active">{{ schemeResult.name }}</span>
    </div>

    <div v-show="!hasData" class="detail-card compact-empty-state">
      <p class="muted-text">生成结果后显示图表</p>
    </div>

    <div v-show="hasData" class="action-chart-grid">
      <article class="detail-card capability-chart-card">
        <div class="section-heading compact">
          <div>
            <h4>方案效率雷达图</h4>
          </div>
        </div>
        <div ref="radarRef" class="capability-chart"></div>
      </article>

      <article class="detail-card capability-chart-card">
        <div class="section-heading compact">
          <div>
            <h4>多方案对比</h4>
          </div>
        </div>
        <div ref="comparisonRef" class="capability-chart"></div>
      </article>

      <article class="detail-card capability-chart-card capability-chart-card--wide">
        <div class="section-heading compact">
          <div>
            <h4>节点时间线</h4>
          </div>
        </div>
        <div ref="timelineRef" class="capability-chart capability-chart--line"></div>
      </article>

      <article class="detail-card capability-chart-card capability-chart-card--wide">
        <div class="section-heading compact">
          <div>
            <h4>资源利用率</h4>
          </div>
        </div>
        <div ref="resourceRef" class="capability-chart capability-chart--line"></div>
      </article>
    </div>
  </section>
</template>
