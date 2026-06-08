<script setup>
import { computed, ref } from 'vue';
import { api } from '../../api';
import { usePlanningWorkflow } from '../../modules/planningWorkflow';

const {
  state,
  algorithmLibrary,
  sourceOptions,
  intelligenceRecords,
  environmentRecords,
  resourceSummary,
  workflowSummary,
  setAssessmentName,
  setAlgorithmBuiltinMethod,
  toggleAlgorithmSource,
  updateAlgorithmOptions,
  updateAlgorithmRuntimeOptions,
  addAlgorithmFiles,
  removeAlgorithmFile,
  getAlgorithmInput,
  formatVariantType,
  formatStatusLabel,
  getAlgorithmUsageCount,
} = usePlanningWorkflow();

const localFileAccept = '.doc,.docx,.pdf,.xls,.xlsx,.csv,.txt';
const sourceDialogAlgorithmId = ref('');
const selectedAlgorithmId = ref('');
const llmTestState = ref({});
const llmRuntimeFieldKeys = new Set(['llmBackend', 'llmApiKey', 'llmBaseUrl', 'llmModel', 'ollamaHost', 'openaiBaseUrl', 'openaiApiKey', 'llmMaxTokens']);

const sourceDialogAlgorithm = computed(() => algorithmLibrary.value.find((item) => item.id === sourceDialogAlgorithmId.value) || null);
const selectedAlgorithm = computed(() => algorithmLibrary.value.find((item) => item.id === selectedAlgorithmId.value) || null);
const selectedExternalVariants = computed(() => (selectedAlgorithm.value?.variants || []).filter((item) => item.type === 'external-model'));

function countActiveVariants(algorithm) {
  return (algorithm.variants || []).filter((item) => item.status === 'active').length;
}

function resolveInput(algorithmId) {
  return getAlgorithmInput(algorithmId);
}

function resolveRuntimeOptions(algorithmId, runtimeKey) {
  return resolveInput(algorithmId).options?.runtimeOptions?.[runtimeKey] || {};
}

function resolveRuntimeDefaults(variant) {
  const fieldDefaults = Object.fromEntries(
    (variant?.parameterSchema || [])
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue]),
  );
  return {
    ...(variant?.defaultOptions || {}),
    ...fieldDefaults,
  };
}

function resolveMergedRuntimeOptions(algorithmId, variant) {
  return {
    ...resolveRuntimeDefaults(variant),
    ...resolveRuntimeOptions(algorithmId, variant.runtimeKey),
  };
}

function resolveRuntimeFieldValue(algorithmId, variant, field) {
  const runtimeOptions = resolveRuntimeOptions(algorithmId, variant.runtimeKey);
  const value = runtimeOptions[field.key];
  return value === undefined ? field.defaultValue : value;
}

function parseRuntimeFieldValue(field, rawValue) {
  if (field.type === 'number') {
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : Number(field.defaultValue || 0);
  }
  if (field.type === 'boolean') return Boolean(rawValue);
  return rawValue;
}

function updateRuntimeField(algorithmId, variant, field, rawValue) {
  updateAlgorithmRuntimeOptions(algorithmId, variant.runtimeKey, {
    [field.key]: parseRuntimeFieldValue(field, rawValue),
  });
}

function llmTestKey(algorithmId, variant) {
  return `${algorithmId}:${variant?.runtimeKey || variant?.id || ''}`;
}

function resolveLlmTestStatus(algorithmId, variant) {
  return llmTestState.value[llmTestKey(algorithmId, variant)] || null;
}

function formatLlmTestError(error) {
  if (error?.status === 404 && String(error?.message || '').includes('接口不存在')) {
    return '大模型测试接口未加载，请重启后端服务后重试。';
  }
  return error?.message || '大模型配置测试失败。';
}

async function testRuntimeLlm(algorithmId, variant) {
  const key = llmTestKey(algorithmId, variant);
  llmTestState.value = {
    ...llmTestState.value,
    [key]: { status: 'running', message: '正在测试大模型接口...' },
  };
  try {
    const result = await api.testPlanningLlm({
      algorithmId,
      variantId: variant.id,
      runtimeKey: variant.runtimeKey,
      runtimeOptions: resolveMergedRuntimeOptions(algorithmId, variant),
    });
    llmTestState.value = {
      ...llmTestState.value,
      [key]: {
        status: 'success',
        message: `测试通过，${result.latencyMs || 0}ms，返回 ${result.responseLength || 0} 字符。`,
        preview: result.preview || '',
      },
    };
  } catch (error) {
    llmTestState.value = {
      ...llmTestState.value,
      [key]: {
        status: 'error',
        message: formatLlmTestError(error),
      },
    };
  }
}

