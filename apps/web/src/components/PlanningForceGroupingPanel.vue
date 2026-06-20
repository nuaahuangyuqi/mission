<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  output: {
    type: Object,
    default: () => ({}),
  },
});

const CATEGORY_LABELS = {
  attack_helicopter: '攻击直升机',
  recon_helicopter: '侦察直升机',
  transport_helicopter: '运输直升机',
  fire: '火力',
  strike: '突击',
  armed: '武装直升机',
  escort: '护航',
  recon: '侦察',
  'air-defense': '防空',
  air_defense: '防空',
  support: '保障',
  mobility: '机动',
  transport: '运输',
  command: '指挥通信',
  engineering: '工程保障',
  medical: '医疗',
  unknown: '未分类',
};

const ROLE_LABELS = {
  main_strike: '主攻',
  armed: '武装火力',
  escort: '护航火力',
  transport: '运输投送',
  support_fire: '火力支援',
  recon: '侦察引导',
  strike: '火力打击',
  cover: '掩护',
  air_defense: '防空',
  mobility: '机动投送',
  support: '综合保障',
  sustain: '持续保障',
  command: '指挥通信',
  reserve: '预备力量',
};

const TARGET_CLASS_LABELS = {
  sensor_radar: '雷达/传感器',
  communication_node: '通信/电子节点',
  command_post: '指挥节点',
  air_defense_missile: '防空导弹',
  air_defense_gun: '近程防空',
  armor_unit: '装甲目标',
  artillery_rocket: '炮兵/火箭炮',
  fortified_position: '加固阵地',
  infantry_assembly: '人员集结',
  logistics_support: '后勤保障',
  area_target: '区域目标',
  generic_fire_unit: '普通火力点',
};

const READINESS_LABELS = {
  available: '可用',
  online: '在线',
  partial: '部分可用',
  damaged: '受损',
  unavailable: '不可用',
  unknown: '未知',
};

const CAPABILITY_LABELS = {
  firepower: '火力',
  protection: '防护',
  recon: '侦察',
  reconCoverage: '侦察',
  support: '保障',
  endurance: '保障',
  mobility: '机动',
  communication: '通信',
  survivability: '生存',
  balance: '均衡',
};

const CONSTRAINT_STATUS_LABELS = {
  pass: '约束通过',
  warn: '存在待复核项',
  fail: '存在未满足约束',
};

const selectedSchemeId = ref('');

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeSchemeId(scheme = {}, index = 0) {
  return String(scheme.id || scheme.schemeId || scheme.methodKey || `grouping-scheme-${index + 1}`);
}

const schemes = computed(() => {
  const candidates = safeArray(props.output?.schemes)
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      ...item,
      __viewId: normalizeSchemeId(item, index),
    }));
  const preferredScheme = safeObject(props.output?.preferredScheme);
  if (Object.keys(preferredScheme).length) {
    const preferredId = normalizeSchemeId(preferredScheme, candidates.length);
    if (!candidates.some((item) => item.__viewId === preferredId)) {
      candidates.push({
        ...preferredScheme,
        __viewId: preferredId,
      });
    }
  }
  return candidates;
});

const preferredSchemeId = computed(() => {
  const availableIds = new Set(schemes.value.map((item) => item.__viewId));
  const explicitPreferredId = String(
    props.output?.preferredSchemeId
      || props.output?.preferredScheme?.id
      || '',
  );
  if (explicitPreferredId && availableIds.has(explicitPreferredId)) return explicitPreferredId;

  const systemBestId = String(props.output?.systemBestSchemeId || '');
  if (systemBestId && availableIds.has(systemBestId)) return systemBestId;

  return [...schemes.value]
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))[0]?.__viewId || '';
});

const orderedSchemes = computed(() => {
  const preferredId = preferredSchemeId.value;
  return [
    ...schemes.value.filter((item) => item.__viewId === preferredId),
    ...schemes.value.filter((item) => item.__viewId !== preferredId),
  ];
});

const selectedScheme = computed(() => (
  orderedSchemes.value.find((item) => item.__viewId === selectedSchemeId.value)
  || orderedSchemes.value[0]
  || null
));

watch(preferredSchemeId, (value) => {
  selectedSchemeId.value = value || orderedSchemes.value[0]?.__viewId || '';
}, { immediate: true });

watch(() => props.output, () => {
  selectedSchemeId.value = preferredSchemeId.value || orderedSchemes.value[0]?.__viewId || '';
});

watch(orderedSchemes, (items) => {
  if (!items.some((item) => item.__viewId === selectedSchemeId.value)) {
    selectedSchemeId.value = preferredSchemeId.value || items[0]?.__viewId || '';
  }
});

