<script setup>
import { useConsumptionWorkflow } from '../../modules/consumptionWorkflow';

const {
  state,
  activeScheme,
  equipmentTypes,
  activeSchemeSummary,
  setSelectedScheme,
  resetCurrentSchemes,
  updateEquipmentField,
  formatScore,
} = useConsumptionWorkflow();

function isActiveScheme(schemeId) {
  return state.selectedSchemeId === schemeId;
}
</script>

<template>
  <section class="capability-stage action-stage consumption-stage">
    <div class="capability-stage-grid capability-stage-grid--dual">
      <article class="capability-stage-card capability-stage-card--hero">
        <span class="eyebrow">Step 02 / 装备与自然损耗</span>
        <h3>装备基础状态建模</h3>

        <div class="capability-stage-summary-grid">
          <div class="capability-stage-summary-item">
            <span>当前方案</span>
            <strong>{{ activeScheme?.name || '--' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>装备总量</span>
            <strong>{{ formatScore(activeSchemeSummary.totalEquipment, 0) }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>平均维护</span>
            <strong>{{ formatScore(activeSchemeSummary.averageMaintenance, 1) }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>平均使用频率</span>
            <strong>{{ formatScore(activeSchemeSummary.averageUsage, 1) }}</strong>
          </div>
        </div>

        <div class="capability-stage-pill-row">
          <span class="pill pill-active">自然损耗输入建模</span>
          <button class="button button-ghost" @click="resetCurrentSchemes">恢复默认方案</button>
        </div>
      </article>

      <article class="capability-stage-card capability-stage-card--summary">
        <span class="eyebrow">方案切换</span>
        <h3>多方案装备状态</h3>

        <div class="action-scheme-grid">
          <button
            v-for="scheme in state.schemes"
            :key="scheme.id"
            class="action-scheme-chip"
            :class="{ active: isActiveScheme(scheme.id) }"
            @click="setSelectedScheme(scheme.id)"
          >
            <strong>{{ scheme.name }}</strong>
            <small>持续 {{ formatScore(scheme.durationDays, 0) }} 天 / {{ formatScore(scheme.operatingHours, 0) }} 小时</small>
          </button>
        </div>
      </article>
    </div>

    <article v-if="activeScheme" class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>装备类别参数</h3>
        </div>
      </div>

      <div class="consumption-equipment-grid">
        <article
          v-for="item in equipmentTypes"
          :key="item.key"
          class="detail-card consumption-equipment-card"
        >
          <div class="section-heading compact">
            <div>
              <h4>{{ item.label }}</h4>
            </div>
          </div>

          <div class="form-grid">
            <label>
              装备数量
              <input
                :value="activeScheme.equipment[item.key]?.quantity ?? 0"
                type="number"
                min="0"
                step="1"
                @input="updateEquipmentField(activeScheme.id, item.key, 'quantity', $event.target.value)"
              />
            </label>

            <label>
              服役年限
              <input
                :value="activeScheme.equipment[item.key]?.serviceYears ?? 1"
                type="number"
                min="1"
                max="30"
                step="0.5"
                @input="updateEquipmentField(activeScheme.id, item.key, 'serviceYears', $event.target.value)"
              />
            </label>

            <label>
              维护水平
              <input
                :value="activeScheme.equipment[item.key]?.maintenanceLevel ?? 80"
                type="number"
                min="20"
                max="100"
                step="1"
                @input="updateEquipmentField(activeScheme.id, item.key, 'maintenanceLevel', $event.target.value)"
              />
            </label>

            <label>
              使用频率
              <input
                :value="activeScheme.equipment[item.key]?.usageFrequency ?? 4"
                type="number"
                min="1"
                max="12"
                step="0.1"
                @input="updateEquipmentField(activeScheme.id, item.key, 'usageFrequency', $event.target.value)"
              />
            </label>
          </div>

          <div class="chip-row">
            <span class="pill pill-muted">维护 {{ formatScore(activeScheme.equipment[item.key]?.maintenanceLevel, 1) }}</span>
            <span class="pill pill-muted">年限 {{ formatScore(activeScheme.equipment[item.key]?.serviceYears, 1) }}</span>
            <span class="pill pill-muted">频率 {{ formatScore(activeScheme.equipment[item.key]?.usageFrequency, 1) }}</span>
          </div>
        </article>
      </div>
    </article>
  </section>
</template>
