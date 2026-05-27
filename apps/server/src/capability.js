import {
  buildAlgorithmGatewayMeta,
  buildStandardEngineCatalog,
  invokeExternalAlgorithm,
  recordAlgorithmCall,
  resolveEngineByKey,
  summarizeAlgorithmPayload,
} from './algorithm-gateway.js';

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function safePositive(value, fallback = 1) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) {
    return fallback;
  }
  return next;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function scoreToGrade(score) {
  if (score >= 90) return { key: 'excellent', label: '优秀' };
  if (score >= 80) return { key: 'good', label: '良好' };
  if (score >= 70) return { key: 'medium', label: '中等' };
  if (score >= 60) return { key: 'weak', label: '较弱' };
  return { key: 'poor', label: '薄弱' };
}

function dot(left = [], right = []) {
  return left.reduce((total, value, index) => total + (Number(value) || 0) * (Number(right[index]) || 0), 0);
}

function normalizeVector(values = []) {
  const total = values.reduce((sum, item) => sum + (Number(item) || 0), 0);
  if (!total) {
    return values.map(() => 0);
  }
  return values.map((item) => (Number(item) || 0) / total);
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + (Number(item) || 0), 0) / values.length;
}

function rootMeanSquare(values = []) {
  if (!values.length) return 0;
  return Math.sqrt(values.reduce((sum, item) => sum + ((Number(item) || 0) ** 2), 0) / values.length);
}

const CAPABILITY_INDICATOR_UNITS = {
  'recon-air-coverage': '%',
  'recon-sea-coverage': '%',
  'recon-key-area-persistence': '%',
  'recon-fusion-latency': '分钟',
  'recon-recognition-accuracy': '%',
  'recon-target-completeness': '%',
  'recon-warning-lead': '分钟',
  'recon-distribution-arrival': '%',
  'recon-network-stability': '%',
  'command-node-health': '%',
  'command-order-latency': '秒',
  'command-backup-availability': '%',
  'command-plan-speed': '分钟',
  'command-task-fit': '分',
  'command-consistency': '%',
  'command-refresh-rate': '次',
  'command-visual-coverage': '%',
  'command-event-closure': '%',
  'strike-location-precision': '米',
  'strike-closure-timeliness': '分钟',
  'strike-indication-stability': '%',
  'strike-first-hit': '%',
  'strike-sustained-suppression': '分钟',
  'strike-damage-degree': '%',
  'strike-cross-domain-rate': '%',
  'strike-ammo-continuity': '%',
  'strike-retask-time': '分钟',
  'mobility-platform-ready': '%',
  'mobility-launch-speed': '分钟',
  'mobility-loading-efficiency': '分钟',
  'mobility-route-access': '%',
  'mobility-arrival-punctuality': '%',
  'mobility-load-utilization': '%',
  'mobility-terrain-passability': '%',
  'mobility-threat-avoidance': '%',
  'mobility-multi-hop-flexibility': '次',
  'protection-air-defense': '%',
  'protection-ew-effectiveness': '%',
  'protection-counter-uav': '%',
  'protection-fortification': '%',
  'protection-dispersion': '%',
  'protection-resilience': '%',
  'protection-repair-speed': '分钟',
  'protection-recovery-rate': '%',
  'protection-substitution-speed': '分钟',
  'support-fuel-availability': '%',
  'support-ammo-availability': '%',
  'support-spare-parts': '%',
  'support-maintenance-closure': '%',
  'support-medical-response': '分钟',
  'support-diagnosis-accuracy': '%',
  'support-comm-availability': '%',
  'support-data-service': '%',
  'support-cyber-security': '分',
};

function applyIndicatorUnits(nodes) {
  safeArray(nodes).forEach((node) => {
    if (safeArray(node.children).length) {
      applyIndicatorUnits(node.children);
      return;
    }

    node.unit = CAPABILITY_INDICATOR_UNITS[String(node.id)] || node.unit || '';
  });

  return nodes;
}