function schemeLabel(scheme = {}, index = 0) {
  return scheme.name || scheme.methodLabel || scheme.label || `编组方案 ${index + 1}`;
}

function schemeDescription(scheme = {}) {
  return safeArray(scheme.advantages)[0]
    || scheme.summary
    || scheme.description
    || scheme.methodKey
    || '点击查看该方案的群组与单位构成。';
}

function schemeGroups(scheme = {}) {
  return safeArray(scheme.groups);
}

function schemeGroupCount(scheme = {}) {
  return Number(scheme.actualGroupCount ?? schemeGroups(scheme).length ?? 0);
}

function schemeUnitCount(scheme = {}) {
  return schemeGroups(scheme).reduce((total, group) => (
    total + Number(group?.unitCount ?? safeArray(group?.units).length ?? 0)
  ), 0);
}

function metricValue(source = {}, key = '') {
  const metrics = safeObject(source.metrics);
  const value = metrics[key] ?? source[key];
  if (value === null || typeof value === 'undefined' || value === '') return '--';
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : value;
}

function firepowerBreakdownText(source = {}) {
  const breakdown = safeObject(source.firepowerBreakdown);
  if (!Object.keys(breakdown).length) return '';
  return `火力构成：武装装备 ${metricValue(breakdown, 'weaponEquipmentPower')} / 运输人员 ${metricValue(breakdown, 'transportPersonnelPower')}`;
}

function constraintStatus(scheme = {}) {
  const status = String(scheme.constraintEvaluation?.overallStatus || '');
  return CONSTRAINT_STATUS_LABELS[status] || scheme.constraintEvaluation?.summary || '待复核';
}

function categoryLabel(value) {
  const key = String(value || '');
  return CATEGORY_LABELS[key] || key || '--';
}

function roleLabel(value) {
  const key = String(value || '');
  return ROLE_LABELS[key] || key || '--';
}

function readinessLabel(value) {
  if (value && typeof value === 'object') {
    const status = READINESS_LABELS[String(value.status || '')] || value.status || '--';
    return Number.isFinite(Number(value.readinessScore))
      ? `${status} / ${Number(value.readinessScore)} 分`
      : status;
  }
  const key = String(value || '');
  return READINESS_LABELS[key] || key || '--';
}

function formatLocation(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    const altitude = Number(value[2] || 0);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      const base = `${longitude.toFixed(4)}, ${latitude.toFixed(4)}`;
      return Number.isFinite(altitude) && altitude ? `${base}, ${Number(altitude.toFixed(1))}m` : base;
    }
  }
  if (value && typeof value === 'object') {
    return formatLocation(value.coordinates || value.location || value.center);
  }
  return String(value || '--');
}

function capabilitySummary(unit = {}) {
  const capabilities = safeObject(unit.capabilities || unit.capability);
  const seenLabels = new Set();
  const orderedKeys = [
    'firepower',
    'protection',
    'recon',
    'reconCoverage',
    'support',
    'endurance',
    'mobility',
    'communication',
    'survivability',
  ];
  const entries = orderedKeys
    .filter((key) => {
      const label = CAPABILITY_LABELS[key] || key;
      if (!Object.prototype.hasOwnProperty.call(capabilities, key) || seenLabels.has(label)) return false;
      seenLabels.add(label);
      return true;
    })
    .map((key) => `${CAPABILITY_LABELS[key] || key} ${metricValue(capabilities, key)}`);
  return entries.join(' / ') || '--';
}

function groupCompositionText(group = {}, index = 0) {
  const names = safeArray(group.units).map((unit) => unit?.name).filter(Boolean);
  return names.length
    ? `第 ${index + 1} 个编组由 ${names.join('、')} 单位构成。`
    : `第 ${index + 1} 个编组暂无可展示的单位构成信息。`;
}

function targetClassLabel(profile = {}) {
  const key = String(profile.classKey || profile.targetClass || profile.type || '');
  return TARGET_CLASS_LABELS[key] || profile.label || key || '--';
}

function formatWeaponLoadout(unit = {}) {
  const items = safeArray(unit.weaponLoadout);
  if (!items.length) return '未挂载';
  const grouped = new Map();
  items.forEach((item) => {
    const key = `${item.weaponId || item.weaponName || 'weapon'}::${item.targetId || ''}`;
    const current = grouped.get(key) || {
      name: item.weaponName || item.weaponId || '武器',
      target: item.targetName || item.targetId || '',
      quantity: 0,
      damage: 0,
    };
    current.quantity += Number(item.quantity || 1);
    current.damage += Number(item.damage || 0);
    grouped.set(key, current);
  });
  return [...grouped.values()]
    .map((item) => `${item.name} x${item.quantity}${item.target ? ` → ${item.target}` : ''}`)
    .join('；');
}

