<script setup>
import { computed, ref, watch } from 'vue';
import CapabilityFilterPanel from '../../components/CapabilityFilterPanel.vue';
import { CAPABILITY_COMMON_UNITS } from '../../modules/capabilityShared';
import { useCapabilityWorkflow } from '../../modules/capabilityWorkflow';

const {
  state,
  activeTask,
  previewTree,
  availableCoreOptions,
  workflowSummary,
  selectedMethodLabels,
  setAssessmentName,
  setTaskName,
  setTaskDescription,
  setSelectedEngine,
  setSelectedTask,
  createBlankTask,
  createTaskFromTemplateId,
  duplicateTask,
  removeTask,
  resetTaskToTemplate,
  saveCurrentTreeAsTemplate,
  applyTemplateToTask,
  deleteTemplate,
  updateSchemeField,
  updateNodeField,
  addSecondaryFromLibrary,
  addLeafFromLibrary,
  removeIndicator,
  canRemoveIndicator,
  getSecondaryOptions,
  getLibrarySecondaryOptions,
  getLibraryLeafOptions,
  summarizeScheme,
  formatScore,
} = useCapabilityWorkflow();

const templateDraftName = ref('');
const activeCoreId = ref('');
const activeSecondaryId = ref('');
const utilityTab = ref('tasks');
const secondarySelectionByCore = ref({});
const leafSelectionBySecondary = ref({});
const customUnitLeafIds = ref({});
const commonUnitOptions = CAPABILITY_COMMON_UNITS;
const COMMON_UNIT_SET = new Set(CAPABILITY_COMMON_UNITS);
const CUSTOM_UNIT_VALUE = '__custom__';

const engineDescription = computed(() => state.template?.engines?.find((item) => item.key === activeTask.value?.selectedEngine)?.description || '');
const activeCore = computed(() => previewTree.value.find((item) => item.id === activeCoreId.value) || null);
const secondaryOptions = computed(() => (activeCore.value ? getSecondaryOptions(activeCore.value.id) : []));
const visibleCoreEditors = computed(() => {
  if (!activeCore.value) {
    return [];
  }

  return [{
    ...activeCore.value,
    children: activeSecondaryId.value
      ? activeCore.value.children.filter((secondary) => secondary.id === activeSecondaryId.value)
      : activeCore.value.children,
  }];
});

function countTertiary(nodes) {
  return nodes.reduce((total, secondary) => total + secondary.children.length, 0);
}

function resolveCoreThemeIndex(coreId) {
  const index = previewTree.value.findIndex((item) => item.id === coreId);
  return index >= 0 ? index : 0;
}

function findSecondaryInTree(secondaryId) {
  for (const core of previewTree.value) {
    const secondary = core.children.find((item) => item.id === secondaryId);
    if (secondary) {
      return secondary;
    }
  }
  return null;
}

function availableSecondaryLibraryOptions(coreId) {
  const selectedIds = new Set((previewTree.value.find((item) => item.id === coreId)?.children || []).map((item) => item.id));
  return getLibrarySecondaryOptions(coreId).filter((item) => !selectedIds.has(item.id));
}

function availableLeafLibraryOptions(secondaryId) {
  const selectedIds = new Set((findSecondaryInTree(secondaryId)?.children || []).map((item) => item.id));
  return getLibraryLeafOptions(secondaryId).filter((item) => !selectedIds.has(item.id));
}

function handleAddSecondaryFromLibrary(coreId) {
  const secondaryId = secondarySelectionByCore.value[coreId];
  if (!secondaryId) {
    return;
  }

  addSecondaryFromLibrary(coreId, secondaryId);
  secondarySelectionByCore.value = {
    ...secondarySelectionByCore.value,
    [coreId]: '',
  };
}

function handleAddLeafFromLibrary(secondaryId) {
  const leafId = leafSelectionBySecondary.value[secondaryId];
  if (!leafId) {
    return;
  }

  addLeafFromLibrary(secondaryId, leafId);
  leafSelectionBySecondary.value = {
    ...leafSelectionBySecondary.value,
    [secondaryId]: '',
  };
}

function setCustomUnitMode(leafId, enabled) {
  const next = { ...customUnitLeafIds.value };
  if (enabled) {
    next[leafId] = true;
  } else {
    delete next[leafId];
  }
  customUnitLeafIds.value = next;
}

