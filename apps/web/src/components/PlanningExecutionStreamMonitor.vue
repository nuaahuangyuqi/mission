<script setup>
import { computed } from 'vue';

const props = defineProps({
  streamState: {
    type: Object,
    default: () => ({}),
  },
  title: {
    type: String,
    default: '执行监控',
  },
  runLabel: {
    type: String,
    default: 'Run',
  },
});

const llmStreamText = computed(() => (props.streamState.llmChunks || [])
  .map((item) => item.content)
  .join(''));

const stepProgressPercent = computed(() => Math.max(0, Math.min(100, Number(props.streamState.stepProgress || 0))));

const phaseLabel = computed(() => {
  const label = String(props.streamState.phaseLabel || '').trim();
  if (label) return label;
  const key = String(props.streamState.phaseKey || '').trim();
  if (key === 'preparse') return '预解析';
  if (key === 'unit-count') return '单位总数预解析';
  if (key === 'structured-generation') return '生成结构化信息';
  if (key === 'report-generation') return '生成报告';
  if (key === 'artifact-generation') return '生成产物';
  return '';
});

const unitProgressText = computed(() => {
  const unit = props.streamState.unitProgress || null;
  if (!unit || !Number(unit.total)) return '';
  const kind = unit.kind === 'friendly' ? '我方单位' : unit.kind === 'enemy' ? '敌方单位' : '单位';
  return `已解析 ${Number(unit.completed || 0)} / ${Number(unit.total || 0)} 个${kind}`;
});

function formatStreamStepStatus(status) {
  if (status === 'completed') return '完成';
  if (status === 'running') return '运行中';
  if (status === 'failed') return '失败';
  return '等待';
}

function formatStreamTime(value) {
  return value ? String(value).slice(11, 19) : '--:--:--';
}
</script>

<template>
  <article class="capability-stage-card planning-stream-monitor">
    <div class="planning-stream-monitor__head">
      <div>
        <span class="eyebrow">Live Execution</span>
        <h3>{{ title }}</h3>
      </div>
      <div class="planning-stream-monitor__meta">
        <span class="pill" :class="streamState.errorMessage ? 'pill-muted' : 'pill-active'">
          {{ streamState.active ? '流式执行中' : streamState.errorMessage ? '执行失败' : '执行结束' }}
        </span>
        <span class="pill pill-muted">{{ runLabel }} {{ streamState.runId ? `#${streamState.runId}` : '--' }}</span>
      </div>
    </div>

    <div class="planning-stream-progress top-gap">
      <div class="planning-stream-progress__bar">
        <span :style="{ width: `${Math.max(0, Math.min(100, Number(streamState.progress || 0)))}%` }"></span>
      </div>
      <strong>{{ Math.round(Number(streamState.progress || 0)) }}%</strong>
    </div>

    <div class="planning-stream-current top-gap">
      <span>当前步骤</span>
      <strong>{{ streamState.currentStepName || '等待任务启动' }}</strong>
      <small>{{ streamState.currentEvent || '--' }}</small>
    </div>

    <div v-if="phaseLabel || unitProgressText || streamState.stepProgress" class="planning-stream-current top-gap">
      <span>当前阶段</span>
      <strong>{{ phaseLabel || '算法执行中' }}</strong>
      <small>
        {{ unitProgressText || `算法进度 ${Math.round(stepProgressPercent)}%` }}
        <template v-if="unitProgressText"> / 算法进度 {{ Math.round(stepProgressPercent) }}%</template>
      </small>
    </div>

    <div v-if="streamState.stepStates?.length" class="planning-stream-steps top-gap">
      <article
        v-for="item in streamState.stepStates"
        :key="item.stepId"
        class="planning-stream-step"
        :class="`planning-stream-step--${item.status || 'pending'}`"
      >
        <span>步骤 {{ item.order || '--' }}</span>
        <strong>{{ item.stepName || item.algorithmId }}</strong>
        <small>{{ formatStreamStepStatus(item.status) }}</small>
      </article>
    </div>

    <p v-if="streamState.errorMessage" class="auth-error capability-inline-error top-gap">{{ streamState.errorMessage }}</p>

    <div class="planning-stream-console-grid top-gap">
      <section class="planning-stream-console">
        <div class="planning-stream-console__head">
          <h4>终端提示</h4>
          <span>{{ streamState.terminalLines?.length || 0 }} 行</span>
        </div>
        <div class="planning-stream-console__body">
          <p v-if="!streamState.terminalLines?.length" class="muted-text">等待算法输出阶段日志。</p>
          <pre v-else><template v-for="(line, index) in streamState.terminalLines" :key="`${line.timestamp}-${index}`">[{{ formatStreamTime(line.timestamp) }}] {{ line.stepName ? `${line.stepName} ` : '' }}{{ line.stream }} &gt; {{ line.message }}
</template></pre>
        </div>
      </section>

      <section class="planning-stream-console planning-stream-console--llm">
        <div class="planning-stream-console__head">
          <h4>大模型片段</h4>
          <span>{{ streamState.llmChunks?.length || 0 }} 段</span>
        </div>
        <div class="planning-stream-console__body">
          <p v-if="!llmStreamText" class="muted-text">选择启用流式 LLM 的 Python 算法后，这里会显示 stdout 中的模型片段。</p>
          <pre v-else>{{ llmStreamText }}</pre>
        </div>
      </section>
    </div>
  </article>
</template>
