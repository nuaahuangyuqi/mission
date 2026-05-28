<script setup>
import * as echarts from 'echarts';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  graph: {
    type: Object,
    default: () => ({ nodes: [], edges: [] }),
  },
  extractions: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['search']);

const chartRef = ref(null);
const query = ref('');
const selectedNode = ref(null);
let chart;

const summary = computed(() => ({
  nodes: props.graph?.nodes?.length || 0,
  edges: props.graph?.edges?.length || 0,
  entities: props.extractions.reduce((total, item) => total + item.entities.length, 0),
}));

function categoryIndex(camp) {
  if (camp === 'blue') return 0;
  if (camp === 'red') return 1;
  return 2;
}

function renderChart() {
  if (!chart) return;

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      formatter(params) {
        if (params.dataType === 'edge') {
          return `${params.data.relation}<br/>置信度：${Math.round(params.data.confidence * 100)}%`;
        }
        return `${params.data.name}<br/>${params.data.summary}`;
      },
    },
    legend: {
      top: 8,
      textStyle: { color: '#dce7de' },
      data: ['蓝方节点', '红方节点', '环境/命令'],
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        symbolSize: (value, params) => 18 + (params.data.score || 50) / 10,
        force: {
          repulsion: 280,
          edgeLength: [90, 160],
        },
        categories: [
          { name: '蓝方节点', itemStyle: { color: '#38bdf8' } },
          { name: '红方节点', itemStyle: { color: '#f97316' } },
          { name: '环境/命令', itemStyle: { color: '#a3e635' } },
        ],
        label: {
          show: true,
          color: '#f5fbf6',
          fontSize: 12,
        },
        lineStyle: {
          color: 'source',
          width: 1.8,
          opacity: 0.8,
          curveness: 0.12,
        },
        data: (props.graph?.nodes || []).map((node) => ({
          ...node,
          category: categoryIndex(node.camp),
          value: node.score,
        })),
        links: (props.graph?.edges || []).map((edge) => ({
          ...edge,
          source: edge.source,
          target: edge.target,
        })),
      },
    ],
  });
}

function handleResize() {
  chart?.resize();
}

function doSearch() {
  emit('search', query.value.trim());
}

function resetSearch() {
  query.value = '';
  emit('search', '');
}

onMounted(() => {
  chart = echarts.init(chartRef.value);
  chart.on('click', (params) => {
    if (params.dataType === 'node') {
      selectedNode.value = params.data;
    }
  });
  renderChart();
  window.addEventListener('resize', handleResize);
});

watch(() => props.graph, renderChart, { deep: true });

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  chart?.dispose();
});
</script>

<template>
  <div class="stack-grid two-columns">
    <section class="glass-card">
      <div class="section-heading compact">
        <div>
          <h3>数据挖掘与知识图谱</h3>
          <p>基于虚构文本样本完成实体识别、关系抽取、图谱构建与交互查询。</p>
        </div>
      </div>

      <div class="stats-strip compact-grid three-up">
        <div class="mini-stat">
          <span>图谱节点</span>
          <strong>{{ summary.nodes }}</strong>
        </div>
        <div class="mini-stat">
          <span>关联边</span>
          <strong>{{ summary.edges }}</strong>
        </div>
        <div class="mini-stat">
          <span>识别实体</span>
          <strong>{{ summary.entities }}</strong>
        </div>
      </div>

      <div class="toolbar-row top-gap">
        <input v-model="query" type="text" placeholder="输入单位、环境或命令关键字" class="query-input" @keyup.enter="doSearch" />
        <button class="button" @click="doSearch">查询图谱</button>
        <button class="button button-ghost" @click="resetSearch">重置</button>
      </div>

      <div ref="chartRef" class="graph-canvas"></div>
    </section>

    <section class="glass-card">
      <div class="section-heading compact">
        <div>
          <h3>抽取过程演示</h3>
          <p>通过规则化样本展示实体识别、关系抽取与关联分析链路。</p>
        </div>
      </div>

      <div class="sample-list">
        <article v-for="sample in extractions" :key="sample.id" class="sample-card">
          <p>{{ sample.text }}</p>
          <div class="chip-row">
            <span v-for="entity in sample.entities" :key="entity" class="chip chip-entity">{{ entity }}</span>
          </div>
          <div class="chip-row">
            <span v-for="relation in sample.relations" :key="relation" class="chip chip-relation">{{ relation }}</span>
          </div>
        </article>
      </div>

      <div class="detail-card top-gap">
        <h4>当前节点分析</h4>
        <template v-if="selectedNode">
          <p><strong>{{ selectedNode.name }}</strong></p>
          <p>{{ selectedNode.summary }}</p>
          <p class="muted-text">关联评分：{{ selectedNode.score }}</p>
        </template>
        <p v-else class="muted-text">点击左侧图谱节点，可查看当前节点的摘要分析。</p>
      </div>
    </section>
  </div>
</template>

