<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlanningWorkflow } from '../../modules/planningWorkflow';

const router = useRouter();
const route = useRoute();
const {
  state,
  selectedTask,
  selectedTaskInstance,
  executionSteps,
  executionSummary,
  resultOutputPackages,
  resultsGeneratedAt,
  runHistory,
  executionProcessEvents,
  executionOutputEvents,
  activeExecutionStep,
  savedResultSnapshotCount,
  latestSavedResultSnapshot,
  loadTaskRuns,
  replayTaskRun,
  calculatePlanningAssessment,
  saveCurrentResultSnapshot,
  downloadResultPackage,
  formatVariantType,
} = usePlanningWorkflow();

const outputPackages = computed(() => resultOutputPackages.value || {});
const latestRunRecord = computed(() => runHistory.value?.[0] || null);
const availablePackageCount = computed(() => ['storageSnapshot', 'reportExport', 'spatialExport', 'comparisonExport']
  .filter((key) => outputPackages.value?.[key]).length);
const implementedStepCount = computed(() => executionSteps.value
  .filter((item) => item.structuredOutput?.implementationStatus === 'implemented').length);

const executionStateLabel = computed(() => {
  if (state.calculating) return '执行中';
  if (state.results) return state.resultsDirty ? '待重新执行' : '已有结果';
  return '未执行';
});

const packageCards = computed(() => [
  {
    key: 'storageSnapshot',
    title: '结果快照',
    label: outputPackages.value.storageSnapshot?.label || '结构化结果快照',
    format: outputPackages.value.storageSnapshot?.format || 'json',
    meta: `本地已保存 ${savedResultSnapshotCount.value} 份`,
    actionLabel: '保存快照',
    enabled: Boolean(outputPackages.value.storageSnapshot?.data),
    action: handleSaveSnapshot,
  },
  {
    key: 'reportExport',
    title: '分析报告',
    label: outputPackages.value.reportExport?.fileName || 'HTML 分析报告',
    format: outputPackages.value.reportExport?.format || 'html',
    meta: outputPackages.value.reportExport ? '可导出' : '待生成',
    actionLabel: '导出报告',
    enabled: Boolean(outputPackages.value.reportExport?.fileName),
    action: () => handleDownloadPackage('reportExport'),
  },
  {
    key: 'spatialExport',
    title: '空间成果',
    label: outputPackages.value.spatialExport?.fileName || 'GeoJSON 空间结果',
    format: outputPackages.value.spatialExport?.format || 'geojson',
    meta: `${outputPackages.value.spatialExport?.meta?.featureCount || 0} 个要素`,
    actionLabel: '导出空间',
    enabled: Boolean(outputPackages.value.spatialExport?.fileName),
    action: () => handleDownloadPackage('spatialExport'),
  },
  {
    key: 'comparisonExport',
    title: '方案比选表',
    label: outputPackages.value.comparisonExport?.fileName || 'CSV 比选结果',
    format: outputPackages.value.comparisonExport?.format || 'csv',
    meta: `${outputPackages.value.comparisonExport?.meta?.rowCount || 0} 行`,
    actionLabel: '导出比选',
    enabled: Boolean(outputPackages.value.comparisonExport?.fileName),
    action: () => handleDownloadPackage('comparisonExport'),
  },
]);

const resultStepCards = computed(() => executionSteps.value.map((item) => {
  const structuredOutput = item.structuredOutput || {};
  const status = structuredOutput.implementationStatus === 'implemented' ? '已实现' : '规划中';
  const preview = Array.isArray(item.outputPreview) && item.outputPreview.length
    ? item.outputPreview
    : [item.summary].filter(Boolean);
  return {
    ...item,
    status,
    preview,
    metric: resolveStepMetric(item),
    isImplemented: structuredOutput.implementationStatus === 'implemented',
  };
}));

