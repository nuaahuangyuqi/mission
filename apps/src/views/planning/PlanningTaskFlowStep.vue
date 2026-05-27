<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { usePlanningWorkflow } from '../../modules/planningWorkflow';

const router = useRouter();
const {
  state,
  selectedTask,
  selectedTaskInstance,
  taskStepBindings,
  setAlgorithmBinding,
  updateAlgorithmRuntimeOptions,
  setPlanningStage,
  formatVariantType,
  formatStatusLabel,
} = usePlanningWorkflow();

const llmRuntimeFieldKeys = new Set(['llmBackend', 'llmModel', 'ollamaHost', 'openaiBaseUrl', 'openaiApiKey', 'llmMaxTokens']);

onMounted(() => {
  setPlanningStage('flow');
});

function goToLibrary() {
  router.push({ name: 'planning-tasks-library' });
}

function goToExecute() {
  router.push({ name: 'planning-tasks-execute' });
}

function runtimeOptionsFor(binding) {
  return binding.inputConfig?.options?.runtimeOptions?.[binding.variant?.runtimeKey] || {};
}

function runtimeFieldValue(binding, field) {
  const value = runtimeOptionsFor(binding)[field.key];
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

function updateRuntimeField(binding, field, rawValue) {
  if (!binding.algorithm?.id || !binding.variant?.runtimeKey) return;
  updateAlgorithmRuntimeOptions(binding.algorithm.id, binding.variant.runtimeKey, {
    [field.key]: parseRuntimeFieldValue(field, rawValue),
  });
}

function isLlmRuntimeField(field) {
  return field?.section === 'llm' || llmRuntimeFieldKeys.has(field?.key);
}

function runtimeCoreFields(binding) {
  return (binding?.variant?.parameterSchema || []).filter((field) => !isLlmRuntimeField(field));
}

function runtimeLlmFields(binding) {
  return (binding?.variant?.parameterSchema || []).filter((field) => isLlmRuntimeField(field));
}
</script>

<template>
  <article class="capability-stage-card">
    <div class="section-heading compact">
      <div>
        <h3>{{ selectedTask?.name || '流程编排' }}</h3>
      </div>

      <div class="planning-task-actions">
        <button class="button button-ghost" @click="goToLibrary">上一步</button>
        <button class="button" :disabled="!selectedTaskInstance" @click="goToExecute">下一步</button>
      </div>
    </div>

    <div class="capability-stage-pill-row top-gap">
      <span class="pill pill-active">{{ selectedTaskInstance ? `实例 #${selectedTaskInstance.id}` : '未选择实例' }}</span>
      <span class="pill pill-muted">阶段 {{ selectedTaskInstance?.planningStageKey || 'flow' }}</span>
      <span class="pill pill-muted">步骤 {{ taskStepBindings.length }}</span>
    </div>

    <div v-if="!selectedTaskInstance" class="detail-card compact-empty-state top-gap">
      <p class="muted-text">请先创建并选择任务实例</p>
    </div>

    <div v-else-if="taskStepBindings.length" class="action-chain-card top-gap">
      <div class="action-chain-card__nodes">
        <article
          v-for="binding in taskStepBindings"
          :key="binding.step.id"
          class="action-chain-card__node"
        >
          <div class="action-chain-card__node-head">
            <div>
              <span class="eyebrow">Step {{ binding.step.order }}</span>
              <h4>{{ binding.step.name }}</h4>
            </div>
            <span class="pill pill-active">{{ binding.algorithm?.name || '--' }}</span>
          </div>

          <div class="action-chain-card__node-grid">
            <div><span>当前实现</span><strong>{{ binding.variant?.name || '--' }}</strong></div>
            <div><span>实现类型</span><strong>{{ binding.variant ? formatVariantType(binding.variant.type) : '--' }}</strong></div>
            <div><span>实现状态</span><strong>{{ binding.variant ? formatStatusLabel(binding.variant.status) : '--' }}</strong></div>
            <div><span>已选数据源</span><strong>{{ binding.inputConfig?.selectedSourceIds?.length || 0 }}</strong></div>
            <div><span>上传文件</span><strong>{{ binding.inputConfig?.uploadedFiles?.length || 0 }}</strong></div>
          </div>

          <div class="form-grid capability-stage-form">
            <label class="full-span">
              选择算法实现
              <select :value="binding.variantId" @change="setAlgorithmBinding(binding.step.id, $event.target.value)">
                <option
                  v-for="variant in binding.variants"
                  :key="variant.id"
                  :value="variant.id"
                  :disabled="variant.status !== 'active'"
                >
                  {{ variant.name }} / {{ formatVariantType(variant.type) }}{{ variant.status === 'active' ? '' : '（预留）' }}
                </option>
              </select>
            </label>
          </div>

          <div class="detail-card">
            <span class="eyebrow">步骤输入</span>
            <div class="chip-row top-gap">
              <span v-for="item in binding.step.consumes" :key="item" class="pill pill-muted">{{ item }}</span>
            </div>
          </div>

          <div class="detail-card">
            <span class="eyebrow">步骤输出</span>
            <div class="chip-row top-gap">
              <span v-for="item in binding.step.produces" :key="item" class="pill pill-muted">{{ item }}</span>
            </div>
          </div>

          <div v-if="binding.variant?.type === 'external-model'" class="detail-card">
            <span class="eyebrow">工程参数</span>
            <div class="planning-runtime-config-card__head top-gap">
              <div>
                <strong>{{ binding.variant.projectName || binding.variant.name }}</strong>
                <p>{{ binding.variant.projectPath || binding.variant.description }}</p>
              </div>
              <span class="pill" :class="binding.variant.status === 'active' ? 'pill-active' : 'pill-muted'">
                {{ formatStatusLabel(binding.variant.status) }}
              </span>
            </div>

            <div v-if="runtimeCoreFields(binding).length" class="form-grid capability-stage-form planning-runtime-parameter-grid top-gap">
              <label
                v-for="field in runtimeCoreFields(binding)"
                :key="`${binding.step.id}-${field.key}`"
                :class="{ 'planning-runtime-toggle-field': field.type === 'boolean' }"
              >
                <template v-if="field.type === 'boolean'">
                  <input
                    type="checkbox"
                    :checked="Boolean(runtimeFieldValue(binding, field))"
                    @change="updateRuntimeField(binding, field, $event.target.checked)"
                  />
                  <span>{{ field.label }}</span>
                </template>

                <template v-else>
                  {{ field.label }}
                  <select
                    v-if="field.type === 'select'"
                    :value="runtimeFieldValue(binding, field)"
                    @change="updateRuntimeField(binding, field, $event.target.value)"
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
                    :value="runtimeFieldValue(binding, field)"
                    @change="updateRuntimeField(binding, field, $event.target.value)"
                  />
                </template>
              </label>
            </div>

            <div v-if="runtimeLlmFields(binding).length" class="planning-runtime-llm-panel top-gap">
              <div class="planning-runtime-llm-panel__head">
                <div>
                  <strong>LLM 结构化抽取配置</strong>
                  <p>Ollama / OpenAI 兼容 API，结果回显自动脱敏。</p>
                </div>
                <span class="pill pill-muted">前端配置</span>
              </div>

              <div class="form-grid capability-stage-form planning-runtime-parameter-grid planning-runtime-llm-grid top-gap">
                <label
                  v-for="field in runtimeLlmFields(binding)"
                  :key="`${binding.step.id}-llm-${field.key}`"
                  :class="{ 'planning-runtime-toggle-field': field.type === 'boolean' }"
                >
                  <template v-if="field.type === 'boolean'">
                    <input
                      type="checkbox"
                      :checked="Boolean(runtimeFieldValue(binding, field))"
                      @change="updateRuntimeField(binding, field, $event.target.checked)"
                    />
                    <span>{{ field.label }}</span>
                  </template>

                  <template v-else>
                    {{ field.label }}
                    <select
                      v-if="field.type === 'select'"
                      :value="runtimeFieldValue(binding, field)"
                      @change="updateRuntimeField(binding, field, $event.target.value)"
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
                      :value="runtimeFieldValue(binding, field)"
                      @change="updateRuntimeField(binding, field, $event.target.value)"
                    />
                  </template>
                </label>
              </div>
            </div>

            <p v-if="!runtimeCoreFields(binding).length && !runtimeLlmFields(binding).length" class="muted-text top-gap">
              该工程暂未声明可配置参数。
            </p>
          </div>
        </article>
      </div>
    </div>

    <p v-if="state.errorMessage" class="auth-error capability-inline-error top-gap">{{ state.errorMessage }}</p>
  </article>
</template>
