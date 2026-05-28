<script setup>
import { computed } from 'vue';
import { useCalculationSharedTask } from '../modules/calculationSharedTask';

const props = defineProps({
  usageHint: {
    type: String,
    default: '',
  },
  taskModule: {
    type: String,
    default: 'capability',
  },
});

const MODULE_LABELS = {
  capability: '能力评估',
  action: '行动计算',
  consumption: '消耗计算',
  planning: '智能任务规划',
};

const {
  missionTask,
  missionTypeOptions,
  missionSummary,
  blueEquipmentFields,
  redEquipmentFields,
  isSharedTaskPanelCollapsed,
  remoteTaskBinding,
  remoteTaskEntries,
  isRemoteTaskListVisible,
  isRemoteTaskListLoading,
  isRemoteTaskSaving,
  remoteTaskErrorMessage,
  remoteTaskFeedbackMessage,
  storageWriteWarning,
  updateTaskField,
  updateEquipmentField,
  toggleSharedTaskPanel,
  toggleRemoteTaskList,
  saveRemoteTask,
  loadRemoteTask,
} = useCalculationSharedTask();

const activeModuleLabel = computed(() => MODULE_LABELS[props.taskModule] || MODULE_LABELS.capability);

const activeRemoteTaskLabel = computed(() => {
  if (!remoteTaskBinding.value?.id) {
    return '当前仍是本地草稿，上下文尚未绑定服务端任务。';
  }

  return `已关联服务端任务 #${remoteTaskBinding.value.id} · ${formatModuleLabel(remoteTaskBinding.value.moduleKey)}`;
});

const activeHint = computed(() => {
  if (props.usageHint) {
    return props.usageHint;
  }

  return `${activeModuleLabel.value}当前直接读取这份共同任务上下文。`;
});

function formatModuleLabel(moduleKey = '') {
  return MODULE_LABELS[moduleKey] || MODULE_LABELS.capability;
}

function formatMissionTypeLabel(missionType = '') {
  return missionTypeOptions.find((item) => item.key === missionType)?.label || '未指定';
}