const processWorkbenchEvents = computed(() => {
  if (executionProcessEvents.value.length) {
    return executionProcessEvents.value;
  }
  const traceEvents = executionSteps.value.flatMap((item) => (item.structuredOutput?.processTrace || []).map((event, index) => ({
    id: `trace-${item.stepId}-${index}`,
    emittedAt: event.emittedAt || resultsGeneratedAt.value || '',
    phase: event.phase || 'trace',
    channel: event.channel || 'process',
    level: event.level || 'info',
    title: event.title || item.algorithm?.name || item.stepName,
    message: event.message || '',
    progress: null,
    step: {
      order: item.order,
      stepName: item.stepName,
      algorithmName: item.algorithm?.name,
      bindingName: item.binding?.name,
    },
  })));
  if (traceEvents.length) return traceEvents;
  return executionSteps.value.map((item) => ({
    id: `process-${item.stepId}`,
    emittedAt: resultsGeneratedAt.value || '',
    phase: 'result:summary',
    channel: 'process',
    level: item.structuredOutput?.implementationStatus === 'implemented' ? 'success' : 'warning',
    title: item.algorithm?.name || item.stepName,
    message: item.summary,
    progress: null,
    step: {
      order: item.order,
      stepName: item.stepName,
      algorithmName: item.algorithm?.name,
      bindingName: item.binding?.name,
    },
  }));
});

const outputWorkbenchEvents = computed(() => executionOutputEvents.value);
const terminalWorkbenchLines = computed(() => processWorkbenchEvents.value
  .filter((item) => {
    const phase = String(item.phase || '');
    return item.channel === 'terminal'
      || item.level === 'error'
      || phase.includes('stream:error')
      || phase.includes('client:error');
  })
  .flatMap((item) => eventMessages(item).map((message, index) => ({
    id: `${item.id}-${index}`,
    level: item.level,
    text: item.channel === 'terminal' ? message : `${message}${String(message).endsWith('\n') ? '' : '\n'}`,
  }))));

const currentExecutionStep = computed(() => (
  activeExecutionStep.value
  || resultStepCards.value.at(-1)
  || null
));

const currentAlgorithmLabel = computed(() => {
  const step = currentExecutionStep.value;
  if (!step) return state.calculating ? '等待调度' : '暂无运行算法';
  return step.algorithmName || step.stepName || '算法运行中';
});

const progressPercent = computed(() => Math.round(Number(state.executionProgress || 0)));

function resolveStepMetric(item = {}) {
  const output = item.structuredOutput || {};
  const algorithmId = item.algorithm?.id || '';
  if (algorithmId === 'enemy-threat-analysis') {
    return `${output.threatLevel || '--'} / ${output.threatScore ?? '--'} 分`;
  }
  if (algorithmId === 'force-grouping') {
    return `${output.preferredScheme?.name || '推荐编组'} / ${output.preferredScheme?.score ?? '--'} 分`;
  }
  if (algorithmId === 'target-allocation') {
    return `${output.preferredPlan?.name || '推荐分配'} / ${output.preferredPlan?.score ?? '--'} 分`;
  }
  if (algorithmId === 'airborne-landing-site-selection') {
    return `${output.preferredCandidate?.name || '推荐地域'} / ${output.preferredCandidate?.score ?? '--'} 分`;
  }
  if (algorithmId === 'method-planning') {
    return `${output.preferredPlan?.name || '推荐战法'} / ${output.preferredPlan?.score ?? '--'} 分`;
  }
  if (algorithmId === 'support-planning') {
    return `${output.preferredPlan?.name || '推荐保障'} / ${output.preferredPlan?.metrics?.coverageRate ?? '--'}%`;
  }
  return output.implementationStatus || '--';
}

async function handleCalculate() {
  try {
    await calculatePlanningAssessment();
  } catch {
    // Shared workflow state already stores the error message.
  }
}

function handleSaveSnapshot() {
  try {
    saveCurrentResultSnapshot();
  } catch (error) {
    state.errorMessage = error.message || '保存规划结果快照失败。';
  }
}