function isLlmRuntimeField(field) {
  return field?.section === 'llm' || llmRuntimeFieldKeys.has(field?.key);
}

function runtimeCoreFields(variant) {
  return (variant?.parameterSchema || []).filter((field) => !isLlmRuntimeField(field));
}

function runtimeLlmFields(variant) {
  return (variant?.parameterSchema || []).filter((field) => isLlmRuntimeField(field));
}

function isExternalOnlyLlmField(field) {
  return ['llmApiKey', 'llmBaseUrl', 'openaiApiKey', 'openaiBaseUrl'].includes(field?.key);
}

function isInternalOnlyLlmField(field) {
  return ['ollamaHost', 'ollama_host'].includes(field?.key);
}

function visibleRuntimeLlmFields(algorithmId, variant) {
  const runtimeOptions = resolveMergedRuntimeOptions(algorithmId, variant);
  const backend = String(runtimeOptions.llmBackend || 'openai-compatible').toLowerCase();
  return runtimeLlmFields(variant).filter((field) => {
    if (isInternalOnlyLlmField(field)) return false;
    if (isExternalOnlyLlmField(field)) return backend !== 'ollama';
    return true;
  });
}

function hasInputMode(algorithm, mode) {
  return (algorithm.supportedInputModes || []).includes(mode);
}

function resolveSourceStats(sourceId) {
  const intelligence = intelligenceRecords.value.filter((item) => Number(item.sourceId) === Number(sourceId));
  const environment = environmentRecords.value.filter((item) => Number(item.sourceId) === Number(sourceId));
  const redCount = intelligence.filter((item) => item.camp === 'red').length;
  const blueCount = intelligence.filter((item) => item.camp === 'blue').length;

  return {
    redCount,
    blueCount,
    environmentCount: environment.length,
  };
}

function resolveSelectedSourceNames(algorithmId) {
  const input = resolveInput(algorithmId);
  return sourceOptions.value
    .filter((source) => input.selectedSourceIds.includes(Number(source.id)))
    .map((source) => source.name);
}

function updateSupportDamageForecast(algorithmId, field, value) {
  const options = resolveInput(algorithmId).options || {};
  const current = options.damageForecast || {};
  updateAlgorithmOptions(algorithmId, {
    damageForecast: {
      ...current,
      [field]: value,
    },
  });
}

function updateSupportResourceStock(algorithmId, field, value) {
  const options = resolveInput(algorithmId).options || {};
  const current = options.resourcePool || {};
  updateAlgorithmOptions(algorithmId, {
    resourcePool: {
      ...current,
      stock: {
        ...(current.stock || {}),
        [field]: value,
      },
      transport: {
        ...(current.transport || {}),
      },
    },
  });
}

function updateSupportResourceTransport(algorithmId, field, value) {
  const options = resolveInput(algorithmId).options || {};
  const current = options.resourcePool || {};
  updateAlgorithmOptions(algorithmId, {
    resourcePool: {
      ...current,
      stock: {
        ...(current.stock || {}),
      },
      transport: {
        ...(current.transport || {}),
        [field]: value,
      },
    },
  });
}

function openAlgorithmDetail(algorithmId) {
  selectedAlgorithmId.value = algorithmId;
}

function clearSelectedAlgorithm() {
  selectedAlgorithmId.value = '';
}

function openSourceDialog(algorithmId) {
  sourceDialogAlgorithmId.value = algorithmId;
}

function closeSourceDialog() {
  sourceDialogAlgorithmId.value = '';
}

async function handleFileChange(algorithmId, event) {
  const files = event.target.files;
  if (!files?.length) return;

  try {
    await addAlgorithmFiles(algorithmId, files);
  } catch {
    // Shared state already stores the message.
  } finally {
    event.target.value = '';
  }
}
</script>

