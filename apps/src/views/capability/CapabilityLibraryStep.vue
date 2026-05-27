<script setup>
import { computed, ref, watch } from 'vue';
import CapabilityFilterPanel from '../../components/CapabilityFilterPanel.vue';
import { useCapabilityWorkflow } from '../../modules/capabilityWorkflow';

const {
  indicatorLibrary,
  librarySummary,
  getLibrarySecondaryOptions,
  addCoreToLibrary,
  addSecondaryToLibrary,
  addLeafToLibrary,
  updateLibraryNodeField,
  removeLibraryIndicator,
} = useCapabilityWorkflow();

const activeCoreId = ref('');
const activeSecondaryId = ref('');

const availableCoreOptions = computed(() => indicatorLibrary.value.map((item) => ({
  id: item.id,
  code: item.code,
  name: item.name,
})));
const activeCore = computed(() => indicatorLibrary.value.find((item) => item.id === activeCoreId.value) || null);
const secondaryOptions = computed(() => (activeCore.value ? getLibrarySecondaryOptions(activeCore.value.id) : []));
const visibleCoreEditors = computed(() => {
  if (!activeCore.value) {
    return indicatorLibrary.value;
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
  const index = indicatorLibrary.value.findIndex((item) => item.id === coreId);
  return index >= 0 ? index : 0;
}

function handleRemove(nodeId, nodeName) {
  if (!window.confirm(`确认从指标库删除“${nodeName}”吗？`)) {
    return;
  }

  removeLibraryIndicator(nodeId);
}

watch(indicatorLibrary, (tree) => {
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
</script>

<template>
  <section class="capability-stage capability-stage--framework">
    <article class="capability-stage-brief capability-stage-brief--framework">
      <div class="capability-stage-brief__grid">
        <div class="capability-stage-brief__copy">
          <span class="eyebrow">Step 01 / 指标库</span>
          <h3>管理指标库</h3>

          <div class="capability-stage-pill-row">
            <span class="pill pill-active">一级 / 二级 / 三级指标</span>
          </div>
        </div>

        <div class="capability-stage-brief__stats">
          <div class="capability-stage-brief__stat">
            <span>一级指标</span>
            <strong>{{ librarySummary.coreCount }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>二级指标</span>
            <strong>{{ librarySummary.secondaryCount }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>三级指标</span>
            <strong>{{ librarySummary.tertiaryCount }}</strong>
          </div>
          <div class="capability-stage-brief__stat">
            <span>层级关系</span>
            <strong>已维护</strong>
          </div>
        </div>
      </div>
    </article>

    <div class="capability-framework-layout">
      <section class="capability-framework-main">
        <article class="capability-stage-card capability-stage-card--focus">
          <div class="section-heading compact">
            <div>
              <h3>指标库</h3>
            </div>

            <div class="toolbar-row wrap">
              <button class="button" @click="addCoreToLibrary()">新增一级指标</button>
            </div>
          </div>
        </article>

        <CapabilityFilterPanel
          v-if="availableCoreOptions.length"
          title="指标定位"
          scope-hint="Step 01"
          :core-options="availableCoreOptions"
          :active-core-id="activeCoreId"
          :secondary-options="secondaryOptions"
          :active-secondary-id="activeSecondaryId"
          secondary-all-label="查看当前一级指标全部下级"
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
              </div>
              <div class="toolbar-row wrap">
                <button class="button button-ghost" @click="addSecondaryToLibrary(core.id)">新增二级指标</button>
                <button class="button button-danger" @click="handleRemove(core.id, core.name)">删除一级指标</button>
              </div>
            </div>

            <div class="form-grid capability-editor-form">
              <label>
                一级指标名称
                <input
                  :value="core.name"
                  type="text"
                  @input="updateLibraryNodeField(core.id, 'name', $event.target.value)"
                />
              </label>

              <label class="full-span">
                一级指标说明
                <textarea
                  rows="3"
                  :value="core.description"
                  @input="updateLibraryNodeField(core.id, 'description', $event.target.value)"
                ></textarea>
              </label>
            </div>

            <div class="capability-stage-pill-row">
              <span class="pill capability-pill-soft">{{ core.children.length }} 个二级指标</span>
              <span class="pill pill-muted">{{ countTertiary(core.children) }} 个三级指标</span>
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
                  <div class="toolbar-row wrap">
                    <button class="button button-ghost" @click="addLeafToLibrary(secondary.id)">新增三级指标</button>
                    <button class="button button-danger" @click="handleRemove(secondary.id, secondary.name)">删除二级指标</button>
                  </div>
                </div>

                <div class="form-grid capability-editor-form">
                  <label>
                    二级指标名称
                    <input
                      :value="secondary.name"
                      type="text"
                      @input="updateLibraryNodeField(secondary.id, 'name', $event.target.value)"
                    />
                  </label>

                  <label class="full-span">
                    二级指标说明
                    <textarea
                      rows="3"
                      :value="secondary.description"
                      @input="updateLibraryNodeField(secondary.id, 'description', $event.target.value)"
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
                      <button class="button button-danger" @click="handleRemove(leaf.id, leaf.name)">删除三级指标</button>
                    </div>

                    <div class="form-grid capability-editor-form capability-editor-form--tertiary">
                      <label>
                        三级指标名称
                        <input
                          :value="leaf.name"
                          type="text"
                          @input="updateLibraryNodeField(leaf.id, 'name', $event.target.value)"
                        />
                      </label>

                      <label>
                        单位
                        <input
                          :value="leaf.unit || ''"
                          type="text"
                          placeholder="例如：%、秒、分钟、米"
                          @input="updateLibraryNodeField(leaf.id, 'unit', $event.target.value)"
                        />
                      </label>

                      <label class="full-span">
                        三级指标说明
                        <textarea
                          rows="3"
                          :value="leaf.description"
                          @input="updateLibraryNodeField(leaf.id, 'description', $event.target.value)"
                        ></textarea>
                      </label>
                    </div>
                  </article>
                </div>
              </section>
            </div>
          </article>

          <article v-if="!visibleCoreEditors.length" class="detail-card compact-empty-state capability-step-guard">
            <strong>当前指标库为空</strong>
          </article>
        </div>
      </section>

      <aside class="capability-framework-side">
        <article class="capability-stage-card capability-utility-panel">
          <div class="capability-utility-panel__head">
            <div>
              <h3>指标库概览</h3>
            </div>
          </div>

          <div class="capability-stage-summary-grid">
            <div class="capability-stage-summary-item">
              <span>一级指标</span>
              <strong>{{ librarySummary.coreCount }}</strong>
            </div>
            <div class="capability-stage-summary-item">
              <span>二级指标</span>
              <strong>{{ librarySummary.secondaryCount }}</strong>
            </div>
            <div class="capability-stage-summary-item">
              <span>三级指标</span>
              <strong>{{ librarySummary.tertiaryCount }}</strong>
            </div>
            <div class="capability-stage-summary-item">
              <span>选中一级</span>
              <strong>{{ activeCore?.name || '--' }}</strong>
            </div>
          </div>
        </article>
      </aside>
    </div>
  </section>
</template>
