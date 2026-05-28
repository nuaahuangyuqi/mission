<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import CapabilityFilterPanel from '../../components/CapabilityFilterPanel.vue';
import { useCapabilityWorkflow } from '../../modules/capabilityWorkflow';

const router = useRouter();

const {
  activeTask,
  activeScheme,
  activeSchemeStats,
  previewTree,
  hasLeafIndicators,
  availableCoreOptions,
  getSecondaryOptions,
  weightIssues,
  hasValidWeights,
  updateNodeWeight,
  updateSchemeScore,
  updateSchemeField,
  setSelectedScheme,
  importInputDataFile,
  exportInputData,
  summarizeScheme,
  formatScore,
} = useCapabilityWorkflow();

const inputImportRef = ref(null);
const activeCoreId = ref('');
const activeSecondaryId = ref('');

const activeCore = computed(() => previewTree.value.find((item) => item.id === activeCoreId.value) || null);
const secondaryOptions = computed(() => activeCore.value ? getSecondaryOptions(activeCore.value.id) : []);
const activeSecondary = computed(() => activeCore.value?.children.find((item) => item.id === activeSecondaryId.value) || null);
const visibleWeightIssues = computed(() => weightIssues.value.slice(0, 4));

function resolveCoreTheme(index) {
  const tones = [
    { accent: '#38bdf8', soft: 'rgba(56, 189, 248, 0.16)', glow: 'rgba(56, 189, 248, 0.22)' },
    { accent: '#a3e635', soft: 'rgba(163, 230, 53, 0.16)', glow: 'rgba(163, 230, 53, 0.22)' },
    { accent: '#fb923c', soft: 'rgba(251, 146, 60, 0.16)', glow: 'rgba(251, 146, 60, 0.22)' },
    { accent: '#f97316', soft: 'rgba(249, 115, 22, 0.16)', glow: 'rgba(249, 115, 22, 0.22)' },
    { accent: '#fb7185', soft: 'rgba(251, 113, 133, 0.16)', glow: 'rgba(251, 113, 133, 0.22)' },
    { accent: '#c084fc', soft: 'rgba(192, 132, 252, 0.16)', glow: 'rgba(192, 132, 252, 0.22)' },
  ];
  return tones[index % tones.length];
}

function resolveCoreThemeIndex(coreId) {
  const index = previewTree.value.findIndex((item) => item.id === coreId);
  return index >= 0 ? index : 0;
}

function formatLeafUnit(unit) {
  return String(unit || '').trim() || '未设置';
}

watch(previewTree, (tree) => {
  if (!tree.length) {
    activeCoreId.value = '';
    activeSecondaryId.value = '';
    return;
  }

  if (!tree.some((item) => item.id === activeCoreId.value)) {
    activeCoreId.value = tree[0].id;
  }
}, { immediate: true });

watch(activeCore, (core) => {
  const secondaryIds = core?.children.map((item) => item.id) || [];
  if (!secondaryIds.length) {
    activeSecondaryId.value = '';
    return;
  }

  if (!secondaryIds.includes(activeSecondaryId.value)) {
    activeSecondaryId.value = secondaryIds[0];
  }
}, { immediate: true });

function triggerInputImport() {
  inputImportRef.value?.click();
}

async function handleInputImport(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    await importInputDataFile(file);
  } finally {
    event.target.value = '';
  }
}
</script>

