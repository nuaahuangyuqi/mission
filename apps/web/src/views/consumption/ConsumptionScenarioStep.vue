<script setup>
import { useConsumptionWorkflow } from '../../modules/consumptionWorkflow';

const {
  state,
  missionTask,
  missionTypeMeta,
  engineOptions,
  naturalModels,
  missionModels,
  predictionModels,
  strikeModes,
  selectedEngineMeta,
  selectedStrikeModeMeta,
  workflowSummary,
  setAssessmentName,
  setSelectedEngine,
  setSelectedScheme,
  formatScore,
  summarizeScheme,
} = useConsumptionWorkflow();

function isSelectedScheme(schemeId) {
  return state.selectedSchemeId === schemeId;
}

function resolveStrikeModeLabel(modeKey) {
  return strikeModes.value.find((item) => item.key === modeKey)?.label || modeKey;
}
</script>

<template>
  <section class="capability-stage action-stage consumption-stage">
    <div class="capability-stage-grid capability-stage-grid--dual">
      <article class="capability-stage-card capability-stage-card--hero">
        <span class="eyebrow">Step 01 / 共同任务基线</span>
        <h3>消耗评估任务设置</h3>

        <div class="form-grid capability-stage-form">
          <label>
            评估任务名称
            <input
              :value="state.assessmentName"
              type="text"
              placeholder="例如：联合突击编组消耗评估"
              @input="setAssessmentName($event.target.value)"
            />
          </label>

          <label>
            计算引擎
            <select :value="state.selectedEngine" @change="setSelectedEngine($event.target.value)">
              <option
                v-for="engine in engineOptions"
                :key="engine.key"
                :value="engine.key"
                :disabled="engine.status !== 'active'"
              >
                {{ engine.label }}{{ engine.status === 'active' ? '' : '（预留）' }}
              </option>
            </select>
          </label>
        </div>

        <div class="capability-stage-note">
          <span>引擎说明</span>
          <p>{{ selectedEngineMeta?.description || '--' }}</p>
        </div>

        <div class="capability-stage-pill-row">
          <span class="pill pill-active">自然模型 {{ naturalModels.length }}</span>
          <span class="pill pill-muted">任务模型 {{ missionModels.length }}</span>
          <span class="pill pill-muted">预测算法 {{ predictionModels.length }}</span>
        </div>
      </article>

      <article class="capability-stage-card capability-stage-card--summary">
        <span class="eyebrow">共同任务驱动</span>
        <h3>{{ missionTask.name || '--' }}</h3>

        <div class="capability-stage-summary-grid">
          <div class="capability-stage-summary-item">
            <span>作战类型</span>
            <strong>{{ missionTypeMeta?.label || '--' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>默认打击方式</span>
            <strong>{{ selectedStrikeModeMeta?.label || '--' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>方案数量</span>
            <strong>{{ workflowSummary.schemeCount }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>装备类别</span>
            <strong>{{ workflowSummary.equipmentTypeCount }}</strong>
          </div>
          <div class="capability-stage-summary-item full-span">
            <span>任务目标</span>
            <strong>{{ missionTask.objective || '--' }}</strong>
          </div>
        </div>
      </article>
    </div>

    <article class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>派生方案</h3>
        </div>
      </div>

      <div class="action-task-grid consumption-scheme-card-grid">
        <article
          v-for="scheme in state.schemes"
          :key="scheme.id"
          class="action-template-card"
          :class="{ active: isSelectedScheme(scheme.id) }"
        >
          <div class="action-template-card__head">
            <div>
              <span class="pill" :class="isSelectedScheme(scheme.id) ? 'pill-active' : 'pill-muted'">
                {{ resolveStrikeModeLabel(scheme.mission.strikeMode) }}
              </span>
              <h4>{{ scheme.name }}</h4>
            </div>
            <button class="button button-ghost" @click="setSelectedScheme(scheme.id)">
              {{ isSelectedScheme(scheme.id) ? '当前方案' : '选择方案' }}
            </button>
          </div>

          <div class="action-template-card__stats">
            <div>
              <span>持续时间</span>
              <strong>{{ formatScore(scheme.durationDays, 0) }} 天</strong>
            </div>
            <div>
              <span>任务时长</span>
              <strong>{{ formatScore(scheme.operatingHours, 0) }} 小时</strong>
            </div>
            <div>
              <span>火力强度</span>
              <strong>{{ formatScore(scheme.mission.enemyFireIntensity, 0) }}</strong>
            </div>
            <div>
              <span>参战人员</span>
              <strong>{{ formatScore(scheme.personnel.deployed, 0) }}</strong>
            </div>
          </div>

          <div class="chip-row">
            <span class="pill pill-muted">装备总量 {{ formatScore(summarizeScheme(scheme).totalEquipment, 0) }}</span>
            <span class="pill pill-muted">平均维护 {{ formatScore(summarizeScheme(scheme).averageMaintenance, 1) }}</span>
            <span class="pill pill-muted">平均防护 {{ formatScore(summarizeScheme(scheme).averageProtection, 1) }}</span>
          </div>
        </article>
      </div>
    </article>

    <article class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>算法结构</h3>
        </div>
      </div>

      <div class="consumption-model-card-grid">
        <article v-for="item in naturalModels" :key="item.key" class="detail-card">
          <span class="eyebrow">自然损耗模型</span>
          <strong>{{ item.label }}</strong>
        </article>

        <article v-for="item in missionModels" :key="item.key" class="detail-card">
          <span class="eyebrow">任务战损模型</span>
          <strong>{{ item.label }}</strong>
        </article>

        <article v-for="item in predictionModels" :key="item.key" class="detail-card">
          <span class="eyebrow">输出预测算法</span>
          <strong>{{ item.label }}</strong>
        </article>
      </div>
    </article>
  </section>
</template>
