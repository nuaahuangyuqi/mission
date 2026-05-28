<script setup>
import ActionChartsPanel from '../../components/ActionChartsPanel.vue';
import { useActionWorkflow } from '../../modules/actionWorkflow';

const {
  state,
  activeScheme,
  rankingRows,
  recommendedScheme,
  selectedSchemeResult,
  selectedObjectiveMeta,
  resultsGeneratedAt,
  calculateActionAssessment,
  setSelectedScheme,
  formatScore,
} = useActionWorkflow();

async function handleCalculate() {
  try {
    await calculateActionAssessment();
  } catch {
    // Shared state already stores the message.
  }
}
</script>

<template>
  <section class="capability-stage action-stage">
    <div class="capability-stage-grid capability-stage-grid--dual">
      <article class="capability-stage-card capability-stage-card--hero">
        <span class="eyebrow">Step 03 / 预测与优化</span>
        <h3>生成行动评估结果</h3>

        <div class="capability-stage-summary-grid">
          <div class="capability-stage-summary-item">
            <span>优化目标</span>
            <strong>{{ selectedObjectiveMeta?.label || '--' }}</strong>
          </div>
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
          <h3>多方案推荐结果</h3>
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
            <small>推荐分 {{ formatScore(item.recommendationScore, 2) }}</small>
          </button>
        </div>
      </div>

      <div v-if="!state.results" class="detail-card compact-empty-state">
        <p class="muted-text">生成结果后显示方案排序与预测明细</p>
      </div>

      <template v-else>
        <div class="stats-strip compact-grid four-up">
          <div class="mini-stat">
            <span>推荐方案</span>
            <strong>{{ recommendedScheme?.name || '--' }}</strong>
          </div>
          <div class="mini-stat">
            <span>当前方案总时间</span>
            <strong>{{ selectedSchemeResult ? `${formatScore(selectedSchemeResult.totals.totalTime, 1)} 分钟` : '--' }}</strong>
          </div>
          <div class="mini-stat">
            <span>当前方案总路径</span>
            <strong>{{ selectedSchemeResult ? `${formatScore(selectedSchemeResult.totals.totalDistance, 1)} 公里` : '--' }}</strong>
          </div>
          <div class="mini-stat">
            <span>当前方案资源代价</span>
            <strong>{{ selectedSchemeResult ? formatScore(selectedSchemeResult.totals.resourceCost, 2) : '--' }}</strong>
          </div>
        </div>

        <div class="table-shell top-gap">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>方案</th>
                <th>推荐分</th>
                <th>总时间</th>
                <th>总路径</th>
                <th>资源代价</th>
                <th>平均风险</th>
                <th>问题数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in rankingRows" :key="item.schemeId">
                <td>{{ item.rank }}</td>
                <td>{{ item.name }}</td>
                <td>{{ formatScore(item.recommendationScore, 2) }}</td>
                <td>{{ formatScore(item.totalTime, 1) }}</td>
                <td>{{ formatScore(item.totalDistance, 1) }}</td>
                <td>{{ formatScore(item.resourceCost, 2) }}</td>
                <td>{{ formatScore(item.averageRisk, 2) }}</td>
                <td>{{ item.issueCount }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="selectedSchemeResult" class="action-result-grid top-gap">
          <article class="capability-stage-card">
            <div class="section-heading compact">
              <div>
                <h3>当前方案详情</h3>
              </div>
              <span class="pill pill-active">等级 {{ selectedSchemeResult.grade }}</span>
            </div>

            <div class="capability-stage-summary-grid">
              <div class="capability-stage-summary-item">
                <span>推荐分</span>
                <strong>{{ formatScore(selectedSchemeResult.recommendationScore, 2) }}</strong>
              </div>
              <div class="capability-stage-summary-item">
                <span>总时间</span>
                <strong>{{ formatScore(selectedSchemeResult.predictions.time, 1) }} 分钟</strong>
              </div>
              <div class="capability-stage-summary-item">
                <span>总路径</span>
                <strong>{{ formatScore(selectedSchemeResult.predictions.path, 1) }} 公里</strong>
              </div>
              <div class="capability-stage-summary-item">
                <span>资源代价</span>
                <strong>{{ formatScore(selectedSchemeResult.predictions.resources, 2) }}</strong>
              </div>
            </div>

            <article class="detail-card">
              <span class="eyebrow">优化建议</span>
              <ul class="action-text-list">
                <li v-for="item in selectedSchemeResult.suggestions" :key="item">{{ item }}</li>
              </ul>
            </article>
          </article>

          <article class="capability-stage-card">
            <div class="section-heading compact">
              <div>
                <h3>资源利用率</h3>
              </div>
            </div>

            <div class="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>资源</th>
                    <th>已用</th>
                    <th>可用</th>
                    <th>利用率</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in selectedSchemeResult.resourceUsage" :key="item.key">
                    <td>{{ item.label }}</td>
                    <td>{{ formatScore(item.used, 1) }}</td>
                    <td>{{ formatScore(item.available, 1) }}</td>
                    <td>{{ formatScore(item.utilization * 100, 1) }}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <article v-if="selectedSchemeResult" class="capability-stage-card">
          <div class="section-heading compact">
            <div>
              <h3>节点预测明细</h3>
            </div>
          </div>

          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  <th>节点</th>
                  <th>开始</th>
                  <th>结束</th>
                  <th>时长</th>
                  <th>路径</th>
                  <th>风险</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in selectedSchemeResult.nodes" :key="item.id">
                  <td>{{ item.name }}</td>
                  <td>{{ formatScore(item.startTime, 2) }}</td>
                  <td>{{ formatScore(item.endTime, 2) }}</td>
                  <td>{{ formatScore(item.duration, 2) }}</td>
                  <td>{{ formatScore(item.distance, 2) }}</td>
                  <td>{{ formatScore(item.riskScore, 2) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </template>
    </article>

    <ActionChartsPanel
      :ranking="rankingRows"
      :schemes="state.results?.schemes || {}"
      :selected-scheme-id="state.selectedSchemeId"
    />
  </section>
</template>