function buildCapabilityIndicators() {
  const indicators = [
    {
      id: 'recon',
      code: 'C1',
      name: '侦察情报',
      weight: 18,
      description: '衡量多源侦察覆盖、情报处理与预警共享的整体水平。',
      children: [
        {
          id: 'recon-coverage',
          code: 'C1-1',
          name: '侦察覆盖',
          weight: 36,
          description: '反映空域、海域和关键方向的持续感知能力。',
          children: [
            { id: 'recon-air-coverage', code: 'C1-1-1', name: '空域覆盖率', weight: 35, description: '重点空域的连续侦察覆盖程度。', unit: '分' },
            { id: 'recon-sea-coverage', code: 'C1-1-2', name: '海域覆盖率', weight: 33, description: '重点海域和航道的感知覆盖程度。', unit: '分' },
            { id: 'recon-key-area-persistence', code: 'C1-1-3', name: '重点区域监视连续性', weight: 32, description: '关键地域监视不中断的持续能力。', unit: '分' },
          ],
        },
        {
          id: 'recon-processing',
          code: 'C1-2',
          name: '情报处理',
          weight: 34,
          description: '衡量多源情报融合、识别和分类能力。',
          children: [
            { id: 'recon-fusion-latency', code: 'C1-2-1', name: '多源融合时效', weight: 34, description: '多源侦察信息从汇聚到可用的响应时效。', unit: '分' },
            { id: 'recon-recognition-accuracy', code: 'C1-2-2', name: '情报识别准确率', weight: 33, description: '目标识别、判型和属性判断的准确程度。', unit: '分' },
            { id: 'recon-target-completeness', code: 'C1-2-3', name: '目标分类完整度', weight: 33, description: '目标类别、状态和关联属性的完整程度。', unit: '分' },
          ],
        },
        {
          id: 'recon-sharing',
          code: 'C1-3',
          name: '预警共享',
          weight: 30,
          description: '评估预警信息从发现到共享的联动效率。',
          children: [
            { id: 'recon-warning-lead', code: 'C1-3-1', name: '预警提前量', weight: 36, description: '对异常目标或威胁的提前发现与预警能力。', unit: '分' },
            { id: 'recon-distribution-arrival', code: 'C1-3-2', name: '情报分发到达率', weight: 32, description: '预警与情报分发到各指挥节点的到达可靠性。', unit: '分' },
            { id: 'recon-network-stability', code: 'C1-3-3', name: '共享网络稳定性', weight: 32, description: '情报共享链路的连续性和稳定水平。', unit: '分' },
          ],
        },
      ],
    },
    {
      id: 'command',
      code: 'C2',
      name: '指挥控制',
      weight: 18,
      description: '衡量指挥链路、决策组织和态势掌控的综合效能。',
      children: [
        {
          id: 'command-links',
          code: 'C2-1',
          name: '指挥链路',
          weight: 35,
          description: '反映指控节点与传输链路的稳定性。',
          children: [
            { id: 'command-node-health', code: 'C2-1-1', name: '指挥节点完好率', weight: 35, description: '核心指挥节点保持可用状态的能力。', unit: '分' },
            { id: 'command-order-latency', code: 'C2-1-2', name: '指令传输时延', weight: 33, description: '指令传输、确认和回执的时延水平。', unit: '分' },
            { id: 'command-backup-availability', code: 'C2-1-3', name: '备用链路可用率', weight: 32, description: '主链路受阻时的链路接替能力。', unit: '分' },
          ],
        },
        {
          id: 'command-decision',
          code: 'C2-2',
          name: '决策效能',
          weight: 33,
          description: '反映决策生成、任务分配和协同执行效率。',
          children: [
            { id: 'command-plan-speed', code: 'C2-2-1', name: '方案生成时效', weight: 34, description: '形成可执行行动方案的时间效率。', unit: '分' },
            { id: 'command-task-fit', code: 'C2-2-2', name: '任务分配合理性', weight: 33, description: '任务与兵力、资源匹配的合理程度。', unit: '分' },
            { id: 'command-consistency', code: 'C2-2-3', name: '指控协同一致性', weight: 33, description: '多级指挥控制动作保持一致的能力。', unit: '分' },
          ],
        },
        {
          id: 'command-situational-awareness',
          code: 'C2-3',
          name: '态势掌控',
          weight: 32,
          description: '衡量态势更新、可视化和异常处置闭环水平。',
          children: [
            { id: 'command-refresh-rate', code: 'C2-3-1', name: '态势更新频率', weight: 34, description: '态势数据更新与广播的实时程度。', unit: '分' },
            { id: 'command-visual-coverage', code: 'C2-3-2', name: '关键目标可视化覆盖率', weight: 33, description: '关键节点与目标被完整展示和掌握的程度。', unit: '分' },
            { id: 'command-event-closure', code: 'C2-3-3', name: '异常事件响应闭环率', weight: 33, description: '对突发事件完成研判、处置和反馈的闭环水平。', unit: '分' },
          ],
        },
      ],
    },
    {
      id: 'strike',
      code: 'C3',
      name: '火力打击',
      weight: 18,
      description: '衡量目标获取、打击效能和火力协同保障能力。',
      children: [
        {
          id: 'strike-targeting',
          code: 'C3-1',
          name: '目标获取',
          weight: 34,
          description: '反映目标定位、指示和侦校闭环能力。',
          children: [
            { id: 'strike-location-precision', code: 'C3-1-1', name: '可打击目标定位精度', weight: 36, description: '对火力打击目标进行精确定位的能力。', unit: '分' },
            { id: 'strike-closure-timeliness', code: 'C3-1-2', name: '火力侦校闭环时效', weight: 32, description: '从发现目标到完成侦校闭环的时间效率。', unit: '分' },
            { id: 'strike-indication-stability', code: 'C3-1-3', name: '目标指示稳定性', weight: 32, description: '目标指示链路持续稳定工作能力。', unit: '分' },
          ],
        },
        {
          id: 'strike-effectiveness',
          code: 'C3-2',
          name: '打击效能',
          weight: 38,
          description: '反映命中概率、压制持续性和毁伤效果。',
          children: [
            { id: 'strike-first-hit', code: 'C3-2-1', name: '首轮命中概率', weight: 35, description: '首轮火力打击形成有效命中的概率。', unit: '分' },
            { id: 'strike-sustained-suppression', code: 'C3-2-2', name: '持续压制能力', weight: 33, description: '维持连续压制和复打的能力。', unit: '分' },
            { id: 'strike-damage-degree', code: 'C3-2-3', name: '重点目标毁伤程度', weight: 32, description: '对关键目标造成有效毁伤的程度。', unit: '分' },
          ],
        },
        {
          id: 'strike-support',
          code: 'C3-3',
          name: '协同保障',
          weight: 28,
          description: '反映火力跨域协同与持续再打击支撑水平。',
          children: [
            { id: 'strike-cross-domain-rate', code: 'C3-3-1', name: '跨域火力协同率', weight: 34, description: '跨平台跨域火力协同形成合力的程度。', unit: '分' },
            { id: 'strike-ammo-continuity', code: 'C3-3-2', name: '弹药供给连续性', weight: 33, description: '支撑持续打击的弹药补给稳定性。', unit: '分' },
            { id: 'strike-retask-time', code: 'C3-3-3', name: '再打击准备时间', weight: 33, description: '完成再部署和再打击的准备效率。', unit: '分' },
          ],
        },
      ],
    },
    {
      id: 'mobility',
      code: 'C4',
      name: '机动投送',
      weight: 16,
      description: '衡量机动准备、投送执行和复杂环境适应能力。',
      children: [
        {
          id: 'mobility-preparation',
          code: 'C4-1',
          name: '机动准备',
          weight: 34,
          description: '反映平台出动、装载和编组准备程度。',
          children: [
            { id: 'mobility-platform-ready', code: 'C4-1-1', name: '平台完好率', weight: 35, description: '机动投送平台保持完好可用的比例。', unit: '分' },
            { id: 'mobility-launch-speed', code: 'C4-1-2', name: '出动准备时效', weight: 33, description: '从接令到完成出动的准备效率。', unit: '分' },
            { id: 'mobility-loading-efficiency', code: 'C4-1-3', name: '装载编组效率', weight: 32, description: '物资、兵力和装备装载编组的效率。', unit: '分' },
          ],
        },
        {
          id: 'mobility-delivery',
          code: 'C4-2',
          name: '投送执行',
          weight: 36,
          description: '反映路线通达、准点到达和载荷利用水平。',
          children: [
            { id: 'mobility-route-access', code: 'C4-2-1', name: '航线/路线通达率', weight: 34, description: '投送路线保持可通达的比例。', unit: '分' },
            { id: 'mobility-arrival-punctuality', code: 'C4-2-2', name: '到达准时率', weight: 33, description: '投送力量按时到达指定节点的能力。', unit: '分' },
            { id: 'mobility-load-utilization', code: 'C4-2-3', name: '输送载荷利用率', weight: 33, description: '投送过程中运输载荷能力的利用程度。', unit: '分' },
          ],
        },
        {
          id: 'mobility-adaptation',
          code: 'C4-3',
          name: '机动适应',
          weight: 30,
          description: '反映复杂地形、威胁规避和多点转场适应能力。',
          children: [
            { id: 'mobility-terrain-passability', code: 'C4-3-1', name: '复杂地形通行能力', weight: 35, description: '在复杂地形条件下维持机动的能力。', unit: '分' },
            { id: 'mobility-threat-avoidance', code: 'C4-3-2', name: '规避威胁能力', weight: 33, description: '在机动过程中避开威胁和损耗的能力。', unit: '分' },
            { id: 'mobility-multi-hop-flexibility', code: 'C4-3-3', name: '多点转场灵活性', weight: 32, description: '多节点快速转场和再部署的灵活程度。', unit: '分' },
          ],
        },
      ],
    },
    {
      id: 'protection',
      code: 'C5',
      name: '综合防护',
      weight: 15,
      description: '衡量主动防护、被动防护与损伤恢复的综合水平。',
      children: [
        {
          id: 'protection-active',
          code: 'C5-1',
          name: '主动防护',
          weight: 35,
          description: '反映拦截、电子对抗和反无人等主动防护能力。',
          children: [
            { id: 'protection-air-defense', code: 'C5-1-1', name: '防空拦截成功率', weight: 35, description: '对来袭空中目标实施有效拦截的能力。', unit: '分' },
            { id: 'protection-ew-effectiveness', code: 'C5-1-2', name: '电磁对抗有效率', weight: 33, description: '通过电子干扰和压制削弱威胁的效果。', unit: '分' },
            { id: 'protection-counter-uav', code: 'C5-1-3', name: '反无人系统覆盖率', weight: 32, description: '对低空无人威胁的防护覆盖能力。', unit: '分' },
          ],
        },
        {
          id: 'protection-passive',
          code: 'C5-2',
          name: '被动防护',
          weight: 33,
          description: '反映伪装、隐蔽和抗毁配置水平。',
          children: [
            { id: 'protection-fortification', code: 'C5-2-1', name: '工事伪装完备度', weight: 34, description: '重点阵地、节点工事与伪装准备程度。', unit: '分' },
            { id: 'protection-dispersion', code: 'C5-2-2', name: '分散隐蔽程度', weight: 33, description: '对关键装备和节点实施分散隐蔽的能力。', unit: '分' },
            { id: 'protection-resilience', code: 'C5-2-3', name: '关键节点抗毁性', weight: 33, description: '核心节点受打击后的抗毁和维持能力。', unit: '分' },
          ],
        },
        {
          id: 'protection-recovery',
          code: 'C5-3',
          name: '生存恢复',
          weight: 32,
          description: '反映受损抢修、恢复和接替能力。',
          children: [
            { id: 'protection-repair-speed', code: 'C5-3-1', name: '损伤抢修时效', weight: 34, description: '受损后快速抢修和恢复的时间效率。', unit: '分' },
            { id: 'protection-recovery-rate', code: 'C5-3-2', name: '受袭后恢复率', weight: 33, description: '受袭后恢复作业和战斗值守的能力。', unit: '分' },
            { id: 'protection-substitution-speed', code: 'C5-3-3', name: '备用能力接替速度', weight: 33, description: '备用力量和备用节点接替运行的速度。', unit: '分' },
          ],
        },
      ],
    },
    {
      id: 'support',
      code: 'C6',
      name: '综合保障',
      weight: 15,
      description: '衡量补给、维修卫勤和信息保障的持续支撑能力。',
      children: [
        {
          id: 'support-supply',
          code: 'C6-1',
          name: '物资补给',
          weight: 36,
          description: '反映油料、弹药和备件的持续供给水平。',
          children: [
            { id: 'support-fuel-availability', code: 'C6-1-1', name: '油料满足率', weight: 34, description: '行动全程获得足量油料补给的能力。', unit: '分' },
            { id: 'support-ammo-availability', code: 'C6-1-2', name: '弹药满足率', weight: 33, description: '关键阶段弹药需求被满足的程度。', unit: '分' },
            { id: 'support-spare-parts', code: 'C6-1-3', name: '备件供应及时率', weight: 33, description: '关键备件按需及时供应的能力。', unit: '分' },
          ],
        },
        {
          id: 'support-maintenance',
          code: 'C6-2',
          name: '维修卫勤',
          weight: 34,
          description: '反映维修闭环、卫勤响应和诊断能力。',
          children: [
            { id: 'support-maintenance-closure', code: 'C6-2-1', name: '装备维修闭环率', weight: 35, description: '装备故障发现、诊断、维修和复测的闭环水平。', unit: '分' },
            { id: 'support-medical-response', code: 'C6-2-2', name: '卫勤救治时效', weight: 33, description: '伤员救治和医疗保障响应的效率。', unit: '分' },
            { id: 'support-diagnosis-accuracy', code: 'C6-2-3', name: '故障诊断准确率', weight: 32, description: '对设备故障快速准确定位的能力。', unit: '分' },
          ],
        },
        {
          id: 'support-information',
          code: 'C6-3',
          name: '信息保障',
          weight: 30,
          description: '反映通信、数据服务与网络安全支撑能力。',
          children: [
            { id: 'support-comm-availability', code: 'C6-3-1', name: '通信服务可用率', weight: 35, description: '语音、数据和业务通信保持可用的能力。', unit: '分' },
            { id: 'support-data-service', code: 'C6-3-2', name: '数据服务连续性', weight: 33, description: '关键数据服务不中断运行的能力。', unit: '分' },
            { id: 'support-cyber-security', code: 'C6-3-3', name: '网络安全防护水平', weight: 32, description: '面对网络攻击和异常时的防护能力。', unit: '分' },
          ],
        },
      ],
    },
  ];

  applyIndicatorUnits(indicators);
  return indicators;
}

