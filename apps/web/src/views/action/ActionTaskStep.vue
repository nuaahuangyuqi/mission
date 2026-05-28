<script setup>
import { useActionWorkflow } from '../../modules/actionWorkflow';

const {
  state,
  missionTask,
  missionTypeMeta,
  objectiveOptions,
  engineOptions,
  selectedTask,
  selectedObjectiveMeta,
  selectedEngineMeta,
  orderedNodes,
  workflowSummary,
  setAssessmentName,
  setSelectedObjective,
  setSelectedEngine,
} = useActionWorkflow();

function countResourceKinds(node) {
  return Object.keys(node.resourceRequirements || {}).length;
}
</script>

<template>
  <section class="capability-stage action-stage">
    <div class="capability-stage-grid capability-stage-grid--dual">
      <article class="capability-stage-card capability-stage-card--hero">
        <span class="eyebrow">Step 01 / 任务与功能链</span>
        <h3>行动任务设置</h3>

        <div class="form-grid capability-stage-form">
          <label>
            评估任务名称
            <input
              :value="state.assessmentName"
              type="text"
              placeholder="例如：联合火力突击行动评估"
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

          <label class="full-span">
            优化目标
            <select :value="state.selectedObjective" @change="setSelectedObjective($event.target.value)">
              <option v-for="objective in objectiveOptions" :key="objective.key" :value="objective.key">
                {{ objective.label }}
              </option>
            </select>
          </label>
        </div>

        <div class="capability-stage-pill-row">
          <span class="pill pill-active">{{ missionTypeMeta?.label || '未设置作战类型' }}</span>
          <span class="pill pill-muted">初始输入 {{ workflowSummary.initialInputCount }}</span>
          <span class="pill pill-muted">功能节点 {{ workflowSummary.nodeCount }}</span>
        </div>
      </article>

      <article class="capability-stage-card capability-stage-card--summary">
        <span class="eyebrow">任务概览</span>
        <h3>{{ selectedTask?.name || '--' }}</h3>

        <div class="capability-stage-summary-grid">
          <div class="capability-stage-summary-item">
            <span>功能节点</span>
            <strong>{{ workflowSummary.nodeCount }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>链路数量</span>
            <strong>{{ workflowSummary.linkCount }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>方案数量</span>
            <strong>{{ workflowSummary.schemeCount }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>资源类别</span>
            <strong>{{ workflowSummary.resourceCount }}</strong>
          </div>
        </div>

        <div class="action-inline-summary">
          <div class="detail-card">
            <span class="eyebrow">优化目标</span>
            <strong>{{ selectedObjectiveMeta?.label || '--' }}</strong>
          </div>
          <div class="detail-card">
            <span class="eyebrow">计算引擎</span>
            <strong>{{ selectedEngineMeta?.label || '--' }}</strong>
          </div>
        </div>
      </article>
    </div>

    <article class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>共同任务基线</h3>
        </div>
      </div>

      <div class="capability-stage-summary-grid">
        <div class="capability-stage-summary-item">
          <span>共同任务</span>
          <strong>{{ missionTask.name || '--' }}</strong>
        </div>
        <div class="capability-stage-summary-item">
          <span>作战类型</span>
          <strong>{{ missionTypeMeta?.label || '--' }}</strong>
        </div>
        <div class="capability-stage-summary-item full-span">
          <span>任务目标</span>
          <strong>{{ missionTask.objective || '--' }}</strong>
        </div>
      </div>

      <div class="chip-row">
        <span v-for="input in selectedTask?.initialInputs || []" :key="input" class="pill pill-muted">{{ input }}</span>
      </div>
    </article>

    <article class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>功能链预览</h3>
        </div>
      </div>

      <div class="action-chain-card">
        <div class="action-chain-card__root">
          <span class="eyebrow">Task Root</span>
          <strong>{{ selectedTask?.name || '未生成功能链' }}</strong>
          <small>{{ missionTypeMeta?.label || '--' }}</small>
        </div>

        <div class="action-chain-card__nodes">
          <article
            v-for="node in orderedNodes"
            :key="node.id"
            class="action-chain-card__node"
          >
            <div class="action-chain-card__node-head">
              <div>
                <span class="eyebrow">{{ node.code }}</span>
                <h4>{{ node.name }}</h4>
              </div>
              <span class="pill pill-muted">{{ countResourceKinds(node) }} 类资源</span>
            </div>

            <div class="action-chain-card__node-grid">
              <div>
                <span>输入</span>
                <strong>{{ node.inputs?.join('、') || '--' }}</strong>
              </div>
              <div>
                <span>输出</span>
                <strong>{{ node.outputs?.join('、') || '--' }}</strong>
              </div>
              <div>
                <span>约束</span>
                <strong>{{ node.constraints?.length || 0 }} 项</strong>
              </div>
              <div>
                <span>基础模型</span>
                <strong>{{ node.model?.baseDuration || 0 }} 分钟 / {{ node.model?.baseDistance || 0 }} 公里</strong>
              </div>
            </div>
          </article>
        </div>
      </div>
    </article>
  </section>
</template>
