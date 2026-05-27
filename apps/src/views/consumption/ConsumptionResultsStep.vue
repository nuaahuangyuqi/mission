<script setup>
import ConsumptionChartsPanel from '../../components/ConsumptionChartsPanel.vue';
import { useConsumptionWorkflow } from '../../modules/consumptionWorkflow';

const {
  state,
  activeScheme,
  rankingRows,
  recommendedScheme,
  selectedSchemeResult,
  resultsGeneratedAt,
  calculateConsumptionAssessment,
  setSelectedScheme,
  formatScore,
  formatPercent,
} = useConsumptionWorkflow();

async function handleCalculate() {
  try {
    await calculateConsumptionAssessment();
  } catch {
    // Shared workflow state already contains the error message.
  }
}
</script>

<template>
  <section class="capability-stage action-stage consumption-stage">
    <div class="capability-stage-grid capability-stage-grid--dual">
      <article class="capability-stage-card capability-stage-card--hero">
        <span class="eyebrow">Step 04 / 预测结果与可视化</span>
        <h3>生成消耗评估结果</h3>

        <div class="capability-stage-summary-grid">
          <div class="capability-stage-summary-item">
            <span>当前方案</span>
            <strong>{{ activeScheme?.name || '--' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>推荐方案</span>
            <strong>{{ recommendedScheme?.name || '--' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>结果时间</span>
            <strong>{{ resultsGeneratedAt ? resultsGeneratedAt.slice(0, 19).replace('T', ' ') : '--' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>持续作战评分</span>
            <strong>{{ selectedSchemeResult ? formatScore(selectedSchemeResult.sustainabilityScore, 2) : '--' }}</strong>
          </div>
        </div>
      </article>

      <article class="capability-stage-card capability-stage-card--summary">
        <span class="eyebrow">执行控制</span>
        <h3>结果输出</h3>

        <button class="button" :disabled="state.calculating || state.loading" @click="handleCalculate">
          {{ state.calculating ? '计算中...' : state.results ? '重新生成结果' : '生成评估结果' }}
        </button>

        <p v-if="state.errorMessage" class="auth-error capability-inline-error">{{ state.errorMessage }}</p>
      </article>
    </div>

    <article class="capability-result-shell">
      <div class="section-heading compact">
        <div>
          <h3>多方案评估结果</h3>
        </div>
        <div class="action-scheme-grid action-scheme-grid--results">
          <button
            v-for="item in rankingRows"
            :key="item.schemeId"
            class="action-scheme-chip"
            :class="{ active: state.selectedSchemeId === item.schemeId }"
            @click="setSelectedScheme(item.schemeId)"
          >
            <strong>#{{ item.rank }} {{ item.name }}</strong>
            <small>评分 {{ formatScore(item.sustainabilityScore, 2) }}</small>
          </button>
        </div>
      </div>

      <div v-if="!state.results" class="detail-card compact-empty-state">
        <p class="muted-text">生成结果后显示评估明细</p>
      </div>

      <template v-else>
        <div class="stats-strip compact-grid four-up">
          <div class="mini-stat">
            <span>推荐方案</span>
            <strong>{{ recommendedScheme?.name || '--' }}</strong>
          </div>
          <div class="mini-stat">
            <span>当前总损耗率</span>
            <strong>{{ selectedSchemeResult ? formatPercent(selectedSchemeResult.totals.totalLossRate, 1) : '--' }}</strong>
          </div>
          <div class="mini-stat">
            <span>当前伤亡总数</span>
            <strong>{{ selectedSchemeResult ? formatScore(selectedSchemeResult.personnel.casualties.total, 1) : '--' }}</strong>
          </div>
          <div class="mini-stat">
            <span>当前油料消耗</span>
            <strong>{{ selectedSchemeResult ? `${formatScore(selectedSchemeResult.totals.fuelUsed, 1)} 单位` : '--' }}</strong>
          </div>
        </div>

        <div class="table-shell top-gap">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>方案</th>
                <th>持续作战评分</th>
                <th>总损耗率</th>
                <th>伤亡总数</th>
                <th>弹药当量</th>
                <th>油料消耗</th>
                <th>装备保持率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in rankingRows" :key="item.schemeId">
                <td>{{ item.rank }}</td>
                <td>{{ item.name }}</td>
                <td>{{ formatScore(item.sustainabilityScore, 2) }}</td>
                <td>{{ formatPercent(item.totalLossRate, 1) }}</td>
                <td>{{ formatScore(item.casualties, 1) }}</td>
                <td>{{ formatScore(item.ammoEquivalent, 1) }}</td>
                <td>{{ formatScore(item.fuelUsed, 1) }}</td>
                <td>{{ formatPercent(item.readiness, 1) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="selectedSchemeResult" class="action-result-grid top-gap consumption-result-grid">
          <article class="capability-stage-card">
            <div class="section-heading compact">
              <div>
                <h3>方案总览</h3>
              </div>
              <span class="pill pill-active">评分 {{ formatScore(selectedSchemeResult.sustainabilityScore, 2) }}</span>
            </div>

            <div class="capability-stage-summary-grid">
              <div class="capability-stage-summary-item">
                <span>装备保持率</span>
                <strong>{{ formatPercent(selectedSchemeResult.totals.readiness, 1) }}</strong>
              </div>
              <div class="capability-stage-summary-item">
                <span>综合损伤指数</span>
                <strong>{{ formatScore(selectedSchemeResult.totals.damageIndex, 1) }}</strong>
              </div>
              <div class="capability-stage-summary-item">
                <span>弹药当量</span>
                <strong>{{ formatScore(selectedSchemeResult.totals.ammoEquivalent, 1) }}</strong>
              </div>
              <div class="capability-stage-summary-item">
                <span>油料消耗</span>
                <strong>{{ formatScore(selectedSchemeResult.totals.fuelUsed, 1) }} 单位</strong>
              </div>
            </div>

            <article class="detail-card">
              <span class="eyebrow">人员伤亡预测</span>
              <div class="consumption-casualty-grid">
                <div>
                  <span>参战人员</span>
                  <strong>{{ formatScore(selectedSchemeResult.personnel.casualties.deployed, 0) }}</strong>
                </div>
                <div>
                  <span>死亡</span>
                  <strong>{{ formatScore(selectedSchemeResult.personnel.casualties.fatalities, 1) }}</strong>
                </div>
                <div>
                  <span>受伤</span>
                  <strong>{{ formatScore(selectedSchemeResult.personnel.casualties.injuries, 1) }}</strong>
                </div>
                <div>
                  <span>伤亡率</span>
                  <strong>{{ formatPercent(selectedSchemeResult.personnel.casualties.casualtyRate, 2) }}</strong>
                </div>
              </div>
            </article>
          </article>

          <article class="capability-stage-card">
            <div class="section-heading compact">
              <div>
                <h3>弹药与油料明细</h3>
              </div>
            </div>

            <div class="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>装备类别</th>
                    <th>弹药消耗</th>
                    <th>弹药当量</th>
                    <th>油料消耗</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in selectedSchemeResult.ammo.items" :key="item.key">
                    <td>{{ item.label }}</td>
                    <td>{{ formatScore(item.rawAmount, 1) }} {{ item.unit }}</td>
                    <td>{{ formatScore(item.equivalent, 1) }}</td>
                    <td>{{ formatScore(selectedSchemeResult.fuel.items.find((fuel) => fuel.key === item.key)?.used, 1) }} 单位</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <article v-if="selectedSchemeResult" class="capability-stage-card">
          <div class="section-heading compact">
            <div>
              <h3>装备战损明细</h3>
            </div>
          </div>

          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  <th>装备类别</th>
                  <th>初始数量</th>
                  <th>自然损耗</th>
                  <th>任务战损</th>
                  <th>总损耗率</th>
                  <th>剩余数量</th>
                  <th>损伤指数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in selectedSchemeResult.equipmentBreakdown" :key="item.key">
                  <td>{{ item.label }}</td>
                  <td>{{ formatScore(item.quantity, 1) }} {{ item.unit }}</td>
                  <td>{{ formatScore(item.naturalLoss.units, 1) }} {{ item.unit }}</td>
                  <td>{{ formatScore(item.taskLoss.units, 1) }} {{ item.unit }}</td>
                  <td>{{ formatPercent(item.totalLossRate, 2) }}</td>
                  <td>{{ formatScore(item.remainingUnits, 1) }} {{ item.unit }}</td>
                  <td>{{ formatScore(item.taskLoss.damageIndex, 1) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article v-if="selectedSchemeResult" class="capability-stage-card">
          <div class="section-heading compact">
            <div>
              <h3>阶段趋势明细</h3>
            </div>
          </div>

          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  <th>阶段</th>
                  <th>自然损耗</th>
                  <th>任务战损</th>
                  <th>人员伤亡</th>
                  <th>弹药当量</th>
                  <th>油料消耗</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in selectedSchemeResult.phaseTrend" :key="item.key">
                  <td>{{ item.label }}</td>
                  <td>{{ formatScore(item.naturalLoss, 2) }}</td>
                  <td>{{ formatScore(item.taskLoss, 2) }}</td>
                  <td>{{ formatScore(item.casualties, 2) }}</td>
                  <td>{{ formatScore(item.ammoEquivalent, 2) }}</td>
                  <td>{{ formatScore(item.fuelUsed, 2) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </template>
    </article>

    <ConsumptionChartsPanel
      :ranking="rankingRows"
      :schemes="state.results?.schemes || {}"
      :selected-scheme-id="state.selectedSchemeId"
    />
  </section>
</template>
