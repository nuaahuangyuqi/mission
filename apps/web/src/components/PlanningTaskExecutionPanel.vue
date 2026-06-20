<script setup>
import { computed } from 'vue';
import PlanningThreatMapPanel from './PlanningThreatMapPanel.vue';
import { usePlanningWorkflow } from '../modules/planningWorkflow';

const {
  state,
  selectedTask,
  selectedTaskInstance,
  executionSteps,
  executionSummary,
  finalResult,
  resultOutputPackages,
  resultsGeneratedAt,
  runHistory,
  savedResultSnapshotCount,
  latestSavedResultSnapshot,
  loadTaskRuns,
  replayTaskRun,
  calculatePlanningAssessment,
  saveCurrentResultSnapshot,
  downloadResultPackage,
  formatVariantType,
} = usePlanningWorkflow();

const threatOutput = computed(() => finalResult.value?.consolidatedOutputs?.threatAnalysis || {});
const groupingOutput = computed(() => finalResult.value?.consolidatedOutputs?.forceGrouping || {});
const threatEvidenceTrace = computed(() => threatOutput.value?.evidenceTrace || []);
const groupingEvidenceTrace = computed(() => groupingOutput.value?.evidenceTrace || []);
const allocationOutput = computed(() => finalResult.value?.consolidatedOutputs?.targetAllocation || {});
const landingSiteOutput = computed(() => finalResult.value?.consolidatedOutputs?.airborneLandingSiteSelection || {});
const methodOutput = computed(() => finalResult.value?.consolidatedOutputs?.methodPlanning || {});
const supportOutput = computed(() => finalResult.value?.consolidatedOutputs?.supportPlanning || {});
const outputPackages = computed(() => resultOutputPackages.value || {});
const placeholderSteps = computed(() => executionSteps.value.filter((item) => item.structuredOutput?.implementationStatus !== 'implemented'));
const executionStateLabel = computed(() => {
  if (state.calculating) return '执行中';
  if (state.results) return state.resultsDirty ? '待重新执行' : '已有结果';
  return '未执行';
});
const availablePackageCount = computed(() => ['storageSnapshot', 'reportExport', 'spatialExport', 'comparisonExport']
  .filter((key) => outputPackages.value?.[key]).length);
const executedSectionCount = computed(() => [
  Boolean(threatOutput.value?.threatLevel),
  Boolean(groupingOutput.value?.preferredScheme),
  Boolean(allocationOutput.value?.preferredPlan),
  Boolean(landingSiteOutput.value?.preferredCandidate),
  Boolean(methodOutput.value?.preferredPlan),
  Boolean(supportOutput.value?.preferredPlan),
].filter(Boolean).length);
const latestRunRecord = computed(() => runHistory.value?.[0] || null);
const hasPlanningDesignSections = computed(() => (
  Boolean(groupingOutput.value?.preferredScheme)
  || Boolean(allocationOutput.value?.preferredPlan)
  || Boolean(landingSiteOutput.value?.preferredCandidate)
  || Boolean(methodOutput.value?.preferredPlan)
));
const methodCheckpoints = computed(() => (methodOutput.value?.preferredPlan?.routes || []).flatMap((route) => (
  (route.checkpoints || []).map((checkpoint) => ({
    ...checkpoint,
    routeId: route.id,
    routeName: route.name,
    groupName: route.groupName,
    objectiveName: route.objectiveName,
    wave: route.wave,
  }))
)));
const threatNodeSections = computed(() => ([
  {
    key: 'fireCoverage',
    title: '火力覆盖',
    metricLabel: '威胁值',
    metricField: 'threatValue',
    locationField: 'center',
  },
  {
    key: 'airDefenseSystem',
    title: '防空体系',
    metricLabel: '强度',
    metricField: 'strength',
    locationField: 'location',
  },
  {
    key: 'reconEarlyWarning',
    title: '侦察预警',
    metricLabel: '置信度',
    metricField: 'confidence',
    locationField: 'location',
  },
  {
    key: 'antiAirborneFacilities',
    title: '反机降设施',
    metricLabel: '置信度',
    metricField: 'confidence',
    locationField: 'location',
  },
]));

function formatThreatLocation(point) {
  if (!Array.isArray(point) || point.length < 2) {
    return '--';
  }
  return `${Number(point[0]).toFixed(4)}, ${Number(point[1]).toFixed(4)}`;
}

function resolveThreatDetail(item = {}) {
  return item.notes || item.description || item.role || item.posture || '--';
}

function resolveThreatEvidence(item = {}) {
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  return [...new Set([...evidence, item.source].filter(Boolean))].join(', ') || '--';
}

function formatEvidenceSourceType(type) {
  if (type === 'resource-preview') return '资源预览';
  if (type === 'resource-extraction') return '资源抽取';
  if (type === 'uploaded-file') return '本地上传';
  if (type === 'blue-intelligence') return '蓝方兵力';
  if (type === 'threat-handoff') return '威胁结果';
  if (type === 'word-document') return 'Word';
  if (type === 'pdf-document') return 'PDF';
  if (type === 'excel-sheet') return 'Excel/CSV';
  return type || '--';
}

async function handleCalculate() {
  try {
    await calculatePlanningAssessment();
  } catch {
    // Shared state already stores the message.
  }
}

function formatSnapshotTime(value) {
  return value ? String(value).slice(0, 19).replace('T', ' ') : '--';
}

function formatTextList(values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  return items.length ? items.join('、') : '--';
}

function formatOutputValue(value) {
  if (value === null || typeof value === 'undefined' || value === '') return '--';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return String(value);
}

function formatFirepowerBreakdown(value = {}) {
  const breakdown = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (!Object.keys(breakdown).length) return '';
  return `火力构成：武装装备 ${formatOutputValue(breakdown.weaponEquipmentPower)} / 运输人员 ${formatOutputValue(breakdown.transportPersonnelPower)}`;
}

function firepowerSummary(source = {}) {
  return source.firepowerSummary || formatFirepowerBreakdown(source.firepowerBreakdown || source.groupFirepowerBreakdown);
}