const METHOD_CATALOG = [
  {
    key: 'ahp',
    label: 'AHP',
    name: '层次分析法',
    description: '基于层次结构和判断矩阵求解权重，对指标进行逐层综合。',
  },
  {
    key: 'fuzzy',
    label: '模糊综合评价',
    name: '模糊综合评价',
    description: '将三级指标映射到等级隶属度，通过模糊算子完成逐层融合。',
  },
  {
    key: 'topsis',
    label: 'TOPSIS',
    name: 'TOPSIS',
    description: '将各评估对象与正理想解、负理想解的距离进行比较并排序。',
  },
];

function buildEngineCatalog() {
  return buildStandardEngineCatalog({
    moduleKey: 'capability-calculation',
    builtin: {
      key: 'builtin',
      type: 'builtin',
      runtime: 'node',
      version: String(process.env.CAPABILITY_BUILTIN_VERSION || '1.0.0'),
      label: '内置算法引擎',
      description: '当前由 Node 服务内置实现权重聚合、模糊综合评价和 TOPSIS。',
      legacyKeys: ['builtin'],
    },
    externals: [
      {
        key: 'python-service',
        type: 'external-model',
        runtime: 'python',
        endpointEnv: 'CAPABILITY_PYTHON_URL',
        versionEnv: 'CAPABILITY_PYTHON_VERSION',
        label: 'Python 外部算法服务',
        activeDescription: '已通过 CAPABILITY_PYTHON_URL 配置外部 Python 算法服务。',
        plannedDescription: '预留通过 HTTP / RPC 调用 Python 数学模型服务的扩展位。',
        legacyKeys: ['python', 'python-service'],
      },
      {
        key: 'cpp-service',
        type: 'external-model',
        runtime: 'cpp',
        endpointEnv: 'CAPABILITY_CPP_URL',
        versionEnv: 'CAPABILITY_CPP_VERSION',
        label: 'C++ 外部算法服务',
        activeDescription: '已通过 CAPABILITY_CPP_URL 配置外部 C++ 算法服务。',
        plannedDescription: '预留通过本地服务或网关接入 C++ 高性能算法服务的扩展位。',
        legacyKeys: ['cpp', 'cpp-service'],
      },
    ],
  });
}

