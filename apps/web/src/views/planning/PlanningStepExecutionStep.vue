<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api';
import PlanningAlgorithmConfigPanel from '../../components/PlanningAlgorithmConfigPanel.vue';
import PlanningExecutionStreamMonitor from '../../components/PlanningExecutionStreamMonitor.vue';
import PlanningSingleAlgorithmResultPanel from '../../components/PlanningSingleAlgorithmResultPanel.vue';
import { usePlanningWorkflow } from '../../modules/planningWorkflow';

const {
  state,
  algorithmLibrary,
  taskOptions,
  taskInstances,
  selectedTaskInstance,
  stepExecutionSelectedAlgorithm,
  stepExecutionSelectedStep,
  stepExecutionSelectedVariant,
  stepExecutionRequiredUpstreamIds,
  stepExecutionOptionalUpstreamIds,
  createPlanningTaskInstance,
  selectTaskInstance,
  loadStepExecutionUpstreamResults,
  loadStepExecutionArtifact,
  renamePlanningRealtimeArtifact,
  deletePlanningRealtimeArtifacts,
  executePlanningRealtimeStep,
  terminatePlanningRealtimeStep,
  setStepExecutionView,
  setStepExecutionAlgorithm,
  setStepExecutionBinding,
  setStepExecutionUpstreamQuery,
  selectStepExecutionInputResult,
} = usePlanningWorkflow();

const stepExecution = computed(() => state.stepExecution);
const selectedAlgorithmId = computed(() => stepExecutionSelectedAlgorithm.value?.id || '');
const upstreamSlotIds = computed(() => [
  ...stepExecutionRequiredUpstreamIds.value.map((algorithmId) => ({ algorithmId, required: true })),
  ...stepExecutionOptionalUpstreamIds.value.map((algorithmId) => ({ algorithmId, required: false })),
]);
const selectedInputRefs = computed(() => stepExecution.value.inputResultRefsByAlgorithm || {});
const streamState = computed(() => stepExecution.value.executionStream || {});
const streamPanelVisible = computed(() => Boolean(
  streamState.value.active
  || streamState.value.done
  || streamState.value.terminalLines?.length
  || streamState.value.llmChunks?.length
  || streamState.value.stepStates?.length,
));
const currentResultStep = computed(() => (
  stepExecution.value.latestResult?.step
  || stepExecution.value.selectedArtifact?.resultPayload?.step
  || null
));
const currentResultGeneratedAt = computed(() => (
  stepExecution.value.latestResult?.generatedAt
  || stepExecution.value.selectedArtifact?.resultPayload?.generatedAt
  || stepExecution.value.selectedArtifact?.updatedAt
  || ''
));
const currentAlgorithmHistory = computed(() => stepExecution.value.upstreamResults
  .filter((item) => item.algorithmId === selectedAlgorithmId.value));
const canTerminateStepExecution = computed(() => Boolean(stepExecution.value.calculating || streamState.value.active));
const selectedArtifactIds = ref([]);
const realtimeAlgorithmHistory = computed(() => currentAlgorithmHistory.value
  .filter((item) => item.sourceType === 'realtime-artifact' && Number.isInteger(Number(item.artifactId))));
const realtimeAlgorithmArtifactIds = computed(() => realtimeAlgorithmHistory.value
  .map((item) => Number(item.artifactId))
  .filter((id) => Number.isInteger(id) && id > 0));
const realtimeAlgorithmArtifactIdSet = computed(() => new Set(realtimeAlgorithmArtifactIds.value));
const selectedArtifactIdSet = computed(() => new Set(selectedArtifactIds.value
  .map((id) => Number(id))
  .filter((id) => realtimeAlgorithmArtifactIdSet.value.has(id))));
const selectedArtifactCount = computed(() => selectedArtifactIdSet.value.size);
const allRealtimeArtifactsSelected = computed(() => Boolean(
  realtimeAlgorithmArtifactIds.value.length
  && realtimeAlgorithmArtifactIds.value.every((id) => selectedArtifactIdSet.value.has(id)),
));

function algorithmName(algorithmId) {
  return algorithmLibrary.value.find((item) => item.id === algorithmId)?.name || algorithmId || '--';
}

function upstreamResultsFor(algorithmId) {
  return stepExecution.value.upstreamResults.filter((item) => item.algorithmId === algorithmId);
}

function selectedRefKey(algorithmId) {
  const ref = selectedInputRefs.value[algorithmId];
  if (!ref) return '';
  if (ref.sourceType === 'realtime-artifact') return `realtime-artifact:${ref.id || ref.artifactId}`;
  return `task-run-step:${ref.taskId}:${ref.runId}:${ref.stepId || ref.algorithmId}`;
}