function formatTransportLoadout(unit = {}) {
  const personnel = safeArray(unit.personnelLoadout)
    .map((item) => `${item.personnelGroupName || item.name || '人员'} ${Number(item.count || 0)}人`);
  const cargo = safeArray(unit.cargoLoadout)
    .map((item) => `${item.cargoItemName || item.name || '物资'} x${Number(item.quantity || 0)}`);
  return [...personnel, ...cargo].join('；') || '未装载';
}

function summaryText(items = [], nameKey = 'name', countKey = 'quantity', suffix = '') {
  return safeArray(items)
    .map((item) => `${item[nameKey] || item.weaponName || item.personnelGroupName || item.cargoItemName || '--'} x${Number(item[countKey] || item.count || item.quantity || 0)}${suffix}`)
    .join('；') || '--';
}

function topFirepowerRequirements(scheme = {}) {
  return safeArray(scheme.targetFirepowerRequirements || props.output?.targetFirepowerRequirements || props.output?.tasks).slice(0, 8);
}

function transportCoverageRows(scheme = {}) {
  return safeArray(scheme.transportCoverage || props.output?.transportCoverage);
}

const threatIntegration = computed(() => safeObject(props.output?.threatIntegration));

function formulaBreakdownText(item = {}) {
  const formula = safeObject(item.formulaBreakdown);
  if (!Object.keys(formula).length) return '';
  return `${formula.baseDamageByTargetClass ?? '--'} × ${formula.threatMultiplier ?? '--'} × ${formula.protectionMultiplier ?? '--'} × ${formula.scaleMultiplier ?? '--'} × ${formula.priorityMultiplier ?? '--'} = ${formula.requiredDamage ?? '--'}`;
}

function threatProfileText(item = {}) {
  const profile = safeObject(item.threatProfile);
  if (!Object.keys(profile).length) return '';
  return `综合威胁 ${profile.compositeThreat ?? '--'} / 火力 ${profile.fireCoveragePressure ?? '--'} / 防空 ${profile.airDefensePressure ?? '--'} / 侦察 ${profile.reconPressure ?? '--'}`;
}

function selectScheme(scheme) {
  selectedSchemeId.value = scheme.__viewId;
}
</script>