const GRADE_SCHEMA = [
  { key: 'excellent', label: '优秀', threshold: 90, score: 95 },
  { key: 'good', label: '良好', threshold: 80, score: 85 },
  { key: 'medium', label: '中等', threshold: 70, score: 75 },
  { key: 'weak', label: '较弱', threshold: 60, score: 65 },
  { key: 'poor', label: '薄弱', threshold: 0, score: 50 },
];

const DEFAULT_SCHEMES = [
  {
    id: 'baseline',
    name: '评估对象 A（均衡型）',
    description: '保持六类核心能力相对均衡，用于基准对比。',
    profile: { recon: 79, command: 81, strike: 78, mobility: 76, protection: 74, support: 77 },
  },
  {
    id: 'precision-strike',
    name: '评估对象 B（打击强化型）',
    description: '突出侦察情报与火力打击，侧重首轮制压能力。',
    profile: { recon: 84, command: 80, strike: 89, mobility: 72, protection: 76, support: 73 },
  },
  {
    id: 'rapid-mobility',
    name: '评估对象 C（机动保障型）',
    description: '突出机动投送与综合保障，侧重持续转场和资源续航。',
    profile: { recon: 77, command: 79, strike: 74, mobility: 90, protection: 78, support: 85 },
  },
];

const RANDOM_INDEX = {
  1: 0,
  2: 0,
  3: 0.58,
  4: 0.9,
  5: 1.12,
  6: 1.24,
  7: 1.32,
  8: 1.41,
  9: 1.45,
  10: 1.49,
};

function visitNodes(nodes, visitor, parents = []) {
  for (const node of safeArray(nodes)) {
    visitor(node, parents);
    visitNodes(node.children, visitor, [...parents, node]);
  }
}

function buildWeightLookup(nodes) {
  const lookup = new Map();
  visitNodes(nodes, (node) => {
    lookup.set(String(node.id), safePositive(node.weight, 1));
  });
  return lookup;
}

function annotateTree(nodes, parentPath = ['总体能力'], parentGlobalWeight = 1) {
  const rawWeights = safeArray(nodes).map((node) => safePositive(node.weight, 1));
  const total = rawWeights.reduce((sum, value) => sum + value, 0) || safeArray(nodes).length || 1;

  return safeArray(nodes).map((node, index) => {
    const normalizedWeight = rawWeights[index] / total;
    const currentPath = [...parentPath, node.name];
    const annotated = {
      ...node,
      weight: rawWeights[index],
      normalizedWeight,
      globalWeight: parentGlobalWeight * normalizedWeight,
      path: currentPath,
      children: [],
    };

    annotated.children = annotateTree(node.children, currentPath, annotated.globalWeight);
    return annotated;
  });
}

