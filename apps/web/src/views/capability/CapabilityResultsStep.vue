<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import CapabilityChartsPanel from '../../components/CapabilityChartsPanel.vue';
import { useCapabilityWorkflow } from '../../modules/capabilityWorkflow';

const router = useRouter();

const {
  state,
  activeTask,
  methodOptions,
  visibleMethodTabs,
  selectedMethodMeta,
  selectedSchemeResult,
  rankingRows,
  topScheme,
  methodInsight,
  weightIssues,
  hasLeafIndicators,
  canEvaluate,
  calculateAssessment,
  setSelectedMethod,
  setSelectedScheme,
  toggleMethod,
  exportResults,
  formatScore,
} = useCapabilityWorkflow();

const selectedSchemeMeta = computed(() => activeTask.value?.schemes.find((item) => item.id === activeTask.value?.selectedSchemeId) || null);
const hasResults = computed(() => Boolean(activeTask.value?.results));
const selectedMethodCount = computed(() => activeTask.value?.selectedMethods.length || 0);
const resultsStatus = computed(() => {
  if (state.calculating) {
    return '计算中';
  }

  return hasResults.value ? '结果已生成' : '待生成';
});

function resolveCoreTheme(index) {
  const tones = [
    { accent: '#38bdf8', soft: 'rgba(56, 189, 248, 0.16)' },
    { accent: '#a3e635', soft: 'rgba(163, 230, 53, 0.16)' },
    { accent: '#fb923c', soft: 'rgba(251, 146, 60, 0.16)' },
    { accent: '#f97316', soft: 'rgba(249, 115, 22, 0.16)' },
    { accent: '#fb7185', soft: 'rgba(251, 113, 133, 0.16)' },
    { accent: '#c084fc', soft: 'rgba(192, 132, 252, 0.16)' },
  ];
  return tones[index % tones.length];
}

function isMethodSelected(methodKey) {
  return activeTask.value?.selectedMethods.includes(methodKey);
}

async function handleCalculate() {
  try {
    await calculateAssessment();
  } catch {
    // Error is stored in workflow state and rendered below.
  }
}
</script>