function handleSaveSnapshot() {
  try {
    saveCurrentResultSnapshot();
  } catch (error) {
    state.errorMessage = error.message || '保存规划结果快照失败。';
  }
}

function handleDownloadPackage(packageKey) {
  try {
    downloadResultPackage(packageKey);
  } catch (error) {
    state.errorMessage = error.message || '导出任务规划输出包失败。';
  }
}

function formatRunStatus(status) {
  if (status === 'succeeded') return '成功';
  if (status === 'failed') return '失败';
  if (status === 'running') return '执行中';
  return status || '--';
}

async function handleRefreshRuns() {
  if (!selectedTaskInstance.value) return;
  try {
    await loadTaskRuns(selectedTaskInstance.value.id);
  } catch {
    // shared state already shows error
  }
}

async function handleReplayRun(runId) {
  try {
    await replayTaskRun(runId);
  } catch {
    // shared state already shows error
  }
}
</script>

<template>
  <section class="capability-stage action-stage top-gap planning-execution-shell">
    <article class="capability-stage-card planning-execution-command-deck">
      <div class="planning-execution-command-deck__copy">
        <span class="eyebrow">Execution Command Deck</span>
        <h3>规划执行工作台</h3>
        <p>先给出任务执行态势、推荐成果和导出出口，再按证据强度向下展开各专题算法的细节。</p>

        <div class="planning-task-actions top-gap">
          <button class="button" :disabled="state.calculating || state.loading || !selectedTask" @click="handleCalculate">
            {{ state.calculating ? '执行中...' : state.results ? '重新执行任务模板' : '执行任务模板' }}
          </button>
          <button class="button button-secondary" v-if="state.results" @click="handleSaveSnapshot">
            保存结果快照
          </button>
          <button class="button button-secondary" :disabled="!outputPackages.storageSnapshot" @click="handleDownloadPackage('storageSnapshot')">
            导出结果快照
          </button>
          <button class="button button-secondary" :disabled="!outputPackages.reportExport" @click="handleDownloadPackage('reportExport')">
            导出分析报告
          </button>
          <button class="button button-secondary" :disabled="!outputPackages.spatialExport" @click="handleDownloadPackage('spatialExport')">
            导出空间成果
          </button>
          <button class="button button-secondary" :disabled="!outputPackages.comparisonExport" @click="handleDownloadPackage('comparisonExport')">
            导出对比表
          </button>
        </div>

        <div class="capability-stage-pill-row top-gap">
          <span class="pill pill-active">{{ selectedTask?.name || '未选择任务模板' }}</span>
          <span class="pill pill-muted">任务实例 {{ selectedTaskInstance ? `#${selectedTaskInstance.id}` : '未选择' }}</span>
          <span class="pill pill-muted">状态 {{ executionStateLabel }}</span>
          <span class="pill pill-muted">结果时间 {{ resultsGeneratedAt ? resultsGeneratedAt.slice(0, 19).replace('T', ' ') : '--' }}</span>
        </div>
      </div>

      <div class="planning-execution-command-deck__stats">
        <div class="planning-execution-command-deck__stat">
          <span>完成步骤</span>
          <strong>{{ executionSummary.completedSteps }}</strong>
          <small>已实现 {{ executionSummary.implementedSteps }} 步</small>
        </div>
        <div class="planning-execution-command-deck__stat">
          <span>专题成果</span>
          <strong>{{ executedSectionCount }}</strong>
          <small>已形成的可阅读专题块</small>
        </div>
        <div class="planning-execution-command-deck__stat">
          <span>输出包</span>
          <strong>{{ availablePackageCount }}</strong>
          <small>当前可导出的结构化成果</small>
        </div>
        <div class="planning-execution-command-deck__stat">
          <span>结果快照</span>
          <strong>{{ savedResultSnapshotCount }}</strong>
          <small>最近保存 {{ formatSnapshotTime(latestSavedResultSnapshot?.savedAt) }}</small>
        </div>
      </div>

      <p v-if="state.errorMessage" class="auth-error capability-inline-error top-gap">{{ state.errorMessage }}</p>
    </article>

    <div class="planning-execution-overview-grid">
      <article class="capability-stage-card planning-execution-overview-card planning-execution-overview-card--full">
        <div class="section-heading compact">
          <div>
            <h3>执行记录</h3>
            <p>保留任务实例的归档历史，支持回看历史结果、对比当前输出，并承接原首屏概览区域的阅读空间。</p>
          </div>
          <div class="planning-task-actions">
            <button class="button button-ghost" :disabled="!selectedTaskInstance || state.runHistoryLoading" @click="handleRefreshRuns">
              {{ state.runHistoryLoading ? '刷新中...' : '刷新记录' }}
            </button>
          </div>
        </div>

        <div class="capability-stage-pill-row top-gap">
          <span class="pill pill-muted">最近记录 {{ latestRunRecord ? `#${latestRunRecord.id}` : '--' }}</span>
          <span class="pill pill-muted">最近状态 {{ latestRunRecord ? formatRunStatus(latestRunRecord.status) : '--' }}</span>
        </div>

        <div v-if="!selectedTaskInstance" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">请先在任务模板页选择任务实例。</p>
        </div>

        <div v-else-if="!runHistory.length" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">当前实例暂无执行记录。</p>
        </div>

        <div v-else class="table-shell top-gap">
          <table>
            <thead>
              <tr>
                <th>记录ID</th>
                <th>状态</th>
                <th>时间</th>
                <th>摘要</th>
                <th>结果</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in runHistory" :key="item.id">
                <td>#{{ item.id }}</td>
                <td>{{ formatRunStatus(item.status) }}</td>
                <td>{{ item.createdAt || '--' }}</td>
                <td>{{ item.summary?.assessmentName || item.summary?.message || '--' }}</td>
                <td>{{ item.hasResult ? '可回看' : '--' }}</td>
                <td>
                  <button
                    class="button button-ghost"
                    :disabled="!item.hasResult"
                    @click="handleReplayRun(item.id)"
                  >
                    {{ Number(state.activeResultRunId) === Number(item.id) ? '当前结果' : '回看结果' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>

    <article class="capability-result-shell planning-execution-results-shell">
      <div v-if="!state.results" class="detail-card compact-empty-state">
        <p class="muted-text">尚未执行任务规划。</p>
      </div>

      <template v-else>
        <div class="stats-strip compact-grid four-up">
          <div class="mini-stat">
            <span>完成步骤</span>
            <strong>{{ executionSummary.completedSteps }}</strong>
          </div>
          <div class="mini-stat">
            <span>内置执行</span>
            <strong>{{ executionSummary.builtinSteps }}</strong>
          </div>
          <div class="mini-stat">
            <span>已实现步骤</span>
            <strong>{{ executionSummary.implementedSteps }}</strong>
          </div>
          <div class="mini-stat">
            <span>占位步骤</span>
            <strong>{{ executionSummary.placeholderSteps }}</strong>
          </div>
        </div>

        <div class="planning-execution-package-grid top-gap">
          <article class="detail-card">
            <span class="eyebrow">输出包</span>
            <ul class="action-text-list top-gap">
              <li>
                结果快照 / {{ outputPackages.storageSnapshot?.format || 'json' }} / {{ outputPackages.storageSnapshot?.label || '结构化结果快照' }}
              </li>
              <li>
                分析报告 / {{ outputPackages.reportExport?.format || 'html' }} / {{ outputPackages.reportExport?.fileName || '--' }}
              </li>
              <li>
                空间成果 / {{ outputPackages.spatialExport?.format || 'geojson' }} / {{ outputPackages.spatialExport?.meta?.featureCount || 0 }} 个要素
              </li>
              <li>
                对比表 / {{ outputPackages.comparisonExport?.format || 'csv' }} / {{ outputPackages.comparisonExport?.meta?.rowCount || 0 }} 行
              </li>
            </ul>
          </article>

          <article class="detail-card">
            <span class="eyebrow">执行步骤视图</span>
            <div class="planning-execution-step-strip top-gap">
              <div
                v-for="item in executionSteps"
                :key="item.stepId"
                class="planning-execution-step-chip"
                :class="{ 'planning-execution-step-chip--pending': item.structuredOutput?.implementationStatus !== 'implemented' }"
              >
                <span>步骤 {{ item.order }}</span>
                <strong>{{ item.stepName }}</strong>
                <small>{{ item.binding.name }}</small>
              </div>
            </div>
          </article>
        </div>

        <div v-if="threatOutput.threatLevel" class="planning-execution-divider top-gap">
          <span class="eyebrow">Situation Assessment</span>
          <h4>态势研判层</h4>
          <p>先确认威胁研判是否成立，后续编组、目标分配和路线规划都以此为上游依据。</p>
        </div>

          <article v-if="threatOutput.threatLevel" class="capability-stage-card top-gap">
            <div class="section-heading compact">
              <div>
                <h3>敌情威胁分析</h3>
              </div>
              <span class="pill pill-active">{{ threatOutput.builtinMethodLabel }}</span>
            </div>

            <div class="stats-strip compact-grid four-up top-gap">
              <div class="mini-stat">
                <span>威胁等级</span>
                <strong>{{ threatOutput.threatLevel }}</strong>
              </div>
              <div class="mini-stat">
                <span>威胁得分</span>
                <strong>{{ threatOutput.threatScore }}</strong>
              </div>
              <div class="mini-stat">
                <span>敌方单位</span>
                <strong>{{ threatOutput.enemyUnitCount || 0 }}</strong>
              </div>
              <div class="mini-stat">
                <span>证据条目</span>
                <strong>{{ threatOutput.inputSummary?.evidenceCount || 0 }}</strong>
              </div>
            </div>

            <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">分析输入</span>
              <ul class="action-text-list top-gap">
                <li>资源库文件 {{ threatOutput.inputSummary?.selectedSourceCount || 0 }} 个</li>
                <li>本地上传文件 {{ threatOutput.inputSummary?.uploadedFileCount || 0 }} 个</li>
                <li>证据条目 {{ threatOutput.inputSummary?.evidenceEntryCount || threatOutput.inputSummary?.evidenceCount || 0 }} 条</li>
                <li>关键威胁节点 {{ threatOutput.identifiedThreatNodeCount || 0 }} 个</li>
              </ul>

              <div class="table-shell compact-table top-gap" v-if="(threatOutput.selectedSources || []).length">
                <table>
                  <thead>
                    <tr>
                      <th>资源库文件</th>
                      <th>类型</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in threatOutput.selectedSources || []" :key="item.id">
                      <td>{{ item.name }}</td>
                      <td>{{ item.type || '--' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="table-shell compact-table top-gap" v-if="(threatOutput.importedFiles || []).length">
                <table>
                  <thead>
                    <tr>
                      <th>上传文件</th>
                      <th>格式</th>
                      <th>摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in threatOutput.importedFiles || []" :key="item.id">
                      <td>{{ item.fileName }}</td>
                      <td>{{ item.fileExtension || '--' }}</td>
                      <td>{{ item.summary || '--' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="detail-card">
              <span class="eyebrow">分析配置</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>参数</th>
                      <th>值</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>分析重点</td>
                      <td>{{ threatOutput.appliedOptions?.analysisFocus || 'comprehensive' }}</td>
                    </tr>
                    <tr>
                      <td>热力图密度</td>
                      <td>{{ threatOutput.appliedOptions?.heatmapDensity || 'medium' }}</td>
                    </tr>
                    <tr>
                      <td>影响评估倾向</td>
                      <td>{{ threatOutput.appliedOptions?.impactBias || 'balanced' }}</td>
                    </tr>
                    <tr>
                      <td>部署方向识别</td>
                      <td>{{ threatOutput.deploymentSectors?.length || 0 }} 个</td>
                    </tr>
                    <tr>
                      <td>火力覆盖区</td>
                      <td>{{ threatOutput.fireCoverage?.length || 0 }} 个</td>
                    </tr>
                    <tr>
                      <td>防空 / 侦察 / 反机降</td>
                      <td>
                        {{ threatOutput.airDefenseSystem?.length || 0 }}
                        /
                        {{ threatOutput.reconEarlyWarning?.length || 0 }}
                        /
                        {{ threatOutput.antiAirborneFacilities?.length || 0 }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <div class="action-result-grid top-gap">
            <article
              v-for="section in threatNodeSections"
              :key="section.key"
              class="detail-card"
            >
              <span class="eyebrow">{{ section.title }}</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>范围</th>
                      <th>{{ section.metricLabel }}</th>
                      <th>位置</th>
                      <th>说明</th>
                      <th>来源 / 证据</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in threatOutput[section.key] || []" :key="item.id">
                      <td>{{ item.name }}</td>
                      <td>{{ item.coverageKm ? `${item.coverageKm} km` : '--' }}</td>
                      <td>{{ item[section.metricField] ?? '--' }}</td>
                      <td>{{ formatThreatLocation(item[section.locationField]) }}</td>
                      <td>{{ resolveThreatDetail(item) }}</td>
                      <td>{{ resolveThreatEvidence(item) }}</td>
                    </tr>
                    <tr v-if="!(threatOutput[section.key] || []).length">
                      <td colspan="6">暂无识别结果</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">部署方向</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>方向</th>
                      <th>单位数</th>
                      <th>平均强度</th>
                      <th>态势</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in threatOutput.deploymentSectors || []" :key="item.id">
                      <td>{{ item.name }}</td>
                      <td>{{ item.unitCount }}</td>
                      <td>{{ item.averageStrength }}</td>
                      <td>{{ item.posture }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="detail-card">
              <span class="eyebrow">关键威胁节点</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>类别</th>
                      <th>数量</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>火力覆盖</td>
                      <td>{{ threatOutput.fireCoverage?.length || 0 }}</td>
                      <td>已提取敌方火力覆盖圈与重点压制方向。</td>
                    </tr>
                    <tr>
                      <td>防空体系</td>
                      <td>{{ threatOutput.airDefenseSystem?.length || 0 }}</td>
                      <td>已识别敌方防空节点和覆盖范围。</td>
                    </tr>
                    <tr>
                      <td>侦察预警</td>
                      <td>{{ threatOutput.reconEarlyWarning?.length || 0 }}</td>
                      <td>已识别侦察预警节点与低空监控能力。</td>
                    </tr>
                    <tr>
                      <td>反机降设施</td>
                      <td>{{ threatOutput.antiAirborneFacilities?.length || 0 }}</td>
                      <td>支持直接识别或按环境信息进行推断。</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </article>

        <div v-if="hasPlanningDesignSections" class="planning-execution-divider top-gap">
          <span class="eyebrow">Planning Design</span>
          <h4>方案筹划层</h4>
          <p>在威胁结论成立后，依次阅读编组、目标分配、机降点和作战方法，保证推荐链路完整可追踪。</p>
        </div>

        <article v-if="groupingOutput.preferredScheme" class="capability-stage-card top-gap">
          <div class="section-heading compact">
            <div>
              <h3>作战力量智能编组</h3>
            </div>
            <span class="pill pill-active">{{ groupingOutput.builtinMethodLabel }}</span>
          </div>

          <div class="stats-strip compact-grid four-up top-gap">
            <div class="mini-stat">
              <span>规则库</span>
              <strong>{{ groupingOutput.ruleLibrary?.label || '--' }}</strong>
            </div>
            <div class="mini-stat">
              <span>候选兵力</span>
              <strong>{{ groupingOutput.inputSummary?.blueIntelligenceCount || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>方案数量</span>
              <strong>{{ groupingOutput.schemes?.length || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>推荐评分</span>
              <strong>{{ groupingOutput.preferredScheme?.score || 0 }}</strong>
            </div>
          </div>

          <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">输入概况</span>
              <ul class="action-text-list top-gap">
                <li>资源库文件 {{ groupingOutput.inputSummary?.selectedSourceCount || 0 }} 个</li>
                <li>本地上传文件 {{ groupingOutput.inputSummary?.uploadedFileCount || 0 }} 个</li>
                <li>结构化兵力 {{ groupingOutput.inputSummary?.blueIntelligenceCount || 0 }} 个</li>
                <li>文档推断兵力 {{ groupingOutput.inputSummary?.documentCandidateCount || 0 }} 个</li>
                <li>候选兵力总数 {{ groupingOutput.inputSummary?.candidateCount || 0 }} 个</li>
                <li>期望群组 {{ groupingOutput.appliedOptions?.expectedGroupCount || 0 }} 个，实际输出 {{ groupingOutput.appliedOptions?.actualGroupCount || 0 }} 个</li>
              </ul>
            </article>

            <article class="detail-card">
              <span class="eyebrow">规则画像</span>
              <ul class="action-text-list top-gap">
                <li v-for="item in groupingOutput.resolvedRuleProfile?.weightSummary || []" :key="item.key">
                  {{ item.label }} / {{ item.percent }}%
                </li>
              </ul>
              <ul class="action-text-list top-gap" v-if="(groupingOutput.resolvedRuleProfile?.primarySignals || []).length">
                <li v-for="item in groupingOutput.resolvedRuleProfile?.primarySignals || []" :key="item.key">
                  {{ item.label }} / 强度 {{ item.intensity }} / 证据 {{ item.evidenceCount }} 条
                </li>
              </ul>
            </article>
          </div>

          <div class="action-result-grid top-gap">
            <article class="detail-card" v-if="(groupingOutput.selectedSources || []).length">
              <span class="eyebrow">来源文件</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>类型</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in groupingOutput.selectedSources || []" :key="item.id">
                      <td>{{ item.name }}</td>
                      <td>{{ item.type }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="detail-card" v-if="(groupingOutput.importedFiles || []).length">
              <span class="eyebrow">上传文件</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>文件</th>
                      <th>类型</th>
                      <th>摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in groupingOutput.importedFiles || []" :key="item.id">
                      <td>{{ item.fileName }}</td>
                      <td>{{ item.fileExtension || '--' }}</td>
                      <td>{{ item.summary || '--' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <article class="detail-card top-gap">
            <span class="eyebrow">方案对比</span>
            <div class="table-shell compact-table top-gap">
              <table>
                <thead>
                  <tr>
                    <th>方案</th>
                    <th>评分</th>
                    <th>火力</th>
                    <th>防护</th>
                    <th>侦察</th>
                    <th>保障</th>
                    <th>均衡</th>
                    <th>角色匹配</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in groupingOutput.comparison || []" :key="item.schemeId">
                    <td>{{ item.methodLabel }}</td>
                    <td>{{ item.score }}</td>
                    <td>{{ item.firepower }}</td>
                    <td>{{ item.protection }}</td>
                    <td>{{ item.reconCoverage }}</td>
                    <td>{{ item.endurance }}</td>
                    <td>{{ item.balance }}</td>
                    <td>{{ item.roleFit || '--' }}</td>
                    <td>{{ item.optimizationNote || item.advantage || item.tradeoff || '--' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <div class="action-task-grid top-gap">
            <article
              v-for="group in groupingOutput.preferredScheme?.groups || []"
              :key="group.id"
              class="action-template-card"
            >
              <div class="action-template-card__head">
                <div>
                  <span class="pill pill-active">{{ group.unitCount }} 个单位</span>
                  <h4>{{ group.name }}</h4>
                </div>
                <span class="pill pill-muted">{{ group.role }}</span>
              </div>

              <div class="action-template-card__stats">
                <div>
                  <span>火力</span>
                  <strong>{{ group.firepower }}</strong>
                </div>
                <div>
                  <span>防护</span>
                  <strong>{{ group.protection }}</strong>
                </div>
                <div>
                  <span>侦察</span>
                  <strong>{{ group.reconCoverage }}</strong>
                </div>
                <div>
                  <span>保障</span>
                  <strong>{{ group.endurance }}</strong>
                </div>
              </div>
              <p v-if="firepowerSummary(group)" class="muted-text">{{ firepowerSummary(group) }}</p>

              <div class="chip-row">
                <span v-for="item in group.units || []" :key="item.id" class="pill pill-muted">{{ item.name }}</span>
              </div>
            </article>
          </div>

          <article class="detail-card top-gap">
            <span class="eyebrow">推荐解释</span>
            <ul class="action-text-list top-gap">
              <li v-for="item in groupingOutput.explanation || []" :key="item">{{ item }}</li>
            </ul>
          </article>
        </article>

        <article v-if="allocationOutput.preferredPlan" class="capability-stage-card top-gap">
          <div class="section-heading compact">
            <div>
              <h3>作战目标自动分配</h3>
            </div>
            <div class="chip-row">
              <span class="pill pill-active">{{ allocationOutput.builtinMethodLabel }}</span>
              <span class="pill pill-muted">{{ allocationOutput.validationProfile?.label || '标准校核' }}</span>
            </div>
          </div>

          <div class="stats-strip compact-grid four-up top-gap">
            <div class="mini-stat">
              <span>候选目标</span>
              <strong>{{ allocationOutput.candidateTargets?.length || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>可用平台</span>
              <strong>{{ allocationOutput.platforms?.length || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>涉及编组</span>
              <strong>{{ allocationOutput.groups?.length || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>推荐评分</span>
              <strong>{{ allocationOutput.preferredPlan?.score || 0 }}</strong>
            </div>
          </div>

          <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">算法对比</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>方法</th>
                      <th>评分</th>
                      <th>已覆盖目标</th>
                      <th>完整覆盖</th>
                      <th>平均匹配</th>
                      <th>平均可行性</th>
                      <th>全覆盖率</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in allocationOutput.comparedPlans || []" :key="item.id">
                      <td>{{ item.methodLabel }}</td>
                      <td>{{ item.score }}</td>
                      <td>{{ item.stats?.assignedTargetCount || 0 }}</td>
                      <td>{{ item.stats?.fullyCoveredTargetCount || 0 }}</td>
                      <td>{{ item.stats?.averageMatchScore || 0 }}</td>
                      <td>{{ item.stats?.averageFeasibilityScore || 0 }}</td>
                      <td>{{ item.stats?.fullCoverRate || 0 }}%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="detail-card">
              <span class="eyebrow">合理性验证</span>
              <ul class="action-text-list top-gap">
                <li v-for="item in allocationOutput.validation || []" :key="item.title">
                  {{ item.title }} / {{ item.level }} / {{ item.detail }}
                </li>
              </ul>
            </article>
          </div>

          <article class="detail-card top-gap">
            <span class="eyebrow">推荐目标分配</span>
            <div class="table-shell compact-table top-gap">
              <table>
                <thead>
                  <tr>
                    <th>平台</th>
                    <th>所属编组</th>
                    <th>目标</th>
                    <th>类型</th>
                    <th>优先级</th>
                    <th>火力构成</th>
                    <th>匹配分</th>
                    <th>可行性</th>
                    <th>距离</th>
                    <th>波次</th>
                    <th>打击包</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in allocationOutput.preferredPlan?.assignments || []" :key="item.id">
                    <td>{{ item.platformName }}</td>
                    <td>{{ item.groupName }}</td>
                    <td>{{ item.targetName }}</td>
                    <td>{{ item.targetTypeLabel || item.targetType }}</td>
                    <td>{{ item.priorityLevel }} / {{ item.priority }}</td>
                    <td>{{ firepowerSummary(item) || '--' }}</td>
                    <td>{{ item.matchScore }}</td>
                    <td>{{ item.feasibilityScore }}</td>
                    <td>{{ item.distanceKm }} km</td>
                    <td>{{ item.wave }}</td>
                    <td>{{ item.packageIndex }} / {{ item.requiredPlatformCount }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <article class="detail-card top-gap">
            <span class="eyebrow">目标覆盖摘要</span>
            <div class="table-shell compact-table top-gap">
              <table>
                <thead>
                  <tr>
                    <th>目标</th>
                    <th>类型</th>
                    <th>平台需求</th>
                    <th>已分配</th>
                    <th>涉及编组</th>
                    <th>平均匹配</th>
                    <th>平均可行性</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in allocationOutput.preferredPlan?.coverage || []" :key="item.id">
                    <td>{{ item.name }}</td>
                    <td>{{ item.typeLabel || item.type }}</td>
                    <td>{{ item.requiredPlatformCount }}</td>
                    <td>{{ item.assignedPlatformCount }}</td>
                    <td>{{ item.involvedGroups?.join('、') || '--' }}</td>
                    <td>{{ item.averageMatchScore || 0 }}</td>
                    <td>{{ item.averageFeasibilityScore || 0 }}</td>
                    <td>{{ item.fullyCovered ? '完整覆盖' : '待补充' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <article class="detail-card top-gap">
            <span class="eyebrow">调整建议</span>
            <ul class="action-text-list top-gap">
              <li v-for="item in allocationOutput.adjustmentSuggestions || []" :key="item.id">
                {{ item.text }}
              </li>
            </ul>
          </article>
        </article>

        <article v-if="landingSiteOutput.preferredCandidate" class="capability-stage-card top-gap">
          <div class="section-heading compact">
            <div>
              <h3>机降地域优化选择</h3>
            </div>
            <span class="pill pill-active">{{ landingSiteOutput.builtinMethodLabel }}</span>
          </div>

          <div class="stats-strip compact-grid four-up top-gap">
            <div class="mini-stat">
              <span>直升机型号</span>
              <strong>{{ landingSiteOutput.helicopterProfile?.label || '--' }}</strong>
            </div>
            <div class="mini-stat">
              <span>候选点位</span>
              <strong>{{ landingSiteOutput.rankedCandidates?.length || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>推荐评分</span>
              <strong>{{ landingSiteOutput.preferredCandidate?.score || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>安全性</span>
              <strong>{{ landingSiteOutput.preferredCandidate?.safety || 0 }}</strong>
            </div>
          </div>

          <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">方法对比</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>方法</th>
                      <th>最佳点位</th>
                      <th>评分</th>
                      <th>平均分</th>
                      <th>可用点位</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in landingSiteOutput.methodComparison || []" :key="item.methodKey">
                      <td>{{ item.methodLabel }}</td>
                      <td>{{ item.bestCandidateName }}</td>
                      <td>{{ item.score }}</td>
                      <td>{{ item.averageScore }}</td>
                      <td>{{ item.qualifiedCount }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="detail-card">
              <span class="eyebrow">流程联动分析</span>
              <ul class="action-text-list top-gap">
                <li v-for="item in landingSiteOutput.linkageAnalysis || []" :key="item.id">
                  {{ item.title }} / {{ item.detail }}
                </li>
              </ul>
            </article>
          </div>

          <PlanningThreatMapPanel
            class="top-gap"
            title="机降地域三维展示"
            description=""
            :entities="landingSiteOutput.visualization?.entities || []"
            :environment="landingSiteOutput.visualization?.environment || []"
          />

          <article class="detail-card top-gap">
            <span class="eyebrow">候选机降点排序</span>
            <div class="table-shell compact-table top-gap">
              <table>
                <thead>
                  <tr>
                    <th>排名</th>
                    <th>点位</th>
                    <th>评分</th>
                    <th>隐蔽</th>
                    <th>安全</th>
                    <th>集结效率</th>
                    <th>航程</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in landingSiteOutput.rankedCandidates || []" :key="item.id">
                    <td>{{ item.rank }}</td>
                    <td>{{ item.name }}</td>
                    <td>{{ item.score }}</td>
                    <td>{{ item.concealment }}</td>
                    <td>{{ item.safety }}</td>
                    <td>{{ item.assemblyEfficiency }}</td>
                    <td>{{ item.totalDistanceKm }} km</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </article>

        <article v-if="methodOutput.preferredPlan" class="capability-stage-card top-gap">
          <div class="section-heading compact">
            <div>
              <h3>作战方法自动规划</h3>
            </div>
            <span class="pill pill-active">{{ methodOutput.builtinMethodLabel }}</span>
          </div>

          <div class="stats-strip compact-grid four-up top-gap">
            <div class="mini-stat">
              <span>航路数量</span>
              <strong>{{ methodOutput.preferredPlan?.routes?.length || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>总距离</span>
              <strong>{{ methodOutput.preferredPlan?.metrics?.totalDistanceKm || 0 }} km</strong>
            </div>
            <div class="mini-stat">
              <span>平均场代价</span>
              <strong>{{ methodOutput.preferredPlan?.metrics?.averageFieldCost || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>预计完成</span>
              <strong>{{ methodOutput.preferredPlan?.metrics?.estimatedCompletionMin || 0 }} min</strong>
            </div>
          </div>

          <div class="capability-stage-pill-row top-gap">
            <span class="pill pill-muted">路由任务 {{ methodOutput.planningBasis?.routeTaskCount || methodOutput.preferredPlan?.planningBasis?.routeTaskCount || 0 }}</span>
            <span class="pill pill-muted">关联目标 {{ methodOutput.planningBasis?.objectiveCount || methodOutput.preferredPlan?.planningBasis?.objectiveCount || 0 }}</span>
            <span class="pill pill-muted">威胁节点 {{ methodOutput.planningBasis?.threatNodeCount || methodOutput.preferredPlan?.planningBasis?.threatNodeCount || 0 }}</span>
            <span class="pill pill-muted">检查点 {{ methodOutput.preferredPlan?.metrics?.checkpointCount || 0 }}</span>
          </div>

          <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">路径方法对比</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>方法</th>
                      <th>评分</th>
                      <th>航路数</th>
                      <th>总航程</th>
                      <th>平均威胁</th>
                      <th>平均场代价</th>
                      <th>预计完成</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in methodOutput.comparedPlans || []" :key="item.methodKey">
                      <td>{{ item.methodLabel }}</td>
                      <td>{{ item.score }}</td>
                      <td>{{ item.routeCount }}</td>
                      <td>{{ item.totalDistanceKm }} km</td>
                      <td>{{ item.averageThreatScore }}</td>
                      <td>{{ item.averageFieldCost }}</td>
                      <td>{{ item.estimatedCompletionMin }} min</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="detail-card">
              <span class="eyebrow">关键行动</span>
              <ul class="action-text-list top-gap">
                <li v-for="item in methodOutput.preferredPlan?.keyActions || []" :key="item.id">
                  {{ item.title }} / {{ item.window }} / {{ item.detail }}
                </li>
              </ul>
            </article>
          </div>

          <PlanningThreatMapPanel
            class="top-gap"
            title="作战路线三维展示"
            description=""
            :entities="methodOutput.preferredPlan?.visualization?.entities || []"
            :environment="methodOutput.preferredPlan?.visualization?.environment || []"
          />

          <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">推荐航路</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>波次</th>
                      <th>群组</th>
                      <th>平台</th>
                      <th>航路类型</th>
                      <th>目标</th>
                      <th>距离</th>
                      <th>场代价</th>
                      <th>检查点</th>
                      <th>时间窗</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in methodOutput.preferredPlan?.routes || []" :key="item.id">
                      <td>{{ item.wave }}</td>
                      <td>{{ item.groupName }}</td>
                      <td>{{ formatTextList(item.platformNames) }}</td>
                      <td>{{ item.routeType }}</td>
                      <td>{{ item.objectiveName }}</td>
                      <td>{{ item.metrics?.distanceKm }} km</td>
                      <td>{{ item.metrics?.averageFieldCost }}</td>
                      <td>{{ item.checkpoints?.length || 0 }}</td>
                      <td>{{ item.startOffsetMin }} - {{ item.endOffsetMin }} min</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="table-shell compact-table top-gap" v-if="threatEvidenceTrace.length">
                <table>
                  <thead>
                    <tr>
                      <th>来源名称</th>
                      <th>来源类型</th>
                      <th>文件名</th>
                      <th>抽取时间</th>
                      <th>摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in threatEvidenceTrace" :key="item.id">
                      <td>{{ item.sourceName || '--' }}</td>
                      <td>{{ formatEvidenceSourceType(item.sourceType) }}</td>
                      <td>{{ item.fileName || '--' }}</td>
                      <td>{{ item.extractedAt || '--' }}</td>
                      <td>{{ item.summary || item.title || '--' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="detail-card">
              <span class="eyebrow">航路检查点</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>航路</th>
                      <th>波次</th>
                      <th>检查点</th>
                      <th>时间</th>
                      <th>坐标</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in methodCheckpoints" :key="item.id">
                      <td>{{ item.groupName }}</td>
                      <td>{{ item.wave }}</td>
                      <td>{{ item.name }}</td>
                      <td>{{ item.timeOffsetMin }} min</td>
                      <td>{{ formatThreatLocation(item.coordinates) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <article class="detail-card top-gap" v-if="groupingEvidenceTrace.length">
            <span class="eyebrow">证据溯源</span>
            <div class="table-shell compact-table top-gap">
              <table>
                <thead>
                  <tr>
                    <th>来源名称</th>
                    <th>来源类型</th>
                    <th>文件名</th>
                    <th>抽取时间</th>
                    <th>摘要</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in groupingEvidenceTrace" :key="item.id">
                    <td>{{ item.sourceName || '--' }}</td>
                    <td>{{ formatEvidenceSourceType(item.sourceType) }}</td>
                    <td>{{ item.fileName || '--' }}</td>
                    <td>{{ item.extractedAt || '--' }}</td>
                    <td>{{ item.summary || item.title || '--' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <article class="detail-card top-gap">
            <span class="eyebrow">阶段时序</span>
            <div class="table-shell compact-table top-gap">
              <table>
                <thead>
                  <tr>
                    <th>阶段</th>
                    <th>起始</th>
                    <th>结束</th>
                    <th>目标</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in methodOutput.preferredPlan?.phases || []" :key="item.id">
                    <td>{{ item.name }}</td>
                    <td>{{ item.startOffsetMin }} min</td>
                    <td>{{ item.endOffsetMin }} min</td>
                    <td>{{ item.goal }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <article class="detail-card top-gap">
            <span class="eyebrow">方案说明</span>
            <ul class="action-text-list top-gap">
              <li v-for="item in methodOutput.explanation || []" :key="item">{{ item }}</li>
            </ul>
          </article>
        </article>

        <div v-if="supportOutput.preferredPlan" class="planning-execution-divider top-gap">
          <span class="eyebrow">Support Layer</span>
          <h4>保障收束层</h4>
          <p>保障规划单独成层阅读，避免被前面的路径与编组细节淹没。</p>
        </div>

        <article v-if="supportOutput.preferredPlan" class="capability-stage-card top-gap">
          <div class="section-heading compact">
            <div>
              <h3>作战保障自动规划</h3>
            </div>
            <span class="pill pill-active">{{ supportOutput.builtinMethodLabel }}</span>
          </div>

          <div class="stats-strip compact-grid four-up top-gap">
            <div class="mini-stat">
              <span>保障覆盖率</span>
              <strong>{{ supportOutput.preferredPlan?.metrics?.coverageRate || 0 }}%</strong>
            </div>
            <div class="mini-stat">
              <span>保障缺口</span>
              <strong>{{ supportOutput.preferredPlan?.metrics?.gapCount || 0 }}</strong>
            </div>
            <div class="mini-stat">
              <span>预备比例</span>
              <strong>{{ supportOutput.preferredPlan?.metrics?.reserveRatio || 0 }}%</strong>
            </div>
            <div class="mini-stat">
              <span>战损率</span>
              <strong>{{ supportOutput.preferredPlan?.damageForecast?.equipmentLossRate || 0 }}%</strong>
            </div>
          </div>

          <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">保障方法对比</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>方法</th>
                      <th>评分</th>
                      <th>覆盖率</th>
                      <th>缺口</th>
                      <th>关键缺口</th>
                      <th>预备比例</th>
                      <th>瓶颈</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in supportOutput.comparedPlans || []" :key="item.methodKey">
                      <td>{{ item.methodLabel }}</td>
                      <td>{{ item.score }}</td>
                      <td>{{ item.coverageRate }}%</td>
                      <td>{{ item.gapCount }}</td>
                      <td>{{ item.criticalGapCount }}</td>
                      <td>{{ item.reserveRatio }}%</td>
                      <td>{{ item.bottleneckCount || 0 }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="detail-card">
              <span class="eyebrow">匹配分析</span>
              <ul class="action-text-list top-gap">
                <li v-for="item in supportOutput.preferredPlan?.matchingAnalysis || []" :key="item.title">
                  {{ item.title }} / {{ item.level }} / {{ item.detail }}
                </li>
              </ul>
            </article>
          </div>

          <PlanningThreatMapPanel
            class="top-gap"
            title="保障节点三维展示"
            description=""
            :entities="supportOutput.preferredPlan?.visualization?.entities || []"
            :environment="supportOutput.preferredPlan?.visualization?.environment || []"
          />

          <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">战损预测输入</span>
              <ul class="action-text-list top-gap">
                <li>装备损失率：{{ supportOutput.preferredPlan?.damageForecast?.equipmentLossRate || 0 }}%</li>
                <li>人员伤亡率：{{ supportOutput.preferredPlan?.damageForecast?.casualtyRate || 0 }}%</li>
                <li>受损装备数：{{ supportOutput.preferredPlan?.damageForecast?.damagedEquipmentCount || 0 }}</li>
                <li>伤员数：{{ supportOutput.preferredPlan?.damageForecast?.woundedCount || 0 }}</li>
                <li>关键窗口数：{{ supportOutput.preferredPlan?.damageForecast?.criticalWindowCount || 0 }}</li>
              </ul>
            </article>

            <article class="detail-card">
              <span class="eyebrow">资源池状态</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>要素</th>
                      <th>库存</th>
                      <th>可调度</th>
                      <th>已投入</th>
                      <th>剩余</th>
                      <th>主约束</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in supportOutput.preferredPlan?.resourcePool?.stockStatus || []" :key="item.key">
                      <td>{{ item.name }}</td>
                      <td>{{ item.configured }} {{ item.unit }}</td>
                      <td>{{ item.dispatchable }} {{ item.unit }}</td>
                      <td>{{ item.committed }} {{ item.unit }}</td>
                      <td>{{ item.remaining }} {{ item.unit }}</td>
                      <td>{{ item.activeConstraint }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <article class="detail-card top-gap">
            <span class="eyebrow">保障需求清单</span>
            <div class="table-shell compact-table top-gap">
              <table>
                <thead>
                  <tr>
                    <th>要素</th>
                    <th>需求</th>
                    <th>供给</th>
                    <th>缺口</th>
                    <th>覆盖率</th>
                    <th>优先级</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in supportOutput.preferredPlan?.requirements || []" :key="item.key">
                    <td>{{ item.name }}</td>
                    <td>{{ item.demand }} {{ item.unit }}</td>
                    <td>{{ item.supplied }} {{ item.unit }}</td>
                    <td>{{ item.gap }} {{ item.unit }}</td>
                    <td>{{ item.coverageRate }}%</td>
                    <td>{{ item.priority }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <div class="action-result-grid top-gap">
            <article class="detail-card">
              <span class="eyebrow">资源调度</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>保障要素</th>
                      <th>节点</th>
                      <th>对象</th>
                      <th>数量</th>
                      <th>覆盖率</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in supportOutput.preferredPlan?.allocations || []" :key="item.id">
                      <td>{{ item.serviceType }}</td>
                      <td>{{ item.nodeName }}</td>
                      <td>{{ item.assignedTo }}</td>
                      <td>{{ item.quantity }} {{ item.unit }}</td>
                      <td>{{ item.coverageRate }}%</td>
                      <td>{{ item.notes }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article class="detail-card">
              <span class="eyebrow">空域窗口</span>
              <div class="table-shell compact-table top-gap">
                <table>
                  <thead>
                    <tr>
                      <th>窗口</th>
                      <th>起始</th>
                      <th>结束</th>
                      <th>作用</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in supportOutput.preferredPlan?.airspaceWindows || []" :key="item.id">
                      <td>{{ item.name }}</td>
                      <td>{{ item.startOffsetMin }} min</td>
                      <td>{{ item.endOffsetMin }} min</td>
                      <td>{{ item.role }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <article class="detail-card top-gap">
            <span class="eyebrow">保障建议</span>
            <ul class="action-text-list top-gap">
              <li v-for="item in supportOutput.preferredPlan?.recommendations || []" :key="item.id">
                {{ item.text }}
              </li>
            </ul>
          </article>
        </article>

        <div class="planning-execution-divider top-gap">
          <span class="eyebrow">Audit Trail</span>
          <h4>执行审计层</h4>
          <p>最后查看步骤轨迹和待补充步骤，用于判断这次执行的可交付程度与后续补强点。</p>
        </div>

        <article class="capability-stage-card top-gap">
          <div class="section-heading compact">
            <div>
              <h3>步骤执行轨迹</h3>
            </div>
          </div>

          <div class="table-shell top-gap">
            <table>
              <thead>
                <tr>
                  <th>顺序</th>
                  <th>步骤</th>
                  <th>算法</th>
                  <th>实现</th>
                  <th>类型</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in executionSteps" :key="item.stepId">
                  <td>{{ item.order }}</td>
                  <td>{{ item.stepName }}</td>
                  <td>{{ item.algorithm.name }}</td>
                  <td>{{ item.binding.name }}</td>
                  <td>{{ formatVariantType(item.binding.type) }}</td>
                  <td>{{ item.structuredOutput?.implementationStatus === 'implemented' ? '已实现' : '规划中' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article v-if="placeholderSteps.length" class="capability-stage-card top-gap">
          <div class="section-heading compact">
            <div>
              <h3>待补充步骤</h3>
            </div>
          </div>

          <div class="action-task-grid top-gap">
            <article
              v-for="item in placeholderSteps"
              :key="item.stepId"
              class="action-template-card"
            >
              <div class="action-template-card__head">
                <div>
                  <span class="pill pill-active">步骤 {{ item.order }}</span>
                  <h4>{{ item.stepName }}</h4>
                </div>
                <span class="pill pill-muted">{{ item.binding.name }}</span>
              </div>
              <p>{{ item.summary }}</p>
              <div class="detail-card">
                <span class="eyebrow">阶段输出预览</span>
                <ul class="action-text-list top-gap">
                  <li v-for="preview in item.outputPreview" :key="preview">{{ preview }}</li>
                </ul>
              </div>
            </article>
          </div>
        </article>
      </template>
    </article>
  </section>
</template>