function isCustomUnit(unit) {
  const normalized = String(unit || '').trim();
  return Boolean(normalized) && !COMMON_UNIT_SET.has(normalized);
}

function isCustomUnitMode(leaf) {
  return Boolean(customUnitLeafIds.value[leaf.id]) || isCustomUnit(leaf.unit);
}

function resolveUnitPresetValue(leaf) {
  if (isCustomUnitMode(leaf)) {
    return CUSTOM_UNIT_VALUE;
  }
  return String(leaf.unit || '').trim();
}

function handleUnitPresetChange(leaf, value) {
  if (value === CUSTOM_UNIT_VALUE) {
    setCustomUnitMode(leaf.id, true);
    if (!isCustomUnit(leaf.unit)) {
      updateNodeField(leaf.id, 'unit', '');
    }
    return;
  }

  setCustomUnitMode(leaf.id, false);
  updateNodeField(leaf.id, 'unit', value);
}

function handleCustomUnitInput(leafId, value) {
  setCustomUnitMode(leafId, true);
  updateNodeField(leafId, 'unit', value);
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
  if (activeSecondaryId.value && !secondaryIds.includes(activeSecondaryId.value)) {
    activeSecondaryId.value = '';
  }
}, { immediate: true });

function handleCreateTask(templateId) {
  createTaskFromTemplateId(templateId);
}

function handleRemoveTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }

  if (window.confirm(`确认删除评估任务“${task.name}”吗？`)) {
    removeTask(taskId);
  }
}

function handleSaveTemplate() {
  saveCurrentTreeAsTemplate({
    name: templateDraftName.value || `${activeTask.value?.name || '当前任务'} 模板`,
    description: activeTask.value?.description || '',
  });
  templateDraftName.value = '';
}

function handleDeleteTemplate(templateId, templateName) {
  if (window.confirm(`确认删除模板“${templateName}”吗？`)) {
    deleteTemplate(templateId);
  }
}
</script>