<template>
  <section v-if="orderedSchemes.length" class="capability-stage-card planning-grouping-browser">
    <div class="section-heading compact">
      <div>
        <span class="eyebrow">Grouping Schemes</span>
        <h3>编组方案切换</h3>
        <p>最优解已置顶；点击任一方案即可查看对应群组和单位构成。</p>
      </div>
      <span class="pill pill-active">共 {{ orderedSchemes.length }} 套方案</span>
    </div>

    <div class="planning-grouping-scheme-grid">
      <button
        v-for="(scheme, index) in orderedSchemes"
        :key="scheme.__viewId"
        type="button"
        class="planning-grouping-scheme-card"
        :class="{
          active: selectedScheme?.__viewId === scheme.__viewId,
          'planning-grouping-scheme-card--preferred': preferredSchemeId === scheme.__viewId,
        }"
        :aria-pressed="selectedScheme?.__viewId === scheme.__viewId"
        @click="selectScheme(scheme)"
      >
        <div class="planning-grouping-scheme-card__head">
          <div>
            <div class="chip-row">
              <span v-if="preferredSchemeId === scheme.__viewId" class="pill pill-active">最优解</span>
              <span v-if="selectedScheme?.__viewId === scheme.__viewId" class="pill pill-muted">当前查看</span>
            </div>
            <h4>{{ schemeLabel(scheme, index) }}</h4>
            <small>{{ schemeDescription(scheme) }}</small>
          </div>
          <strong>{{ metricValue(scheme, 'score') }} 分</strong>
        </div>

        <div class="planning-grouping-scheme-card__stats">
          <span>群组 {{ schemeGroupCount(scheme) }}</span>
          <span>单位 {{ schemeUnitCount(scheme) }}</span>
          <span>高威胁 {{ metricValue(scheme, 'highThreatCoverage') }}</span>
          <span>风险 {{ metricValue(scheme, 'threatRiskControl') }}</span>
        </div>
      </button>
    </div>

    <article v-if="selectedScheme" class="planning-grouping-selected">
      <div class="planning-grouping-selected__head">
        <div>
          <span class="eyebrow">当前编组结果</span>
          <h3>{{ schemeLabel(selectedScheme) }}</h3>
          <p>{{ schemeDescription(selectedScheme) }}</p>
        </div>
        <div class="chip-row">
          <span v-if="preferredSchemeId === selectedScheme.__viewId" class="pill pill-active">最优解</span>
          <span class="pill pill-muted">{{ constraintStatus(selectedScheme) }}</span>
        </div>
      </div>

      <div class="stats-strip compact-grid four-up">
        <div class="mini-stat">
          <span>方案评分</span>
          <strong>{{ metricValue(selectedScheme, 'score') }}</strong>
        </div>
        <div class="mini-stat">
          <span>实际群组</span>
          <strong>{{ schemeGroupCount(selectedScheme) }}</strong>
        </div>
        <div class="mini-stat">
          <span>编入单位</span>
          <strong>{{ schemeUnitCount(selectedScheme) }}</strong>
        </div>
        <div class="mini-stat">
          <span>约束评分</span>
          <strong>{{ metricValue(selectedScheme.constraintEvaluation || {}, 'score') }}</strong>
        </div>
      </div>

      <div v-if="Object.keys(threatIntegration).length" class="planning-grouping-transport-strip">
        <article>
          <span class="eyebrow">Threat Formula</span>
          <strong>{{ threatIntegration.threatLevel || '--' }} / 综合压力 {{ threatIntegration.threatPressure ?? '--' }}</strong>
          <p>{{ threatIntegration.formula }}</p>
          <div class="chip-row">
            <span class="pill pill-active">高威胁目标 {{ threatIntegration.highThreatTargetCount ?? 0 }}</span>
            <span class="pill pill-muted">平均乘数 {{ threatIntegration.averageThreatMultiplier ?? '--' }}</span>
            <span class="pill pill-muted">目标 {{ threatIntegration.targetCount ?? 0 }}</span>
          </div>
        </article>
      </div>

      <div class="planning-grouping-metric-grid">
        <div>
          <span>火力</span>
          <strong>{{ metricValue(selectedScheme, 'firepower') }}</strong>
        </div>
        <div>
          <span>防护</span>
          <strong>{{ metricValue(selectedScheme, 'protection') }}</strong>
        </div>
        <div>
          <span>侦察</span>
          <strong>{{ metricValue(selectedScheme, 'reconCoverage') }}</strong>
        </div>
        <div>
          <span>保障</span>
          <strong>{{ metricValue(selectedScheme, 'endurance') }}</strong>
        </div>
        <div>
          <span>机动</span>
          <strong>{{ metricValue(selectedScheme, 'mobility') }}</strong>
        </div>
        <div>
          <span>均衡</span>
          <strong>{{ metricValue(selectedScheme, 'balance') }}</strong>
        </div>
        <div>
          <span>高威胁覆盖</span>
          <strong>{{ metricValue(selectedScheme, 'highThreatCoverage') }}</strong>
        </div>
        <div>
          <span>风险控制</span>
          <strong>{{ metricValue(selectedScheme, 'threatRiskControl') }}</strong>
        </div>
        <div>
          <span>毁伤满足</span>
          <strong>{{ metricValue(selectedScheme, 'damageSatisfaction') }}</strong>
        </div>
        <div>
          <span>武器效率</span>
          <strong>{{ metricValue(selectedScheme, 'weaponEfficiency') }}</strong>
        </div>
      </div>

      <div v-if="topFirepowerRequirements(selectedScheme).length" class="planning-grouping-requirement-grid">
        <article
          v-for="item in topFirepowerRequirements(selectedScheme)"
          :key="item.taskId || item.targetId"
          class="planning-grouping-requirement-card"
        >
          <div class="chip-row">
            <span class="pill pill-active">{{ targetClassLabel(item.targetClassProfile) }}</span>
            <span class="pill pill-muted">{{ item.typeLabel || item.type || '任务' }}</span>
          </div>
          <h4>{{ item.targetName || item.targetId }}</h4>
          <p>{{ item.allocationReason || item.requiredEffect || '已生成目标火力需求。' }}</p>
          <p v-if="formulaBreakdownText(item)" class="planning-grouping-composition planning-grouping-composition--reason">
            {{ formulaBreakdownText(item) }}
          </p>
          <div class="planning-grouping-requirement-card__stats">
            <span>所需火力 {{ metricValue(item, 'requiredDamage') }}</span>
            <span>威胁乘数 {{ item.threatMultiplier ?? '--' }}</span>
            <span>弹药 {{ item.requiredWeaponCount ?? '--' }}</span>
            <span>攻击机 {{ item.estimatedAttackHelicopters ?? '--' }}</span>
          </div>
          <small v-if="threatProfileText(item)" class="muted-text">{{ threatProfileText(item) }}</small>
        </article>
      </div>

      <div v-if="transportCoverageRows(selectedScheme).length" class="planning-grouping-transport-strip">
        <article v-for="item in transportCoverageRows(selectedScheme)" :key="item.requirementId">
          <span class="eyebrow">运输解算</span>
          <strong>{{ item.name || item.requirementId }}</strong>
          <p>{{ item.reason || item.risk || '人员与物资运输已纳入解算。' }}</p>
          <div class="chip-row">
            <span class="pill pill-active">人员 {{ item.assignedPersonnel }}/{{ item.requiredPersonnel }}</span>
            <span class="pill pill-muted">物资 {{ item.assignedCargoKg }}/{{ item.requiredCargoKg }}kg</span>
            <span class="pill pill-muted">{{ item.covered ? '覆盖完成' : '存在缺口' }}</span>
          </div>
        </article>
      </div>

      <div class="planning-grouping-group-list">
        <article
          v-for="(group, groupIndex) in schemeGroups(selectedScheme)"
          :key="group.id || `${selectedScheme.__viewId}-group-${groupIndex}`"
          class="planning-grouping-group-card"
        >
          <div class="planning-grouping-group-card__head">
            <div>
              <span class="eyebrow">第 {{ groupIndex + 1 }} 个编组</span>
              <h4>{{ group.name || `编组 ${groupIndex + 1}` }}</h4>
            </div>
            <div class="chip-row">
              <span class="pill pill-active">{{ group.unitCount ?? safeArray(group.units).length }} 个单位</span>
              <span class="pill pill-muted">{{ roleLabel(group.role) }}</span>
            </div>
          </div>

          <p class="planning-grouping-composition">{{ groupCompositionText(group, groupIndex) }}</p>
          <p v-if="firepowerBreakdownText(group)" class="planning-grouping-composition">
            {{ firepowerBreakdownText(group) }}
          </p>
          <p v-if="group.allocationReason" class="planning-grouping-composition planning-grouping-composition--reason">
            {{ group.allocationReason }}
          </p>

          <div class="planning-grouping-group-metrics">
            <div>
              <span>火力</span>
              <strong>{{ metricValue(group, 'firepower') }}</strong>
            </div>
            <div>
              <span>防护</span>
              <strong>{{ metricValue(group, 'protection') }}</strong>
            </div>
            <div>
              <span>侦察</span>
              <strong>{{ metricValue(group, 'reconCoverage') }}</strong>
            </div>
            <div>
              <span>保障</span>
              <strong>{{ metricValue(group, 'endurance') }}</strong>
            </div>
            <div>
              <span>机动</span>
              <strong>{{ metricValue(group, 'mobility') }}</strong>
            </div>
            <div>
              <span>总兵力</span>
              <strong>{{ metricValue(group, 'totalStrength') }}</strong>
            </div>
          </div>

          <div class="planning-grouping-load-summary">
            <div>
              <span>武器挂载</span>
              <strong>{{ summaryText(group.weaponSummary, 'weaponName', 'quantity') }}</strong>
            </div>
            <div>
              <span>人员/物资装载</span>
              <strong>{{ summaryText(group.personnelSummary, 'personnelGroupName', 'count') }}</strong>
            </div>
          </div>

          <div v-if="safeArray(group.units).length" class="table-shell compact-table">
            <table>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>单位名称</th>
                  <th>类别</th>
                  <th>角色</th>
                  <th>兵力</th>
                  <th>战备状态</th>
                  <th>武器装载</th>
                  <th>人员/物资装载</th>
                  <th>能力摘要</th>
                  <th>位置</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(unit, unitIndex) in safeArray(group.units)" :key="unit.id || `${group.id}-unit-${unitIndex}`">
                  <td>{{ unitIndex + 1 }}</td>
                  <td class="planning-grouping-unit-name">
                    <strong>{{ unit.name || unit.id || `单位 ${unitIndex + 1}` }}</strong>
                  </td>
                  <td>{{ categoryLabel(unit.category || unit.type) }}</td>
                  <td>{{ roleLabel(unit.role) }}</td>
                  <td>{{ metricValue(unit, 'strength') }}</td>
                  <td>{{ readinessLabel(unit.readiness) }}</td>
                  <td class="planning-grouping-load-cell">{{ formatWeaponLoadout(unit) }}</td>
                  <td class="planning-grouping-load-cell">{{ formatTransportLoadout(unit) }}</td>
                  <td class="planning-grouping-capability-summary">{{ capabilitySummary(unit) }}</td>
                  <td>{{ formatLocation(unit.location || unit.coordinates) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </article>
  </section>
</template>