function resultOptionKey(result = {}) {
  if (result.sourceType === 'realtime-artifact') return `realtime-artifact:${result.artifactId}`;
  return `task-run-step:${result.taskId}:${result.runId}:${result.stepId || result.algorithmId}`;
}

function resultRefWithAlgorithm(result = {}) {
  return {
    ...(result.resultRef || {}),
    algorithmId: result.algorithmId,
  };
}

function handleSelectUpstreamResult(algorithmId, value) {
  if (!value) {
    selectStepExecutionInputResult(algorithmId, null);
    return;
  }
  const result = upstreamResultsFor(algorithmId).find((item) => resultOptionKey(item) === value);
  selectStepExecutionInputResult(algorithmId, result ? resultRefWithAlgorithm(result) : null);
}

function isCrossTaskResult(result = {}) {
  return Boolean(selectedTaskInstance.value?.id && result.taskId && Number(result.taskId) !== Number(selectedTaskInstance.value.id));
}

function formatResultTime(value) {
  return value ? String(value).slice(0, 19).replace('T', ' ') : '--';
}

function formatResultSource(result = {}) {
  return result.sourceType === 'task-run-step' ? `任务历史 #${result.runId || '--'}` : `分步产物 #${result.artifactId || '--'}`;
}

function isRealtimeArtifactResult(result = {}) {
  const artifactId = Number(result.artifactId);
  return result.sourceType === 'realtime-artifact' && Number.isInteger(artifactId) && artifactId > 0;
}

function selectedHistoryKey() {
  const ref = stepExecution.value.selectedResultRef || {};
  if (ref.sourceType === 'realtime-artifact') {
    return `realtime-artifact:${ref.id || ref.artifactId}`;
  }
  if (ref.sourceType === 'task-run-step') {
    return `task-run-step:${ref.taskId}:${ref.runId}:${ref.stepId || ref.algorithmId}`;
  }
  return '';
}

function isActiveHistoryResult(result = {}) {
  return resultOptionKey(result) === selectedHistoryKey()
    || (
      result.sourceType === 'realtime-artifact'
      && stepExecution.value.currentArtifact?.id
      && Number(stepExecution.value.currentArtifact.id) === Number(result.artifactId)
    );
}

function toggleArtifactSelection(result = {}) {
  if (!isRealtimeArtifactResult(result)) return;
  const id = Number(result.artifactId);
  const selected = new Set([...selectedArtifactIdSet.value]);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  selectedArtifactIds.value = [...selected];
}

function toggleAllArtifacts() {
  selectedArtifactIds.value = allRealtimeArtifactsSelected.value ? [] : [...realtimeAlgorithmArtifactIds.value];
}

function selectedArtifactResults() {
  return realtimeAlgorithmHistory.value.filter((result) => selectedArtifactIdSet.value.has(Number(result.artifactId)));
}

function openedArtifactIds() {
  const ids = [
    Number(stepExecution.value.currentArtifact?.id),
    Number(stepExecution.value.selectedArtifact?.id),
  ];
  const ref = stepExecution.value.selectedResultRef || {};
  if (ref.sourceType === 'realtime-artifact') {
    ids.push(Number(ref.id || ref.artifactId));
  }
  return new Set(ids.filter((id) => Number.isInteger(id) && id > 0));
}

function buildArtifactDeleteConfirmMessage(ids = []) {
  const includesOpenedArtifact = ids.some((id) => openedArtifactIds().has(Number(id)));
  const openedArtifactText = includesOpenedArtifact
    ? '当前算法产物已打开，是否继续删除？\n\n'
    : '';
  return `${openedArtifactText}确定删除 ${ids.length} 个算法产物吗？删除后这些产物会从前置结果选择器中移除，旧引用不能再用于后续分步执行。`;
}

async function refreshUpstreamResults() {
  try {
    await loadStepExecutionUpstreamResults({ limit: 180 });
  } catch {
    // Shared state already holds the error message.
  }
}

async function handleCreateTaskInstance() {
  try {
    await createPlanningTaskInstance(taskOptions.value[0]?.id || state.selectedTaskId);
  } catch (error) {
    state.stepExecution.errorMessage = error.message || '创建规划任务实例失败。';
  }
}