<template>
  <section class="capability-stage capability-stage--framework">
    <article class="capability-stage-brief capability-stage-brief--framework">
      <div class="capability-stage-brief__grid">
        <div class="capability-stage-brief__copy">
          <span class="eyebrow">Step 02 / 任务与指标体系</span>
          <h3>构建指标体系</h3>

          <div class="capability-stage-pill-row">
            <span class="pill pill-active">{{ selectedMethodLabels.join(' / ') || 'AHP / 模糊综合评价 / TOPSIS' }}</span>
            <span class="pill pill-muted">当前引擎 {{ activeTask?.selectedEngine || 'builtin' }}</span>
          </div>
        </div>

        <div class="capability-stage-brief__stats">
          <div class="capability-stage-brief__stat">
            <span>当前任务</span>
            <strong>{{ activeTask?.name || '--' }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>一级能力块</span>
            <strong>{{ workflowSummary.coreCount }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>三级指标</span>
            <strong>{{ workflowSummary.tertiaryCount }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>评估对象</span>
            <strong>{{ workflowSummary.schemeCount }}</strong>
          </div>
        </div>
      </div>
    </article>

    <div class="capability-framework-layout">
      <section class="capability-framework-main">
        <article class="capability-stage-card capability-stage-card--focus">
          <div class="section-heading compact">
            <div>
              <h3>当前评估任务配置</h3>
              <p>先定义任务名称、评估名称、说明和引擎；指标内容则从指标库按父子关系选取，不再在任务里直接新建空白指标。</p>
            </div>

            <div class="toolbar-row wrap">
              <button class="button button-ghost" @click="duplicateTask()">复制当前任务</button>
              <button class="button button-ghost" @click="resetTaskToTemplate">恢复模板内容</button>
            </div>
          </div>

          <div class="form-grid capability-stage-form">
            <label>
              任务名称
              <input
                :value="activeTask?.name || ''"
                type="text"
                placeholder="例如：联合作战能力评估任务"
                @input="setTaskName($event.target.value)"
              />
            </label>

            <label>
              评估名称
              <input
                :value="activeTask?.assessmentName || ''"
                type="text"
                placeholder="用于结果输出的评估标题"
                @input="setAssessmentName($event.target.value)"
              />
            </label>

            <label class="full-span">
              任务说明
              <textarea
                rows="3"
                :value="activeTask?.description || ''"
                placeholder="补充当前评估任务的背景、目的和适用场景"
                @input="setTaskDescription($event.target.value)"
              ></textarea>
            </label>

            <label>
              计算引擎
              <select :value="activeTask?.selectedEngine || 'builtin'" @change="setSelectedEngine($event.target.value)">
                <option
                  v-for="engine in state.template?.engines || []"
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
            <p>{{ engineDescription }}</p>
          </div>
        </article>

        <CapabilityFilterPanel
          v-if="availableCoreOptions.length"
          title="当前编辑区域定位"
          scope-hint="Step 02 本地定位"
          :core-options="availableCoreOptions"
          :active-core-id="activeCoreId"
          :secondary-options="secondaryOptions"
          :active-secondary-id="activeSecondaryId"
          secondary-all-label="恢复当前一级块总览"
          @update:active-core-id="activeCoreId = $event"
          @update:active-secondary-id="activeSecondaryId = $event"
        />

        <div class="capability-framework-builder">
          <article
            v-for="core in visibleCoreEditors"
            :key="core.id"
            class="capability-framework-editor"
            :style="{
              '--capability-accent': ['#38bdf8', '#a3e635', '#fb923c', '#f97316', '#fb7185', '#c084fc'][resolveCoreThemeIndex(core.id) % 6],
              '--capability-accent-soft': ['rgba(56, 189, 248, 0.18)', 'rgba(163, 230, 53, 0.18)', 'rgba(251, 146, 60, 0.18)', 'rgba(249, 115, 22, 0.18)', 'rgba(251, 113, 133, 0.18)', 'rgba(192, 132, 252, 0.18)'][resolveCoreThemeIndex(core.id) % 6],
            }"
          >
            <div class="capability-framework-editor__head">
              <div>
                <span class="eyebrow">{{ core.code }}</span>
                <h3>{{ core.name }}</h3>
                <p>{{ core.description || '未填写一级能力块说明。' }}</p>
              </div>
              <div class="toolbar-row wrap">
                <label class="capability-inline-field">
                  从指标库加入二级
                  <select v-model="secondarySelectionByCore[core.id]">
                    <option value="">选择对应二级指标</option>
                    <option
                      v-for="option in availableSecondaryLibraryOptions(core.id)"
                      :key="option.id"
                      :value="option.id"
                    >
                      {{ option.code }} {{ option.name }}
                    </option>
                  </select>
                </label>
                <button
                  class="button"
                  :disabled="!secondarySelectionByCore[core.id]"
                  @click="handleAddSecondaryFromLibrary(core.id)"
                >
                  加入二级指标
                </button>
              </div>
            </div>

            <div class="capability-stage-pill-row">
              <span class="pill capability-pill-soft">{{ core.children.length }} 个二级能力块</span>
              <span class="pill pill-muted">{{ countTertiary(core.children) }} 个三级指标</span>
            </div>

            <div class="capability-stage-note" v-if="!availableSecondaryLibraryOptions(core.id).length">
              <span>当前状态</span>
              <p>该一级能力块在当前任务中已经加入了指标库下的全部对应二级指标。</p>
            </div>

            <div class="capability-editor-secondary-list">
              <section
                v-for="secondary in core.children"
                :key="secondary.id"
                class="capability-editor-secondary-card"
              >
                <div class="capability-editor-secondary-card__head">
                  <div>
                    <span class="eyebrow">{{ secondary.code }}</span>
                    <h4>{{ secondary.name }}</h4>
                  </div>
                  <button
                    class="button button-ghost"
                    :disabled="!canRemoveIndicator(secondary.id)"
                    @click="removeIndicator(secondary.id)"
                  >
                    删除二级能力块
                  </button>
                </div>

                <div class="form-grid capability-editor-form">
                  <label>
                    二级能力块名称
                    <input
                      :value="secondary.name"
                      type="text"
                      @input="updateNodeField(secondary.id, 'name', $event.target.value)"
                    />
                  </label>

                  <label class="full-span">
                    二级能力块说明
                    <textarea
                      rows="3"
                      :value="secondary.description"
                      @input="updateNodeField(secondary.id, 'description', $event.target.value)"
                    ></textarea>
                  </label>
                </div>

                <div class="capability-editor-tertiary-list">
                  <article
                    v-for="leaf in secondary.children"
                    :key="leaf.id"
                    class="capability-editor-tertiary-card"
                  >
                    <div class="capability-editor-tertiary-card__head">
                      <span class="eyebrow">{{ leaf.code }}</span>
                      <button
                        class="button button-ghost"
                        :disabled="!canRemoveIndicator(leaf.id)"
                        @click="removeIndicator(leaf.id)"
                      >
                        删除三级指标
                      </button>
                    </div>

                    <div class="form-grid capability-editor-form capability-editor-form--tertiary">
                      <label>
                        三级指标名称
                        <input
                          :value="leaf.name"
                          type="text"
                          @input="updateNodeField(leaf.id, 'name', $event.target.value)"
                        />
                      </label>

                      <label>
                        单位
                        <div class="capability-unit-field">
                          <select
                            :value="resolveUnitPresetValue(leaf)"
                            @change="handleUnitPresetChange(leaf, $event.target.value)"
                          >
                            <option value="">未设置</option>
                            <option v-for="unit in commonUnitOptions" :key="unit" :value="unit">{{ unit }}</option>
                            <option :value="CUSTOM_UNIT_VALUE">自定义输入</option>
                          </select>
                          <input
                            v-if="isCustomUnitMode(leaf)"
                            :value="leaf.unit || ''"
                            type="text"
                            placeholder="输入自定义单位"
                            @input="handleCustomUnitInput(leaf.id, $event.target.value)"
                          />
                        </div>
                      </label>

                      <label class="full-span">
                        三级指标说明
                        <textarea
                          rows="3"
                          :value="leaf.description"
                          @input="updateNodeField(leaf.id, 'description', $event.target.value)"
                        ></textarea>
                      </label>
                    </div>
                  </article>
                </div>

                <div class="capability-editor-secondary-card__foot">
                  <span class="pill pill-muted">三级指标 {{ secondary.children.length }}</span>
                  <label class="capability-inline-field">
                    从指标库加入三级
                    <select v-model="leafSelectionBySecondary[secondary.id]">
                      <option value="">选择对应三级指标</option>
                      <option
                        v-for="option in availableLeafLibraryOptions(secondary.id)"
                        :key="option.id"
                        :value="option.id"
                      >
                        {{ option.code }} {{ option.name }}
                      </option>
                    </select>
                  </label>
                  <button
                    class="button button-ghost"
                    :disabled="!leafSelectionBySecondary[secondary.id]"
                    @click="handleAddLeafFromLibrary(secondary.id)"
                  >
                    加入三级指标
                  </button>
                </div>
              </section>
            </div>
          </article>

          <article v-if="!visibleCoreEditors.length" class="detail-card compact-empty-state capability-step-guard">
            <strong>当前任务还是空白指标树</strong>
            <p class="muted-text">请先到“指标库管理”维护指标定义，然后在“创建指标树”中加入一级指标；回到这里后，再从指标库补充对应的二级、三级指标。</p>
          </article>
        </div>
      </section>

      <aside class="capability-framework-side">
        <article class="capability-stage-card capability-utility-panel">
          <div class="capability-utility-panel__head">
            <div>
              <h3>任务与模板工具</h3>
              <p>这里负责切换任务和复用模板，避免把这些辅助工具与主编辑区混在一起。</p>
            </div>

            <div class="segmented-row segmented-row--compact capability-utility-tabs">
              <button class="segmented" :class="{ active: utilityTab === 'tasks' }" @click="utilityTab = 'tasks'">任务</button>
              <button class="segmented" :class="{ active: utilityTab === 'templates' }" @click="utilityTab = 'templates'">模板</button>
            </div>
          </div>

          <template v-if="utilityTab === 'tasks'">
            <div class="section-heading compact">
              <div>
                <h4>评估任务管理</h4>
                <p>支持创建多个评估任务，并在任务之间切换、复制和删除。</p>
              </div>
              <button class="button" @click="createBlankTask()">新建空白任务</button>
            </div>

            <div class="capability-task-grid capability-task-grid--stacked">
              <article
                v-for="task in state.tasks"
                :key="task.id"
                class="capability-task-card"
                :class="{ active: state.selectedTaskId === task.id }"
              >
                <div class="capability-task-card__head">
                  <div>
                    <span class="pill" :class="state.selectedTaskId === task.id ? 'pill-active' : 'pill-muted'">任务</span>
                    <strong>{{ task.name }}</strong>
                  </div>
                  <button class="button button-ghost" @click="setSelectedTask(task.id)">切换</button>
                </div>

                <p>{{ task.description || '未填写任务说明。' }}</p>

                <div class="capability-task-card__stats">
                  <div>
                    <span>评估对象</span>
                    <strong>{{ task.schemes.length }}</strong>
                  </div>
                  <div>
                    <span>版本数量</span>
                    <strong>{{ task.treeVersions.length }}</strong>
                  </div>
                </div>

                <div class="toolbar-row wrap">
                  <button class="button button-ghost" @click="duplicateTask(task.id)">复制</button>
                  <button class="button button-danger" :disabled="state.tasks.length <= 1" @click="handleRemoveTask(task.id)">删除</button>
                </div>
              </article>
            </div>
          </template>

          <template v-else>
            <div class="section-heading compact">
              <div>
                <h4>模板沉淀与复用</h4>
                <p>常用树结构沉淀成模板，后续可以直接创建新任务或覆盖当前任务。</p>
              </div>
            </div>

            <div class="toolbar-row wrap">
              <label class="capability-inline-field">
                模板名称
                <input v-model="templateDraftName" type="text" placeholder="例如：联合作战标准模板" />
              </label>
              <button class="button" @click="handleSaveTemplate">保存当前任务为模板</button>
            </div>

            <div class="capability-template-grid capability-template-grid--stacked">
              <article
                v-for="templateItem in state.templateLibrary"
                :key="templateItem.id"
                class="capability-template-card"
              >
                <div class="capability-template-card__head">
                  <div>
                    <span class="pill" :class="templateItem.source === 'system' ? 'pill-active' : 'pill-muted'">
                      {{ templateItem.source === 'system' ? '系统模板' : '历史模板' }}
                    </span>
                    <strong>{{ templateItem.name }}</strong>
                  </div>
                  <small>{{ templateItem.summary.coreCount }} / {{ templateItem.summary.secondaryCount }} / {{ templateItem.summary.tertiaryCount }}</small>
                </div>

                <p>{{ templateItem.description || '未填写模板说明。' }}</p>

                <div class="toolbar-row wrap">
                  <button class="button" @click="handleCreateTask(templateItem.id)">基于模板新建任务</button>
                  <button class="button button-ghost" @click="applyTemplateToTask(templateItem.id)">应用到当前任务</button>
                  <button
                    class="button button-danger"
                    :disabled="templateItem.source === 'system'"
                    @click="handleDeleteTemplate(templateItem.id, templateItem.name)"
                  >
                    删除模板
                  </button>
                </div>
              </article>
            </div>
          </template>
        </article>

        <article class="capability-stage-card capability-stage-card--schemes">
          <div class="section-heading compact">
            <div>
              <h3>评估对象</h3>
              <p>对象信息放在右侧作为次级信息，不打断上方的指标体系构建流程。</p>
            </div>
          </div>

          <div class="capability-workflow-scheme-grid">
            <article
              v-for="(scheme, index) in activeTask?.schemes || []"
              :key="scheme.id"
              class="capability-workflow-scheme-card"
            >
              <div class="capability-workflow-scheme-card__head">
                <div>
                  <span class="pill" :class="activeTask?.selectedSchemeId === scheme.id ? 'pill-active' : 'pill-muted'">对象 {{ index + 1 }}</span>
                  <strong>{{ scheme.name }}</strong>
                </div>
                <span class="pill pill-muted">均值 {{ formatScore(summarizeScheme(scheme).average) }}</span>
              </div>

              <div class="capability-workflow-scheme-card__stats">
                <div>
                  <span>最高值</span>
                  <strong>{{ formatScore(summarizeScheme(scheme).high) }}</strong>
                </div>
                <div>
                  <span>最低值</span>
                  <strong>{{ formatScore(summarizeScheme(scheme).low) }}</strong>
                </div>
              </div>

              <label>
                对象名称
                <input :value="scheme.name" type="text" @input="updateSchemeField(scheme.id, 'name', $event.target.value)" />
              </label>
              <label>
                对象说明
                <textarea rows="3" :value="scheme.description" @input="updateSchemeField(scheme.id, 'description', $event.target.value)"></textarea>
              </label>
            </article>
          </div>
        </article>
      </aside>
    </div>
  </section>
</template>