function buildSchemeScoreDefaults(indicators) {
  const schemes = cloneData(DEFAULT_SCHEMES);
  const leafDescriptors = [];

  indicators.forEach((core, coreIndex) => {
    core.children.forEach((secondary, secondaryIndex) => {
      secondary.children.forEach((leaf, leafIndex) => {
        leafDescriptors.push({
          id: leaf.id,
          coreId: core.id,
          coreIndex,
          secondaryIndex,
          leafIndex,
        });
      });
    });
  });

  const secondaryOffsets = {
    recon: [2, 0, 1],
    command: [1, 2, 0],
    strike: [1, 3, 0],
    mobility: [1, 2, 0],
    protection: [2, 0, 1],
    support: [2, 1, 0],
  };
  const leafOffsets = [2, 0, -2];
  const schemeOffsets = {
    baseline: [0, 1, -1, 0, -1, 1],
    'precision-strike': [1, 0, 2, -1, 0, -1],
    'rapid-mobility': [0, 0, -1, 2, 1, 2],
  };

  return schemes.map((scheme) => {
    const scores = {};
    for (const descriptor of leafDescriptors) {
      const profileBase = scheme.profile[descriptor.coreId] ?? 75;
      const score = clamp(
        profileBase
        + (secondaryOffsets[descriptor.coreId]?.[descriptor.secondaryIndex] ?? 0)
        + (leafOffsets[descriptor.leafIndex] ?? 0)
        + (schemeOffsets[scheme.id]?.[descriptor.coreIndex] ?? 0),
        55,
        98,
      );
      scores[descriptor.id] = score;
    }

    return {
      id: scheme.id,
      name: scheme.name,
      description: scheme.description,
      scores,
    };
  });
}

function buildCapabilityTemplate() {
  const indicators = buildCapabilityIndicators();
  const schemes = buildSchemeScoreDefaults(indicators);
  const engines = buildEngineCatalog();
  const methods = cloneData(METHOD_CATALOG).map((item) => (item.key === 'ahp'
    ? {
        ...item,
        description: '基于已配置权重执行逐层加权综合，并输出权重结构摘要。',
      }
    : item));
  const summary = {
    coreCount: indicators.length,
    secondaryCount: indicators.reduce((total, core) => total + core.children.length, 0),
    tertiaryCount: indicators.reduce(
      (total, core) => total + core.children.reduce((count, secondary) => count + secondary.children.length, 0),
      0,
    ),
    algorithmCount: methods.length,
    engineCount: engines.length,
  };

  return {
    version: '1.0.0',
    module: 'capability-calculation',
    title: '能力计算子模块',
    description: '围绕侦察情报、指挥控制、火力打击、机动投送、综合防护、综合保障六类核心能力开展评估。',
    gradeSchema: cloneData(GRADE_SCHEMA),
    methods,
    engines: cloneData(engines),
    indicators,
    schemes,
    summary,
  };
}

function collectLeafIds(nodes) {
  const ids = [];
  visitNodes(nodes, (node) => {
    if (!safeArray(node.children).length) {
      ids.push(String(node.id));
    }
  });
  return ids;
}

function buildTemplateWeightTree(weightLookup, templateNodes) {
  return safeArray(templateNodes).map((node) => ({
    ...node,
    weight: safePositive(weightLookup.get(String(node.id)), node.weight),
    children: buildTemplateWeightTree(weightLookup, node.children),
  }));
}

function buildDefaultSchemeLookup(templateSchemes) {
  return new Map(templateSchemes.map((scheme) => [String(scheme.id), scheme]));
}

function normalizeSchemes(payloadSchemes, templateSchemes, leafIds) {
  const fallbackLookup = buildDefaultSchemeLookup(templateSchemes);
  const selected = Array.isArray(payloadSchemes) && payloadSchemes.length ? payloadSchemes : templateSchemes;

  return selected.map((scheme, index) => {
    const fallback = fallbackLookup.get(String(scheme.id)) || templateSchemes[index] || templateSchemes[0];
    const schemeId = String(scheme.id || fallback.id || `scheme-${index + 1}`);
    const scores = {};
    const providedScores = scheme?.scores && typeof scheme.scores === 'object' ? scheme.scores : {};
    const fallbackScores = fallback?.scores || {};

    for (const leafId of leafIds) {
      scores[leafId] = clamp(providedScores[leafId] ?? fallbackScores[leafId] ?? 70, 0, 100);
    }

    return {
      id: schemeId,
      name: String(scheme.name || fallback?.name || `方案 ${index + 1}`),
      description: String(scheme.description || fallback?.description || ''),
      scores,
    };
  });
}

function powerIteration(matrix, iterations = 40) {
  const size = matrix.length;
  if (!size) return [];
  let vector = Array.from({ length: size }, () => 1 / size);

  for (let step = 0; step < iterations; step += 1) {
    const next = matrix.map((row) => dot(row, vector));
    vector = normalizeVector(next);
  }

  return vector;
}

function calculateConsistencyReport(nodes, parentPath = ['总体能力']) {
  const reports = [];
  for (const node of safeArray(nodes)) {
    const children = safeArray(node.children);
    if (children.length > 1) {
      const matrix = children.map((current) => children.map((compare) => safePositive(current.weight, 1) / safePositive(compare.weight, 1)));
      const eigenvector = powerIteration(matrix);
      const aw = matrix.map((row) => dot(row, eigenvector));
      const lambdaMax = mean(aw.map((value, index) => value / (eigenvector[index] || 1)));
      const n = children.length;
      const ci = n > 2 ? (lambdaMax - n) / (n - 1) : 0;
      const ri = RANDOM_INDEX[n] || 1;
      const cr = n > 2 ? ci / ri : 0;

      reports.push({
        path: [...parentPath, node.name].join(' / '),
        size: n,
        lambdaMax: Number(lambdaMax.toFixed(4)),
        ci: Number(ci.toFixed(4)),
        cr: Number(cr.toFixed(4)),
        passed: cr <= 0.1,
        weights: children.map((child, index) => ({
          id: child.id,
          name: child.name,
          weight: Number(eigenvector[index].toFixed(4)),
        })),
      });
    }

    reports.push(...calculateConsistencyReport(children, [...parentPath, node.name]));
  }

  return reports;
}

