<script setup>
import { computed, ref } from 'vue';
import { api } from '../api';
import { usePlanningWorkflow } from '../modules/planningWorkflow';

const props = defineProps({
  algorithmId: {
    type: String,
    default: '',
  },
  variantId: {
    type: String,
    default: '',
  },
  showAlgorithmSelect: {
    type: Boolean,
    default: false,
  },
  showVariantSelect: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:algorithmId', 'update:variantId']);

const {
  algorithmLibrary,
  sourceOptions,
  intelligenceRecords,
  environmentRecords,
  setAlgorithmBuiltinMethod,
  toggleAlgorithmSource,
  updateAlgorithmOptions,
  updateAlgorithmRuntimeOptions,
  addAlgorithmFiles,
  removeAlgorithmFile,
  getAlgorithmInput,
  formatVariantType,
  formatStatusLabel,
} = usePlanningWorkflow();

const localFileAccept = '.doc,.docx,.pdf,.xls,.xlsx,.csv,.txt';
const sourceDialogOpen = ref(false);
const llmTestState = ref({});
const llmRuntimeFieldKeys = new Set(['llmBackend', 'llmApiKey', 'llmBaseUrl', 'llmModel', 'ollamaHost', 'openaiBaseUrl', 'openaiApiKey', 'llmMaxTokens']);

const selectedAlgorithm = computed(() => algorithmLibrary.value.find((item) => item.id === props.algorithmId) || algorithmLibrary.value[0] || null);
const selectedExternalVariants = computed(() => (selectedAlgorithm.value?.variants || []).filter((item) => item.type === 'external-model'));
const selectedVariant = computed(() => (
  (selectedAlgorithm.value?.variants || []).find((item) => item.id === props.variantId)
  || (selectedAlgorithm.value?.variants || [])[0]
  || null
));

function resolveInput(algorithmId = props.algorithmId) {
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
      [key]: { status: 'error', message: formatLlmTestError(error) },
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
  return (algorithm?.supportedInputModes || []).includes(mode);
}

function resolveSourceStats(sourceId) {
  const intelligence = intelligenceRecords.value.filter((item) => Number(item.sourceId) === Number(sourceId));
  const environment = environmentRecords.value.filter((item) => Number(item.sourceId) === Number(sourceId));
  return {
    redCount: intelligence.filter((item) => item.camp === 'red').length,
    blueCount: intelligence.filter((item) => item.camp === 'blue').length,
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
      stock: { ...(current.stock || {}), [field]: value },
      transport: { ...(current.transport || {}) },
    },
  });
}

function updateSupportResourceTransport(algorithmId, field, value) {
  const options = resolveInput(algorithmId).options || {};
  const current = options.resourcePool || {};
  updateAlgorithmOptions(algorithmId, {
    resourcePool: {
      ...current,
      stock: { ...(current.stock || {}) },
      transport: { ...(current.transport || {}), [field]: value },
    },
  });
}

async function handleFileChange(algorithmId, event) {
  const files = event.target.files;
  if (!files?.length) return;
  try {
    await addAlgorithmFiles(algorithmId, files);
  } finally {
    event.target.value = '';
  }
}
</script>

