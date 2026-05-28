<script setup>
import { useActionWorkflow } from '../../modules/actionWorkflow';

const {
  selectedTask,
  activeScheme,
  orderedNodes,
  taskTopology,
  validationPreview,
  formatResourceLabel,
  formatScore,
} = useActionWorkflow();

function resourceEntries(node) {
  return Object.entries(node.resourceRequirements || {});
}
</script>

<template>
  <section class="capability-stage action-stage">
    <div class="capability-stage-grid capability-stage-grid--dual">
      <article class="capability-stage-card capability-stage-card--hero">
        <span class="eyebrow">Step 02 / 逻辑校验</span>
        <h3>功能链逻辑关系校验</h3>
        <p class="muted-text">{{ selectedTask?.description || '当前未选择任务。' }}</p>

        <div class="capability-stage-summary-grid">
          <div class="capability-stage-summary-item">
            <span>校验状态</span>
            <strong>{{ validationPreview.passed ? '通过' : '存在问题' }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>问题数量</span>
            <strong>{{ validationPreview.issueCount }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>告警数量</span>
            <strong>{{ validationPreview.warningCount }}</strong>
          </div>
          <div class="capability-stage-summary-item">
            <span>当前方案</span>
            <strong>{{ activeScheme?.name || '--' }}</strong>
          </div>
        </div>
      </article>

      <article class="capability-stage-card capability-stage-card--summary">
        <span class="eyebrow">链路状态</span>
        <h3>拓扑与资源检查</h3>

        <div class="action-check-card" :class="{ pass: taskTopology.issues.length === 0, warn: taskTopology.issues.length > 0 }">
          <strong>{{ taskTopology.issues.length === 0 ? '链路顺序完整' : '链路存在异常' }}</strong>
          <p>{{ taskTopology.issues.length === 0 ? '所有节点可按拓扑顺序执行。' : taskTopology.issues[0] }}</p>
        </div>

        <div class="action-check-card" :class="{ pass: validationPreview.resourceChecks.every((item) => item.sufficient), warn: validationPreview.resourceChecks.some((item) => !item.sufficient) }">
          <strong>{{ validationPreview.resourceChecks.every((item) => item.sufficient) ? '资源满足结构需求' : '资源存在缺口' }}</strong>
          <p>
            当前方案 <strong>{{ activeScheme?.name || '--' }}</strong>
            共校验 {{ validationPreview.resourceChecks.length }} 类资源。
          </p>
        </div>

        <div class="action-validation-issues">
          <article class="detail-card">
            <span class="eyebrow">问题列表</span>
            <ul v-if="validationPreview.issues.length" class="action-text-list">
              <li v-for="item in validationPreview.issues" :key="item">{{ item }}</li>
            </ul>
            <p v-else class="muted-text">当前未发现结构性问题。</p>
          </article>

          <article class="detail-card">
            <span class="eyebrow">告警列表</span>
            <ul v-if="validationPreview.warnings.length" class="action-text-list">
              <li v-for="item in validationPreview.warnings" :key="item">{{ item }}</li>
            </ul>
            <p v-else class="muted-text">当前未发现告警项。</p>
          </article>
        </div>
      </article>
    </div>

    <article class="capability-stage-card">
      <div class="section-heading compact">
        <div>
          <h3>功能链节点明细</h3>
          <p>父节点位于顶部，按时间顺序向下展开每个功能节点，核对输入、输出、约束与资源需求。</p>
        </div>
      </div>

      <div class="action-validation-chain">
        <div class="action-validation-chain__root">
          <span class="eyebrow">Mission</span>
          <strong>{{ selectedTask?.name || '--' }}</strong>
          <small>{{ selectedTask?.category || '--' }}</small>
        </div>

        <article
          v-for="node in orderedNodes"
          :key="node.id"
          class="action-node-card"
        >
          <div class="action-node-card__head">
            <div>
              <span class="eyebrow">{{ node.code }}</span>
              <h4>{{ node.name }}</h4>
            </div>
            <span class="pill" :class="validationPreview.nodeChecks.find((item) => item.nodeId === node.id)?.passed ? 'pill-active' : 'pill-warn'">
              {{ validationPreview.nodeChecks.find((item) => item.nodeId === node.id)?.passed ? '节点通过' : '节点异常' }}
            </span>
          </div>

          <div class="action-node-card__grid">
            <article class="detail-card">
              <span class="eyebrow">输入</span>
              <ul class="action-text-list">
                <li v-for="item in node.inputs" :key="item">{{ item }}</li>
              </ul>
            </article>

            <article class="detail-card">
              <span class="eyebrow">输出</span>
              <ul class="action-text-list">
                <li v-for="item in node.outputs" :key="item">{{ item }}</li>
              </ul>
            </article>

            <article class="detail-card">
              <span class="eyebrow">约束条件</span>
              <ul class="action-text-list">
                <li v-for="item in node.constraints" :key="item">{{ item }}</li>
              </ul>
            </article>

            <article class="detail-card">
              <span class="eyebrow">资源需求</span>
              <ul class="action-text-list">
                <li v-for="[key, value] in resourceEntries(node)" :key="key">
                  {{ formatResourceLabel(key) }}：{{ formatScore(value, 1) }}
                </li>
              </ul>
            </article>
          </div>
        </article>
      </div>
    </article>

    <div class="action-validation-grid">
      <article class="capability-stage-card">
        <div class="section-heading compact">
          <div>
            <h3>节点检查结果</h3>
            <p>校验节点输入输出完整性，以及是否缺失上游产出。</p>
          </div>
        </div>

        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>节点</th>
                <th>输入</th>
                <th>输出</th>
                <th>约束</th>
                <th>资源类</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in validationPreview.nodeChecks" :key="item.nodeId">
                <td>{{ item.nodeName }}</td>
                <td>{{ item.inputCount }}</td>
                <td>{{ item.outputCount }}</td>
                <td>{{ item.constraintCount }}</td>
                <td>{{ item.resourceKinds }}</td>
                <td>{{ item.passed ? '通过' : `缺失：${item.missingInputs.join('、')}` }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="capability-stage-card">
        <div class="section-heading compact">
          <div>
            <h3>资源满足性检查</h3>
            <p>按当前方案可用资源，校验功能链结构需求是否满足。</p>
          </div>
        </div>

        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>资源</th>
                <th>需求量</th>
                <th>可用量</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in validationPreview.resourceChecks" :key="item.key">
                <td>{{ item.label }}</td>
                <td>{{ formatScore(item.required, 1) }}{{ item.unit ? ` ${item.unit}` : '' }}</td>
                <td>{{ formatScore(item.available, 1) }}{{ item.unit ? ` ${item.unit}` : '' }}</td>
                <td>{{ item.sufficient ? '满足' : '不足' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </section>
</template>
