<script setup>
import { useConsumptionWorkflow } from '../../modules/consumptionWorkflow';

const {
  state,
  activeScheme,
  strikeModes,
  equipmentTypes,
  naturalModels,
  missionModels,
  predictionModels,
  selectedStrikeModeMeta,
  setSelectedScheme,
  updateSchemeField,
  updateSchemeNumberField,
  updateMissionField,
  updatePersonnelField,
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
        <span class="eyebrow">Step 03 / 任务战损建模</span>
        <h3>任务威胁与防护参数</h3>

        <div class="capability-stage-summary-grid">
          <div class="capability-stage-summary-item">
            <span>当前方案</span>
            <strong>{{ activeScheme?.name || '--' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>火力强度</span>
            <strong>{{ formatScore(activeScheme?.mission.enemyFireIntensity, 0) }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>打击方式</span>
            <strong>{{ selectedStrikeModeMeta?.label || '--' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>参战人员</span>
            <strong>{{ formatScore(activeScheme?.personnel.deployed, 0) }}</strong>
          </div>
        </div>
      </article>

      <article class="capability-stage-card capability-stage-card--summary">
        <span class="eyebrow">方案切换</span>
        <h3>多方案任务建模</h3>

        <div class="action-scheme-grid">
          <button
            v-for="scheme in state.schemes"
            :key="scheme.id"
            class="action-scheme-chip"
            :class="{ active: isActiveScheme(scheme.id) }"
            @click="setSelectedScheme(scheme.id)"
          >
            <strong>{{ scheme.name }}</strong>
            <small>{{ scheme.description || '未填写方案说明' }}</small>
          </button>
        </div>
      </article>
    </div>

    <div v-if="activeScheme" class="action-model-grid consumption-model-grid">
      <article class="capability-stage-card">
        <div class="section-heading compact">
          <div>
            <h3>方案与任务参数</h3>
          </div>
        </div>

        <div class="form-grid">
          <label>
            方案名称
            <input
              :value="activeScheme.name"
              type="text"
              @input="updateSchemeField(activeScheme.id, 'name', $event.target.value)"
            />
          </label>

          <label>
            持续天数
            <input
              :value="activeScheme.durationDays"
              type="number"
              min="1"
              max="30"
              step="1"
              @input="updateSchemeNumberField(activeScheme.id, 'durationDays', $event.target.value, 1, 30)"
            />
          </label>

          <label>
            任务时长
            <input
              :value="activeScheme.operatingHours"
              type="number"
              min="6"
              max="24"
              step="1"
              @input="updateSchemeNumberField(activeScheme.id, 'operatingHours', $event.target.value, 6, 24)"
            />
          </label>

          <label>
            敌方火力强度
            <input
              :value="activeScheme.mission.enemyFireIntensity"
              type="number"
              min="20"
              max="100"
              step="1"
              @input="updateMissionField(activeScheme.id, 'enemyFireIntensity', $event.target.value)"
            />
          </label>

          <label>
            打击方式
            <select :value="activeScheme.mission.strikeMode" @change="updateMissionField(activeScheme.id, 'strikeMode', $event.target.value)">
              <option v-for="item in strikeModes" :key="item.key" :value="item.key">{{ item.label }}</option>
            </select>
          </label>

          <label class="full-span">
            方案说明
            <textarea
              rows="3"
              :value="activeScheme.description"
              @input="updateSchemeField(activeScheme.id, 'description', $event.target.value)"
            ></textarea>
          </label>
        </div>
      </article>

      <article class="capability-stage-card">
        <div class="section-heading compact">
          <div>
            <h3>人员保障参数</h3>
          </div>
        </div>

        <div class="form-grid">
          <label>
            参战人员
            <input
              :value="activeScheme.personnel.deployed"
              type="number"
              min="0"
              step="1"
              @input="updatePersonnelField(activeScheme.id, 'deployed', $event.target.value)"
            />
          </label>

          <label>
            医疗支援水平
            <input
              :value="activeScheme.personnel.medicalSupportLevel"
              type="number"
              min="30"
              max="100"
              step="1"
              @input="updatePersonnelField(activeScheme.id, 'medicalSupportLevel', $event.target.value)"
            />
          </label>

          <label>
            撤收效率
            <input
              :value="activeScheme.personnel.evacuationEfficiency"
              type="number"
              min="30"
              max="100"
              step="1"
              @input="updatePersonnelField(activeScheme.id, 'evacuationEfficiency', $event.target.value)"
            />
          </label>
        </div>

        <div class="capability-stage-pill-row">
          <span class="pill pill-active">{{ selectedStrikeModeMeta?.label || '--' }}</span>
          <span class="pill pill-muted">医疗 {{ formatScore(activeScheme.personnel.medicalSupportLevel, 0) }}</span>
          <span class="pill pill-muted">撤收 {{ formatScore(activeScheme.personnel.evacuationEfficiency, 0) }}</span>
        </div>
      </article>
    </div>

    <article v-if="activeScheme" class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>装备防护能力</h3>
        </div>
      </div>

      <div class="table-shell">
        <table>
          <thead>
            <tr>
              <th>装备类别</th>
              <th>数量</th>
              <th>防护能力</th>
              <th>维护水平</th>
              <th>使用频率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in equipmentTypes" :key="item.key">
              <td>{{ item.label }}</td>
              <td>{{ formatScore(activeScheme.equipment[item.key]?.quantity, 0) }}</td>
              <td>
                <input
                  :value="activeScheme.equipment[item.key]?.protectionCapability ?? 70"
                  type="number"
                  min="20"
                  max="100"
                  step="1"
                  @input="updateEquipmentField(activeScheme.id, item.key, 'protectionCapability', $event.target.value)"
                />
              </td>
              <td>{{ formatScore(activeScheme.equipment[item.key]?.maintenanceLevel, 1) }}</td>
              <td>{{ formatScore(activeScheme.equipment[item.key]?.usageFrequency, 1) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>模型结构</h3>
        </div>
      </div>

      <div class="consumption-model-card-grid">
        <article v-for="item in naturalModels" :key="item.key" class="detail-card">
          <span class="eyebrow">自然损耗</span>
          <strong>{{ item.label }}</strong>
        </article>
        <article v-for="item in missionModels" :key="item.key" class="detail-card">
          <span class="eyebrow">任务战损</span>
          <strong>{{ item.label }}</strong>
        </article>
        <article v-for="item in predictionModels" :key="item.key" class="detail-card">
          <span class="eyebrow">输出算法</span>
          <strong>{{ item.label }}</strong>
        </article>
      </div>
    </article>
  </section>
</template>