function handleDownloadPackage(packageKey) {
  try {
    downloadResultPackage(packageKey);
  } catch (error) {
    state.errorMessage = error.message || '导出任务规划输出包失败。';
  }
}

function formatSnapshotTime(value) {
  return value ? String(value).slice(0, 19).replace('T', ' ') : '--';
}

function formatRunStatus(status) {
  if (status === 'succeeded') return '成功';
  if (status === 'failed') return '失败';
  if (status === 'running') return '执行中';
  return status || '--';
}

function formatEventTime(value) {
  return value ? String(value).slice(11, 19) : '--:--:--';
}

function eventLevelClass(level) {
  if (level === 'success') return 'planning-live-event--success';
  if (level === 'warning') return 'planning-live-event--warning';
  if (level === 'error') return 'planning-live-event--error';
  return '';
}

function eventMessages(item = {}) {
  return item.preview?.length ? item.preview : [item.message].filter(Boolean);
}

function terminalLineClass(level) {
  if (level === 'error') return 'planning-terminal-line--error';
  if (level === 'warning') return 'planning-terminal-line--warning';
  if (level === 'success') return 'planning-terminal-line--success';
  return '';
}

async function handleRefreshRuns() {
  if (!selectedTaskInstance.value) return;
  try {
    await loadTaskRuns(selectedTaskInstance.value.id);
  } catch {
    // Shared workflow state already stores the error message.
  }
}

async function handleReplayRun(runId) {
  try {
    await replayTaskRun(runId);
  } catch {
    // Shared workflow state already stores the error message.
  }
}

function openStepResult(item) {
  router.push({
    name: 'planning-tasks-execute-step',
    params: { stepId: item.stepId || item.algorithm?.id },
    query: route.query,
  });
}
</script>