function summarizeWeightStructure(nodes, parentPath = ['总体能力']) {
  const groups = [];
  for (const node of safeArray(nodes)) {
    const children = safeArray(node.children);
    if (children.length) {
      const normalizedWeights = children.map((child) => Number(child.normalizedWeight || 0));
      const maxWeight = Math.max(...normalizedWeights, 0);
      const minWeight = Math.min(...normalizedWeights, 1);
      const dominantIndex = normalizedWeights.findIndex((value) => value === maxWeight);
      const dominantChild = children[dominantIndex] || children[0];

      groups.push({
        path: [...parentPath, node.name].join(' / '),
        size: children.length,
        dominantChild: dominantChild?.name || '',
        dominantWeight: Number(maxWeight.toFixed(4)),
        minWeight: Number(minWeight.toFixed(4)),
        maxWeight: Number(maxWeight.toFixed(4)),
        spread: Number((maxWeight - minWeight).toFixed(4)),
      });

      groups.push(...summarizeWeightStructure(children, [...parentPath, node.name]).groups);
    }
  }

  const dominantWeights = groups.map((item) => item.dominantWeight);

  return {
    groupCount: groups.length,
    maxBranchFactor: Math.max(...groups.map((item) => item.size), 0),
    averageBranchFactor: Number(mean(groups.map((item) => item.size)).toFixed(2)),
    averageDominantWeight: Number(mean(dominantWeights).toFixed(4)),
    maxDominantWeight: Number(Math.max(...dominantWeights, 0).toFixed(4)),
    leafCount: flattenLeaves(nodes).length,
    groups,
  };
}

function evaluateWeightedNode(node, scoreMap) {
  const children = safeArray(node.children);
  if (!children.length) {
    const score = clamp(scoreMap[node.id], 0, 100);
    const grade = scoreToGrade(score);
    return {
      id: node.id,
      code: node.code,
      name: node.name,
      description: node.description,
      score: Number(score.toFixed(2)),
      grade: grade.label,
      normalizedWeight: Number(node.normalizedWeight.toFixed(4)),
      globalWeight: Number(node.globalWeight.toFixed(4)),
      path: node.path,
      children: [],
    };
  }

  const childResults = children.map((child) => evaluateWeightedNode(child, scoreMap));
  const score = childResults.reduce((sum, child, index) => sum + child.score * children[index].normalizedWeight, 0);
  const grade = scoreToGrade(score);

  return {
    id: node.id,
    code: node.code,
    name: node.name,
    description: node.description,
    score: Number(score.toFixed(2)),
    grade: grade.label,
    normalizedWeight: Number(node.normalizedWeight.toFixed(4)),
    globalWeight: Number(node.globalWeight.toFixed(4)),
    path: node.path,
    children: childResults,
  };
}

function calculateAHP(indicators, schemes) {
  const weightSummary = summarizeWeightStructure(indicators);
  const schemeResults = {};

  for (const scheme of schemes) {
    const coreResults = indicators.map((node) => evaluateWeightedNode(node, scheme.scores));
    const overallScore = coreResults.reduce((sum, item, index) => sum + item.score * indicators[index].normalizedWeight, 0);
    const grade = scoreToGrade(overallScore);

    schemeResults[scheme.id] = {
      id: scheme.id,
      name: scheme.name,
      description: scheme.description,
      overallScore: Number(overallScore.toFixed(2)),
      grade: grade.label,
      coreScores: coreResults.map((item) => ({ id: item.id, name: item.name, score: item.score, grade: item.grade })),
      tree: coreResults,
    };
  }

  const ranking = Object.values(schemeResults)
    .map((item) => ({ schemeId: item.id, name: item.name, score: item.overallScore, grade: item.grade }))
    .sort((left, right) => right.score - left.score)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    key: 'ahp',
    label: 'AHP',
    description: '基于层次分析法对权重进行逐层综合。',
    ranking,
    weightSummary,
    consistency: null,
    schemes: schemeResults,
  };
}

function buildMembership(score) {
  const centers = [95, 85, 75, 65, 50];
  const widths = [10, 10, 10, 10, 18];
  const values = centers.map((center, index) => Math.max(0, 1 - (Math.abs(score - center) / widths[index])));
  const total = values.reduce((sum, item) => sum + item, 0);

  if (!total) {
    const nearest = centers
      .map((center, index) => ({ index, distance: Math.abs(score - center) }))
      .sort((left, right) => left.distance - right.distance)[0];
    return values.map((_, index) => (index === nearest.index ? 1 : 0));
  }

  return values.map((value) => value / total);
}

function membershipToGrade(membership) {
  const index = membership.reduce((bestIndex, value, currentIndex, source) => (value > source[bestIndex] ? currentIndex : bestIndex), 0);
  return GRADE_SCHEMA[index];
}

function evaluateFuzzyNode(node, scoreMap) {
  const children = safeArray(node.children);
  if (!children.length) {
    const score = clamp(scoreMap[node.id], 0, 100);
    const membership = buildMembership(score);
    const grade = scoreToGrade(score);

    return {
      id: node.id,
      code: node.code,
      name: node.name,
      description: node.description,
      score: Number(score.toFixed(2)),
      grade: grade.label,
      membership: membership.map((item) => Number(item.toFixed(4))),
      normalizedWeight: Number(node.normalizedWeight.toFixed(4)),
      globalWeight: Number(node.globalWeight.toFixed(4)),
      path: node.path,
      children: [],
    };
  }

  const childResults = children.map((child) => evaluateFuzzyNode(child, scoreMap));
  const membership = GRADE_SCHEMA.map((_, gradeIndex) => childResults.reduce(
    (sum, child, childIndex) => sum + child.membership[gradeIndex] * children[childIndex].normalizedWeight,
    0,
  ));
  const score = dot(membership, GRADE_SCHEMA.map((item) => item.score));
  const grade = scoreToGrade(score);

  return {
    id: node.id,
    code: node.code,
    name: node.name,
    description: node.description,
    score: Number(score.toFixed(2)),
    grade: grade.label,
    membership: membership.map((item) => Number(item.toFixed(4))),
    normalizedWeight: Number(node.normalizedWeight.toFixed(4)),
    globalWeight: Number(node.globalWeight.toFixed(4)),
    path: node.path,
    children: childResults,
  };
}