function formatTimestamp(value = '') {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <article
    class="glass-card calculation-shared-task-panel"
    :class="{ 'calculation-shared-task-panel--collapsed': isSharedTaskPanelCollapsed }"
  >
    <div class="calculation-shared-task-panel__head">
      <div class="calculation-shared-task-panel__copy">
        <span class="eyebrow">全局作战上下文</span>
        <h3>{{ missionTask.name }}</h3>
        <p>{{ activeHint }}</p>
      </div>

      <div class="calculation-shared-task-panel__summary">
        <div class="calculation-shared-task-panel__summary-item">
          <span>作战类型</span>
          <strong>{{ missionSummary.missionTypeLabel }}</strong>
        </div>
        <div class="calculation-shared-task-panel__summary-item">
          <span>我方装备总量</span>
          <strong>{{ missionSummary.blueTotal }}</strong>
        </div>
        <div class="calculation-shared-task-panel__summary-item">
          <span>敌方装备总量</span>
          <strong>{{ missionSummary.redTotal }}</strong>
        </div>
        <div class="calculation-shared-task-panel__summary-item">
          <span>敌情火力强度</span>
          <strong>{{ missionSummary.enemyFireIntensity }}</strong>
        </div>
      </div>
    </div>

    <div class="calculation-shared-task-panel__context">
      <article class="calculation-shared-task-panel__context-card">
        <span>任务目标</span>
        <p>{{ missionTask.objective }}</p>
      </article>

      <article class="calculation-shared-task-panel__context-card">
        <span>任务说明</span>
        <p>{{ missionTask.description }}</p>
      </article>

      <article class="calculation-shared-task-panel__context-card">
        <span>上下文绑定</span>
        <p>{{ activeRemoteTaskLabel }}</p>
      </article>
    </div>

    <div class="calculation-shared-task-panel__toolbar">
      <div class="calculation-shared-task-panel__status">
        <span class="pill" :class="isSharedTaskPanelCollapsed ? 'pill-muted' : 'pill-active'">
          {{ isSharedTaskPanelCollapsed ? '摘要模式' : '编辑模式' }}
        </span>
        <span class="pill pill-muted">当前模块：{{ activeModuleLabel }}</span>
        <p v-if="remoteTaskFeedbackMessage" class="muted-text">{{ remoteTaskFeedbackMessage }}</p>
        <p v-if="storageWriteWarning" class="muted-text">{{ storageWriteWarning }}</p>
        <p v-if="remoteTaskErrorMessage" class="muted-text module-topbar__error">{{ remoteTaskErrorMessage }}</p>
      </div>

      <div class="toolbar-row wrap calculation-shared-task-panel__actions">
        <button
          class="button"
          type="button"
          aria-controls="calculation-shared-task-panel-body"
          :aria-expanded="String(!isSharedTaskPanelCollapsed)"
          @click="toggleSharedTaskPanel"
        >
          {{ isSharedTaskPanelCollapsed ? '展开上下文' : '收起上下文' }}
        </button>
        <button
          v-if="!isSharedTaskPanelCollapsed"
          class="button button-ghost"
          type="button"
          :disabled="isRemoteTaskSaving"
          @click="saveRemoteTask(taskModule)"
        >
          {{ isRemoteTaskSaving ? '正在保存...' : '保存任务' }}
        </button>
        <button
          v-if="!isSharedTaskPanelCollapsed"
          class="button button-ghost"
          type="button"
          :disabled="isRemoteTaskSaving"
          @click="toggleRemoteTaskList"
        >
          {{ isRemoteTaskListVisible ? '收起列表' : '读取任务' }}
        </button>
      </div>
    </div>

    <div
      v-if="!isSharedTaskPanelCollapsed"
      id="calculation-shared-task-panel-body"
      class="calculation-shared-task-panel__body"
    >
      <div class="form-grid capability-stage-form calculation-shared-task-panel__form">
        <label>
          任务名称
          <input
            :value="missionTask.name"
            type="text"
            placeholder="例如：联合火力突击任务"
            @input="updateTaskField('name', $event.target.value)"
          />
        </label>

        <label>
          作战任务类型
          <select :value="missionTask.missionType" @change="updateTaskField('missionType', $event.target.value)">
            <option v-for="item in missionTypeOptions" :key="item.key" :value="item.key">
              {{ item.label }}
            </option>
          </select>
        </label>

        <label class="full-span">
          任务目标
          <textarea
            rows="2"
            :value="missionTask.objective"
            placeholder="例如：压制目标区域防空与火力节点，打开后续行动通道"
            @input="updateTaskField('objective', $event.target.value)"
          ></textarea>
        </label>

        <label class="full-span">
          任务说明
          <textarea
            rows="3"
            :value="missionTask.description"
            placeholder="补充任务背景、约束条件和预期效果"
            @input="updateTaskField('description', $event.target.value)"
          ></textarea>
        </label>
      </div>

      <div v-if="isRemoteTaskListVisible" class="detail-card top-gap">
        <div class="section-heading compact">
          <div>
            <h4>已保存上下文任务</h4>
            <p>仅展示当前账号保存的能力、行动、消耗三类共同任务。</p>
          </div>
          <div class="toolbar-row wrap">
            <button class="button button-ghost" type="button" :disabled="isRemoteTaskListLoading" @click="toggleRemoteTaskList">
              收起列表
            </button>
          </div>
        </div>

        <div v-if="isRemoteTaskListLoading" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">正在读取任务...</p>
        </div>

        <div v-else-if="!remoteTaskEntries.length" class="detail-card compact-empty-state top-gap">
          <p class="muted-text">当前还没有已保存的共同任务。</p>
        </div>

        <div v-else class="action-task-grid top-gap">
          <article v-for="task in remoteTaskEntries" :key="task.id" class="action-template-card">
            <div class="action-template-card__head">
              <div>
                <span class="pill" :class="task.id === remoteTaskBinding?.id ? 'pill-active' : 'pill-muted'">
                  {{ task.id === remoteTaskBinding?.id ? '当前关联' : '可读取' }}
                </span>
                <h4>{{ task.name }}</h4>
              </div>
              <div class="planning-task-actions">
                <button class="button button-ghost" type="button" @click="loadRemoteTask(task.id)">读取</button>
              </div>
            </div>

            <div class="action-template-card__stats">
              <div>
                <span>来源模块</span>
                <strong>{{ formatModuleLabel(task.moduleKey) }}</strong>
              </div>
              <div>
                <span>作战类型</span>
                <strong>{{ formatMissionTypeLabel(task.sharedContext.missionType) }}</strong>
              </div>
              <div>
                <span>更新时间</span>
                <strong>{{ formatTimestamp(task.updatedAt) }}</strong>
              </div>
              <div>
                <span>任务编号</span>
                <strong>#{{ task.id }}</strong>
              </div>
            </div>
          </article>
        </div>
      </div>

      <div class="calculation-shared-task-panel__equipment">
        <section class="calculation-shared-task-panel__equipment-group">
          <div class="section-heading compact">
            <div>
              <h4>我方装备</h4>
            </div>
          </div>

          <div class="calculation-shared-task-panel__equipment-grid">
            <label v-for="field in blueEquipmentFields" :key="field.key">
              {{ `${field.label}（${field.unit}）` }}
              <input
                :value="missionTask.blueEquipment[field.key]"
                type="number"
                min="0"
                step="1"
                @input="updateEquipmentField('blue', field.key, $event.target.value)"
              />
            </label>
          </div>
        </section>

        <section class="calculation-shared-task-panel__equipment-group">
          <div class="section-heading compact">
            <div>
              <h4>敌方装备</h4>
            </div>
          </div>

          <div class="calculation-shared-task-panel__equipment-grid calculation-shared-task-panel__equipment-grid--compact">
            <label v-for="field in redEquipmentFields" :key="field.key">
              {{ `${field.label}（${field.unit}）` }}
              <input
                :value="missionTask.redEquipment[field.key]"
                type="number"
                min="0"
                step="1"
                @input="updateEquipmentField('red', field.key, $event.target.value)"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  </article>
</template>