<template>
  <section class="capability-stage action-stage top-gap planning-execution-shell">
    <article class="capability-stage-card planning-execution-command-deck">
      <div class="planning-execution-command-deck__copy">
        <span class="eyebrow">Execution Command Deck</span>
        <h3>规划执行工作台</h3>
        <p>这里负责触发任务执行、回看历史记录和进入分算法结果页；专题明细已经拆分到独立页面。</p>

        <div class="planning-task-actions top-gap">
          <button class="button" :disabled="state.calculating || state.loading || !selectedTask" @click="handleCalculate">
            {{ state.calculating ? '执行中...' : state.results ? '重新执行任务模板' : '执行任务模板' }}
          </button>
          <button class="button button-secondary" :disabled="!outputPackages.storageSnapshot?.data" @click="handleSaveSnapshot">
            保存结果快照
          </button>
          <button class="button button-secondary" :disabled="!outputPackages.reportExport" @click="handleDownloadPackage('reportExport')">
            导出分析报告
          </button>
          <button class="button button-secondary" :disabled="!outputPackages.spatialExport" @click="handleDownloadPackage('spatialExport')">
            导出空间成果
          </button>
          <button class="button button-secondary" :disabled="!outputPackages.comparisonExport" @click="handleDownloadPackage('comparisonExport')">
            导出对比表
          </button>
        </div>

        <div class="capability-stage-pill-row top-gap">
          <span class="pill pill-active">{{ selectedTask?.name || '未选择任务模板' }}</span>
          <span class="pill pill-muted">任务实例 {{ selectedTaskInstance ? `#${selectedTaskInstance.id}` : '未选择' }}</span>
          <span class="pill pill-muted">状态 {{ executionStateLabel }}</span>
          <span class="pill pill-muted">结果时间 {{ resultsGeneratedAt ? resultsGeneratedAt.slice(0, 19).replace('T', ' ') : '--' }}</span>
        </div>
      </div>

      <div class="planning-execution-command-deck__stats">
        <div class="planning-execution-command-deck__stat">
          <span>完成步骤</span>
          <strong>{{ executionSummary.completedSteps }}</strong>
          <small>已实现 {{ executionSummary.implementedSteps }} 步</small>
        </div>
        <div class="planning-execution-command-deck__stat">
          <span>结果页面</span>
          <strong>{{ implementedStepCount }}</strong>
          <small>每个算法单独回看</small>
        </div>
        <div class="planning-execution-command-deck__stat">
          <span>输出包</span>
          <strong>{{ availablePackageCount }}</strong>
          <small>当前可导出的结构化成果</small>
        </div>
        <div class="planning-execution-command-deck__stat">
          <span>结果快照</span>
          <strong>{{ savedResultSnapshotCount }}</strong>
          <small>最近保存 {{ formatSnapshotTime(latestSavedResultSnapshot?.savedAt) }}</small>
        </div>
      </div>

      <p v-if="state.errorMessage" class="auth-error capability-inline-error top-gap">{{ state.errorMessage }}</p>
    </article>

    <div class="planning-live-run-strip">
      <div>
        <span>当前运行算法</span>
        <strong>{{ currentAlgorithmLabel }}</strong>
        <small>{{ currentExecutionStep?.bindingName || currentExecutionStep?.binding?.name || '等待执行调度' }}</small>
      </div>
      <div class="planning-live-meter" :style="{ '--planning-live-progress': `${progressPercent}%` }">
        <span></span>
      </div>
      <strong class="planning-live-percent">{{ progressPercent }}%</strong>
    </div>

    <div class="planning-execution-workbench-grid">
      <article class="capability-stage-card planning-live-workbench planning-terminal-workbench">
        <div class="section-heading compact">
          <h3>大模型流式输出工作台</h3>
        </div>

        <div class="planning-terminal-output">
          <pre v-if="terminalWorkbenchLines.length"><span
            v-for="line in terminalWorkbenchLines.slice(-120)"
            :key="line.id"
            :class="terminalLineClass(line.level)"
            v-text="line.text"
          ></span></pre>
          <pre v-else></pre>
        </div>
      </article>

      <article class="capability-stage-card planning-live-workbench">
        <div class="section-heading compact">
          <div>
            <h3>算法输出工作台</h3>
            <p>显示每个算法已产出的摘要、关键指标和可进入结果页的输出线索。</p>
          </div>
          <span class="pill pill-muted">输出 {{ outputWorkbenchEvents.length }}</span>
        </div>

        <div v-if="!outputWorkbenchEvents.length" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">算法完成阶段性输出后，这里会持续追加输出摘要。</p>
        </div>

        <div v-else class="planning-live-output-list top-gap">
          <article
            v-for="item in outputWorkbenchEvents.slice(-12)"
            :key="item.id"
            class="planning-live-output"
            :class="eventLevelClass(item.level)"
          >
            <div class="planning-live-output__head">
              <span class="pill pill-active">{{ item.step?.algorithmName || item.title || '算法输出' }}</span>
              <time>{{ formatEventTime(item.emittedAt) }}</time>
            </div>
            <strong>{{ item.title || item.step?.stepName || '输出摘要' }}</strong>
            <ul class="action-text-list top-gap">
              <li v-for="message in eventMessages(item)" :key="message">{{ message }}</li>
            </ul>
          </article>
        </div>
      </article>
    </div>

    <div class="planning-execution-overview-grid">
      <article class="capability-stage-card planning-execution-overview-card planning-execution-overview-card--full">
        <div class="section-heading compact">
          <div>
            <h3>执行记录</h3>
            <p>保留任务实例归档历史，可回看历史结果并重新进入对应算法页面。</p>
          </div>
          <div class="planning-task-actions">
            <button class="button button-ghost" :disabled="!selectedTaskInstance || state.runHistoryLoading" @click="handleRefreshRuns">
              {{ state.runHistoryLoading ? '刷新中...' : '刷新记录' }}
            </button>
          </div>
        </div>

        <div class="capability-stage-pill-row top-gap">
          <span class="pill pill-muted">最近记录 {{ latestRunRecord ? `#${latestRunRecord.id}` : '--' }}</span>
          <span class="pill pill-muted">最近状态 {{ latestRunRecord ? formatRunStatus(latestRunRecord.status) : '--' }}</span>
        </div>

        <div v-if="!selectedTaskInstance" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">请先在任务模板页选择任务实例。</p>
        </div>

        <div v-else-if="!runHistory.length" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">当前实例暂无执行记录。</p>
        </div>

        <div v-else class="table-shell top-gap">
          <table>
            <thead>
              <tr>
                <th>记录ID</th>
                <th>状态</th>
                <th>时间</th>
                <th>摘要</th>
                <th>结果</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in runHistory" :key="item.id">
                <td>#{{ item.id }}</td>
                <td>{{ formatRunStatus(item.status) }}</td>
                <td>{{ item.createdAt || '--' }}</td>
                <td>{{ item.summary?.assessmentName || item.summary?.message || '--' }}</td>
                <td>{{ item.hasResult ? '可回看' : '--' }}</td>
                <td>
                  <button
                    class="button button-ghost"
                    :disabled="!item.hasResult"
                    @click="handleReplayRun(item.id)"
                  >
                    {{ Number(state.activeResultRunId) === Number(item.id) ? '当前结果' : '回看结果' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>

    <article class="capability-result-shell planning-execution-results-shell">
      <div v-if="!state.results" class="detail-card compact-empty-state">
        <p class="muted-text">尚未执行任务规划。执行完成后，每个算法结果会在下方生成独立页面入口。</p>
      </div>

      <template v-else>
        <div class="stats-strip compact-grid four-up">
          <div class="mini-stat">
            <span>完成步骤</span>
            <strong>{{ executionSummary.completedSteps }}</strong>
          </div>
          <div class="mini-stat">
            <span>内置执行</span>
            <strong>{{ executionSummary.builtinSteps }}</strong>
          </div>
          <div class="mini-stat">
            <span>外部执行</span>
            <strong>{{ executionSummary.externalSteps }}</strong>
          </div>
          <div class="mini-stat">
            <span>占位步骤</span>
            <strong>{{ executionSummary.placeholderSteps }}</strong>
          </div>
        </div>

        <div class="planning-execution-package-grid top-gap">
          <article v-for="item in packageCards" :key="item.key" class="detail-card planning-output-package-card">
            <div>
              <span class="eyebrow">{{ item.title }}</span>
              <h4>{{ item.format }}</h4>
              <p class="muted-text">{{ item.label }}</p>
              <small>{{ item.meta }}</small>
            </div>
            <button class="button button-ghost" :disabled="!item.enabled" @click="item.action">
              {{ item.actionLabel }}
            </button>
          </article>
        </div>

        <article class="capability-stage-card top-gap">
          <div class="section-heading compact">
            <div>
              <h3>分算法执行结果</h3>
              <p>每张卡片对应一个算法执行结果页面，进入后只展示该算法自己的输出、证据和结构化数据。</p>
            </div>
          </div>

          <div class="planning-result-step-grid top-gap">
            <article
              v-for="item in resultStepCards"
              :key="item.stepId"
              class="planning-result-step-card"
              :class="{ 'planning-result-step-card--pending': !item.isImplemented }"
            >
              <div class="planning-result-step-card__head">
                <span class="pill pill-active">步骤 {{ item.order }}</span>
                <span class="pill pill-muted">{{ item.status }}</span>
              </div>
              <h4>{{ item.stepName }}</h4>
              <p>{{ item.algorithm.name }}</p>
              <strong>{{ item.metric }}</strong>
              <small>{{ item.binding.name }} / {{ formatVariantType(item.binding.type) }}</small>
              <ul class="action-text-list top-gap">
                <li v-for="preview in item.preview.slice(0, 3)" :key="preview">{{ preview }}</li>
              </ul>
              <button class="button button-secondary" :disabled="!item.isImplemented" @click="openStepResult(item)">
                查看本算法结果
              </button>
            </article>
          </div>
        </article>
      </template>
    </article>
  </section>
</template>