function calculateFuzzy(indicators, schemes) {
  const schemeResults = {};

  for (const scheme of schemes) {
    const coreResults = indicators.map((node) => evaluateFuzzyNode(node, scheme.scores));
    const overallMembership = GRADE_SCHEMA.map((_, gradeIndex) => coreResults.reduce(
      (sum, node, index) => sum + node.membership[gradeIndex] * indicators[index].normalizedWeight,
      0,
    ));
    const overallScore = dot(overallMembership, GRADE_SCHEMA.map((item) => item.score));
    const grade = scoreToGrade(overallScore);

    schemeResults[scheme.id] = {
      id: scheme.id,
      name: scheme.name,
      description: scheme.description,
      overallScore: Number(overallScore.toFixed(2)),
      grade: grade.label,
      membership: overallMembership.map((item) => Number(item.toFixed(4))),
      coreScores: coreResults.map((item) => ({
        id: item.id,
        name: item.name,
        score: item.score,
        grade: item.grade,
        membership: item.membership,
      })),
      tree: coreResults,
    };
  }

  const ranking = Object.values(schemeResults)
    .map((item) => ({ schemeId: item.id, name: item.name, score: item.overallScore, grade: item.grade }))
    .sort((left, right) => right.score - left.score)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    key: 'fuzzy',
    label: '模糊综合评价',
    description: '基于等级隶属度矩阵进行逐层模糊融合。',
    ranking,
    schemes: schemeResults,
  };
}

function flattenLeaves(nodes, leaves = []) {
  for (const node of safeArray(nodes)) {
    if (safeArray(node.children).length) {
      flattenLeaves(node.children, leaves);
    } else {
      leaves.push(node);
    }
  }
  return leaves;
}

function runTopsisForLeaves(schemes, leaves) {
  const normalizedWeights = normalizeVector(leaves.map((leaf) => leaf.globalWeight));
  const columnValues = leaves.map((leaf) => schemes.map((scheme) => clamp(scheme.scores[leaf.id], 0, 100)));
  const denominators = columnValues.map((column) => Math.sqrt(column.reduce((sum, value) => sum + (value ** 2), 0)) || 1);

  const weightedMatrix = schemes.map((scheme) => leaves.map((leaf, leafIndex) => {
    const normalized = clamp(scheme.scores[leaf.id], 0, 100) / denominators[leafIndex];
    return normalized * normalizedWeights[leafIndex];
  }));

  const idealBest = leaves.map((_, leafIndex) => Math.max(...weightedMatrix.map((row) => row[leafIndex])));
  const idealWorst = leaves.map((_, leafIndex) => Math.min(...weightedMatrix.map((row) => row[leafIndex])));

  const scores = schemes.map((scheme, schemeIndex) => {
    const row = weightedMatrix[schemeIndex];
    const distanceToBest = Math.sqrt(row.reduce((sum, value, index) => sum + ((value - idealBest[index]) ** 2), 0));
    const distanceToWorst = Math.sqrt(row.reduce((sum, value, index) => sum + ((value - idealWorst[index]) ** 2), 0));
    const closeness = distanceToWorst / (distanceToBest + distanceToWorst || 1);
    const score = 60 + (closeness * 40);
    const grade = scoreToGrade(score);

    return {
      schemeId: scheme.id,
      name: scheme.name,
      score: Number(score.toFixed(2)),
      closeness: Number(closeness.toFixed(4)),
      grade: grade.label,
    };
  });

  const ranking = [...scores]
    .sort((left, right) => right.closeness - left.closeness)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return { scores, ranking };
}

function calculateTopsis(indicators, schemes) {
  const allLeaves = flattenLeaves(indicators);
  const overall = runTopsisForLeaves(schemes, allLeaves);
  const coreResults = indicators.map((core) => ({
    id: core.id,
    name: core.name,
    ...runTopsisForLeaves(schemes, flattenLeaves([core])),
  }));

  const schemeResults = {};
  for (const scheme of schemes) {
    const overallEntry = overall.scores.find((item) => item.schemeId === scheme.id);
    const coreScores = coreResults.map((item) => {
      const entry = item.scores.find((score) => score.schemeId === scheme.id);
      return {
        id: item.id,
        name: item.name,
        score: entry?.score || 0,
        closeness: entry?.closeness || 0,
        grade: entry?.grade || scoreToGrade(0).label,
      };
    });

    schemeResults[scheme.id] = {
      id: scheme.id,
      name: scheme.name,
      description: scheme.description,
      overallScore: overallEntry?.score || 0,
      closeness: overallEntry?.closeness || 0,
      grade: overallEntry?.grade || scoreToGrade(0).label,
      coreScores,
    };
  }

  return {
    key: 'topsis',
    label: 'TOPSIS',
    description: '基于与理想解距离的贴近度对评估对象进行排序。',
    ranking: overall.ranking,
    schemes: schemeResults,
  };
}

function selectMethods(payloadMethods) {
  const supported = new Set(METHOD_CATALOG.map((item) => item.key));
  if (!Array.isArray(payloadMethods) || !payloadMethods.length) {
    return METHOD_CATALOG.map((item) => item.key);
  }

  const selected = payloadMethods
    .map((item) => String(item))
    .filter((item, index, source) => supported.has(item) && source.indexOf(item) === index);

  return selected.length ? selected : METHOD_CATALOG.map((item) => item.key);
}