<template>
  <section class="capability-stage capability-stage--results">
    <article class="capability-stage-brief capability-stage-brief--results">
      <div class="capability-stage-brief__grid">
        <div class="capability-stage-brief__copy">
          <span class="eyebrow">Step 03 / 评估结果</span>
          <h3>生成评估结果</h3>

          <div class="capability-stage-pill-row">
            <span class="pill" :class="hasResults ? 'pill-active' : 'pill-muted'">{{ resultsStatus }}</span>
            <span class="pill pill-muted">已选算法 {{ selectedMethodCount }}</span>
          </div>
        </div>

        <div class="capability-stage-brief__stats">
          <div class="capability-stage-brief__stat">
            <span>已选对象</span>
            <strong>{{ selectedSchemeMeta?.name || '--' }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>当前算法视图</span>
            <strong>{{ selectedMethodMeta?.label || '--' }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>当前得分</span>
            <strong>{{ selectedSchemeResult ? formatScore(selectedSchemeResult.overallScore, 2) : '--' }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>排序第一对象</span>
            <strong>{{ topScheme?.name || '--' }}</strong>
          </div>
        </div>
      </div>
    </article>

    <article v-if="!hasLeafIndicators" class="detail-card compact-empty-state capability-step-guard">
      <strong>当前任务还没有可用于计算的指标树</strong>
      <p class="muted-text">请先回到“构建指标树并录入”，完成树结构、权重和三级指标值设置，再回到这里生成评估结果。</p>
      <div class="toolbar-row wrap">
        <button class="button" @click="router.push({ name: 'capability-tree' })">前往构建指标树并录入</button>
      </div>
    </article>

    <template v-else>
      <div class="capability-results-layout capability-results-layout--refined">
        <section class="capability-results-main">
          <article class="capability-stage-card capability-results-console capability-results-console--inline">
            <div class="capability-results-console__layout">
              <div class="capability-results-console__copy">
                <span class="eyebrow">控制台</span>
                <h3>算法与生成控制</h3>
                <p>把算法选择、结果生成和导出动作集中到融合结果上方，并按横向工具条展开，减少结果阅读时的视线跳转。</p>
              </div>

              <div class="capability-results-console__methods">
                <div class="capability-method-checklist capability-method-checklist--inline">
                  <label
                    v-for="method in methodOptions"
                    :key="method.key"
                    class="capability-method-toggle"
                    :class="{ active: isMethodSelected(method.key) }"
                  >
                    <input
                      type="checkbox"
                      :checked="isMethodSelected(method.key)"
                      @change="toggleMethod(method.key)"
                    />
                    <span class="capability-method-toggle__body">
                      <strong>{{ method.label }}</strong>
                      <small>{{ method.description }}</small>
                    </span>
                  </label>
                </div>
              </div>

              <div class="capability-results-console__actions">
                <span class="pill" :class="hasResults ? 'pill-active' : 'pill-muted'">{{ resultsStatus }}</span>
                <button class="button" :disabled="state.calculating || state.loading || !canEvaluate" @click="handleCalculate">
                  {{ state.calculating ? '计算中...' : hasResults ? '重新生成结果' : '生成评估结果' }}
                </button>
                <button class="button button-ghost" :disabled="!hasResults" @click="exportResults('json')">导出 JSON</button>
                <button class="button button-ghost" :disabled="!hasResults" @click="exportResults('csv')">导出 CSV</button>
                <button class="button button-ghost" :disabled="!hasResults" @click="exportResults('tsv')">导出 TSV</button>
              </div>
            </div>

            <div class="capability-results-console__feedback">
              <p v-if="weightIssues.length" class="auth-error capability-inline-error">
                当前存在 {{ weightIssues.length }} 组权重和不为 1，请先返回上一步手动调整权重后再计算。
              </p>
              <p v-if="state.errorMessage" class="auth-error capability-inline-error">{{ state.errorMessage }}</p>
              <p v-else-if="hasResults" class="capability-method-note">
                “排序第一对象”表示当前算法视图下综合得分最高的评估对象。
              </p>
            </div>
          </article>

          <article class="capability-result-shell">
            <div class="section-heading compact">
              <div>
                <h3>融合结果</h3>
                <p>查看所选对象在各算法下的综合得分、分项结果和排序情况。</p>
              </div>
              <div class="segmented-row segmented-row--compact">
                <button
                  v-for="method in visibleMethodTabs"
                  :key="method.key"
                  class="segmented"
                  :class="{ active: activeTask?.selectedMethod === method.key }"
                  @click="setSelectedMethod(method.key)"
                >
                  {{ method.label }}
                </button>
              </div>
            </div>

            <div v-if="!hasResults" class="detail-card compact-empty-state">
              <p class="muted-text">请先在上方控制区选择算法并生成结果。生成后这里会自动切换到排序、分项评分和图表阅读视图。</p>
            </div>

            <template v-else>
              <div class="stats-strip compact-grid four-up">
                <div class="mini-stat">
                  <span>当前方案得分</span>
                  <strong>{{ selectedSchemeResult ? Number(selectedSchemeResult.overallScore).toFixed(2) : '--' }}</strong>
                </div>
                <div class="mini-stat">
                  <span>评估等级</span>
                  <strong>{{ selectedSchemeResult?.grade || '--' }}</strong>
                </div>
                <div class="mini-stat">
                  <span>排序第一对象</span>
                  <strong>{{ topScheme?.name || '--' }}</strong>
                </div>
                <div class="mini-stat">
                  <span>{{ methodInsight.label }}</span>
                  <strong>{{ methodInsight.value }}</strong>
                  <small>{{ methodInsight.hint }}</small>
                </div>
              </div>

              <p v-if="selectedMethodMeta" class="capability-method-note top-gap">{{ selectedMethodMeta.description }}</p>

              <div v-if="selectedSchemeResult" class="capability-core-score-grid top-gap">
                <article
                  v-for="(item, index) in selectedSchemeResult.coreScores"
                  :key="item.id"
                  class="detail-card capability-score-card"
                  :style="{
                    '--capability-accent': resolveCoreTheme(index).accent,
                    '--capability-accent-soft': resolveCoreTheme(index).soft,
                  }"
                >
                  <span>{{ item.name }}</span>
                  <strong>{{ Number(item.score).toFixed(2) }}</strong>
                  <small>{{ item.grade }}</small>
                </article>
              </div>

              <div v-if="rankingRows.length" class="table-shell top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>排名</th>
                      <th>方案名称</th>
                      <th>综合得分</th>
                      <th>等级</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in rankingRows" :key="item.schemeId">
                      <td>{{ item.rank }}</td>
                      <td>{{ item.name }}</td>
                      <td>{{ Number(item.score).toFixed(2) }}</td>
                      <td>{{ item.grade }}</td>
                      <td>
                        <template v-if="activeTask?.selectedMethod === 'topsis'">
                          贴近度 {{ Number(item.closeness || 0).toFixed(4) }}
                        </template>
                        <template v-else-if="activeTask?.selectedMethod === 'fuzzy'">
                          模糊综合评价输出
                        </template>
                        <template v-else>
                          层次分析加权综合结果
                        </template>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </article>

          <CapabilityChartsPanel
            :methods="activeTask?.results?.methods || {}"
            :selected-method="activeTask?.selectedMethod || 'ahp'"
            :selected-scheme-id="activeTask?.selectedSchemeId || ''"
          />
        </section>

        <aside class="capability-results-side">
          <article class="capability-stage-card">
            <div class="section-heading compact">
              <div>
                <h3>对象切换</h3>
                <p>切换对象时，下方融合结果和图表会立即同步更新，不再和算法与生成控制区互相打断。</p>
              </div>
            </div>

            <div class="capability-flow-object-list capability-flow-object-list--stacked">
              <button
                v-for="scheme in activeTask?.schemes || []"
                :key="scheme.id"
                class="capability-flow-object-item"
                :class="{ active: activeTask?.selectedSchemeId === scheme.id }"
                @click="setSelectedScheme(scheme.id)"
              >
                <strong>{{ scheme.name }}</strong>
                <small>{{ scheme.description || '未填写对象说明。' }}</small>
              </button>
            </div>
          </article>
        </aside>
      </div>
    </template>
  </section>
</template>