async function handleTaskSelection(value) {
  const taskId = Number(value);
  if (!taskId) return;
  try {
    await selectTaskInstance(taskId, { loadLatestRun: true });
    await refreshUpstreamResults();
  } catch (error) {
    state.stepExecution.errorMessage = error.message || '切换规划任务实例失败。';
  }
}

async function handleExecuteStep() {
  try {
    await executePlanningRealtimeStep();
  } catch {
    // Shared state already holds the error message.
  }
}

function handleTerminateStepExecution() {
  terminatePlanningRealtimeStep();
}

async function handleOpenHistoryResult(result = {}) {
  try {
    if (result.sourceType === 'realtime-artifact' && result.artifactId) {
      await loadStepExecutionArtifact(result.artifactId);
      setStepExecutionView('run');
      return;
    }

    if (result.sourceType === 'task-run-step' && result.taskId && result.runId) {
      const detail = await api.getTaskRunDetail(result.taskId, result.runId);
      const step = (detail?.result?.resultPayload?.execution?.steps || []).find((item) => (
        item.stepId === result.stepId || item.algorithm?.id === result.algorithmId
      ));
      if (step) {
        state.stepExecution.latestResult = {
          generatedAt: detail?.result?.resultPayload?.generatedAt || detail?.result?.createdAt || '',
          step,
        };
        state.stepExecution.selectedArtifact = null;
        state.stepExecution.selectedResultRef = resultRefWithAlgorithm(result);
        setStepExecutionView('run');
      }
    }
  } catch (error) {
    state.stepExecution.errorMessage = error.message || '读取历史算法结果失败。';
  }
}

async function handleRenameHistoryResult(result = {}) {
  if (!isRealtimeArtifactResult(result)) {
    state.stepExecution.errorMessage = '任务历史结果随完整任务归档保存，不能单独重命名；如需移除请删除所属任务实例。';
    return;
  }

  const nextName = window.prompt('请输入新的算法产物名称', result.displayName || '');
  if (nextName === null) return;
  const trimmed = nextName.trim();
  if (!trimmed) {
    state.stepExecution.errorMessage = '算法产物名称不能为空。';
    return;
  }

  try {
    await renamePlanningRealtimeArtifact(result.artifactId, trimmed);
  } catch (error) {
    state.stepExecution.errorMessage = error.message || '重命名算法产物失败。';
  }
}