<template>
  <div v-if="selectedAlgorithm" class="planning-algorithm-detail-shell">
    <div v-if="showAlgorithmSelect || showVariantSelect" class="detail-card">
      <span class="eyebrow">分步执行配置</span>
      <div class="form-grid capability-stage-form top-gap">
        <label v-if="showAlgorithmSelect">
          规划算法
          <select :value="selectedAlgorithm.id" @change="emit('update:algorithmId', $event.target.value)">
            <option v-for="algorithm in algorithmLibrary" :key="algorithm.id" :value="algorithm.id">
              {{ algorithm.name }}
            </option>
          </select>
        </label>
        <label v-if="showVariantSelect">
          算法实现
          <select :value="selectedVariant?.id || ''" @change="emit('update:variantId', $event.target.value)">
            <option
              v-for="variant in selectedAlgorithm.variants || []"
              :key="variant.id"
              :value="variant.id"
              :disabled="variant.status !== 'active'"
            >
              {{ variant.name }} / {{ formatVariantType(variant.type) }}{{ variant.status === 'active' ? '' : '（预留）' }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <article class="action-template-card planning-algorithm-detail-card">
      <div class="action-template-card__head">
        <div>
          <span class="pill pill-active">{{ selectedAlgorithm.category }}</span>
          <h4>{{ selectedAlgorithm.name }}</h4>
        </div>
        <span class="pill pill-muted">{{ selectedAlgorithm.implementationStatus === 'implemented' ? '已实现' : '规划中' }}</span>
      </div>

      <div v-if="selectedExternalVariants.length" class="detail-card">
        <span class="eyebrow">扩展算法实现参数</span>
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
                    <option v-for="option in field.options || []" :key="`${field.key}-${option.value}`" :value="option.value">
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
                      <option v-for="option in field.options || []" :key="`${field.key}-${option.value}`" :value="option.value">
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
          </article>
        </div>
      </div>

      <div v-if="(selectedAlgorithm.builtinMethods || []).length" class="detail-card">
        <span class="eyebrow">内置算法方法</span>
        <div class="form-grid capability-stage-form top-gap">
          <label class="full-span">
            当前方法
            <select
              :value="resolveInput(selectedAlgorithm.id).builtinMethodKey"
              @change="setAlgorithmBuiltinMethod(selectedAlgorithm.id, $event.target.value)"
            >
              <option v-for="method in selectedAlgorithm.builtinMethods || []" :key="method.key" :value="method.key">
                {{ method.label }}
              </option>
            </select>
          </label>
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
          <button class="button button-ghost" @click="sourceDialogOpen = true">选择数据源</button>
        </div>
        <div v-if="resolveSelectedSourceNames(selectedAlgorithm.id).length" class="chip-row top-gap">
          <span v-for="name in resolveSelectedSourceNames(selectedAlgorithm.id)" :key="`${selectedAlgorithm.id}-${name}`" class="pill pill-muted">
            {{ name }}
          </span>
        </div>
      </div>

      <div v-if="hasInputMode(selectedAlgorithm, 'local-file')" class="detail-card">
        <span class="eyebrow">本地文件</span>
        <div class="form-grid capability-stage-form top-gap">
          <label class="full-span">
            上传 Word / PDF / Excel / CSV / TXT
            <input type="file" :accept="localFileAccept" multiple @change="handleFileChange(selectedAlgorithm.id, $event)" />
          </label>
        </div>
        <div v-if="resolveInput(selectedAlgorithm.id).uploadedFiles.length" class="action-validation-issues top-gap">
          <article v-for="file in resolveInput(selectedAlgorithm.id).uploadedFiles" :key="file.id" class="action-check-card pass">
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
            <select :value="resolveInput(selectedAlgorithm.id).options.analysisFocus" @change="updateAlgorithmOptions(selectedAlgorithm.id, { analysisFocus: $event.target.value })">
              <option value="comprehensive">综合敌情</option>
              <option value="coverage">火力覆盖优先</option>
              <option value="air-defense">防空体系优先</option>
            </select>
          </label>
          <label>
            热力图密度
            <select :value="resolveInput(selectedAlgorithm.id).options.heatmapDensity" @change="updateAlgorithmOptions(selectedAlgorithm.id, { heatmapDensity: $event.target.value })">
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
          <label>
            影响评估倾向
            <select :value="resolveInput(selectedAlgorithm.id).options.impactBias" @change="updateAlgorithmOptions(selectedAlgorithm.id, { impactBias: $event.target.value })">
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
            <select :value="resolveInput(selectedAlgorithm.id).options.ruleLibraryKey" @change="updateAlgorithmOptions(selectedAlgorithm.id, { ruleLibraryKey: $event.target.value })">
              <option v-for="ruleLibrary in selectedAlgorithm.ruleLibraries || []" :key="ruleLibrary.key" :value="ruleLibrary.key">
                {{ ruleLibrary.label }}
              </option>
            </select>
          </label>
          <label>
            约束模型
            <select :value="resolveInput(selectedAlgorithm.id).options.constraintModelKey" @change="updateAlgorithmOptions(selectedAlgorithm.id, { constraintModelKey: $event.target.value })">
              <option v-for="constraintModel in selectedAlgorithm.constraintModels || []" :key="constraintModel.key" :value="constraintModel.key">
                {{ constraintModel.label }}
              </option>
            </select>
          </label>
          <label>
            对比侧重
            <select :value="resolveInput(selectedAlgorithm.id).options.comparisonFocus" @change="updateAlgorithmOptions(selectedAlgorithm.id, { comparisonFocus: $event.target.value })">
              <option value="balanced">均衡</option>
              <option value="loss-minimized">战损最小化</option>
              <option value="resource-minimized">资源最小化</option>
            </select>
          </label>
          <label>
            期望群组数
            <input :value="resolveInput(selectedAlgorithm.id).options.expectedGroupCount" type="number" min="3" max="6" @change="updateAlgorithmOptions(selectedAlgorithm.id, { expectedGroupCount: Number($event.target.value || 4) })" />
          </label>
        </div>
      </div>

      <div v-else-if="selectedAlgorithm.id === 'target-allocation'" class="detail-card">
        <span class="eyebrow">分配偏好</span>
        <div class="form-grid capability-stage-form top-gap">
          <label>
            目标偏好
            <select :value="resolveInput(selectedAlgorithm.id).options.objectivePreference" @change="updateAlgorithmOptions(selectedAlgorithm.id, { objectivePreference: $event.target.value })">
              <option value="balanced">均衡</option>
              <option value="loss-minimized">战损最小化</option>
              <option value="resource-minimized">资源最小化</option>
            </select>
          </label>
          <label>
            验证模式
            <select :value="resolveInput(selectedAlgorithm.id).options.validationMode" @change="updateAlgorithmOptions(selectedAlgorithm.id, { validationMode: $event.target.value })">
              <option value="strict">严格</option>
              <option value="standard">标准</option>
            </select>
          </label>
          <label>
            单编组最大分配数
            <input :value="resolveInput(selectedAlgorithm.id).options.maxAssignmentsPerGroup" type="number" min="1" max="3" @change="updateAlgorithmOptions(selectedAlgorithm.id, { maxAssignmentsPerGroup: Number($event.target.value || 2) })" />
          </label>
        </div>
      </div>

      <div v-else-if="selectedAlgorithm.id === 'airborne-landing-site-selection'" class="detail-card">
        <span class="eyebrow">机降选址偏好</span>
        <div class="form-grid capability-stage-form top-gap">
          <label>
            选址侧重
            <select :value="resolveInput(selectedAlgorithm.id).options.sitePreference" @change="updateAlgorithmOptions(selectedAlgorithm.id, { sitePreference: $event.target.value })">
              <option value="balanced">均衡</option>
              <option value="concealment">隐蔽优先</option>
              <option value="safety">安全优先</option>
              <option value="assembly">集结效率优先</option>
            </select>
          </label>
          <label>
            直升机型号
            <select :value="resolveInput(selectedAlgorithm.id).options.helicopterModel" @change="updateAlgorithmOptions(selectedAlgorithm.id, { helicopterModel: $event.target.value })">
              <option value="light-lift">轻型运输</option>
              <option value="medium-lift">中型运输</option>
              <option value="heavy-lift">重型运输</option>
            </select>
          </label>
          <label>
            候选点数量
            <input :value="resolveInput(selectedAlgorithm.id).options.candidateCount" type="number" min="3" max="8" @change="updateAlgorithmOptions(selectedAlgorithm.id, { candidateCount: Number($event.target.value || 5) })" />
          </label>
        </div>
      </div>

      <div v-else-if="selectedAlgorithm.id === 'method-planning'" class="detail-card">
        <span class="eyebrow">路径规划偏好</span>
        <div class="form-grid capability-stage-form top-gap">
          <label>
            航路侧重
            <select :value="resolveInput(selectedAlgorithm.id).options.routePreference" @change="updateAlgorithmOptions(selectedAlgorithm.id, { routePreference: $event.target.value })">
              <option value="balanced">均衡</option>
              <option value="speed">速度优先</option>
              <option value="concealment">隐蔽优先</option>
            </select>
          </label>
          <label>
            高度剖面
            <select :value="resolveInput(selectedAlgorithm.id).options.altitudeProfile" @change="updateAlgorithmOptions(selectedAlgorithm.id, { altitudeProfile: $event.target.value })">
              <option value="terrain-following">贴地 / 顺地飞行</option>
              <option value="medium">中空飞行</option>
              <option value="high">高空飞行</option>
            </select>
          </label>
          <label>
            行动节奏
            <select :value="resolveInput(selectedAlgorithm.id).options.phaseTempo" @change="updateAlgorithmOptions(selectedAlgorithm.id, { phaseTempo: $event.target.value })">
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
            <input :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.equipmentLossRate" type="number" min="0" max="60" step="0.1" @change="updateSupportDamageForecast(selectedAlgorithm.id, 'equipmentLossRate', Number($event.target.value || 0))" />
          </label>
          <label>
            人员伤亡率（%）
            <input :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.casualtyRate" type="number" min="0" max="40" step="0.1" @change="updateSupportDamageForecast(selectedAlgorithm.id, 'casualtyRate', Number($event.target.value || 0))" />
          </label>
          <label>
            受损装备数
            <input :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.damagedEquipmentCount" type="number" min="0" step="1" @change="updateSupportDamageForecast(selectedAlgorithm.id, 'damagedEquipmentCount', Number($event.target.value || 0))" />
          </label>
          <label>
            伤员数
            <input :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.woundedCount" type="number" min="0" step="1" @change="updateSupportDamageForecast(selectedAlgorithm.id, 'woundedCount', Number($event.target.value || 0))" />
          </label>
          <label>
            关键窗口数
            <input :value="resolveInput(selectedAlgorithm.id).options.damageForecast?.criticalWindowCount" type="number" min="1" max="4" step="1" @change="updateSupportDamageForecast(selectedAlgorithm.id, 'criticalWindowCount', Number($event.target.value || 1))" />
          </label>
          <label>
            预备比例（%）
            <input :value="resolveInput(selectedAlgorithm.id).options.reserveRatio" type="number" min="8" max="35" @change="updateAlgorithmOptions(selectedAlgorithm.id, { reserveRatio: Number($event.target.value || 18) })" />
          </label>
          <label>
            空域管控
            <select :value="resolveInput(selectedAlgorithm.id).options.airspaceControl" @change="updateAlgorithmOptions(selectedAlgorithm.id, { airspaceControl: $event.target.value })">
              <option value="standard">标准</option>
              <option value="tight">严格隔离</option>
              <option value="flexible">灵活协同</option>
            </select>
          </label>
        </div>

        <span class="eyebrow top-gap">保障资源池</span>
        <div class="form-grid capability-stage-form top-gap">
          <label v-for="item in [
            ['ammo', '弹药库存'],
            ['fuel', '油料库存'],
            ['maintenance', '维修工时库存'],
            ['medical', '医疗批次库存'],
            ['airspace', '空域时隙库存'],
            ['command', '通信链路库存'],
          ]" :key="item[0]">
            {{ item[1] }}
            <input :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.stock?.[item[0]]" type="number" min="0" step="0.1" @change="updateSupportResourceStock(selectedAlgorithm.id, item[0], Number($event.target.value || 0))" />
          </label>
        </div>

        <span class="eyebrow top-gap">投送与协同能力</span>
        <div class="form-grid capability-stage-form top-gap">
          <label v-for="item in [
            ['sorties', '运输架次'],
            ['liftTonnagePerSortie', '单架次载重（吨）'],
            ['maintenanceTeams', '维修分队'],
            ['medicalTeams', '医疗分队'],
            ['airspaceCells', '空域协同席位'],
            ['commandLinks', '调度链路容量'],
          ]" :key="item[0]">
            {{ item[1] }}
            <input :value="resolveInput(selectedAlgorithm.id).options.resourcePool?.transport?.[item[0]]" type="number" min="0" step="1" @change="updateSupportResourceTransport(selectedAlgorithm.id, item[0], Number($event.target.value || 0))" />
          </label>
        </div>
      </div>
    </article>

    <div v-if="sourceDialogOpen" class="planning-dialog-backdrop" @click.self="sourceDialogOpen = false">
      <section class="planning-dialog-shell glass-card">
        <div class="section-heading compact">
          <div>
            <h3>{{ selectedAlgorithm.name }}</h3>
          </div>
          <button class="button button-ghost" @click="sourceDialogOpen = false">关闭</button>
        </div>
        <div class="planning-source-grid top-gap">
          <article
            v-for="source in sourceOptions"
            :key="`${selectedAlgorithm.id}-${source.id}`"
            class="action-check-card"
            :class="resolveInput(selectedAlgorithm.id).selectedSourceIds.includes(Number(source.id)) ? 'pass' : 'warn'"
          >
            <label class="planning-source-option">
              <input
                type="checkbox"
                :checked="resolveInput(selectedAlgorithm.id).selectedSourceIds.includes(Number(source.id))"
                @change="toggleAlgorithmSource(selectedAlgorithm.id, source.id)"
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
  </div>
</template>