<template>
  <section class="capability-stage capability-stage--input">
    <article class="capability-stage-brief capability-stage-brief--input">
      <div class="capability-stage-brief__grid">
        <div class="capability-stage-brief__copy">
          <span class="eyebrow">Step 04 / 权重与指标值</span>
          <h3>设置权重与指标值</h3>

          <div class="capability-stage-pill-row">
            <span class="pill" :class="hasValidWeights ? 'pill-active' : 'pill-warn'">
              {{ hasValidWeights ? '所有层级权重和 = 1' : `待修正 ${weightIssues.length} 组` }}
            </span>
            <span class="pill pill-muted">当前对象 {{ activeScheme?.name || '--' }}</span>
          </div>
        </div>

        <div class="capability-stage-brief__stats">
          <div class="capability-stage-brief__stat">
            <span>当前任务</span>
            <strong>{{ activeTask?.name || '--' }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>当前对象</span>
            <strong>{{ activeScheme?.name || '--' }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>指标均值</span>
            <strong>{{ formatScore(activeSchemeStats.average) }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>波动区间</span>
            <strong>{{ formatScore(activeSchemeStats.spread) }}</strong>
          </div>
        </div>
      </div>
    </article>

    <article v-if="!hasLeafIndicators" class="detail-card compact-empty-state capability-step-guard">
      <strong>当前任务还没有可录入的指标树</strong>
      <p class="muted-text">请先回到“创建指标树”步骤，从指标库加入一级或二级能力块；录入页只在有真实三级指标时开放编辑。</p>
      <div class="toolbar-row wrap">
        <button class="button" @click="router.push({ name: 'capability-tree' })">前往创建指标树</button>
      </div>
    </article>

    <template v-else>
      <div class="capability-input-workspace capability-input-workspace--refined">
        <aside class="capability-input-sidebar">
          <CapabilityFilterPanel
            title="录入定位"
            scope-hint="Step 04 本地定位"
            :core-options="availableCoreOptions"
            :active-core-id="activeCoreId"
            :secondary-options="secondaryOptions"
            :active-secondary-id="activeSecondaryId"
            :allow-secondary-all="false"
            @update:active-core-id="activeCoreId = $event"
            @update:active-secondary-id="activeSecondaryId = $event"
          />

          <article class="capability-stage-card capability-input-sidebar__section capability-stage-card--summary">
            <div class="section-heading compact">
              <div>
                <h3>当前录入面</h3>
                <p>先确认现在编辑的是哪个一级块、哪个二级块，再进入右侧详细录入。</p>
              </div>
            </div>

            <div class="capability-stage-summary-grid">
              <div class="capability-stage-summary-item">
                <span>一级能力块</span>
                <strong>{{ activeCore?.name || '--' }}</strong>
              </div>
              <div class="capability-stage-summary-item">
                <span>二级能力块</span>
                <strong>{{ activeSecondary?.name || '--' }}</strong>
              </div>
              <div class="capability-stage-summary-item">
                <span>三级指标数</span>
                <strong>{{ activeSecondary?.children.length || 0 }}</strong>
              </div>
              <div class="capability-stage-summary-item">
                <span>权重状态</span>
                <strong>{{ hasValidWeights ? '通过' : '待修正' }}</strong>
              </div>
            </div>

            <div v-if="visibleWeightIssues.length" class="capability-validation-list">
              <article v-for="issue in visibleWeightIssues" :key="issue.path" class="capability-validation-item">
                <strong>{{ issue.path }}</strong>
                <small>当前权重和 {{ issue.sum.toFixed(4) }}</small>
              </article>
            </div>

          </article>

          <article v-if="activeCore" class="capability-stage-card capability-input-sidebar__section">
            <div class="section-heading compact">
              <div>
                <h3>{{ activeCore.name }} / 分区导航</h3>
                <p>切换当前一级能力块下的二级能力分区，右侧只保留一个分区展开录入。</p>
              </div>
            </div>

            <div class="capability-input-nav-list">
              <button
                v-for="secondary in activeCore.children"
                :key="secondary.id"
                class="capability-input-nav-item"
                :class="{ active: activeSecondaryId === secondary.id }"
                @click="activeSecondaryId = secondary.id"
              >
                <span>{{ secondary.code }}</span>
                <strong>{{ secondary.name }}</strong>
                <small>{{ secondary.children.length }} 个三级指标</small>
              </button>
            </div>
          </article>
        </aside>

        <section class="capability-input-main">
          <article class="capability-stage-card capability-input-toolbar">
            <div class="capability-input-toolbar__head">
              <div>
                <h3>录入工具条</h3>
                <p>对象切换、导入导出和对象信息编辑集中放在这里，录入时不再上下跳转找入口。</p>
              </div>

              <div class="toolbar-row wrap">
                <button class="button" @click="triggerInputImport">导入指标值与权重</button>
                <button class="button button-ghost" @click="exportInputData('json')">导出 JSON</button>
                <button class="button button-ghost" @click="exportInputData('csv')">导出 CSV</button>
                <button class="button button-ghost" @click="exportInputData('tsv')">导出 TSV</button>
              </div>
            </div>

            <input ref="inputImportRef" type="file" class="capability-file-input" accept=".json,.csv,.tsv,.txt" @change="handleInputImport" />

            <div class="capability-flow-object-list capability-flow-object-list--inline">
              <button
                v-for="scheme in activeTask?.schemes || []"
                :key="scheme.id"
                class="capability-flow-object-item"
                :class="{ active: activeTask?.selectedSchemeId === scheme.id }"
                @click="setSelectedScheme(scheme.id)"
              >
                <strong>{{ scheme.name }}</strong>
                <small>均值 {{ formatScore(summarizeScheme(scheme).average) }} / 波动 {{ formatScore(summarizeScheme(scheme).spread) }}</small>
              </button>
            </div>

            <div v-if="activeScheme" class="form-grid capability-stage-form capability-input-toolbar__fields">
              <label>
                对象名称
                <input :value="activeScheme.name" type="text" @input="updateSchemeField(activeScheme.id, 'name', $event.target.value)" />
              </label>

              <label>
                对象说明
                <input :value="activeScheme.description" type="text" @input="updateSchemeField(activeScheme.id, 'description', $event.target.value)" />
              </label>
            </div>
          </article>

          <article
            v-if="activeCore"
            class="capability-core-card capability-core-card--focused"
            :style="{
              '--capability-accent': resolveCoreTheme(resolveCoreThemeIndex(activeCore.id)).accent,
              '--capability-accent-soft': resolveCoreTheme(resolveCoreThemeIndex(activeCore.id)).soft,
              '--capability-accent-glow': resolveCoreTheme(resolveCoreThemeIndex(activeCore.id)).glow,
            }"
          >
            <div class="capability-node-head">
              <div class="capability-node-copy">
                <span class="eyebrow">{{ activeCore.code }}</span>
                <h3>{{ activeCore.name }}</h3>
                <p>{{ activeCore.description }}</p>
              </div>
              <div class="capability-node-metrics">
                <label>
                  一级权重系数
                  <input
                    :value="activeCore.weight"
                    type="number"
                    min="0"
                    max="1"
                    step="0.0001"
                    @input="updateNodeWeight(activeCore.id, $event.target.value)"
                  />
                </label>
                <span class="pill capability-pill-soft">归一化 {{ (activeCore.normalizedWeight * 100).toFixed(2) }}%</span>
              </div>
            </div>

            <div v-if="activeSecondary" class="capability-secondary-focus">
              <div class="capability-node-head capability-node-head--secondary">
                <div class="capability-node-copy">
                  <span class="eyebrow">{{ activeSecondary.code }}</span>
                  <strong>{{ activeSecondary.name }}</strong>
                  <p>{{ activeSecondary.description }}</p>
                </div>
                <div class="capability-node-metrics">
                  <label>
                    二级权重系数
                    <input
                      :value="activeSecondary.weight"
                      type="number"
                      min="0"
                      max="1"
                      step="0.0001"
                      @input="updateNodeWeight(activeSecondary.id, $event.target.value)"
                    />
                  </label>
                  <span class="pill capability-pill-soft">归一化 {{ (activeSecondary.normalizedWeight * 100).toFixed(2) }}%</span>
                </div>
              </div>

              <div class="capability-leaf-editor-list">
                <article
                  v-for="leaf in activeSecondary.children"
                  :key="leaf.id"
                  class="capability-leaf-editor-card"
                >
                  <div class="capability-leaf-editor-card__head">
                    <div class="capability-leaf-editor-card__title">
                      <span class="eyebrow">{{ leaf.code }}</span>
                      <strong>{{ leaf.name }}</strong>
                    </div>
                    <span class="pill capability-pill-soft">当前值 {{ formatScore(activeScheme?.scores?.[leaf.id] ?? 0) }}</span>
                  </div>

                  <p>{{ leaf.description || '未填写指标说明。' }}</p>

                  <div class="capability-leaf-editor-card__fields">
                    <label>
                      指标值（{{ formatLeafUnit(leaf.unit) }}）
                      <input
                        :value="activeScheme?.scores?.[leaf.id] ?? 0"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        @input="updateSchemeScore(activeTask?.selectedSchemeId, leaf.id, $event.target.value)"
                      />
                    </label>

                    <label>
                      三级权重系数
                      <input
                        :value="leaf.weight"
                        type="number"
                        min="0"
                        max="1"
                        step="0.0001"
                        @input="updateNodeWeight(leaf.id, $event.target.value)"
                      />
                    </label>
                  </div>

                  <div class="capability-leaf-editor-card__metrics">
                    <span class="pill pill-muted">局部权重 {{ (leaf.normalizedWeight * 100).toFixed(2) }}%</span>
                    <span class="pill pill-muted">全局权重 {{ (leaf.globalWeight * 100).toFixed(2) }}%</span>
                    <span class="pill pill-muted">单位 {{ formatLeafUnit(leaf.unit) }}</span>
                  </div>
                </article>
              </div>
            </div>
          </article>

          <article v-else class="detail-card compact-empty-state capability-step-guard">
            <strong>请先在左侧确定录入定位</strong>
            <p class="muted-text">先选择一个一级能力块和一个二级能力块，右侧录入区才会展开具体指标。</p>
          </article>
        </section>
      </div>
    </template>
  </section>
</template>