async function handleDeleteArtifactResults(results = []) {
  const ids = [...new Set(results
    .filter(isRealtimeArtifactResult)
    .map((result) => Number(result.artifactId))
    .filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) {
    state.stepExecution.errorMessage = '任务历史结果随完整任务归档保存，不能单独删除；如需移除请删除所属任务实例。';
    return;
  }

  const confirmed = window.confirm(buildArtifactDeleteConfirmMessage(ids));
  if (!confirmed) return;

  try {
    const response = await deletePlanningRealtimeArtifacts(ids);
    const deletedIds = Array.isArray(response?.deletedArtifactIds) ? response.deletedArtifactIds.map((id) => Number(id)) : ids;
    selectedArtifactIds.value = selectedArtifactIds.value.filter((id) => !deletedIds.includes(Number(id)));
    const missingIds = Array.isArray(response?.missingArtifactIds) ? response.missingArtifactIds : [];
    if (missingIds.length) {
      state.stepExecution.errorMessage = `已删除 ${response?.deletedCount || 0} 个算法产物；产物 #${missingIds.join('、#')} 已不存在，已自动跳过。`;
    }
  } catch (error) {
    state.stepExecution.errorMessage = error.message || '删除算法产物失败。';
  }
}

function handleDeleteSelectedArtifacts() {
  return handleDeleteArtifactResults(selectedArtifactResults());
}

onMounted(async () => {
  if (!state.stepExecution.selectedAlgorithmId && algorithmLibrary.value[0]?.id) {
    setStepExecutionAlgorithm(algorithmLibrary.value[0].id);
  }
  await refreshUpstreamResults();
});
</script>

<template>
  <section class="capability-stage action-stage planning-step-execution-page">
    <article class="capability-stage-card planning-step-execution-head">
      <div>
        <span class="eyebrow">Step Execution</span>
        <h3>分步执行</h3>
        <p>选择单个规划算法，接入跨任务前置结果并独立运行，执行产物可继续作为后续算法输入。</p>
      </div>

      <div class="segmented-row segmented-row--compact">
        <button
          class="segmented"
          :class="{ active: stepExecution.activeView === 'config' }"
          @click="setStepExecutionView('config')"
        >
          配置
        </button>
        <button
          class="segmented"
          :class="{ active: stepExecution.activeView === 'run' }"
          @click="setStepExecutionView('run')"
        >
          运行与结果
        </button>
      </div>
    </article>

    <article class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>任务挂靠与全局前置结果</h3>
        </div>
        <div class="planning-task-actions">
          <button class="button button-ghost" :disabled="stepExecution.upstreamResultsLoading" @click="refreshUpstreamResults">
            {{ stepExecution.upstreamResultsLoading ? '刷新中...' : '刷新前置结果' }}
          </button>
          <button class="button button-secondary" :disabled="selectedTaskInstance" @click="handleCreateTaskInstance">创建任务实例</button>
        </div>
      </div>

      <div class="form-grid capability-stage-form top-gap">
        <label>
          当前任务实例
          <select :value="selectedTaskInstance?.id || ''" @change="handleTaskSelection($event.target.value)">
            <option value="">请选择任务实例</option>
            <option v-for="task in taskInstances" :key="task.id" :value="task.id">
              #{{ task.id }} {{ task.name }}
            </option>
          </select>
        </label>
        <label>
          搜索前置结果
          <input
            :value="stepExecution.upstreamQuery"
            type="search"
            placeholder="任务名 / 算法名 / 结果名"
            @input="setStepExecutionUpstreamQuery($event.target.value)"
            @change="refreshUpstreamResults"
          />
        </label>
      </div>

      <p v-if="!selectedTaskInstance" class="auth-error capability-inline-error top-gap">
        分步执行必须挂靠一个规划任务实例，用于任务上下文、权限和产物归档。
      </p>
      <p v-if="stepExecution.errorMessage" class="auth-error capability-inline-error top-gap">{{ stepExecution.errorMessage }}</p>
    </article>

    <template v-if="stepExecution.activeView === 'config'">
      <PlanningAlgorithmConfigPanel
        show-algorithm-select
        show-variant-select
        :algorithm-id="stepExecutionSelectedAlgorithm?.id || ''"
        :variant-id="stepExecutionSelectedVariant?.id || ''"
        @update:algorithm-id="setStepExecutionAlgorithm"
        @update:variant-id="setStepExecutionBinding"
      />

      <article class="capability-stage-card">
        <div class="section-heading compact">
          <div>
            <h3>前置算法结果</h3>
            <p>结果来自当前账号可访问的跨任务全局产物；每类前置算法最多选择一个结果。</p>
          </div>
          <span class="pill pill-muted">当前算法 {{ stepExecutionSelectedAlgorithm?.name || '--' }}</span>
        </div>

        <div v-if="!upstreamSlotIds.length" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">当前算法不需要前置算法结果，可直接配置并运行。</p>
        </div>

        <div v-else class="planning-step-upstream-grid top-gap">
          <article
            v-for="slot in upstreamSlotIds"
            :key="slot.algorithmId"
            class="detail-card planning-step-upstream-card"
          >
            <div class="planning-step-upstream-card__head">
              <div>
                <span class="eyebrow">{{ slot.required ? '必选前置' : '可选前置' }}</span>
                <h4>{{ algorithmName(slot.algorithmId) }}</h4>
              </div>
              <span class="pill" :class="selectedInputRefs[slot.algorithmId] ? 'pill-active' : 'pill-muted'">
                {{ selectedInputRefs[slot.algorithmId] ? '已选择' : '未选择' }}
              </span>
            </div>

            <label class="top-gap">
              选择结果
              <select :value="selectedRefKey(slot.algorithmId)" @change="handleSelectUpstreamResult(slot.algorithmId, $event.target.value)">
                <option value="">不选择</option>
                <option
                  v-for="result in upstreamResultsFor(slot.algorithmId)"
                  :key="resultOptionKey(result)"
                  :value="resultOptionKey(result)"
                >
                  {{ result.displayName }} / {{ result.taskName || '未命名任务' }} / {{ formatResultSource(result) }} / {{ formatResultTime(result.updatedAt) }}
                </option>
              </select>
            </label>

            <div v-if="upstreamResultsFor(slot.algorithmId).some(isCrossTaskResult)" class="chip-row top-gap">
              <span class="pill pill-muted">含跨任务结果，请确认上下文一致</span>
            </div>
            <p v-if="!upstreamResultsFor(slot.algorithmId).length" class="muted-text top-gap">暂无该算法的可选结果。</p>
          </article>
        </div>
      </article>
    </template>

    <template v-else>
      <article class="capability-stage-card planning-step-run-deck">
        <div class="section-heading compact">
          <div>
            <h3>{{ stepExecutionSelectedAlgorithm?.name || '分步执行算法' }}</h3>
            <p>{{ stepExecutionSelectedStep?.objective || '单算法运行与结果展示。' }}</p>
          </div>
          <div class="planning-task-actions">
            <button class="button" :disabled="stepExecution.calculating || !selectedTaskInstance" @click="handleExecuteStep">
              {{ stepExecution.calculating ? '执行中...' : '执行当前算法' }}
            </button>
            <button class="button button-danger" :disabled="!canTerminateStepExecution" @click="handleTerminateStepExecution">终止任务</button>
            <button class="button button-ghost" @click="setStepExecutionView('config')">返回配置</button>
          </div>
        </div>

        <div class="capability-stage-pill-row top-gap">
          <span class="pill pill-active">{{ stepExecutionSelectedVariant?.name || '--' }}</span>
          <span class="pill pill-muted">挂靠任务 {{ selectedTaskInstance ? `#${selectedTaskInstance.id}` : '未选择' }}</span>
          <span class="pill pill-muted">前置结果 {{ Object.keys(selectedInputRefs).length }}</span>
        </div>
      </article>

      <PlanningExecutionStreamMonitor
        v-if="streamPanelVisible"
        title="分步执行监控"
        run-label="Step"
        :stream-state="streamState"
      />

      <article class="capability-stage-card">
        <div class="section-heading compact">
          <div>
            <h3>当前算法产物</h3>
          </div>
          <div class="planning-task-actions">
            <span class="pill pill-muted">{{ currentAlgorithmHistory.length }} 条历史</span>
            <button class="button button-ghost" :disabled="!realtimeAlgorithmArtifactIds.length" @click="toggleAllArtifacts">
              {{ allRealtimeArtifactsSelected ? '取消全选' : '全选产物' }}
            </button>
            <button class="button button-danger" :disabled="!selectedArtifactCount" @click="handleDeleteSelectedArtifacts">
              {{ selectedArtifactCount ? `删除所选 (${selectedArtifactCount})` : '删除所选' }}
            </button>
          </div>
        </div>

        <div v-if="currentAlgorithmHistory.length" class="planning-step-history-grid top-gap">
          <article
            v-for="result in currentAlgorithmHistory"
            :key="resultOptionKey(result)"
            class="planning-step-history-card"
            :class="{ active: isActiveHistoryResult(result) }"
          >
            <div class="planning-step-history-card__head">
              <label
                class="planning-task-select planning-step-history-select"
                :class="{ disabled: !isRealtimeArtifactResult(result) }"
              >
                <input
                  type="checkbox"
                  :checked="selectedArtifactIdSet.has(Number(result.artifactId))"
                  :disabled="!isRealtimeArtifactResult(result)"
                  @change="toggleArtifactSelection(result)"
                />
                <span class="pill" :class="isRealtimeArtifactResult(result) ? 'pill-active' : 'pill-muted'">
                  {{ isRealtimeArtifactResult(result) ? '可管理' : '归档' }}
                </span>
              </label>
              <em v-if="isCrossTaskResult(result)">跨任务</em>
            </div>
            <button
              type="button"
              class="planning-step-history-card__body"
              @click="handleOpenHistoryResult(result)"
            >
              <strong>{{ result.displayName }}</strong>
              <span>{{ result.taskName || '未命名任务' }}</span>
              <small>{{ formatResultSource(result) }} / {{ formatResultTime(result.updatedAt) }}</small>
            </button>
            <div class="planning-step-history-card__actions">
              <button
                class="button button-secondary"
                :disabled="!isRealtimeArtifactResult(result)"
                :title="isRealtimeArtifactResult(result) ? '重命名算法产物' : '任务历史结果不能单独重命名'"
                @click="handleRenameHistoryResult(result)"
              >
                重命名
              </button>
              <button
                class="button button-danger"
                :disabled="!isRealtimeArtifactResult(result)"
                :title="isRealtimeArtifactResult(result) ? '删除算法产物' : '任务历史结果不能单独删除'"
                @click="handleDeleteArtifactResults([result])"
              >
                删除
              </button>
            </div>
          </article>
        </div>
        <p v-else class="muted-text top-gap">当前算法暂无历史产物。</p>
      </article>

      <PlanningSingleAlgorithmResultPanel
        v-if="currentResultStep"
        :step="currentResultStep"
        :generated-at="currentResultGeneratedAt"
      />
      <article v-else class="detail-card compact-empty-state">
        <p class="muted-text">尚未生成或选择当前算法结果。</p>
      </article>
    </template>
  </section>
</template>