<template>
  <section class="capability-stage action-stage">
    <article class="capability-stage-card">
      <div class="form-grid capability-stage-form">
        <label class="full-span">
          规划任务名称
          <input
            :value="state.assessmentName"
            type="text"
            placeholder="请输入规划任务名称"
            @input="setAssessmentName($event.target.value)"
          />
        </label>
      </div>

      <div class="capability-stage-pill-row top-gap">
        <span class="pill pill-active">算法 {{ workflowSummary.algorithmCount }}</span>
        <span class="pill pill-muted">已实现 {{ workflowSummary.implementedAlgorithmCount }}</span>
        <span class="pill pill-muted">数据源 {{ resourceSummary.sourceCount }}</span>
        <span class="pill pill-muted">红方情报 {{ resourceSummary.redIntelligenceCount }}</span>
        <span class="pill pill-muted">蓝方情报 {{ resourceSummary.blueIntelligenceCount }}</span>
      </div>
    </article>

    <article v-if="!selectedAlgorithm" class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>算法列表</h3>
        </div>
      </div>

      <div class="action-task-grid top-gap">
        <article
          v-for="algorithm in algorithmLibrary"
          :key="algorithm.id"
          class="action-template-card planning-algorithm-list-card"
          @click="openAlgorithmDetail(algorithm.id)"
        >
          <div class="action-template-card__head">
            <div>
              <span class="pill pill-active">{{ algorithm.category }}</span>
              <h4>{{ algorithm.name }}</h4>
            </div>
            <span class="pill pill-muted">任务使用 {{ getAlgorithmUsageCount(algorithm.id) }}</span>
          </div>

          <div class="chip-row">
            <span class="pill pill-muted">{{ algorithm.implementationStatus === 'implemented' ? '已实现' : '规划中' }}</span>
            <span class="pill pill-muted">可用实现 {{ countActiveVariants(algorithm) }}</span>
            <span class="pill pill-muted">输入模式 {{ algorithm.supportedInputModes?.length || 0 }}</span>
          </div>

          <div class="planning-algorithm-list-card__footer">
            <button class="button button-ghost" @click.stop="openAlgorithmDetail(algorithm.id)">查看详情</button>
          </div>
        </article>
      </div>
    </article>

    <article v-if="selectedAlgorithm" class="capability-stage-card">
      <div class="planning-algorithm-detail-shell">
        <div class="section-heading compact">
          <div>
            <h3>{{ selectedAlgorithm.name }}</h3>
          </div>

          <div class="planning-task-actions">
            <span class="pill pill-active">{{ selectedAlgorithm.category }}</span>
            <button class="button button-ghost" @click="clearSelectedAlgorithm">返回算法列表</button>
          </div>
        </div>

        <article class="action-template-card planning-algorithm-detail-card top-gap">
          <div class="action-template-card__head">
            <div>
              <span class="pill pill-active">{{ selectedAlgorithm.category }}</span>
              <h4>{{ selectedAlgorithm.name }}</h4>
            </div>
            <span class="pill pill-muted">任务使用 {{ getAlgorithmUsageCount(selectedAlgorithm.id) }}</span>
          </div>

          <div class="action-template-card__stats">
            <div>
              <span>状态</span>
              <strong>{{ selectedAlgorithm.implementationStatus === 'implemented' ? '已实现' : '规划中' }}</strong>
            </div>
            <div>
              <span>可用实现</span>
              <strong>{{ countActiveVariants(selectedAlgorithm) }}</strong>
            </div>
            <div>
              <span>输入模式</span>
              <strong>{{ selectedAlgorithm.supportedInputModes?.length || 0 }}</strong>
            </div>
            <div>
              <span>外部工程</span>
              <strong>{{ selectedAlgorithm.variants?.filter((item) => item.type === 'external-model').length || 0 }}</strong>
            </div>
          </div>

          <div v-if="selectedExternalVariants.length" class="detail-card">
            <span class="eyebrow">外部算法工程参数</span>
            <div class="planning-runtime-config-list top-gap">
              <article
                v-for="variant in selectedExternalVariants"
                :key="variant.id"
                class="planning-runtime-config-card"
              >
                <div class="planning-runtime-config-card__head">
                  <div>
                    <strong>{{ variant.projectName || variant.name }}</strong>
                    <p>{{ variant.projectPath || variant.description }}</p>
                  </div>
                  <span class="pill" :class="variant.status === 'active' ? 'pill-active' : 'pill-muted'">
                    {{ formatStatusLabel(variant.status) }}
                  </span>
                </div>

                <div v-if="variant.projectAlgorithms?.length" class="chip-row top-gap">
                  <span
                    v-for="projectAlgorithm in variant.projectAlgorithms"
                    :key="`${variant.id}-${projectAlgorithm.key}`"
                    class="pill pill-muted"
                  >
                    {{ projectAlgorithm.name }}
                  </span>
                </div>

                <div v-if="runtimeCoreFields(variant).length" class="form-grid capability-stage-form planning-runtime-parameter-grid top-gap">
                  <label
                    v-for="field in runtimeCoreFields(variant)"
                    :key="`${variant.id}-${field.key}`"
                    :class="{ 'planning-runtime-toggle-field': field.type === 'boolean' }"
                  >
                    <template v-if="field.type === 'boolean'">
                      <input
                        type="checkbox"
                        :checked="Boolean(resolveRuntimeFieldValue(selectedAlgorithm.id, variant, field))"
                        @change="updateRuntimeField(selectedAlgorithm.id, variant, field, $event.target.checked)"
                      />
                      <span>{{ field.label }}</span>
                    </template>

                    <template v-else>
                      {{ field.label }}
                      <select
                        v-if="field.type === 'select'"
                        :value="resolveRuntimeFieldValue(selectedAlgorithm.id, variant, field)"
                        @change="updateRuntimeField(selectedAlgorithm.id, variant, field, $event.target.value)"
                      >
                        <option
                          v-for="option in field.options || []"
                          :key="`${field.key}-${option.value}`"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                      <input
                        v-else
                        :type="field.type === 'number' ? 'number' : (field.type === 'password' ? 'password' : 'text')"
                        :min="field.min"
                        :max="field.max"
                        :step="field.step"
                        :value="resolveRuntimeFieldValue(selectedAlgorithm.id, variant, field)"
                        @change="updateRuntimeField(selectedAlgorithm.id, variant, field, $event.target.value)"
                      />
                    </template>
                  </label>
                </div>

                <div v-if="visibleRuntimeLlmFields(selectedAlgorithm.id, variant).length" class="planning-runtime-llm-panel top-gap">
                  <div class="planning-runtime-llm-panel__head">
                    <div>
                      <strong>LLM 结构化抽取配置</strong>
                      <p>外部 OpenAI 兼容 API / 本地 Ollama，结果回显自动脱敏。</p>
                    </div>
                    <div class="planning-runtime-llm-panel__actions">
                      <span
                        v-if="resolveLlmTestStatus(selectedAlgorithm.id, variant)"
                        class="pill"
                        :class="resolveLlmTestStatus(selectedAlgorithm.id, variant).status === 'success' ? 'pill-active' : 'pill-muted'"
                      >
                        {{ resolveLlmTestStatus(selectedAlgorithm.id, variant).status === 'running' ? '测试中' : (resolveLlmTestStatus(selectedAlgorithm.id, variant).status === 'success' ? '已通过' : '未通过') }}
                      </span>
                      <button
                        class="button button-ghost"
                        type="button"
                        :disabled="resolveLlmTestStatus(selectedAlgorithm.id, variant)?.status === 'running'"
                        @click="testRuntimeLlm(selectedAlgorithm.id, variant)"
                      >
                        测试连接
                      </button>
                    </div>
                  </div>

                  <div class="form-grid capability-stage-form planning-runtime-parameter-grid planning-runtime-llm-grid top-gap">
                    <label
                      v-for="field in visibleRuntimeLlmFields(selectedAlgorithm.id, variant)"
                      :key="`${variant.id}-llm-${field.key}`"
                      :class="{ 'planning-runtime-toggle-field': field.type === 'boolean' }"
                    >
                      <template v-if="field.type === 'boolean'">
                        <input
                          type="checkbox"
                          :checked="Boolean(resolveRuntimeFieldValue(selectedAlgorithm.id, variant, field))"
                          @change="updateRuntimeField(selectedAlgorithm.id, variant, field, $event.target.checked)"
                        />
                        <span>{{ field.label }}</span>
                      </template>

                      <template v-else>
                        {{ field.label }}
                        <select
                          v-if="field.type === 'select'"
                          :value="resolveRuntimeFieldValue(selectedAlgorithm.id, variant, field)"
                          @change="updateRuntimeField(selectedAlgorithm.id, variant, field, $event.target.value)"
                        >
                          <option
                            v-for="option in field.options || []"
                            :key="`${field.key}-${option.value}`"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </option>
                        </select>
                        <input
                          v-else
                          :type="field.type === 'number' ? 'number' : (field.type === 'password' ? 'password' : 'text')"
                          :min="field.min"
                          :max="field.max"
                          :step="field.step"
                          :value="resolveRuntimeFieldValue(selectedAlgorithm.id, variant, field)"
                          @change="updateRuntimeField(selectedAlgorithm.id, variant, field, $event.target.value)"
                        />
                      </template>
                    </label>
                  </div>

                  <p
                    v-if="resolveLlmTestStatus(selectedAlgorithm.id, variant)"
                    class="planning-runtime-llm-status"
                    :class="`planning-runtime-llm-status--${resolveLlmTestStatus(selectedAlgorithm.id, variant).status}`"
                  >
                    {{ resolveLlmTestStatus(selectedAlgorithm.id, variant).message }}
                    <span v-if="resolveLlmTestStatus(selectedAlgorithm.id, variant).preview">
                      {{ resolveLlmTestStatus(selectedAlgorithm.id, variant).preview }}
                    </span>
                  </p>
                </div>

                <p v-if="!runtimeCoreFields(variant).length && !runtimeLlmFields(variant).length" class="muted-text top-gap">
                  该工程暂未声明可配置参数。
                </p>
              </article>
            </div>
          </div>

          <div class="detail-card">
            <span class="eyebrow">内置方法</span>
            <div class="form-grid capability-stage-form top-gap">
              <label class="full-span">
                当前方法
                <select
                  :value="resolveInput(selectedAlgorithm.id).builtinMethodKey"
                  @change="setAlgorithmBuiltinMethod(selectedAlgorithm.id, $event.target.value)"
                >
                  <option
                    v-for="method in selectedAlgorithm.builtinMethods || []"
                    :key="method.key"
                    :value="method.key"
                  >
                    {{ method.label }}
                  </option>
                </select>
              </label>
            </div>

            <div class="action-validation-issues top-gap">
              <article
                v-for="method in selectedAlgorithm.builtinMethods || []"
                :key="method.key"
                class="action-check-card"
                :class="method.key === resolveInput(selectedAlgorithm.id).builtinMethodKey ? 'pass' : 'warn'"
              >
                <strong>{{ method.label }}</strong>
                <p>{{ method.key === resolveInput(selectedAlgorithm.id).builtinMethodKey ? '当前方法' : '可选方法' }}</p>
                <small class="muted-text">{{ method.description }}</small>
              </article>
            </div>
          </div>

          <div v-if="hasInputMode(selectedAlgorithm, 'resource-library')" class="detail-card">
            <span class="eyebrow">数据源</span>
            <div class="planning-source-summary top-gap">
              <div>
                <strong>已选择 {{ resolveInput(selectedAlgorithm.id).selectedSourceIds.length }} 个数据源</strong>
                <p class="muted-text">
                  {{ resolveInput(selectedAlgorithm.id).selectedSourceIds.length ? '执行时仅使用已勾选的数据源。' : '未勾选数据源时不会使用资源库数据，可改为上传本地文件。' }}
                </p>
              </div>
              <button class="button button-ghost" @click="openSourceDialog(selectedAlgorithm.id)">选择数据源</button>
            </div>

            <div v-if="resolveSelectedSourceNames(selectedAlgorithm.id).length" class="chip-row top-gap">
              <span
                v-for="name in resolveSelectedSourceNames(selectedAlgorithm.id)"
                :key="`${selectedAlgorithm.id}-${name}`"
                class="pill pill-muted"
              >
                {{ name }}
              </span>
            </div>
          </div>

          <div v-if="hasInputMode(selectedAlgorithm, 'local-file')" class="detail-card">
            <span class="eyebrow">本地文件</span>
            <div class="form-grid capability-stage-form top-gap">
              <label class="full-span">
                上传 Word / PDF / Excel / CSV
                <input
                  type="file"
                  :accept="localFileAccept"
                  multiple
                  @change="handleFileChange(selectedAlgorithm.id, $event)"
                />
              </label>
            </div>

            <div v-if="resolveInput(selectedAlgorithm.id).uploadedFiles.length" class="action-validation-issues top-gap">
              <article
                v-for="file in resolveInput(selectedAlgorithm.id).uploadedFiles"
                :key="file.id"
                class="action-check-card pass"
              >
                <strong>{{ file.fileName }}</strong>
                <p>{{ file.fileExtension || '本地文件' }} / {{ Math.max(1, Math.round((file.size || 0) / 1024)) }} KB</p>
                <button class="button button-ghost" @click="removeAlgorithmFile(selectedAlgorithm.id, file.id)">移除</button>
              </article>
            </div>
            <p v-else class="muted-text top-gap">暂无本地文件。</p>
          </div>

          <div v-if="selectedAlgorithm.id === 'enemy-threat-analysis'" class="detail-card">
            <span class="eyebrow">分析偏好</span>
            <div class="form-grid capability-stage-form top-gap">
              <label>
                分析重点
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.analysisFocus"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { analysisFocus: $event.target.value })"
                >
                  <option value="comprehensive">综合敌情</option>
                  <option value="coverage">火力覆盖优先</option>
                  <option value="air-defense">防空体系优先</option>
                </select>
              </label>
              <label>
                热力图密度
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.heatmapDensity"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { heatmapDensity: $event.target.value })"
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
              </label>
              <label>
                影响评估倾向
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.impactBias"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { impactBias: $event.target.value })"
                >
                  <option value="balanced">均衡</option>
                  <option value="suppression">压制优先</option>
                  <option value="mobility">机动优先</option>
                </select>
              </label>
            </div>
          </div>

          <div v-else-if="selectedAlgorithm.id === 'force-grouping'" class="detail-card">
            <span class="eyebrow">编组偏好</span>
            <div class="form-grid capability-stage-form top-gap">
              <label>
                规则库
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.ruleLibraryKey"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { ruleLibraryKey: $event.target.value })"
                >
                  <option
                    v-for="ruleLibrary in selectedAlgorithm.ruleLibraries || []"
                    :key="ruleLibrary.key"
                    :value="ruleLibrary.key"
                  >
                    {{ ruleLibrary.label }}
                  </option>
                </select>
              </label>
              <label>
                约束模型
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.constraintModelKey"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { constraintModelKey: $event.target.value })"
                >
                  <option
                    v-for="constraintModel in selectedAlgorithm.constraintModels || []"
                    :key="constraintModel.key"
                    :value="constraintModel.key"
                  >
                    {{ constraintModel.label }}
                  </option>
                </select>
              </label>
              <label>
                对比侧重
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.comparisonFocus"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { comparisonFocus: $event.target.value })"
                >
                  <option value="balanced">均衡</option>
                  <option value="firepower-first">火力优先</option>
                  <option value="survivability-first">生存优先</option>
                </select>
              </label>
              <label>
                期望群组数
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.expectedGroupCount"
                  type="number"
                  min="3"
                  max="6"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { expectedGroupCount: Number($event.target.value || 4) })"
                />
              </label>
            </div>
          </div>

          <div v-else-if="selectedAlgorithm.id === 'target-allocation'" class="detail-card">
            <span class="eyebrow">分配偏好</span>
            <div class="form-grid capability-stage-form top-gap">
              <label>
                目标偏好
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.objectivePreference"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { objectivePreference: $event.target.value })"
                >
                  <option value="balanced">均衡</option>
                  <option value="firepower-first">火力优先</option>
                  <option value="survivability-first">生存优先</option>
                </select>
              </label>
              <label>
                验证模式
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.validationMode"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { validationMode: $event.target.value })"
                >
                  <option value="strict">严格</option>
                  <option value="standard">标准</option>
                </select>
              </label>
              <label>
                单编组最大分配数
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.maxAssignmentsPerGroup"
                  type="number"
                  min="1"
                  max="3"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { maxAssignmentsPerGroup: Number($event.target.value || 2) })"
                />
              </label>
            </div>
          </div>

          <div v-else-if="selectedAlgorithm.id === 'airborne-landing-site-selection'" class="detail-card">
            <span class="eyebrow">机降选址偏好</span>
            <div class="form-grid capability-stage-form top-gap">
              <label>
                选址侧重
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.sitePreference"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { sitePreference: $event.target.value })"
                >
                  <option value="balanced">均衡</option>
                  <option value="concealment">隐蔽优先</option>
                  <option value="safety">安全优先</option>
                  <option value="assembly">集结效率优先</option>
                </select>
              </label>
              <label>
                直升机型号
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.helicopterModel"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { helicopterModel: $event.target.value })"
                >
                  <option value="light-lift">轻型运输</option>
                  <option value="medium-lift">中型运输</option>
                  <option value="heavy-lift">重型运输</option>
                </select>
              </label>
              <label>
                候选点数量
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.candidateCount"
                  type="number"
                  min="3"
                  max="8"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { candidateCount: Number($event.target.value || 5) })"
                />
              </label>
            </div>
          </div>

          <div v-else-if="selectedAlgorithm.id === 'method-planning'" class="detail-card">
            <span class="eyebrow">路径规划偏好</span>
            <div class="form-grid capability-stage-form top-gap">
              <label>
                航路侧重
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.routePreference"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { routePreference: $event.target.value })"
                >
                  <option value="balanced">均衡</option>
                  <option value="speed">速度优先</option>
                  <option value="concealment">隐蔽优先</option>
                </select>
              </label>
              <label>
                高度剖面
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.altitudeProfile"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { altitudeProfile: $event.target.value })"
                >
                  <option value="terrain-following">贴地 / 顺地飞行</option>
                  <option value="medium">中空飞行</option>
                  <option value="high">高空飞行</option>
                </select>
              </label>
              <label>
                行动节奏
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.phaseTempo"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { phaseTempo: $event.target.value })"
                >
                  <option value="standard">标准</option>
                  <option value="aggressive">激进</option>
                  <option value="deliberate">稳健推进</option>
                </select>
              </label>
            </div>
          </div>

          <div v-else-if="selectedAlgorithm.id === 'support-planning'" class="detail-card">
            <span class="eyebrow">保障输入建模</span>
            <div class="form-grid capability-stage-form top-gap">
              <label>
                装备损失率（%）
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.equipmentLossRate"
                  type="number"
                  min="0"
                  max="60"
                  step="0.1"
                  @change="updateSupportDamageForecast(selectedAlgorithm.id, 'equipmentLossRate', Number($event.target.value || 0))"
                />
              </label>
              <label>
                人员伤亡率（%）
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.casualtyRate"
                  type="number"
                  min="0"
                  max="40"
                  step="0.1"
                  @change="updateSupportDamageForecast(selectedAlgorithm.id, 'casualtyRate', Number($event.target.value || 0))"
                />
              </label>
              <label>
                受损装备数
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.damagedEquipmentCount"
                  type="number"
                  min="0"
                  step="1"
                  @change="updateSupportDamageForecast(selectedAlgorithm.id, 'damagedEquipmentCount', Number($event.target.value || 0))"
                />
              </label>
              <label>
                伤员数
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.woundedCount"
                  type="number"
                  min="0"
                  step="1"
                  @change="updateSupportDamageForecast(selectedAlgorithm.id, 'woundedCount', Number($event.target.value || 0))"
                />
              </label>
              <label>
                关键窗口数
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.criticalWindowCount"
                  type="number"
                  min="1"
                  max="4"
                  step="1"
                  @change="updateSupportDamageForecast(selectedAlgorithm.id, 'criticalWindowCount', Number($event.target.value || 1))"
                />
              </label>
              <label>
                预备比例（%）
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.reserveRatio"
                  type="number"
                  min="8"
                  max="35"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { reserveRatio: Number($event.target.value || 18) })"
                />
              </label>
              <label>
                空域管控
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.airspaceControl"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { airspaceControl: $event.target.value })"
                >
                  <option value="standard">标准</option>
                  <option value="tight">严格隔离</option>
                  <option value="flexible">灵活协同</option>
                </select>
              </label>
            </div>

            <span class="eyebrow top-gap">保障资源池</span>
            <div class="form-grid capability-stage-form top-gap">
              <label>
                弹药库存
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.stock?.ammo"
                  type="number"
                  min="0"
                  step="0.1"
                  @change="updateSupportResourceStock(selectedAlgorithm.id, 'ammo', Number($event.target.value || 0))"
                />
              </label>
              <label>
                油料库存
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.stock?.fuel"
                  type="number"
                  min="0"
                  step="0.1"
                  @change="updateSupportResourceStock(selectedAlgorithm.id, 'fuel', Number($event.target.value || 0))"
                />
              </label>
              <label>
                维修工时库存
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.stock?.maintenance"
                  type="number"
                  min="0"
                  step="0.1"
                  @change="updateSupportResourceStock(selectedAlgorithm.id, 'maintenance', Number($event.target.value || 0))"
                />
              </label>
              <label>
                医疗批次库存
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.stock?.medical"
                  type="number"
                  min="0"
                  step="0.1"
                  @change="updateSupportResourceStock(selectedAlgorithm.id, 'medical', Number($event.target.value || 0))"
                />
              </label>
              <label>
                空域时隙库存
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.stock?.airspace"
                  type="number"
                  min="0"
                  step="0.1"
                  @change="updateSupportResourceStock(selectedAlgorithm.id, 'airspace', Number($event.target.value || 0))"
                />
              </label>
              <label>
                通信链路库存
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.stock?.command"
                  type="number"
                  min="0"
                  step="0.1"
                  @change="updateSupportResourceStock(selectedAlgorithm.id, 'command', Number($event.target.value || 0))"
                />
              </label>
            </div>

            <span class="eyebrow top-gap">投送与协同能力</span>
            <div class="form-grid capability-stage-form top-gap">
              <label>
                运输架次
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.transport?.sorties"
                  type="number"
                  min="0"
                  step="1"
                  @change="updateSupportResourceTransport(selectedAlgorithm.id, 'sorties', Number($event.target.value || 0))"
                />
              </label>
              <label>
                单架次载重（吨）
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.transport?.liftTonnagePerSortie"
                  type="number"
                  min="0"
                  step="0.1"
                  @change="updateSupportResourceTransport(selectedAlgorithm.id, 'liftTonnagePerSortie', Number($event.target.value || 0))"
                />
              </label>
              <label>
                维修分队
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.transport?.maintenanceTeams"
                  type="number"
                  min="0"
                  step="1"
                  @change="updateSupportResourceTransport(selectedAlgorithm.id, 'maintenanceTeams', Number($event.target.value || 0))"
                />
              </label>
              <label>
                医疗分队
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.transport?.medicalTeams"
                  type="number"
                  min="0"
                  step="1"
                  @change="updateSupportResourceTransport(selectedAlgorithm.id, 'medicalTeams', Number($event.target.value || 0))"
                />
              </label>
              <label>
                空域协同席位
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.transport?.airspaceCells"
                  type="number"
                  min="0"
                  step="1"
                  @change="updateSupportResourceTransport(selectedAlgorithm.id, 'airspaceCells', Number($event.target.value || 0))"
                />
              </label>
              <label>
                调度链路容量
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.transport?.commandLinks"
                  type="number"
                  min="0"
                  step="1"
                  @change="updateSupportResourceTransport(selectedAlgorithm.id, 'commandLinks', Number($event.target.value || 0))"
                />
              </label>
            </div>
          </div>

          <div v-else-if="selectedAlgorithm.id === '__support-planning-legacy__'" class="detail-card">
            <span class="eyebrow">保障调度偏好</span>
            <div class="form-grid capability-stage-form top-gap">
              <label>
                战损预期
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.damageExpectation"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { damageExpectation: $event.target.value })"
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
              </label>
              <label>
                预备比例
                <input
                  :value="resolveInput(selectedAlgorithm.id).options.reserveRatio"
                  type="number"
                  min="8"
                  max="35"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { reserveRatio: Number($event.target.value || 18) })"
                />
              </label>
              <label>
                空域控制
                <select
                  :value="resolveInput(selectedAlgorithm.id).options.airspaceControl"
                  @change="updateAlgorithmOptions(selectedAlgorithm.id, { airspaceControl: $event.target.value })"
                >
                  <option value="standard">标准</option>
                  <option value="tight">严格隔离</option>
                  <option value="flexible">灵活协同</option>
                </select>
              </label>
            </div>
          </div>

          <div v-if="selectedAlgorithm.implementationStatus !== 'implemented'" class="detail-card">
            <span class="eyebrow">状态</span>
            <p class="muted-text top-gap">当前仅保留算法信息，尚未开放完整配置。</p>
          </div>

          <div class="detail-card">
            <span class="eyebrow">实现列表</span>
            <div class="action-validation-issues top-gap">
              <article
                v-for="variant in selectedAlgorithm.variants || []"
                :key="variant.id"
                class="action-check-card"
                :class="variant.status === 'active' ? 'pass' : 'warn'"
              >
                <strong>{{ variant.name }}</strong>
                <p>{{ formatVariantType(variant.type) }} / {{ formatStatusLabel(variant.status) }}</p>
                <p v-if="variant.projectPath" class="muted-text">{{ variant.projectPath }}</p>
                <small class="muted-text">{{ variant.description }}</small>
              </article>
            </div>
          </div>
        </article>
      </div>
    </article>

    <div
      v-if="sourceDialogAlgorithm"
      class="planning-dialog-backdrop"
      @click.self="closeSourceDialog"
    >
      <section class="planning-dialog-shell glass-card">
        <div class="section-heading compact">
          <div>
            <h3>{{ sourceDialogAlgorithm.name }}</h3>
          </div>
          <button class="button button-ghost" @click="closeSourceDialog">关闭</button>
        </div>

        <div class="planning-source-grid top-gap">
          <article
            v-for="source in sourceOptions"
            :key="`${sourceDialogAlgorithm.id}-${source.id}`"
            class="action-check-card"
            :class="resolveInput(sourceDialogAlgorithm.id).selectedSourceIds.includes(Number(source.id)) ? 'pass' : 'warn'"
          >
            <label class="planning-source-option">
              <input
                type="checkbox"
                :checked="resolveInput(sourceDialogAlgorithm.id).selectedSourceIds.includes(Number(source.id))"
                @change="toggleAlgorithmSource(sourceDialogAlgorithm.id, source.id)"
              />
              <div>
                <strong>{{ source.name }}</strong>
                <p>{{ source.type }} / {{ source.format }}</p>
                <small class="muted-text">
                  红方 {{ resolveSourceStats(source.id).redCount }} / 蓝方 {{ resolveSourceStats(source.id).blueCount }} / 环境 {{ resolveSourceStats(source.id).environmentCount }}
                </small>
              </div>
            </label>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>