function summarizeWeights(indicators) {
  return {
    topLevel: indicators.map((item) => ({
      id: item.id,
      name: item.name,
      normalizedWeight: Number(item.normalizedWeight.toFixed(4)),
    })),
    leafRmsWeight: Number(rootMeanSquare(flattenLeaves(indicators).map((item) => item.globalWeight)).toFixed(4)),
  };
}

function evaluateWithBuiltinEngine(payload = {}) {
  const template = buildCapabilityTemplate();
  const engineCatalog = buildEngineCatalog();
  const indicatorSource = Array.isArray(payload.indicators) && payload.indicators.length
    ? cloneData(payload.indicators)
    : cloneData(template.indicators);
  const leafIds = collectLeafIds(indicatorSource);
  const annotatedTree = annotateTree(indicatorSource);
  const schemes = normalizeSchemes(payload.schemes, template.schemes, leafIds);
  const selectedMethods = selectMethods(payload.methods);
  const methods = {};

  if (selectedMethods.includes('ahp')) {
    methods.ahp = calculateAHP(annotatedTree, schemes);
  }
  if (selectedMethods.includes('fuzzy')) {
    methods.fuzzy = calculateFuzzy(annotatedTree, schemes);
  }
  if (selectedMethods.includes('topsis')) {
    methods.topsis = calculateTopsis(annotatedTree, schemes);
  }

  return {
    assessmentName: String(payload.assessmentName || '能力评估任务'),
    engine: engineCatalog[0],
    generatedAt: new Date().toISOString(),
    weights: summarizeWeights(annotatedTree),
    methods,
    schemes: schemes.map((scheme) => ({
      id: scheme.id,
      name: scheme.name,
      description: scheme.description,
    })),
  };
}

async function evaluateWithExternalEngine(engine, payload) {
  return invokeExternalAlgorithm({
    engine,
    moduleKey: 'capability-calculation',
    payload,
    assessmentName: String(payload.assessmentName || '能力评估任务'),
    algorithm: {
      key: 'capability-evaluation',
      name: '能力评估',
    },
    requestMeta: {
      flow: 'capability-evaluate',
    },
  });
}

function normalizeCapabilityEvaluationResult(rawResult, payload, engine, gatewayMeta) {
  const normalized = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
    ? cloneData(rawResult)
    : { result: rawResult };

  return {
    ...normalized,
    assessmentName: String(normalized.assessmentName || payload.assessmentName || '能力评估任务'),
    engine: {
      ...cloneData(engine),
      status: 'active',
    },
    algorithmGateway: buildAlgorithmGatewayMeta(engine, gatewayMeta),
  };
}

export function getCapabilityTemplate() {
  return buildCapabilityTemplate();
}

export async function evaluateCapability(payload = {}, options = {}) {
  const { db } = options;
  const engineCatalog = buildEngineCatalog();
  const engine = resolveEngineByKey(engineCatalog, payload.engine || 'builtin');
  const assessmentName = String(payload.assessmentName || '能力评估任务');

  if (!engine) {
    const error = new Error('不支持的能力计算引擎。');
    error.status = 400;
    error.code = 'CAPABILITY_ENGINE_UNSUPPORTED';
    error.type = 'missing_data';
    throw error;
  }

  if (engine.key !== 'builtin' && engine.status !== 'active') {
    const error = new Error(`${engine.label}当前仅保留扩展位，尚未接入实际计算服务。`);
    error.status = 400;
    error.code = 'CAPABILITY_ENGINE_NOT_READY';
    error.type = 'missing_data';
    throw error;
  }

  const algorithmKey = 'capability-evaluation';
  const algorithmName = '能力评估';
  const requestSummary = summarizeAlgorithmPayload(payload);

  if (engine.key === 'builtin') {
    const result = evaluateWithBuiltinEngine(payload);
    const normalizedResult = normalizeCapabilityEvaluationResult(result, payload, engine, {
      status: 'succeeded',
      durationMs: 0,
      httpStatus: 200,
      requestId: '',
    });
    recordAlgorithmCall(db, {
      moduleKey: 'capability',
      assessmentName,
      algorithmKey,
      algorithmName,
      engineKey: engine.key,
      engineSource: engine.source,
      engineRuntime: engine.runtime,
      engineVersion: engine.version,
      status: 'succeeded',
      httpStatus: 200,
      durationMs: 0,
      requestPayload: requestSummary,
      responsePayload: {
        generatedAt: normalizedResult.generatedAt,
        methodCount: Object.keys(normalizedResult.methods || {}).length,
      },
    });
    return normalizedResult;
  }

  try {
    const external = await evaluateWithExternalEngine(engine, payload);
    const normalizedResult = normalizeCapabilityEvaluationResult(
      external.result,
      payload,
      engine,
      external.callMeta,
    );
    recordAlgorithmCall(db, {
      moduleKey: 'capability',
      assessmentName,
      algorithmKey,
      algorithmName,
      engineKey: engine.key,
      engineSource: engine.source,
      engineRuntime: engine.runtime,
      engineVersion: engine.version,
      status: 'succeeded',
      httpStatus: external.callMeta?.httpStatus,
      durationMs: external.callMeta?.durationMs,
      requestId: external.callMeta?.requestId,
      requestPayload: requestSummary,
      responsePayload: {
        generatedAt: normalizedResult.generatedAt,
        methodCount: Object.keys(normalizedResult.methods || {}).length,
      },
    });
    return normalizedResult;
  } catch (error) {
    recordAlgorithmCall(db, {
      moduleKey: 'capability',
      assessmentName,
      algorithmKey,
      algorithmName,
      engineKey: engine.key,
      engineSource: engine.source,
      engineRuntime: engine.runtime,
      engineVersion: engine.version,
      status: 'failed',
      httpStatus: error?.status,
      durationMs: error?.details?.durationMs,
      requestId: error?.details?.requestId,
      errorCode: error?.code || 'CAPABILITY_ENGINE_FAILED',
      errorMessage: error?.message || '能力评估外部算法执行失败。',
      requestPayload: requestSummary,
      responsePayload: safeObject(error?.details),
    });
    throw error;
  }
}
