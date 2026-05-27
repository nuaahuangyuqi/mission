<script setup>
import { useActionWorkflow } from '../../modules/actionWorkflow';

const {
  state,
  selectedTask,
  activeScheme,
  orderedNodes,
  resourceFields,
  environmentMeta,
  activeSchemeSummary,
  setSelectedScheme,
  updateSchemeField,
  updateEnvironmentFactor,
  updateAvailableResource,
  updateNodeAdjustment,
  resetCurrentTask,
  formatScore,
} = useActionWorkflow();

function isActiveScheme(schemeId) {
  return state.selectedSchemeId === schemeId;
}
</script>

<template>
  <section class="capability-stage action-stage">
    <div class="capability-stage-grid capability-stage-grid--dual">
      <article class="capability-stage-card capability-stage-card--hero">
        <span class="eyebrow">Step 02 / 量化建模</span>
        <h3>当前方案建模</h3>

        <div class="capability-stage-summary-grid">
          <div class="capability-stage-summary-item">
            <span>当前方案</span>
            <strong>{{ activeScheme?.name || '--' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>预计时间</span>
            <strong>{{ formatScore(activeSchemeSummary.totalTime, 1) }} 分钟</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>预计路径</span>
            <strong>{{ formatScore(activeSchemeSummary.totalPath, 1) }} 公里</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>可用平台</span>
            <strong>{{ formatScore(activeSchemeSummary.platforms, 0) }}</strong>
          </div>
        </div>

        <div class="capability-stage-pill-row">
          <span class="pill pill-active">{{ selectedTask?.name || '--' }}</span>
          <span class="pill pill-muted">节点数 {{ orderedNodes.length }}</span>
          <button class="button button-ghost" @click="resetCurrentTask">恢复任务默认参数</button>
        </div>
      </article>

      <article class="capability-stage-card capability-stage-card--summary">
        <span class="eyebrow">方案切换</span>
        <h3>多方案建模</h3>

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

    <div v-if="activeScheme" class="action-model-grid">
      <article class="capability-stage-card">
        <div class="section-heading compact">
          <div>
            <h3>方案基础信息</h3>
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

          <label class="full-span">
            方案说明
            <textarea
              rows="3"
              :value="activeScheme.description"
              @input="updateSchemeField(activeScheme.id, 'description', $event.target.value)"
            ></textarea>
          </label>
        </div>

        <div class="action-factor-grid">
          <article v-for="item in environmentMeta" :key="item.key" class="detail-card">
            <span class="eyebrow">{{ item.label }}</span>
            <strong>{{ formatScore(activeScheme.environment[item.key], 2) }}</strong>
            <input
              :value="activeScheme.environment[item.key]"
              type="number"
              min="0.5"
              max="2"
              step="0.01"
              @input="updateEnvironmentFactor(activeScheme.id, item.key, $event.target.value)"
            />
          </article>
        </div>
      </article>

      <article class="capability-stage-card">
        <div class="section-heading compact">
          <div>
            <h3>可用资源配置</h3>
          </div>
        </div>

        <div class="action-resource-grid">
          <label v-for="item in resourceFields" :key="item.key">
            {{ item.label }}{{ item.unit ? `（${item.unit}）` : '' }}
            <input
              :value="activeScheme.availableResources[item.key] ?? 0"
              type="number"
              min="0"
              step="1"
              @input="updateAvailableResource(activeScheme.id, item.key, $event.target.value)"
            />
          </label>
        </div>
      </article>
    </div>

    <article v-if="activeScheme" class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>节点调整参数</h3>
        </div>
      </div>

      <div class="table-shell">
        <table class="action-adjustment-table">
          <thead>
            <tr>
              <th>节点</th>
              <th>基础时间</th>
              <th>基础路径</th>
              <th>节奏系数</th>
              <th>资源系数</th>
              <th>路径系数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="node in orderedNodes" :key="node.id">
              <td>
                <strong>{{ node.name }}</strong>
                <div class="muted-text">{{ node.code }}</div>
              </td>
              <td>{{ formatScore(node.model?.baseDuration, 1) }} 分钟</td>
              <td>{{ formatScore(node.model?.baseDistance, 1) }} 公里</td>
              <td>
                <input
                  :value="activeScheme.nodeAdjustments[node.id]?.tempo ?? 1"
                  type="number"
                  min="0.5"
                  max="1.8"
                  step="0.01"
                  @input="updateNodeAdjustment(activeScheme.id, node.id, 'tempo', $event.target.value)"
                />
              </td>
              <td>
                <input
                  :value="activeScheme.nodeAdjustments[node.id]?.resource ?? 1"
                  type="number"
                  min="0.5"
                  max="1.8"
                  step="0.01"
                  @input="updateNodeAdjustment(activeScheme.id, node.id, 'resource', $event.target.value)"
                />
              </td>
              <td>
                <input
                  :value="activeScheme.nodeAdjustments[node.id]?.path ?? 1"
                  type="number"
                  min="0.5"
                  max="1.8"
                  step="0.01"
                  @input="updateNodeAdjustment(activeScheme.id, node.id, 'path', $event.target.value)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>
