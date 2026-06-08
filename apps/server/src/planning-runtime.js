import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapEnvironment,
  mapExtraction,
  mapIntelligence,
  mapSource,
  mapSourcePreview,
} from './db.js';
import {
  buildAlgorithmGatewayMeta,
  buildStandardEngineCatalog,
  invokeExternalAlgorithm,
  recordAlgorithmCall,
} from './algorithm-gateway.js';
import { normalizeImportedPreview } from './import-preview.js';

const PLANNING_RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(PLANNING_RUNTIME_DIR, '../../..');
const PLANNING_PYTHON_BIN = String(process.env.PLANNING_PYTHON_BIN || '').trim();
const PLANNING_PYTHON_USE_VENV = !['0', 'false', 'no'].includes(
  String(process.env.PLANNING_PYTHON_USE_VENV || '1').trim().toLowerCase(),
);
const PLANNING_PYTHON_VENV_RUNNER = path.join(REPO_ROOT, 'algorithms', 'run-with-venv.mjs');

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function round(value, digits = 2) {
  return Number((Number(value) || 0).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function average(values = []) {
  const numericValues = safeArray(values).map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (!numericValues.length) return 0;
  return numericValues.reduce((total, item) => total + item, 0) / numericValues.length;
}

function sumBy(list = [], selector = (item) => item) {
  return safeArray(list).reduce((total, item, index) => total + (Number(selector(item, index)) || 0), 0);
}

function uniqueList(list = []) {
  return [...new Set(safeArray(list).map((item) => String(item || '').trim()).filter(Boolean))];
}

function uniqueNumberList(list = []) {
  return [...new Set(
    safeArray(list)
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item)),
  )];
}

function textOf(value = '') {
  return String(value || '').toLowerCase();
}

function includesAny(text, keywords = []) {
  const source = textOf(text);
  return safeArray(keywords).some((item) => source.includes(textOf(item)));
}

function keywordScore(texts = [], keywords = []) {
  let score = 0;
  for (const keyword of safeArray(keywords)) {
    const normalizedKeyword = textOf(keyword);
    if (!normalizedKeyword) continue;
    for (const text of safeArray(texts)) {
      if (textOf(text).includes(normalizedKeyword)) {
        score += 1;
      }
    }
  }
  return score;
}

function sortByScore(list = [], field = 'score') {
  return [...safeArray(list)].sort((left, right) => Number(right?.[field] || 0) - Number(left?.[field] || 0));
}

function standardDeviation(values = []) {
  const numericValues = safeArray(values).map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (!numericValues.length) return 0;
  const mean = average(numericValues);
  return Math.sqrt(average(numericValues.map((item) => (item - mean) ** 2)));
}

function toShortText(value, maxLength = 120) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function createSequence(prefix, index) {
  return `${prefix}-${index + 1}`;
}

function resolveThreatLevel(score) {
  if (score >= 78) return '高';
  if (score >= 56) return '中';
  return '低';
}

function toCoordinateTuple(value = []) {
  return [
    Number(value?.[0] || 0),
    Number(value?.[1] || 0),
    Number(value?.[2] || 0),
  ];
}

function computePolygonCenter(points = []) {
  const validPoints = safeArray(points).filter((item) => Array.isArray(item) && item.length >= 2);
  if (!validPoints.length) return [0, 0, 0];
  return [
    round(average(validPoints.map((item) => item[0])), 4),
    round(average(validPoints.map((item) => item[1])), 4),
    round(average(validPoints.map((item) => Number(item[2] || 0))), 2),
  ];
}

function buildBoundingPolygon(points = [], margin = 0.06) {
  const validPoints = safeArray(points).filter((item) => Array.isArray(item) && item.length >= 2);
  if (!validPoints.length) return [];

  const longitudes = validPoints.map((item) => Number(item[0]));
  const latitudes = validPoints.map((item) => Number(item[1]));
  const minLongitude = Math.min(...longitudes) - margin;
  const maxLongitude = Math.max(...longitudes) + margin;
  const minLatitude = Math.min(...latitudes) - margin * 0.75;
  const maxLatitude = Math.max(...latitudes) + margin * 0.75;

  return [
    [round(minLongitude, 4), round(minLatitude, 4), 0],
    [round(maxLongitude, 4), round(minLatitude, 4), 0],
    [round(maxLongitude, 4), round(maxLatitude, 4), 0],
    [round(minLongitude, 4), round(maxLatitude, 4), 0],
  ];
}

function haversineDistanceKm(left = [], right = []) {
  const [lon1, lat1] = left.map((item) => Number(item || 0));
  const [lon2, lat2] = right.map((item) => Number(item || 0));
  const toRadians = (value) => value * (Math.PI / 180);
  const earthRadius = 6371;
  const deltaLatitude = toRadians(lat2 - lat1);
  const deltaLongitude = toRadians(lon2 - lon1);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(lat1))
    * Math.cos(toRadians(lat2))
    * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const LOCAL_FILE_EXTENSIONS = ['.doc', '.docx', '.pdf', '.xls', '.xlsx', '.csv', '.txt'];

const THREAT_METHODS = [
  {
    key: 'knowledge-fusion',
    label: '知识融合分析',
    description: '综合敌情数据、环境要素和文本抽取线索形成统一威胁模型。',
  },
  {
    key: 'coverage-priority',
    label: '覆盖优先分析',
    description: '突出敌火力覆盖圈、防空拦截链和重点威胁区域。',
  },
];

const GROUPING_METHODS = [
  {
    key: 'rule-inference',
    label: '规则推理编组',
    description: '按任务规则库和兵力职责直接生成编组方案。',
  },
  {
    key: 'genetic-optimization',
    label: '遗传优化编组',
    description: '优先聚焦高价值平台组合和高分适配方案。',
  },
  {
    key: 'hybrid-balanced',
    label: '混合均衡编组',
    description: '在火力、侦察、掩护与保障之间做平衡配置。',
  },
];

const TARGET_METHODS = [
  {
    key: 'hungarian',
    label: '匈牙利算法分配',
    description: '适合多轮次、高价值目标的快速全局匹配。',
  },
  {
    key: 'ant-colony',
    label: '蚁群协同分配',
    description: '适合多目标、多平台协同和多波次序列分配。',
  },
  {
    key: 'multi-objective',
    label: '多目标优化分配',
    description: '基于 Pareto 候选解搜索，综合重要性、难度、风险和平台负荷平衡分配。',
  },
];

const TARGET_VALIDATION_PROFILES = {
  strict: {
    key: 'strict',
    label: '严格校核',
    highPriorityThreshold: 78,
    minCandidateScore: 52,
    minMatchScore: 60,
    minFeasibilityScore: 58,
    maxReachUtilization: 1.02,
    warningReachUtilization: 0.9,
  },
  standard: {
    key: 'standard',
    label: '标准校核',
    highPriorityThreshold: 72,
    minCandidateScore: 44,
    minMatchScore: 52,
    minFeasibilityScore: 46,
    maxReachUtilization: 1.18,
    warningReachUtilization: 1.02,
  },
};

const TARGET_TYPE_PROFILES = {
  'fire-coverage': {
    label: '火力覆盖',
    preferredRoles: ['strike', 'cover'],
    capabilityWeights: {
      firepower: 0.44,
      protection: 0.12,
      reconCoverage: 0.12,
      endurance: 0.1,
      mobility: 0.22,
    },
  },
  'air-defense': {
    label: '防空节点',
    preferredRoles: ['strike', 'cover'],
    capabilityWeights: {
      firepower: 0.36,
      protection: 0.18,
      reconCoverage: 0.12,
      endurance: 0.1,
      mobility: 0.24,
    },
  },
  'recon-warning': {
    label: '侦察预警',
    preferredRoles: ['recon', 'strike'],
    capabilityWeights: {
      firepower: 0.16,
      protection: 0.1,
      reconCoverage: 0.4,
      endurance: 0.12,
      mobility: 0.22,
    },
  },
  'anti-airborne': {
    label: '反机降设施',
    preferredRoles: ['strike', 'cover', 'recon'],
    capabilityWeights: {
      firepower: 0.26,
      protection: 0.18,
      reconCoverage: 0.14,
      endurance: 0.12,
      mobility: 0.3,
    },
  },
  'deployment-sector': {
    label: '集结地域',
    preferredRoles: ['strike', 'recon', 'cover'],
    capabilityWeights: {
      firepower: 0.3,
      protection: 0.12,
      reconCoverage: 0.2,
      endurance: 0.16,
      mobility: 0.22,
    },
  },
  default: {
    label: '综合目标',
    preferredRoles: ['strike', 'cover', 'recon'],
    capabilityWeights: {
      firepower: 0.28,
      protection: 0.16,
      reconCoverage: 0.18,
      endurance: 0.14,
      mobility: 0.24,
    },
  },
};

const METHOD_PLANNING_METHODS = [
  {
    key: 'a-star',
    label: 'A* 路径规划',
    description: '采用启发式低代价搜索生成快速突防与火力打击路径。',
  },
  {
    key: 'dijkstra',
    label: 'Dijkstra 路径规划',
    description: '以全局累计代价最小为目标，适合稳健航路与机降突击路线设计。',
  },
  {
    key: 'rrt',
    label: 'RRT 路径规划',
    description: '通过随机扩展生成多样化规避路径，适合复杂威胁与低空渗透环境。',
  },
];

const SUPPORT_METHODS = [
  {
    key: 'demand-driven',
    label: '需求牵引调度',
    description: '按照任务节奏和关键阶段需求优先调度弹药、油料与医疗资源。',
  },
  {
    key: 'balanced-scheduling',
    label: '均衡保障调度',
    description: '在持续性、冗余和资源覆盖率之间做均衡分配。',
  },
  {
    key: 'loss-aware',
    label: '战损感知保障',
    description: '根据战损预测提高维修、医疗与空域隔离资源的配置比例。',
  },
];

function createDefaultSupportDamageForecast() {
  return {
    source: 'manual-assessment',
    equipmentLossRate: 12,
    casualtyRate: 6,
    damagedEquipmentCount: 4,
    woundedCount: 18,
    criticalWindowCount: 2,
  };
}

function createDefaultSupportResourcePool() {
  return {
    stock: {
      ammo: 240,
      fuel: 160,
      maintenance: 92,
      medical: 28,
      airspace: 20,
      command: 14,
    },
    transport: {
      sorties: 16,
      liftTonnagePerSortie: 7,
      maintenanceTeams: 7,
      medicalTeams: 6,
      airspaceCells: 8,
      commandLinks: 14,
    },
  };
}

function createDefaultSupportOptions() {
  return {
    reserveRatio: 18,
    airspaceControl: 'standard',
    damageForecast: createDefaultSupportDamageForecast(),
    resourcePool: createDefaultSupportResourcePool(),
  };
}

const LANDING_SITE_METHODS = [
  {
    key: 'weighted-score',
    label: '加权评分选址',
    description: '综合隐蔽性、安全性、集结效率和直升机适配度进行评分排序。',
  },
  {
    key: 'pareto-ranking',
    label: 'Pareto 多目标排序',
    description: '保留多目标优势候选点，适合在多重约束下进行综合比选。',
  },
  {
    key: 'constraint-screening',
    label: '约束筛选优化',
    description: '先剔除高威胁和超航程候选点，再对剩余机降地域进行优化。',
  },
];

const GROUPING_RULE_LIBRARIES = {
  'fire-strike-rules': {
    key: 'fire-strike-rules',
    label: '火力打击任务编组规则',
    description: '强调主攻火力、压制支援、侦察预警与保障协同的组合效率。',
    weights: {
      firepower: 0.32,
      protection: 0.2,
      reconCoverage: 0.16,
      endurance: 0.18,
      mobility: 0.08,
      balance: 0.06,
    },
  },
  'air-assault-rules': {
    key: 'air-assault-rules',
    label: '机降突击任务编组规则',
    description: '强调机动性、空地协同、抢占节点与快速补给。',
    weights: {
      firepower: 0.24,
      protection: 0.18,
      reconCoverage: 0.14,
      endurance: 0.14,
      mobility: 0.22,
      balance: 0.08,
    },
  },
};

const GROUPING_CONSTRAINT_MODELS = {
  'baseline-constraints': {
    key: 'baseline-constraints',
    label: '基础编组约束',
    description: '校验功能群完整性、关键角色覆盖和兵力负载均衡，作为默认约束模型。',
  },
};

const GROUPING_METRIC_LABELS = {
  firepower: '火力集中度',
  protection: '掩护防护能力',
  reconCoverage: '侦察覆盖能力',
  endurance: '持续保障能力',
  mobility: '机动转换能力',
  balance: '群组均衡度',
};

const GROUPING_RULE_SIGNAL_DEFINITIONS = [
  {
    key: 'equipment-performance',
    label: '装备性能',
    keywords: ['装备', '性能', '射程', '航程', '防护', '装甲', '精度', '速度', '载荷', '火力'],
    weightAdjustments: {
      firepower: 0.02,
      protection: 0.02,
      mobility: 0.02,
    },
  },
  {
    key: 'personnel-configuration',
    label: '人员配置',
    keywords: ['人员', '编制', '满编', '机组', '操作手', '班组', '骨干', '训练', '协同', '值守'],
    weightAdjustments: {
      protection: 0.02,
      endurance: 0.03,
      balance: 0.02,
    },
  },
  {
    key: 'task-demand',
    label: '任务需求',
    keywords: ['任务需求', '火力打击', '机降突击', '空中突击', '伴随夺控', '侦察预警', '压制', '掩护', '警戒'],
    weightAdjustments: {
      firepower: 0.02,
      reconCoverage: 0.02,
      mobility: 0.02,
    },
  },
  {
    key: 'firepower',
    label: '火力偏重',
    keywords: ['火力', '导弹', '炮兵', '歼击', '压制', '打击', '装甲', '主战', '远程'],
    weightAdjustments: {
      firepower: 0.06,
      balance: 0.01,
    },
  },
  {
    key: 'protection',
    label: '防护偏重',
    keywords: ['防空', '掩护', '护卫', '拦截', '防护', '警戒', '拒止'],
    weightAdjustments: {
      protection: 0.05,
      endurance: 0.01,
    },
  },
  {
    key: 'reconCoverage',
    label: '侦察预警偏重',
    keywords: ['侦察', '预警', '无人', '监视', '巡察', '雷达', '引导'],
    weightAdjustments: {
      reconCoverage: 0.05,
    },
  },
  {
    key: 'endurance',
    label: '持续保障偏重',
    keywords: ['保障', '补给', '维修', '医疗', '通信', '联勤', '持续', '后勤'],
    weightAdjustments: {
      endurance: 0.05,
      balance: 0.01,
    },
  },
  {
    key: 'mobility',
    label: '机动突击偏重',
    keywords: ['机动', '突击', '机降', '运输', '直升机', '两栖', '投送', '空中'],
    weightAdjustments: {
      firepower: 0.01,
      mobility: 0.06,
    },
  },
];

const GROUPING_DOCUMENT_FORCE_DEFINITIONS = [
  {
    role: 'strike',
    category: '文档推断火力单元',
    roleLabel: '火力打击',
    nameSuffix: '火力分队',
    keywords: ['火力', '导弹', '炮兵', '歼击', '压制', '打击', '装甲', '主战', '突击'],
  },
  {
    role: 'cover',
    category: '文档推断掩护单元',
    roleLabel: '掩护防护',
    nameSuffix: '掩护分队',
    keywords: ['防空', '掩护', '护卫', '拦截', '警戒', '电子', '干扰'],
  },
  {
    role: 'recon',
    category: '文档推断侦察单元',
    roleLabel: '前沿侦察',
    nameSuffix: '侦察分队',
    keywords: ['侦察', '预警', '无人', '监视', '巡察', '雷达', '引导'],
  },
  {
    role: 'sustain',
    category: '文档推断保障单元',
    roleLabel: '持续保障',
    nameSuffix: '保障分队',
    keywords: ['保障', '补给', '维修', '医疗', '通信', '后勤', '联勤'],
  },
  {
    role: 'support',
    category: '文档推断机动单元',
    roleLabel: '机动投送',
    nameSuffix: '机动分队',
    keywords: ['机动', '运输', '机降', '空中突击', '直升机', '两栖', '投送'],
  },
];

const GROUPING_BUCKET_BLUEPRINTS = {
  'fire-strike-rules': {
    3: [
      {
        id: 'main-strike',
        name: '主攻火力群',
        role: '负责主攻方向高价值目标压制',
        preferredRoles: ['strike'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.42,
          protection: 0.18,
          reconCoverage: 0.12,
          endurance: 0.12,
          mobility: 0.16,
        },
      },
      {
        id: 'recon-cover',
        name: '侦察掩护群',
        role: '负责前沿侦察、预警引导和防空掩护',
        preferredRoles: ['recon', 'cover'],
        supportRoles: ['support'],
        targetMix: {
          firepower: 0.08,
          protection: 0.27,
          reconCoverage: 0.37,
          endurance: 0.12,
          mobility: 0.16,
        },
      },
      {
        id: 'sustain-command',
        name: '保障协同群',
        role: '负责通信指挥、补给维修和持续协同',
        preferredRoles: ['sustain'],
        supportRoles: ['support', 'cover'],
        targetMix: {
          firepower: 0.06,
          protection: 0.18,
          reconCoverage: 0.12,
          endurance: 0.46,
          mobility: 0.18,
        },
      },
    ],
    4: [
      {
        id: 'main-strike',
        name: '主攻火力群',
        role: '负责主攻方向高价值目标压制',
        preferredRoles: ['strike'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.45,
          protection: 0.16,
          reconCoverage: 0.11,
          endurance: 0.1,
          mobility: 0.18,
        },
      },
      {
        id: 'fire-cover',
        name: '火力掩护群',
        role: '负责伴随压制、防空掩护和电子支援',
        preferredRoles: ['cover', 'strike'],
        supportRoles: ['support'],
        targetMix: {
          firepower: 0.28,
          protection: 0.26,
          reconCoverage: 0.12,
          endurance: 0.14,
          mobility: 0.2,
        },
      },
      {
        id: 'recon-warning',
        name: '侦察预警群',
        role: '负责前沿侦察、态势更新和打击引导',
        preferredRoles: ['recon'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.08,
          protection: 0.18,
          reconCoverage: 0.44,
          endurance: 0.12,
          mobility: 0.18,
        },
      },
      {
        id: 'sustain-command',
        name: '保障协同群',
        role: '负责通信指挥、补给维修和持续协同',
        preferredRoles: ['sustain'],
        supportRoles: ['support', 'cover'],
        targetMix: {
          firepower: 0.06,
          protection: 0.16,
          reconCoverage: 0.12,
          endurance: 0.48,
          mobility: 0.18,
        },
      },
    ],
    5: [
      {
        id: 'main-strike',
        name: '主攻火力群',
        role: '负责主攻方向集中压制与突击',
        preferredRoles: ['strike'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.46,
          protection: 0.16,
          reconCoverage: 0.1,
          endurance: 0.1,
          mobility: 0.18,
        },
      },
      {
        id: 'fire-support',
        name: '纵深火力群',
        role: '负责纵深火力打击和火力补位',
        preferredRoles: ['strike'],
        supportRoles: ['support'],
        targetMix: {
          firepower: 0.4,
          protection: 0.14,
          reconCoverage: 0.12,
          endurance: 0.12,
          mobility: 0.22,
        },
      },
      {
        id: 'air-cover',
        name: '掩护防护群',
        role: '负责区域防空、电子支援和护航',
        preferredRoles: ['cover'],
        supportRoles: ['strike', 'sustain'],
        targetMix: {
          firepower: 0.12,
          protection: 0.42,
          reconCoverage: 0.16,
          endurance: 0.16,
          mobility: 0.14,
        },
      },
      {
        id: 'recon-warning',
        name: '侦察预警群',
        role: '负责侦察预警和打击引导',
        preferredRoles: ['recon'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.08,
          protection: 0.18,
          reconCoverage: 0.46,
          endurance: 0.1,
          mobility: 0.18,
        },
      },
      {
        id: 'sustain-command',
        name: '保障协同群',
        role: '负责通信指挥、补给维修和持续协同',
        preferredRoles: ['sustain'],
        supportRoles: ['support', 'cover'],
        targetMix: {
          firepower: 0.06,
          protection: 0.16,
          reconCoverage: 0.1,
          endurance: 0.5,
          mobility: 0.18,
        },
      },
    ],
    6: [
      {
        id: 'main-strike',
        name: '主攻火力群',
        role: '负责主攻方向集中压制与突击',
        preferredRoles: ['strike'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.48,
          protection: 0.15,
          reconCoverage: 0.09,
          endurance: 0.1,
          mobility: 0.18,
        },
      },
      {
        id: 'fire-support',
        name: '纵深火力群',
        role: '负责纵深火力打击和火力补位',
        preferredRoles: ['strike'],
        supportRoles: ['support'],
        targetMix: {
          firepower: 0.42,
          protection: 0.14,
          reconCoverage: 0.1,
          endurance: 0.12,
          mobility: 0.22,
        },
      },
      {
        id: 'maneuver-reserve',
        name: '机动预备群',
        role: '负责机动补位、突击接续和预备处置',
        preferredRoles: ['support', 'strike'],
        supportRoles: ['sustain'],
        targetMix: {
          firepower: 0.24,
          protection: 0.16,
          reconCoverage: 0.12,
          endurance: 0.16,
          mobility: 0.32,
        },
      },
      {
        id: 'air-cover',
        name: '掩护防护群',
        role: '负责区域防空、电子支援和护航',
        preferredRoles: ['cover'],
        supportRoles: ['strike', 'sustain'],
        targetMix: {
          firepower: 0.12,
          protection: 0.44,
          reconCoverage: 0.16,
          endurance: 0.14,
          mobility: 0.14,
        },
      },
      {
        id: 'recon-warning',
        name: '侦察预警群',
        role: '负责侦察预警和打击引导',
        preferredRoles: ['recon'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.08,
          protection: 0.16,
          reconCoverage: 0.48,
          endurance: 0.1,
          mobility: 0.18,
        },
      },
      {
        id: 'sustain-command',
        name: '保障协同群',
        role: '负责通信指挥、补给维修和持续协同',
        preferredRoles: ['sustain'],
        supportRoles: ['support', 'cover'],
        targetMix: {
          firepower: 0.06,
          protection: 0.16,
          reconCoverage: 0.1,
          endurance: 0.5,
          mobility: 0.18,
        },
      },
    ],
  },
  'air-assault-rules': {
    3: [
      {
        id: 'air-assault',
        name: '空中突击群',
        role: '负责主突方向机降投送和快速夺控',
        preferredRoles: ['strike', 'support'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.24,
          protection: 0.18,
          reconCoverage: 0.12,
          endurance: 0.12,
          mobility: 0.34,
        },
      },
      {
        id: 'recon-guide',
        name: '侦察引导群',
        role: '负责前出侦察、空地引导和预警',
        preferredRoles: ['recon'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.08,
          protection: 0.16,
          reconCoverage: 0.48,
          endurance: 0.12,
          mobility: 0.16,
        },
      },
      {
        id: 'sustain-escort',
        name: '保障护航群',
        role: '负责补给续航、通信指挥和航路护航',
        preferredRoles: ['sustain', 'cover'],
        supportRoles: ['support'],
        targetMix: {
          firepower: 0.08,
          protection: 0.28,
          reconCoverage: 0.1,
          endurance: 0.34,
          mobility: 0.2,
        },
      },
    ],
    4: [
      {
        id: 'air-assault',
        name: '空中突击群',
        role: '负责主突方向机降投送和快速夺控',
        preferredRoles: ['strike', 'support'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.24,
          protection: 0.18,
          reconCoverage: 0.12,
          endurance: 0.1,
          mobility: 0.36,
        },
      },
      {
        id: 'escort-cover',
        name: '护航掩护群',
        role: '负责低空护航、防空拦截和火力掩护',
        preferredRoles: ['cover'],
        supportRoles: ['strike'],
        targetMix: {
          firepower: 0.18,
          protection: 0.34,
          reconCoverage: 0.12,
          endurance: 0.12,
          mobility: 0.24,
        },
      },
      {
        id: 'recon-guide',
        name: '侦察引导群',
        role: '负责前出侦察、空地引导和预警',
        preferredRoles: ['recon'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.08,
          protection: 0.16,
          reconCoverage: 0.48,
          endurance: 0.1,
          mobility: 0.18,
        },
      },
      {
        id: 'sustain-command',
        name: '保障指挥群',
        role: '负责补给续航、通信指挥和应急保障',
        preferredRoles: ['sustain'],
        supportRoles: ['support', 'cover'],
        targetMix: {
          firepower: 0.06,
          protection: 0.18,
          reconCoverage: 0.1,
          endurance: 0.46,
          mobility: 0.2,
        },
      },
    ],
    5: [
      {
        id: 'air-assault',
        name: '空中突击群',
        role: '负责主突方向机降投送和快速夺控',
        preferredRoles: ['strike', 'support'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.25,
          protection: 0.17,
          reconCoverage: 0.1,
          endurance: 0.1,
          mobility: 0.38,
        },
      },
      {
        id: 'fire-cover',
        name: '火力压制群',
        role: '负责突击前火力压制和火力补位',
        preferredRoles: ['strike'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.34,
          protection: 0.2,
          reconCoverage: 0.12,
          endurance: 0.1,
          mobility: 0.24,
        },
      },
      {
        id: 'escort-cover',
        name: '护航掩护群',
        role: '负责低空护航、防空拦截和掩护',
        preferredRoles: ['cover'],
        supportRoles: ['support'],
        targetMix: {
          firepower: 0.16,
          protection: 0.36,
          reconCoverage: 0.12,
          endurance: 0.12,
          mobility: 0.24,
        },
      },
      {
        id: 'recon-guide',
        name: '侦察引导群',
        role: '负责前出侦察、空地引导和预警',
        preferredRoles: ['recon'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.08,
          protection: 0.16,
          reconCoverage: 0.48,
          endurance: 0.1,
          mobility: 0.18,
        },
      },
      {
        id: 'sustain-command',
        name: '保障指挥群',
        role: '负责补给续航、通信指挥和应急保障',
        preferredRoles: ['sustain'],
        supportRoles: ['support', 'cover'],
        targetMix: {
          firepower: 0.06,
          protection: 0.18,
          reconCoverage: 0.1,
          endurance: 0.46,
          mobility: 0.2,
        },
      },
    ],
    6: [
      {
        id: 'air-assault',
        name: '空中突击群',
        role: '负责主突方向机降投送和快速夺控',
        preferredRoles: ['strike', 'support'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.24,
          protection: 0.16,
          reconCoverage: 0.1,
          endurance: 0.1,
          mobility: 0.4,
        },
      },
      {
        id: 'fire-cover',
        name: '火力压制群',
        role: '负责突击前火力压制和火力补位',
        preferredRoles: ['strike'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.36,
          protection: 0.2,
          reconCoverage: 0.1,
          endurance: 0.1,
          mobility: 0.24,
        },
      },
      {
        id: 'escort-cover',
        name: '护航掩护群',
        role: '负责低空护航、防空拦截和电子掩护',
        preferredRoles: ['cover'],
        supportRoles: ['support'],
        targetMix: {
          firepower: 0.14,
          protection: 0.38,
          reconCoverage: 0.12,
          endurance: 0.12,
          mobility: 0.24,
        },
      },
      {
        id: 'recon-guide',
        name: '侦察引导群',
        role: '负责前出侦察、空地引导和预警',
        preferredRoles: ['recon'],
        supportRoles: ['cover'],
        targetMix: {
          firepower: 0.08,
          protection: 0.16,
          reconCoverage: 0.48,
          endurance: 0.1,
          mobility: 0.18,
        },
      },
      {
        id: 'sustain-command',
        name: '保障指挥群',
        role: '负责补给续航、通信指挥和应急保障',
        preferredRoles: ['sustain'],
        supportRoles: ['support', 'cover'],
        targetMix: {
          firepower: 0.06,
          protection: 0.18,
          reconCoverage: 0.1,
          endurance: 0.46,
          mobility: 0.2,
        },
      },
      {
        id: 'reserve-blocking',
        name: '机动预备群',
        role: '负责快速补位、封控阻断和预备处置',
        preferredRoles: ['support', 'strike'],
        supportRoles: ['sustain'],
        targetMix: {
          firepower: 0.2,
          protection: 0.16,
          reconCoverage: 0.12,
          endurance: 0.16,
          mobility: 0.36,
        },
      },
    ],
  },
};

const THREAT_INTENT_DEFINITIONS = [
  {
    key: 'fire-strike-preparation',
    name: '火力准备与压制',
    keywords: ['火力', '炮兵', '压制', '打击', '导弹', '远程'],
    description: '敌方具备先实施火力准备、压制重点目标的意图。',
    emphasis: 'coverage',
  },
  {
    key: 'maneuver-concentration',
    name: '机动集结与突击',
    keywords: ['机动', '集结', '突击', '装载', '运载', '装甲'],
    description: '敌方更可能通过机动集结形成主攻突击方向。',
    emphasis: 'maneuver',
  },
  {
    key: 'air-defense-cover',
    name: '防空护航与区域拒止',
    keywords: ['防空', '警戒', '拦截', '雷达', '预警'],
    description: '敌方正在构建分层防空与低空拒止链路。',
    emphasis: 'coverage',
  },
  {
    key: 'recon-warning',
    name: '侦察预警与态势感知',
    keywords: ['侦察', '监测', '预警', '无人', '监视', '探测'],
    description: '敌方正通过侦察预警网络提升态势感知与前置发现能力。',
    emphasis: 'information',
  },
  {
    key: 'anti-airborne-protection',
    name: '反机降与要点防护',
    keywords: ['反机降', '阻滞', '封控', '障碍', '低空', '工兵'],
    description: '敌方可能在重点方向设置反机降阻滞设施和防护节点。',
    emphasis: 'protection',
  },
];

const ANALYSIS_FOCUS_PROFILES = {
  comprehensive: {
    fireCoverage: 1,
    airDefenseSystem: 1,
    reconEarlyWarning: 1,
    antiAirborneFacilities: 1,
    deploymentSectors: 1,
  },
  coverage: {
    fireCoverage: 1.24,
    airDefenseSystem: 1.14,
    reconEarlyWarning: 0.94,
    antiAirborneFacilities: 1.04,
    deploymentSectors: 1.08,
  },
  'air-defense': {
    fireCoverage: 0.98,
    airDefenseSystem: 1.3,
    reconEarlyWarning: 1.12,
    antiAirborneFacilities: 0.96,
    deploymentSectors: 1.02,
  },
};

const HEATMAP_DENSITY_PROFILES = {
  low: {
    layerScales: [0.94, 0.7],
    layerAlphas: [0.16, 0.09],
    maxHeatRegions: 2,
    spreadScale: 0.84,
  },
  medium: {
    layerScales: [1, 0.82, 0.64],
    layerAlphas: [0.24, 0.15, 0.09],
    maxHeatRegions: 3,
    spreadScale: 1,
  },
  high: {
    layerScales: [1.06, 0.9, 0.74, 0.58],
    layerAlphas: [0.3, 0.2, 0.12, 0.07],
    maxHeatRegions: 4,
    spreadScale: 1.18,
  },
};

const IMPACT_BIAS_PROFILES = {
  balanced: {
    fireweight: 1,
    mobilityWeight: 1,
    antiAirborneWeight: 1,
    narrative: '保持火力压制、低空规避与机动渗透之间的平衡。',
  },
  suppression: {
    fireweight: 1.22,
    mobilityWeight: 0.9,
    antiAirborneWeight: 1.08,
    narrative: '优先压制敌火力与防空链路，为后续突击打开窗口。',
  },
  mobility: {
    fireweight: 0.94,
    mobilityWeight: 1.24,
    antiAirborneWeight: 1.14,
    narrative: '优先关注低空渗透暴露与机动走廊安全性。',
  },
};

const THREAT_TEXT_NODE_DEFINITIONS = {
  fireCoverage: {
    keywords: ['火力', '炮兵', '压制', '打击', '导弹', '火箭', '远程', '射击', '齐射'],
    titleSuffix: '火力压制群',
    evidenceLabel: '文档推断火力覆盖',
    metricField: 'threatValue',
  },
  airDefenseSystem: {
    keywords: ['防空', '拦截', '警戒', '雷达', '预警', '防空导弹', '对空'],
    titleSuffix: '防空节点',
    evidenceLabel: '文档推断防空体系',
    metricField: 'strength',
  },
  reconEarlyWarning: {
    keywords: ['侦察', '监测', '预警', '无人', '监视', '探测', '预警机', '观察'],
    titleSuffix: '侦察预警节点',
    evidenceLabel: '文档推断侦察预警',
    metricField: 'confidence',
  },
  antiAirborneFacilities: {
    keywords: ['反机降', '阻滞', '封控', '障碍', '低空', '工兵', '拒止', '雷场'],
    titleSuffix: '反机降设施',
    evidenceLabel: '文档推断反机降设施',
    metricField: 'confidence',
  },
};

const DEPLOYMENT_DIRECTION_DEFINITIONS = [
  { key: 'east', label: '东向', keywords: ['东向', '东线', '东侧'], offset: [0.18, 0.02] },
  { key: 'west', label: '西向', keywords: ['西向', '西线', '西侧'], offset: [-0.18, 0.02] },
  { key: 'north', label: '北向', keywords: ['北向', '北线', '北侧', '东北'], offset: [0.02, 0.16] },
  { key: 'south', label: '南向', keywords: ['南向', '南线', '南侧', '东南'], offset: [0.02, -0.16] },
  { key: 'center', label: '中部', keywords: ['中部', '中央', '纵深', '核心', '主阵地'], offset: [0, 0.04] },
  { key: 'corridor', label: '通道', keywords: ['走廊', '通道', '谷地', '低空通道', '轴线'], offset: [0.12, -0.1] },
];

const PLANNING_EXTERNAL_ALGORITHM_PROJECTS = [
  {
    key: 'enemy-threat-analysis-local',
    type: 'external-model',
    runtime: 'python-local',
    executionMode: 'local-python',
    packageName: 'enemy_threat_analysis',
    cliModule: 'enemy_threat_analysis.cli',
    projectName: '基于大模型分析算法',
    projectPath: 'algorithms/enemy-threat-analysis',
    description: '调用 algorithms/enemy-threat-analysis 本地 Python CLI，融合资源库、上传材料和大模型抽取结果输出敌情威胁分析。',
    version: '0.1.0',
    defaultStatus: 'active',
    legacyKeys: ['enemy-threat-analysis-python', 'local-enemy-threat-analysis'],
    supportedAlgorithmIds: ['enemy-threat-analysis'],
    projectAlgorithms: [{ id: 'enemy-threat-analysis', name: '敌情威胁自动分析' }],
    parameterSchema: [
      {
        key: 'analysisFocus',
        label: '分析重点',
        type: 'select',
        defaultValue: 'comprehensive',
        options: [
          { value: 'comprehensive', label: '综合态势' },
          { value: 'air-defense', label: '防空体系' },
          { value: 'firepower', label: '火力覆盖' },
          { value: 'anti-airborne', label: '反机降' },
        ],
      },
      {
        key: 'heatmapDensity',
        label: '热力图密度',
        type: 'select',
        defaultValue: 'medium',
        options: [
          { value: 'low', label: '低' },
          { value: 'medium', label: '中' },
          { value: 'high', label: '高' },
        ],
      },
      {
        key: 'impactBias',
        label: '影响偏置',
        type: 'select',
        defaultValue: 'balanced',
        options: [
          { value: 'balanced', label: '均衡' },
          { value: 'firepower', label: '火力优先' },
          { value: 'mobility', label: '机动优先' },
        ],
      },
      { key: 'skipAssessment', label: '跳过评估报告', type: 'boolean', defaultValue: false },
      {
        key: 'llmBackend',
        label: '大模型接口',
        type: 'select',
        section: 'llm',
        defaultValue: 'openai-compatible',
        options: [
          { value: 'openai-compatible', label: '外部 OpenAI 兼容 API' },
          { value: 'ollama', label: '本地 Ollama（自动连接）' },
        ],
      },
      { key: 'llmApiKey', label: '外部 API Key', type: 'password', section: 'llm', defaultValue: '' },
      { key: 'llmBaseUrl', label: '外部 API Base URL', type: 'text', section: 'llm', defaultValue: '' },
      { key: 'llmModel', label: '模型名称', type: 'text', section: 'llm', defaultValue: '' },
      { key: 'llmTimeout', label: '超时秒数', type: 'number', section: 'llm', defaultValue: 120, min: 10, max: 900 },
      { key: 'llmStream', label: '流式输出', type: 'boolean', section: 'llm', defaultValue: true },
    ],
    defaultOptions: {
      analysisFocus: 'comprehensive',
      heatmapDensity: 'medium',
      impactBias: 'balanced',
      skipAssessment: false,
      llmBackend: 'openai-compatible',
      llmApiKey: '',
      llmBaseUrl: '',
      ollamaHost: 'http://localhost:11434',
      llmModel: '',
      llmTimeout: 120,
      llmStream: true,
    },
  },
  {
    key: 'force-grouping-local',
    type: 'external-model',
    runtime: 'python-local',
    executionMode: 'local-python',
    packageName: 'force_grouping',
    cliModule: 'force_grouping.cli',
    projectName: '智能编组算法',
    projectPath: 'algorithms/force-grouping',
    description: '调用 algorithms/force-grouping 本地 Python CLI，在内置编组算法之外提供大模型辅助的作战力量智能编组实现。',
    version: '0.1.0',
    defaultStatus: 'active',
    legacyKeys: ['force-grouping-python', 'local-force-grouping'],
    supportedAlgorithmIds: ['force-grouping'],
    projectAlgorithms: [{ id: 'force-grouping', name: '作战力量智能编组' }],
    parameterSchema: [
      { key: 'schemeProfileKey', label: '方案画像', type: 'text', defaultValue: 'balanced' },
      { key: 'ruleLibraryKey', label: '规则库', type: 'text', defaultValue: 'fire-strike-rules' },
      {
        key: 'comparisonFocus',
        label: '比选重点',
        type: 'select',
        defaultValue: 'balanced',
        options: [
          { value: 'balanced', label: '均衡' },
          { value: 'firepower', label: '火力优先' },
          { value: 'mobility', label: '机动优先' },
          { value: 'survivability', label: '生存优先' },
        ],
      },
      { key: 'expectedGroupCount', label: '期望编组数量', type: 'number', defaultValue: 4, min: 1, max: 12 },
      { key: 'useLlmExplanation', label: '启用大模型解释', type: 'boolean', defaultValue: true },
      {
        key: 'llmBackend',
        label: '大模型接口',
        type: 'select',
        section: 'llm',
        defaultValue: 'openai-compatible',
        options: [
          { value: 'openai-compatible', label: '外部 OpenAI 兼容 API' },
          { value: 'ollama', label: '本地 Ollama（自动连接）' },
        ],
      },
      { key: 'llmApiKey', label: '外部 API Key', type: 'password', section: 'llm', defaultValue: '' },
      { key: 'llmBaseUrl', label: '外部 API Base URL', type: 'text', section: 'llm', defaultValue: '' },
      { key: 'llmModel', label: '模型名称', type: 'text', section: 'llm', defaultValue: '' },
      { key: 'llmTimeout', label: '超时秒数', type: 'number', section: 'llm', defaultValue: 120, min: 10, max: 900 },
      { key: 'llmStream', label: '流式输出', type: 'boolean', section: 'llm', defaultValue: true },
    ],
    defaultOptions: {
      schemeProfileKey: 'balanced',
      ruleLibraryKey: 'fire-strike-rules',
      comparisonFocus: 'balanced',
      expectedGroupCount: 4,
      useLlmExplanation: true,
      llmBackend: 'openai-compatible',
      llmApiKey: '',
      llmBaseUrl: '',
      ollamaHost: 'http://localhost:11434',
      llmModel: '',
      llmTimeout: 120,
      llmStream: true,
    },
  },
  {
    key: 'airlanding-zone-local',
    type: 'external-model',
    runtime: 'python-local',
    executionMode: 'local-python',
    entrypoint: 'main.py',
    localAlgorithmKey: 'airlanding_zone',
    projectName: '机降地域优化选择 Python 算法',
    projectPath: 'algorithms/airlanding_zone',
    description: '调用 algorithms/airlanding_zone/main.py，从上游敌情、目标分配和本地 terrain 数据生成候选机降地域并映射为平台结果结构。',
    version: '0.1.0',
    defaultStatus: 'active',
    legacyKeys: ['airlanding-zone-python', 'local-airlanding-zone'],
    supportedAlgorithmIds: ['airborne-landing-site-selection'],
    projectAlgorithms: [{ id: 'airborne-landing-site-selection', name: '机降地域优化选择' }],
    parameterSchema: [
      { key: 'candidateCount', label: '候选地域数量', type: 'number', defaultValue: 5, min: 1, max: 20 },
      { key: 'terrainRoot', label: '地形数据目录', type: 'text', defaultValue: 'apps/web/public/terrain' },
    ],
    defaultOptions: {
      candidateCount: 5,
      terrainRoot: 'apps/web/public/terrain',
    },
  },
];

function buildRuntimeCatalog() {
  return buildStandardEngineCatalog({
    moduleKey: 'intelligent-task-planning',
    builtin: {
      key: 'builtin',
      type: 'builtin',
      runtime: 'node',
      version: String(process.env.PLANNING_BUILTIN_VERSION || '1.2.0'),
      label: '内置规划算法',
      description: '使用系统内置算法执行当前任务规划步骤。',
      legacyKeys: ['builtin'],
    },
    externals: PLANNING_EXTERNAL_ALGORITHM_PROJECTS.map((project) => ({
      key: project.key,
      type: 'external-model',
      runtime: project.runtime,
      endpointEnv: project.endpointEnv,
      versionEnv: project.versionEnv,
      timeoutEnv: project.timeoutEnv,
      defaultStatus: project.defaultStatus,
      executionMode: project.executionMode,
      packageName: project.packageName,
      cliModule: project.cliModule,
      entrypoint: project.entrypoint,
      localAlgorithmKey: project.localAlgorithmKey,
      version: project.version,
      label: project.projectName,
      activeDescription: project.executionMode === 'local-python'
        ? project.description
        : `已配置 ${project.projectPath} 外部算法工程，可通过统一规划网关执行。`,
      plannedDescription: project.executionMode === 'local-python'
        ? project.description
        : `${project.projectPath} 外部算法工程已登记，配置 ${project.endpointEnv} 后可接入执行。`,
      legacyKeys: project.legacyKeys,
      projectName: project.projectName,
      projectPath: project.projectPath,
      supportedAlgorithmIds: project.supportedAlgorithmIds,
      projectAlgorithms: project.projectAlgorithms,
      parameterSchema: project.parameterSchema,
      defaultOptions: project.defaultOptions,
      description: project.description,
    })),
  });
}

const ALGORITHM_DEFINITIONS = [
  {
    id: 'enemy-threat-analysis',
    name: '敌情威胁自动分析',
    category: '态势分析',
    description: '对敌情数据和上传文件进行融合分析，输出敌方作战企图、部署态势、火力覆盖、防空体系、侦察预警和反机降设施。',
    expectedInputs: ['敌情数据源', '敌方情报记录', '环境要素', '本地 Word/PDF/Excel 文件'],
    expectedOutputs: ['威胁模型', '敌情威胁等级评估', '作战影响分析', '三维球标注与热力图'],
    implementationStatus: 'implemented',
    supportedInputModes: ['resource-library', 'local-file'],
    supportedFileTypes: LOCAL_FILE_EXTENSIONS,
    builtinMethods: THREAT_METHODS,
    defaultConfig: {
      builtinMethodKey: 'knowledge-fusion',
      selectedSourceIds: [],
      uploadedFiles: [],
      options: {
        analysisFocus: 'comprehensive',
        heatmapDensity: 'medium',
        impactBias: 'balanced',
      },
    },
  },
  {
    id: 'force-grouping',
    name: '作战力量智能编组',
    category: '兵力编组',
    description: '结合我方情报、任务需求和威胁分析结果，基于规则推理或优化方法输出多套编组方案。',
    expectedInputs: ['我方情报数据源', '我方兵力记录', '威胁分析结果', '本地 Word/PDF/Excel 文件'],
    expectedOutputs: ['多套作战编组方案', '方案对比', '推荐结果解释'],
    implementationStatus: 'implemented',
    supportedInputModes: ['resource-library', 'local-file'],
    supportedFileTypes: LOCAL_FILE_EXTENSIONS,
    builtinMethods: GROUPING_METHODS,
    ruleLibraries: Object.values(GROUPING_RULE_LIBRARIES),
    constraintModels: Object.values(GROUPING_CONSTRAINT_MODELS),
    defaultConfig: {
      builtinMethodKey: 'hybrid-balanced',
      selectedSourceIds: [],
      uploadedFiles: [],
      options: {
        ruleLibraryKey: 'fire-strike-rules',
        constraintModelKey: 'baseline-constraints',
        comparisonFocus: 'balanced',
        expectedGroupCount: 4,
      },
    },
  },
  {
    id: 'target-allocation',
    name: '作战目标自动分配',
    category: '目标分配',
    description: '基于敌情威胁和兵力编组结果，输出多目标、多平台的分配方案、验证结果和调整建议。',
    expectedInputs: ['威胁分析结果', '作战编组方案', '平台能力评估'],
    expectedOutputs: ['目标分配方案', '多算法对比', '合理性验证', '调整建议'],
    implementationStatus: 'implemented',
    supportedInputModes: ['upstream-result'],
    supportedFileTypes: [],
    builtinMethods: TARGET_METHODS,
    defaultConfig: {
      builtinMethodKey: 'multi-objective',
      selectedSourceIds: [],
      uploadedFiles: [],
      options: {
        objectivePreference: 'balanced',
        validationMode: 'strict',
        maxAssignmentsPerGroup: 2,
      },
    },
  },
  {
    id: 'method-planning',
    name: '作战方法自动规划',
    category: '战法规划',
    description: '基于目标分配、机降选址、敌方威胁与我方编组结果，生成火力打击路径、机降突击路线和时序化作战方法方案。',
    expectedInputs: ['目标分配结果', '机降地域选择结果', '作战编组方案', '环境约束'],
    expectedOutputs: ['多算法路径规划方案', '时序化行动流程', '三维球作战路线'],
    implementationStatus: 'implemented',
    supportedInputModes: ['upstream-result'],
    supportedFileTypes: [],
    builtinMethods: METHOD_PLANNING_METHODS,
    defaultConfig: {
      builtinMethodKey: 'a-star',
      selectedSourceIds: [],
      uploadedFiles: [],
      options: {
        routePreference: 'balanced',
        altitudeProfile: 'terrain-following',
        phaseTempo: 'standard',
      },
    },
  },
  {
    id: 'support-planning',
    name: '作战保障自动规划',
    category: '保障规划',
    description: '基于作战方法、编组方案、结构化战损预测输入和保障资源池约束，自动生成保障需求、资源调度方案与能力匹配分析。',
    expectedInputs: ['作战方法方案', '作战编组方案', '战损预测输入', '保障资源池'],
    expectedOutputs: ['保障需求清单', '资源调度分配', '保障匹配分析与空域窗口'],
    implementationStatus: 'implemented',
    supportedInputModes: ['upstream-result'],
    supportedFileTypes: [],
    builtinMethods: SUPPORT_METHODS,
    defaultConfig: {
      builtinMethodKey: 'demand-driven',
      selectedSourceIds: [],
      uploadedFiles: [],
      options: createDefaultSupportOptions(),
    },
  },
  {
    id: 'airborne-landing-site-selection',
    name: '机降地域优化选择',
    category: '机降选址',
    description: '基于地形、敌方威胁分布、目标分配和直升机性能推导机降地域候选点，完成多目标评分、排序与三维展示。',
    expectedInputs: ['敌情威胁结果', '目标分配结果', '环境要素', '直升机性能偏好'],
    expectedOutputs: ['候选机降点排序', '机降地域评分', '地图标注与联动分析'],
    implementationStatus: 'implemented',
    supportedInputModes: ['upstream-result'],
    supportedFileTypes: [],
    builtinMethods: LANDING_SITE_METHODS,
    defaultConfig: {
      builtinMethodKey: 'weighted-score',
      selectedSourceIds: [],
      uploadedFiles: [],
      options: {
        sitePreference: 'balanced',
        helicopterModel: 'medium-lift',
        candidateCount: 5,
      },
    },
  },
];

function supportsRuntimeAlgorithm(runtime = {}, algorithmId = '') {
  if (runtime.key === 'builtin') return true;
  const supportedIds = safeArray(runtime.supportedAlgorithmIds);
  return !supportedIds.length || supportedIds.includes(algorithmId);
}

function resolveRuntimeParameterSchema(runtime = {}, algorithmId = '') {
  const profile = safeObject(safeObject(runtime.algorithmProfiles)[algorithmId]);
  return safeArray(profile.parameterSchema).length ? profile.parameterSchema : safeArray(runtime.parameterSchema);
}

function resolveRuntimeDefaultOptions(runtime = {}, algorithmId = '') {
  const profile = safeObject(safeObject(runtime.algorithmProfiles)[algorithmId]);
  return {
    ...safeObject(runtime.defaultOptions),
    ...safeObject(profile.defaultOptions),
  };
}

function buildAlgorithmVariants(algorithmId, runtimes, implementationStatus) {
  return safeArray(runtimes).filter((runtime) => supportsRuntimeAlgorithm(runtime, algorithmId)).map((runtime) => ({
    id: `${algorithmId}:${runtime.key}`,
    runtimeKey: runtime.key,
    type: runtime.type,
    source: runtime.source,
    runtime: runtime.runtime,
    version: runtime.version,
    contractVersion: runtime.contractVersion,
    timeoutMs: Number(runtime.timeoutMs || 0),
    name: runtime.key === 'builtin' ? '内置算法执行器' : runtime.projectName || runtime.label,
    description: runtime.key === 'builtin'
      ? implementationStatus === 'implemented'
        ? '使用内置算法方法执行当前规划节点。'
        : '当前为占位执行器，等待下一轮详细要求后替换。'
      : runtime.description,
    status: runtime.key === 'builtin' ? 'active' : runtime.status,
    endpoint: runtime.endpoint || '',
    projectName: runtime.projectName || '',
    projectPath: runtime.projectPath || '',
    executionMode: runtime.executionMode || '',
    packageName: runtime.packageName || '',
    cliModule: runtime.cliModule || '',
    entrypoint: runtime.entrypoint || '',
    localAlgorithmKey: runtime.localAlgorithmKey || '',
    projectAlgorithms: cloneData(runtime.projectAlgorithms || []),
    parameterSchema: cloneData(resolveRuntimeParameterSchema(runtime, algorithmId)),
    defaultOptions: cloneData(resolveRuntimeDefaultOptions(runtime, algorithmId)),
    inputContract: cloneData(runtime.inputContract || []),
    outputContract: cloneData(runtime.outputContract || []),
    legacyKeys: safeArray(runtime.legacyKeys).map((alias) => `${algorithmId}:${alias}`),
  }));
}

function buildAlgorithmLibrary(runtimes) {
  return ALGORITHM_DEFINITIONS.map((item) => ({
    ...cloneData(item),
    interfaceStatus: item.implementationStatus === 'implemented' ? 'defined' : 'pending-definition',
    defaultVariantId: `${item.id}:builtin`,
    variants: buildAlgorithmVariants(item.id, runtimes, item.implementationStatus),
  }));
}

function resolveDefaultPlanningVariantId(algorithmId = '', runtimes = []) {
  return `${algorithmId}:builtin`;
}

function buildFireStrikeTask(runtimes = []) {
  const steps = [
    {
      id: 'step-threat-analysis',
      order: 1,
      name: '敌情威胁自动分析',
      algorithmId: 'enemy-threat-analysis',
      objective: '融合敌情、环境和上传材料，识别关键威胁、覆盖圈和重点方向。',
      consumes: ['敌情数据源', '敌方情报记录', '环境要素', '本地文件'],
      produces: ['威胁模型', '威胁等级评估', '作战影响分析'],
    },
    {
      id: 'step-force-grouping',
      order: 2,
      name: '作战力量智能编组',
      algorithmId: 'force-grouping',
      objective: '根据威胁分析和我方兵力信息生成多套编组方案并推荐。',
      consumes: ['我方情报数据源', '我方兵力记录', '威胁分析结果', '本地文件'],
      produces: ['作战编组方案', '方案对比', '推荐解释'],
    },
    {
      id: 'step-target-allocation',
      order: 3,
      name: '作战目标自动分配',
      algorithmId: 'target-allocation',
      objective: '结合威胁和编组结果，对重点目标进行智能匹配分配。',
      consumes: ['威胁分析结果', '作战编组方案', '平台能力评估'],
      produces: ['目标分配结果', '合理性验证', '调整建议'],
    },
    {
      id: 'step-method-planning',
      order: 4,
      name: '作战方法自动规划',
      algorithmId: 'method-planning',
      objective: '结合目标分配、威胁约束与地形气象因素，输出火力打击路径和时序化作战方法。',
      consumes: ['目标分配结果', '任务约束', '威胁与环境约束'],
      produces: ['作战方法方案', '阶段流程', '关键行动安排', '三维球作战路线'],
    },
    {
      id: 'step-support-planning',
      order: 5,
      name: '作战保障自动规划',
      algorithmId: 'support-planning',
      objective: '根据作战方法、编组方案、结构化战损预测输入和保障资源池自动生成保障需求与约束调度分配。',
      consumes: ['作战方法方案', '作战编组方案', '战损预测输入', '保障资源池'],
      produces: ['保障计划', '保障资源清单', '风险补充建议', '保障匹配分析'],
    },
  ];

  return {
    id: 'fire-strike-task',
    name: '火力打击任务',
    category: '火力打击',
    description: '按敌情威胁分析、力量编组、目标分配、作战方法规划和保障规划五个阶段执行完整任务流程。',
    initialInputs: ['敌情数据', '我方兵力数据', '环境数据', '保障资源数据'],
    finalDeliverables: ['火力打击任务规划方案', '阶段产物汇总', '执行与保障建议'],
    steps,
    defaultBindings: Object.fromEntries(steps.map((step) => [step.id, resolveDefaultPlanningVariantId(step.algorithmId, runtimes)])),
  };
}

function buildAirAssaultTask(runtimes = []) {
  const steps = [
    {
      id: 'step-threat-analysis',
      order: 1,
      name: '敌情威胁自动分析',
      algorithmId: 'enemy-threat-analysis',
      objective: '识别敌防空、侦察预警、反机降设施和低空走廊威胁。',
      consumes: ['敌情数据源', '敌方情报记录', '环境要素', '本地文件'],
      produces: ['威胁模型', '威胁等级评估', '低空渗透威胁分析'],
    },
    {
      id: 'step-force-grouping',
      order: 2,
      name: '作战力量智能编组',
      algorithmId: 'force-grouping',
      objective: '围绕机降突击、掩护压制、侦察引导和保障协同生成编组方案。',
      consumes: ['我方情报数据源', '我方兵力记录', '威胁分析结果', '本地文件'],
      produces: ['机降编组方案', '方案对比', '推荐解释'],
    },
    {
      id: 'step-target-allocation',
      order: 3,
      name: '作战目标自动分配',
      algorithmId: 'target-allocation',
      objective: '明确压制目标、掩护目标与突击目标，为机降路径和地域选址提供目标锚点。',
      consumes: ['威胁分析结果', '作战编组方案', '平台能力评估'],
      produces: ['目标分配结果', '合理性验证', '压制与突击序列'],
    },
    {
      id: 'step-airborne-landing-site-selection',
      order: 4,
      name: '机降地域优化选择',
      algorithmId: 'airborne-landing-site-selection',
      objective: '根据地形、威胁分布、目标锚点和直升机性能选择机降地域并完成评分排序。',
      consumes: ['威胁分析结果', '目标分配结果', '环境要素', '直升机性能偏好'],
      produces: ['候选机降点排序', '机降地域评分', '三维球地图标注'],
    },
    {
      id: 'step-method-planning',
      order: 5,
      name: '作战方法自动规划',
      algorithmId: 'method-planning',
      objective: '围绕机降地域、压制目标和威胁约束生成机降突击路线与行动时序。',
      consumes: ['目标分配结果', '机降地域选择结果', '威胁与环境约束'],
      produces: ['作战方法方案', '阶段流程', '机降突击路线'],
    },
    {
      id: 'step-support-planning',
      order: 6,
      name: '作战保障自动规划',
      algorithmId: 'support-planning',
      objective: '结合机降路径、编组方案、结构化战损预测输入和保障资源池生成保障资源约束调度与空域协同计划。',
      consumes: ['作战方法方案', '作战编组方案', '机降地域结果', '战损预测输入', '保障资源池'],
      produces: ['保障计划', '保障资源清单', '保障匹配分析', '空域协同窗口'],
    },
  ];

  return {
    id: 'air-assault-task',
    name: '机降突击任务',
    category: '机降突击',
    description: '围绕敌情分析、编组、目标分配、机降地域选择、战法规划和保障规划形成完整机降突击流程。',
    initialInputs: ['敌情数据', '我方兵力数据', '环境数据', '直升机与保障资源参数'],
    finalDeliverables: ['机降突击任务规划方案', '机降地域与航线汇总', '保障与空域协同建议'],
    steps,
    defaultBindings: Object.fromEntries(steps.map((step) => [step.id, resolveDefaultPlanningVariantId(step.algorithmId, runtimes)])),
  };
}

function buildTaskLibrary(runtimes = []) {
  return [buildFireStrikeTask(runtimes), buildAirAssaultTask(runtimes)];
}

function buildPlanningTemplate() {
  const runtimes = buildRuntimeCatalog();
  const algorithms = buildAlgorithmLibrary(runtimes);
  const tasks = buildTaskLibrary(runtimes);
  const variants = algorithms.flatMap((item) => safeArray(item.variants));

  return {
    version: '1.2.0',
    module: 'intelligent-task-planning',
    title: '智能任务规划模块',
    description: '围绕规划算法库和作战任务库组织智能任务规划流程，当前已完成敌情分析、编组、目标分配、机降选址、战法规划和保障规划的内置实现。',
    runtimes,
    algorithms,
    tasks,
    summary: {
      algorithmCount: algorithms.length,
      implementedAlgorithmCount: algorithms.filter((item) => item.implementationStatus === 'implemented').length,
      placeholderAlgorithmCount: algorithms.filter((item) => item.implementationStatus !== 'implemented').length,
      taskCount: tasks.length,
      stepCount: tasks.reduce((total, item) => total + safeArray(item.steps).length, 0),
      variantCount: variants.length,
      builtinVariantCount: variants.filter((item) => item.type === 'builtin').length,
      externalVariantCount: variants.filter((item) => item.type === 'external-model').length,
    },
  };
}

function buildAlgorithmMap(algorithms = []) {
  return new Map(safeArray(algorithms).map((item) => [item.id, item]));
}

function normalizeTaskDefinition(taskDefinition = {}, template) {
  const algorithmMap = buildAlgorithmMap(template.algorithms);
  const rawSteps = safeArray(taskDefinition.steps);
  if (!rawSteps.length) {
    const error = new Error('自定义任务模板至少需要包含一个规划步骤。');
    error.status = 400;
    throw error;
  }

  const steps = rawSteps.map((step, index) => {
    const algorithmId = String(step?.algorithmId || '').trim();
    const algorithm = algorithmMap.get(algorithmId);
    if (!algorithm) {
      const error = new Error(`自定义任务模板引用了不存在的算法 ${algorithmId || '未知算法'}。`);
      error.status = 400;
      throw error;
    }

    return {
      id: String(step?.id || `custom-step-${index + 1}`),
      order: index + 1,
      name: String(step?.name || algorithm.name),
      algorithmId,
      objective: String(step?.objective || algorithm.description || `${algorithm.name}执行步骤`),
      consumes: safeArray(step?.consumes).length ? cloneData(step.consumes) : cloneData(algorithm.expectedInputs || []),
      produces: safeArray(step?.produces).length ? cloneData(step.produces) : cloneData(algorithm.expectedOutputs || []),
    };
  });

  const name = String(taskDefinition.name || '自定义任务模板').trim() || '自定义任务模板';
  const finalDeliverables = uniqueList(
    safeArray(taskDefinition.finalDeliverables).length
      ? taskDefinition.finalDeliverables
      : [`${name}规划方案`, '阶段产物汇总'],
  );

  return {
    id: String(taskDefinition.id || `custom-task-${Date.now()}`),
    name,
    category: String(taskDefinition.category || '自定义任务').trim() || '自定义任务',
    description: String(taskDefinition.description || '由前端任务库创建的自定义任务模板。').trim(),
    initialInputs: uniqueList(
      safeArray(taskDefinition.initialInputs).length
        ? taskDefinition.initialInputs
        : steps.flatMap((step) => safeArray(step.consumes)),
    ),
    finalDeliverables,
    steps,
    defaultBindings: Object.fromEntries(
      steps.map((step) => [
        step.id,
        String(taskDefinition?.defaultBindings?.[step.id] || `${step.algorithmId}:builtin`),
      ]),
    ),
  };
}

function selectTask(template, taskId, taskDefinition) {
  if (taskDefinition) {
    return normalizeTaskDefinition(taskDefinition, template);
  }
  return template.tasks.find((item) => item.id === String(taskId || '')) || template.tasks[0] || null;
}

function resolveBindingVariant(step, algorithm, task, bindings = {}) {
  const requestedId = String(
    bindings?.[step.id]
    || task?.defaultBindings?.[step.id]
    || algorithm?.defaultVariantId
    || '',
  );
  const variants = safeArray(algorithm?.variants);
  return variants.find((item) => item.id === requestedId)
    || variants.find((item) => safeArray(item.legacyKeys).includes(requestedId))
    || variants[0]
    || null;
}

function loadPlanningDataset(db) {
  if (!db?.prepare) {
    return {
      sources: [],
      previewsBySourceId: new Map(),
      intelligence: [],
      environment: [],
      extractions: [],
    };
  }

  const sources = db.prepare('SELECT * FROM sources ORDER BY updated_at DESC, id DESC').all().map(mapSource);
  const previews = db.prepare('SELECT * FROM source_contents ORDER BY source_id').all().map(mapSourcePreview);
  const intelligence = db.prepare('SELECT * FROM intelligence ORDER BY updated_at DESC, id DESC').all().map(mapIntelligence);
  const environment = db.prepare('SELECT * FROM environment ORDER BY updated_at DESC, id DESC').all().map(mapEnvironment);
  const extractions = db.prepare("SELECT * FROM extractions ORDER BY CASE WHEN created_at = '' THEN 1 ELSE 0 END, created_at DESC, id DESC").all().map(mapExtraction);

  return {
    sources,
    previewsBySourceId: new Map(previews.map((item) => [Number(item.sourceId), item])),
    intelligence,
    environment,
    extractions,
  };
}

function buildInitialContext(task, payload = {}, algorithmInputs = {}, dataset = {}) {
  return {
    assessmentName: String(payload.assessmentName || `${task.name}规划任务`),
    taskId: task.id,
    taskName: task.name,
    stageOutputs: {},
    handoffTrail: [],
    algorithmInputs: cloneData(algorithmInputs),
    datasetSummary: {
      sourceCount: safeArray(dataset.sources).length,
      intelligenceCount: safeArray(dataset.intelligence).length,
      environmentCount: safeArray(dataset.environment).length,
      extractionCount: safeArray(dataset.extractions).length,
    },
  };
}

function normalizeSupportPlanningOptions(options = {}) {
  const defaults = createDefaultSupportOptions();
  const damageForecast = safeObject(options.damageForecast);
  const resourcePool = safeObject(options.resourcePool);
  const stock = safeObject(resourcePool.stock);
  const transport = safeObject(resourcePool.transport);

  return {
    reserveRatio: clamp(Number(options.reserveRatio ?? defaults.reserveRatio), 8, 35),
    airspaceControl: ['tight', 'standard', 'flexible'].includes(String(options.airspaceControl))
      ? String(options.airspaceControl)
      : defaults.airspaceControl,
    damageForecast: {
      source: String(damageForecast.source || defaults.damageForecast.source || 'manual-assessment').trim() || 'manual-assessment',
      equipmentLossRate: round(clamp(Number(damageForecast.equipmentLossRate ?? defaults.damageForecast.equipmentLossRate), 0, 60), 1),
      casualtyRate: round(clamp(Number(damageForecast.casualtyRate ?? defaults.damageForecast.casualtyRate), 0, 40), 1),
      damagedEquipmentCount: Math.max(0, Math.round(Number(damageForecast.damagedEquipmentCount ?? defaults.damageForecast.damagedEquipmentCount))),
      woundedCount: Math.max(0, Math.round(Number(damageForecast.woundedCount ?? defaults.damageForecast.woundedCount))),
      criticalWindowCount: clamp(Math.round(Number(damageForecast.criticalWindowCount ?? defaults.damageForecast.criticalWindowCount)), 1, 4),
    },
    resourcePool: {
      stock: {
        ammo: round(Math.max(0, Number(stock.ammo ?? defaults.resourcePool.stock.ammo)), 1),
        fuel: round(Math.max(0, Number(stock.fuel ?? defaults.resourcePool.stock.fuel)), 1),
        maintenance: round(Math.max(0, Number(stock.maintenance ?? defaults.resourcePool.stock.maintenance)), 1),
        medical: round(Math.max(0, Number(stock.medical ?? defaults.resourcePool.stock.medical)), 1),
        airspace: round(Math.max(0, Number(stock.airspace ?? defaults.resourcePool.stock.airspace)), 1),
        command: round(Math.max(0, Number(stock.command ?? defaults.resourcePool.stock.command)), 1),
      },
      transport: {
        sorties: Math.max(0, Math.round(Number(transport.sorties ?? defaults.resourcePool.transport.sorties))),
        liftTonnagePerSortie: round(Math.max(0, Number(transport.liftTonnagePerSortie ?? defaults.resourcePool.transport.liftTonnagePerSortie)), 1),
        maintenanceTeams: Math.max(0, Math.round(Number(transport.maintenanceTeams ?? defaults.resourcePool.transport.maintenanceTeams))),
        medicalTeams: Math.max(0, Math.round(Number(transport.medicalTeams ?? defaults.resourcePool.transport.medicalTeams))),
        airspaceCells: Math.max(0, Math.round(Number(transport.airspaceCells ?? defaults.resourcePool.transport.airspaceCells))),
        commandLinks: Math.max(0, Math.round(Number(transport.commandLinks ?? defaults.resourcePool.transport.commandLinks))),
      },
    },
  };
}

function normalizePlanningAlgorithmOptions(algorithmId = '', options = {}) {
  const runtimeOptions = safeObject(options.runtimeOptions);
  const normalizedRuntimeOptions = Object.fromEntries(
    PLANNING_EXTERNAL_ALGORITHM_PROJECTS
      .filter((project) => safeArray(project.supportedAlgorithmIds).includes(algorithmId))
      .map((project) => [
        project.key,
        {
          ...safeObject(project.defaultOptions),
          ...safeObject(runtimeOptions[project.key]),
        },
      ]),
  );
  const nextOptions = { ...safeObject(options) };
  if (Object.keys(normalizedRuntimeOptions).length) {
    nextOptions.runtimeOptions = {
      ...runtimeOptions,
      ...normalizedRuntimeOptions,
    };
  } else {
    delete nextOptions.runtimeOptions;
  }
  if (algorithmId === 'support-planning') {
    return normalizeSupportPlanningOptions(nextOptions);
  }
  return nextOptions;
}

function normalizeAlgorithmInput(algorithm, rawInput = {}) {
  const defaultConfig = cloneData(algorithm.defaultConfig || {});
  const normalizedInput = safeObject(rawInput);
  const mergedOptions = {
    ...safeObject(defaultConfig.options),
    ...safeObject(normalizedInput.options),
  };

  return {
    builtinMethodKey: String(normalizedInput.builtinMethodKey || defaultConfig.builtinMethodKey || '').trim(),
    selectedSourceIds: uniqueNumberList(normalizedInput.selectedSourceIds ?? defaultConfig.selectedSourceIds ?? []),
    uploadedFiles: safeArray(normalizedInput.uploadedFiles),
    options: normalizePlanningAlgorithmOptions(algorithm.id, mergedOptions),
  };
}

function normalizeAlgorithmInputs(template, payload = {}) {
  const rawInputs = safeObject(payload.algorithmInputs);
  return Object.fromEntries(
    safeArray(template.algorithms).map((algorithm) => [algorithm.id, normalizeAlgorithmInput(algorithm, rawInputs[algorithm.id])]),
  );
}

const PLANNING_ERROR_TYPES = ['missing_data', 'missing_upstream', 'algorithm_failed', 'permission_denied'];

function createPlanningRuntimeError({
  code = 'PLANNING_ALGORITHM_FAILED',
  type = 'algorithm_failed',
  status = 400,
  message = '规划执行失败。',
  details = {},
} = {}) {
  const error = new Error(String(message || '规划执行失败。'));
  error.status = Number.isInteger(Number(status)) ? Number(status) : 400;
  error.code = String(code || 'PLANNING_ALGORITHM_FAILED');
  error.type = PLANNING_ERROR_TYPES.includes(type) ? type : 'algorithm_failed';
  error.details = details && typeof details === 'object' ? details : {};
  return error;
}

function inferPlanningRuntimeErrorType(error, fallbackMessage = '') {
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) {
    return 'permission_denied';
  }

  const message = `${String(error?.message || '')} ${String(fallbackMessage || '')}`;
  if (/上游|请先完成|作战编组结果|作战方法结果|机降地域结果/i.test(message)) {
    return 'missing_upstream';
  }
  if (/缺少|未找到|不存在|无效|至少|未配置|预留|无法解析/i.test(message)) {
    return 'missing_data';
  }

  return 'algorithm_failed';
}

function inferPlanningRuntimeErrorCode(type = 'algorithm_failed') {
  if (type === 'missing_data') return 'PLANNING_MISSING_DATA';
  if (type === 'missing_upstream') return 'PLANNING_MISSING_UPSTREAM';
  if (type === 'permission_denied') return 'PLANNING_PERMISSION_DENIED';
  return 'PLANNING_ALGORITHM_FAILED';
}

function normalizePlanningRuntimeError(error, fallbackMessage = '规划执行失败。') {
  if (error?.code && error?.type && Number.isInteger(Number(error?.status))) {
    return error;
  }

  const type = inferPlanningRuntimeErrorType(error, fallbackMessage);
  const normalized = createPlanningRuntimeError({
    code: String(error?.code || inferPlanningRuntimeErrorCode(type)),
    type,
    status: Number.isInteger(Number(error?.status)) ? Number(error.status) : 400,
    message: String(error?.message || fallbackMessage || '规划执行失败。'),
    details: error?.details && typeof error.details === 'object' ? error.details : {},
  });

  if (error?.stack) {
    normalized.stack = error.stack;
  }
  return normalized;
}

function createPlanningAbortError(details = {}) {
  return createPlanningRuntimeError({
    code: 'PLANNING_EXECUTION_TERMINATED',
    type: 'algorithm_failed',
    status: 499,
    message: '规划任务已终止。',
    details,
  });
}

function throwIfPlanningAborted(signal, details = {}) {
  if (signal?.aborted) {
    throw createPlanningAbortError(details);
  }
}

const REQUIRED_UPSTREAM_ALGORITHMS = {
  'force-grouping': ['enemy-threat-analysis'],
  'target-allocation': ['enemy-threat-analysis', 'force-grouping'],
  'airborne-landing-site-selection': ['enemy-threat-analysis', 'target-allocation'],
  'method-planning': ['enemy-threat-analysis', 'target-allocation'],
  'support-planning': ['force-grouping', 'method-planning'],
};

function resolveTaskMissionType(task = {}) {
  const id = String(task?.id || '').toLowerCase();
  const name = String(task?.name || '').toLowerCase();
  const category = String(task?.category || '').toLowerCase();
  if (id.includes('air-assault') || name.includes('机降') || category.includes('机降')) {
    return 'air-assault';
  }
  return 'fire-strike';
}

function resolveRequiredUpstreamAlgorithms(algorithmId = '', task = {}) {
  const defaults = safeArray(REQUIRED_UPSTREAM_ALGORITHMS[algorithmId]);
  if (algorithmId !== 'support-planning') {
    return defaults;
  }

  const missionType = resolveTaskMissionType(task);
  if (missionType === 'air-assault') {
    return uniqueList([...defaults, 'airborne-landing-site-selection']);
  }
  return defaults;
}

function assertSupportPlanningInputCompleteness(step = {}, options = {}) {
  const stepName = String(step.name || '作战保障自动规划');
  const damageForecast = safeObject(options.damageForecast);
  const resourcePool = safeObject(options.resourcePool);
  const stock = safeObject(resourcePool.stock);
  const transport = safeObject(resourcePool.transport);
  const damageValues = [
    damageForecast.equipmentLossRate,
    damageForecast.casualtyRate,
    damageForecast.damagedEquipmentCount,
    damageForecast.woundedCount,
    damageForecast.criticalWindowCount,
  ];

  if (damageValues.some((value) => !Number.isFinite(Number(value)))) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: `${stepName} 缺少完整的战损预测输入，请至少提供装备损失率、人员伤亡率、受损装备数、伤员数和关键窗口数量。`,
      details: {
        stepId: step.id,
        algorithmId: step.algorithmId,
        fieldGroup: 'damageForecast',
      },
    });
  }

  const stockTotal = SUPPORT_RESOURCE_DEFINITIONS.reduce((total, item) => total + Number(stock[item.key] || 0), 0);
  const transportTotal = Number(transport.sorties || 0)
    + Number(transport.maintenanceTeams || 0)
    + Number(transport.medicalTeams || 0)
    + Number(transport.airspaceCells || 0)
    + Number(transport.commandLinks || 0);

  if (stockTotal <= 0 || transportTotal <= 0) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: `${stepName} 缺少可用的保障资源池输入，请至少配置非零库存和运输/保障投送能力。`,
      details: {
        stepId: step.id,
        algorithmId: step.algorithmId,
        fieldGroup: 'resourcePool',
      },
    });
  }
}

function resolveImportedFileType(fileName = '', fileExtension = '') {
  const extension = String(fileExtension || path.extname(fileName || '')).trim().toLowerCase();
  if (['.doc', '.docx'].includes(extension)) return 'word';
  if (extension === '.pdf') return 'pdf';
  if (['.xls', '.xlsx', '.csv'].includes(extension)) return 'excel';
  return '';
}

function previewPayloadToText(preview) {
  const payload = safeObject(preview?.payload);

  if (preview?.previewType === 'document') {
    return uniqueList([
      payload.title,
      payload.description,
      payload.content,
      ...safeArray(payload.paragraphs),
    ]).join('\n');
  }

  if (preview?.previewType === 'workbook') {
    return safeArray(payload.sheets)
      .map((sheet) => [
        sheet.name,
        sheet.summary,
        ...safeArray(sheet.rows).slice(0, 8).map((row) => safeArray(row).join(' / ')),
      ].filter(Boolean).join('\n'))
      .join('\n\n');
  }

  if (preview?.previewType === 'table') {
    return [
      safeArray(payload.columns).join(' / '),
      ...safeArray(payload.rows).slice(0, 10).map((row) => safeArray(row).join(' / ')),
    ].filter(Boolean).join('\n');
  }

  if (preview?.previewType === 'json') {
    return JSON.stringify(payload).slice(0, 3000);
  }

  if (preview?.previewType === 'image') {
    return [payload.title, payload.description].filter(Boolean).join('\n');
  }

  return JSON.stringify(payload).slice(0, 2000);
}

async function normalizePlanningUpload(file = {}) {
  const fileName = String(file.fileName || file.name || '').trim();
  const fileExtension = String(file.fileExtension || path.extname(fileName || '')).trim().toLowerCase();
  const importType = resolveImportedFileType(fileName, fileExtension);

  if (!importType) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: `当前仅支持上传 Word、PDF、Excel 或 CSV 文件，无法解析 ${fileName || '未命名文件'}。`,
      details: {
        fileName: fileName || '未命名文件',
      },
    });
  }

  const normalizedPreview = await normalizeImportedPreview(importType, {
    fileName,
    fileExtension,
    fileContentBase64: file.fileContentBase64,
    description: file.description,
  });

  const extractionDrafts = safeArray(normalizedPreview?.extractionDrafts).map((item) => ({
    title: String(item.title || fileName || '导入文件'),
    text: String(item.text || '').trim(),
    summary: String(item.summary || '').trim(),
    sourceType: String(item.sourceType || importType || 'uploaded-file').trim() || 'uploaded-file',
    sourceName: String(item.sourceName || fileName || '本地上传文件').trim() || '本地上传文件',
    fileName: String(item.fileName || fileName || '').trim(),
    extractedAt: String(item.extractedAt || new Date().toISOString()).trim(),
  }));

  return {
    id: String(file.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    fileName: fileName || '未命名文件',
    fileExtension,
    previewType: normalizedPreview?.previewType || 'document',
    preview: normalizedPreview?.payload || {},
    extractionDrafts,
    summary: toShortText(
      extractionDrafts.map((item) => item.summary || item.text).filter(Boolean).join(' '),
      140,
    ),
  };
}

async function normalizeUploadedFiles(files = []) {
  const normalizedFiles = [];
  for (const file of safeArray(files)) {
    normalizedFiles.push(await normalizePlanningUpload(file));
  }
  return normalizedFiles;
}

function buildSourceBundle(dataset, selectedSourceIds = []) {
  const sourceIdList = uniqueNumberList(selectedSourceIds);
  const sourceIdSet = new Set(sourceIdList);
  const selectedSources = safeArray(dataset.sources).filter((item) => sourceIdSet.has(Number(item.id)));
  const selectedPreviews = selectedSources
    .map((item) => dataset.previewsBySourceId.get(Number(item.id)) || null)
    .filter(Boolean);
  const selectedExtractions = safeArray(dataset.extractions).filter((item) => sourceIdSet.has(Number(item.sourceId)));
  const selectedEnvironment = safeArray(dataset.environment).filter((item) => sourceIdSet.has(Number(item.sourceId)));

  return {
    sourceIdSet,
    selectedSources,
    selectedPreviews,
    selectedExtractions,
    selectedEnvironment,
  };
}

function buildExternalDatasetPayload(dataset = {}, selectedSourceIds = []) {
  const sourceBundle = buildSourceBundle(dataset, selectedSourceIds);
  const redIntelligence = buildSelectedIntelligence(dataset, 'red', sourceBundle.sourceIdSet);
  const blueIntelligence = buildSelectedIntelligence(dataset, 'blue', sourceBundle.sourceIdSet);

  return {
    selectedSourceIds: uniqueNumberList(selectedSourceIds),
    summary: {
      selectedSourceCount: sourceBundle.selectedSources.length,
      selectedPreviewCount: sourceBundle.selectedPreviews.length,
      selectedExtractionCount: sourceBundle.selectedExtractions.length,
      selectedEnvironmentCount: sourceBundle.selectedEnvironment.length,
      redIntelligenceCount: redIntelligence.length,
      blueIntelligenceCount: blueIntelligence.length,
    },
    selectedSources: cloneData(sourceBundle.selectedSources),
    selectedPreviews: cloneData(sourceBundle.selectedPreviews),
    selectedExtractions: cloneData(sourceBundle.selectedExtractions),
    selectedEnvironment: cloneData(sourceBundle.selectedEnvironment),
    intelligence: {
      red: cloneData(redIntelligence),
      blue: cloneData(blueIntelligence),
    },
  };
}

function emitPlanningEvent(events, type, payload = {}) {
  if (!events) return;
  const eventPayload = {
    ...safeObject(payload),
    type,
    timestamp: new Date().toISOString(),
  };
  try {
    if (typeof events === 'function') {
      events(type, eventPayload);
    } else if (typeof events.emit === 'function') {
      events.emit(type, eventPayload);
    }
  } catch {
    // Streaming progress must never break the planning run itself.
  }
}

function normalizeBooleanOption(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function safeRuntimeText(value = '') {
  return String(value ?? '').trim();
}

const DEFAULT_OLLAMA_NUM_CTX = 262144;

function normalizeLlmBackend(value = '', runtimeOptions = {}) {
  const normalized = safeRuntimeText(value).toLowerCase().replace(/_/g, '-');
  if (['ollama', 'local-ollama', 'local'].includes(normalized)) {
    return 'ollama';
  }
  if (['openai', 'openai-compatible', 'external', 'external-api'].includes(normalized)) {
    return 'openai-compatible';
  }

  const ollamaHost = safeRuntimeText(runtimeOptions.ollamaHost || runtimeOptions.ollama_host);
  const baseUrl = safeRuntimeText(runtimeOptions.llmBaseUrl || runtimeOptions.openaiBaseUrl || runtimeOptions.baseUrl);
  const apiKey = safeRuntimeText(runtimeOptions.llmApiKey || runtimeOptions.openaiApiKey || runtimeOptions.apiKey);
  if (ollamaHost && !baseUrl && !apiKey) {
    return 'ollama';
  }
  return 'openai-compatible';
}

function normalizeLlmRuntimeOptions(runtimeOptions = {}) {
  const source = safeObject(runtimeOptions);
  const backend = normalizeLlmBackend(source.llmBackend || source.backend || source.provider, source);
  const timeoutSeconds = Number(source.llmTimeout || source.timeoutSeconds || source.timeout || 120);
  const ollamaNumCtx = Number(
    source.llmNumCtx
      || source.ollamaNumCtx
      || source.numCtx
      || process.env.LLM_OLLAMA_NUM_CTX
      || process.env.OLLAMA_NUM_CTX
      || DEFAULT_OLLAMA_NUM_CTX,
  );
  return {
    backend,
    apiKey: safeRuntimeText(source.llmApiKey || source.openaiApiKey || source.apiKey || source.api_key),
    baseUrl: safeRuntimeText(source.llmBaseUrl || source.openaiBaseUrl || source.baseUrl || source.base_url),
    ollamaHost: safeRuntimeText(source.ollamaHost || source.ollama_host || process.env.OLLAMA_HOST || 'http://localhost:11434'),
    model: safeRuntimeText(source.llmModel || source.model),
    timeoutSeconds: Number.isFinite(timeoutSeconds) ? clamp(timeoutSeconds, 1, 900) : 120,
    ollamaNumCtx: Number.isFinite(ollamaNumCtx) ? clamp(ollamaNumCtx, 2048, 262144) : DEFAULT_OLLAMA_NUM_CTX,
  };
}

const SENSITIVE_OPTION_KEYS = new Set([
  'apiKey',
  'api_key',
  'authorization',
  'llmApiKey',
  'llm_api_key',
  'openaiApiKey',
  'token',
]);

function redactSensitiveOptions(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveOptions(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (SENSITIVE_OPTION_KEYS.has(key)) {
      return [key, item ? 'configured' : ''];
    }
    return [key, redactSensitiveOptions(item)];
  }));
}

function resolveRuntimeOptions(input = {}, variant = {}) {
  const options = safeObject(input.options);
  const runtimeOptions = safeObject(options.runtimeOptions);
  const directOptions = { ...options };
  delete directOptions.runtimeOptions;
  return {
    ...safeObject(variant.defaultOptions),
    ...directOptions,
    ...safeObject(runtimeOptions[variant.runtimeKey]),
  };
}

function resolveProjectRoot(variant = {}) {
  const projectPath = safeRuntimeText(variant.projectPath);
  return path.isAbsolute(projectPath) ? projectPath : path.join(REPO_ROOT, projectPath);
}

function safeFileNamePart(value = '', fallback = 'input') {
  const normalized = String(value || fallback)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return normalized || fallback;
}

async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return filePath;
}

async function writeTextFile(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(text || ''), 'utf-8');
  return filePath;
}

function appendPythonPath(env, projectRoot) {
  const pythonPath = [projectRoot, env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return {
    ...env,
    PYTHONPATH: pythonPath,
    PYTHONIOENCODING: 'utf-8',
  };
}

function applyLlmRuntimeEnv(env, prefix, runtimeOptions = {}) {
  const llmOptions = normalizeLlmRuntimeOptions(runtimeOptions);
  const apiKey = llmOptions.apiKey;
  const baseUrl = llmOptions.baseUrl;
  const model = llmOptions.model;
  const timeout = safeRuntimeText(llmOptions.timeoutSeconds);
  const stream = normalizeBooleanOption(runtimeOptions.llmStream, false);

  env[`${prefix}_BACKEND`] = llmOptions.backend;
  if (apiKey) env[`${prefix}_API_KEY`] = apiKey;
  if (baseUrl) env[`${prefix}_BASE_URL`] = baseUrl;
  if (llmOptions.ollamaHost) env[`${prefix}_OLLAMA_HOST`] = llmOptions.ollamaHost;
  if (model) env[`${prefix}_MODEL`] = model;
  if (timeout) env[`${prefix}_TIMEOUT`] = timeout;
  if (llmOptions.ollamaNumCtx) env[`${prefix}_OLLAMA_NUM_CTX`] = String(llmOptions.ollamaNumCtx);
  env[`${prefix}_STREAM`] = stream ? '1' : '0';
  env[`${prefix}_STREAM_STDOUT`] = stream ? '1' : '0';
  env.LLM_BACKEND = llmOptions.backend;
  env.LLM_STREAM = stream ? '1' : '0';
  env.LLM_STREAM_STDOUT = stream ? '1' : '0';
  if (timeout) env.LLM_TIMEOUT = timeout;
  if (llmOptions.ollamaHost) env.OLLAMA_HOST = llmOptions.ollamaHost;
  if (llmOptions.ollamaNumCtx) env.LLM_OLLAMA_NUM_CTX = String(llmOptions.ollamaNumCtx);
  return env;
}

function chatCompletionUrl(baseUrl = '') {
  const normalized = safeRuntimeText(baseUrl).replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  return `${normalized}/chat/completions`;
}

function ollamaChatUrl(host = '') {
  const normalized = safeRuntimeText(host).replace(/\/+$/, '');
  if (normalized.endsWith('/api/chat')) return normalized;
  return `${normalized}/api/chat`;
}

function toShortProviderText(value = '', maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function extractOpenAiContent(payload = {}) {
  return String(safeArray(payload.choices)[0]?.message?.content || '');
}

function extractOllamaContent(payload = {}) {
  return String(safeObject(payload.message).content || payload.response || '');
}

async function postJsonWithTimeout(url, payload, { headers = {}, timeoutSeconds = 120 } = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(timeoutSeconds || 120)) * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw createPlanningRuntimeError({
        code: 'PLANNING_LLM_TEST_FAILED',
        type: 'algorithm_failed',
        status: 502,
        message: `大模型接口返回 HTTP ${response.status}: ${toShortProviderText(text, 300) || response.statusText}`,
        details: { httpStatus: response.status },
      });
    }
    if (!data || typeof data !== 'object') {
      throw createPlanningRuntimeError({
        code: 'PLANNING_LLM_TEST_FAILED',
        type: 'algorithm_failed',
        status: 502,
        message: `大模型接口响应不是 JSON: ${toShortProviderText(text, 300)}`,
      });
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createPlanningRuntimeError({
        code: 'PLANNING_LLM_TEST_TIMEOUT',
        type: 'algorithm_failed',
        status: 504,
        message: `大模型测试请求超时（${timeoutSeconds} 秒）。`,
      });
    }
    if (error?.code && error?.type) throw error;
    throw createPlanningRuntimeError({
      code: 'PLANNING_LLM_TEST_FAILED',
      type: 'algorithm_failed',
      status: 502,
      message: `大模型测试请求失败：${String(error?.message || error)}`,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function testOpenAiCompatibleLlm(options) {
  if (!options.baseUrl) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: '请填写外部 API Base URL。',
    });
  }
  if (!options.apiKey) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: '请填写外部 API Key。',
    });
  }
  const endpoint = chatCompletionUrl(options.baseUrl);
  const startedAt = Date.now();
  const data = await postJsonWithTimeout(
    endpoint,
    {
      model: options.model,
      messages: [
        { role: 'system', content: '只输出 JSON，不要输出 Markdown。' },
        { role: 'user', content: '请回复一个 JSON 对象：{"ok":true,"message":"pong"}' },
      ],
      temperature: 0,
      max_tokens: 80,
      response_format: { type: 'json_object' },
      stream: false,
    },
    {
      timeoutSeconds: options.timeoutSeconds,
      headers: { Authorization: `Bearer ${options.apiKey}` },
    },
  );
  const content = extractOpenAiContent(data);
  if (!content) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_LLM_TEST_FAILED',
      type: 'algorithm_failed',
      status: 502,
      message: '外部 API 响应中没有 choices[0].message.content。',
      details: { providerKeys: Object.keys(data).slice(0, 20) },
    });
  }
  return {
    ok: true,
    backend: 'openai-compatible',
    endpoint,
    model: options.model,
    latencyMs: Date.now() - startedAt,
    responseLength: content.length,
    preview: toShortText(content, 180),
  };
}

async function testOllamaLlm(options) {
  if (!options.ollamaHost) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: '请填写 Ollama 地址。',
    });
  }
  const endpoint = ollamaChatUrl(options.ollamaHost);
  const startedAt = Date.now();
  const data = await postJsonWithTimeout(
    endpoint,
    {
      model: options.model,
      messages: [
        { role: 'system', content: '只输出 JSON，不要输出 Markdown。' },
        { role: 'user', content: '请回复一个 JSON 对象：{"ok":true,"message":"pong"}' },
      ],
      stream: false,
      think: false,
      format: 'json',
      options: { temperature: 0, num_ctx: options.ollamaNumCtx },
    },
    { timeoutSeconds: options.timeoutSeconds },
  );
  const content = extractOllamaContent(data);
  if (!content) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_LLM_TEST_FAILED',
      type: 'algorithm_failed',
      status: 502,
      message: 'Ollama 响应中没有 message.content。',
      details: { providerKeys: Object.keys(data).slice(0, 20) },
    });
  }
  return {
    ok: true,
    backend: 'ollama',
    endpoint,
    model: options.model,
    latencyMs: Date.now() - startedAt,
    responseLength: content.length,
    preview: toShortText(content, 180),
  };
}

function splitLines(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function tailText(text = '', limit = 1600) {
  const source = String(text || '');
  if (source.length <= limit) return source;
  return source.slice(source.length - limit);
}

function runPythonProcess({
  args = [],
  cwd = REPO_ROOT,
  env = {},
  events = null,
  signal = null,
  step = {},
  algorithm = {},
  variant = {},
  stdoutAsLlm = false,
  terminalPrefix = '',
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createPlanningAbortError({
        stepId: step.id,
        algorithmId: algorithm.id,
        bindingId: variant.id,
      }));
      return;
    }
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let abortRequested = false;
    let childClosed = false;
    let forceKillTimer = null;
    const pythonCommand = PLANNING_PYTHON_USE_VENV ? process.execPath : (PLANNING_PYTHON_BIN || 'python3');
    const pythonArgs = PLANNING_PYTHON_USE_VENV ? [PLANNING_PYTHON_VENV_RUNNER, ...args] : args;
    const pythonEnv = PLANNING_PYTHON_USE_VENV && PLANNING_PYTHON_BIN
      ? { PLANNING_PYTHON_BOOTSTRAP_BIN: PLANNING_PYTHON_BIN }
      : {};
    emitPlanningEvent(events, 'terminal', {
      stepId: step.id,
      stepName: step.name,
      algorithmId: algorithm.id,
      stream: 'terminal',
      message: `${terminalPrefix || variant.name || algorithm.name} 启动: ${pythonCommand} ${pythonArgs.join(' ')}`,
    });

    const child = spawn(pythonCommand, pythonArgs, {
      cwd,
      env: { ...process.env, ...pythonEnv, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const clearAbortResources = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      signal?.removeEventListener?.('abort', handleAbort);
    };
    const handleAbort = () => {
      if (abortRequested) return;
      abortRequested = true;
      emitPlanningEvent(events, 'terminal', {
        stepId: step.id,
        stepName: step.name,
        algorithmId: algorithm.id,
        bindingId: variant.id,
        stream: 'terminal',
        message: `${terminalPrefix || variant.name || algorithm.name} 收到终止指令，正在结束子进程。`,
      });
      if (!child.killed) {
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => {
          if (!childClosed) child.kill('SIGKILL');
        }, 3000);
      }
    };
    signal?.addEventListener?.('abort', handleAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stdout += text;
      if (stdoutAsLlm) {
        emitPlanningEvent(events, 'llm-chunk', {
          stepId: step.id,
          stepName: step.name,
          algorithmId: algorithm.id,
          bindingId: variant.id,
          content: text,
        });
      } else {
        for (const line of splitLines(text)) {
          emitPlanningEvent(events, 'terminal', {
            stepId: step.id,
            stepName: step.name,
            algorithmId: algorithm.id,
            bindingId: variant.id,
            stream: 'stdout',
            message: line,
          });
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      for (const line of splitLines(text)) {
        emitPlanningEvent(events, 'terminal', {
          stepId: step.id,
          stepName: step.name,
          algorithmId: algorithm.id,
          bindingId: variant.id,
          stream: 'stderr',
          message: line,
        });
      }
    });

    child.on('error', (error) => {
      clearAbortResources();
      if (abortRequested || signal?.aborted) {
        reject(createPlanningAbortError({
          stepId: step.id,
          algorithmId: algorithm.id,
          bindingId: variant.id,
          stderr: tailText(stderr),
          stdout: tailText(stdout),
        }));
        return;
      }
      reject(createPlanningRuntimeError({
        code: 'PLANNING_ALGORITHM_FAILED',
        type: 'algorithm_failed',
        status: 502,
        message: `${variant.name || algorithm.name} Python 进程启动失败：${error.message}`,
        details: {
          stepId: step.id,
          algorithmId: algorithm.id,
          bindingId: variant.id,
          stderr: tailText(stderr),
          stdout: tailText(stdout),
        },
      }));
    });

    child.on('close', (code) => {
      childClosed = true;
      clearAbortResources();
      const durationMs = Date.now() - startedAt;
      if (abortRequested || signal?.aborted) {
        reject(createPlanningAbortError({
          stepId: step.id,
          algorithmId: algorithm.id,
          bindingId: variant.id,
          exitCode: code,
          stderr: tailText(stderr),
          stdout: tailText(stdout),
        }));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr, durationMs });
        return;
      }
      reject(createPlanningRuntimeError({
        code: 'PLANNING_ALGORITHM_FAILED',
        type: 'algorithm_failed',
        status: 502,
        message: `${variant.name || algorithm.name} Python 执行失败，退出码 ${code}。`,
        details: {
          stepId: step.id,
          algorithmId: algorithm.id,
          bindingId: variant.id,
          exitCode: code,
          stderr: tailText(stderr),
          stdout: tailText(stdout),
        },
      }));
    });
  });
}

function buildDatasetContextText(datasetPayload = {}, algorithmName = '') {
  const lines = [
    `算法输入上下文：${algorithmName || '智能任务规划'}`,
    `资源摘要：${JSON.stringify(datasetPayload.summary || {})}`,
  ];

  for (const source of safeArray(datasetPayload.selectedSources)) {
    lines.push(`\n[数据源] ${source.name || source.title || `#${source.id}`}`);
    if (source.description) lines.push(String(source.description));
    if (source.sourceType || source.type) lines.push(`类型：${source.sourceType || source.type}`);
  }

  for (const preview of safeArray(datasetPayload.selectedPreviews)) {
    lines.push(`\n[数据源预览] sourceId=${preview.sourceId || ''}`);
    lines.push(previewPayloadToText(preview));
  }

  for (const extraction of safeArray(datasetPayload.selectedExtractions)) {
    lines.push(`\n[抽取条目] ${extraction.title || extraction.sourceName || `#${extraction.id}`}`);
    lines.push(String(extraction.summary || extraction.text || ''));
  }

  for (const record of safeArray(datasetPayload.intelligence?.red)) {
    lines.push(`\n[红方情报] ${record.title || record.name || `#${record.id}`}`);
    lines.push(String(record.description || record.content || record.summary || ''));
    if (record.longitude && record.latitude) lines.push(`坐标：${record.longitude}, ${record.latitude}`);
  }

  for (const record of safeArray(datasetPayload.intelligence?.blue)) {
    lines.push(`\n[蓝方情报] ${record.title || record.name || `#${record.id}`}`);
    lines.push(String(record.description || record.content || record.summary || ''));
    if (record.longitude && record.latitude) lines.push(`坐标：${record.longitude}, ${record.latitude}`);
  }

  for (const item of safeArray(datasetPayload.selectedEnvironment)) {
    lines.push(`\n[环境要素] ${item.name || item.title || `#${item.id}`}`);
    lines.push(String(item.description || item.summary || item.value || ''));
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function materializeUploadedInputFiles(input = {}, baseDir = '', algorithmName = '') {
  const files = [];
  const uploadDir = path.join(baseDir, 'uploaded-files');
  await fs.mkdir(uploadDir, { recursive: true });

  for (const [index, file] of safeArray(input.uploadedFiles).entries()) {
    const fileName = String(file.fileName || file.name || `uploaded-${index + 1}.txt`).trim();
    const extension = String(file.fileExtension || path.extname(fileName) || '.txt').trim() || '.txt';
    const baseName = safeFileNamePart(path.basename(fileName, path.extname(fileName)), `uploaded-${index + 1}`);
    const targetPath = path.join(uploadDir, `${String(index + 1).padStart(2, '0')}-${baseName}${extension}`);

    if (file.fileContentBase64) {
      await fs.writeFile(targetPath, Buffer.from(String(file.fileContentBase64), 'base64'));
      files.push(targetPath);
      continue;
    }

    const extractionText = safeArray(file.extractionDrafts)
      .map((item) => [item.title, item.summary, item.text].filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n\n');
    const fallbackText = extractionText || previewPayloadToText(file.preview || file.payload || {}) || `${algorithmName} 上传文件：${fileName}`;
    const textPath = targetPath.endsWith('.txt') ? targetPath : `${targetPath}.txt`;
    await writeTextFile(textPath, fallbackText);
    files.push(textPath);
  }

  return files;
}

async function materializePlanningContextFiles({
  input = {},
  dataset = {},
  baseDir = '',
  algorithmName = '',
} = {}) {
  const files = await materializeUploadedInputFiles(input, baseDir, algorithmName);
  const datasetPayload = buildExternalDatasetPayload(dataset, input.selectedSourceIds);
  const hasSelectedDataset = Object.values(datasetPayload.summary || {}).some((value) => Number(value || 0) > 0);
  if (hasSelectedDataset) {
    const contextDir = path.join(baseDir, 'resource-context');
    const contextJson = path.join(contextDir, 'resource-context.json');
    const contextText = path.join(contextDir, 'resource-context.txt');
    await writeJsonFile(contextJson, datasetPayload);
    await writeTextFile(contextText, buildDatasetContextText(datasetPayload, algorithmName));
    files.push(contextText, contextJson);
  }
  return {
    files,
    datasetPayload,
  };
}

function normalizeGeoPoint(value = null) {
  if (Array.isArray(value) && value.length >= 2) {
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return { lng, lat };
    }
    return null;
  }

  if (!value || typeof value !== 'object') return null;
  const directLng = value.lng ?? value.lon ?? value.longitude;
  const directLat = value.lat ?? value.latitude;
  if (directLng !== undefined && directLat !== undefined) {
    const lng = Number(directLng);
    const lat = Number(directLat);
    if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return { lng, lat };
    }
  }

  return normalizeGeoPoint(value.center)
    || normalizeGeoPoint(value.location)
    || normalizeGeoPoint(value.coordinate)
    || normalizeGeoPoint(value.coordinates)
    || null;
}

function normalizeAirlandingTarget(raw = {}, index = 0, source = 'upstream') {
  const point = normalizeGeoPoint(raw);
  if (!point) return null;
  return {
    target_id: String(raw.target_id || raw.targetId || raw.id || `${source}-${index + 1}`),
    id: String(raw.id || raw.targetId || raw.target_id || `${source}-${index + 1}`),
    name: String(raw.name || raw.title || raw.label || `目标 ${index + 1}`),
    category: String(raw.category || raw.type || raw.targetType || source),
    lng: round(point.lng, 6),
    lat: round(point.lat, 6),
    threat_value: round(Number(raw.threat_value ?? raw.threatValue ?? raw.threatScore ?? raw.score ?? 65) / 100, 4),
    raw_coordinates: `${round(point.lat, 6)}, ${round(point.lng, 6)}`,
    source,
  };
}

function dedupeAirlandingTargets(targets = []) {
  const seen = new Set();
  const result = [];
  for (const target of safeArray(targets)) {
    const key = `${round(target.lng, 4)}:${round(target.lat, 4)}:${target.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

function collectAirlandingTargets(context = {}, dataset = {}) {
  const threatOutput = safeObject(context.stageOutputs?.['enemy-threat-analysis']);
  const targetAllocation = safeObject(context.stageOutputs?.['target-allocation']);
  const sources = [
    ...safeArray(threatOutput.targetAssessments).map((item) => ({ item, source: 'threat-target' })),
    ...safeArray(threatOutput.fireCoverage).map((item) => ({ item, source: 'fire-coverage' })),
    ...safeArray(threatOutput.airDefenseSystem).map((item) => ({ item, source: 'air-defense' })),
    ...safeArray(threatOutput.reconEarlyWarning).map((item) => ({ item, source: 'recon-warning' })),
    ...safeArray(threatOutput.antiAirborneFacilities).map((item) => ({ item, source: 'anti-airborne' })),
    ...safeArray(targetAllocation.preferredPlan?.assignments).map((item) => ({ item: item.target || item, source: 'target-allocation' })),
    ...safeArray(targetAllocation.targets).map((item) => ({ item, source: 'target-allocation' })),
    ...safeArray(dataset.intelligence).filter((item) => item.camp === 'red').map((item) => ({ item, source: 'red-intelligence' })),
  ];

  const targets = dedupeAirlandingTargets(sources
    .map(({ item, source }, index) => normalizeAirlandingTarget(item, index, source))
    .filter(Boolean));

  if (targets.length) {
    return targets;
  }

  return [
    { target_id: 'fallback-objective', id: 'fallback-objective', name: '演示目标区', category: 'objective', lng: 120.18, lat: 30.28, threat_value: 0.62, raw_coordinates: '30.28, 120.18', source: 'fallback' },
    { target_id: 'fallback-threat-east', id: 'fallback-threat-east', name: '东侧防空节点', category: 'air-defense', lng: 120.24, lat: 30.32, threat_value: 0.72, raw_coordinates: '30.32, 120.24', source: 'fallback' },
    { target_id: 'fallback-threat-south', id: 'fallback-threat-south', name: '南侧火力节点', category: 'fire-coverage', lng: 120.13, lat: 30.22, threat_value: 0.58, raw_coordinates: '30.22, 120.13', source: 'fallback' },
  ];
}

function buildBoundsFromAirlandingTargets(targets = [], padding = 0.18) {
  const points = safeArray(targets).filter((item) => Number.isFinite(Number(item.lng)) && Number.isFinite(Number(item.lat)));
  if (!points.length) {
    return { west: 120.0, south: 30.08, east: 120.38, north: 30.46 };
  }
  const lngs = points.map((item) => Number(item.lng));
  const lats = points.map((item) => Number(item.lat));
  return {
    west: round(Math.min(...lngs) - padding, 6),
    south: round(Math.min(...lats) - padding * 0.72, 6),
    east: round(Math.max(...lngs) + padding, 6),
    north: round(Math.max(...lats) + padding * 0.72, 6),
  };
}

function resolveTerrainRoot(runtimeOptions = {}) {
  const configured = safeRuntimeText(runtimeOptions.terrainRoot || process.env.PLANNING_TERRAIN_ROOT || process.env.AIRLANDING_TERRAIN_ROOT || 'apps/web/public/terrain');
  return path.isAbsolute(configured) ? configured : path.resolve(REPO_ROOT, configured);
}

function buildAirlandingRequirements(runtimeOptions = {}, input = {}) {
  const count = clamp(Math.round(Number(runtimeOptions.candidateCount || input.options?.candidateCount || 5)), 1, 20);
  const requirements = { num: count };
  for (let index = 0; index < count; index += 1) {
    requirements[`landing_${index}`] = {
      area_size: 0.1,
      area_distance: 50,
    };
  }
  return requirements;
}

async function executeLocalEnemyThreatAnalysis(variant, task, step, algorithm, context, payload, input, tempDir, events, signal) {
  const runtimeOptions = resolveRuntimeOptions(input, variant);
  const projectRoot = resolveProjectRoot(variant);
  const { files } = await materializePlanningContextFiles({
    input,
    dataset: payload.dataset || {},
    baseDir: tempDir,
    algorithmName: algorithm.name,
  });
  if (!files.length) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: '基于大模型分析算法缺少资源库数据或上传文件。',
      details: { stepId: step.id, algorithmId: algorithm.id, bindingId: variant.id },
    });
  }

  const outputPath = path.join(tempDir, 'outputs', 'enemy-threat-analysis.json');
  const artifactDir = path.join(tempDir, 'artifacts', 'enemy-threat-analysis');
  const args = [
    '-m',
    variant.cliModule || 'enemy_threat_analysis.cli',
    '--files',
    ...files,
    '--analysis-focus',
    safeRuntimeText(runtimeOptions.analysisFocus || 'comprehensive'),
    '--heatmap-density',
    safeRuntimeText(runtimeOptions.heatmapDensity || 'medium'),
    '--impact-bias',
    safeRuntimeText(runtimeOptions.impactBias || 'balanced'),
    '--output',
    outputPath,
    '--artifact-dir',
    artifactDir,
  ];
  if (normalizeBooleanOption(runtimeOptions.skipAssessment, false)) {
    args.push('--skip-assessment');
  }

  const env = applyLlmRuntimeEnv(
    appendPythonPath({}, projectRoot),
    'ENEMY_THREAT_LLM',
    runtimeOptions,
  );
  await runPythonProcess({
    args,
    cwd: REPO_ROOT,
    env,
    events,
    signal,
    step,
    algorithm,
    variant,
    stdoutAsLlm: normalizeBooleanOption(runtimeOptions.llmStream, true),
    terminalPrefix: '敌情威胁 Python 算法',
  });

  const structuredOutput = JSON.parse(await fs.readFile(outputPath, 'utf-8'));
  if (structuredOutput?.ok === false) {
    throw createPlanningRuntimeError({
      code: String(structuredOutput.error?.code || 'PLANNING_ALGORITHM_FAILED'),
      type: String(structuredOutput.error?.type || 'algorithm_failed'),
      status: 502,
      message: String(structuredOutput.error?.message || '基于大模型分析算法执行失败。'),
      details: { stepId: step.id, algorithmId: algorithm.id, bindingId: variant.id },
    });
  }

  const targetCount = safeArray(structuredOutput.targetAssessments).length;
  return {
    summary: `基于大模型分析算法完成敌情威胁分析，识别目标 ${targetCount} 个，威胁评分 ${structuredOutput.threatScore ?? '--'}。`,
    outputPreview: [
      `威胁等级：${structuredOutput.threatLevel || '--'} / ${structuredOutput.threatScore ?? '--'} 分`,
      `火力覆盖 ${safeArray(structuredOutput.fireCoverage).length} 项，防空节点 ${safeArray(structuredOutput.airDefenseSystem).length} 项`,
      `热力图要素 ${safeArray(structuredOutput.heatmapGeojson?.features).length} 个`,
    ],
    artifacts: [
      createArtifact('敌情威胁结构化结果', 'Python 算法输出的敌情目标、火力、防空、侦察和反机降结构。'),
      createArtifact('威胁热力图与三维标注', '输出 heatmapBase64 / heatmapGeojson，可在单算法结果页叠加展示。'),
      createArtifact('大模型抽取过程日志', '执行页已显示 stdout/stderr 与流式片段。'),
    ],
    structuredOutput,
  };
}

async function executeLocalForceGrouping(variant, task, step, algorithm, context, payload, input, tempDir, events, signal) {
  const runtimeOptions = resolveRuntimeOptions(input, variant);
  const projectRoot = resolveProjectRoot(variant);
  const { files } = await materializePlanningContextFiles({
    input,
    dataset: payload.dataset || {},
    baseDir: tempDir,
    algorithmName: algorithm.name,
  });
  if (!files.length) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: '智能编组算法缺少我方资源库数据或上传文件。',
      details: { stepId: step.id, algorithmId: algorithm.id, bindingId: variant.id },
    });
  }

  const upstreamThreat = safeObject(context.stageOutputs?.['enemy-threat-analysis']);
  const upstreamPath = await writeJsonFile(path.join(tempDir, 'inputs', 'upstream-threat.json'), upstreamThreat);
  const outputPath = path.join(tempDir, 'outputs', 'force-grouping.json');
  const args = [
    '-m',
    variant.cliModule || 'force_grouping.cli',
    '--files',
    ...files,
    '--upstream-threat',
    upstreamPath,
    '--scheme-profile',
    safeRuntimeText(runtimeOptions.schemeProfileKey || 'scheme-balanced-intelligent'),
    '--rule-library',
    safeRuntimeText(runtimeOptions.ruleLibraryKey || 'fire-strike-rules'),
    '--comparison-focus',
    safeRuntimeText(runtimeOptions.comparisonFocus || 'balanced'),
    '--expected-group-count',
    String(clamp(Math.round(Number(runtimeOptions.expectedGroupCount || 4)), 1, 12)),
    '--output',
    outputPath,
  ];
  if (!normalizeBooleanOption(runtimeOptions.useLlmExplanation, true)) {
    args.push('--no-llm-explanation');
  }

  const env = applyLlmRuntimeEnv(
    appendPythonPath({}, projectRoot),
    'FORCE_GROUPING_LLM',
    runtimeOptions,
  );
  await runPythonProcess({
    args,
    cwd: REPO_ROOT,
    env,
    events,
    signal,
    step,
    algorithm,
    variant,
    stdoutAsLlm: normalizeBooleanOption(runtimeOptions.llmStream, true),
    terminalPrefix: '作战力量智能编组 Python 算法',
  });

  const structuredOutput = JSON.parse(await fs.readFile(outputPath, 'utf-8'));
  if (structuredOutput?.ok === false) {
    throw createPlanningRuntimeError({
      code: String(structuredOutput.error?.code || 'PLANNING_ALGORITHM_FAILED'),
      type: String(structuredOutput.error?.type || 'algorithm_failed'),
      status: 502,
      message: String(structuredOutput.error?.message || '智能编组算法执行失败。'),
      details: {
        stepId: step.id,
        algorithmId: algorithm.id,
        bindingId: variant.id,
        error: structuredOutput.error || {},
      },
    });
  }

  const preferred = structuredOutput.preferredScheme || {};
  const preferredLabel = preferred.name || preferred.methodLabel || '待确认方案';
  return {
    summary: `智能编组算法完成 ${safeArray(structuredOutput.schemes).length} 套方案比选，推荐 ${preferredLabel}。`,
    outputPreview: [
      `推荐方案：${preferredLabel} / ${preferred.score ?? '--'} 分`,
      `编组数量：${safeArray(preferred.groups).length || preferred.actualGroupCount || '--'}`,
      `约束状态：${structuredOutput.constraintSummary?.overallStatus || '--'}`,
    ],
    artifacts: [
      createArtifact('作战力量编组方案', 'Python 算法输出的分组方案、平台能力和推荐解释。'),
      createArtifact('方案比选与约束评估', '输出 schemes / comparison / constraintSummary 等比选结果。'),
      createArtifact('大模型编组抽取日志', '执行页已显示 stdout/stderr 与流式片段。'),
    ],
    structuredOutput,
  };
}

function buildAirlandingInputPayload(context = {}, input = {}, dataset = {}, runtimeOptions = {}) {
  const targets = collectAirlandingTargets(context, dataset);
  const bounds = buildBoundsFromAirlandingTargets(targets);
  const terrainRoot = resolveTerrainRoot(runtimeOptions);
  return {
    report_id: `planning-${Date.now()}`,
    terrain_root: terrainRoot,
    targets,
    bounds,
    landing_requirements: buildAirlandingRequirements(runtimeOptions, input),
    upstream: {
      threatAnalysisAvailable: Boolean(context.stageOutputs?.['enemy-threat-analysis']),
      targetAllocationAvailable: Boolean(context.stageOutputs?.['target-allocation']),
    },
  };
}

function normalizeAirlandingCandidate(raw = {}, index = 0) {
  const centerPoint = normalizeGeoPoint(raw.center || raw);
  const center = centerPoint
    ? [round(centerPoint.lng, 6), round(centerPoint.lat, 6), round(Number(raw.elevation_m || raw.refined_mean_elevation_m || 0), 1)]
    : [120.18, 30.28, 0];
  const zone = safeArray(raw.polygon).map((point) => {
    const normalized = normalizeGeoPoint(point);
    return normalized ? [round(normalized.lng, 6), round(normalized.lat, 6), center[2]] : null;
  }).filter(Boolean);
  const score = round(clamp(Number(raw.composite_score || 0) * 100, 0, 100), 1);
  const terrainScore = round(clamp(Number(raw.terrain_score || raw.refined_terrain_score || 0) * 100, 0, 100), 1);
  const safety = round(clamp((1 - Number(raw.threat_value || 0)) * 100, 0, 100), 1);
  const distanceScore = round(clamp(Number(raw.distance_score || 0) * 100, 0, 100), 1);
  const concealment = round(clamp(terrainScore * 0.65 + safety * 0.35, 0, 100), 1);
  const helicopterFit = round(clamp(72 + terrainScore * 0.18 - Math.max(0, Number(raw.slope_deg || raw.refined_max_slope_deg || 0) - 7) * 1.6, 0, 100), 1);
  return {
    id: String(raw.zone_id || raw.candidate_id || raw.landing_id || `python-lz-${index + 1}`),
    name: String(raw.zone_id || raw.candidate_id || `Python 候选地域 ${index + 1}`),
    source: 'airlanding_zone',
    center,
    zone: zone.length >= 3 ? zone : buildLandingZonePolygon(center, 1.4),
    rank: index + 1,
    score,
    baseScore: score,
    qualified: !raw.refined_rejected && safety >= 42 && terrainScore >= 28,
    concealment,
    safety,
    assemblyEfficiency: distanceScore,
    helicopterFit,
    ingressDistanceKm: round(Number(raw.area_distance_km || 0), 1),
    assaultDistanceKm: round(Number(raw.nearest_threat_distance_km || 0), 1),
    totalDistanceKm: round(Number(raw.area_distance_km || 0) + Number(raw.nearest_threat_distance_km || 0), 1),
    threatExposure: round(clamp(Number(raw.threat_value || 0) * 100, 0, 100), 1),
    metrics: {
      areaSizeSqkm: round(Number(raw.area_size_sqkm || raw.polygon_area_sqkm || 0), 3),
      terrainClass: raw.terrain_class || 'unknown',
      slopeDeg: round(Number(raw.slope_deg || raw.refined_max_slope_deg || 0), 2),
      reliefM: round(Number(raw.relief_m || raw.refined_relief_m || 0), 2),
      elevationM: round(Number(raw.elevation_m || raw.refined_mean_elevation_m || 0), 1),
      nearestThreatId: raw.nearest_threat_id || '',
      nearestThreatDistanceKm: round(Number(raw.nearest_threat_distance_km || 0), 2),
    },
    rawCandidate: cloneData(raw),
  };
}

function adaptAirlandingOutput(raw = {}, context = {}, input = {}, dataset = {}, runtimeOptions = {}) {
  const helicopterProfile = buildHelicopterProfile(input.options?.helicopterModel || 'medium-lift');
  const fallbackAnchor = resolveFallbackAnchor(dataset);
  const targetAllocation = safeObject(context.stageOutputs?.['target-allocation']);
  const threatOutput = safeObject(context.stageOutputs?.['enemy-threat-analysis']);
  const stagingAnchor = buildGroupAnchors(safeObject(context.stageOutputs?.['force-grouping']), dataset)[0]?.anchor || fallbackAnchor;
  const objectiveAnchor = buildObjectiveAnchors(targetAllocation, threatOutput, fallbackAnchor)[0]?.coordinates || fallbackAnchor;
  const selectedIds = new Set(safeArray(raw.zones).map((item) => String(item.candidate_id || item.zone_id || item.landing_id || '')));
  const rawCandidates = (safeArray(raw.candidates).length ? raw.candidates : safeArray(raw.zones))
    .map((candidate) => ({
      ...candidate,
      selected: candidate.selected || selectedIds.has(String(candidate.candidate_id || candidate.zone_id || candidate.landing_id || '')),
    }));
  const rankedCandidates = sortByScore(rawCandidates.map(normalizeAirlandingCandidate), 'score')
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const preferredCandidate = rankedCandidates.find((item) => item.rawCandidate?.selected) || rankedCandidates[0] || null;
  const methodComparison = [
    {
      methodKey: 'airlanding-zone-python',
      methodLabel: '机降地域优化选择 Python 算法',
      bestCandidateName: preferredCandidate?.name || '--',
      score: preferredCandidate?.score || 0,
      averageScore: round(average(rankedCandidates.map((item) => item.score)), 1),
      qualifiedCount: rankedCandidates.filter((item) => item.qualified).length,
    },
  ];

  return {
    implementationStatus: 'implemented',
    builtinMethodKey: 'airlanding-zone-python',
    builtinMethodLabel: '机降地域优化选择 Python 算法',
    helicopterProfile,
    stagingAnchor,
    objectiveAnchor,
    methodComparison,
    rankedCandidates,
    preferredCandidateId: preferredCandidate?.id || '',
    preferredCandidate,
    landingGroups: safeArray(raw.landing_groups),
    landingRequirements: cloneData(raw.landing_requirements || {}),
    demSource: cloneData(raw.dem_source || {}),
    warnings: cloneData(raw.warnings || []),
    rawAirlandingOutput: cloneData(raw),
    linkageAnalysis: buildLandingLinkageAnalysis(preferredCandidate || {}, targetAllocation, helicopterProfile),
    visualization: buildLandingVisualization(rankedCandidates, preferredCandidate, stagingAnchor, objectiveAnchor, helicopterProfile),
    runtimeOptions: {
      candidateCount: runtimeOptions.candidateCount,
      terrainRoot: runtimeOptions.terrainRoot || 'apps/web/public/terrain',
    },
  };
}

async function executeLocalAirlandingZone(variant, task, step, algorithm, context, payload, input, tempDir, events, signal) {
  const runtimeOptions = resolveRuntimeOptions(input, variant);
  const projectRoot = resolveProjectRoot(variant);
  const inputPayload = buildAirlandingInputPayload(context, input, payload.dataset || {}, runtimeOptions);
  const inputPath = await writeJsonFile(path.join(tempDir, 'inputs', 'airlanding-zone-input.json'), inputPayload);
  const env = appendPythonPath({
    PLANNING_TERRAIN_ROOT: inputPayload.terrain_root,
    AIRLANDING_TERRAIN_ROOT: inputPayload.terrain_root,
  }, projectRoot);

  const processResult = await runPythonProcess({
    args: [path.join(projectRoot, variant.entrypoint || 'main.py'), inputPath],
    cwd: projectRoot,
    env,
    events,
    signal,
    step,
    algorithm,
    variant,
    stdoutAsLlm: false,
    terminalPrefix: '机降地域优化选择 Python 算法',
  });
  const trimmedStdout = String(processResult.stdout || '').trim();
  const jsonStart = trimmedStdout.indexOf('{');
  const rawOutput = jsonStart >= 0 ? JSON.parse(trimmedStdout.slice(jsonStart)) : {};
  if (rawOutput.error) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_ALGORITHM_FAILED',
      type: 'algorithm_failed',
      status: 502,
      message: String(rawOutput.error || '机降地域优化选择 Python 算法执行失败。'),
      details: { stepId: step.id, algorithmId: algorithm.id, bindingId: variant.id },
    });
  }

  const structuredOutput = adaptAirlandingOutput(rawOutput, context, input, payload.dataset || {}, runtimeOptions);
  return {
    summary: `机降地域优化选择 Python 算法完成 ${safeArray(rawOutput.candidates).length} 个候选点筛选，推荐 ${structuredOutput.preferredCandidate?.name || '待确认地域'}。`,
    outputPreview: [
      `候选点 ${safeArray(rawOutput.candidates).length} 个，选中地域 ${safeArray(rawOutput.zones).length} 个`,
      `推荐地域：${structuredOutput.preferredCandidate?.name || '--'} / ${structuredOutput.preferredCandidate?.score ?? '--'} 分`,
      `Terrain：${rawOutput.dem_source?.terrain_root || inputPayload.terrain_root}`,
    ],
    artifacts: [
      createArtifact('机降地域 Python 候选结果', '保留 airlanding_zone 原始 candidates / zones / landing_groups 输出。'),
      createArtifact('平台机降地域排序结果', '映射为 rankedCandidates / preferredCandidate / methodComparison。'),
      createArtifact('机降地域三维标注', '复用平台 visualization 结构输出候选点、优选地域和接近航路。'),
    ],
    structuredOutput,
  };
}

async function executeLocalPythonStep(variant, task, step, algorithm, context, payload, input, events, signal) {
  const runKey = safeFileNamePart(`${payload.taskRunId || Date.now()}-${step.id || algorithm.id}`, 'planning-run');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `mission-planning-${runKey}-`));
  emitPlanningEvent(events, 'terminal', {
    stepId: step.id,
    stepName: step.name,
    algorithmId: algorithm.id,
    bindingId: variant.id,
    stream: 'terminal',
    message: `临时工作目录已创建：${tempDir}`,
    });

  try {
    throwIfPlanningAborted(signal, { stepId: step.id, algorithmId: algorithm.id, bindingId: variant.id });
    if (algorithm.id === 'enemy-threat-analysis') {
      return await executeLocalEnemyThreatAnalysis(variant, task, step, algorithm, context, payload, input, tempDir, events, signal);
    }
    if (algorithm.id === 'force-grouping') {
      return await executeLocalForceGrouping(variant, task, step, algorithm, context, payload, input, tempDir, events, signal);
    }
    if (algorithm.id === 'airborne-landing-site-selection') {
      return await executeLocalAirlandingZone(variant, task, step, algorithm, context, payload, input, tempDir, events, signal);
    }
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: `${algorithm.name} 未登记本地 Python 执行器。`,
      details: { stepId: step.id, algorithmId: algorithm.id, bindingId: variant.id },
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildEvidenceCorpus(parts = []) {
  return uniqueList(
    safeArray(parts)
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  );
}

function buildIntelligenceText(intelligence = []) {
  return safeArray(intelligence).map((item) => [
    item.name,
    item.category,
    item.role,
    item.readiness,
    safeArray(item.tags).join(' '),
    item.notes,
  ].filter(Boolean).join(' '));
}

function buildEnvironmentText(environment = []) {
  return safeArray(environment).map((item) => [
    item.name,
    item.kind,
    item.weather,
    item.riskLevel,
    item.notes,
  ].filter(Boolean).join(' '));
}

function getAnalysisFocusProfile(analysisFocus = 'comprehensive') {
  return ANALYSIS_FOCUS_PROFILES[analysisFocus] || ANALYSIS_FOCUS_PROFILES.comprehensive;
}

function getHeatmapDensityProfile(heatmapDensity = 'medium') {
  return HEATMAP_DENSITY_PROFILES[heatmapDensity] || HEATMAP_DENSITY_PROFILES.medium;
}

function getImpactBiasProfile(impactBias = 'balanced') {
  return IMPACT_BIAS_PROFILES[impactBias] || IMPACT_BIAS_PROFILES.balanced;
}

function isCoordinateTuple(value = []) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function averageCoordinate(points = [], fallback = [120.18, 30.28, 0]) {
  const validPoints = safeArray(points).filter(isCoordinateTuple);
  if (!validPoints.length) {
    return cloneData(fallback);
  }

  return [
    round(average(validPoints.map((item) => Number(item[0]))), 4),
    round(average(validPoints.map((item) => Number(item[1]))), 4),
    round(average(validPoints.map((item) => Number(item[2] || 0))), 1),
  ];
}

function offsetCoordinate(base = [120.18, 30.28, 0], longitudeOffset = 0, latitudeOffset = 0, altitudeOffset = 0) {
  const [longitude, latitude, altitude] = isCoordinateTuple(base) ? toCoordinateTuple(base) : [120.18, 30.28, 0];
  return [
    round(longitude + Number(longitudeOffset || 0), 4),
    round(latitude + Number(latitudeOffset || 0), 4),
    round(altitude + Number(altitudeOffset || 0), 1),
  ];
}

function buildThreatBoxPolygon(center = [120.18, 30.28, 0], longitudeSpan = 0.08, latitudeSpan = 0.06) {
  return [
    offsetCoordinate(center, -longitudeSpan, -latitudeSpan),
    offsetCoordinate(center, longitudeSpan, -latitudeSpan),
    offsetCoordinate(center, longitudeSpan, latitudeSpan),
    offsetCoordinate(center, -longitudeSpan, latitudeSpan),
  ];
}

function resolveEnvironmentGeometryCenter(item = {}) {
  if (item.geometryType === 'circle') {
    return toCoordinateTuple(item.geometry?.center);
  }

  if (item.geometryType === 'polygon') {
    return computePolygonCenter(item.geometry);
  }

  return null;
}

function buildThreatAnchorPack(redIntelligence = [], environment = [], heatmapDensity = 'medium') {
  const intelligencePoints = safeArray(redIntelligence).map((item) => [item.longitude, item.latitude, 0]);
  const environmentPoints = safeArray(environment)
    .map((item) => resolveEnvironmentGeometryCenter(item))
    .filter(isCoordinateTuple);
  const primary = averageCoordinate([...intelligencePoints, ...environmentPoints], [120.18, 30.28, 0]);

  return {
    primary,
    heatmapDensity,
    categoryAnchors: {
      fireCoverage: offsetCoordinate(primary, 0.14, 0.05),
      airDefenseSystem: offsetCoordinate(primary, -0.12, 0.09),
      reconEarlyWarning: offsetCoordinate(primary, 0.08, -0.12),
      antiAirborneFacilities: offsetCoordinate(primary, -0.14, -0.06),
      deploymentSectors: offsetCoordinate(primary, 0, 0.04),
    },
  };
}

function resolveSourceAnchor(sourceId, redIntelligence = [], environment = [], fallback = [120.18, 30.28, 0]) {
  const points = [
    ...safeArray(redIntelligence)
      .filter((item) => Number(item.sourceId) === Number(sourceId))
      .map((item) => [item.longitude, item.latitude, 0]),
    ...safeArray(environment)
      .filter((item) => Number(item.sourceId) === Number(sourceId))
      .map((item) => resolveEnvironmentGeometryCenter(item))
      .filter(isCoordinateTuple),
  ];

  return averageCoordinate(points, fallback);
}

function resolveThreatEvidenceName(entry = {}, titleSuffix = '威胁节点') {
  const baseTitle = String(entry.title || entry.sourceLabel || '')
    .replace(/\.(docx?|pdf|xlsx?|xls|csv)$/i, '')
    .trim();
  if (!baseTitle) {
    return titleSuffix;
  }
  if (baseTitle.includes(titleSuffix)) {
    return baseTitle.slice(0, 28);
  }
  return `${baseTitle.slice(0, 20)}${titleSuffix}`;
}

function buildEvidenceReferences(entry = {}, fallbackLabel = '文档证据') {
  return uniqueList([
    entry.sourceLabel || '',
    entry.summary || '',
    toShortText(entry.text || '', 96),
    fallbackLabel,
  ]).slice(0, 3);
}

function createThreatEvidenceEntry(payload = {}) {
  const text = String(payload.text || '').trim();
  const summary = String(payload.summary || '').trim();
  if (!text && !summary) {
    return null;
  }

  return {
    id: String(payload.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    title: String(payload.title || payload.sourceLabel || '').trim(),
    text,
    summary: summary || toShortText(text, 140),
    sourceType: String(payload.sourceType || 'document'),
    sourceId: payload.sourceId ?? null,
    sourceLabel: String(payload.sourceLabel || payload.title || '文档证据').trim(),
    sourceName: String(payload.sourceName || payload.sourceLabel || payload.title || '').trim(),
    fileName: String(payload.fileName || '').trim(),
    extractedAt: String(payload.extractedAt || '').trim(),
    location: isCoordinateTuple(payload.location) ? toCoordinateTuple(payload.location) : null,
  };
}

function buildEvidenceTraceEntries(entries = [], limit = 40) {
  return safeArray(entries)
    .map((item, index) => ({
      id: String(item.id || `evidence-${index + 1}`),
      title: String(item.title || '').trim(),
      summary: String(item.summary || '').trim(),
      sourceType: String(item.sourceType || '').trim() || 'unknown',
      sourceId: Number.isFinite(Number(item.sourceId)) ? Number(item.sourceId) : null,
      sourceName: String(item.sourceName || item.sourceLabel || '').trim() || '未命名来源',
      fileName: String(item.fileName || '').trim(),
      extractedAt: String(item.extractedAt || '').trim(),
    }))
    .filter((item) => item.summary || item.title || item.sourceName)
    .slice(0, limit);
}

function buildThreatEvidenceEntries(sourceBundle = {}, uploadedFiles = [], redIntelligence = [], environment = [], anchorPack = {}) {
  const fallbackAnchor = anchorPack.primary || [120.18, 30.28, 0];
  const sourcesById = new Map(safeArray(sourceBundle.selectedSources).map((item) => [Number(item.id), item]));
  const entries = [];

  safeArray(sourceBundle.selectedPreviews).forEach((preview, index) => {
    const source = sourcesById.get(Number(preview.sourceId));
    const previewPayload = safeObject(preview.payload);
    const entry = createThreatEvidenceEntry({
      id: `preview-${preview.sourceId}-${index + 1}`,
      title: source?.name || preview.title || `数据源 ${preview.sourceId}`,
      text: previewPayloadToText(preview),
      summary: preview.description || preview.summary || '',
      sourceType: 'resource-preview',
      sourceId: preview.sourceId,
      sourceLabel: source?.name || preview.title || '资源库预览',
      sourceName: source?.name || preview.title || '资源库预览',
      fileName: String(previewPayload.fileName || previewPayload.title || '').trim(),
      extractedAt: String(preview.createdAt || '').trim(),
      location: resolveSourceAnchor(preview.sourceId, redIntelligence, environment, fallbackAnchor),
    });
    if (entry) {
      entries.push(entry);
    }
  });

  safeArray(sourceBundle.selectedExtractions).forEach((item, index) => {
    const source = sourcesById.get(Number(item.sourceId));
    const entry = createThreatEvidenceEntry({
      id: `extraction-${item.id || index + 1}`,
      title: item.title || source?.name || '抽取结果',
      text: item.text || item.summary || '',
      summary: item.summary || '',
      sourceType: item.sourceType || 'resource-extraction',
      sourceId: item.sourceId,
      sourceLabel: source?.name || item.sourceName || item.title || '资源库抽取',
      sourceName: item.sourceName || source?.name || item.title || '资源库抽取',
      fileName: item.fileName || '',
      extractedAt: item.createdAt || item.extractedAt || '',
      location: resolveSourceAnchor(item.sourceId, redIntelligence, environment, fallbackAnchor),
    });
    if (entry) {
      entries.push(entry);
    }
  });

  safeArray(uploadedFiles).forEach((file, fileIndex) => {
    const fileEntries = safeArray(file.extractionDrafts).length
      ? file.extractionDrafts
      : [{
          title: file.fileName,
          text: file.summary || '',
          summary: file.summary || '',
        }];

    fileEntries.forEach((draft, draftIndex) => {
      const entry = createThreatEvidenceEntry({
        id: `${file.id || `upload-${fileIndex + 1}`}-${draftIndex + 1}`,
        title: draft.title || file.fileName,
        text: draft.text || draft.summary || '',
        summary: draft.summary || file.summary || '',
        sourceType: 'uploaded-file',
        sourceLabel: file.fileName || '本地上传文件',
        sourceName: draft.sourceName || file.fileName || '本地上传文件',
        fileName: draft.fileName || file.fileName || '',
        extractedAt: draft.extractedAt || '',
        location: fallbackAnchor,
      });
      if (entry) {
        entries.push(entry);
      }
    });
  });

  return entries;
}

function buildGeneratedEvidenceLocation(anchorPack = {}, categoryKey = 'fireCoverage', index = 0) {
  const baseAnchor = anchorPack.categoryAnchors?.[categoryKey] || anchorPack.primary || [120.18, 30.28, 0];
  const densityProfile = getHeatmapDensityProfile(anchorPack.heatmapDensity);
  const spreadScale = Number(densityProfile.spreadScale || 1);
  const categoryAngles = {
    fireCoverage: 26,
    airDefenseSystem: 122,
    reconEarlyWarning: 218,
    antiAirborneFacilities: 304,
    deploymentSectors: 56,
  };
  const angle = (((categoryAngles[categoryKey] || 0) + (index * 73)) * Math.PI) / 180;
  const radius = (0.045 + (Math.floor(index / 4) * 0.026)) * spreadScale;

  return offsetCoordinate(
    baseAnchor,
    Math.cos(angle) * radius,
    Math.sin(angle) * radius * 0.82,
  );
}

function mergeThreatItems(baseItems = [], inferredItems = [], metricField = 'confidence') {
  const merged = new Map();

  const upsert = (item) => {
    const key = textOf(item?.name || item?.id || '');
    if (!key) return;

    if (!merged.has(key)) {
      merged.set(key, cloneData(item));
      return;
    }

    const current = merged.get(key);
    const nextScore = Number(item?.[metricField] || 0);
    const currentScore = Number(current?.[metricField] || 0);
    const preferred = nextScore > currentScore ? cloneData(item) : current;
    preferred.evidence = uniqueList([
      ...safeArray(current?.evidence),
      ...safeArray(item?.evidence),
    ]).slice(0, 4);
    merged.set(key, preferred);
  };

  [...safeArray(baseItems), ...safeArray(inferredItems)].forEach(upsert);
  return [...merged.values()];
}

function buildTextThreatCollection(categoryKey, evidenceEntries = [], anchorPack = {}, options = {}, builtinMethodKey = 'knowledge-fusion', existingItems = []) {
  const definition = THREAT_TEXT_NODE_DEFINITIONS[categoryKey];
  if (!definition) {
    return [];
  }

  const focusProfile = getAnalysisFocusProfile(options.analysisFocus);
  const emphasisMultiplier = Number(focusProfile[categoryKey] || 1);
  const methodMultiplier = builtinMethodKey === 'coverage-priority' && ['fireCoverage', 'airDefenseSystem'].includes(categoryKey)
    ? 1.12
    : 1;
  const baseLimit = categoryKey === 'fireCoverage' ? 5 : 4;
  const maxCount = Math.max(1, baseLimit - Math.min(safeArray(existingItems).length, baseLimit - 1));

  return safeArray(evidenceEntries)
    .map((entry) => {
      const texts = [entry.title, entry.summary, entry.text];
      const signal = keywordScore(texts, definition.keywords);
      const score = round((signal * 2.4 * emphasisMultiplier * methodMultiplier) + (entry.location ? 0.6 : 0), 2);
      return {
        entry,
        score,
      };
    })
    .filter((item) => item.score > 1.2)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxCount)
    .map(({ entry, score }, index) => {
      const location = entry.location || buildGeneratedEvidenceLocation(anchorPack, categoryKey, index);

      if (categoryKey === 'fireCoverage') {
        const radiusMeters = Math.round(11000 + score * 1500 + (builtinMethodKey === 'coverage-priority' ? 2400 : 0));
        return {
          id: `fire-coverage-text-${index + 1}`,
          name: resolveThreatEvidenceName(entry, definition.titleSuffix),
          sourceUnitId: entry.id,
          source: entry.sourceLabel,
          center: location,
          radiusMeters,
          coverageKm: round(radiusMeters / 1000, 1),
          threatValue: round(clamp(54 + score * 8.6, 0, 100), 1),
          notes: entry.summary || entry.sourceLabel,
          inferredFromText: true,
          evidence: buildEvidenceReferences(entry, definition.evidenceLabel),
        };
      }

      if (categoryKey === 'airDefenseSystem') {
        return {
          id: `air-defense-text-${index + 1}`,
          name: resolveThreatEvidenceName(entry, definition.titleSuffix),
          source: entry.sourceLabel,
          coverageKm: round(9 + score * 1.7 + (options.analysisFocus === 'air-defense' ? 1.4 : 0), 1),
          strength: round(clamp(56 + score * 7.4, 0, 100), 1),
          location,
          role: '文档推断防空节点',
          inferredFromText: true,
          evidence: buildEvidenceReferences(entry, definition.evidenceLabel),
        };
      }

      if (categoryKey === 'reconEarlyWarning') {
        return {
          id: `recon-node-text-${index + 1}`,
          name: resolveThreatEvidenceName(entry, definition.titleSuffix),
          source: entry.sourceLabel,
          location,
          role: '文档推断侦察预警',
          coverageKm: round(7 + score * 1.5, 1),
          confidence: round(clamp(55 + score * 7, 0, 100), 1),
          inferredFromText: true,
          evidence: buildEvidenceReferences(entry, definition.evidenceLabel),
        };
      }

      return {
        id: `anti-airborne-text-${index + 1}`,
        name: resolveThreatEvidenceName(entry, definition.titleSuffix),
        source: entry.sourceLabel,
        location,
        confidence: round(clamp(58 + score * 7.2, 0, 100), 1),
        description: entry.summary || '由文档关键词推断的反机降阻滞/封控设施。',
        inferredFromText: true,
        evidence: buildEvidenceReferences(entry, definition.evidenceLabel),
      };
    });
}

function resolveDeploymentDirection(text = '', index = 0) {
  return DEPLOYMENT_DIRECTION_DEFINITIONS.find((item) => includesAny(text, item.keywords))
    || DEPLOYMENT_DIRECTION_DEFINITIONS[index % DEPLOYMENT_DIRECTION_DEFINITIONS.length];
}

function resolveDeploymentPosture(text = '') {
  if (includesAny(text, ['前沿', '压制', '打击', '射击'])) return '前沿压制';
  if (includesAny(text, ['集结', '机动', '突击', '装载'])) return '机动集结';
  if (includesAny(text, ['纵深', '梯次', '预备'])) return '纵深梯次';
  if (includesAny(text, ['警戒', '防线', '阵地', '拦截'])) return '阵地警戒';
  if (includesAny(text, ['封控', '阻滞', '障碍', '拒止'])) return '封控阻滞';
  return '重点部署';
}

function buildTextDeploymentSectors(evidenceEntries = [], anchorPack = {}, options = {}, existingSectors = []) {
  const deploymentKeywords = ['部署', '阵地', '集结', '前沿', '纵深', '走廊', '轴线', '翼侧', '防线', '警戒'];
  const focusMultiplier = Number(getAnalysisFocusProfile(options.analysisFocus).deploymentSectors || 1);
  const maxCount = Math.max(1, 4 - Math.min(safeArray(existingSectors).length, 2));

  return safeArray(evidenceEntries)
    .map((entry, index) => {
      const texts = [entry.title, entry.summary, entry.text];
      const score = round((keywordScore(texts, deploymentKeywords) * 2.1 * focusMultiplier) + (entry.location ? 0.4 : 0), 2);
      return {
        entry,
        score,
        direction: resolveDeploymentDirection(entry.text, index),
      };
    })
    .filter((item) => item.score > 1.2)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxCount)
    .map(({ entry, score, direction }, index) => {
      const center = entry.location || offsetCoordinate(
        anchorPack.categoryAnchors?.deploymentSectors || anchorPack.primary || [120.18, 30.28, 0],
        direction.offset[0],
        direction.offset[1],
      );
      const posture = resolveDeploymentPosture(entry.text);

      return {
        id: `deployment-text-${index + 1}`,
        name: `${direction.label}部署方向`,
        center,
        polygon: buildThreatBoxPolygon(center, 0.08, 0.06),
        unitCount: Math.max(2, Math.round(1 + score * 0.7)),
        averageStrength: round(clamp(50 + score * 7.5, 0, 100), 1),
        posture,
        source: entry.sourceLabel,
        evidence: buildEvidenceReferences(entry, '文档推断部署态势'),
        units: [{
          id: entry.id,
          name: entry.sourceLabel,
          category: '文档证据',
          role: posture,
          strength: round(clamp(46 + score * 6.5, 0, 100), 1),
          readiness: posture,
        }],
        inferredFromText: true,
      };
    });
}
function buildSelectedIntelligence(dataset, camp, sourceIdSet) {
  return safeArray(dataset.intelligence).filter((item) => (
    item.camp === camp
    && (!sourceIdSet || sourceIdSet.has(Number(item.sourceId)))
  ));
}

function resolveAreaLabel(name = '', camp = 'red') {
  const prefix = camp === 'red' ? '红方' : camp === 'blue' ? '蓝方' : '';
  const normalized = String(name || '').replace(prefix, '').trim();
  return normalized.slice(0, Math.min(2, normalized.length)) || '重点';
}

function createArtifact(name, description, status = 'available') {
  return {
    name,
    description,
    status,
  };
}

function findMethodLabel(methods = [], key = '') {
  return safeArray(methods).find((item) => item.key === key)?.label || key;
}

function buildThreatIntentions(redIntelligence = [], evidenceCorpus = [], builtinMethodKey = 'knowledge-fusion', analysisFocus = 'comprehensive') {
  const unitCorpus = buildIntelligenceText(redIntelligence);
  const focusProfile = getAnalysisFocusProfile(analysisFocus);

  return sortByScore(THREAT_INTENT_DEFINITIONS.map((definition) => {
    const relatedUnits = redIntelligence.filter((item) => includesAny([
      item.name,
      item.category,
      item.role,
      safeArray(item.tags).join(' '),
      item.notes,
    ].join(' '), definition.keywords));

    let score = 42 + relatedUnits.length * 9 + keywordScore([...unitCorpus, ...evidenceCorpus], definition.keywords) * 1.5;
    if (builtinMethodKey === 'coverage-priority' && definition.emphasis === 'coverage') {
      score += 8;
    }
    if (analysisFocus === 'coverage' && definition.emphasis === 'coverage') {
      score += 6 * Number(focusProfile.fireCoverage || 1);
    }
    if (analysisFocus === 'air-defense' && ['coverage', 'information'].includes(definition.emphasis)) {
      score += 5 * Number(focusProfile.airDefenseSystem || 1);
    }

    return {
      id: definition.key,
      name: definition.name,
      score: round(clamp(score, 0, 100), 1),
      description: definition.description,
      evidence: uniqueList([
        ...relatedUnits.slice(0, 2).map((item) => `${item.name}：${item.role}`),
        ...evidenceCorpus.filter((item) => includesAny(item, definition.keywords)).slice(0, 2).map((item) => toShortText(item, 72)),
      ]).slice(0, 4),
    };
  })).slice(0, 4);
}

function buildDeploymentSectors(redIntelligence = []) {
  const groups = new Map();

  for (const item of safeArray(redIntelligence)) {
    const sectorKey = safeArray(item.tags).find((tag) => /^red-/.test(String(tag))) || resolveAreaLabel(item.name, 'red');
    if (!groups.has(sectorKey)) {
      groups.set(sectorKey, []);
    }
    groups.get(sectorKey).push(item);
  }

  return [...groups.values()]
    .map((units, index) => {
      const points = units.map((item) => [item.longitude, item.latitude, 0]);
      return {
        id: createSequence('sector', index),
        name: `${resolveAreaLabel(units[0]?.name, 'red')}方向`,
        center: [
          round(average(points.map((item) => item[0])), 4),
          round(average(points.map((item) => item[1])), 4),
          0,
        ],
        polygon: buildBoundingPolygon(points, 0.05 + Math.min(0.03, units.length * 0.004)),
        unitCount: units.length,
        averageStrength: round(average(units.map((item) => item.strength)), 1),
        posture: uniqueList(units.map((item) => item.readiness))[0] || '机动部署',
        units: units.slice(0, 6).map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          role: item.role,
          strength: item.strength,
          readiness: item.readiness,
        })),
      };
    })
    .sort((left, right) => right.unitCount - left.unitCount || right.averageStrength - left.averageStrength)
    .slice(0, 4);
}

function buildThreatCoverage(redIntelligence = [], builtinMethodKey = 'knowledge-fusion') {
  const coverageKeywords = ['火力', '炮兵', '打击', '导弹', '压制', '突击', '主战'];
  const candidates = redIntelligence.filter((item) => includesAny([
    item.name,
    item.category,
    item.role,
    safeArray(item.tags).join(' '),
  ].join(' '), coverageKeywords));

  const coverageUnits = candidates.length ? candidates : sortByScore(redIntelligence.map((item) => ({
    ...item,
    threatSeed: Number(item.strength || 0),
  })), 'threatSeed');

  return coverageUnits.slice(0, 5).map((item, index) => {
    const radiusMeters = Math.round(14000 + Number(item.strength || 1) * 2200 + (builtinMethodKey === 'coverage-priority' ? 3000 : 0));
    return {
      id: createSequence('fire-coverage', index),
      name: `${item.name}火力覆盖圈`,
      sourceUnitId: item.id,
      center: [round(item.longitude, 4), round(item.latitude, 4), 0],
      radiusMeters,
      coverageKm: round(radiusMeters / 1000, 1),
      threatValue: round(clamp(50 + Number(item.strength || 0) * 6 + (String(item.readiness || '').includes('机动') ? 4 : 0), 0, 100), 1),
      notes: `${item.category} / ${item.role}`,
    };
  });
}

function buildAirDefenseSystem(redIntelligence = []) {
  const keywords = ['防空', '警戒', '拦截', '预警', '雷达'];
  return redIntelligence
    .filter((item) => includesAny([
      item.name,
      item.category,
      item.role,
      safeArray(item.tags).join(' '),
      item.notes,
    ].join(' '), keywords))
    .slice(0, 5)
    .map((item, index) => ({
      id: createSequence('air-defense', index),
      name: item.name,
      coverageKm: round((8000 + Number(item.strength || 1) * 1800) / 1000, 1),
      strength: round(clamp(48 + Number(item.strength || 0) * 7, 0, 100), 1),
      location: [round(item.longitude, 4), round(item.latitude, 4), 0],
      role: item.role,
    }));
}

function buildReconEarlyWarning(redIntelligence = []) {
  const keywords = ['侦察', '监测', '预警', '无人', '监视', '探测'];
  return redIntelligence
    .filter((item) => includesAny([
      item.name,
      item.category,
      item.role,
      safeArray(item.tags).join(' '),
      item.notes,
    ].join(' '), keywords))
    .slice(0, 5)
    .map((item, index) => ({
      id: createSequence('recon-node', index),
      name: item.name,
      location: [round(item.longitude, 4), round(item.latitude, 4), 0],
      role: item.role,
      coverageKm: round((6000 + Number(item.strength || 1) * 1500) / 1000, 1),
      confidence: round(clamp(52 + Number(item.strength || 0) * 5, 0, 100), 1),
    }));
}

function buildAntiAirborneFacilities(redIntelligence = [], environment = []) {
  const keywords = ['反机降', '阻滞', '封控', '障碍', '低空', '工兵'];
  const facilities = redIntelligence
    .filter((item) => includesAny([
      item.name,
      item.category,
      item.role,
      safeArray(item.tags).join(' '),
      item.notes,
    ].join(' '), keywords))
    .slice(0, 4)
    .map((item, index) => ({
      id: createSequence('anti-airborne', index),
      name: item.name,
      source: '敌方节点识别',
      location: [round(item.longitude, 4), round(item.latitude, 4), 0],
      confidence: round(clamp(50 + Number(item.strength || 0) * 6, 0, 100), 1),
      description: `${item.role} / ${item.readiness}`,
    }));

  if (facilities.length) {
    return facilities;
  }

  return safeArray(environment)
    .filter((item) => item.kind === 'terrain' || item.kind === 'electromagnetic' || /^high$/i.test(String(item.riskLevel || '')) || String(item.riskLevel || '') === '高')
    .slice(0, 3)
    .map((item, index) => ({
      id: createSequence('anti-airborne-infer', index),
      name: `${item.name}反机降阻滞区`,
      source: '环境推断',
      location: item.geometryType === 'circle' ? toCoordinateTuple(item.geometry?.center) : computePolygonCenter(item.geometry),
      confidence: round(62 + index * 4, 1),
      description: `基于 ${item.kind} 环境与风险等级 ${item.riskLevel || '中'} 推断可能存在阻滞设施。`,
    }));
}
function resolveUnitSubtype(item = {}) {
  const source = [
    item.name,
    item.category,
    item.role,
    safeArray(item.tags).join(' '),
    item.notes,
  ].filter(Boolean).join(' ');

  if (includesAny(source, ['歼击', '战机', '飞机'])) return 'fighter';
  if (includesAny(source, ['无人', '侦察', '巡测'])) return 'uav';
  if (includesAny(source, ['防空', '拦截'])) return 'airDefense';
  if (includesAny(source, ['电子', '雷达', '预警'])) return 'radar';
  if (includesAny(source, ['补给', '通信', '保障'])) return 'transport';
  if (includesAny(source, ['舰', '海上'])) return 'destroyer';
  if (includesAny(source, ['火炮', '炮兵'])) return 'artillery';
  return 'tank';
}

function buildThreatVisualization(redIntelligence, deploymentSectors, fireCoverage, airDefenseSystem, threatLevel) {
  const pointEntities = safeArray(redIntelligence).slice(0, 10).map((item) => ({
    id: `threat-point-${item.id}`,
    name: item.name,
    type: 'unit',
    camp: 'red',
    layerKey: 'units',
    color: '#f97316',
    geometryType: 'point',
    coordinates: [round(item.longitude, 4), round(item.latitude, 4), 0],
    radius: null,
    annotation: `${item.category} · ${item.role}`,
    visible: true,
    meta: {
      unitSubtype: resolveUnitSubtype(item),
    },
  }));

  const coverageEntities = safeArray(fireCoverage).map((item) => ({
    id: `threat-coverage-${item.id}`,
    name: item.name,
    type: 'detection',
    camp: 'red',
    layerKey: 'detection',
    color: '#fb7185',
    geometryType: 'circle',
    coordinates: item.center,
    radius: item.radiusMeters,
    annotation: `覆盖半径 ${item.coverageKm} km`,
    visible: true,
    meta: {
      sensorType: 'radar',
      detectionHeadingStart: 0,
      detectionHeadingEnd: 360,
      detectionPitchStart: 0,
      detectionPitchEnd: 180,
    },
  }));

  const sectorEntities = safeArray(deploymentSectors).map((item) => ({
    id: `threat-sector-${item.id}`,
    name: item.name,
    type: 'zone',
    camp: 'neutral',
    layerKey: 'symbols',
    color: '#f59e0b',
    geometryType: 'polygon',
    coordinates: item.polygon,
    radius: null,
    annotation: `${item.unitCount} 个单位 / 平均强度 ${item.averageStrength}`,
    visible: true,
    meta: {},
  }));

  const environmentOverlays = [
    ...safeArray(fireCoverage).slice(0, 3).map((item, index) => ({
      id: 8000 + index,
      kind: 'threat-heat',
      name: `${item.name}热力区`,
      geometryType: 'circle',
      geometry: {
        center: item.center,
        radius: Math.round(item.radiusMeters * 0.82),
      },
      weather: `敌情威胁等级 ${threatLevel}`,
      riskLevel: threatLevel,
      notes: '用于三维球热力范围展示。',
      sourceId: 0,
    })),
    ...safeArray(deploymentSectors).slice(0, 2).map((item, index) => ({
      id: 8100 + index,
      kind: 'threat-sector',
      name: `${item.name}态势区`,
      geometryType: 'polygon',
      geometry: item.polygon,
      weather: '敌部署态势区',
      riskLevel: threatLevel,
      notes: '用于部署态势区展示。',
      sourceId: 0,
    })),
  ];

  return {
    entities: [
      ...pointEntities,
      ...coverageEntities,
      ...sectorEntities,
    ],
    environment: environmentOverlays,
    overlays: {
      fireCoverageCount: fireCoverage.length,
      airDefenseCount: airDefenseSystem.length,
      sectorCount: deploymentSectors.length,
    },
  };
}

function buildThreatImpactAnalysis(threatLevel, threatScore, fireCoverage, airDefenseSystem, reconEarlyWarning, antiAirborneFacilities, enemyIntentions) {
  return [
    {
      id: 'impact-1',
      title: '重点方向火力压制风险',
      level: fireCoverage.length >= 3 ? '高' : fireCoverage.length >= 1 ? '中' : '低',
      detail: fireCoverage.length
        ? `已识别 ${fireCoverage.length} 个主要火力覆盖圈，对主攻轴线和火力展开区形成明显压制。`
        : '当前敌火力覆盖信息有限，需继续补充侦察证据。',
    },
    {
      id: 'impact-2',
      title: '突防与低空活动受限',
      level: airDefenseSystem.length >= 2 || reconEarlyWarning.length >= 2 ? '高' : '中',
      detail: `防空节点 ${airDefenseSystem.length} 个、侦察预警节点 ${reconEarlyWarning.length} 个，低空平台活动暴露风险增大。`,
    },
    {
      id: 'impact-3',
      title: '敌方作战企图牵引任务排序',
      level: threatLevel,
      detail: enemyIntentions[0]
        ? `当前主导意图为“${enemyIntentions[0].name}”，建议优先压制与该意图相关的高价值节点。`
        : `当前威胁评分为 ${threatScore}，建议进一步明确敌方主导作战企图。`,
    },
    {
      id: 'impact-4',
      title: '反机降与区域拒止风险',
      level: antiAirborneFacilities.length >= 2 ? '中' : '低',
      detail: antiAirborneFacilities.length
        ? `已识别或推断 ${antiAirborneFacilities.length} 处反机降阻滞设施，对重点地域机动渗透形成限制。`
        : '尚未形成明显反机降阻滞链路，可保留对重点地形的持续监视。',
    },
  ];
}

function buildThreatVisualizationV2(
  redIntelligence = [],
  deploymentSectors = [],
  fireCoverage = [],
  airDefenseSystem = [],
  reconEarlyWarning = [],
  antiAirborneFacilities = [],
  threatLevel = '中',
  options = {},
) {
  const heatmapProfile = getHeatmapDensityProfile(options.heatmapDensity);

  const pointEntities = safeArray(redIntelligence).slice(0, 10).map((item) => ({
    id: `threat-point-${item.id}`,
    name: item.name,
    type: 'unit',
    camp: 'red',
    layerKey: 'units',
    color: '#f97316',
    geometryType: 'point',
    coordinates: [round(item.longitude, 4), round(item.latitude, 4), 0],
    radius: null,
    annotation: `${item.category} / ${item.role}`,
    visible: true,
    meta: {
      unitSubtype: resolveUnitSubtype(item),
    },
  }));

  const coverageEntities = safeArray(fireCoverage).map((item) => ({
    id: `threat-coverage-${item.id}`,
    name: item.name,
    type: 'detection',
    camp: 'red',
    layerKey: 'detection',
    color: '#fb7185',
    geometryType: 'circle',
    coordinates: item.center,
    radius: item.radiusMeters,
    annotation: `覆盖半径 ${item.coverageKm} km / 威胁 ${item.threatValue}`,
    visible: true,
    meta: {
      sensorType: 'radar',
      detectionHeadingStart: 0,
      detectionHeadingEnd: 360,
      detectionPitchStart: 0,
      detectionPitchEnd: 180,
    },
  }));

  const airDefenseEntities = safeArray(airDefenseSystem).slice(0, 5).map((item, index) => ({
    id: `threat-air-defense-${item.id || index + 1}`,
    name: item.name,
    type: 'unit',
    camp: 'red',
    layerKey: 'units',
    color: '#ef4444',
    geometryType: 'point',
    coordinates: item.location,
    radius: null,
    annotation: `防空覆盖 ${item.coverageKm} km / 强度 ${item.strength}`,
    visible: true,
    meta: {
      unitSubtype: 'airDefense',
    },
  }));

  const reconEntities = safeArray(reconEarlyWarning).slice(0, 5).map((item, index) => ({
    id: `threat-recon-${item.id || index + 1}`,
    name: item.name,
    type: 'unit',
    camp: 'red',
    layerKey: 'units',
    color: '#facc15',
    geometryType: 'point',
    coordinates: item.location,
    radius: null,
    annotation: `预警覆盖 ${item.coverageKm} km / 置信 ${item.confidence}`,
    visible: true,
    meta: {
      unitSubtype: 'radar',
    },
  }));

  const antiAirborneEntities = safeArray(antiAirborneFacilities).slice(0, 5).map((item, index) => ({
    id: `threat-anti-airborne-${item.id || index + 1}`,
    name: item.name,
    type: 'unit',
    camp: 'red',
    layerKey: 'units',
    color: '#f59e0b',
    geometryType: 'point',
    coordinates: item.location,
    radius: null,
    annotation: `反机降设施 / 置信 ${item.confidence}`,
    visible: true,
    meta: {
      unitSubtype: 'engineer',
    },
  }));

  const sectorEntities = safeArray(deploymentSectors).map((item) => ({
    id: `threat-sector-${item.id}`,
    name: item.name,
    type: 'zone',
    camp: 'neutral',
    layerKey: 'symbols',
    color: '#f59e0b',
    geometryType: 'polygon',
    coordinates: item.polygon,
    radius: null,
    annotation: `${item.unitCount} 个节点 / 平均强度 ${item.averageStrength}`,
    visible: true,
    meta: {},
  }));

  const environmentOverlays = [
    ...safeArray(fireCoverage)
      .slice(0, heatmapProfile.maxHeatRegions)
      .flatMap((item) => heatmapProfile.layerScales.map((scale, layerIndex) => ({
        id: `threat-heat-${item.id}-${layerIndex + 1}`,
        kind: 'threat-heat',
        name: `${item.name}威胁热区`,
        geometryType: 'circle',
        geometry: {
          center: item.center,
          radius: Math.round(item.radiusMeters * scale),
        },
        weather: `威胁强度 ${item.threatValue}`,
        riskLevel: resolveThreatLevel(item.threatValue),
        notes: `第 ${layerIndex + 1} 层威胁热区 / ${item.source || '敌方节点识别'}`,
        sourceId: 0,
        meta: {
          fillColor: layerIndex === 0 ? '#ef4444' : layerIndex === 1 ? '#f97316' : '#f59e0b',
          fillAlpha: heatmapProfile.layerAlphas[layerIndex] || 0.08,
          outlineColor: '#fb7185',
          outlineAlpha: Math.max(0.24, (heatmapProfile.layerAlphas[layerIndex] || 0.08) + 0.16),
          intensity: round(clamp(Number(item.threatValue || 0) / 100, 0.2, 1), 2),
        },
      }))),
    ...safeArray(deploymentSectors).slice(0, 3).map((item, index) => ({
      id: `threat-sector-overlay-${item.id || index + 1}`,
      kind: 'threat-sector',
      name: `${item.name}态势区`,
      geometryType: 'polygon',
      geometry: item.polygon,
      weather: `部署态势 ${item.posture || '重点部署'}`,
      riskLevel: threatLevel,
      notes: `部署方向 / ${item.source || '情报识别'}`,
      sourceId: 0,
      meta: {
        fillColor: '#f59e0b',
        fillAlpha: 0.13,
        outlineColor: '#fbbf24',
        outlineAlpha: 0.92,
      },
    })),
  ];

  return {
    entities: [
      ...pointEntities,
      ...coverageEntities,
      ...airDefenseEntities,
      ...reconEntities,
      ...antiAirborneEntities,
      ...sectorEntities,
    ],
    environment: environmentOverlays,
    overlays: {
      fireCoverageCount: fireCoverage.length,
      airDefenseCount: airDefenseSystem.length,
      sectorCount: deploymentSectors.length,
      heatLayerCount: environmentOverlays.filter((item) => item.kind === 'threat-heat').length,
    },
  };
}

function buildThreatImpactAnalysisV2(
  threatLevel,
  threatScore,
  fireCoverage,
  airDefenseSystem,
  reconEarlyWarning,
  antiAirborneFacilities,
  enemyIntentions,
  options = {},
) {
  const biasProfile = getImpactBiasProfile(options.impactBias);
  const firePressureScore = Number(fireCoverage.length || 0) * biasProfile.fireweight;
  const mobilityRestrictionScore = (Number(airDefenseSystem.length || 0) + Number(reconEarlyWarning.length || 0)) * biasProfile.mobilityWeight;
  const antiAirborneScore = Number(antiAirborneFacilities.length || 0) * biasProfile.antiAirborneWeight;

  return [
    {
      id: 'impact-1',
      title: '重点方向火力压制风险',
      level: firePressureScore >= 3 ? '高' : firePressureScore >= 1 ? '中' : '低',
      detail: fireCoverage.length
        ? `已识别 ${fireCoverage.length} 个主要火力覆盖圈，${options.impactBias === 'suppression' ? '建议优先组织压制与反火力打击。' : '建议在主攻轴线保持分散展开与窗口化机动。'}`
        : '当前敌火力覆盖信息有限，建议继续补充侦察证据或上传敌情材料。',
    },
    {
      id: 'impact-2',
      title: '突防与低空活动受限',
      level: mobilityRestrictionScore >= 3 ? '高' : mobilityRestrictionScore >= 1 ? '中' : '低',
      detail: `防空节点 ${airDefenseSystem.length} 个、侦察预警节点 ${reconEarlyWarning.length} 个，${options.impactBias === 'mobility' ? '低空机动与渗透路线规避需求显著上升。' : '主攻窗口内的平台暴露风险增加。'}`,
    },
    {
      id: 'impact-3',
      title: '敌方作战企图牵引任务排序',
      level: threatLevel,
      detail: enemyIntentions[0]
        ? `当前主导意图为“${enemyIntentions[0].name}”，建议围绕其相关节点组织优先侦察、压制或绕避。`
        : `当前威胁评分为 ${threatScore}，建议进一步明确敌方主导作战企图。`,
    },
    {
      id: 'impact-4',
      title: '反机降与区域拒止风险',
      level: antiAirborneScore >= 2 ? '中' : '低',
      detail: antiAirborneFacilities.length
        ? `已识别或推断 ${antiAirborneFacilities.length} 处反机降阻滞/封控设施，对重点地域机动渗透形成限制。`
        : '尚未形成明显反机降阻滞链路，可继续结合环境与文档线索补充识别。',
    },
    {
      id: 'impact-5',
      title: '分析重点建议',
      level: '提示',
      detail: biasProfile.narrative,
    },
  ];
}

async function runBuiltinThreatAnalysis(context, step, algorithm, input, dataset) {
  const sourceBundle = buildSourceBundle(dataset, input.selectedSourceIds);
  const uploadedFiles = await normalizeUploadedFiles(input.uploadedFiles);
  const redIntelligence = buildSelectedIntelligence(dataset, 'red', sourceBundle.sourceIdSet);
  const appliedOptions = cloneData(input.options || {});
  const methodLabel = findMethodLabel(algorithm.builtinMethods, input.builtinMethodKey);
  const anchorPack = buildThreatAnchorPack(
    redIntelligence,
    sourceBundle.selectedEnvironment,
    appliedOptions.heatmapDensity,
  );
  const evidenceCorpus = buildEvidenceCorpus([
    sourceBundle.selectedPreviews.map(previewPayloadToText),
    sourceBundle.selectedExtractions.map((item) => item.summary || item.text),
    uploadedFiles.flatMap((item) => item.extractionDrafts.map((draft) => draft.summary || draft.text)),
    buildIntelligenceText(redIntelligence),
    buildEnvironmentText(sourceBundle.selectedEnvironment),
  ]);
  const evidenceEntries = buildThreatEvidenceEntries(
    sourceBundle,
    uploadedFiles,
    redIntelligence,
    sourceBundle.selectedEnvironment,
    anchorPack,
  );
  const focusProfile = getAnalysisFocusProfile(appliedOptions.analysisFocus);

  const enemyIntentions = buildThreatIntentions(
    redIntelligence,
    evidenceCorpus,
    input.builtinMethodKey,
    appliedOptions.analysisFocus,
  );
  const baseDeploymentSectors = buildDeploymentSectors(redIntelligence);
  const baseFireCoverage = buildThreatCoverage(redIntelligence, input.builtinMethodKey);
  const baseAirDefenseSystem = buildAirDefenseSystem(redIntelligence);
  const baseReconEarlyWarning = buildReconEarlyWarning(redIntelligence);
  const baseAntiAirborneFacilities = buildAntiAirborneFacilities(redIntelligence, sourceBundle.selectedEnvironment);
  const deploymentSectors = mergeThreatItems(
    baseDeploymentSectors,
    buildTextDeploymentSectors(evidenceEntries, anchorPack, appliedOptions, baseDeploymentSectors),
    'averageStrength',
  );
  const fireCoverage = mergeThreatItems(
    baseFireCoverage,
    buildTextThreatCollection(
      'fireCoverage',
      evidenceEntries,
      anchorPack,
      appliedOptions,
      input.builtinMethodKey,
      baseFireCoverage,
    ),
    'threatValue',
  );
  const airDefenseSystem = mergeThreatItems(
    baseAirDefenseSystem,
    buildTextThreatCollection(
      'airDefenseSystem',
      evidenceEntries,
      anchorPack,
      appliedOptions,
      input.builtinMethodKey,
      baseAirDefenseSystem,
    ),
    'strength',
  );
  const reconEarlyWarning = mergeThreatItems(
    baseReconEarlyWarning,
    buildTextThreatCollection(
      'reconEarlyWarning',
      evidenceEntries,
      anchorPack,
      appliedOptions,
      input.builtinMethodKey,
      baseReconEarlyWarning,
    ),
    'confidence',
  );
  const antiAirborneFacilities = mergeThreatItems(
    baseAntiAirborneFacilities,
    buildTextThreatCollection(
      'antiAirborneFacilities',
      evidenceEntries,
      anchorPack,
      appliedOptions,
      input.builtinMethodKey,
      baseAntiAirborneFacilities,
    ),
    'confidence',
  );
  const identifiedThreatNodeCount = fireCoverage.length
    + airDefenseSystem.length
    + reconEarlyWarning.length
    + antiAirborneFacilities.length;
  const firePressure = average(fireCoverage.map((item) => item.threatValue));
  const airDefensePressure = average(airDefenseSystem.map((item) => item.strength));
  const reconPressure = average(reconEarlyWarning.map((item) => item.confidence));
  const antiAirbornePressure = average(antiAirborneFacilities.map((item) => item.confidence));
  const threatScore = round(clamp(
    16
    + Math.min(14, redIntelligence.length * 0.4)
    + Math.min(14, average(redIntelligence.map((item) => item.strength)) * 2.4)
    + Math.min(14, firePressure * 0.18 * focusProfile.fireCoverage)
    + Math.min(11, airDefensePressure * 0.14 * focusProfile.airDefenseSystem)
    + Math.min(9, reconPressure * 0.11 * focusProfile.reconEarlyWarning)
    + Math.min(8, antiAirbornePressure * 0.1 * focusProfile.antiAirborneFacilities)
    + Math.min(8, deploymentSectors.length * 1.6 * focusProfile.deploymentSectors)
    + Math.min(8, identifiedThreatNodeCount * 1.15)
    + Math.min(8, evidenceEntries.length * 0.55),
    0,
    100,
  ), 1);
  const threatLevel = resolveThreatLevel(threatScore);
  const visualization = buildThreatVisualizationV2(
    redIntelligence,
    deploymentSectors,
    fireCoverage,
    airDefenseSystem,
    reconEarlyWarning,
    antiAirborneFacilities,
    threatLevel,
    appliedOptions,
  );
  const impactAnalysis = buildThreatImpactAnalysisV2(
    threatLevel,
    threatScore,
    fireCoverage,
    airDefenseSystem,
    reconEarlyWarning,
    antiAirborneFacilities,
    enemyIntentions,
    appliedOptions,
  );

  return {
    summary: `已基于 ${findMethodLabel(algorithm.builtinMethods, input.builtinMethodKey)} 完成敌情威胁分析，融合 ${redIntelligence.length} 条敌方情报记录与 ${uploadedFiles.length} 份上传材料。`,
    outputPreview: [
      `敌情威胁等级：${threatLevel}（评分 ${threatScore}）`,
      `识别敌方部署方向 ${deploymentSectors.length} 个、火力覆盖圈 ${fireCoverage.length} 个、防空节点 ${airDefenseSystem.length} 个`,
      enemyIntentions[0] ? `当前主导敌方作战企图：${enemyIntentions[0].name}` : '当前尚未识别到明显主导敌方作战企图',
    ],
    artifacts: [
      createArtifact('敌情威胁模型', '包含敌方作战企图、部署态势、火力覆盖、防空体系和反机降设施的结构化模型。'),
      createArtifact('三维球威胁标注', '输出三维球标注实体和热力区，支持态势可视化展示。'),
      createArtifact('作战影响分析', '结合威胁等级与关键节点生成对后续兵力编组和目标分配的影响分析。'),
    ],
    structuredOutput: {
      implementationStatus: 'implemented',
      builtinMethodKey: input.builtinMethodKey,
      builtinMethodLabel: methodLabel,
      appliedOptions,
      inputSummary: {
        selectedSourceCount: sourceBundle.selectedSources.length,
        selectedExtractionCount: sourceBundle.selectedExtractions.length,
        uploadedFileCount: uploadedFiles.length,
        redIntelligenceCount: redIntelligence.length,
        environmentCount: sourceBundle.selectedEnvironment.length,
        evidenceCount: evidenceCorpus.length,
        evidenceEntryCount: evidenceEntries.length,
      },
      selectedSources: sourceBundle.selectedSources.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
      })),
      importedFiles: uploadedFiles.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        fileExtension: item.fileExtension,
        summary: item.summary,
      })),
      evidenceTrace: buildEvidenceTraceEntries(evidenceEntries, 60),
      threatLevel,
      threatScore,
      enemyUnitCount: redIntelligence.length,
      identifiedThreatNodeCount,
      enemyIntentions,
      deploymentSectors,
      fireCoverage,
      airDefenseSystem,
      reconEarlyWarning,
      antiAirborneFacilities,
      impactAnalysis,
      visualization,
    },
  };
}

function classifyGroupingRole(item = {}) {
  const source = [
    item.name,
    item.category,
    item.role,
    safeArray(item.tags).join(' '),
    item.notes,
  ].filter(Boolean).join(' ');

  if (includesAny(source, ['侦察', '预警', '巡测', '无人', '探测'])) return 'recon';
  if (includesAny(source, ['防空', '警戒', '拦截', '电子', '雷达'])) return 'cover';
  if (includesAny(source, ['保障', '补给', '通信', '后勤'])) return 'sustain';
  if (includesAny(source, ['火炮', '炮兵', '导弹', '歼击', '主战', '突击', '装甲', '两栖', '压制'])) return 'strike';
  return 'support';
}

function buildUnitCapability(item = {}) {
  const role = classifyGroupingRole(item);
  const strength = Number(item.strength || 1);
  const capability = {
    firepower: strength * 4,
    protection: strength * 2.4,
    reconCoverage: strength * 2.2,
    endurance: strength * 2,
    mobility: strength * 2.5,
  };

  if (role === 'strike') capability.firepower += 14;
  if (role === 'cover') capability.protection += 12;
  if (role === 'recon') capability.reconCoverage += 12;
  if (role === 'sustain') capability.endurance += 12;
  if (includesAny(item.role, ['机动', '突击', '两栖', '升空'])) capability.mobility += 5;

  return {
    role,
    firepower: round(clamp(capability.firepower, 0, 100), 1),
    protection: round(clamp(capability.protection, 0, 100), 1),
    reconCoverage: round(clamp(capability.reconCoverage, 0, 100), 1),
    endurance: round(clamp(capability.endurance, 0, 100), 1),
    mobility: round(clamp(capability.mobility, 0, 100), 1),
  };
}

function createGroupingBuckets() {
  return {
    'main-strike': {
      id: 'main-strike',
      name: '主攻火力群',
      role: '负责高价值目标压制与主突击打击',
      units: [],
    },
    'cover-support': {
      id: 'cover-support',
      name: '掩护支援群',
      role: '负责防空掩护、电子支援与火力补充',
      units: [],
    },
    'recon-warning': {
      id: 'recon-warning',
      name: '侦察预警群',
      role: '负责前沿侦察、态势更新与效果回传',
      units: [],
    },
    'sustain-command': {
      id: 'sustain-command',
      name: '保障协同群',
      role: '负责通信指挥、保障补给与持续协同',
      units: [],
    },
  };
}

function appendToBucket(buckets, bucketKey, item) {
  if (!buckets[bucketKey]) {
    buckets[bucketKey] = {
      id: bucketKey,
      name: bucketKey,
      role: '',
      units: [],
    };
  }
  buckets[bucketKey].units.push(item);
}

function pickBucketForUnit(methodKey, item, buckets, threatLevel = '中') {
  const role = classifyGroupingRole(item);
  const bucketValues = Object.values(buckets);

  if (methodKey === 'rule-inference') {
    if (role === 'strike') return 'main-strike';
    if (role === 'recon') return 'recon-warning';
    if (role === 'cover') return 'cover-support';
    if (role === 'sustain') return 'sustain-command';
    return 'cover-support';
  }

  if (methodKey === 'genetic-optimization') {
    const scoredBuckets = bucketValues.map((bucket) => {
      const currentStrength = sumBy(bucket.units, (unit) => unit.strength);
      let score = 20 - currentStrength * 0.8;
      if (bucket.id === 'main-strike' && role === 'strike') score += 18;
      if (bucket.id === 'recon-warning' && role === 'recon') score += 16;
      if (bucket.id === 'cover-support' && (role === 'cover' || (threatLevel === '高' && role === 'support'))) score += 14;
      if (bucket.id === 'sustain-command' && role === 'sustain') score += 16;
      if (bucket.units.length === 0) score += 5;
      return { bucketKey: bucket.id, score };
    });
    return sortByScore(scoredBuckets, 'score')[0]?.bucketKey || 'cover-support';
  }

  const scoredBuckets = bucketValues.map((bucket) => {
    const currentStrength = sumBy(bucket.units, (unit) => unit.strength);
    let score = 16 - bucket.units.length * 2.6 - currentStrength * 0.35;
    if (bucket.id === 'main-strike' && role === 'strike') score += 12;
    if (bucket.id === 'recon-warning' && role === 'recon') score += 10;
    if (bucket.id === 'cover-support' && role === 'cover') score += 10;
    if (bucket.id === 'sustain-command' && role === 'sustain') score += 10;
    if (bucket.id === 'cover-support' && role === 'support') score += 6;
    return { bucketKey: bucket.id, score };
  });
  return sortByScore(scoredBuckets, 'score')[0]?.bucketKey || 'cover-support';
}

function buildGroupProfiles(groups = []) {
  return safeArray(groups)
    .map((group) => {
      const capabilities = group.units.map(buildUnitCapability);
      const normalizer = Math.max(group.units.length, 1);
      return {
        id: group.id,
        name: group.name,
        role: group.role,
        unitCount: group.units.length,
        totalStrength: round(sumBy(group.units, (item) => item.strength), 1),
        firepower: round(clamp((sumBy(capabilities, (item) => item.firepower) / normalizer) * 1.16, 0, 100), 1),
        protection: round(clamp((sumBy(capabilities, (item) => item.protection) / normalizer) * 1.12, 0, 100), 1),
        reconCoverage: round(clamp((sumBy(capabilities, (item) => item.reconCoverage) / normalizer) * 1.12, 0, 100), 1),
        endurance: round(clamp((sumBy(capabilities, (item) => item.endurance) / normalizer) * 1.12, 0, 100), 1),
        mobility: round(clamp((sumBy(capabilities, (item) => item.mobility) / normalizer) * 1.08, 0, 100), 1),
        categories: uniqueList(group.units.map((item) => item.category)).slice(0, 6),
        units: group.units.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          role: item.role,
          strength: item.strength,
          readiness: item.readiness,
        })),
      };
    })
    .filter((group) => group.unitCount > 0);
}

function normalizeWeights(weights = {}) {
  const total = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number(value || 0) / total]));
}

function buildSchemeMetrics(groupProfiles = []) {
  const groupStrengths = groupProfiles.map((item) => Number(item.totalStrength || 0));
  return {
    firepower: round(average(groupProfiles.map((item) => item.firepower)), 1),
    protection: round(average(groupProfiles.map((item) => item.protection)), 1),
    reconCoverage: round(average(groupProfiles.map((item) => item.reconCoverage)), 1),
    endurance: round(average(groupProfiles.map((item) => item.endurance)), 1),
    mobility: round(average(groupProfiles.map((item) => item.mobility)), 1),
    balance: round(clamp(100 - standardDeviation(groupStrengths) * 5.5, 0, 100), 1),
    strengthTotal: round(sumBy(groupProfiles, (item) => item.totalStrength), 1),
  };
}

function calculateSchemeScore(metrics, ruleLibrary, comparisonFocus = 'balanced', threatLevel = '中') {
  if (!Number(metrics?.strengthTotal || 0)) {
    return 0;
  }

  const adjustedWeights = {
    ...safeObject(ruleLibrary?.weights),
  };

  if (comparisonFocus === 'firepower-first') {
    adjustedWeights.firepower += 0.06;
    adjustedWeights.protection -= 0.02;
    adjustedWeights.balance -= 0.02;
  }
  if (comparisonFocus === 'survivability-first') {
    adjustedWeights.protection += 0.05;
    adjustedWeights.endurance += 0.03;
    adjustedWeights.firepower -= 0.04;
  }
  if (threatLevel === '高') {
    adjustedWeights.protection += 0.03;
    adjustedWeights.endurance += 0.02;
    adjustedWeights.firepower -= 0.02;
  }

  const weights = normalizeWeights(adjustedWeights);
  const weightedScore = (
    metrics.firepower * weights.firepower
    + metrics.protection * weights.protection
    + metrics.reconCoverage * weights.reconCoverage
    + metrics.endurance * weights.endurance
    + metrics.mobility * weights.mobility
    + metrics.balance * weights.balance
  );
  return round(clamp(18 + weightedScore * 1.6, 0, 100), 1);
}

function buildSchemeNarrative(scheme, threatLevel) {
  const metricEntries = Object.entries(scheme.metrics)
    .filter(([key]) => ['firepower', 'protection', 'reconCoverage', 'endurance', 'mobility', 'balance'].includes(key))
    .map(([key, value]) => ({ key, value }));
  const strongestMetric = sortByScore(metricEntries, 'value')[0]?.key || 'firepower';
  const weakestMetric = [...metricEntries].sort((left, right) => left.value - right.value)[0]?.key || 'balance';
  const metricLabels = {
    firepower: '火力集中度',
    protection: '掩护防护能力',
    reconCoverage: '侦察覆盖能力',
    endurance: '持续保障能力',
    mobility: '机动转换能力',
    balance: '群组均衡度',
  };

  return {
    advantages: [
      `方案在${metricLabels[strongestMetric]}上表现最好，适合应对${threatLevel}威胁环境。`,
      '主攻群与支援群之间保持了较稳定的任务分工和强度配置。',
    ],
    tradeoffs: [
      `当前方案的${metricLabels[weakestMetric]}相对较弱，需在执行阶段补充约束校核。`,
      '若敌情快速变化，建议优先关注侦察预警与保障协同链路的动态调整。',
    ],
  };
}

function buildGroupingSourceTextV2(item = {}) {
  return [
    item.name,
    item.category,
    item.role,
    item.readiness,
    safeArray(item.tags).join(' '),
    item.notes,
  ].filter(Boolean).join(' ');
}

function buildGroupingWeightSummary(weights = {}) {
  return Object.entries(GROUPING_METRIC_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      percent: round((Number(weights[key] || 0) * 100), 1),
    }))
    .sort((left, right) => right.percent - left.percent);
}

function buildGroupingEvidenceEntries(sourceBundle = {}, uploadedFiles = [], blueIntelligence = [], threatOutput = {}) {
  const sourcesById = new Map(safeArray(sourceBundle.selectedSources).map((item) => [Number(item.id), item]));
  const entries = [];

  safeArray(sourceBundle.selectedPreviews).forEach((preview, index) => {
    const source = sourcesById.get(Number(preview.sourceId));
    const previewPayload = safeObject(preview.payload);
    const entry = createThreatEvidenceEntry({
      id: `group-preview-${preview.sourceId}-${index + 1}`,
      title: source?.name || preview.title || `数据源 ${preview.sourceId}`,
      text: previewPayloadToText(preview),
      summary: preview.description || preview.summary || '',
      sourceType: 'resource-preview',
      sourceId: preview.sourceId,
      sourceLabel: source?.name || preview.title || '资源库预览',
      sourceName: source?.name || preview.title || '资源库预览',
      fileName: String(previewPayload.fileName || previewPayload.title || '').trim(),
      extractedAt: String(preview.createdAt || '').trim(),
    });
    if (entry) {
      entries.push(entry);
    }
  });

  safeArray(sourceBundle.selectedExtractions).forEach((item, index) => {
    const source = sourcesById.get(Number(item.sourceId));
    const entry = createThreatEvidenceEntry({
      id: `group-extraction-${item.id || index + 1}`,
      title: item.title || source?.name || '抽取结果',
      text: item.text || item.summary || '',
      summary: item.summary || '',
      sourceType: item.sourceType || 'resource-extraction',
      sourceId: item.sourceId,
      sourceLabel: source?.name || item.sourceName || item.title || '资源库抽取',
      sourceName: item.sourceName || source?.name || item.title || '资源库抽取',
      fileName: item.fileName || '',
      extractedAt: item.createdAt || item.extractedAt || '',
    });
    if (entry) {
      entries.push(entry);
    }
  });

  safeArray(uploadedFiles).forEach((file, fileIndex) => {
    const previewText = previewPayloadToText({
      previewType: file.previewType,
      payload: file.preview,
    });
    const fileEntries = safeArray(file.extractionDrafts).length
      ? file.extractionDrafts
      : [{
          title: file.fileName,
          text: previewText || file.summary || '',
          summary: file.summary || toShortText(previewText, 140),
        }];

    fileEntries.forEach((draft, draftIndex) => {
      const entry = createThreatEvidenceEntry({
        id: `${file.id || `group-upload-${fileIndex + 1}`}-${draftIndex + 1}`,
        title: draft.title || file.fileName,
        text: draft.text || draft.summary || '',
        summary: draft.summary || file.summary || '',
        sourceType: 'uploaded-file',
        sourceLabel: file.fileName || '本地上传文件',
        sourceName: draft.sourceName || file.fileName || '本地上传文件',
        fileName: draft.fileName || file.fileName || '',
        extractedAt: draft.extractedAt || '',
      });
      if (entry) {
        entries.push(entry);
      }
    });
  });

  safeArray(blueIntelligence).forEach((item, index) => {
    const entry = createThreatEvidenceEntry({
      id: `blue-intel-${item.id || index + 1}`,
      title: item.name || `蓝方兵力 ${index + 1}`,
      text: buildGroupingSourceTextV2(item),
      summary: [item.category, item.role, item.readiness].filter(Boolean).join(' / '),
      sourceType: 'blue-intelligence',
      sourceId: item.id,
      sourceLabel: item.name || '蓝方兵力',
      sourceName: item.name || '蓝方兵力',
    });
    if (entry) {
      entries.push(entry);
    }
  });

  if (threatOutput.threatLevel) {
    const threatEntry = createThreatEvidenceEntry({
      id: 'group-threat-handoff',
      title: '威胁分析输入',
      text: [
        `威胁等级 ${threatOutput.threatLevel}`,
        ...safeArray(threatOutput.enemyIntentions).map((item) => `${item.name} ${item.description || ''}`),
        ...safeArray(threatOutput.impactAnalysis).map((item) => `${item.title} ${item.detail || ''}`),
      ].join(' '),
      summary: `威胁等级 ${threatOutput.threatLevel} / 火力覆盖 ${safeArray(threatOutput.fireCoverage).length} / 防空节点 ${safeArray(threatOutput.airDefenseSystem).length}`,
      sourceType: 'threat-handoff',
      sourceLabel: '敌情威胁分析结果',
      sourceName: '敌情威胁分析结果',
      extractedAt: String(threatOutput.generatedAt || '').trim(),
    });
    if (threatEntry) {
      entries.push(threatEntry);
    }
  }

  return entries;
}

function resolveGroupingReadinessV2(text = '') {
  if (includesAny(text, ['持续', '轮换', '满编', '联勤', '补给'])) return '持续保障';
  if (includesAny(text, ['升空', '装载', '机动', '突击', '投送'])) return '机动待命';
  if (includesAny(text, ['值守', '值班', '警戒', '跟踪'])) return '值守';
  if (includesAny(text, ['待机', '待命'])) return '待机';
  return '待命';
}

function buildDocumentGroupingCandidates(evidenceEntries = [], maxCount = 6) {
  const inferredUnits = safeArray(evidenceEntries)
    .filter((entry) => ['resource-preview', 'resource-extraction', 'uploaded-file'].includes(entry.sourceType))
    .flatMap((entry) => {
      const segments = uniqueList([
        ...String(entry.text || '').split(/\n+/),
        ...String(entry.text || '').split(/[；;]+/),
      ])
        .map((item) => String(item || '').trim())
        .filter((item) => item.length >= 4 && !includesAny(item, ['工作表', 'sheet']));

      const resolvedSegments = segments.length ? segments : [entry.text || entry.summary || entry.title];

      return resolvedSegments.map((segment, segmentIndex) => {
        const texts = [entry.title, entry.summary, segment];
        const bestMatch = sortByScore(GROUPING_DOCUMENT_FORCE_DEFINITIONS.map((definition) => ({
          definition,
          score: keywordScore(texts, definition.keywords),
        })), 'score')[0];

        if (!bestMatch?.score) {
          return null;
        }

        const explicitName = String(segment || '').match(/(?:装备|名称|平台|单元|兵力|分队|编组)[:：]\s*([^\s；;，,]+)/)?.[1] || '';
        const normalizedName = explicitName || toShortText(segment.replace(/^(装备|名称|平台|单元|兵力|分队|编组)[:：]/, '').trim(), 16);

        return {
          id: `doc-force-${entry.id}-${segmentIndex + 1}`,
          name: normalizedName || resolveThreatEvidenceName(entry, bestMatch.definition.nameSuffix),
          category: bestMatch.definition.category,
          role: bestMatch.definition.roleLabel,
          strength: round(clamp(1.8 + bestMatch.score * 0.9, 1, 8), 1),
          readiness: resolveGroupingReadinessV2([entry.summary, segment].filter(Boolean).join(' ')),
          tags: bestMatch.definition.keywords.filter((item) => includesAny(segment, [item])).slice(0, 3),
          notes: `由 ${entry.sourceLabel} 文档内容推断的候选兵力单元。`,
          derivedFromText: true,
          evidence: uniqueList([
            ...buildEvidenceReferences(entry, '文档推断兵力'),
            toShortText(segment, 72),
          ]).slice(0, 3),
        };
      }).filter(Boolean);
    });

  const merged = new Map();
  inferredUnits.forEach((item) => {
    const key = textOf(item.name);
    if (!merged.has(key) || Number(merged.get(key).strength || 0) < Number(item.strength || 0)) {
      merged.set(key, item);
    }
  });
  return [...merged.values()].slice(0, maxCount);
}

function mergeGroupingCandidates(baseUnits = [], inferredUnits = [], expectedGroupCount = 4) {
  const merged = [];
  const seen = new Set();

  safeArray(baseUnits).forEach((item) => {
    const key = textOf(item.id || item.name);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(cloneData(item));
  });

  const supplementLimit = merged.length
    ? Math.max(0, Number(expectedGroupCount || 0) - merged.length)
    : safeArray(inferredUnits).length;

  safeArray(inferredUnits).slice(0, supplementLimit).forEach((item) => {
    const key = textOf(item.id || item.name);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(cloneData(item));
  });

  return merged;
}

function resolveActualGroupingCount(expectedGroupCount = 4, unitCount = 0) {
  const preferredCount = clamp(Math.round(Number(expectedGroupCount || 4)), 3, 6);
  if (!unitCount) {
    return preferredCount;
  }
  return Math.max(1, Math.min(preferredCount, Number(unitCount || 0)));
}

function buildGroupingBlueprints(ruleLibraryKey = 'fire-strike-rules', groupCount = 4) {
  const blueprintLibrary = GROUPING_BUCKET_BLUEPRINTS[ruleLibraryKey] || GROUPING_BUCKET_BLUEPRINTS['fire-strike-rules'];
  const normalizedCount = clamp(Math.round(Number(groupCount || 4)), 3, 6);
  const exactBlueprints = blueprintLibrary[normalizedCount] || blueprintLibrary[4] || [];
  const targetCount = Math.max(1, Math.min(Number(groupCount || normalizedCount), exactBlueprints.length || normalizedCount));

  if (targetCount >= 3) {
    return cloneData(exactBlueprints.slice(0, targetCount));
  }

  const fallbackBlueprints = blueprintLibrary[3] || exactBlueprints;
  if (targetCount === 2) {
    return cloneData([fallbackBlueprints[0], fallbackBlueprints[fallbackBlueprints.length - 1]].filter(Boolean));
  }
  return cloneData([fallbackBlueprints[0]].filter(Boolean));
}

function buildAdvancedUnitCapability(item = {}) {
  const role = classifyGroupingRole(item);
  const source = buildGroupingSourceTextV2(item);
  const strength = Number(item.strength || 1);
  const capability = {
    firepower: strength * 4.2,
    protection: strength * 2.8,
    reconCoverage: strength * 2.4,
    endurance: strength * 2.2,
    mobility: strength * 2.8,
  };

  if (role === 'strike') capability.firepower += 16;
  if (role === 'cover') capability.protection += 14;
  if (role === 'recon') capability.reconCoverage += 14;
  if (role === 'sustain') capability.endurance += 14;
  if (includesAny(source, ['远程', '精确', '装甲', '大口径', '导弹'])) capability.firepower += 5;
  if (includesAny(source, ['防护', '护卫', '警戒', '拦截'])) capability.protection += 4.5;
  if (includesAny(source, ['侦察', '预警', '监视', '雷达', '无人'])) capability.reconCoverage += 5;
  if (includesAny(source, ['保障', '补给', '维修', '通信', '联勤', '满编'])) capability.endurance += 5;
  if (includesAny(source, ['机动', '突击', '两栖', '升空', '运输', '直升机', '投送'])) capability.mobility += 6;

  return {
    role,
    firepower: round(clamp(capability.firepower, 0, 100), 1),
    protection: round(clamp(capability.protection, 0, 100), 1),
    reconCoverage: round(clamp(capability.reconCoverage, 0, 100), 1),
    endurance: round(clamp(capability.endurance, 0, 100), 1),
    mobility: round(clamp(capability.mobility, 0, 100), 1),
  };
}

function buildGroupingUnitProfile(item = {}) {
  const capability = buildAdvancedUnitCapability(item);
  const readinessText = String(item.readiness || '');
  let readinessScore = 56;
  if (includesAny(readinessText, ['持续', '值守', '值班', '轮换', '满编'])) readinessScore += 18;
  else if (includesAny(readinessText, ['机动', '装载', '升空'])) readinessScore += 14;
  else if (includesAny(readinessText, ['待机', '待命'])) readinessScore += 8;

  const dominantMetric = sortByScore(
    ['firepower', 'protection', 'reconCoverage', 'endurance', 'mobility'].map((key) => ({
      key,
      score: capability[key],
    })),
    'score',
  )[0]?.key || 'firepower';

  return {
    item,
    role: capability.role,
    capability,
    readinessScore: round(clamp(readinessScore, 0, 100), 1),
    dominantMetric,
  };
}

function buildResolvedGroupingRuleProfile(ruleLibrary, evidenceEntries = [], threatOutput = {}, actualGroupCount = 4) {
  const threatLevel = String(threatOutput?.threatLevel || '中');
  const baseWeights = normalizeWeights(safeObject(ruleLibrary?.weights));
  const adjustedWeights = {
    ...baseWeights,
  };

  const signals = GROUPING_RULE_SIGNAL_DEFINITIONS.map((definition) => {
    const matchedEntries = safeArray(evidenceEntries)
      .map((entry) => ({
        entry,
        score: keywordScore([entry.title, entry.summary, entry.text], definition.keywords),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    let rawScore = sumBy(matchedEntries.slice(0, 8), (item) => item.score);
    if (ruleLibrary?.key === 'fire-strike-rules' && definition.key === 'firepower') rawScore += 1.2;
    if (ruleLibrary?.key === 'air-assault-rules' && definition.key === 'mobility') rawScore += 1.2;
    if (threatLevel === '高' && ['protection', 'endurance'].includes(definition.key)) rawScore += 0.8;

    const intensity = clamp(rawScore / (definition.key === 'task-demand' ? 10 : 8), 0, 1.6);
    Object.entries(definition.weightAdjustments || {}).forEach(([metricKey, weightDelta]) => {
      adjustedWeights[metricKey] = Number(adjustedWeights[metricKey] || 0) + (intensity * Number(weightDelta || 0));
    });

    return {
      key: definition.key,
      label: definition.label,
      rawScore: round(rawScore, 2),
      intensity: round(intensity, 2),
      evidence: matchedEntries.slice(0, 3).map(({ entry, score }) => ({
        id: entry.id,
        sourceLabel: entry.sourceLabel,
        summary: entry.summary || toShortText(entry.text || '', 72),
        score: round(score, 2),
      })),
    };
  });

  if (threatLevel === '高') {
    adjustedWeights.protection = Number(adjustedWeights.protection || 0) + 0.02;
    adjustedWeights.endurance = Number(adjustedWeights.endurance || 0) + 0.01;
  }

  const normalizedWeights = normalizeWeights(adjustedWeights);
  const groupBlueprints = buildGroupingBlueprints(ruleLibrary?.key, actualGroupCount);
  const primarySignals = sortByScore(signals, 'rawScore').filter((item) => item.rawScore > 0).slice(0, 5);

  return {
    key: ruleLibrary?.key,
    label: ruleLibrary?.label,
    description: ruleLibrary?.description,
    baseWeights,
    weights: normalizedWeights,
    weightSummary: buildGroupingWeightSummary(normalizedWeights),
    actualGroupCount: groupBlueprints.length,
    primarySignals,
    signals,
    groupBlueprints,
  };
}

function calculateGroupingRoleAffinity(role = 'support', blueprint = {}) {
  if (safeArray(blueprint.preferredRoles).includes(role)) return 24;
  if (safeArray(blueprint.supportRoles).includes(role)) return 14;
  if (role === 'support' && safeArray(blueprint.preferredRoles).includes('sustain')) return 10;
  if (role === 'strike' && safeArray(blueprint.supportRoles).includes('strike')) return 10;
  if (role === 'cover' && safeArray(blueprint.supportRoles).includes('cover')) return 10;
  return 4;
}

function calculateGroupingCapabilityFit(capability = {}, targetMix = {}) {
  const weights = normalizeWeights(targetMix);
  return round(clamp(
    Number(capability.firepower || 0) * Number(weights.firepower || 0)
    + Number(capability.protection || 0) * Number(weights.protection || 0)
    + Number(capability.reconCoverage || 0) * Number(weights.reconCoverage || 0)
    + Number(capability.endurance || 0) * Number(weights.endurance || 0)
    + Number(capability.mobility || 0) * Number(weights.mobility || 0),
    0,
    100,
  ), 1);
}

function createGroupingState(blueprints = []) {
  return safeArray(blueprints).map((blueprint) => ({
    ...cloneData(blueprint),
    units: [],
  }));
}

function buildGroupingProfilesV2(groups = []) {
  return safeArray(groups)
    .map((group) => {
      const unitProfiles = safeArray(group.units);
      const units = unitProfiles.map((item) => item.item || item);
      const capabilities = unitProfiles.map((item) => item.capability || buildAdvancedUnitCapability(item.item || item));
      const normalizer = Math.max(units.length, 1);
      const roleComposition = unitProfiles.reduce((summary, item) => {
        const roleKey = item.role || classifyGroupingRole(item.item || item);
        summary[roleKey] = Number(summary[roleKey] || 0) + 1;
        return summary;
      }, {});

      return {
        id: group.id,
        name: group.name,
        role: group.role,
        unitCount: units.length,
        totalStrength: round(sumBy(units, (item) => item.strength), 1),
        firepower: round(clamp((sumBy(capabilities, (item) => item.firepower) / normalizer) * 1.16, 0, 100), 1),
        protection: round(clamp((sumBy(capabilities, (item) => item.protection) / normalizer) * 1.12, 0, 100), 1),
        reconCoverage: round(clamp((sumBy(capabilities, (item) => item.reconCoverage) / normalizer) * 1.12, 0, 100), 1),
        endurance: round(clamp((sumBy(capabilities, (item) => item.endurance) / normalizer) * 1.12, 0, 100), 1),
        mobility: round(clamp((sumBy(capabilities, (item) => item.mobility) / normalizer) * 1.08, 0, 100), 1),
        readinessScore: round(average(unitProfiles.map((item) => item.readinessScore)), 1),
        roleComposition,
        categories: uniqueList(units.map((item) => item.category)).slice(0, 6),
        units: units.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          role: item.role,
          strength: item.strength,
          readiness: item.readiness,
          derivedFromText: Boolean(item.derivedFromText),
        })),
      };
    })
    .filter((group) => group.unitCount > 0);
}

function buildGroupingSchemeMetrics(groupProfiles = []) {
  if (!safeArray(groupProfiles).length) {
    return {
      firepower: 0,
      protection: 0,
      reconCoverage: 0,
      endurance: 0,
      mobility: 0,
      balance: 0,
      strengthTotal: 0,
    };
  }

  const groupStrengths = groupProfiles.map((item) => Number(item.totalStrength || 0));
  return {
    firepower: round(average(groupProfiles.map((item) => item.firepower)), 1),
    protection: round(average(groupProfiles.map((item) => item.protection)), 1),
    reconCoverage: round(average(groupProfiles.map((item) => item.reconCoverage)), 1),
    endurance: round(average(groupProfiles.map((item) => item.endurance)), 1),
    mobility: round(average(groupProfiles.map((item) => item.mobility)), 1),
    balance: round(clamp(100 - standardDeviation(groupStrengths) * 5.5, 0, 100), 1),
    strengthTotal: round(sumBy(groupProfiles, (item) => item.totalStrength), 1),
  };
}

function scoreGroupingPlacement(methodKey, unitProfile, groupState, totalStrength, groupCount, threatLevel = '中') {
  const expectedStrength = totalStrength / Math.max(groupCount, 1);
  const currentStrength = sumBy(groupState.units, (item) => item.item?.strength || item.strength);
  const projectedStrength = currentStrength + Number(unitProfile.item?.strength || 0);
  const roleAffinity = calculateGroupingRoleAffinity(unitProfile.role, groupState);
  const capabilityFit = calculateGroupingCapabilityFit(unitProfile.capability, groupState.targetMix);
  const balanceBonus = Math.max(0, 16 - Math.abs(projectedStrength - expectedStrength) * 2.4);
  const emptyBonus = groupState.units.length === 0 ? 10 : 0;
  const saturationPenalty = groupState.units.length * (methodKey === 'hybrid-balanced' ? 2.3 : 1.5);
  const strengthPenalty = currentStrength * (methodKey === 'rule-inference' ? 0.18 : 0.28);
  let threatBonus = 0;

  if (threatLevel === '高' && ['cover', 'sustain'].includes(unitProfile.role) && (
    safeArray(groupState.preferredRoles).includes(unitProfile.role)
    || safeArray(groupState.supportRoles).includes(unitProfile.role)
  )) {
    threatBonus = 8;
  }

  if (methodKey === 'rule-inference') {
    return round(roleAffinity * 2.8 + capabilityFit * 0.18 + emptyBonus + threatBonus - saturationPenalty - strengthPenalty, 2);
  }

  return round(roleAffinity * 2.1 + capabilityFit * 0.2 + balanceBonus + emptyBonus + threatBonus - saturationPenalty - strengthPenalty, 2);
}

function findGroupingDonorIndex(assignment = [], groupCount = 1) {
  const counts = Array.from({ length: groupCount }, () => 0);
  safeArray(assignment).forEach((value) => {
    const index = clamp(Math.round(Number(value || 0)), 0, Math.max(groupCount - 1, 0));
    counts[index] += 1;
  });
  let donorIndex = 0;
  let donorCount = -1;
  counts.forEach((count, index) => {
    if (count > donorCount) {
      donorCount = count;
      donorIndex = index;
    }
  });
  return donorIndex;
}

function normalizeGroupingAssignment(assignment = [], groupCount = 1, rng = Math.random) {
  const normalized = safeArray(assignment).map((value) => clamp(Math.round(Number(value || 0)), 0, Math.max(groupCount - 1, 0)));
  if (!normalized.length || normalized.length < groupCount) {
    return normalized;
  }

  const counts = Array.from({ length: groupCount }, () => 0);
  normalized.forEach((value) => {
    counts[value] += 1;
  });

  for (let missingGroup = 0; missingGroup < groupCount; missingGroup += 1) {
    if (counts[missingGroup] > 0) continue;
    const donorGroup = findGroupingDonorIndex(normalized, groupCount);
    const donorPositions = normalized
      .map((value, index) => ({ value, index }))
      .filter((item) => item.value === donorGroup);
    const preferredPosition = donorPositions.find(() => counts[donorGroup] > 1) || donorPositions[0];
    const targetIndex = preferredPosition?.index ?? Math.floor(rng() * normalized.length);
    counts[donorGroup] = Math.max(0, counts[donorGroup] - 1);
    normalized[targetIndex] = missingGroup;
    counts[missingGroup] += 1;
  }

  return normalized;
}

function assignGroupingHeuristically(methodKey, unitProfiles = [], blueprints = [], threatLevel = '中') {
  if (!safeArray(unitProfiles).length || !safeArray(blueprints).length) {
    return [];
  }

  const assignment = new Array(unitProfiles.length).fill(0);
  const groupStates = createGroupingState(blueprints);
  const totalStrength = sumBy(unitProfiles, (item) => item.item?.strength || 0);
  const sortedUnits = unitProfiles
    .map((item, index) => ({
      item,
      index,
      priority: Number(item.item?.strength || 0) * 5 + Number(item.capability?.[item.dominantMetric] || 0),
    }))
    .sort((left, right) => right.priority - left.priority);

  sortedUnits.forEach(({ item, index }) => {
    const scoredBuckets = groupStates.map((groupState, bucketIndex) => ({
      bucketIndex,
      score: scoreGroupingPlacement(methodKey, item, groupState, totalStrength, blueprints.length, threatLevel),
    }));
    const bestBucket = sortByScore(scoredBuckets, 'score')[0]?.bucketIndex ?? 0;
    assignment[index] = bestBucket;
    groupStates[bestBucket].units.push(item);
  });

  return normalizeGroupingAssignment(assignment, blueprints.length);
}

function hashGroupingSeed(value = '') {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createGroupingRandom(seed = 1) {
  let state = Number(seed || 1) >>> 0;
  if (!state) state = 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createRandomGroupingAssignment(unitProfiles = [], groupCount = 1, rng = Math.random) {
  const assignment = safeArray(unitProfiles).map((_, index) => (
    index < groupCount ? index : Math.floor(rng() * groupCount)
  ));
  return normalizeGroupingAssignment(assignment, groupCount, rng);
}

function crossoverGroupingAssignments(left = [], right = [], groupCount = 1, rng = Math.random) {
  if (!safeArray(left).length || !safeArray(right).length || left.length !== right.length) {
    return normalizeGroupingAssignment(left, groupCount, rng);
  }
  if (left.length < 2) {
    return normalizeGroupingAssignment([...left], groupCount, rng);
  }
  const pivot = 1 + Math.floor(rng() * (left.length - 1));
  return normalizeGroupingAssignment([
    ...left.slice(0, pivot),
    ...right.slice(pivot),
  ], groupCount, rng);
}

function mutateGroupingAssignment(assignment = [], groupCount = 1, mutationRate = 0.14, rng = Math.random) {
  const mutated = [...safeArray(assignment)];

  for (let index = 0; index < mutated.length; index += 1) {
    if (rng() < mutationRate) {
      mutated[index] = Math.floor(rng() * groupCount);
    }
  }

  if (mutated.length > 1 && rng() < mutationRate) {
    const leftIndex = Math.floor(rng() * mutated.length);
    const rightIndex = Math.floor(rng() * mutated.length);
    [mutated[leftIndex], mutated[rightIndex]] = [mutated[rightIndex], mutated[leftIndex]];
  }

  return normalizeGroupingAssignment(mutated, groupCount, rng);
}

function calculateGroupingRoleFit(groupProfiles = [], blueprints = []) {
  return round(average(groupProfiles.map((group) => {
    const blueprint = safeArray(blueprints).find((item) => item.id === group.id) || {};
    const preferredRoles = safeArray(blueprint.preferredRoles);
    const supportRoles = safeArray(blueprint.supportRoles);
    const preferredCoverage = preferredRoles.length
      ? (preferredRoles.filter((role) => Number(group.roleComposition?.[role] || 0) > 0).length / preferredRoles.length) * 100
      : 100;
    const supportCoverage = supportRoles.length
      ? (supportRoles.filter((role) => Number(group.roleComposition?.[role] || 0) > 0).length / supportRoles.length) * 100
      : 100;
    return clamp(preferredCoverage * 0.72 + supportCoverage * 0.28, 0, 100);
  })), 1);
}

function calculateGroupingBlueprintFit(groupProfiles = [], blueprints = []) {
  return round(average(groupProfiles.map((group) => {
    const blueprint = safeArray(blueprints).find((item) => item.id === group.id) || {};
    return calculateGroupingCapabilityFit({
      firepower: group.firepower,
      protection: group.protection,
      reconCoverage: group.reconCoverage,
      endurance: group.endurance,
      mobility: group.mobility,
    }, blueprint.targetMix);
  })), 1);
}

function countGroupingRolesInUnits(units = []) {
  return safeArray(units).reduce((summary, item) => {
    const roleKey = item.role || classifyGroupingRole(item.item || item);
    summary[roleKey] = Number(summary[roleKey] || 0) + 1;
    return summary;
  }, {});
}

function createGroupingConstraintCheck(id, label, status, detail, suggestion) {
  return {
    id,
    label,
    status,
    detail,
    suggestion,
  };
}

function evaluateBaselineGroupingConstraints(groups = [], blueprints = [], forcePool = [], threatOutput = {}, ruleProfile = {}, options = {}) {
  const availableRoles = countGroupingRolesInUnits(forcePool);
  const expectedGroupCount = safeArray(blueprints).length || Number(ruleProfile.actualGroupCount || options.expectedGroupCount || 0);
  const actualGroupCount = safeArray(groups).length;
  const totalUnits = Math.max(sumBy(groups, (group) => group.unitCount), safeArray(forcePool).length);
  const maxGroupUnits = Math.max(0, ...safeArray(groups).map((group) => Number(group.unitCount || 0)));
  const maxGroupShare = totalUnits ? round((maxGroupUnits / totalUnits) * 100, 1) : 0;
  const threatLevel = String(threatOutput?.threatLevel || '中');
  const fireCoverageCount = safeArray(threatOutput?.fireCoverage).length;
  const airDefenseCount = safeArray(threatOutput?.airDefenseSystem).length;
  const checkResults = [];

  if (!expectedGroupCount) {
    checkResults.push(createGroupingConstraintCheck(
      'group-coverage',
      '功能群覆盖',
      'warn',
      '当前未声明明确的目标群组数，已跳过覆盖率强约束。',
      '为约束模型补充目标群组数或群组蓝图，可提升编组校核强度。',
    ));
  } else {
    const coverageStatus = actualGroupCount >= expectedGroupCount
      ? 'pass'
      : actualGroupCount >= Math.max(1, expectedGroupCount - 1)
        ? 'warn'
        : 'fail';
    checkResults.push(createGroupingConstraintCheck(
      'group-coverage',
      '功能群覆盖',
      coverageStatus,
      `目标群组 ${expectedGroupCount} 个，当前形成 ${actualGroupCount} 个功能群。`,
      '补充候选兵力或下调期望群组数，避免关键任务群缺位。',
    ));
  }

  const strikeGroupCount = safeArray(groups).filter((group) => Number(group.roleComposition?.strike || 0) > 0).length;
  if (!Number(availableRoles.strike || 0)) {
    checkResults.push(createGroupingConstraintCheck(
      'strike-coverage',
      '主攻火力覆盖',
      'warn',
      '候选兵力中未识别到明显火力主攻单元，无法执行严格火力覆盖校核。',
      '补充火炮、导弹、装甲或火力打击平台数据后重新求解。',
    ));
  } else {
    checkResults.push(createGroupingConstraintCheck(
      'strike-coverage',
      '主攻火力覆盖',
      strikeGroupCount >= 1 ? 'pass' : 'fail',
      `当前包含火力主攻角色的功能群 ${strikeGroupCount} 个。`,
      '确保至少一个功能群承载主攻火力或火力支援职责。',
    ));
  }

  const reconRequired = fireCoverageCount > 0 || airDefenseCount > 0 || threatLevel === '高';
  const reconGroupCount = safeArray(groups).filter((group) => Number(group.roleComposition?.recon || 0) > 0).length;
  if (reconRequired) {
    const reconStatus = !Number(availableRoles.recon || 0)
      ? 'warn'
      : reconGroupCount >= 1
        ? 'pass'
        : 'fail';
    checkResults.push(createGroupingConstraintCheck(
      'recon-chain',
      '侦察引导链路',
      reconStatus,
      `高威胁/重点目标环境下已识别侦察功能群 ${reconGroupCount} 个。`,
      '为编组补充侦察、预警或引导单元，保证压制和突击链路闭环。',
    ));
  }

  const sustainGroupCount = safeArray(groups).filter((group) => Number(group.roleComposition?.sustain || 0) > 0).length;
  if (totalUnits >= 4 || Number(availableRoles.sustain || 0) > 0) {
    const sustainStatus = !Number(availableRoles.sustain || 0)
      ? 'warn'
      : sustainGroupCount >= 1
        ? 'pass'
        : 'fail';
    checkResults.push(createGroupingConstraintCheck(
      'sustain-chain',
      '保障指挥链路',
      sustainStatus,
      `当前包含保障/指挥角色的功能群 ${sustainGroupCount} 个。`,
      '增加通信、补给、维修或医疗单元，避免任务执行阶段保障断链。',
    ));
  }

  if (threatLevel === '高' || fireCoverageCount > 0 || airDefenseCount > 0) {
    const coverGroupCount = safeArray(groups).filter((group) => Number(group.roleComposition?.cover || 0) > 0).length;
    const coverStatus = !Number(availableRoles.cover || 0)
      ? 'warn'
      : coverGroupCount >= 1
        ? 'pass'
        : 'fail';
    checkResults.push(createGroupingConstraintCheck(
      'protective-cover',
      '掩护防护覆盖',
      coverStatus,
      `当前包含掩护/防空角色的功能群 ${coverGroupCount} 个。`,
      '为主航路和主攻群补充掩护、防空或电子支援单元。',
    ));
  }

  if (totalUnits > 0) {
    const balanceStatus = maxGroupShare <= 42
      ? 'pass'
      : maxGroupShare <= 58
        ? 'warn'
        : 'fail';
    checkResults.push(createGroupingConstraintCheck(
      'load-balance',
      '兵力负载均衡',
      balanceStatus,
      `最大功能群承载 ${maxGroupUnits} 个单元，占候选兵力 ${maxGroupShare}%。`,
      '避免将过多兵力集中到单一群组，可通过增加预备群或支援群分散负载。',
    ));
  }

  const totalChecks = checkResults.length;
  const passedCount = checkResults.filter((item) => item.status === 'pass').length;
  const warnCount = checkResults.filter((item) => item.status === 'warn').length;
  const failedCount = checkResults.filter((item) => item.status === 'fail').length;
  const score = round(clamp(100 - failedCount * 18 - warnCount * 8, 0, 100), 1);
  const penalty = round(failedCount * 3.6 + warnCount * 1.4, 1);
  const overallStatus = failedCount ? 'fail' : warnCount ? 'warn' : 'pass';

  return {
    modelKey: 'baseline-constraints',
    modelLabel: GROUPING_CONSTRAINT_MODELS['baseline-constraints'].label,
    totalChecks,
    passedCount,
    warnCount,
    failedCount,
    score,
    penalty,
    overallStatus,
    summary: failedCount
      ? `发现 ${failedCount} 项未满足约束和 ${warnCount} 项待关注约束。`
      : warnCount
        ? `关键约束基本满足，仍有 ${warnCount} 项待人工复核。`
        : '关键约束均满足，可直接进入后续任务规划步骤。',
    checks: checkResults,
    suggestions: uniqueList(checkResults.filter((item) => item.status !== 'pass').map((item) => item.suggestion)),
  };
}

const GROUPING_CONSTRAINT_EVALUATORS = {
  'baseline-constraints': evaluateBaselineGroupingConstraints,
};

function resolveGroupingConstraintModel(constraintModelKey = '') {
  return GROUPING_CONSTRAINT_MODELS[constraintModelKey] || GROUPING_CONSTRAINT_MODELS['baseline-constraints'];
}

function evaluateGroupingConstraintModel(constraintModelKey = '', groups = [], blueprints = [], forcePool = [], threatOutput = {}, ruleProfile = {}, options = {}) {
  const constraintModel = resolveGroupingConstraintModel(constraintModelKey);
  const evaluator = GROUPING_CONSTRAINT_EVALUATORS[constraintModel.key];
  if (!evaluator) {
    return {
      modelKey: constraintModel.key,
      modelLabel: constraintModel.label,
      totalChecks: 0,
      passedCount: 0,
      warnCount: 1,
      failedCount: 0,
      score: 100,
      penalty: 0,
      overallStatus: 'warn',
      summary: '当前约束模型尚未注册执行器，已跳过约束校核。',
      checks: [
        createGroupingConstraintCheck(
          'constraint-evaluator-missing',
          '约束模型执行器',
          'warn',
          `未找到 ${constraintModel.label} 的执行器注册，当前未执行约束校核。`,
          '在 GROUPING_CONSTRAINT_EVALUATORS 中注册执行器函数后重新计算。',
        ),
      ],
      suggestions: ['补充约束执行器后重新计算，以便将约束结果纳入方案评估。'],
    };
  }

  return evaluator(groups, blueprints, forcePool, threatOutput, ruleProfile, options);
}

function evaluateGroupingAssignmentV2(
  assignment = [],
  unitProfiles = [],
  blueprints = [],
  ruleProfile = {},
  comparisonFocus = 'balanced',
  threatLevel = '中',
  constraintContext = {},
) {
  const groupStates = createGroupingState(blueprints);
  safeArray(assignment).forEach((bucketIndex, unitIndex) => {
    const normalizedBucketIndex = clamp(Math.round(Number(bucketIndex || 0)), 0, Math.max(groupStates.length - 1, 0));
    if (!groupStates[normalizedBucketIndex]) return;
    groupStates[normalizedBucketIndex].units.push(unitProfiles[unitIndex]);
  });

  const groups = buildGroupingProfilesV2(groupStates);
  const metrics = buildGroupingSchemeMetrics(groups);
  const roleFit = calculateGroupingRoleFit(groups, blueprints);
  const blueprintFit = calculateGroupingBlueprintFit(groups, blueprints);
  const readinessScore = round(average(groups.map((item) => item.readinessScore)), 1);
  const filledGroupCount = groups.length;
  const emptyGroupCount = Math.max(0, safeArray(blueprints).length - filledGroupCount);
  const groupCoverage = round((filledGroupCount / Math.max(safeArray(blueprints).length, 1)) * 100, 1);
  const structuralPenalty = round(
    emptyGroupCount * 10 + Math.max(0, standardDeviation(groups.map((item) => item.unitCount)) * 4.2 - 2),
    1,
  );
  const baseScore = calculateSchemeScore(metrics, ruleProfile, comparisonFocus, threatLevel);
  const constraintEvaluation = evaluateGroupingConstraintModel(
    constraintContext.constraintModelKey,
    groups,
    blueprints,
    safeArray(unitProfiles).map((item) => item.item || item),
    constraintContext.threatOutput,
    ruleProfile,
    constraintContext.options,
  );
  const score = round(clamp(
    baseScore * 0.6
    + roleFit * 0.14
    + blueprintFit * 0.1
    + readinessScore * 0.04
    + groupCoverage * 0.04
    + Number(constraintEvaluation.score || 0) * 0.08
    - structuralPenalty
    - Number(constraintEvaluation.penalty || 0),
    0,
    100,
  ), 1);

  return {
    groups,
    metrics: {
      ...metrics,
      roleFit,
      blueprintFit,
      readinessScore,
      groupCoverage,
      constraintSatisfaction: constraintEvaluation.score,
    },
    baseScore: round(baseScore, 1),
    score,
    fitness: score,
    filledGroupCount,
    emptyGroupCount,
    structuralPenalty,
    constraintEvaluation,
  };
}

function selectGroupingTournament(evaluatedPopulation = [], rng = Math.random, tournamentSize = 3) {
  const candidates = [];
  for (let index = 0; index < tournamentSize; index += 1) {
    candidates.push(evaluatedPopulation[Math.floor(rng() * evaluatedPopulation.length)]);
  }
  return sortByScore(candidates, 'fitness')[0];
}

function runGeneticGroupingV2(
  unitProfiles = [],
  blueprints = [],
  ruleProfile = {},
  comparisonFocus = 'balanced',
  threatLevel = '中',
  seedInput = '',
  constraintContext = {},
) {
  if (!safeArray(unitProfiles).length || !safeArray(blueprints).length) {
    return {
      ...evaluateGroupingAssignmentV2([], unitProfiles, blueprints, ruleProfile, comparisonFocus, threatLevel, constraintContext),
      optimizationMeta: null,
      optimizationTrace: [],
    };
  }

  const groupCount = blueprints.length;
  const rng = createGroupingRandom(hashGroupingSeed(seedInput));
  const populationSize = Math.max(18, Math.min(36, groupCount * 6));
  const generations = Math.max(16, Math.min(32, unitProfiles.length * 2));
  const mutationRate = round(0.12 + Math.min(0.08, groupCount * 0.01), 2);
  const crossoverRate = 0.78;
  const heuristicSeeds = [
    assignGroupingHeuristically('rule-inference', unitProfiles, blueprints, threatLevel),
    assignGroupingHeuristically('hybrid-balanced', unitProfiles, blueprints, threatLevel),
  ].filter((item) => safeArray(item).length);
  const population = [...heuristicSeeds];

  while (population.length < populationSize) {
    population.push(createRandomGroupingAssignment(unitProfiles, groupCount, rng));
  }

  let evaluatedPopulation = population.map((candidate) => ({
    assignment: candidate,
    ...evaluateGroupingAssignmentV2(candidate, unitProfiles, blueprints, ruleProfile, comparisonFocus, threatLevel, constraintContext),
  }));
  let bestInitial = sortByScore(evaluatedPopulation, 'fitness')[0];
  const optimizationTrace = [{
    generation: 0,
    bestScore: bestInitial?.score || 0,
    averageScore: round(average(evaluatedPopulation.map((item) => item.score)), 1),
  }];

  for (let generation = 1; generation <= generations; generation += 1) {
    const rankedPopulation = sortByScore(evaluatedPopulation, 'fitness');
    const nextPopulation = rankedPopulation.slice(0, 2).map((item) => [...item.assignment]);

    while (nextPopulation.length < populationSize) {
      const parentA = selectGroupingTournament(rankedPopulation, rng);
      const parentB = selectGroupingTournament(rankedPopulation, rng);
      const crossed = rng() < crossoverRate
        ? crossoverGroupingAssignments(parentA.assignment, parentB.assignment, groupCount, rng)
        : [...parentA.assignment];
      nextPopulation.push(mutateGroupingAssignment(crossed, groupCount, mutationRate, rng));
    }

    evaluatedPopulation = nextPopulation.map((candidate) => ({
      assignment: candidate,
      ...evaluateGroupingAssignmentV2(candidate, unitProfiles, blueprints, ruleProfile, comparisonFocus, threatLevel, constraintContext),
    }));

    if (generation === 1 || generation === generations || generation % 4 === 0) {
      const bestCandidate = sortByScore(evaluatedPopulation, 'fitness')[0];
      optimizationTrace.push({
        generation,
        bestScore: bestCandidate?.score || 0,
        averageScore: round(average(evaluatedPopulation.map((item) => item.score)), 1),
      });
    }
  }

  const bestCandidate = sortByScore(evaluatedPopulation, 'fitness')[0] || bestInitial;
  bestInitial = bestInitial || bestCandidate;

  return {
    groups: bestCandidate.groups,
    metrics: bestCandidate.metrics,
    score: bestCandidate.score,
    fitness: bestCandidate.fitness,
    filledGroupCount: bestCandidate.filledGroupCount,
    emptyGroupCount: bestCandidate.emptyGroupCount,
    structuralPenalty: bestCandidate.structuralPenalty,
    optimizationMeta: {
      populationSize,
      generations,
      mutationRate,
      crossoverRate,
      initialBestScore: bestInitial?.score || 0,
      finalBestScore: bestCandidate?.score || 0,
    },
    optimizationTrace,
  };
}

function buildGroupingSchemeNarrativeV2(scheme, threatLevel, ruleProfile = {}) {
  if (!safeArray(scheme.groups).length) {
    return {
      advantages: [
        '当前已完成规则画像解析，但尚未识别到足够的可编组兵力单元。',
        '可继续从数据服务选择我方情报或上传装备/兵力文档补充分析。',
      ],
      tradeoffs: [
        '在候选兵力不足时，编组评分仅能反映规则适配度，无法代表完整执行方案。',
        '建议先补充我方兵力、装备性能和人员编配数据后再重新计算。',
      ],
    };
  }

  const metricEntries = Object.entries(scheme.metrics)
    .filter(([key]) => ['firepower', 'protection', 'reconCoverage', 'endurance', 'mobility', 'balance'].includes(key))
    .map(([key, value]) => ({ key, value }));
  const strongestMetric = sortByScore(metricEntries, 'value')[0]?.key || 'firepower';
  const weakestMetric = [...metricEntries].sort((left, right) => left.value - right.value)[0]?.key || 'balance';
  const primarySignal = safeArray(ruleProfile.primarySignals)[0];

  return {
    advantages: [
      `方案在${GROUPING_METRIC_LABELS[strongestMetric] || strongestMetric}上表现最好，适合应对${threatLevel}威胁环境。`,
      primarySignal
        ? `规则画像当前突出“${primarySignal.label}”，与情报/文档证据的匹配度较高。`
        : '主攻群、支援群与保障群之间保持了较稳定的任务分工和强度配置。',
    ],
    tradeoffs: [
      `当前方案的${GROUPING_METRIC_LABELS[weakestMetric] || weakestMetric}相对较弱，需在执行阶段补充约束校核。`,
      `当前实际形成 ${safeArray(scheme.groups).length} 个功能群，仍需结合指挥链和资源上限做人工复核。`,
    ],
  };
}

function buildGroupingScheme(methodKey, forcePool = [], threatOutput = {}, ruleProfile = {}, input = {}, constraintModel = {}) {
  const threatLevel = String(threatOutput?.threatLevel || '中');
  const blueprints = safeArray(ruleProfile.groupBlueprints);
  const unitProfiles = safeArray(forcePool).map(buildGroupingUnitProfile);
  const constraintContext = {
    constraintModelKey: constraintModel.key || input.options?.constraintModelKey,
    threatOutput,
    options: input.options,
  };
  let evaluatedScheme;

  if (methodKey === 'genetic-optimization') {
    evaluatedScheme = runGeneticGroupingV2(
      unitProfiles,
      blueprints,
      ruleProfile,
      input.options?.comparisonFocus,
      threatLevel,
      JSON.stringify({
        methodKey,
        ruleLibraryKey: ruleProfile.key,
        forcePool: forcePool.map((item) => [item.id, item.name, item.strength].join(':')).join('|'),
        comparisonFocus: input.options?.comparisonFocus,
      }),
      constraintContext,
    );
  } else {
    const assignment = assignGroupingHeuristically(
      methodKey === 'rule-inference' ? 'rule-inference' : 'hybrid-balanced',
      unitProfiles,
      blueprints,
      threatLevel,
    );
    evaluatedScheme = {
      ...evaluateGroupingAssignmentV2(
        assignment,
        unitProfiles,
        blueprints,
        ruleProfile,
        input.options?.comparisonFocus,
        threatLevel,
        constraintContext,
      ),
      optimizationMeta: null,
      optimizationTrace: [],
    };
  }

  const narrative = buildGroupingSchemeNarrativeV2(evaluatedScheme, threatLevel, ruleProfile);

  return {
    id: `scheme-${methodKey}`,
    methodKey,
    methodLabel: findMethodLabel(GROUPING_METHODS, methodKey),
    baseScore: evaluatedScheme.baseScore,
    score: evaluatedScheme.score,
    metrics: evaluatedScheme.metrics,
    groups: evaluatedScheme.groups,
    actualGroupCount: evaluatedScheme.filledGroupCount,
    emptyGroupCount: evaluatedScheme.emptyGroupCount,
    structuralPenalty: evaluatedScheme.structuralPenalty,
    constraintEvaluation: evaluatedScheme.constraintEvaluation,
    optimizationMeta: evaluatedScheme.optimizationMeta,
    optimizationTrace: evaluatedScheme.optimizationTrace,
    advantages: narrative.advantages,
    tradeoffs: narrative.tradeoffs,
  };
}

async function runBuiltinForceGrouping(context, step, algorithm, input, dataset) {
  const sourceBundle = buildSourceBundle(dataset, input.selectedSourceIds);
  const uploadedFiles = await normalizeUploadedFiles(input.uploadedFiles);
  const blueIntelligence = buildSelectedIntelligence(dataset, 'blue', sourceBundle.sourceIdSet);
  const threatOutput = safeObject(context.stageOutputs['enemy-threat-analysis']);
  const appliedOptions = cloneData(input.options || {});
  const requestedGroupCount = clamp(Math.round(Number(appliedOptions.expectedGroupCount || 4)), 3, 6);
  const ruleLibrary = GROUPING_RULE_LIBRARIES[appliedOptions.ruleLibraryKey] || GROUPING_RULE_LIBRARIES['fire-strike-rules'];
  const constraintModel = resolveGroupingConstraintModel(appliedOptions.constraintModelKey);
  const evidenceEntries = buildGroupingEvidenceEntries(sourceBundle, uploadedFiles, blueIntelligence, threatOutput);
  const documentCandidates = buildDocumentGroupingCandidates(evidenceEntries, Math.max(6, requestedGroupCount));
  const forcePool = mergeGroupingCandidates(blueIntelligence, documentCandidates, requestedGroupCount);
  const actualGroupCount = resolveActualGroupingCount(requestedGroupCount, forcePool.length);
  const ruleProfile = buildResolvedGroupingRuleProfile(ruleLibrary, evidenceEntries, threatOutput, actualGroupCount);
  const schemes = GROUPING_METHODS.map((method) => buildGroupingScheme(
    method.key,
    forcePool,
    threatOutput,
    ruleProfile,
    {
      ...input,
      options: {
        ...appliedOptions,
        constraintModelKey: constraintModel.key,
        expectedGroupCount: requestedGroupCount,
      },
    },
    constraintModel,
  ));
  const preferredScheme = schemes.find((item) => item.methodKey === input.builtinMethodKey) || schemes[0];
  const systemBestScheme = sortByScore(schemes, 'score')[0] || preferredScheme;
  const preferredConstraintSummary = safeObject(preferredScheme.constraintEvaluation);
  const topSignal = safeArray(ruleProfile.primarySignals)[0];
  const ruleEvidence = safeArray(ruleProfile.primarySignals)
    .flatMap((signal) => safeArray(signal.evidence).map((item) => ({
      ...item,
      signalLabel: signal.label,
    })))
    .slice(0, 8);

  const explanation = [
    `当前选中的内置方法为“${preferredScheme.methodLabel}”，在 ${ruleProfile.actualGroupCount} 个功能群约束下推荐评分 ${preferredScheme.score}。`,
    `规则库使用“${ruleLibrary.label}”，共融合 ${evidenceEntries.length} 条规则证据与 ${forcePool.length} 个候选兵力单元。`,
    `约束模型使用“${constraintModel.label}”，当前约束评分 ${preferredConstraintSummary.score || 0}，结论为${preferredConstraintSummary.summary || '待复核'}。`,
    topSignal
      ? `当前规则画像最强信号为“${topSignal.label}”，主要证据来自 ${safeArray(topSignal.evidence).map((item) => item.sourceLabel).join('、') || '当前任务基础规则'}。`
      : '当前规则画像主要沿用任务基础规则库权重，并结合威胁结果做轻量调整。',
    preferredScheme.id !== systemBestScheme.id
      ? `系统自动评分最高的方案为“${systemBestScheme.methodLabel}”，评分 ${systemBestScheme.score}，可作为对照参考。`
      : '当前选中方案与系统自动评分最高方案一致，可直接作为默认推荐结果。',
  ];

  if (requestedGroupCount !== ruleProfile.actualGroupCount) {
    explanation.splice(2, 0, `受候选兵力数量限制，期望 ${requestedGroupCount} 个功能群，实际输出 ${ruleProfile.actualGroupCount} 个功能群。`);
  }

  return {
    summary: `已生成 ${schemes.length} 套作战力量编组方案，并根据 ${preferredScheme.methodLabel} 输出推荐结果。`,
    outputPreview: [
      `规则库：${ruleLibrary.label}`,
      `候选兵力 ${forcePool.length} 个（结构化 ${blueIntelligence.length} / 文档推断 ${documentCandidates.length}），生成方案 ${schemes.length} 套`,
      `推荐方案：${preferredScheme.methodLabel}（评分 ${preferredScheme.score}）`,
    ],
    artifacts: [
      createArtifact('作战编组方案集', '输出规则推理、遗传优化和混合均衡三类编组方案。'),
      createArtifact('方案对比表', '从火力、防护、侦察、保障、规则匹配和均衡度维度进行多方案对比。'),
      createArtifact('推荐结果解释', '说明规则依据、文档证据、优化过程与方案调整方向。'),
    ],
    structuredOutput: {
      implementationStatus: 'implemented',
      builtinMethodKey: input.builtinMethodKey,
      builtinMethodLabel: findMethodLabel(algorithm.builtinMethods, input.builtinMethodKey),
      ruleLibrary: {
        key: ruleLibrary.key,
        label: ruleLibrary.label,
        description: ruleLibrary.description,
      },
      constraintModel,
      appliedOptions: {
        ruleLibraryKey: ruleLibrary.key,
        constraintModelKey: constraintModel.key,
        comparisonFocus: appliedOptions.comparisonFocus || 'balanced',
        expectedGroupCount: requestedGroupCount,
        actualGroupCount: ruleProfile.actualGroupCount,
      },
      inputSummary: {
        selectedSourceCount: sourceBundle.selectedSources.length,
        uploadedFileCount: uploadedFiles.length,
        blueIntelligenceCount: blueIntelligence.length,
        documentCandidateCount: documentCandidates.length,
        candidateCount: forcePool.length,
        evidenceEntryCount: evidenceEntries.length,
      },
      selectedSources: sourceBundle.selectedSources.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
      })),
      importedFiles: uploadedFiles.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        fileExtension: item.fileExtension,
        summary: item.summary,
      })),
      evidenceTrace: buildEvidenceTraceEntries(evidenceEntries, 80),
      resolvedRuleProfile: {
        key: ruleProfile.key,
        label: ruleProfile.label,
        description: ruleProfile.description,
        actualGroupCount: ruleProfile.actualGroupCount,
        weightSummary: ruleProfile.weightSummary,
        primarySignals: safeArray(ruleProfile.primarySignals).map((item) => ({
          key: item.key,
          label: item.label,
          intensity: item.intensity,
          evidenceCount: safeArray(item.evidence).length,
        })),
        groupBlueprints: safeArray(ruleProfile.groupBlueprints).map((item) => ({
          id: item.id,
          name: item.name,
          role: item.role,
          preferredRoles: item.preferredRoles,
        })),
      },
      constraintSummary: {
        modelKey: constraintModel.key,
        modelLabel: constraintModel.label,
        score: preferredConstraintSummary.score || 0,
        totalChecks: preferredConstraintSummary.totalChecks || 0,
        passedCount: preferredConstraintSummary.passedCount || 0,
        warnCount: preferredConstraintSummary.warnCount || 0,
        failedCount: preferredConstraintSummary.failedCount || 0,
        overallStatus: preferredConstraintSummary.overallStatus || 'warn',
        summary: preferredConstraintSummary.summary || '待人工复核约束结果。',
        checks: safeArray(preferredConstraintSummary.checks),
        suggestions: safeArray(preferredConstraintSummary.suggestions),
      },
      ruleEvidence,
      schemes,
      comparison: schemes.map((item) => ({
        schemeId: item.id,
        methodKey: item.methodKey,
        methodLabel: item.methodLabel,
        baseScore: item.baseScore,
        score: item.score,
        actualGroupCount: item.actualGroupCount,
        firepower: item.metrics.firepower,
        protection: item.metrics.protection,
        reconCoverage: item.metrics.reconCoverage,
        endurance: item.metrics.endurance,
        mobility: item.metrics.mobility,
        balance: item.metrics.balance,
        roleFit: item.metrics.roleFit,
        constraintScore: item.constraintEvaluation?.score || 0,
        constraintStatus: item.constraintEvaluation?.overallStatus || 'warn',
        advantage: item.advantages[0] || '',
        tradeoff: item.tradeoffs[0] || '',
        optimizationNote: item.optimizationMeta
          ? `种群 ${item.optimizationMeta.populationSize} / 迭代 ${item.optimizationMeta.generations}`
          : '',
      })),
      preferredSchemeId: preferredScheme.id,
      preferredScheme,
      systemBestSchemeId: systemBestScheme.id,
      explanation,
    },
  };
}

function resolveTargetValidationProfile(mode = 'standard') {
  return TARGET_VALIDATION_PROFILES[String(mode || 'standard')] || TARGET_VALIDATION_PROFILES.standard;
}

function resolveTargetPriorityLevel(importance = 0) {
  if (Number(importance || 0) >= 86) return '一级';
  if (Number(importance || 0) >= 74) return '二级';
  if (Number(importance || 0) >= 60) return '三级';
  return '四级';
}

function resolveTargetRequiredPlatformCount(type = 'default', importance = 0, difficulty = 0) {
  let count = 1;
  if (Number(difficulty || 0) >= 64) count += 1;
  if (Number(importance || 0) >= 82) count += 1;
  if (['air-defense', 'deployment-sector'].includes(type) && Number(difficulty || 0) >= 56) count += 1;
  return clamp(count, 1, 3);
}

function buildTargetCandidate(payload = {}) {
  const type = String(payload.type || 'default');
  const profile = TARGET_TYPE_PROFILES[type] || TARGET_TYPE_PROFILES.default;
  const importance = round(clamp(Number(payload.importance || 0), 0, 100), 1);
  const difficulty = round(clamp(Number(payload.difficulty || 0), 0, 100), 1);
  const requiredPlatformCount = clamp(
    Number(payload.requiredPlatformCount || resolveTargetRequiredPlatformCount(type, importance, difficulty)),
    1,
    3,
  );

  return {
    id: String(payload.id || `${type}-${Date.now()}`),
    name: String(payload.name || profile.label),
    type,
    typeLabel: profile.label,
    coordinates: normalizeCoordinate(payload.coordinates || [0, 0, 0]),
    importance,
    difficulty,
    priorityLevel: payload.priorityLevel || resolveTargetPriorityLevel(importance),
    requiredPlatformCount,
    preferredRoles: cloneData(payload.preferredRoles || profile.preferredRoles || []),
    capabilityWeights: cloneData(payload.capabilityWeights || profile.capabilityWeights || TARGET_TYPE_PROFILES.default.capabilityWeights),
    rationale: String(payload.rationale || ''),
    compositePriority: round(clamp(importance * 0.64 + difficulty * 0.16 + requiredPlatformCount * 8, 0, 100), 1),
  };
}

function buildCandidateTargets(threatOutput = {}) {
  const targets = [
    ...safeArray(threatOutput.fireCoverage).map((item, index) => buildTargetCandidate({
      id: `target-fire-${index + 1}`,
      name: item.name,
      type: 'fire-coverage',
      coordinates: item.center,
      importance: round(clamp(Number(item.threatValue || 0), 0, 100), 1),
      difficulty: round(clamp(42 + Number(item.coverageKm || 0) * 2.2, 0, 100), 1),
      rationale: '优先压制敌火力覆盖范围，降低主攻方向受压制风险。',
    })),
    ...safeArray(threatOutput.airDefenseSystem).map((item, index) => buildTargetCandidate({
      id: `target-airdef-${index + 1}`,
      name: item.name,
      type: 'air-defense',
      coordinates: item.location,
      importance: round(clamp(68 + Number(item.strength || 0) * 0.22, 0, 100), 1),
      difficulty: round(clamp(58 + Number(item.coverageKm || 0) * 1.6, 0, 100), 1),
      rationale: '压制敌防空节点，释放我方平台突防与火力运用空间。',
    })),
    ...safeArray(threatOutput.reconEarlyWarning).map((item, index) => buildTargetCandidate({
      id: `target-recon-${index + 1}`,
      name: item.name,
      type: 'recon-warning',
      coordinates: item.location,
      importance: round(clamp(60 + Number(item.confidence || 0) * 0.18, 0, 100), 1),
      difficulty: round(clamp(44 + Number(item.coverageKm || 0) * 1.5, 0, 100), 1),
      rationale: '削弱敌侦察预警网络，减少我方行动暴露概率。',
    })),
    ...safeArray(threatOutput.antiAirborneFacilities).map((item, index) => buildTargetCandidate({
      id: `target-anti-${index + 1}`,
      name: item.name,
      type: 'anti-airborne',
      coordinates: item.location,
      importance: round(clamp(54 + Number(item.confidence || 0) * 0.18, 0, 100), 1),
      difficulty: round(clamp(40 + Number(item.confidence || 0) * 0.16, 0, 100), 1),
      rationale: '打击重点阻滞设施，有利于打开机动和渗透通道。',
    })),
    ...safeArray(threatOutput.deploymentSectors).map((item, index) => buildTargetCandidate({
      id: `target-sector-${index + 1}`,
      name: `${item.name}集结区`,
      type: 'deployment-sector',
      coordinates: item.center,
      importance: round(clamp(50 + Number(item.unitCount || 0) * 4 + Number(item.averageStrength || 0) * 2, 0, 100), 1),
      difficulty: round(clamp(48 + Number(item.unitCount || 0) * 3, 0, 100), 1),
      rationale: '压制集结区能够破坏敌后续兵力展开与补充节奏。',
    })),
  ];

  return [...targets].sort((left, right) => Number(right.compositePriority || 0) - Number(left.compositePriority || 0));
}

function buildTargetEntityKey(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s/_-]+/g, '');
}

function buildBluePlatformLookup(dataset = {}) {
  const blueIntelligence = safeArray(dataset.intelligence).filter((item) => item.camp === 'blue');
  const nameIndex = new Map();

  for (const item of blueIntelligence) {
    const key = buildTargetEntityKey(item.name);
    if (!key) continue;
    const current = nameIndex.get(key);
    if (!current || Number(current.strength || 0) < Number(item.strength || 0)) {
      nameIndex.set(key, item);
    }
  }

  return {
    items: blueIntelligence,
    idIndex: buildIntelligenceIndex(blueIntelligence),
    nameIndex,
  };
}

function resolvePlatformIntelligenceRecord(unit = {}, lookup = {}) {
  const numericId = Number(unit.id);
  if (Number.isFinite(numericId) && lookup.idIndex?.has(numericId)) {
    return lookup.idIndex.get(numericId);
  }
  const nameKey = buildTargetEntityKey(unit.name);
  if (nameKey && lookup.nameIndex?.has(nameKey)) {
    return lookup.nameIndex.get(nameKey);
  }
  return null;
}

function resolvePlatformCoordinate(groupAnchor = [120.18, 30.28, 0], intelligenceItem = null, groupIndex = 0, unitIndex = 0) {
  if (intelligenceItem && (Number(intelligenceItem.longitude || 0) || Number(intelligenceItem.latitude || 0))) {
    return normalizeCoordinate([intelligenceItem.longitude, intelligenceItem.latitude, 0]);
  }
  const lonOffset = ((unitIndex % 3) - 1) * 0.012 + ((groupIndex % 2) ? 0.004 : -0.004);
  const latOffset = (Math.floor(unitIndex / 3) * 0.008) - 0.006;
  return normalizeCoordinate(offsetCoordinate(groupAnchor, lonOffset, latOffset, 0));
}

function buildPlatformProfiles(forceGrouping = {}, dataset = {}, options = {}) {
  const requestedGroupLimit = clamp(Number(options.maxAssignmentsPerGroup || 2), 1, 6);
  const lookup = buildBluePlatformLookup(dataset);
  const fallbackAnchor = resolveFallbackAnchor(dataset);
  let sourceGroups = safeArray(forceGrouping.preferredScheme?.groups || forceGrouping.systemBestScheme?.groups);

  if (!sourceGroups.length && lookup.items.length) {
    const fallbackBuckets = new Map();
    for (const item of lookup.items) {
      const role = buildGroupingUnitProfile(item).role || 'strike';
      if (!fallbackBuckets.has(role)) fallbackBuckets.set(role, []);
      fallbackBuckets.get(role).push(item);
    }
    sourceGroups = [...fallbackBuckets.entries()].map(([role, units], index) => ({
      id: `fallback-group-${index + 1}`,
      name: `${role === 'strike' ? '火力' : role === 'cover' ? '掩护' : role === 'recon' ? '侦察' : '保障'}临时群`,
      role,
      units,
    }));
  }

  const groups = [];
  const platforms = [];

  safeArray(sourceGroups).forEach((group, groupIndex) => {
    const units = safeArray(group.units);
    if (!units.length) return;

    const matchedEntries = units
      .map((unit) => {
        const intelligenceItem = resolvePlatformIntelligenceRecord(unit, lookup);
        if (!intelligenceItem) return null;
        return {
          coordinates: [Number(intelligenceItem.longitude || 0), Number(intelligenceItem.latitude || 0), 0],
          weight: Math.max(1, Number(unit.strength || intelligenceItem.strength || 1)),
        };
      })
      .filter(Boolean);

    const groupAnchor = matchedEntries.length
      ? buildWeightedCenter(matchedEntries, fallbackAnchor)
      : normalizeCoordinate(offsetCoordinate(
        fallbackAnchor,
        ((groupIndex % 3) - 1) * 0.045,
        (Math.floor(groupIndex / 3) - 0.5) * 0.04,
        0,
      ));

    const groupPlatforms = units.map((unit, unitIndex) => {
      const intelligenceItem = resolvePlatformIntelligenceRecord(unit, lookup);
      const mergedUnit = {
        ...safeObject(intelligenceItem || {}),
        ...safeObject(unit),
        name: unit.name || intelligenceItem?.name || `平台-${groupIndex + 1}-${unitIndex + 1}`,
        category: unit.category || intelligenceItem?.category || '综合平台',
        role: unit.role || intelligenceItem?.role || group.role || 'strike',
        strength: Number(unit.strength || intelligenceItem?.strength || 1),
        readiness: unit.readiness || intelligenceItem?.readiness || '待命',
      };
      const unitProfile = buildGroupingUnitProfile(mergedUnit);
      const explicitRole = ['strike', 'cover', 'recon', 'sustain'].includes(String(mergedUnit.role || ''))
        ? String(mergedUnit.role)
        : '';
      const platformRole = explicitRole || unitProfile.role || 'strike';
      let engagementRangeKm = 18
        + unitProfile.capability.firepower * 0.42
        + unitProfile.capability.mobility * 0.16
        + unitProfile.capability.reconCoverage * 0.14;
      if (platformRole === 'recon') engagementRangeKm += 10;
      if (platformRole === 'cover') engagementRangeKm += 6;
      if (includesAny([mergedUnit.name, mergedUnit.category, mergedUnit.notes], ['远程', '导弹', '火箭', '炮'])) engagementRangeKm += 10;
      if (includesAny([mergedUnit.name, mergedUnit.category], ['直升机', '运输机', '无人'])) engagementRangeKm += 8;

      return {
        id: `platform-${group.id}-${unit.id || unitIndex + 1}`,
        sourceUnitId: unit.id ?? intelligenceItem?.id ?? null,
        name: mergedUnit.name,
        category: mergedUnit.category,
        role: platformRole,
        groupId: group.id,
        groupName: group.name,
        groupRole: group.role || platformRole,
        firepower: round(Number(unitProfile.capability.firepower || 0), 1),
        protection: round(Number(unitProfile.capability.protection || 0), 1),
        reconCoverage: round(Number(unitProfile.capability.reconCoverage || 0), 1),
        endurance: round(Number(unitProfile.capability.endurance || 0), 1),
        mobility: round(Number(unitProfile.capability.mobility || 0), 1),
        readinessScore: round(Number(unitProfile.readinessScore || 0), 1),
        dominantMetric: unitProfile.dominantMetric,
        coordinates: resolvePlatformCoordinate(groupAnchor, intelligenceItem, groupIndex, unitIndex),
        engagementRangeKm: round(clamp(engagementRangeKm, 18, 150), 1),
        maxAssignments: clamp(Math.round((unitProfile.readinessScore + unitProfile.capability.endurance) / 100), 1, 2),
        groupMaxAssignments: requestedGroupLimit,
        strength: round(Number(mergedUnit.strength || 0), 1),
        tags: uniqueList([...(safeArray(intelligenceItem?.tags)), ...(safeArray(mergedUnit.tags))]),
      };
    });

    const dominantGroupRole = sortByScore(
      uniqueList(groupPlatforms.map((item) => item.role)).map((role) => ({
        role,
        score: groupPlatforms.filter((item) => item.role === role).length,
      })),
      'score',
    )[0]?.role || 'strike';

    groups.push({
      id: group.id,
      name: group.name,
      role: ['strike', 'cover', 'recon', 'sustain'].includes(String(group.role || ''))
        ? String(group.role)
        : dominantGroupRole,
      unitCount: groupPlatforms.length,
      platformCount: groupPlatforms.length,
      firepower: round(Number(group.firepower || average(groupPlatforms.map((item) => item.firepower))), 1),
      protection: round(Number(group.protection || average(groupPlatforms.map((item) => item.protection))), 1),
      reconCoverage: round(Number(group.reconCoverage || average(groupPlatforms.map((item) => item.reconCoverage))), 1),
      endurance: round(Number(group.endurance || average(groupPlatforms.map((item) => item.endurance))), 1),
      mobility: round(Number(group.mobility || average(groupPlatforms.map((item) => item.mobility))), 1),
      readinessScore: round(average(groupPlatforms.map((item) => item.readinessScore)), 1),
      anchor: groupAnchor,
      maxAssignments: requestedGroupLimit,
      units: groupPlatforms.map((item) => ({
        id: item.sourceUnitId || item.id,
        name: item.name,
        category: item.category,
        role: item.role,
        strength: item.strength,
      })),
    });

    platforms.push(...groupPlatforms.map((item) => ({
      ...item,
      groupRole: ['strike', 'cover', 'recon', 'sustain'].includes(String(group.role || ''))
        ? String(group.role)
        : dominantGroupRole,
    })));
  });

  return {
    platforms,
    groups,
  };
}

function buildTargetAllocationCandidate(platform, target, methodKey, options = {}, validationProfile = TARGET_VALIDATION_PROFILES.standard) {
  const weights = normalizeWeights(safeObject(target.capabilityWeights));
  const capabilityFit = round(clamp(
    Number(platform.firepower || 0) * Number(weights.firepower || 0)
    + Number(platform.protection || 0) * Number(weights.protection || 0)
    + Number(platform.reconCoverage || 0) * Number(weights.reconCoverage || 0)
    + Number(platform.endurance || 0) * Number(weights.endurance || 0)
    + Number(platform.mobility || 0) * Number(weights.mobility || 0),
    0,
    100,
  ), 1);
  let roleFit = 58;
  if (safeArray(target.preferredRoles).includes(platform.role)) roleFit = 96;
  else if (safeArray(target.preferredRoles).includes(platform.groupRole)) roleFit = 82;
  else if (platform.role === 'recon' && target.type === 'deployment-sector') roleFit = 74;
  else if (platform.role === 'cover' && target.type === 'air-defense') roleFit = 72;

  const distanceKm = round(haversineDistanceKm(platform.coordinates, target.coordinates), 1);
  const reachUtilization = round(distanceKm / Math.max(Number(platform.engagementRangeKm || 1), 1), 2);
  const rangeScore = round(clamp(
    100
    - Math.max(0, reachUtilization - 0.55) * 48
    - Math.max(0, reachUtilization - validationProfile.warningReachUtilization) * 64
    - Math.max(0, reachUtilization - validationProfile.maxReachUtilization) * 260,
    0,
    100,
  ), 1);
  const loadFlexibility = round(clamp((Number(platform.maxAssignments || 1) / 2) * 100, 0, 100), 1);
  let feasibilityScore = capabilityFit * 0.34
    + rangeScore * 0.24
    + Number(platform.readinessScore || 0) * 0.14
    + Number(platform.endurance || 0) * 0.1
    + roleFit * 0.1
    + Number(platform.protection || 0) * 0.08
    - Number(target.difficulty || 0) * 0.1
    + loadFlexibility * 0.04;
  feasibilityScore = round(clamp(feasibilityScore, 0, 100), 1);

  let matchScore = capabilityFit * 0.28
    + feasibilityScore * 0.26
    + Number(target.importance || 0) * 0.18
    + roleFit * 0.1
    + (100 - Number(target.difficulty || 0)) * 0.08
    + rangeScore * 0.1;
  if (methodKey === 'hungarian') matchScore += capabilityFit * 0.08 + Number(target.importance || 0) * 0.04;
  if (methodKey === 'ant-colony') matchScore += Number(platform.mobility || 0) * 0.06 + Number(platform.reconCoverage || 0) * 0.05 + loadFlexibility * 0.02;
  if (methodKey === 'multi-objective') matchScore += Number(platform.protection || 0) * 0.05 + Number(platform.endurance || 0) * 0.05;
  if (options.objectivePreference === 'firepower-first') matchScore += Number(platform.firepower || 0) * 0.08 + Number(target.importance || 0) * 0.06;
  if (options.objectivePreference === 'survivability-first') matchScore += Number(platform.protection || 0) * 0.08 + Number(platform.endurance || 0) * 0.06 + rangeScore * 0.04;

  return {
    platformId: platform.id,
    targetId: target.id,
    capabilityFit,
    roleFit: round(roleFit, 1),
    distanceKm,
    reachUtilization,
    rangeScore,
    feasibilityScore,
    matchScore: round(clamp(matchScore, 0, 100), 1),
  };
}

function calculateTargetMatchScore(platform, target, methodKey, options = {}, validationProfile = TARGET_VALIDATION_PROFILES.standard) {
  return buildTargetAllocationCandidate(platform, target, methodKey, options, validationProfile).matchScore;
}

function buildTargetCandidateMatrix(platforms, targets, methodKey, options, validationProfile) {
  return platforms.map((platform) => targets.map((target) => buildTargetAllocationCandidate(platform, target, methodKey, options, validationProfile)));
}

function buildScoreMatrix(platforms, targets, methodKey, options, validationProfile = TARGET_VALIDATION_PROFILES.standard) {
  return buildTargetCandidateMatrix(platforms, targets, methodKey, options, validationProfile)
    .map((row) => row.map((item) => Number(item.matchScore || 0)));
}

function solveHungarianAssignment(scoreMatrix = []) {
  const rowCount = scoreMatrix.length;
  const columnCount = scoreMatrix[0]?.length || 0;
  const size = Math.max(rowCount, columnCount);
  const maxScore = Math.max(0, ...scoreMatrix.flat().map((item) => Number(item || 0)));
  const cost = Array.from({ length: size }, (_, rowIndex) => Array.from({ length: size }, (_, columnIndex) => {
    if (rowIndex < rowCount && columnIndex < columnCount) {
      return maxScore - Number(scoreMatrix[rowIndex][columnIndex] || 0);
    }
    return maxScore + 15;
  }));

  const u = Array(size + 1).fill(0);
  const v = Array(size + 1).fill(0);
  const p = Array(size + 1).fill(0);
  const way = Array(size + 1).fill(0);

  for (let row = 1; row <= size; row += 1) {
    p[0] = row;
    let column = 0;
    const minValues = Array(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(size + 1).fill(false);

    do {
      used[column] = true;
      const currentRow = p[column];
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;

      for (let targetColumn = 1; targetColumn <= size; targetColumn += 1) {
        if (used[targetColumn]) continue;
        const current = cost[currentRow - 1][targetColumn - 1] - u[currentRow] - v[targetColumn];
        if (current < minValues[targetColumn]) {
          minValues[targetColumn] = current;
          way[targetColumn] = column;
        }
        if (minValues[targetColumn] < delta) {
          delta = minValues[targetColumn];
          nextColumn = targetColumn;
        }
      }

      for (let index = 0; index <= size; index += 1) {
        if (used[index]) {
          u[p[index]] += delta;
          v[index] -= delta;
        } else {
          minValues[index] -= delta;
        }
      }

      column = nextColumn;
    } while (p[column] !== 0);

    do {
      const previousColumn = way[column];
      p[column] = p[previousColumn];
      column = previousColumn;
    } while (column !== 0);
  }

  const assignments = [];
  for (let column = 1; column <= size; column += 1) {
    const row = p[column];
    if (row > 0 && row <= rowCount && column <= columnCount) {
      assignments.push({ row: row - 1, column: column - 1 });
    }
  }
  return assignments;
}

function buildAllocationReason(platform, target, candidate = {}) {
  return `${platform.groupName}中的${platform.name}承担 ${target.name}，匹配 ${candidate.matchScore || 0} / 可行性 ${candidate.feasibilityScore || 0} / 距离 ${candidate.distanceKm || 0} km。`;
}

function createAssignment(platform, target, candidate = {}, sequence = 1, packageIndex = 1, wave = 1) {
  return {
    id: `${platform.id}:${target.id}:${sequence}:${packageIndex}`,
    platformId: platform.id,
    platformName: platform.name,
    platformRole: platform.role,
    platformCategory: platform.category,
    groupId: platform.groupId,
    groupName: platform.groupName,
    groupRole: platform.groupRole,
    targetId: target.id,
    targetName: target.name,
    targetType: target.type,
    targetTypeLabel: target.typeLabel,
    priority: target.importance,
    priorityLevel: target.priorityLevel,
    difficulty: target.difficulty,
    matchScore: round(Number(candidate.matchScore || 0), 1),
    feasibilityScore: round(Number(candidate.feasibilityScore || 0), 1),
    capabilityFit: round(Number(candidate.capabilityFit || 0), 1),
    distanceKm: round(Number(candidate.distanceKm || 0), 1),
    reachUtilization: round(Number(candidate.reachUtilization || 0), 2),
    sequence,
    wave,
    packageIndex,
    requiredPlatformCount: target.requiredPlatformCount,
    reason: buildAllocationReason(platform, target, candidate),
  };
}

function createAllocationState(platforms = [], groups = [], targets = []) {
  return {
    platformLoads: new Map(platforms.map((item) => [item.id, 0])),
    groupLoads: new Map(groups.map((item) => [item.id, 0])),
    targetLoads: new Map(targets.map((item) => [item.id, 0])),
    assignmentKeys: new Set(),
  };
}

function getAllocationCount(map, key) {
  return Number(map.get(key) || 0);
}

function calculateTargetCoordinationBonus(selections = [], target = {}, platform = {}) {
  const targetSelections = safeArray(selections).filter((item) => item.targetId === target.id);
  let bonus = target.requiredPlatformCount > 1 && !targetSelections.length ? 3 : 0;
  if (!targetSelections.length) return bonus;

  if (!targetSelections.some((item) => item.groupId === platform.groupId)) bonus += 6;
  if (!targetSelections.some((item) => item.platform.role === platform.role)) bonus += 4;
  if (safeArray(target.preferredRoles).includes(platform.role) && !targetSelections.some((item) => item.platform.role === platform.role)) bonus += 4;
  if (targetSelections.length + 1 >= Number(target.requiredPlatformCount || 1)) bonus += 3;
  return bonus;
}

function calculateAllocationLoadPenalty(state = {}, platform = {}) {
  const platformLoadRatio = getAllocationCount(state.platformLoads, platform.id) / Math.max(Number(platform.maxAssignments || 1), 1);
  const groupLoadRatio = getAllocationCount(state.groupLoads, platform.groupId) / Math.max(Number(platform.groupMaxAssignments || 1), 1);
  return round(platformLoadRatio * 15 + groupLoadRatio * 11, 2);
}

function isCandidateViable(candidate = {}, target = {}, validationProfile = TARGET_VALIDATION_PROFILES.standard, relaxed = false) {
  const matchFloor = Math.max(
    32,
    Number(validationProfile.minCandidateScore || 0)
      - (relaxed ? 8 : 0)
      - (Number(target.importance || 0) >= Number(validationProfile.highPriorityThreshold || 72) ? 4 : 0),
  );
  const feasibilityFloor = Math.max(28, Number(validationProfile.minFeasibilityScore || 0) - (relaxed ? 8 : 0));
  const maxReach = Number(validationProfile.maxReachUtilization || 1) + (relaxed ? 0.12 : 0);

  return Number(candidate.matchScore || 0) >= matchFloor
    && Number(candidate.feasibilityScore || 0) >= feasibilityFloor
    && Number(candidate.reachUtilization || 0) <= maxReach;
}

function canAssignCandidate(state = {}, platform = {}, target = {}, candidate = {}, validationProfile = TARGET_VALIDATION_PROFILES.standard, relaxed = false) {
  if (!candidate) return false;
  if (state.assignmentKeys?.has(`${platform.id}:${target.id}`)) return false;
  if (getAllocationCount(state.platformLoads, platform.id) >= Number(platform.maxAssignments || 1)) return false;
  if (getAllocationCount(state.groupLoads, platform.groupId) >= Number(platform.groupMaxAssignments || 1)) return false;
  if (getAllocationCount(state.targetLoads, target.id) >= Number(target.requiredPlatformCount || 1)) return false;
  return isCandidateViable(candidate, target, validationProfile, relaxed);
}

function recordAllocationSelection(state = {}, selections = [], platform = {}, target = {}, candidate = {}, wave = 1) {
  const sequence = getAllocationCount(state.platformLoads, platform.id) + 1;
  const packageIndex = getAllocationCount(state.targetLoads, target.id) + 1;
  state.platformLoads.set(platform.id, sequence);
  state.groupLoads.set(platform.groupId, getAllocationCount(state.groupLoads, platform.groupId) + 1);
  state.targetLoads.set(target.id, packageIndex);
  state.assignmentKeys.add(`${platform.id}:${target.id}`);
  selections.push({
    platformId: platform.id,
    groupId: platform.groupId,
    targetId: target.id,
    platform,
    target,
    candidate,
    sequence,
    packageIndex,
    wave,
  });
}

function buildCoverageSummary(targets = [], assignments = []) {
  const assignmentMap = new Map(safeArray(targets).map((item) => [item.id, []]));
  for (const assignment of safeArray(assignments)) {
    if (!assignmentMap.has(assignment.targetId)) assignmentMap.set(assignment.targetId, []);
    assignmentMap.get(assignment.targetId).push(assignment);
  }

  return safeArray(targets).map((target) => {
    const items = assignmentMap.get(target.id) || [];
    const involvedGroups = uniqueList(items.map((item) => item.groupName));
    return {
      id: target.id,
      name: target.name,
      type: target.type,
      typeLabel: target.typeLabel,
      importance: target.importance,
      difficulty: target.difficulty,
      priorityLevel: target.priorityLevel,
      requiredPlatformCount: target.requiredPlatformCount,
      assignedPlatformCount: items.length,
      remainingPlatformCount: Math.max(Number(target.requiredPlatformCount || 1) - items.length, 0),
      fullyCovered: items.length >= Number(target.requiredPlatformCount || 1),
      coverageRate: round((items.length / Math.max(Number(target.requiredPlatformCount || 1), 1)) * 100, 1),
      involvedGroups,
      involvedGroupCount: involvedGroups.length,
      platformNames: uniqueList(items.map((item) => item.platformName)).slice(0, 6),
      averageMatchScore: round(average(items.map((item) => item.matchScore)), 1),
      averageFeasibilityScore: round(average(items.map((item) => item.feasibilityScore)), 1),
    };
  });
}

function buildGroupLoadSummary(groups = [], platforms = [], assignments = []) {
  const assignmentMap = new Map();
  const targetMap = new Map();

  for (const assignment of safeArray(assignments)) {
    assignmentMap.set(assignment.groupId, (assignmentMap.get(assignment.groupId) || 0) + 1);
    if (!targetMap.has(assignment.groupId)) targetMap.set(assignment.groupId, new Set());
    targetMap.get(assignment.groupId).add(assignment.targetId);
  }

  return safeArray(groups).map((group) => {
    const relatedAssignments = safeArray(assignments).filter((item) => item.groupId === group.id);
    const assignedCount = assignmentMap.get(group.id) || 0;
    const maxAssignments = Number(group.maxAssignments || 1);
    return {
      ...group,
      platformCount: safeArray(platforms).filter((item) => item.groupId === group.id).length,
      assignedCount,
      targetCount: targetMap.get(group.id)?.size || 0,
      maxAssignments,
      loadRatio: round(assignedCount / Math.max(maxAssignments, 1), 2),
      averageMatchScore: round(average(relatedAssignments.map((item) => item.matchScore)), 1),
      overloaded: assignedCount > maxAssignments,
    };
  });
}

function buildPlatformLoadSummary(platforms = [], assignments = []) {
  const assignmentMap = new Map();
  for (const assignment of safeArray(assignments)) {
    assignmentMap.set(assignment.platformId, (assignmentMap.get(assignment.platformId) || 0) + 1);
  }
  return safeArray(platforms).map((platform) => {
    const assignedCount = assignmentMap.get(platform.id) || 0;
    const maxAssignments = Number(platform.maxAssignments || 1);
    return {
      id: platform.id,
      name: platform.name,
      groupId: platform.groupId,
      groupName: platform.groupName,
      role: platform.role,
      assignedCount,
      maxAssignments,
      loadRatio: round(assignedCount / Math.max(maxAssignments, 1), 2),
      overloaded: assignedCount > maxAssignments,
    };
  });
}

function buildAllocationObjectives(assignments = [], targets = [], coverage = [], groupLoads = [], platformLoads = []) {
  const partialCoverRate = targets.length ? round((coverage.filter((item) => item.assignedPlatformCount > 0).length / targets.length) * 100, 1) : 0;
  const fullCoverRate = targets.length ? round((coverage.filter((item) => item.fullyCovered).length / targets.length) * 100, 1) : 0;
  const highPriorityTargets = coverage.filter((item) => Number(item.importance || 0) >= 75);
  const priorityCoverageRate = highPriorityTargets.length
    ? round((highPriorityTargets.filter((item) => item.fullyCovered).length / highPriorityTargets.length) * 100, 1)
    : fullCoverRate;
  const collaborativeTargets = coverage.filter((item) => Number(item.requiredPlatformCount || 1) > 1);
  const collaborationRate = collaborativeTargets.length
    ? round((collaborativeTargets.filter((item) => item.assignedPlatformCount > 1).length / collaborativeTargets.length) * 100, 1)
    : fullCoverRate;
  const averageMatchScore = round(average(assignments.map((item) => item.matchScore)), 1);
  const averageFeasibilityScore = round(average(assignments.map((item) => item.feasibilityScore)), 1);
  const averageDistanceKm = round(average(assignments.map((item) => item.distanceKm)), 1);
  const loadRatios = safeArray(groupLoads).map((item) => Number(item.loadRatio || 0) * 100);
  const loadBalance = round(clamp(
    100
    - standardDeviation(loadRatios) * 1.6
    - groupLoads.filter((item) => item.overloaded).length * 12
    - platformLoads.filter((item) => item.overloaded).length * 6,
    0,
    100,
  ), 1);
  const riskExposure = round(clamp(average(assignments.map((item) => (
    Math.max(0, Number(item.reachUtilization || 0) - 0.75) * 85
    + Math.max(0, 60 - Number(item.feasibilityScore || 0)) * 0.7
  ))), 0, 100), 1);
  const backlogPenalty = round(clamp(sumBy(
    coverage.filter((item) => !item.fullyCovered),
    (item) => Number(item.remainingPlatformCount || 0) * (Number(item.importance || 0) / 100) * 24,
  ), 0, 100), 1);

  return {
    partialCoverRate,
    fullCoverRate,
    priorityCoverageRate,
    collaborationRate,
    averageMatchScore,
    averageFeasibilityScore,
    averageDistanceKm,
    loadBalance,
    riskExposure,
    backlogPenalty,
  };
}

function calculateAllocationCompositeScore(objectives = {}, preference = 'balanced', methodKey = 'hungarian') {
  let score = Number(objectives.priorityCoverageRate || 0) * 0.22
    + Number(objectives.fullCoverRate || 0) * 0.16
    + Number(objectives.partialCoverRate || 0) * 0.1
    + Number(objectives.averageMatchScore || 0) * 0.18
    + Number(objectives.averageFeasibilityScore || 0) * 0.18
    + Number(objectives.loadBalance || 0) * 0.08
    + Number(objectives.collaborationRate || 0) * 0.06
    - Number(objectives.riskExposure || 0) * 0.12
    - Number(objectives.backlogPenalty || 0) * 0.08;

  if (preference === 'firepower-first') score += Number(objectives.priorityCoverageRate || 0) * 0.05 + Number(objectives.averageMatchScore || 0) * 0.04;
  if (preference === 'survivability-first') score += Number(objectives.averageFeasibilityScore || 0) * 0.05 + Number(objectives.loadBalance || 0) * 0.04 - Number(objectives.riskExposure || 0) * 0.05;
  if (methodKey === 'hungarian') score += Number(objectives.priorityCoverageRate || 0) * 0.04;
  if (methodKey === 'ant-colony') score += Number(objectives.collaborationRate || 0) * 0.05;
  if (methodKey === 'multi-objective') score += Number(objectives.loadBalance || 0) * 0.04;

  return round(clamp(score, 0, 100), 1);
}

function finalizeAllocationPlan(methodKey, platforms, groups, targets, selections = [], metadata = {}) {
  const assignments = safeArray(selections)
    .map((item) => createAssignment(item.platform, item.target, item.candidate, item.sequence, item.packageIndex, item.wave))
    .sort((left, right) => Number(left.wave || 0) - Number(right.wave || 0) || Number(right.priority || 0) - Number(left.priority || 0) || Number(right.matchScore || 0) - Number(left.matchScore || 0));
  const coverage = buildCoverageSummary(targets, assignments);
  const backlogTargets = coverage.filter((item) => !item.fullyCovered);
  const groupLoads = buildGroupLoadSummary(groups, platforms, assignments);
  const platformLoads = buildPlatformLoadSummary(platforms, assignments);
  const objectives = buildAllocationObjectives(assignments, targets, coverage, groupLoads, platformLoads);
  const score = round(clamp(
    metadata.scoreOverride ?? calculateAllocationCompositeScore(objectives, metadata.objectivePreference || 'balanced', methodKey),
    0,
    100,
  ), 1);

  return {
    id: `plan-${methodKey}`,
    methodKey,
    methodLabel: findMethodLabel(TARGET_METHODS, methodKey),
    score,
    assignments,
    backlogTargets,
    coverage,
    groupLoads,
    platformLoads,
    objectives,
    optimizationMeta: safeObject(metadata.optimizationMeta),
    stats: {
      assignedTargetCount: coverage.filter((item) => item.assignedPlatformCount > 0).length,
      fullyCoveredTargetCount: coverage.filter((item) => item.fullyCovered).length,
      backlogTargetCount: backlogTargets.length,
      averageMatchScore: objectives.averageMatchScore,
      averageFeasibilityScore: objectives.averageFeasibilityScore,
      coverRate: objectives.partialCoverRate,
      fullCoverRate: objectives.fullCoverRate,
      priorityCoverRate: objectives.priorityCoverageRate,
      collaborationTargetCount: coverage.filter((item) => item.assignedPlatformCount > 1).length,
      averageDistanceKm: objectives.averageDistanceKm,
      loadBalance: objectives.loadBalance,
      platformCount: platforms.length,
      groupCount: groups.length,
    },
  };
}

function buildHungarianPlan(platforms, groups, targets, options, validationProfile) {
  const candidateMatrix = buildTargetCandidateMatrix(platforms, targets, 'hungarian', options, validationProfile);
  const selections = [];
  const state = createAllocationState(platforms, groups, targets);
  const maxWaves = Math.max(1, ...safeArray(targets).map((item) => Number(item.requiredPlatformCount || 1)));

  for (let wave = 1; wave <= maxWaves; wave += 1) {
    const availablePlatforms = platforms
      .map((platform, platformIndex) => ({ platform, platformIndex }))
      .filter(({ platform }) => (
        getAllocationCount(state.platformLoads, platform.id) < Number(platform.maxAssignments || 1)
        && getAllocationCount(state.groupLoads, platform.groupId) < Number(platform.groupMaxAssignments || 1)
      ));
    const pendingTargets = targets
      .map((target, targetIndex) => ({ target, targetIndex }))
      .filter(({ target }) => getAllocationCount(state.targetLoads, target.id) < Number(target.requiredPlatformCount || 1))
      .sort((left, right) => Number(right.target.importance || 0) - Number(left.target.importance || 0) || Number(right.target.difficulty || 0) - Number(left.target.difficulty || 0));

    if (!availablePlatforms.length || !pendingTargets.length) break;

    const scoreMatrix = availablePlatforms.map(({ platform, platformIndex }) => pendingTargets.map(({ target, targetIndex }) => {
      const candidate = candidateMatrix[platformIndex][targetIndex];
      const relaxed = wave > 1;
      if (!canAssignCandidate(state, platform, target, candidate, validationProfile, relaxed)) return 0;
      const coordinationBonus = calculateTargetCoordinationBonus(selections, target, platform);
      const loadPenalty = calculateAllocationLoadPenalty(state, platform);
      const sameGroupPenalty = selections.some((item) => item.targetId === target.id && item.groupId === platform.groupId) ? 5 : 0;
      const remainingNeed = Number(target.requiredPlatformCount || 1) - getAllocationCount(state.targetLoads, target.id);
      return round(Math.max(
        0,
        Number(candidate.matchScore || 0)
        + Number(candidate.feasibilityScore || 0) * 0.22
        + coordinationBonus
        + remainingNeed * 4
        + Number(target.importance || 0) * 0.12
        - loadPenalty
        - sameGroupPenalty,
      ), 4);
    }));

    const pairings = solveHungarianAssignment(scoreMatrix);
    let progressed = false;
    for (const { row, column } of pairings) {
      const { platform, platformIndex } = availablePlatforms[row] || {};
      const { target, targetIndex } = pendingTargets[column] || {};
      const candidate = candidateMatrix[platformIndex]?.[targetIndex];
      if (!platform || !target || !candidate) continue;
      if (!canAssignCandidate(state, platform, target, candidate, validationProfile, wave > 1)) continue;
      recordAllocationSelection(state, selections, platform, target, candidate, wave);
      progressed = true;
    }

    if (!progressed) break;
  }

  return finalizeAllocationPlan('hungarian', platforms, groups, targets, selections, {
    objectivePreference: options.objectivePreference,
    optimizationMeta: {
      waves: maxWaves,
      strategy: 'multi-wave-hungarian',
    },
  });
}

function sampleWeightedCandidate(candidates = [], random = Math.random, field = 'weight') {
  const validCandidates = safeArray(candidates).filter((item) => Number(item?.[field] || 0) > 0);
  if (!validCandidates.length) {
    return sortByScore(candidates, 'objectiveScore')[0] || sortByScore(candidates, 'score')[0] || null;
  }
  const total = sumBy(validCandidates, (item) => Number(item[field] || 0));
  let cursor = random() * total;
  for (const item of validCandidates) {
    cursor -= Number(item[field] || 0);
    if (cursor <= 0) return item;
  }
  return validCandidates[validCandidates.length - 1] || null;
}

function buildAntColonyPlan(platforms, groups, targets, options, validationProfile) {
  const candidateMatrix = buildTargetCandidateMatrix(platforms, targets, 'ant-colony', options, validationProfile);
  const platformIndexMap = new Map(platforms.map((item, index) => [item.id, index]));
  const targetIndexMap = new Map(targets.map((item, index) => [item.id, index]));
  const antCount = clamp(Math.round(Math.max(6, Math.min(platforms.length + 2, 12))), 6, 12);
  const iterations = clamp(Math.round(Math.max(10, Math.min(targets.length * 3, 20))), 10, 20);
  let pheromone = platforms.map(() => targets.map(() => 1));
  let bestPlan = finalizeAllocationPlan('ant-colony', platforms, groups, targets, [], {
    objectivePreference: options.objectivePreference,
  });
  const seedBase = `target-allocation|ant|${platforms.length}|${targets.length}|${JSON.stringify(options || {})}`;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const iterationPlans = [];
    for (let ant = 0; ant < antCount; ant += 1) {
      const random = createGroupingRandom(hashGroupingSeed(`${seedBase}|${iteration}|${ant}`));
      const state = createAllocationState(platforms, groups, targets);
      const selections = [];
      const orderedTargets = targets
        .map((target, targetIndex) => ({
          target,
          targetIndex,
          sortScore: Number(target.importance || 0) * 1.1 + Number(target.requiredPlatformCount || 1) * 8 + random() * 10 - Number(target.difficulty || 0) * 0.04,
        }))
        .sort((left, right) => right.sortScore - left.sortScore);

      for (const { target, targetIndex } of orderedTargets) {
        while (getAllocationCount(state.targetLoads, target.id) < Number(target.requiredPlatformCount || 1)) {
          const relaxed = iteration > Math.floor(iterations * 0.55);
          const candidates = platforms.map((platform, platformIndex) => {
            const candidate = candidateMatrix[platformIndex][targetIndex];
            if (!canAssignCandidate(state, platform, target, candidate, validationProfile, relaxed)) return null;
            const coordinationBonus = calculateTargetCoordinationBonus(selections, target, platform);
            const heuristic = Math.max(
              0.01,
              Number(candidate.matchScore || 0) * 0.58
              + Number(candidate.feasibilityScore || 0) * 0.32
              + Number(target.importance || 0) * 0.1
              + coordinationBonus * 1.4
              - calculateAllocationLoadPenalty(state, platform)
              - (selections.some((item) => item.targetId === target.id && item.groupId === platform.groupId) ? 4 : 0),
            );
            const pheromoneValue = Number(pheromone[platformIndex]?.[targetIndex] || 1);
            return {
              platform,
              candidate,
              weight: Math.max(0.01, (pheromoneValue ** 1.18) * ((heuristic / 100) ** 2.1) * (1 + coordinationBonus / 18)),
              objectiveScore: heuristic,
            };
          }).filter(Boolean);

          const selected = sampleWeightedCandidate(candidates, random, 'weight');
          if (!selected) break;
          recordAllocationSelection(state, selections, selected.platform, target, selected.candidate, getAllocationCount(state.targetLoads, target.id) + 1);
        }
      }

      const plan = finalizeAllocationPlan('ant-colony', platforms, groups, targets, selections, {
        objectivePreference: options.objectivePreference,
        optimizationMeta: {
          ants: antCount,
          iterations,
          iteration: iteration + 1,
        },
      });
      iterationPlans.push(plan);
      if (plan.score > bestPlan.score) bestPlan = plan;
    }

    pheromone = pheromone.map((row) => row.map((value) => round(value * 0.76, 4)));
    const topPlans = sortByScore(iterationPlans, 'score').slice(0, 3);
    for (const [rank, plan] of topPlans.entries()) {
      for (const assignment of safeArray(plan.assignments)) {
        const platformIndex = platformIndexMap.get(assignment.platformId);
        const targetIndex = targetIndexMap.get(assignment.targetId);
        if (platformIndex == null || targetIndex == null) continue;
        const delta = ((Number(plan.score || 0) / 100) * (rank === 0 ? 0.95 : 0.55)) / Math.max(safeArray(plan.assignments).length, 1)
          + Number(assignment.matchScore || 0) / 220;
        pheromone[platformIndex][targetIndex] = round(clamp(Number(pheromone[platformIndex][targetIndex] || 0) + delta, 0.05, 8), 4);
      }
    }
  }

  return {
    ...bestPlan,
    optimizationMeta: {
      ...safeObject(bestPlan.optimizationMeta),
      ants: antCount,
      iterations,
      pheromonePeak: round(Math.max(0, ...pheromone.flat().map((item) => Number(item || 0))), 2),
    },
  };
}

function resolveObjectivePreferenceWeights(preference = 'balanced') {
  const weights = {
    match: 0.24,
    feasibility: 0.22,
    priority: 0.22,
    coordination: 0.12,
    risk: 0.1,
    load: 0.1,
  };

  if (preference === 'firepower-first') {
    weights.match += 0.08;
    weights.priority += 0.08;
    weights.risk -= 0.04;
    weights.load -= 0.04;
  }
  if (preference === 'survivability-first') {
    weights.feasibility += 0.08;
    weights.risk += 0.07;
    weights.load += 0.04;
    weights.priority -= 0.05;
    weights.match -= 0.04;
  }

  return normalizeWeights(weights);
}

function mutateObjectiveWeights(weights = {}, random = Math.random, magnitude = 0.12) {
  const mutated = Object.fromEntries(Object.entries(weights).map(([key, value]) => [
    key,
    Math.max(0.02, Number(value || 0) + ((random() * 2) - 1) * magnitude),
  ]));
  return normalizeWeights(mutated);
}

function crossoverObjectiveWeights(left = {}, right = {}, random = Math.random) {
  const keys = uniqueList([...Object.keys(left), ...Object.keys(right)]);
  const mixed = {};
  for (const key of keys) {
    const bias = 0.35 + random() * 0.3;
    mixed[key] = Number(left[key] || 0) * bias + Number(right[key] || 0) * (1 - bias);
  }
  return normalizeWeights(mixed);
}

function buildConstructiveMultiObjectivePlan(platforms, groups, targets, candidateMatrix, options, validationProfile, objectiveWeights, random = Math.random, selectionMode = 'greedy', tag = 'seed') {
  const state = createAllocationState(platforms, groups, targets);
  const selections = [];
  const orderedTargets = targets
    .map((target, targetIndex) => ({
      target,
      targetIndex,
      sortScore: Number(target.importance || 0) * (1.6 + Number(objectiveWeights.priority || 0))
        + Number(target.requiredPlatformCount || 1) * 9
        + Number(target.difficulty || 0) * 0.25
        + random() * 8,
    }))
    .sort((left, right) => right.sortScore - left.sortScore);

  for (const { target, targetIndex } of orderedTargets) {
    while (getAllocationCount(state.targetLoads, target.id) < Number(target.requiredPlatformCount || 1)) {
      const relaxed = Number(target.importance || 0) >= Number(validationProfile.highPriorityThreshold || 72) || selectionMode === 'explore';
      const candidates = platforms.map((platform, platformIndex) => {
        const candidate = candidateMatrix[platformIndex][targetIndex];
        if (!canAssignCandidate(state, platform, target, candidate, validationProfile, relaxed)) return null;
        const coordinationBonus = calculateTargetCoordinationBonus(selections, target, platform);
        const loadPenalty = calculateAllocationLoadPenalty(state, platform);
        const repeatedGroupPenalty = selections.some((item) => item.targetId === target.id && item.groupId === platform.groupId) ? 5 : 0;
        const riskBudget = Math.max(0, 100 - Number(candidate.reachUtilization || 0) * 100);
        const objectiveScore = Number(candidate.matchScore || 0) * Number(objectiveWeights.match || 0)
          + Number(candidate.feasibilityScore || 0) * Number(objectiveWeights.feasibility || 0)
          + Number(target.importance || 0) * Number(objectiveWeights.priority || 0)
          + coordinationBonus * Number(objectiveWeights.coordination || 0) * 8
          + riskBudget * Number(objectiveWeights.risk || 0)
          - loadPenalty * Number(objectiveWeights.load || 0) * 1.6
          - repeatedGroupPenalty
          + random() * 4;
        return {
          platform,
          candidate,
          objectiveScore,
          weight: Math.max(0.01, objectiveScore),
        };
      }).filter(Boolean);

      if (!candidates.length) break;
      const selected = ['probabilistic', 'explore'].includes(selectionMode)
        ? sampleWeightedCandidate(candidates, random, 'weight')
        : sortByScore(candidates, 'objectiveScore')[0];
      if (!selected) break;
      recordAllocationSelection(state, selections, selected.platform, target, selected.candidate, getAllocationCount(state.targetLoads, target.id) + 1);
    }
  }

  return finalizeAllocationPlan('multi-objective', platforms, groups, targets, selections, {
    objectivePreference: options.objectivePreference,
    optimizationMeta: {
      strategy: tag,
      selectionMode,
      weightVector: Object.fromEntries(Object.entries(objectiveWeights).map(([key, value]) => [key, round(value, 3)])),
    },
  });
}

function getPlanObjectiveVector(plan = {}) {
  const objectives = safeObject(plan.objectives);
  return {
    priorityCoverageRate: Number(objectives.priorityCoverageRate || 0),
    fullCoverRate: Number(objectives.fullCoverRate || 0),
    averageMatchScore: Number(objectives.averageMatchScore || 0),
    averageFeasibilityScore: Number(objectives.averageFeasibilityScore || 0),
    loadBalance: Number(objectives.loadBalance || 0),
    collaborationRate: Number(objectives.collaborationRate || 0),
    riskExposure: Number(objectives.riskExposure || 100),
    backlogPenalty: Number(objectives.backlogPenalty || 100),
  };
}

function planDominates(leftPlan = {}, rightPlan = {}) {
  const left = getPlanObjectiveVector(leftPlan);
  const right = getPlanObjectiveVector(rightPlan);
  const maximizeKeys = ['priorityCoverageRate', 'fullCoverRate', 'averageMatchScore', 'averageFeasibilityScore', 'loadBalance', 'collaborationRate'];
  const minimizeKeys = ['riskExposure', 'backlogPenalty'];
  let betterOrEqual = true;
  let strictlyBetter = false;

  for (const key of maximizeKeys) {
    if (left[key] < right[key] - 0.01) betterOrEqual = false;
    if (left[key] > right[key] + 0.01) strictlyBetter = true;
  }
  for (const key of minimizeKeys) {
    if (left[key] > right[key] + 0.01) betterOrEqual = false;
    if (left[key] < right[key] - 0.01) strictlyBetter = true;
  }

  return betterOrEqual && strictlyBetter;
}

function applyCrowdingDistance(front = []) {
  const items = safeArray(front).map((item) => ({ ...item, crowdingDistance: 0 }));
  const keys = ['priorityCoverageRate', 'fullCoverRate', 'averageMatchScore', 'averageFeasibilityScore', 'loadBalance', 'collaborationRate', 'riskExposure', 'backlogPenalty'];

  for (const key of keys) {
    const sorted = [...items].sort((left, right) => getPlanObjectiveVector(left.plan)[key] - getPlanObjectiveVector(right.plan)[key]);
    const min = getPlanObjectiveVector(sorted[0]?.plan || {})[key];
    const max = getPlanObjectiveVector(sorted[sorted.length - 1]?.plan || {})[key];
    const range = Math.max(max - min, 1);

    if (sorted.length) {
      sorted[0].crowdingDistance = Number.POSITIVE_INFINITY;
      sorted[sorted.length - 1].crowdingDistance = Number.POSITIVE_INFINITY;
    }

    for (let index = 1; index < sorted.length - 1; index += 1) {
      const previous = getPlanObjectiveVector(sorted[index - 1].plan)[key];
      const next = getPlanObjectiveVector(sorted[index + 1].plan)[key];
      const current = items.find((item) => item.id === sorted[index].id);
      if (!current || !Number.isFinite(current.crowdingDistance)) continue;
      current.crowdingDistance += Math.abs(next - previous) / range;
    }
  }

  return items.sort((left, right) => Number(right.crowdingDistance || 0) - Number(left.crowdingDistance || 0));
}

function buildParetoFronts(population = []) {
  const items = safeArray(population).map((item) => ({ ...item }));
  const dominationCounts = new Map(items.map((item) => [item.id, 0]));
  const dominatesMap = new Map(items.map((item) => [item.id, []]));
  const fronts = [];
  let currentFront = [];

  for (const left of items) {
    for (const right of items) {
      if (left.id === right.id) continue;
      if (planDominates(left.plan, right.plan)) {
        dominatesMap.get(left.id).push(right);
      } else if (planDominates(right.plan, left.plan)) {
        dominationCounts.set(left.id, Number(dominationCounts.get(left.id) || 0) + 1);
      }
    }
    if (Number(dominationCounts.get(left.id) || 0) === 0) {
      left.paretoRank = 1;
      currentFront.push(left);
    }
  }

  let rank = 1;
  while (currentFront.length) {
    const rankedFront = applyCrowdingDistance(currentFront).map((item) => ({ ...item, paretoRank: rank }));
    fronts.push(rankedFront);
    const nextFront = [];

    for (const item of currentFront) {
      for (const dominated of dominatesMap.get(item.id) || []) {
        dominationCounts.set(dominated.id, Number(dominationCounts.get(dominated.id) || 0) - 1);
        if (Number(dominationCounts.get(dominated.id) || 0) === 0) {
          nextFront.push({ ...dominated, paretoRank: rank + 1 });
        }
      }
    }

    rank += 1;
    currentFront = nextFront;
  }

  return fronts;
}

function selectParetoPopulation(population = [], size = 10) {
  const fronts = buildParetoFronts(population);
  const selected = [];

  for (const front of fronts) {
    if (selected.length + front.length <= size) {
      selected.push(...front);
      continue;
    }
    selected.push(...front.slice(0, Math.max(0, size - selected.length)));
    break;
  }

  return {
    selected,
    fronts,
  };
}

function scoreParetoPlanByPreference(plan = {}, preference = 'balanced') {
  return calculateAllocationCompositeScore(plan.objectives, preference, plan.methodKey || 'multi-objective');
}

function buildMultiObjectivePlan(platforms, groups, targets, options, validationProfile) {
  const candidateMatrix = buildTargetCandidateMatrix(platforms, targets, 'multi-objective', options, validationProfile);
  const baseWeights = resolveObjectivePreferenceWeights(options.objectivePreference);
  const populationSize = clamp(Math.max(12, Math.min(platforms.length + targets.length, 20)), 12, 20);
  const generations = clamp(Math.max(6, Math.min(targets.length + 4, 12)), 6, 12);
  const seedBase = `target-allocation|multi-objective|${platforms.length}|${targets.length}|${JSON.stringify(options || {})}`;

  let population = Array.from({ length: populationSize }, (_, index) => {
    const random = createGroupingRandom(hashGroupingSeed(`${seedBase}|seed|${index}`));
    let weights = index === 0 ? baseWeights : mutateObjectiveWeights(baseWeights, random, 0.18);
    if (index % 4 === 1) weights = mutateObjectiveWeights({ ...baseWeights, priority: Number(baseWeights.priority || 0) + 0.08 }, random, 0.14);
    if (index % 4 === 2) weights = mutateObjectiveWeights({ ...baseWeights, feasibility: Number(baseWeights.feasibility || 0) + 0.08 }, random, 0.14);
    const selectionMode = index % 3 === 0 ? 'probabilistic' : index % 3 === 1 ? 'greedy' : 'explore';
    return {
      id: `population-${index + 1}`,
      weights,
      plan: buildConstructiveMultiObjectivePlan(
        platforms,
        groups,
        targets,
        candidateMatrix,
        options,
        validationProfile,
        weights,
        random,
        selectionMode,
        `seed-${index + 1}`,
      ),
    };
  });

  for (let generation = 0; generation < generations; generation += 1) {
    const { selected } = selectParetoPopulation(population, Math.max(4, Math.ceil(populationSize / 2)));
    const elites = selected.length ? selected : population;

    if (generation === generations - 1) {
      population = elites;
      break;
    }

    const children = [];
    while (elites.length + children.length < populationSize) {
      const childIndex = children.length;
      const parentA = elites[childIndex % elites.length] || elites[0];
      const parentB = elites[(childIndex * 2 + 1) % elites.length] || parentA;
      const random = createGroupingRandom(hashGroupingSeed(`${seedBase}|gen|${generation}|child|${childIndex}`));
      const weights = mutateObjectiveWeights(crossoverObjectiveWeights(parentA.weights, parentB.weights, random), random, 0.1);
      const selectionMode = childIndex % 2 === 0 ? 'probabilistic' : 'greedy';
      children.push({
        id: `generation-${generation + 1}-child-${childIndex + 1}`,
        weights,
        plan: buildConstructiveMultiObjectivePlan(
          platforms,
          groups,
          targets,
          candidateMatrix,
          options,
          validationProfile,
          weights,
          random,
          selectionMode,
          `gen-${generation + 1}-child-${childIndex + 1}`,
        ),
      });
    }

    population = [...elites, ...children].slice(0, populationSize);
  }

  const { fronts } = selectParetoPopulation(population, population.length);
  const paretoFront = fronts[0] || [];
  const preferredEntry = [...paretoFront].sort((left, right) => (
    scoreParetoPlanByPreference(right.plan, options.objectivePreference)
    - scoreParetoPlanByPreference(left.plan, options.objectivePreference)
    || Number(right.plan.score || 0) - Number(left.plan.score || 0)
  ))[0];
  const fallbackPlan = sortByScore(population.map((item) => item.plan), 'score')[0] || finalizeAllocationPlan('multi-objective', platforms, groups, targets, [], {
    objectivePreference: options.objectivePreference,
  });
  const selectedPlan = preferredEntry?.plan || fallbackPlan;

  return {
    ...selectedPlan,
    paretoRank: preferredEntry?.paretoRank || 1,
    optimizationMeta: {
      ...safeObject(selectedPlan.optimizationMeta),
      populationSize,
      generations,
      paretoFrontSize: paretoFront.length,
      paretoRank: preferredEntry?.paretoRank || 1,
    },
  };
}

function summarizeValidationNames(items = [], field = 'name', limit = 3) {
  const names = safeArray(items).map((item) => item?.[field]).filter(Boolean);
  if (!names.length) return '';
  if (names.length <= limit) return names.join('、');
  return `${names.slice(0, limit).join('、')} 等 ${names.length} 项`;
}

function validateAllocationPlan(plan, targets, platforms, groups, options = {}, validationProfile = TARGET_VALIDATION_PROFILES.standard) {
  const coverage = safeArray(plan.coverage);
  const assignments = safeArray(plan.assignments);
  const groupLoads = safeArray(plan.groupLoads);
  const platformLoads = safeArray(plan.platformLoads);
  const issues = [];

  if (!targets.length) {
    issues.push({
      level: 'fail',
      title: '未形成可分配目标',
      detail: '敌情威胁分析未输出可用于分配的目标，请先补全威胁结果。',
    });
  }
  if (!platforms.length) {
    issues.push({
      level: 'fail',
      title: '未形成可用平台池',
      detail: '作战力量编组未产出可执行平台，当前无法完成多平台目标分配。',
    });
  }

  const uncoveredHighPriorityTargets = coverage.filter((item) => (
    Number(item.importance || 0) >= Number(validationProfile.highPriorityThreshold || 72)
    && !item.fullyCovered
  ));
  if (uncoveredHighPriorityTargets.length) {
    issues.push({
      level: 'fail',
      title: '高优先级目标未完全覆盖',
      detail: `${summarizeValidationNames(uncoveredHighPriorityTargets)} 仍缺少 ${sumBy(uncoveredHighPriorityTargets, (item) => item.remainingPlatformCount)} 个打击平台。`,
    });
  }

  const incompletePackages = coverage.filter((item) => item.assignedPlatformCount > 0 && !item.fullyCovered);
  if (incompletePackages.length) {
    issues.push({
      level: 'warn',
      title: '部分目标打击包不完整',
      detail: `${summarizeValidationNames(incompletePackages)} 已进入分配，但未达到目标所需的平台数量。`,
    });
  }

  const overloadedGroups = groupLoads.filter((item) => item.overloaded);
  if (overloadedGroups.length) {
    issues.push({
      level: 'warn',
      title: '部分编组分配负荷超限',
      detail: `${summarizeValidationNames(overloadedGroups)} 超过建议上限 ${clamp(Number(options.maxAssignmentsPerGroup || 2), 1, 6)}。`,
    });
  }

  const overloadedPlatforms = platformLoads.filter((item) => item.overloaded);
  if (overloadedPlatforms.length) {
    issues.push({
      level: 'warn',
      title: '部分平台任务序列过密',
      detail: `${summarizeValidationNames(overloadedPlatforms)} 的任务装载超出平台建议能力。`,
    });
  }

  const overRangeAssignments = assignments.filter((item) => Number(item.reachUtilization || 0) > Number(validationProfile.maxReachUtilization || 1));
  if (overRangeAssignments.length) {
    issues.push({
      level: 'fail',
      title: '存在超出建议打击半径的分配',
      detail: `${summarizeValidationNames(overRangeAssignments, 'targetName')} 的部分分配距离超出校核阈值。`,
    });
  }

  const lowFeasibilityAssignments = assignments.filter((item) => Number(item.feasibilityScore || 0) < Number(validationProfile.minFeasibilityScore || 0));
  if (lowFeasibilityAssignments.length) {
    issues.push({
      level: 'warn',
      title: '部分平台分配可行性偏低',
      detail: `${lowFeasibilityAssignments.length} 个分配项低于 ${validationProfile.label} 的可行性阈值 ${validationProfile.minFeasibilityScore}。`,
    });
  }

  const lowMatchAssignments = assignments.filter((item) => Number(item.matchScore || 0) < Number(validationProfile.minMatchScore || 0));
  if (lowMatchAssignments.length) {
    issues.push({
      level: 'warn',
      title: '部分匹配结果低于建议阈值',
      detail: `${lowMatchAssignments.length} 个分配项匹配分低于 ${validationProfile.minMatchScore}。`,
    });
  }

  const singleGroupHighValueTargets = coverage.filter((item) => (
    Number(item.importance || 0) >= Number(validationProfile.highPriorityThreshold || 72)
    && item.fullyCovered
    && Number(item.requiredPlatformCount || 1) > 1
    && Number(item.involvedGroupCount || 0) < 2
  ));
  if (singleGroupHighValueTargets.length) {
    issues.push({
      level: 'warn',
      title: '高价值目标协同来源单一',
      detail: `${summarizeValidationNames(singleGroupHighValueTargets)} 已分配完成，但主要依赖单一编组承担。`,
    });
  }

  if (!issues.length) {
    issues.push({
      level: 'pass',
      title: '分配合理性通过',
      detail: `候选目标 ${targets.length} 个中，高价值目标已覆盖，平台与编组负荷处于 ${validationProfile.label} 建议范围内。`,
    });
  }

  return issues;
}

function buildAdjustmentSuggestions(validation, plan, comparedPlans = [], validationProfile = TARGET_VALIDATION_PROFILES.standard) {
  const suggestions = [];
  const coverage = safeArray(plan.coverage);
  const assignments = safeArray(plan.assignments);
  const groupLoads = safeArray(plan.groupLoads);
  const systemBestPlan = sortByScore(comparedPlans, 'score')[0];

  if (validation.some((item) => item.title.includes('高优先级目标未完全覆盖'))) {
    const uncovered = coverage.filter((item) => !item.fullyCovered).sort((left, right) => Number(right.importance || 0) - Number(left.importance || 0));
    suggestions.push(`建议将 ${summarizeValidationNames(uncovered)} 调整为首波目标，并优先补充火力或掩护平台形成完整打击包。`);
  }
  if (validation.some((item) => item.title.includes('打击包不完整'))) {
    const incomplete = coverage.filter((item) => item.assignedPlatformCount > 0 && !item.fullyCovered);
    suggestions.push(`建议按目标所需平台数补齐 ${summarizeValidationNames(incomplete)} 的后续波次，并优先引入不同编组的协同平台。`);
  }
  if (validation.some((item) => item.title.includes('负荷超限'))) {
    const lowLoadGroups = [...groupLoads].sort((left, right) => Number(left.loadRatio || 0) - Number(right.loadRatio || 0)).slice(0, 2);
    suggestions.push(
      lowLoadGroups.length
        ? `建议将后续任务向 ${summarizeValidationNames(lowLoadGroups)} 转移，降低主攻编组持续超载风险。`
        : '建议降低单编组最大分配数，重新平衡任务负荷。',
    );
  }
  if (validation.some((item) => item.title.includes('打击半径'))) {
    const farthest = [...assignments].sort((left, right) => Number(right.reachUtilization || 0) - Number(left.reachUtilization || 0))[0];
    if (farthest) {
      suggestions.push(`建议前出部署 ${farthest.groupName} 或改由近距离平台接替 ${farthest.targetName}，避免超出建议打击半径。`);
    }
  }
  if (validation.some((item) => item.title.includes('可行性偏低'))) {
    suggestions.push(`建议在 ${validationProfile.label} 下为高难度目标增加侦察引导或掩护平台，再复核平台可行性阈值。`);
  }
  if (validation.some((item) => item.title.includes('匹配结果低于建议阈值'))) {
    suggestions.push(
      plan.methodKey === 'multi-objective'
        ? '建议提高火力或生存性偏好权重，并收紧单编组分配上限，压缩低匹配组合。'
        : '建议切换为“多目标优化分配”重新搜索 Pareto 优势解，平衡匹配度、风险和负荷。',
    );
  }
  if (plan.methodKey === 'hungarian' && coverage.some((item) => !item.fullyCovered)) {
    suggestions.push('匈牙利算法更适合首波快速全局匹配，后续多平台协同补配可转入蚁群协同分配。');
  }
  if (systemBestPlan && systemBestPlan.methodKey !== plan.methodKey && Number(systemBestPlan.score || 0) - Number(plan.score || 0) >= 3) {
    suggestions.push(`系统评分更高的备选方案为“${systemBestPlan.methodLabel}”（评分 ${systemBestPlan.score}），建议纳入对照复核。`);
  }
  if (!suggestions.length) {
    suggestions.push('当前目标分配可作为首版方案进入后续作战方法自动规划环节。');
  }

  return uniqueList(suggestions).map((text, index) => ({
    id: createSequence('adjustment', index),
    text,
  }));
}

async function runBuiltinTargetAllocation(context, step, algorithm, input, dataset) {
  const threatOutput = safeObject(context.stageOutputs['enemy-threat-analysis']);
  const forceGrouping = safeObject(context.stageOutputs['force-grouping']);
  const appliedOptions = {
    objectivePreference: String(input.options?.objectivePreference || 'balanced'),
    validationMode: String(input.options?.validationMode || 'strict'),
    maxAssignmentsPerGroup: clamp(Number(input.options?.maxAssignmentsPerGroup || 2), 1, 6),
  };
  const validationProfile = resolveTargetValidationProfile(appliedOptions.validationMode);
  const targets = buildCandidateTargets(threatOutput);
  const { platforms, groups } = buildPlatformProfiles(forceGrouping, dataset, appliedOptions);
  const plans = [
    buildHungarianPlan(platforms, groups, targets, appliedOptions, validationProfile),
    buildAntColonyPlan(platforms, groups, targets, appliedOptions, validationProfile),
    buildMultiObjectivePlan(platforms, groups, targets, appliedOptions, validationProfile),
  ];
  const preferredPlan = plans.find((item) => item.methodKey === input.builtinMethodKey) || plans[0];
  const systemBestPlan = sortByScore(plans, 'score')[0] || preferredPlan;
  const validation = validateAllocationPlan(preferredPlan, targets, platforms, groups, appliedOptions, validationProfile);
  const adjustmentSuggestions = buildAdjustmentSuggestions(validation, preferredPlan, plans, validationProfile);
  const validationStatus = validation.some((item) => item.level === 'fail')
    ? 'fail'
    : validation.some((item) => item.level === 'warn')
      ? 'warn'
      : 'pass';

  return {
    summary: `已完成 ${plans.length} 种目标分配算法对比，并在 ${validationProfile.label} 下输出 ${preferredPlan.methodLabel} 推荐方案。`,
    outputPreview: [
      `候选目标 ${targets.length} 个 / 可用平台 ${platforms.length} 个 / 涉及编组 ${groups.length} 个`,
      `推荐分配方法：${preferredPlan.methodLabel}（评分 ${preferredPlan.score}，全覆盖率 ${preferredPlan.stats?.fullCoverRate || 0}%）`,
      validation[0] ? `合理性校核：${validation[0].title}（${validationProfile.label}）` : '合理性校核待执行',
    ],
    artifacts: [
      createArtifact('目标分配方案集', '输出匈牙利、蚁群协同和多目标优化三类分配方案，并支持多平台、多目标协同分配。'),
      createArtifact('合理性验证结果', '对高价值目标覆盖、打击包完整性、平台可行性、射程约束和编组负荷进行校核。'),
      createArtifact('调整建议清单', '针对覆盖缺口、协同不足和负荷风险输出可执行的调整建议。'),
    ],
    structuredOutput: {
      implementationStatus: 'implemented',
      builtinMethodKey: input.builtinMethodKey,
      builtinMethodLabel: findMethodLabel(algorithm.builtinMethods, input.builtinMethodKey),
      appliedOptions,
      validationProfile,
      candidateTargets: targets,
      platforms,
      groups,
      comparedPlans: plans,
      preferredPlanMethodKey: preferredPlan.methodKey,
      preferredPlan,
      systemBestPlanMethodKey: systemBestPlan.methodKey,
      systemBestPlan,
      validationSummary: {
        status: validationStatus,
        issueCount: validation.filter((item) => item.level !== 'pass').length,
      },
      validation,
      adjustmentSuggestions,
    },
  };
}

function resolveEnvironmentCenter(item = {}) {
  if (item.geometryType === 'circle') {
    return toCoordinateTuple(item.geometry?.center || []);
  }
  if (item.geometryType === 'polygon') {
    return computePolygonCenter(item.geometry);
  }
  if (item.geometryType === 'point') {
    return toCoordinateTuple(item.geometry);
  }
  return [0, 0, 0];
}

function resolveEnvironmentInfluenceRadiusKm(item = {}) {
  if (item.geometryType === 'circle') {
    return round(Number(item.geometry?.radius || 0) / 1000, 1);
  }
  if (item.geometryType === 'polygon') {
    const center = resolveEnvironmentCenter(item);
    const distances = safeArray(item.geometry).map((point) => haversineDistanceKm(center, point));
    return round(Math.max(...distances, 4), 1);
  }
  return 6;
}

function normalizeCoordinate(point = []) {
  return [
    round(Number(point?.[0] || 0), 4),
    round(Number(point?.[1] || 0), 4),
    round(Number(point?.[2] || 0), 1),
  ];
}

function applyAltitude(point = [], altitude = 0) {
  return [
    round(Number(point?.[0] || 0), 4),
    round(Number(point?.[1] || 0), 4),
    round(Number(altitude || 0), 0),
  ];
}

function coordinateToPlaneKm(point = []) {
  const longitude = Number(point?.[0] || 0);
  const latitude = Number(point?.[1] || 0);
  const altitude = Number(point?.[2] || 0);
  const lonScale = 111.32 * Math.max(0.25, Math.cos((latitude * Math.PI) / 180));
  return {
    x: longitude * lonScale,
    y: latitude * 110.57,
    z: altitude,
  };
}

function planeKmToCoordinate(point = {}, referenceLatitude = 30) {
  const latitude = Number(point.y || 0) / 110.57;
  const lonScale = 111.32 * Math.max(0.25, Math.cos(((Number(referenceLatitude || latitude)) * Math.PI) / 180));
  return normalizeCoordinate([
    Number(point.x || 0) / lonScale,
    latitude,
    Number(point.z || 0),
  ]);
}

function interpolateCoordinate(start = [], end = [], ratio = 0.5, altitude = null) {
  const startPoint = coordinateToPlaneKm(start);
  const endPoint = coordinateToPlaneKm(end);
  const next = {
    x: startPoint.x + ((endPoint.x - startPoint.x) * ratio),
    y: startPoint.y + ((endPoint.y - startPoint.y) * ratio),
    z: altitude === null
      ? (Number(start?.[2] || 0) + ((Number(end?.[2] || 0) - Number(start?.[2] || 0)) * ratio))
      : Number(altitude || 0),
  };
  return planeKmToCoordinate(next, average([start?.[1], end?.[1]]));
}

function resolveOffsetSign(start = [], end = [], threatCenter = null) {
  if (!threatCenter) return 1;
  const startPoint = coordinateToPlaneKm(start);
  const endPoint = coordinateToPlaneKm(end);
  const midPoint = coordinateToPlaneKm(interpolateCoordinate(start, end, 0.5));
  const threatPoint = coordinateToPlaneKm(threatCenter);
  const cross = ((endPoint.x - startPoint.x) * (threatPoint.y - midPoint.y))
    - ((endPoint.y - startPoint.y) * (threatPoint.x - midPoint.x));
  return cross >= 0 ? -1 : 1;
}

function buildOffsetWaypoint(start = [], end = [], ratio = 0.5, offsetKm = 0, sign = 1, altitude = 0) {
  const startPoint = coordinateToPlaneKm(start);
  const endPoint = coordinateToPlaneKm(end);
  const base = {
    x: startPoint.x + ((endPoint.x - startPoint.x) * ratio),
    y: startPoint.y + ((endPoint.y - startPoint.y) * ratio),
    z: altitude,
  };
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.max(Math.hypot(dx, dy), 0.0001);
  const normalX = (-dy / length) * Number(offsetKm || 0) * Number(sign || 1);
  const normalY = (dx / length) * Number(offsetKm || 0) * Number(sign || 1);
  return planeKmToCoordinate({
    x: base.x + normalX,
    y: base.y + normalY,
    z: altitude,
  }, average([start?.[1], end?.[1]]));
}

function dedupePolyline(coordinates = []) {
  const result = [];
  for (const point of safeArray(coordinates)) {
    const normalized = normalizeCoordinate(point);
    const previous = result[result.length - 1];
    if (previous && haversineDistanceKm(previous, normalized) < 0.2 && Math.abs(Number(previous[2] || 0) - Number(normalized[2] || 0)) < 80) {
      continue;
    }
    result.push(normalized);
  }
  return result;
}

function samplePolylineCoordinates(coordinates = [], samplesPerSegment = 4) {
  const points = dedupePolyline(coordinates);
  if (points.length <= 1) return points;
  const samples = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const stepCount = Math.max(2, samplesPerSegment);
    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      samples.push(interpolateCoordinate(start, end, stepIndex / stepCount));
    }
  }
  samples.push(points[points.length - 1]);
  return samples;
}

function computePolylineDistanceKm(coordinates = []) {
  const points = dedupePolyline(coordinates);
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += haversineDistanceKm(points[index], points[index + 1]);
  }
  return round(total, 1);
}

function buildIntelligenceIndex(intelligence = []) {
  return new Map(safeArray(intelligence).map((item) => [Number(item.id), item]));
}

function resolveFallbackAnchor(dataset = {}) {
  const blueIntelligence = safeArray(dataset.intelligence).filter((item) => item.camp === 'blue');
  if (blueIntelligence.length) {
    return normalizeCoordinate([
      average(blueIntelligence.map((item) => item.longitude)),
      average(blueIntelligence.map((item) => item.latitude)),
      0,
    ]);
  }

  const environmentCenter = resolveEnvironmentCenter(safeArray(dataset.environment)[0] || {});
  if (environmentCenter[0] || environmentCenter[1]) {
    return normalizeCoordinate(environmentCenter);
  }

  return [120.18, 30.28, 0];
}

function buildWeightedCenter(entries = [], fallback = [120.18, 30.28, 0]) {
  const validEntries = safeArray(entries).filter((item) => Array.isArray(item?.coordinates) && item.coordinates.length >= 2);
  if (!validEntries.length) return normalizeCoordinate(fallback);
  const totalWeight = sumBy(validEntries, (item) => Math.max(0.2, Number(item.weight || 1)));
  return normalizeCoordinate([
    sumBy(validEntries, (item) => Number(item.coordinates[0] || 0) * Math.max(0.2, Number(item.weight || 1))) / totalWeight,
    sumBy(validEntries, (item) => Number(item.coordinates[1] || 0) * Math.max(0.2, Number(item.weight || 1))) / totalWeight,
    0,
  ]);
}

function buildThreatRiskNodes(threatOutput = {}) {
  return [
    ...safeArray(threatOutput.fireCoverage).map((item) => ({
      id: item.id,
      name: item.name,
      type: 'fire-coverage',
      coordinates: normalizeCoordinate(item.center),
      radiusKm: Number(item.coverageKm || 0),
      weight: round((Number(item.threatValue || 65) / 100) * 1.05, 2),
    })),
    ...safeArray(threatOutput.airDefenseSystem).map((item) => ({
      id: item.id,
      name: item.name,
      type: 'air-defense',
      coordinates: normalizeCoordinate(item.location),
      radiusKm: Number(item.coverageKm || 0),
      weight: round((Number(item.strength || 72) / 100) * 1.18, 2),
    })),
    ...safeArray(threatOutput.reconEarlyWarning).map((item) => ({
      id: item.id,
      name: item.name,
      type: 'recon-warning',
      coordinates: normalizeCoordinate(item.location),
      radiusKm: Number(item.coverageKm || 0),
      weight: round((Number(item.confidence || 62) / 100) * 0.88, 2),
    })),
    ...safeArray(threatOutput.antiAirborneFacilities).map((item) => ({
      id: item.id,
      name: item.name,
      type: 'anti-airborne',
      coordinates: normalizeCoordinate(item.location),
      radiusKm: 10,
      weight: round((Number(item.confidence || 66) / 100) * 1.12, 2),
    })),
    ...safeArray(threatOutput.deploymentSectors).map((item) => ({
      id: item.id,
      name: item.name,
      type: 'deployment-sector',
      coordinates: normalizeCoordinate(item.center),
      radiusKm: round(Math.max(6, average(safeArray(item.units).map((unit) => Math.max(4, Number(unit.strength || 0) * 1.8)))), 1),
      weight: round(clamp((Number(item.averageStrength || 0) / 100) * 0.95 + (Number(item.unitCount || 0) * 0.04), 0.35, 1.18), 2),
    })),
  ];
}

function buildGroupAnchors(forceGrouping = {}, dataset = {}) {
  const groups = safeArray(forceGrouping.preferredScheme?.groups || forceGrouping.systemBestScheme?.groups);
  const intelligenceIndex = buildIntelligenceIndex(dataset.intelligence);
  const fallbackAnchor = resolveFallbackAnchor(dataset);

  return groups
    .map((group) => {
      const points = safeArray(group.units)
        .map((unit) => intelligenceIndex.get(Number(unit.id)))
        .filter(Boolean)
        .map((item) => [Number(item.longitude || 0), Number(item.latitude || 0), 0]);

      const anchor = points.length
        ? normalizeCoordinate([
          average(points.map((point) => point[0])),
          average(points.map((point) => point[1])),
          0,
        ])
        : fallbackAnchor;

      return {
        ...group,
        anchor,
        routePriority: round(
          Number(group.firepower || 0) * 0.32
          + Number(group.mobility || 0) * 0.26
          + Number(group.reconCoverage || 0) * 0.16
          + Number(group.protection || 0) * 0.14
          + Number(group.endurance || 0) * 0.12,
          1,
        ),
      };
    })
    .sort((left, right) => Number(right.routePriority || 0) - Number(left.routePriority || 0));
}

function resolveTargetAllocationReferencePlan(targetAllocation = {}) {
  const preferredPlan = safeObject(targetAllocation.preferredPlan);
  if (safeArray(preferredPlan.assignments).length) return preferredPlan;

  const systemBestPlan = safeObject(targetAllocation.systemBestPlan);
  if (safeArray(systemBestPlan.assignments).length) return systemBestPlan;

  const candidatePlans = safeArray(targetAllocation.comparedPlans)
    .filter((item) => safeArray(item.assignments).length)
    .sort((left, right) => (
      safeArray(right.assignments).length - safeArray(left.assignments).length
      || Number(right.score || 0) - Number(left.score || 0)
    ));
  return safeObject(candidatePlans[0] || preferredPlan || systemBestPlan);
}

function buildObjectiveAnchors(targetAllocation = {}, threatOutput = {}, fallbackAnchor = [120.18, 30.28, 0]) {
  const referencePlan = resolveTargetAllocationReferencePlan(targetAllocation);
  const targetIndex = new Map(safeArray(targetAllocation.candidateTargets).map((item) => [item.id, item]));
  const assignmentAnchors = uniqueList(
    safeArray(referencePlan.assignments).map((item) => item.targetId),
  )
    .map((targetId) => targetIndex.get(targetId))
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      coordinates: normalizeCoordinate(item.coordinates),
      importance: Number(item.importance || 0),
    }));

  if (assignmentAnchors.length) {
    return assignmentAnchors;
  }

  const fallbackTargets = buildCandidateTargets(threatOutput).slice(0, 3).map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    coordinates: normalizeCoordinate(item.coordinates),
    importance: Number(item.importance || 0),
  }));

  return fallbackTargets.length
    ? fallbackTargets
    : [{
      id: 'objective-fallback',
      name: '默认任务目标',
      type: 'fallback',
      coordinates: normalizeCoordinate(fallbackAnchor),
      importance: 60,
    }];
}

function buildHelicopterProfile(modelKey = 'medium-lift') {
  const catalog = {
    'light-lift': {
      key: 'light-lift',
      label: '轻型直升机',
      cruiseSpeedKmh: 185,
      maxRadiusKm: 150,
      liftCapacity: 16,
      zoneSizeKm: 1,
    },
    'medium-lift': {
      key: 'medium-lift',
      label: '中型直升机',
      cruiseSpeedKmh: 225,
      maxRadiusKm: 200,
      liftCapacity: 24,
      zoneSizeKm: 1.4,
    },
    'heavy-lift': {
      key: 'heavy-lift',
      label: '重型直升机',
      cruiseSpeedKmh: 245,
      maxRadiusKm: 260,
      liftCapacity: 32,
      zoneSizeKm: 1.9,
    },
  };
  return cloneData(catalog[modelKey] || catalog['medium-lift']);
}

function calculateThreatExposureScore(coordinates = [], threatNodes = []) {
  const samples = samplePolylineCoordinates(coordinates, 5);
  if (!samples.length || !safeArray(threatNodes).length) return 12;

  const exposure = average(samples.map((point) => sumBy(threatNodes, (node) => {
    const distanceKm = haversineDistanceKm(point, node.coordinates);
    const influenceKm = Math.max(4, Number(node.radiusKm || 0) * 1.12);
    if (distanceKm > influenceKm) return 0;
    const proximity = 1 - (distanceKm / influenceKm);
    return proximity * Number(node.weight || 0.6) * 100;
  })));

  return round(clamp(exposure, 0, 100), 1);
}

function calculateEnvironmentEffects(coordinates = [], environment = []) {
  const samples = samplePolylineCoordinates(coordinates, 4);
  if (!samples.length) {
    return {
      terrainPenalty: 0,
      weatherPenalty: 0,
      concealmentBoost: 0,
      electromagneticPenalty: 0,
    };
  }

  let terrainPenalty = 0;
  let weatherPenalty = 0;
  let concealmentBoost = 0;
  let electromagneticPenalty = 0;

  for (const item of safeArray(environment)) {
    const center = resolveEnvironmentCenter(item);
    const radiusKm = Math.max(4, resolveEnvironmentInfluenceRadiusKm(item));
    const proximity = average(samples.map((point) => {
      const distanceKm = haversineDistanceKm(point, center);
      return distanceKm > radiusKm ? 0 : 1 - (distanceKm / radiusKm);
    }));

    if (item.kind === 'terrain') {
      terrainPenalty += proximity * 24;
      concealmentBoost += proximity * 18;
    }
    if (item.kind === 'weather') {
      weatherPenalty += proximity * 28;
      concealmentBoost += proximity * 10;
    }
    if (item.kind === 'electromagnetic') {
      electromagneticPenalty += proximity * 18;
      concealmentBoost += proximity * 12;
    }
  }

  return {
    terrainPenalty: round(clamp(terrainPenalty, 0, 100), 1),
    weatherPenalty: round(clamp(weatherPenalty, 0, 100), 1),
    concealmentBoost: round(clamp(concealmentBoost, 0, 100), 1),
    electromagneticPenalty: round(clamp(electromagneticPenalty, 0, 100), 1),
  };
}

function resolveRouteAltitudeBase(altitudeProfile = 'terrain-following', missionType = 'fire-strike') {
  if (altitudeProfile === 'high') return missionType === 'air-assault' ? 980 : 1380;
  if (altitudeProfile === 'medium') return missionType === 'air-assault' ? 560 : 860;
  return missionType === 'air-assault' ? 180 : 260;
}

function buildSegmentRoute(start = [], end = [], methodKey = 'a-star', segmentIndex = 0, altitudeProfile = 'terrain-following', missionType = 'fire-strike', threatCenter = null) {
  const altitudeBase = resolveRouteAltitudeBase(altitudeProfile, missionType);
  const sign = resolveOffsetSign(start, end, threatCenter) * (segmentIndex % 2 === 0 ? 1 : -1);
  const methods = {
    'a-star': [
      { ratio: 0.38, offsetKm: 8, sign: 1, altitude: altitudeBase + 120 },
      { ratio: 0.74, offsetKm: 5, sign: -1, altitude: altitudeBase + 80 },
    ],
    dijkstra: [
      { ratio: 0.28, offsetKm: 12, sign: 1, altitude: altitudeBase + 140 },
      { ratio: 0.56, offsetKm: 10, sign: 1, altitude: altitudeBase + 110 },
      { ratio: 0.82, offsetKm: 4, sign: -1, altitude: altitudeBase + 70 },
    ],
    rrt: [
      { ratio: 0.22, offsetKm: 15, sign: 1, altitude: altitudeBase + 100 },
      { ratio: 0.46, offsetKm: 12, sign: -1, altitude: altitudeBase + 70 },
      { ratio: 0.68, offsetKm: 10, sign: 1, altitude: altitudeBase + 90 },
      { ratio: 0.88, offsetKm: 4, sign: -1, altitude: altitudeBase + 40 },
    ],
  };
  const waypointSpecs = methods[methodKey] || methods['a-star'];

  return dedupePolyline([
    applyAltitude(start, altitudeBase + 160),
    ...waypointSpecs.map((item) => buildOffsetWaypoint(
      start,
      end,
      item.ratio,
      item.offsetKm,
      sign * item.sign,
      item.altitude,
    )),
    applyAltitude(end, missionType === 'air-assault' ? 80 : 180),
  ]);
}

function buildLandingZonePolygon(center = [], sizeKm = 1.4) {
  const latitude = Number(center?.[1] || 0);
  const halfLat = (sizeKm / 2) / 110.57;
  const halfLon = (sizeKm / 2) / (111.32 * Math.max(0.25, Math.cos((latitude * Math.PI) / 180)));
  return [
    [round(Number(center?.[0] || 0) - halfLon, 4), round(latitude - halfLat, 4), 0],
    [round(Number(center?.[0] || 0) + halfLon, 4), round(latitude - halfLat, 4), 0],
    [round(Number(center?.[0] || 0) + halfLon, 4), round(latitude + halfLat, 4), 0],
    [round(Number(center?.[0] || 0) - halfLon, 4), round(latitude + halfLat, 4), 0],
  ];
}

function buildLandingSeedCandidates(stagingAnchor = [], objectiveAnchor = [], threatCenter = [], environment = [], helicopterProfile = {}, candidateCount = 5) {
  const sign = resolveOffsetSign(stagingAnchor, objectiveAnchor, threatCenter);
  const environmentalSeeds = safeArray(environment)
    .filter((item) => ['terrain', 'electromagnetic', 'weather'].includes(item.kind))
    .slice(0, candidateCount + 2)
    .map((item, index) => ({
      id: `landing-seed-env-${index + 1}`,
      name: `${item.name}候选机降点`,
      center: resolveEnvironmentCenter(item),
      source: item.name,
    }));

  const corridorSeeds = [
    { ratio: 0.42, offsetKm: 12, sign: 1 },
    { ratio: 0.56, offsetKm: 9, sign: -1 },
    { ratio: 0.68, offsetKm: 16, sign: 1 },
    { ratio: 0.76, offsetKm: 6, sign: -1 },
  ].map((item, index) => ({
    id: `landing-seed-route-${index + 1}`,
    name: `低空走廊候选点 ${index + 1}`,
    center: buildOffsetWaypoint(stagingAnchor, objectiveAnchor, item.ratio, item.offsetKm, sign * item.sign, 0),
    source: '低空走廊推导',
  }));

  const fallbackSeed = {
    id: 'landing-seed-fallback',
    name: '目标侧翼候选点',
    center: buildOffsetWaypoint(stagingAnchor, objectiveAnchor, 0.72, Math.max(5, Number(helicopterProfile.zoneSizeKm || 1.4) * 4.2), sign, 0),
    source: '目标侧翼推导',
  };

  return [...environmentalSeeds, ...corridorSeeds, fallbackSeed]
    .filter((item) => item.center[0] || item.center[1])
    .filter((item, index, list) => list.findIndex((other) => haversineDistanceKm(item.center, other.center) < 2) === index)
    .slice(0, Math.max(3, Number(candidateCount || 5) + 2));
}

function evaluateLandingRawCandidate(seed = {}, stagingAnchor = [], objectiveAnchor = [], threatNodes = [], environment = [], helicopterProfile = {}) {
  const ingressDistanceKm = haversineDistanceKm(stagingAnchor, seed.center);
  const assaultDistanceKm = haversineDistanceKm(seed.center, objectiveAnchor);
  const totalDistanceKm = ingressDistanceKm + assaultDistanceKm;
  const threatExposure = calculateThreatExposureScore([stagingAnchor, seed.center, objectiveAnchor], threatNodes);
  const localEnvironment = calculateEnvironmentEffects([seed.center], environment);
  const rangeRatio = totalDistanceKm / Math.max(Number(helicopterProfile.maxRadiusKm || 180), 1);
  const concealment = round(clamp(
    46 + Number(localEnvironment.concealmentBoost || 0) * 0.6 - threatExposure * 0.18,
    0,
    100,
  ), 1);
  const safety = round(clamp(
    88 - threatExposure * 0.72 - Number(localEnvironment.weatherPenalty || 0) * 0.18 + Number(localEnvironment.terrainPenalty || 0) * 0.08,
    0,
    100,
  ), 1);
  const assemblyEfficiency = round(clamp(
    84 - Math.abs(ingressDistanceKm - assaultDistanceKm) * 0.9 - totalDistanceKm * 0.08,
    0,
    100,
  ), 1);
  const helicopterFit = round(clamp(
    94 - Math.max(0, rangeRatio - 0.72) * 120 - Number(localEnvironment.weatherPenalty || 0) * 0.14,
    0,
    100,
  ), 1);

  return {
    id: seed.id,
    name: seed.name,
    source: seed.source,
    center: normalizeCoordinate(seed.center),
    zone: buildLandingZonePolygon(seed.center, Number(helicopterProfile.zoneSizeKm || 1.4)),
    ingressDistanceKm: round(ingressDistanceKm, 1),
    assaultDistanceKm: round(assaultDistanceKm, 1),
    totalDistanceKm: round(totalDistanceKm, 1),
    threatExposure: round(threatExposure, 1),
    concealment,
    safety,
    assemblyEfficiency,
    helicopterFit,
  };
}

function buildLandingWeights(sitePreference = 'balanced') {
  const weights = {
    concealment: 0.28,
    safety: 0.34,
    assemblyEfficiency: 0.22,
    helicopterFit: 0.16,
  };
  if (sitePreference === 'concealment') {
    weights.concealment += 0.08;
    weights.assemblyEfficiency -= 0.03;
    weights.helicopterFit -= 0.02;
  }
  if (sitePreference === 'safety') {
    weights.safety += 0.08;
    weights.concealment -= 0.03;
    weights.assemblyEfficiency -= 0.02;
  }
  if (sitePreference === 'assembly') {
    weights.assemblyEfficiency += 0.08;
    weights.concealment -= 0.03;
    weights.safety -= 0.02;
  }
  return normalizeWeights(weights);
}

function dominatesLandingCandidate(left = {}, right = {}) {
  const dimensions = ['concealment', 'safety', 'assemblyEfficiency', 'helicopterFit'];
  const noWorse = dimensions.every((key) => Number(left[key] || 0) >= Number(right[key] || 0));
  const strictlyBetter = dimensions.some((key) => Number(left[key] || 0) > Number(right[key] || 0));
  return noWorse && strictlyBetter;
}

function evaluateLandingCandidates(rawCandidates = [], methodKey = 'weighted-score', sitePreference = 'balanced') {
  const weights = buildLandingWeights(sitePreference);
  const withBaseScore = safeArray(rawCandidates).map((item) => {
    const baseScore = (
      Number(item.concealment || 0) * weights.concealment
      + Number(item.safety || 0) * weights.safety
      + Number(item.assemblyEfficiency || 0) * weights.assemblyEfficiency
      + Number(item.helicopterFit || 0) * weights.helicopterFit
    );
    return {
      ...item,
      qualified: Number(item.safety || 0) >= 48 && Number(item.helicopterFit || 0) >= 56,
      baseScore: round(baseScore, 1),
    };
  });

  const withMethodScore = withBaseScore.map((candidate) => {
    let score = Number(candidate.baseScore || 0);
    if (methodKey === 'constraint-screening') {
      score += candidate.qualified ? 6 : -18;
    }
    return {
      ...candidate,
      score: round(clamp(score, 0, 100), 1),
    };
  });

  if (methodKey === 'pareto-ranking') {
    return sortByScore(withMethodScore.map((candidate) => {
      const dominatedBy = withMethodScore.filter((item) => item.id !== candidate.id && dominatesLandingCandidate(item, candidate)).length;
      const dominates = withMethodScore.filter((item) => item.id !== candidate.id && dominatesLandingCandidate(candidate, item)).length;
      return {
        ...candidate,
        paretoFrontScore: dominates,
        paretoPenalty: dominatedBy,
        score: round(clamp(Number(candidate.baseScore || 0) + dominates * 4 - dominatedBy * 7, 0, 100), 1),
      };
    }), 'score').map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  }

  return sortByScore(withMethodScore, 'score').map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

function buildLandingVisualization(rankedCandidates = [], preferredCandidate = null, stagingAnchor = [], objectiveAnchor = [], helicopterProfile = {}) {
  const candidateEntities = safeArray(rankedCandidates).slice(0, 6).map((candidate) => ({
    id: `landing-candidate-${candidate.id}`,
    name: candidate.name,
    type: 'unit',
    camp: 'blue',
    layerKey: 'symbols',
    color: candidate.id === preferredCandidate?.id ? '#22c55e' : '#60a5fa',
    geometryType: 'point',
    coordinates: candidate.center,
    radius: null,
    annotation: `评分 ${candidate.score} / 隐蔽 ${candidate.concealment} / 安全 ${candidate.safety}`,
    visible: true,
    meta: {
      unitSubtype: candidate.id === preferredCandidate?.id ? 'helicopter' : 'command',
    },
  }));

  const stagingEntity = {
    id: 'landing-staging-anchor',
    name: '前出集结区',
    type: 'unit',
    camp: 'blue',
    layerKey: 'blueUnits',
    color: '#38bdf8',
    geometryType: 'point',
    coordinates: stagingAnchor,
    radius: null,
    annotation: helicopterProfile.label || '机降出发点',
    visible: true,
    meta: {
      unitSubtype: 'helicopter',
    },
  };

  const objectiveEntity = {
    id: 'landing-objective-anchor',
    name: '突击目标方向',
    type: 'unit',
    camp: 'red',
    layerKey: 'redUnits',
    color: '#f97316',
    geometryType: 'point',
    coordinates: objectiveAnchor,
    radius: null,
    annotation: '目标锚点',
    visible: true,
    meta: {
      unitSubtype: 'command',
    },
  };

  const selectedZone = preferredCandidate
    ? {
      id: `landing-zone-${preferredCandidate.id}`,
      name: `${preferredCandidate.name}机降地域`,
      type: 'zone',
      camp: 'neutral',
      layerKey: 'symbols',
      color: '#22c55e',
      geometryType: 'polygon',
      coordinates: preferredCandidate.zone,
      radius: null,
      annotation: `综合评分 ${preferredCandidate.score}`,
      visible: true,
      meta: {},
    }
    : null;

  const approachCorridor = preferredCandidate
    ? {
      id: `landing-corridor-${preferredCandidate.id}`,
      name: '机降接近航路',
      type: 'order',
      camp: 'blue',
      layerKey: 'orders',
      color: '#22c55e',
      geometryType: 'polyline',
      coordinates: [
        applyAltitude(stagingAnchor, 420),
        buildOffsetWaypoint(stagingAnchor, preferredCandidate.center, 0.48, 8, resolveOffsetSign(stagingAnchor, preferredCandidate.center, objectiveAnchor), 280),
        applyAltitude(preferredCandidate.center, 120),
        applyAltitude(objectiveAnchor, 90),
      ],
      radius: null,
      annotation: '机降地域接近航路',
      visible: true,
      meta: {
        commandStyle: 'assault',
      },
    }
    : null;

  return {
    entities: [
      stagingEntity,
      objectiveEntity,
      ...candidateEntities,
      ...(selectedZone ? [selectedZone] : []),
      ...(approachCorridor ? [approachCorridor] : []),
    ],
    environment: [],
  };
}

function buildLandingLinkageAnalysis(preferredCandidate = {}, targetAllocation = {}, helicopterProfile = {}) {
  const assignmentCount = safeArray(targetAllocation.preferredPlan?.assignments).length;
  return [
    {
      id: 'landing-linkage-1',
      title: '压制与机降衔接',
      detail: `当前机降地域支撑 ${assignmentCount} 个已分配目标的压制-突击联动，建议在机降前完成防空与侦察节点压制。`,
    },
    {
      id: 'landing-linkage-2',
      title: '机降波次组织',
      detail: `按 ${helicopterProfile.label || '机降平台'} 的投送能力，优先组织主突击波次进入 ${preferredCandidate.name || '机降地域'}。`,
    },
    {
      id: 'landing-linkage-3',
      title: '后续作战流程联动',
      detail: '机降地域结果已可直接作为作战方法自动规划中的接近终点、集结起点和保障前沿节点。',
    },
  ];
}

async function runBuiltinAirborneLandingSiteSelection(context, step, algorithm, input, dataset) {
  const threatOutput = safeObject(context.stageOutputs['enemy-threat-analysis']);
  const forceGrouping = safeObject(context.stageOutputs['force-grouping']);
  const targetAllocation = safeObject(context.stageOutputs['target-allocation']);
  const fallbackAnchor = resolveFallbackAnchor(dataset);
  const groupAnchors = buildGroupAnchors(forceGrouping, dataset);
  const stagingAnchor = groupAnchors[0]?.anchor || fallbackAnchor;
  const objectiveAnchors = buildObjectiveAnchors(targetAllocation, threatOutput, fallbackAnchor);
  const objectiveAnchor = objectiveAnchors[0]?.coordinates || fallbackAnchor;
  const threatNodes = buildThreatRiskNodes(threatOutput);
  const threatCenter = buildWeightedCenter(threatNodes, objectiveAnchor);
  const helicopterProfile = buildHelicopterProfile(input.options.helicopterModel);
  const candidateCount = clamp(Number(input.options.candidateCount || 5), 3, 8);
  const rawCandidates = buildLandingSeedCandidates(
    stagingAnchor,
    objectiveAnchor,
    threatCenter,
    dataset.environment,
    helicopterProfile,
    candidateCount,
  ).map((seed) => evaluateLandingRawCandidate(
    seed,
    stagingAnchor,
    objectiveAnchor,
    threatNodes,
    dataset.environment,
    helicopterProfile,
  ));

  const evaluatedByMethod = Object.fromEntries(LANDING_SITE_METHODS.map((method) => [
    method.key,
    evaluateLandingCandidates(rawCandidates, method.key, input.options.sitePreference),
  ]));
  const rankedCandidates = evaluatedByMethod[input.builtinMethodKey] || evaluatedByMethod['weighted-score'] || [];
  const preferredCandidate = rankedCandidates[0] || null;
  const methodComparison = LANDING_SITE_METHODS.map((method) => {
    const candidates = evaluatedByMethod[method.key] || [];
    const best = candidates[0] || null;
    return {
      methodKey: method.key,
      methodLabel: method.label,
      bestCandidateName: best?.name || '--',
      score: best?.score || 0,
      averageScore: round(average(candidates.map((item) => item.score)), 1),
      qualifiedCount: candidates.filter((item) => item.qualified).length,
    };
  });

  return {
    summary: `已围绕 ${rawCandidates.length} 个候选机降点完成多目标选址，并根据 ${findMethodLabel(algorithm.builtinMethods, input.builtinMethodKey)} 输出推荐地域。`,
    outputPreview: [
      `直升机模型：${helicopterProfile.label}`,
      `候选机降点 ${rawCandidates.length} 个，推荐点位 ${preferredCandidate?.name || '待确认'}`,
      preferredCandidate ? `推荐评分 ${preferredCandidate.score} / 安全 ${preferredCandidate.safety} / 隐蔽 ${preferredCandidate.concealment}` : '暂无可用候选点',
    ],
    artifacts: [
      createArtifact('机降地域候选点排序', '输出候选机降点的多指标评分、排序与约束筛选结果。'),
      createArtifact('机降地域三维标注', '输出候选机降点、优选机降地域与接近航路的三维球展示结果。'),
      createArtifact('机降流程联动建议', '说明机降地域与压制目标、作战方法和保障流程之间的联动关系。'),
    ],
    structuredOutput: {
      implementationStatus: 'implemented',
      builtinMethodKey: input.builtinMethodKey,
      builtinMethodLabel: findMethodLabel(algorithm.builtinMethods, input.builtinMethodKey),
      helicopterProfile,
      stagingAnchor,
      objectiveAnchor,
      methodComparison,
      rankedCandidates,
      preferredCandidateId: preferredCandidate?.id || '',
      preferredCandidate,
      linkageAnalysis: buildLandingLinkageAnalysis(preferredCandidate || {}, targetAllocation, helicopterProfile),
      visualization: buildLandingVisualization(rankedCandidates, preferredCandidate, stagingAnchor, objectiveAnchor, helicopterProfile),
    },
  };
}

function buildRouteCheckpoints(routeId, routeName, coordinates = [], estimatedDurationMin = 0, missionType = 'fire-strike', landingPoint = null, objectiveName = '') {
  const points = dedupePolyline(coordinates);
  const checkpointIndices = uniqueNumberList([
    0,
    Math.floor(Math.max(points.length - 1, 1) * 0.45),
    landingPoint ? Math.max(points.length - 2, 1) : Math.floor(Math.max(points.length - 1, 1) * 0.7),
    Math.max(points.length - 1, 0),
  ]);

  return checkpointIndices.map((index, order) => {
    const point = points[index] || points[0] || [0, 0, 0];
    const timeRatio = points.length > 1 ? index / (points.length - 1) : 0;
    let name = `${routeName}检查点 ${order + 1}`;
    if (order === 0) name = '出发集结区';
    if (landingPoint && order === checkpointIndices.length - 2) name = '机降接近点';
    if (order === checkpointIndices.length - 1) {
      name = missionType === 'air-assault' ? `${objectiveName || '突击目标'}前沿` : `${objectiveName || '打击目标'}作用点`;
    }

    return {
      id: `${routeId}-checkpoint-${order + 1}`,
      name,
      coordinates: point,
      timeOffsetMin: round(Number(estimatedDurationMin || 0) * timeRatio, 1),
    };
  });
}

function evaluateRouteMetrics(
  coordinates = [],
  threatNodes = [],
  environment = [],
  group = {},
  options = {},
  missionType = 'fire-strike',
  helicopterProfile = null,
  routeTask = {},
  plannerMeta = {},
) {
  const distanceKm = computePolylineDistanceKm(coordinates);
  const threatScore = calculateThreatExposureScore(coordinates, threatNodes);
  const environmentEffects = calculateEnvironmentEffects(coordinates, environment);
  const routePreference = String(options.routePreference || 'balanced');
  const fieldSamples = samplePolylineCoordinates(coordinates, 5).map((point) => evaluatePlanningPointCost(
    point,
    threatNodes,
    environment,
    options,
    missionType,
  ));
  const averageFieldCost = round(average(fieldSamples.map((item) => item.totalCost)), 2);
  const peakFieldCost = round(Math.max(0, ...fieldSamples.map((item) => Number(item.totalCost || 0))), 2);
  const concealmentScore = round(clamp(
    48
      + Number(environmentEffects.concealmentBoost || 0) * 0.5
      - Number(threatScore || 0) * 0.24
      - averageFieldCost * 0.9
      + (routePreference === 'concealment' ? 11 : routePreference === 'speed' ? -2 : 4),
    0,
    100,
  ), 1);

  const mobility = Number(group.mobility || routeTask.groupMobility || 45);
  const cruiseSpeed = helicopterProfile
    ? Number(helicopterProfile.cruiseSpeedKmh || 220)
    : 75 + (mobility * 1.8);
  const estimatedDurationMin = round(
    ((distanceKm / Math.max(cruiseSpeed, 40)) * 60)
    + averageFieldCost * 1.8
    + Number(environmentEffects.weatherPenalty || 0) * 0.18
    + Number(environmentEffects.terrainPenalty || 0) * 0.12,
    1,
  );

  let score = 90
    - Number(threatScore || 0) * 0.26
    - averageFieldCost * 1.8
    - peakFieldCost * 0.45
    - distanceKm * 0.12
    + concealmentScore * 0.18
    + mobility * 0.05
    + Number(routeTask.averageMatchScore || 0) * 0.08
    + Number(routeTask.averageFeasibilityScore || 0) * 0.07;

  if (routePreference === 'speed') {
    score += 9 - (distanceKm * 0.06) - averageFieldCost * 0.25;
  }
  if (routePreference === 'concealment') {
    score += concealmentScore * 0.1 - Number(environmentEffects.weatherPenalty || 0) * 0.05;
  }
  if (missionType === 'air-assault') {
    score += Number(group.protection || routeTask.groupProtection || 0) * 0.04;
  } else {
    score += Number(group.firepower || routeTask.groupFirepower || 0) * 0.04;
  }

  return {
    distanceKm,
    threatScore,
    terrainPenalty: Number(environmentEffects.terrainPenalty || 0),
    weatherPenalty: Number(environmentEffects.weatherPenalty || 0),
    electromagneticPenalty: Number(environmentEffects.electromagneticPenalty || 0),
    concealmentScore,
    averageFieldCost,
    peakFieldCost,
    estimatedDurationMin,
    riskLevel: resolveFieldRiskLevel(averageFieldCost + (peakFieldCost * 0.22)),
    expandedNodes: Number(plannerMeta.expandedNodes || 0),
    fallbackSegmentCount: Number(plannerMeta.fallbackSegmentCount || 0),
    score: round(clamp(score, 0, 100), 1),
  };
}

function resolveMethodRouteType(groupRole = 'strike', missionType = 'fire-strike', index = 0) {
  const normalizedRole = String(groupRole || 'strike');
  if (missionType === 'air-assault') {
    if (normalizedRole === 'recon') return '侦察引导航路';
    if (normalizedRole === 'cover') return '掩护压制航路';
    if (normalizedRole === 'sustain') return '保障跟进航路';
    return index === 0 ? '机降突击主航路' : '低空突防航路';
  }
  if (normalizedRole === 'recon') return '侦察校核航路';
  if (normalizedRole === 'cover') return '协同压制航路';
  if (normalizedRole === 'sustain') return '保障支撑航路';
  return index === 0 ? '主攻打击航路' : '重点打击航路';
}

function buildMethodFallbackTasks(
  groupAnchors = [],
  objectiveAnchors = [],
  fallbackAnchor = [120.18, 30.28, 0],
  missionType = 'fire-strike',
  preferredCandidate = null,
) {
  const fallbackGroups = safeArray(groupAnchors).length
    ? safeArray(groupAnchors)
    : [{
      id: 'default-main-group',
      name: '主行动群',
      role: 'strike',
      mobility: 58,
      firepower: 62,
      protection: 55,
      endurance: 54,
      anchor: fallbackAnchor,
      unitCount: 3,
      platformCount: 3,
    }];
  const fallbackObjectives = safeArray(objectiveAnchors).length
    ? safeArray(objectiveAnchors)
    : [{
      id: 'default-objective',
      name: '默认目标',
      type: 'default',
      coordinates: fallbackAnchor,
      importance: 68,
      difficulty: 52,
      priorityLevel: '中',
    }];

  return fallbackGroups.slice(0, Math.max(1, fallbackObjectives.length)).map((group, index) => {
    const target = fallbackObjectives[Math.min(index, fallbackObjectives.length - 1)] || fallbackObjectives[0];
    return {
      id: `method-task-fallback-${index + 1}`,
      groupId: group.id,
      groupName: group.name,
      groupRole: group.role || 'strike',
      groupMobility: Number(group.mobility || 58),
      groupFirepower: Number(group.firepower || 62),
      groupProtection: Number(group.protection || 55),
      groupEndurance: Number(group.endurance || 54),
      start: normalizeCoordinate(group.anchor || fallbackAnchor),
      objectiveId: target.id,
      objectiveName: target.name,
      objectiveType: target.type || 'default',
      end: normalizeCoordinate(target.coordinates || fallbackAnchor),
      targetImportance: Number(target.importance || 68),
      targetDifficulty: Number(target.difficulty || 52),
      targetPriorityLevel: target.priorityLevel || '中',
      routeType: resolveMethodRouteType(group.role, missionType, index),
      landingPoint: preferredCandidate?.center ? normalizeCoordinate(preferredCandidate.center) : null,
      wave: 1,
      platformCount: Number(group.platformCount || group.unitCount || 3),
      platformNames: [],
      assignmentCount: 0,
      averageMatchScore: 62,
      averageFeasibilityScore: 60,
      averageReachUtilization: 0.72,
      routePriority: round(
        Number(target.importance || 68) * 0.5
        + Number(group.firepower || 62) * 0.2
        + Number(group.mobility || 58) * 0.16
        + Number(group.protection || 55) * 0.08
        + Number(group.endurance || 54) * 0.06,
        1,
      ),
    };
  });
}

function buildMethodRouteTasks(
  targetAllocation = {},
  groupAnchors = [],
  objectiveAnchors = [],
  fallbackAnchor = [120.18, 30.28, 0],
  missionType = 'fire-strike',
  preferredCandidate = null,
) {
  const referencePlan = resolveTargetAllocationReferencePlan(targetAllocation);
  const assignments = safeArray(referencePlan.assignments);
  const targetIndex = new Map(safeArray(targetAllocation.candidateTargets).map((item) => [item.id, item]));
  const groupIndex = new Map(safeArray(targetAllocation.groups).map((item) => [item.id, item]));
  const platformIndex = new Map(safeArray(targetAllocation.platforms).map((item) => [item.id, item]));

  for (const group of safeArray(groupAnchors)) {
    if (!groupIndex.has(group.id)) groupIndex.set(group.id, group);
  }

  const objectiveIndex = new Map(safeArray(objectiveAnchors).map((item) => [item.id, item]));
  const taskBuckets = new Map();

  for (const assignment of assignments) {
    const target = targetIndex.get(assignment.targetId) || objectiveIndex.get(assignment.targetId) || {};
    const group = groupIndex.get(assignment.groupId) || {};
    const platform = platformIndex.get(assignment.platformId) || {
      id: assignment.platformId,
      name: assignment.platformName,
      role: assignment.platformRole,
      category: assignment.platformCategory,
      coordinates: group.anchor || fallbackAnchor,
      firepower: group.firepower,
      protection: group.protection,
      reconCoverage: group.reconCoverage,
      endurance: group.endurance,
      mobility: group.mobility,
    };
    const key = `${assignment.groupId || group.id || 'group'}|${assignment.targetId || target.id || 'target'}|${assignment.wave || 1}`;

    if (!taskBuckets.has(key)) {
      taskBuckets.set(key, {
        id: `method-task-${taskBuckets.size + 1}`,
        groupId: assignment.groupId || group.id || `group-${taskBuckets.size + 1}`,
        groupName: assignment.groupName || group.name || `群组 ${taskBuckets.size + 1}`,
        groupRole: assignment.groupRole || group.role || platform.role || 'strike',
        groupMobility: Number(group.mobility || platform.mobility || 52),
        groupFirepower: Number(group.firepower || platform.firepower || 58),
        groupProtection: Number(group.protection || platform.protection || 54),
        groupEndurance: Number(group.endurance || platform.endurance || 56),
        objectiveId: assignment.targetId || target.id || `objective-${taskBuckets.size + 1}`,
        objectiveName: assignment.targetName || target.name || '默认目标',
        objectiveType: assignment.targetType || target.type || 'default',
        end: normalizeCoordinate(target.coordinates || fallbackAnchor),
        targetImportance: Number(target.importance || assignment.priority || 68),
        targetDifficulty: Number(target.difficulty || assignment.difficulty || 52),
        targetPriorityLevel: target.priorityLevel || assignment.priorityLevel || '中',
        wave: Math.max(1, Number(assignment.wave || 1)),
        start: normalizeCoordinate(group.anchor || platform.coordinates || fallbackAnchor),
        landingPoint: preferredCandidate?.center ? normalizeCoordinate(preferredCandidate.center) : null,
        assignments: [],
        platformMap: new Map(),
      });
    }

    const bucket = taskBuckets.get(key);
    bucket.assignments.push(assignment);
    if (platform?.id && !bucket.platformMap.has(platform.id)) {
      bucket.platformMap.set(platform.id, platform);
    }
  }

  const routeTasks = [...taskBuckets.values()].map((bucket, index) => {
    const platforms = [...bucket.platformMap.values()];
    return {
      id: bucket.id,
      groupId: bucket.groupId,
      groupName: bucket.groupName,
      groupRole: bucket.groupRole,
      groupMobility: bucket.groupMobility,
      groupFirepower: bucket.groupFirepower,
      groupProtection: bucket.groupProtection,
      groupEndurance: bucket.groupEndurance,
      start: normalizeCoordinate(bucket.start || fallbackAnchor),
      objectiveId: bucket.objectiveId,
      objectiveName: bucket.objectiveName,
      objectiveType: bucket.objectiveType,
      end: bucket.end,
      targetImportance: bucket.targetImportance,
      targetDifficulty: bucket.targetDifficulty,
      targetPriorityLevel: bucket.targetPriorityLevel,
      routeType: resolveMethodRouteType(bucket.groupRole, missionType, index),
      landingPoint: bucket.landingPoint,
      wave: bucket.wave,
      platformCount: platforms.length,
      platformNames: uniqueList(platforms.map((item) => item.name)),
      platformCategories: uniqueList(platforms.map((item) => item.category)),
      assignmentCount: bucket.assignments.length,
      averageMatchScore: round(average(bucket.assignments.map((item) => item.matchScore)), 1),
      averageFeasibilityScore: round(average(bucket.assignments.map((item) => item.feasibilityScore)), 1),
      averageReachUtilization: round(average(bucket.assignments.map((item) => item.reachUtilization)), 2),
      routePriority: round(
        Number(bucket.targetImportance || 0) * 0.48
        + Number(bucket.groupFirepower || 0) * 0.14
        + Number(bucket.groupMobility || 0) * 0.12
        + Number(bucket.groupProtection || 0) * 0.08
        + Number(bucket.groupEndurance || 0) * 0.06
        + round(average(bucket.assignments.map((item) => item.matchScore)), 1) * 0.12,
        1,
      ),
      assignments: bucket.assignments,
    };
  }).sort((left, right) => (
    Number(left.wave || 0) - Number(right.wave || 0)
    || Number(right.routePriority || 0) - Number(left.routePriority || 0)
    || Number(right.targetImportance || 0) - Number(left.targetImportance || 0)
  ));

  if (routeTasks.length) {
    return routeTasks;
  }

  return buildMethodFallbackTasks(groupAnchors, objectiveAnchors, fallbackAnchor, missionType, preferredCandidate);
}

function getMethodProjectionScale(referenceLatitude = 30) {
  return 111.32 * Math.max(0.25, Math.cos((Number(referenceLatitude || 30) * Math.PI) / 180));
}

function coordinateToRelativePlaneKm(point = [], referenceLatitude = 30) {
  return {
    x: Number(point?.[0] || 0) * getMethodProjectionScale(referenceLatitude),
    y: Number(point?.[1] || 0) * 110.57,
    z: Number(point?.[2] || 0),
  };
}

function planeKmToRelativeCoordinate(point = {}, referenceLatitude = 30) {
  return normalizeCoordinate([
    Number(point.x || 0) / getMethodProjectionScale(referenceLatitude),
    Number(point.y || 0) / 110.57,
    Number(point.z || 0),
  ]);
}

function buildMethodPathPlanningBounds(segment = {}, threatNodes = [], environment = []) {
  const relevantCoordinates = [
    normalizeCoordinate(segment.start || [120.18, 30.28, 0]),
    normalizeCoordinate(segment.end || [120.18, 30.28, 0]),
    ...safeArray(threatNodes).map((item) => normalizeCoordinate(item.coordinates)),
    ...safeArray(environment).map((item) => normalizeCoordinate(resolveEnvironmentCenter(item))),
  ].filter((item) => item[0] || item[1]);
  const referenceLatitude = average(relevantCoordinates.map((item) => Number(item[1] || 0))) || 30.28;
  const planePoints = relevantCoordinates.map((item) => coordinateToRelativePlaneKm(item, referenceLatitude));
  const maxInfluenceKm = Math.max(
    8,
    ...safeArray(threatNodes).map((item) => Number(item.radiusKm || 0)),
    ...safeArray(environment).map((item) => Number(resolveEnvironmentInfluenceRadiusKm(item) || 0)),
  );
  const directDistanceKm = Math.max(8, haversineDistanceKm(segment.start || [], segment.end || []));
  const marginKm = clamp(10 + (directDistanceKm * 0.18) + (maxInfluenceKm * 0.22), 12, 40);
  const cellSizeKm = clamp(
    directDistanceKm > 180 ? 4.2 : directDistanceKm > 120 ? 3.6 : directDistanceKm > 70 ? 3.0 : directDistanceKm > 35 ? 2.3 : 1.8,
    1.6,
    4.5,
  );
  const minX = Math.min(...planePoints.map((item) => item.x)) - marginKm;
  const maxX = Math.max(...planePoints.map((item) => item.x)) + marginKm;
  const minY = Math.min(...planePoints.map((item) => item.y)) - marginKm;
  const maxY = Math.max(...planePoints.map((item) => item.y)) + marginKm;

  return {
    referenceLatitude,
    minX,
    maxX,
    minY,
    maxY,
    cellSizeKm,
    gridWidth: Math.max(8, Math.round((maxX - minX) / cellSizeKm) + 1),
    gridHeight: Math.max(8, Math.round((maxY - minY) / cellSizeKm) + 1),
  };
}

function evaluatePlanningPointCost(coordinate = [], threatNodes = [], environment = [], options = {}, missionType = 'fire-strike') {
  const routePreference = String(options.routePreference || 'balanced');
  const altitudeProfile = String(options.altitudeProfile || 'terrain-following');
  let threatPenalty = 0;
  let terrainPenalty = 0;
  let weatherPenalty = 0;
  let electromagneticPenalty = 0;
  let concealmentBenefit = 0;

  for (const node of safeArray(threatNodes)) {
    const distanceKm = haversineDistanceKm(coordinate, node.coordinates);
    const influenceKm = Math.max(4.5, Number(node.radiusKm || 0) * 1.18);
    if (distanceKm > influenceKm * 1.28) continue;
    const proximity = clamp(1 - (distanceKm / influenceKm), 0, 1);
    let typeWeight = 1;
    if (node.type === 'air-defense') {
      typeWeight = altitudeProfile === 'high' ? 1.42 : missionType === 'air-assault' ? 1.26 : 1.14;
    } else if (node.type === 'recon-warning') {
      typeWeight = routePreference === 'concealment' ? 1.18 : 1.08;
    } else if (node.type === 'anti-airborne' && missionType === 'air-assault') {
      typeWeight = 1.24;
    }
    threatPenalty += proximity * proximity * Number(node.weight || 0.7) * 34 * typeWeight;
    if (distanceKm < influenceKm * 0.28) {
      threatPenalty += 7 * typeWeight;
    }
  }

  for (const item of safeArray(environment)) {
    const center = resolveEnvironmentCenter(item);
    const radiusKm = Math.max(4, resolveEnvironmentInfluenceRadiusKm(item));
    const distanceKm = haversineDistanceKm(coordinate, center);
    if (distanceKm > radiusKm * 1.08) continue;
    const proximity = clamp(1 - (distanceKm / radiusKm), 0, 1);

    if (item.kind === 'terrain') {
      const terrainFactor = altitudeProfile === 'terrain-following' ? 0.78 : 1.06;
      terrainPenalty += proximity * 16 * terrainFactor;
      concealmentBenefit += proximity * (routePreference === 'concealment' ? 15 : 9);
    }
    if (item.kind === 'weather') {
      weatherPenalty += proximity * 20 * (routePreference === 'speed' ? 1.18 : 1.04);
      concealmentBenefit += proximity * 4;
    }
    if (item.kind === 'electromagnetic') {
      electromagneticPenalty += proximity * 14 * (missionType === 'air-assault' ? 1.12 : 1);
      concealmentBenefit += proximity * 6;
    }
  }

  const preferenceBias = routePreference === 'speed'
    ? (terrainPenalty * 0.28) + (weatherPenalty * 0.24) - (concealmentBenefit * 0.08)
    : routePreference === 'concealment'
      ? (terrainPenalty * 0.1) + (weatherPenalty * 0.16) - (concealmentBenefit * 0.28)
      : (terrainPenalty * 0.18) + (weatherPenalty * 0.18) - (concealmentBenefit * 0.16);
  const altitudeBias = altitudeProfile === 'high'
    ? threatPenalty * 0.12 + weatherPenalty * 0.04
    : altitudeProfile === 'terrain-following'
      ? terrainPenalty * 0.06 - concealmentBenefit * 0.08
      : threatPenalty * 0.04;
  const totalCost = round(clamp(
    1
    + (threatPenalty * 0.11)
    + (terrainPenalty * 0.07)
    + (weatherPenalty * 0.08)
    + (electromagneticPenalty * 0.06)
    + preferenceBias
    + altitudeBias,
    0.8,
    48,
  ), 2);

  return {
    totalCost,
    threatPenalty: round(threatPenalty, 2),
    terrainPenalty: round(terrainPenalty, 2),
    weatherPenalty: round(weatherPenalty, 2),
    electromagneticPenalty: round(electromagneticPenalty, 2),
    concealmentBenefit: round(concealmentBenefit, 2),
  };
}

function resolveFieldRiskLevel(totalCost = 0) {
  if (Number(totalCost || 0) >= 18) return '高';
  if (Number(totalCost || 0) >= 8) return '中';
  return '低';
}

function buildMethodPathPlanningField(segment = {}, threatNodes = [], environment = [], options = {}, missionType = 'fire-strike', methodKey = 'a-star') {
  const bounds = buildMethodPathPlanningBounds(segment, threatNodes, environment);
  return {
    ...bounds,
    methodKey,
    missionType,
    options,
    threatNodes,
    environment,
    cache: new Map(),
    startCoordinate: normalizeCoordinate(segment.start || [120.18, 30.28, 0]),
    goalCoordinate: normalizeCoordinate(segment.end || [120.18, 30.28, 0]),
  };
}

function decodeFieldCellKey(key = '') {
  const [x, y] = String(key || '').split(':').map((item) => Number(item));
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

function buildFieldCell(field = {}, x = 0, y = 0) {
  const cellX = clamp(Math.round(Number(x || 0)), 0, Math.max(Number(field.gridWidth || 1) - 1, 0));
  const cellY = clamp(Math.round(Number(y || 0)), 0, Math.max(Number(field.gridHeight || 1) - 1, 0));
  const key = `${cellX}:${cellY}`;
  if (field.cache?.has(key)) return field.cache.get(key);

  const coordinate = planeKmToRelativeCoordinate({
    x: Number(field.minX || 0) + (cellX * Number(field.cellSizeKm || 1)),
    y: Number(field.minY || 0) + (cellY * Number(field.cellSizeKm || 1)),
    z: 0,
  }, field.referenceLatitude);
  const cost = evaluatePlanningPointCost(
    coordinate,
    field.threatNodes,
    field.environment,
    field.options,
    field.missionType,
  );
  const cell = {
    x: cellX,
    y: cellY,
    key,
    coordinate,
    ...cost,
  };
  if (field.cache) field.cache.set(key, cell);
  return cell;
}

function resolveFieldCell(field = {}, coordinate = []) {
  const planePoint = coordinateToRelativePlaneKm(coordinate, field.referenceLatitude);
  const cellX = Math.round((planePoint.x - Number(field.minX || 0)) / Math.max(Number(field.cellSizeKm || 1), 0.0001));
  const cellY = Math.round((planePoint.y - Number(field.minY || 0)) / Math.max(Number(field.cellSizeKm || 1), 0.0001));
  return buildFieldCell(field, cellX, cellY);
}

function getFieldNeighbors(field = {}, cell = {}) {
  const neighbors = [];
  for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
    for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
      if (!deltaX && !deltaY) continue;
      const nextX = Number(cell.x || 0) + deltaX;
      const nextY = Number(cell.y || 0) + deltaY;
      if (nextX < 0 || nextY < 0 || nextX >= Number(field.gridWidth || 0) || nextY >= Number(field.gridHeight || 0)) continue;
      neighbors.push(buildFieldCell(field, nextX, nextY));
    }
  }
  return neighbors;
}

function reconstructGridCellPath(field = {}, cameFrom = new Map(), goalKey = '') {
  const cells = [];
  let cursor = goalKey;
  const seen = new Set();
  const safetyLimit = Math.max(16, Number(field.gridWidth || 0) * Number(field.gridHeight || 0));
  while (cursor && !seen.has(cursor) && cells.length <= safetyLimit) {
    seen.add(cursor);
    const decoded = decodeFieldCellKey(cursor);
    cells.push(buildFieldCell(field, decoded.x, decoded.y));
    cursor = cameFrom.get(cursor);
  }
  return cells.reverse();
}

function compressGridCellPath(cells = []) {
  if (safeArray(cells).length <= 2) return safeArray(cells);
  const result = [cells[0]];
  let previousDx = Number(cells[1].x || 0) - Number(cells[0].x || 0);
  let previousDy = Number(cells[1].y || 0) - Number(cells[0].y || 0);

  for (let index = 1; index < cells.length - 1; index += 1) {
    const nextDx = Number(cells[index + 1].x || 0) - Number(cells[index].x || 0);
    const nextDy = Number(cells[index + 1].y || 0) - Number(cells[index].y || 0);
    if (nextDx !== previousDx || nextDy !== previousDy) {
      result.push(cells[index]);
      previousDx = nextDx;
      previousDy = nextDy;
    }
  }

  result.push(cells[cells.length - 1]);
  return result;
}

function evaluatePlanningSegmentCost(startCoordinate = [], endCoordinate = [], field = {}, sampleCount = 5) {
  const distanceKm = haversineDistanceKm(startCoordinate, endCoordinate);
  const samples = [];
  for (let index = 0; index <= Math.max(2, sampleCount); index += 1) {
    const ratio = index / Math.max(1, sampleCount);
    samples.push(evaluatePlanningPointCost(
      interpolateCoordinate(startCoordinate, endCoordinate, ratio),
      field.threatNodes,
      field.environment,
      field.options,
      field.missionType,
    ));
  }
  const averageCost = average(samples.map((item) => item.totalCost));
  const peakCost = Math.max(0, ...samples.map((item) => Number(item.totalCost || 0)));
  return {
    distanceKm: round(distanceKm, 2),
    averageCost: round(averageCost, 2),
    peakCost: round(peakCost, 2),
    traversalCost: round(distanceKm * averageCost + (peakCost * 0.08), 2),
  };
}

function solveFieldGraph(field = {}, useHeuristic = true) {
  const start = resolveFieldCell(field, field.startCoordinate);
  const goal = resolveFieldCell(field, field.goalCoordinate);
  const openList = [{ key: start.key, priority: 0 }];
  const cameFrom = new Map();
  const gScore = new Map([[start.key, 0]]);
  const visited = new Set();
  let expandedNodes = 0;
  const methodKey = String(field.methodKey || (useHeuristic ? 'a-star' : 'dijkstra'));

  const heuristic = (left, right) => {
    if (!useHeuristic) return 0;
    const deltaX = Number(left.x || 0) - Number(right.x || 0);
    const deltaY = Number(left.y || 0) - Number(right.y || 0);
    const weight = methodKey === 'a-star' ? 1.18 : 1;
    return Math.hypot(deltaX, deltaY) * Number(field.cellSizeKm || 1) * weight;
  };

  while (openList.length) {
    openList.sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0));
    const currentKey = openList.shift()?.key || '';
    if (!currentKey || visited.has(currentKey)) continue;
    visited.add(currentKey);
    expandedNodes += 1;

    if (currentKey === goal.key) {
      const cellPath = compressGridCellPath(reconstructGridCellPath(field, cameFrom, goal.key));
      return {
        status: 'ok',
        coordinates: cellPath.map((item) => item.coordinate),
        expandedNodes,
        visitedNodes: visited.size,
      };
    }

    const current = buildFieldCell(field, decodeFieldCellKey(currentKey).x, decodeFieldCellKey(currentKey).y);
    for (const neighbor of getFieldNeighbors(field, current)) {
      const diagonal = Number(neighbor.x || 0) !== Number(current.x || 0) && Number(neighbor.y || 0) !== Number(current.y || 0);
      const stepDistanceKm = Number(field.cellSizeKm || 1) * (diagonal ? Math.SQRT2 : 1);
      let tentative = Number(gScore.get(currentKey) || 0)
        + stepDistanceKm * average([Number(current.totalCost || 0), Number(neighbor.totalCost || 0)]);
      if (Number(neighbor.totalCost || 0) >= 20) {
        tentative += (Number(neighbor.totalCost || 0) - 20) * 0.7;
      }
      if (methodKey === 'dijkstra') {
        tentative += Math.max(0, Number(neighbor.totalCost || 0) - 10) * 0.35;
      }
      if (methodKey === 'a-star' && diagonal) {
        tentative += 0.22;
      }

      if (tentative >= Number(gScore.get(neighbor.key) || Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(neighbor.key, currentKey);
      gScore.set(neighbor.key, tentative);
      openList.push({
        key: neighbor.key,
        priority: tentative + heuristic(neighbor, goal),
      });
    }
  }

  return {
    status: 'unresolved',
    coordinates: [],
    expandedNodes,
    visitedNodes: visited.size,
  };
}

function solveAStarPath(field = {}) {
  return solveFieldGraph(field, true);
}

function solveDijkstraPath(field = {}) {
  return solveFieldGraph(field, false);
}

function createFieldRandomCoordinate(field = {}, rng = Math.random) {
  const x = Number(field.minX || 0) + (rng() * Math.max(Number(field.maxX || 0) - Number(field.minX || 0), 1));
  const y = Number(field.minY || 0) + (rng() * Math.max(Number(field.maxY || 0) - Number(field.minY || 0), 1));
  return planeKmToRelativeCoordinate({ x, y, z: 0 }, field.referenceLatitude);
}

function steerRrtCoordinate(from = [], to = [], stepKm = 4, referenceLatitude = 30) {
  const source = coordinateToRelativePlaneKm(from, referenceLatitude);
  const target = coordinateToRelativePlaneKm(to, referenceLatitude);
  const dx = Number(target.x || 0) - Number(source.x || 0);
  const dy = Number(target.y || 0) - Number(source.y || 0);
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  const ratio = Math.min(1, Number(stepKm || 0) / distance);
  return planeKmToRelativeCoordinate({
    x: Number(source.x || 0) + (dx * ratio),
    y: Number(source.y || 0) + (dy * ratio),
    z: 0,
  }, referenceLatitude);
}

function findNearestRrtNode(nodes = [], coordinate = []) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  safeArray(nodes).forEach((node, index) => {
    const distance = haversineDistanceKm(node.coordinate, coordinate);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function buildRrtPath(nodes = [], goalIndex = 0) {
  const path = [];
  let cursor = goalIndex;
  while (cursor >= 0 && nodes[cursor]) {
    path.push(nodes[cursor].coordinate);
    cursor = Number(nodes[cursor].parent ?? -1);
  }
  return path.reverse();
}

function solveSingleRrtPath(field = {}, rng = Math.random) {
  const nodes = [{
    coordinate: field.startCoordinate,
    parent: -1,
    cost: 0,
  }];
  const goal = field.goalCoordinate;
  const stepSizeKm = Math.max(3.6, Number(field.cellSizeKm || 1) * 1.7);
  const goalThresholdKm = Math.max(stepSizeKm * 0.9, Number(field.cellSizeKm || 1) * 1.4);
  const maxIterations = clamp(Math.round(Number(field.gridWidth || 20) * Number(field.gridHeight || 20) * 0.4), 180, 460);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const sample = rng() < 0.22 ? goal : createFieldRandomCoordinate(field, rng);
    const nearestIndex = findNearestRrtNode(nodes, sample);
    const nextCoordinate = steerRrtCoordinate(nodes[nearestIndex].coordinate, sample, stepSizeKm, field.referenceLatitude);
    const risk = evaluatePlanningSegmentCost(nodes[nearestIndex].coordinate, nextCoordinate, field, 4);
    if (Number(risk.peakCost || 0) > 28 || Number(risk.averageCost || 0) > 17) continue;

    nodes.push({
      coordinate: normalizeCoordinate(nextCoordinate),
      parent: nearestIndex,
      cost: Number(nodes[nearestIndex].cost || 0) + Number(risk.traversalCost || 0),
    });

    const newIndex = nodes.length - 1;
    if (haversineDistanceKm(nodes[newIndex].coordinate, goal) <= goalThresholdKm) {
      const finalRisk = evaluatePlanningSegmentCost(nodes[newIndex].coordinate, goal, field, 5);
      if (Number(finalRisk.peakCost || 0) <= 31 && Number(finalRisk.averageCost || 0) <= 19) {
        nodes.push({
          coordinate: goal,
          parent: newIndex,
          cost: Number(nodes[newIndex].cost || 0) + Number(finalRisk.traversalCost || 0),
        });
        const goalIndex = nodes.length - 1;
        return {
          status: 'ok',
          coordinates: buildRrtPath(nodes, goalIndex),
          expandedNodes: nodes.length,
          visitedNodes: nodes.length,
          iterationCount: iteration + 1,
          routeCost: Number(nodes[goalIndex].cost || 0),
        };
      }
    }
  }

  return {
    status: 'unresolved',
    coordinates: [],
    expandedNodes: nodes.length,
    visitedNodes: nodes.length,
    iterationCount: maxIterations,
    routeCost: 0,
  };
}

function solveRrtPath(field = {}, seedInput = 'method-route') {
  let bestAttempt = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rng = createGroupingRandom(hashGroupingSeed(`${seedInput}|rrt|${attempt}`));
    const candidate = solveSingleRrtPath(field, rng);
    if (candidate.status !== 'ok') continue;
    if (!bestAttempt || Number(candidate.routeCost || 0) < Number(bestAttempt.routeCost || 0)) {
      bestAttempt = candidate;
    }
  }
  return bestAttempt || {
    status: 'unresolved',
    coordinates: [],
    expandedNodes: 0,
    visitedNodes: 0,
    iterationCount: 0,
    routeCost: 0,
  };
}

function smoothPlannedPath(coordinates = [], field = {}) {
  const points = dedupePolyline(coordinates);
  if (points.length <= 2) return points;
  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = result[result.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const left = coordinateToRelativePlaneKm(previous, field.referenceLatitude || average([previous[1], current[1], next[1]]) || 30);
    const middle = coordinateToRelativePlaneKm(current, field.referenceLatitude || average([previous[1], current[1], next[1]]) || 30);
    const right = coordinateToRelativePlaneKm(next, field.referenceLatitude || average([previous[1], current[1], next[1]]) || 30);
    const v1x = Number(middle.x || 0) - Number(left.x || 0);
    const v1y = Number(middle.y || 0) - Number(left.y || 0);
    const v2x = Number(right.x || 0) - Number(middle.x || 0);
    const v2y = Number(right.y || 0) - Number(middle.y || 0);
    const denominator = Math.max(0.0001, Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
    const cosine = clamp(((v1x * v2x) + (v1y * v2y)) / denominator, -1, 1);
    const angle = Math.acos(cosine) * (180 / Math.PI);
    const cross = Math.abs((v1x * v2y) - (v1y * v2x));
    if (cross < 0.5 && angle < 12) continue;
    result.push(current);
  }
  result.push(points[points.length - 1]);
  return dedupePolyline(result);
}

function buildMethodFallbackSegment(start = [], end = [], options = {}, missionType = 'fire-strike', threatNodes = []) {
  const altitudeBase = resolveRouteAltitudeBase(options.altitudeProfile, missionType);
  const threatCenter = buildWeightedCenter(threatNodes, end);
  const sign = resolveOffsetSign(start, end, threatCenter);
  const directDistanceKm = Math.max(6, haversineDistanceKm(start, end));
  const offsetKm = clamp(directDistanceKm * 0.16, 4, 14);
  return dedupePolyline([
    applyAltitude(start, altitudeBase + 120),
    buildOffsetWaypoint(start, end, 0.35, offsetKm, sign, altitudeBase + 70),
    buildOffsetWaypoint(start, end, 0.72, offsetKm * 0.55, -sign, altitudeBase + 40),
    applyAltitude(end, missionType === 'air-assault' ? 70 : 180),
  ]);
}

function applyRouteAltitudeProfile(coordinates = [], altitudeProfile = 'terrain-following', missionType = 'fire-strike', methodKey = 'a-star', routeTask = {}) {
  const points = dedupePolyline(coordinates);
  const altitudeBase = resolveRouteAltitudeBase(altitudeProfile, missionType);
  return points.map((point, index) => {
    const ratio = points.length > 1 ? index / (points.length - 1) : 0;
    let altitude = altitudeBase;
    if (altitudeProfile === 'terrain-following') altitude += 36 + Math.sin(ratio * Math.PI) * (missionType === 'air-assault' ? 74 : 120);
    if (altitudeProfile === 'medium') altitude += 120 + Math.sin(ratio * Math.PI) * 84;
    if (altitudeProfile === 'high') altitude += 220 + Math.sin(ratio * Math.PI) * 120;
    if (methodKey === 'rrt') altitude += index % 2 === 0 ? 34 : -18;
    if (methodKey === 'dijkstra') altitude += 18;
    if (routeTask.landingPoint && ratio >= 0.72) altitude *= 0.62;
    if (index === 0) altitude += missionType === 'air-assault' ? 120 : 160;
    if (index === points.length - 1) altitude = missionType === 'air-assault' ? 70 : 180;
    return applyAltitude(point, altitude);
  });
}

function solveMethodRouteSegment(segment = {}, methodKey = 'a-star', threatNodes = [], environment = [], options = {}, missionType = 'fire-strike', routeTask = {}) {
  const field = buildMethodPathPlanningField(segment, threatNodes, environment, options, missionType, methodKey);
  const solved = methodKey === 'rrt'
    ? solveRrtPath(field, `${routeTask.groupId || 'group'}|${routeTask.objectiveId || 'target'}|${routeTask.wave || 1}|${segment.label || 'segment'}`)
    : methodKey === 'dijkstra'
      ? solveDijkstraPath(field)
      : solveAStarPath(field);

  let coordinates = safeArray(solved.coordinates);
  let status = solved.status;
  if (!coordinates.length) {
    coordinates = buildMethodFallbackSegment(segment.start, segment.end, options, missionType, threatNodes);
    status = 'fallback';
  } else {
    coordinates = smoothPlannedPath([
      normalizeCoordinate(segment.start),
      ...safeArray(coordinates).slice(1, -1),
      normalizeCoordinate(segment.end),
    ], field);
  }

  return {
    coordinates: dedupePolyline([
      normalizeCoordinate(segment.start),
      ...safeArray(coordinates).slice(1, -1),
      normalizeCoordinate(segment.end),
    ]),
    plannerMeta: {
      methodKey,
      status,
      gridWidth: Number(field.gridWidth || 0),
      gridHeight: Number(field.gridHeight || 0),
      cellSizeKm: Number(field.cellSizeKm || 0),
      expandedNodes: Number(solved.expandedNodes || 0),
      visitedNodes: Number(solved.visitedNodes || 0),
      iterationCount: Number(solved.iterationCount || 0),
      fallbackUsed: status !== 'ok',
    },
  };
}

function resolveMethodRouteStartOffset(routeTask = {}, phaseTempo = 'standard') {
  const baseOffset = phaseTempo === 'aggressive' ? 8 : phaseTempo === 'deliberate' ? 18 : 12;
  const waveSpacing = phaseTempo === 'aggressive' ? 4 : phaseTempo === 'deliberate' ? 10 : 7;
  let startOffsetMin = baseOffset + (Math.max(0, Number(routeTask.wave || 1) - 1) * waveSpacing);
  if (routeTask.groupRole === 'recon') startOffsetMin = Math.max(4, startOffsetMin - 4);
  if (routeTask.groupRole === 'cover') startOffsetMin = Math.max(6, startOffsetMin - 2);
  if (routeTask.groupRole === 'sustain') startOffsetMin += 4;
  return round(startOffsetMin, 1);
}

function buildMethodPlanRoutes(
  methodKey = 'a-star',
  routeTasks = [],
  threatNodes = [],
  environment = [],
  options = {},
  helicopterProfile = null,
  preferredCandidate = null,
  missionType = 'fire-strike',
) {
  return safeArray(routeTasks).map((routeTask, index) => {
    const segmentTargets = routeTask.landingPoint
      ? [routeTask.landingPoint, routeTask.end]
      : [routeTask.end];
    let segmentStart = routeTask.start;
    let coordinates = [routeTask.start];
    const segmentPlannerMeta = [];

    segmentTargets.forEach((segmentEnd, segmentIndex) => {
      const segmentResult = solveMethodRouteSegment({
        start: segmentStart,
        end: segmentEnd,
        label: routeTask.landingPoint && segmentIndex === 0 ? 'landing' : 'objective',
      }, methodKey, threatNodes, environment, options, missionType, routeTask);
      coordinates = dedupePolyline([...coordinates, ...safeArray(segmentResult.coordinates).slice(1)]);
      segmentPlannerMeta.push(segmentResult.plannerMeta);
      segmentStart = segmentEnd;
    });

    coordinates = applyRouteAltitudeProfile(coordinates, options.altitudeProfile, missionType, methodKey, routeTask);
    const metrics = evaluateRouteMetrics(
      coordinates,
      threatNodes,
      environment,
      {
        mobility: routeTask.groupMobility,
        firepower: routeTask.groupFirepower,
        protection: routeTask.groupProtection,
        endurance: routeTask.groupEndurance,
      },
      options,
      missionType,
      helicopterProfile,
      routeTask,
      {
        expandedNodes: sumBy(segmentPlannerMeta, (item) => item.expandedNodes),
        fallbackSegmentCount: segmentPlannerMeta.filter((item) => item.fallbackUsed).length,
      },
    );
    const startOffsetMin = resolveMethodRouteStartOffset(routeTask, options.phaseTempo);
    const endOffsetMin = round(startOffsetMin + Number(metrics.estimatedDurationMin || 0), 1);
    const checkpoints = buildRouteCheckpoints(
      `${methodKey}-route-${index + 1}`,
      routeTask.routeType,
      coordinates,
      metrics.estimatedDurationMin,
      missionType,
      routeTask.landingPoint,
      routeTask.objectiveName,
    ).map((item) => ({
      ...item,
      timeOffsetMin: round(Number(item.timeOffsetMin || 0) + startOffsetMin, 1),
    }));
    metrics.checkpointCount = checkpoints.length;

    return {
      id: `${methodKey}-route-${index + 1}`,
      name: `${routeTask.groupName}${routeTask.routeType}`,
      groupId: routeTask.groupId,
      groupName: routeTask.groupName,
      groupRole: routeTask.groupRole,
      routeType: routeTask.routeType,
      missionType,
      objectiveId: routeTask.objectiveId,
      objectiveName: routeTask.objectiveName,
      objectiveType: routeTask.objectiveType,
      targetImportance: routeTask.targetImportance,
      targetDifficulty: routeTask.targetDifficulty,
      targetPriorityLevel: routeTask.targetPriorityLevel,
      wave: routeTask.wave,
      platformCount: routeTask.platformCount,
      platformNames: routeTask.platformNames,
      platformCategories: routeTask.platformCategories,
      assignmentCount: routeTask.assignmentCount,
      averageMatchScore: routeTask.averageMatchScore,
      averageFeasibilityScore: routeTask.averageFeasibilityScore,
      averageReachUtilization: routeTask.averageReachUtilization,
      startOffsetMin,
      endOffsetMin,
      coordinates,
      checkpoints,
      plannerMeta: {
        methodKey,
        gridWidth: round(average(segmentPlannerMeta.map((item) => item.gridWidth)), 1),
        gridHeight: round(average(segmentPlannerMeta.map((item) => item.gridHeight)), 1),
        cellSizeKm: round(average(segmentPlannerMeta.map((item) => item.cellSizeKm)), 2),
        expandedNodes: sumBy(segmentPlannerMeta, (item) => item.expandedNodes),
        visitedNodes: sumBy(segmentPlannerMeta, (item) => item.visitedNodes),
        fallbackSegmentCount: segmentPlannerMeta.filter((item) => item.fallbackUsed).length,
        iterationCount: sumBy(segmentPlannerMeta, (item) => item.iterationCount),
        status: segmentPlannerMeta.every((item) => item.status === 'ok') ? 'ok' : 'mixed',
      },
      metrics,
    };
  });
}

function buildMethodPhases(missionType = 'fire-strike', routes = [], preferredCandidate = null, phaseTempo = 'standard') {
  if (!safeArray(routes).length) return [];
  const routeStarts = routes.map((route) => Number(route.startOffsetMin || 0));
  const routeEnds = routes.map((route) => Number(route.endOffsetMin || 0));
  const checkpointOffsets = routes.flatMap((route) => safeArray(route.checkpoints).map((item) => Number(item.timeOffsetMin || 0)));
  const earliestMovement = Math.min(...routeStarts);
  const latestStaging = Math.max(...routeStarts);
  const latestPenultimate = Math.max(...safeArray(routes).map((route) => {
    const checkpoints = safeArray(route.checkpoints);
    return Number(checkpoints[Math.max(checkpoints.length - 2, 0)]?.timeOffsetMin || route.endOffsetMin || 0);
  }));
  const earliestImpact = Math.min(...routeEnds);
  const latestImpact = Math.max(...routeEnds);
  const actionBuffer = phaseTempo === 'aggressive' ? 10 : phaseTempo === 'deliberate' ? 18 : 14;
  const transitionDuration = phaseTempo === 'aggressive' ? 10 : phaseTempo === 'deliberate' ? 18 : 14;
  const objectiveSummary = uniqueList(routes.map((route) => route.objectiveName)).slice(0, 3).join('、') || '重点目标';
  const waveSummary = uniqueList(routes.map((route) => `波次 ${route.wave}`)).join(' / ') || '单波次';
  const phaseStart = Math.max(0, earliestMovement);
  const phaseImpactStart = Math.min(earliestImpact, latestPenultimate);
  const phaseAssessmentStart = round(latestImpact + actionBuffer, 1);
  const phaseAssessmentEnd = round(phaseAssessmentStart + transitionDuration, 1);

  if (missionType === 'air-assault') {
    return [
      {
        id: 'phase-air-1',
        name: '压制准备与波次展开',
        startOffsetMin: 0,
        endOffsetMin: phaseStart,
        goal: `围绕 ${objectiveSummary} 完成火力压制、空域净化和 ${waveSummary} 出发组织。`,
      },
      {
        id: 'phase-air-2',
        name: '低空突防与机降接近',
        startOffsetMin: phaseStart,
        endOffsetMin: round(latestStaging > phaseStart ? latestStaging : latestPenultimate, 1),
        goal: `沿规划路线低空接近 ${preferredCandidate?.name || '机降地域'}，规避敌防空和侦察覆盖。`,
      },
      {
        id: 'phase-air-3',
        name: '着陆突击与目标占领',
        startOffsetMin: round(phaseImpactStart, 1),
        endOffsetMin: round(phaseAssessmentStart, 1),
        goal: `各突击群在 ${preferredCandidate?.name || '机降地域'} 完成着陆衔接，并向 ${objectiveSummary} 展开突击。`,
      },
      {
        id: 'phase-air-4',
        name: '效果评估与后续转进',
        startOffsetMin: phaseAssessmentStart,
        endOffsetMin: phaseAssessmentEnd,
        goal: `基于 ${checkpointOffsets.length} 个时空检查点复核突击效果，必要时切换补充路线或组织转进。`,
      },
    ];
  }

  return [
    {
      id: 'phase-fire-1',
      name: '侦察校核与火力准备',
      startOffsetMin: 0,
      endOffsetMin: phaseStart,
      goal: `围绕 ${objectiveSummary} 完成侦察校核、火力准备和 ${waveSummary} 出动组织。`,
    },
    {
      id: 'phase-fire-2',
      name: '路径展开与协同占位',
      startOffsetMin: phaseStart,
      endOffsetMin: round(latestPenultimate, 1),
      goal: '各群组沿已求解航路展开，保持主攻、掩护和侦察线路的时间窗协同。',
    },
    {
      id: 'phase-fire-3',
      name: '重点目标联合打击',
      startOffsetMin: round(phaseImpactStart, 1),
      endOffsetMin: round(phaseAssessmentStart, 1),
      goal: `对 ${objectiveSummary} 组织主攻压制、支援补打与效果确认，保持波次连续。`,
    },
    {
      id: 'phase-fire-4',
      name: '效果回传与后续波次',
      startOffsetMin: phaseAssessmentStart,
      endOffsetMin: phaseAssessmentEnd,
      goal: `基于 ${checkpointOffsets.length} 个检查点和实时效果回传，评估是否追加波次或转入下一阶段。`,
    },
  ];
}

function buildMethodEnvironmentOverlays(environment = [], threatNodes = []) {
  const environmentOverlays = safeArray(environment)
    .filter((item) => ['polygon', 'circle'].includes(item.geometryType))
    .slice(0, 8)
    .map((item, index) => {
      const baseColor = item.kind === 'terrain'
        ? '#16a34a'
        : item.kind === 'weather'
          ? '#38bdf8'
          : item.kind === 'electromagnetic'
            ? '#a78bfa'
            : '#f59e0b';
      return {
        ...cloneData(item),
        id: `method-env-${item.id || index + 1}`,
        riskLevel: item.riskLevel || (item.kind === 'terrain' ? '低' : '中'),
        meta: {
          ...safeObject(item.meta),
          fillColor: safeObject(item.meta).fillColor || baseColor,
          outlineColor: safeObject(item.meta).outlineColor || baseColor,
          fillAlpha: Number(safeObject(item.meta).fillAlpha ?? 0.1),
          outlineAlpha: Number(safeObject(item.meta).outlineAlpha ?? 0.88),
        },
      };
    });
  const threatOverlays = safeArray(threatNodes).slice(0, 8).map((node, index) => {
    const fillColor = node.type === 'air-defense'
      ? '#ef4444'
      : node.type === 'recon-warning'
        ? '#facc15'
        : node.type === 'anti-airborne'
          ? '#f59e0b'
          : '#fb7185';
    return {
      id: `method-threat-${node.id || index + 1}`,
      kind: 'threat-heat',
      name: `${node.name}威胁影响圈`,
      geometryType: 'circle',
      geometry: {
        center: node.coordinates,
        radius: Math.round(Math.max(4000, Number(node.radiusKm || 0) * 1000)),
      },
      weather: `${node.type} / 权重 ${node.weight}`,
      riskLevel: Number(node.weight || 0) >= 0.95 ? '高' : Number(node.weight || 0) >= 0.68 ? '中' : '低',
      notes: '路径规划威胁约束层',
      sourceId: 0,
      meta: {
        fillColor,
        outlineColor: fillColor,
        fillAlpha: 0.08,
        outlineAlpha: 0.88,
        intensity: clamp(Number(node.weight || 0), 0.2, 1),
      },
    };
  });
  return [...environmentOverlays, ...threatOverlays];
}

function buildMethodVisualization(routes = [], preferredCandidate = null, objectiveAnchors = [], threatNodes = [], environment = []) {
  const palette = ['#38bdf8', '#22c55e', '#facc15', '#f97316', '#a78bfa', '#ec4899'];
  const routeEntities = safeArray(routes).map((route, index) => ({
    id: `method-route-${route.id}`,
    name: route.name,
    type: 'order',
    camp: 'blue',
    layerKey: 'orders',
    color: palette[index % palette.length],
    geometryType: 'polyline',
    coordinates: route.coordinates,
    radius: null,
    annotation: `${route.groupName} / 目标 ${route.objectiveName} / 波次 ${route.wave} / 评分 ${route.metrics.score}`,
    visible: true,
    meta: {
      commandStyle: route.groupRole === 'recon' ? 'recon' : route.groupRole === 'cover' || route.groupRole === 'sustain' ? 'support' : 'assault',
    },
  }));

  const checkpointEntities = safeArray(routes).flatMap((route, routeIndex) => safeArray(route.checkpoints).map((item, checkpointIndex, list) => ({
    id: `method-checkpoint-${route.id}-${item.id}`,
    name: item.name,
    type: 'unit',
    camp: checkpointIndex === list.length - 1 ? 'red' : 'blue',
    layerKey: checkpointIndex === list.length - 1 ? 'redUnits' : 'symbols',
    color: checkpointIndex === list.length - 1 ? '#f97316' : palette[routeIndex % palette.length],
    geometryType: 'point',
    coordinates: item.coordinates,
    radius: null,
    annotation: `${route.groupName} / ${route.objectiveName} / ${item.timeOffsetMin} min`,
    visible: true,
    meta: {
      unitSubtype: checkpointIndex === 0 ? 'command' : checkpointIndex === list.length - 1 ? 'target' : 'recon',
    },
  })));

  const objectiveEntities = safeArray(objectiveAnchors).slice(0, 8).map((item) => ({
    id: `method-objective-${item.id}`,
    name: item.name,
    type: 'unit',
    camp: 'red',
    layerKey: 'redUnits',
    color: '#f97316',
    geometryType: 'point',
    coordinates: item.coordinates,
    radius: null,
    annotation: `目标重要度 ${item.importance || '--'}`,
    visible: true,
    meta: {
      unitSubtype: 'command',
    },
  }));

  const landingZone = preferredCandidate
    ? {
      id: `method-landing-zone-${preferredCandidate.id}`,
      name: `${preferredCandidate.name}机降地域`,
      type: 'zone',
      camp: 'neutral',
      layerKey: 'symbols',
      color: '#22c55e',
      geometryType: 'polygon',
      coordinates: preferredCandidate.zone,
      radius: null,
      annotation: `机降评分 ${preferredCandidate.score}`,
      visible: true,
      meta: {},
    }
    : null;

  return {
    entities: [
      ...routeEntities,
      ...checkpointEntities,
      ...objectiveEntities,
      ...(landingZone ? [landingZone] : []),
    ],
    environment: buildMethodEnvironmentOverlays(environment, threatNodes),
  };
}

function buildMethodPlanComparison(routePlans = []) {
  return safeArray(routePlans).map((plan) => ({
    methodKey: plan.methodKey,
    methodLabel: plan.methodLabel,
    score: plan.score,
    routeCount: safeArray(plan.routes).length,
    totalDistanceKm: plan.metrics.totalDistanceKm,
    averageThreatScore: plan.metrics.averageThreatScore,
    averageConcealment: plan.metrics.averageConcealment,
    averageFieldCost: plan.metrics.averageFieldCost,
    estimatedCompletionMin: plan.metrics.estimatedCompletionMin,
  }));
}

function buildMethodKeyActions(missionType = 'fire-strike', routes = [], preferredCandidate = null, phases = []) {
  const primaryRoute = sortByScore(safeArray(routes).map((route) => ({
    ...route,
    priorityScore: Number(route.targetImportance || 0) * 0.58 + Number(route.metrics?.score || 0) * 0.42,
  })), 'priorityScore')[0] || null;
  const riskiestRoute = sortByScore(safeArray(routes).map((route) => ({
    ...route,
    riskScore: Number(route.metrics?.peakFieldCost || 0) * 0.62 + Number(route.metrics?.threatScore || 0) * 0.38,
  })), 'riskScore')[0] || null;
  const actions = [];

  if (primaryRoute) {
    actions.push({
      id: 'method-action-1',
      title: missionType === 'air-assault' ? '主突击航路占领' : '主攻路径展开',
      detail: `${primaryRoute.groupName} 于 ${primaryRoute.startOffsetMin} min 沿 ${primaryRoute.routeType} 前出，关联 ${primaryRoute.platformCount} 个平台，预计 ${primaryRoute.endOffsetMin} min 抵达 ${primaryRoute.objectiveName}。`,
      window: `${primaryRoute.startOffsetMin} - ${primaryRoute.endOffsetMin} min`,
    });
  }
  actions.push({
    id: 'method-action-2',
    title: preferredCandidate ? '机降地域接续' : '多目标协同打击',
    detail: preferredCandidate
      ? `所有机降相关路线均以 ${preferredCandidate.name} 为接续节点，再向各已分配目标方向展开，保证着陆点与突击终点衔接。`
      : `当前路径由 ${safeArray(routes).length} 条目标分配绑定路线组成，支持按波次和编组角色对多个目标同步实施主攻、掩护和侦察协同。`,
    window: `${safeArray(phases)[1]?.startOffsetMin || 0} - ${safeArray(phases)[2]?.endOffsetMin || 0} min`,
  });
  if (riskiestRoute) {
    actions.push({
      id: 'method-action-3',
      title: '高风险航路复核',
      detail: `优先复核 ${riskiestRoute.groupName} 至 ${riskiestRoute.objectiveName} 航路，峰值场代价 ${riskiestRoute.metrics.peakFieldCost}、威胁得分 ${riskiestRoute.metrics.threatScore}，必要时切换其他算法生成的备选路线。`,
      window: `${safeArray(phases)[3]?.startOffsetMin || riskiestRoute.endOffsetMin} - ${safeArray(phases)[3]?.endOffsetMin || round(riskiestRoute.endOffsetMin + 10, 1)} min`,
    });
  }

  return actions;
}

function buildMethodPlanningScenario(context = {}, input = {}, dataset = {}) {
  const threatOutput = safeObject(context.stageOutputs['enemy-threat-analysis']);
  const forceGrouping = safeObject(context.stageOutputs['force-grouping']);
  const targetAllocation = safeObject(context.stageOutputs['target-allocation']);
  const landingSelection = safeObject(context.stageOutputs['airborne-landing-site-selection']);
  const fallbackAnchor = resolveFallbackAnchor(dataset);
  const groupAnchors = buildGroupAnchors(forceGrouping, dataset);
  const objectiveAnchors = buildObjectiveAnchors(targetAllocation, threatOutput, fallbackAnchor);
  const preferredCandidate = safeObject(landingSelection.preferredCandidate);
  const helicopterProfile = safeObject(landingSelection.helicopterProfile);
  const threatNodes = buildThreatRiskNodes(threatOutput);
  const missionType = preferredCandidate?.center ? 'air-assault' : 'fire-strike';

  return {
    fallbackAnchor,
    objectiveAnchors,
    preferredCandidate: preferredCandidate?.center ? preferredCandidate : null,
    helicopterProfile: helicopterProfile?.label ? helicopterProfile : null,
    threatNodes,
    environment: safeArray(dataset.environment),
    missionType,
    routeTasks: buildMethodRouteTasks(
      targetAllocation,
      groupAnchors,
      objectiveAnchors,
      fallbackAnchor,
      missionType,
      preferredCandidate?.center ? preferredCandidate : null,
    ),
  };
}

function buildMethodPlan(methodKey = 'a-star', scenario = {}, input = {}) {
  const routes = buildMethodPlanRoutes(
    methodKey,
    scenario.routeTasks,
    scenario.threatNodes,
    scenario.environment,
    input.options,
    scenario.helicopterProfile,
    scenario.preferredCandidate,
    scenario.missionType,
  );
  const metrics = {
    totalDistanceKm: round(sumBy(routes, (item) => item.metrics.distanceKm), 1),
    averageThreatScore: round(average(routes.map((item) => item.metrics.threatScore)), 1),
    averageConcealment: round(average(routes.map((item) => item.metrics.concealmentScore)), 1),
    averageFieldCost: round(average(routes.map((item) => item.metrics.averageFieldCost)), 2),
    peakFieldCost: round(Math.max(0, ...routes.map((item) => Number(item.metrics.peakFieldCost || 0))), 2),
    estimatedCompletionMin: round(Math.max(...routes.map((item) => Number(item.endOffsetMin || item.metrics.estimatedDurationMin || 0)), 0), 1),
    checkpointCount: sumBy(routes, (item) => safeArray(item.checkpoints).length),
    routeTaskCount: safeArray(routes).length,
  };
  const survivabilityScore = clamp(
    100 - (metrics.averageThreatScore * 0.34) - (metrics.averageFieldCost * 3.2) - (metrics.peakFieldCost * 0.85),
    0,
    100,
  );
  const coordinationScore = round(average(routes.map((item) => (
    Number(item.averageMatchScore || 0) * 0.54
    + Number(item.averageFeasibilityScore || 0) * 0.46
  ))), 1);
  const planScore = round(clamp(
    average(routes.map((item) => item.metrics.score)) * 0.64
    + survivabilityScore * 0.16
    + coordinationScore * 0.12
    + (scenario.missionType === 'air-assault' ? 6 : 3)
    - Math.max(0, metrics.peakFieldCost - 18) * 0.42,
    0,
    100,
  ), 1);
  const phases = buildMethodPhases(
    scenario.missionType,
    routes,
    scenario.preferredCandidate,
    input.options.phaseTempo,
  );

  return {
    id: `method-plan-${methodKey}`,
    methodKey,
    methodLabel: findMethodLabel(METHOD_PLANNING_METHODS, methodKey),
    missionType: scenario.missionType,
    score: planScore,
    routes,
    metrics,
    phases,
    planningBasis: {
      routeTaskCount: scenario.routeTasks.length,
      objectiveCount: scenario.objectiveAnchors.length,
      threatNodeCount: scenario.threatNodes.length,
    },
    keyActions: buildMethodKeyActions(scenario.missionType, routes, scenario.preferredCandidate, phases),
    visualization: buildMethodVisualization(
      routes,
      scenario.preferredCandidate,
      scenario.objectiveAnchors,
      scenario.threatNodes,
      scenario.environment,
    ),
  };
}

async function runBuiltinMethodPlanning(context, step, algorithm, input, dataset) {
  const scenario = buildMethodPlanningScenario(context, input, dataset);
  const plans = METHOD_PLANNING_METHODS.map((method) => buildMethodPlan(method.key, scenario, {
    ...input,
    builtinMethodKey: method.key,
  }));
  const preferredPlan = plans.find((item) => item.methodKey === input.builtinMethodKey) || plans[0];
  const systemBestPlan = sortByScore(plans, 'score')[0] || preferredPlan;

  return {
    summary: `已基于 ${scenario.routeTasks.length} 条分配绑定任务完成 ${plans.length} 类路径规划方案比选，并根据 ${preferredPlan.methodLabel} 输出作战方法推荐结果。`,
    outputPreview: [
      `规划航路 ${preferredPlan.routes.length} 条，任务类型 ${preferredPlan.missionType === 'air-assault' ? '机降突击' : '火力打击'}`,
      `关联目标 ${scenario.objectiveAnchors.length} 个 / 威胁约束节点 ${scenario.threatNodes.length} 个 / 检查点 ${preferredPlan.metrics.checkpointCount} 个`,
      `推荐方法：${preferredPlan.methodLabel}（评分 ${preferredPlan.score}）`,
      `总航程 ${preferredPlan.metrics.totalDistanceKm} km / 预计完成 ${preferredPlan.metrics.estimatedCompletionMin} min`,
    ],
    artifacts: [
      createArtifact('作战方法方案', '输出多算法路径规划结果、推荐航路和关键行动安排。'),
      createArtifact('时序化阶段流程', '输出各阶段起止时间、目标和协同动作。'),
      createArtifact('三维球作战路线', '输出可在三维球展示的火力打击路径或机降突击路线，并叠加威胁/环境约束层。'),
    ],
    structuredOutput: {
      implementationStatus: 'implemented',
      builtinMethodKey: input.builtinMethodKey,
      builtinMethodLabel: findMethodLabel(algorithm.builtinMethods, input.builtinMethodKey),
      planningBasis: {
        routeTaskCount: scenario.routeTasks.length,
        objectiveCount: scenario.objectiveAnchors.length,
        threatNodeCount: scenario.threatNodes.length,
      },
      comparedPlans: buildMethodPlanComparison(plans),
      preferredPlanMethodKey: preferredPlan.methodKey,
      preferredPlan,
      systemBestPlanMethodKey: systemBestPlan.methodKey,
      explanation: [
        `当前采用 ${preferredPlan.methodLabel} 生成首选作战方法，兼顾 ${input.options.routePreference === 'concealment' ? '隐蔽' : input.options.routePreference === 'speed' ? '速度' : '速度与隐蔽平衡'} 偏好。`,
        `路线任务已直接绑定作战目标自动分配结果，共生成 ${scenario.routeTasks.length} 条群组-目标-波次航路任务。`,
        preferredPlan.missionType === 'air-assault'
          ? '规划结果已联动机降地域选择，航路中包含接近、着陆和突击衔接节点。'
          : '规划结果已联动目标分配，航路围绕高价值目标组织主攻、掩护与侦察行动线。',
        '三维展示已叠加航路检查点、威胁影响圈和环境约束层，可直接用于路线合理性复核。',
        preferredPlan.methodKey !== systemBestPlan.methodKey
          ? `系统评分最高方案为 ${systemBestPlan.methodLabel}（${systemBestPlan.score}），可作为备选方案。`
          : '当前推荐方案与系统评分最高方案一致，可直接作为默认作战方法。',
      ],
    },
  };
}

const SUPPORT_RESOURCE_DEFINITIONS = [
  { key: 'ammo', name: '弹药', unit: '基数', priority: '高' },
  { key: 'fuel', name: '油料', unit: '吨', priority: '高' },
  { key: 'maintenance', name: '维修', unit: '工时', priority: '中' },
  { key: 'medical', name: '医疗', unit: '批次', priority: '中' },
  { key: 'airspace', name: '空域', unit: '时隙', priority: '中' },
  { key: 'command', name: '通信指挥', unit: '链路', priority: '中' },
];

const SUPPORT_NODE_SHARE_PROFILES = {
  rear: { ammo: 0.52, fuel: 0.34, maintenance: 0.14, medical: 0.12, airspace: 0.16, command: 0.42 },
  forward: { ammo: 0.34, fuel: 0.42, maintenance: 0.46, medical: 0.3, airspace: 0.24, command: 0.24 },
  coordination: { ammo: 0.14, fuel: 0.24, maintenance: 0.4, medical: 0.58, airspace: 0.6, command: 0.34 },
};

function assertSupportPlanningDependencies(context = {}, step = {}, options = {}) {
  const stepName = String(step.name || '作战保障自动规划');
  const forceGrouping = safeObject(context.stageOutputs['force-grouping']);
  const methodPlanning = safeObject(context.stageOutputs['method-planning']);
  const landingSelection = safeObject(context.stageOutputs['airborne-landing-site-selection']);
  const groups = safeArray(forceGrouping.preferredScheme?.groups || forceGrouping.systemBestScheme?.groups);
  const preferredPlan = safeObject(methodPlanning.preferredPlan);
  const routes = safeArray(preferredPlan.routes);
  const phases = safeArray(preferredPlan.phases);
  const damageForecast = safeObject(options.damageForecast);
  const resourcePool = safeObject(options.resourcePool);

  if (!groups.length) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_UPSTREAM',
      type: 'missing_upstream',
      status: 400,
      message: `${stepName} 缺少有效的作战编组结果，请先完成作战力量智能编组并生成至少 1 个群组。`,
      details: {
        stepId: step.id,
        algorithmId: step.algorithmId,
        missingFrom: ['force-grouping'],
      },
    });
  }

  if (!routes.length || !phases.length) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_UPSTREAM',
      type: 'missing_upstream',
      status: 400,
      message: `${stepName} 缺少有效的作战方法结果，请先完成作战方法自动规划并生成航路与阶段时序。`,
      details: {
        stepId: step.id,
        algorithmId: step.algorithmId,
        missingFrom: ['method-planning'],
      },
    });
  }

  if ((preferredPlan.missionType === 'air-assault' || safeObject(context.stageOutputs['airborne-landing-site-selection']).preferredCandidate)
    && !landingSelection.preferredCandidate) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_UPSTREAM',
      type: 'missing_upstream',
      status: 400,
      message: `${stepName} 缺少机降地域结果，请先完成机降地域优化选择后再执行保障规划。`,
      details: {
        stepId: step.id,
        algorithmId: step.algorithmId,
        missingFrom: ['airborne-landing-site-selection'],
      },
    });
  }

  const damageValues = [
    damageForecast.equipmentLossRate,
    damageForecast.casualtyRate,
    damageForecast.damagedEquipmentCount,
    damageForecast.woundedCount,
    damageForecast.criticalWindowCount,
  ];
  if (damageValues.some((value) => !Number.isFinite(Number(value)))) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: `${stepName} 缺少完整的战损预测输入，请至少提供装备损失率、人员伤亡率、受损装备数、伤员数和关键窗口数量。`,
      details: {
        stepId: step.id,
        algorithmId: step.algorithmId,
        fieldGroup: 'damageForecast',
      },
    });
  }

  const stock = safeObject(resourcePool.stock);
  const transport = safeObject(resourcePool.transport);
  const stockTotal = SUPPORT_RESOURCE_DEFINITIONS.reduce((total, item) => total + Number(stock[item.key] || 0), 0);
  const transportTotal = Number(transport.sorties || 0)
    + Number(transport.maintenanceTeams || 0)
    + Number(transport.medicalTeams || 0)
    + Number(transport.airspaceCells || 0)
    + Number(transport.commandLinks || 0);

  if (stockTotal <= 0 || transportTotal <= 0) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: `${stepName} 缺少可用的保障资源池输入，请至少配置非零库存和运输/保障投送能力。`,
      details: {
        stepId: step.id,
        algorithmId: step.algorithmId,
        fieldGroup: 'resourcePool',
      },
    });
  }

  return {
    groups,
    preferredPlan,
  };
}

function buildSupportDamageForecast(options = {}, preferredPlan = {}) {
  const damageInput = safeObject(options.damageForecast);
  const criticalWindowCount = clamp(Math.round(Number(damageInput.criticalWindowCount || 2)), 1, 4);
  const preferredPhases = safeArray(preferredPlan.phases);
  const candidatePhases = preferredPhases.length > 1 ? preferredPhases.slice(1) : preferredPhases;

  return {
    source: String(damageInput.source || 'manual-assessment').trim() || 'manual-assessment',
    equipmentLossRate: round(clamp(Number(damageInput.equipmentLossRate || 0), 0, 60), 1),
    casualtyRate: round(clamp(Number(damageInput.casualtyRate || 0), 0, 40), 1),
    damagedEquipmentCount: Math.max(0, Math.round(Number(damageInput.damagedEquipmentCount || 0))),
    woundedCount: Math.max(0, Math.round(Number(damageInput.woundedCount || 0))),
    criticalWindowCount,
    criticalWindows: candidatePhases.slice(0, criticalWindowCount).map((phase, index) => ({
      id: `damage-window-${index + 1}`,
      phaseName: phase.name,
      expectedRisk: index === 0 ? '高' : '中',
      detail: `${phase.name}阶段预计出现较高保障消耗与战损补充需求。`,
    })),
  };
}

function buildSupportRequirements(forceGrouping = {}, targetAllocation = {}, preferredPlan = {}, damageForecast = {}, missionType = 'fire-strike') {
  const groups = safeArray(forceGrouping.preferredScheme?.groups || forceGrouping.systemBestScheme?.groups);
  const routeCount = safeArray(preferredPlan.routes).length;
  const targetCount = Math.max(safeArray(targetAllocation.preferredPlan?.assignments).length, routeCount, 1);
  const totalUnitCount = sumBy(groups, (item) => item.unitCount);
  const totalFirepower = sumBy(groups, (item) => item.firepower);
  const totalMobility = sumBy(groups, (item) => item.mobility);
  const totalEndurance = sumBy(groups, (item) => item.endurance);
  const distanceKm = Number(preferredPlan.metrics?.totalDistanceKm || 0);
  const phaseCount = safeArray(preferredPlan.phases).length;

  return [
    {
      key: 'ammo',
      name: '弹药',
      unit: '基数',
      priority: '高',
      demand: round(totalFirepower * 1.02 + targetCount * 12 + Number(damageForecast.damagedEquipmentCount || 0) * 0.6 + (missionType === 'fire-strike' ? 16 : 10), 1),
    },
    {
      key: 'fuel',
      name: '油料',
      unit: '吨',
      priority: '高',
      demand: round(distanceKm * 3.1 + totalMobility * 0.92 + routeCount * 2.8 + (missionType === 'air-assault' ? 24 : 12), 1),
    },
    {
      key: 'maintenance',
      name: '维修',
      unit: '工时',
      priority: '中',
      demand: round(totalUnitCount * 1.6 + Number(damageForecast.damagedEquipmentCount || 0) * 6.4 + Number(damageForecast.equipmentLossRate || 0) * 1.3 + distanceKm * 0.12, 1),
    },
    {
      key: 'medical',
      name: '医疗',
      unit: '批次',
      priority: '中',
      demand: round(Number(damageForecast.woundedCount || 0) * 0.24 + Number(damageForecast.casualtyRate || 0) * 0.42 + phaseCount * 1.3 + (missionType === 'air-assault' ? 2.8 : 1.6), 1),
    },
    {
      key: 'airspace',
      name: '空域',
      unit: '时隙',
      priority: missionType === 'air-assault' ? '高' : '中',
      demand: round(routeCount * 2.1 + Number(damageForecast.criticalWindowCount || 1) * 1.6 + phaseCount * 0.9 + (missionType === 'air-assault' ? 3.6 : 1.4), 1),
    },
    {
      key: 'command',
      name: '通信指挥',
      unit: '链路',
      priority: '中',
      demand: round(totalEndurance * 0.22 + phaseCount * 1.1 + Number(damageForecast.criticalWindowCount || 1) * 0.8 + (missionType === 'air-assault' ? 1.2 : 0.8), 1),
    },
  ];
}

function buildSupportMethodProfile(methodKey = 'demand-driven', airspaceControl = 'standard') {
  const profiles = {
    'demand-driven': {
      reserveRelease: { ammo: 0.56, fuel: 0.5, maintenance: 0.26, medical: 0.3, airspace: 0.34, command: 0.32 },
      nodePriority: {
        ammo: ['rear', 'forward', 'coordination'],
        fuel: ['forward', 'rear', 'coordination'],
        maintenance: ['forward', 'coordination', 'rear'],
        medical: ['coordination', 'forward', 'rear'],
        airspace: ['coordination', 'forward', 'rear'],
        command: ['rear', 'coordination', 'forward'],
      },
    },
    'balanced-scheduling': {
      reserveRelease: { ammo: 0.4, fuel: 0.4, maintenance: 0.38, medical: 0.38, airspace: 0.38, command: 0.38 },
      nodePriority: {
        ammo: ['rear', 'forward', 'coordination'],
        fuel: ['forward', 'rear', 'coordination'],
        maintenance: ['forward', 'rear', 'coordination'],
        medical: ['forward', 'coordination', 'rear'],
        airspace: ['coordination', 'rear', 'forward'],
        command: ['rear', 'forward', 'coordination'],
      },
    },
    'loss-aware': {
      reserveRelease: { ammo: 0.34, fuel: 0.36, maintenance: 0.54, medical: 0.6, airspace: 0.46, command: 0.42 },
      nodePriority: {
        ammo: ['forward', 'rear', 'coordination'],
        fuel: ['forward', 'coordination', 'rear'],
        maintenance: ['coordination', 'forward', 'rear'],
        medical: ['coordination', 'forward', 'rear'],
        airspace: ['coordination', 'forward', 'rear'],
        command: ['coordination', 'rear', 'forward'],
      },
    },
  };
  const profile = cloneData(profiles[methodKey] || profiles['demand-driven']);

  if (airspaceControl === 'tight') {
    profile.reserveRelease.airspace = clamp(profile.reserveRelease.airspace + 0.12, 0.12, 0.82);
    profile.reserveRelease.command = clamp(profile.reserveRelease.command + 0.08, 0.12, 0.82);
    profile.reserveRelease.fuel = clamp(profile.reserveRelease.fuel - 0.04, 0.12, 0.82);
  }
  if (airspaceControl === 'flexible') {
    profile.reserveRelease.airspace = clamp(profile.reserveRelease.airspace - 0.06, 0.12, 0.82);
    profile.reserveRelease.fuel = clamp(profile.reserveRelease.fuel + 0.04, 0.12, 0.82);
    profile.reserveRelease.command = clamp(profile.reserveRelease.command - 0.02, 0.12, 0.82);
  }

  return profile;
}

function computeSupportDispatchableStock(stockValue = 0, reserveRatio = 18, reserveRelease = 0.4) {
  const reserveShare = clamp(Number(reserveRatio || 18), 8, 35) / 100;
  const committedShare = (1 - reserveShare) + reserveShare * clamp(Number(reserveRelease || 0.4), 0, 1);
  return round(Math.max(0, Number(stockValue || 0) * committedShare), 1);
}

function buildSupportTransportLimits(resourcePool = {}, missionType = 'fire-strike', airspaceControl = 'standard') {
  const transport = safeObject(resourcePool.transport);
  const liftBase = Number(transport.sorties || 0) * Number(transport.liftTonnagePerSortie || 0);
  const airspaceModifier = airspaceControl === 'tight' ? 0.92 : airspaceControl === 'flexible' ? 1.08 : 1;

  return {
    ammo: round(liftBase * (missionType === 'fire-strike' ? 1.95 : 1.45), 1),
    fuel: round(liftBase * (missionType === 'air-assault' ? 2.25 : 1.55), 1),
    maintenance: round(Number(transport.maintenanceTeams || 0) * 12, 1),
    medical: round(Number(transport.medicalTeams || 0) * (missionType === 'air-assault' ? 4.4 : 3.2), 1),
    airspace: round(Number(transport.airspaceCells || 0) * (missionType === 'air-assault' ? 2.6 : 2.1) * airspaceModifier, 1),
    command: round(Number(transport.commandLinks || 0) * (airspaceControl === 'tight' ? 1.08 : 1), 1),
  };
}

function buildSupportNodes(missionType = 'fire-strike', preferredPlan = {}, landingSelection = {}, dataset = {}) {
  const fallbackAnchor = resolveFallbackAnchor(dataset);
  const landingCenter = normalizeCoordinate(landingSelection.preferredCandidate?.center || []);
  const stagingAnchor = normalizeCoordinate(safeArray(preferredPlan.routes)[0]?.coordinates?.[0] || fallbackAnchor);
  const routeCoordinates = safeArray(safeArray(preferredPlan.routes)[0]?.coordinates);
  const routeMidpoint = normalizeCoordinate(
    routeCoordinates[Math.floor(Math.max(routeCoordinates.length, 1) / 2)]
    || stagingAnchor,
  );

  return [
    {
      id: 'support-node-1',
      key: 'rear',
      name: '后方装载补给点',
      role: '弹药 / 油料 / 指挥',
      coordinates: stagingAnchor,
      capacityShares: SUPPORT_NODE_SHARE_PROFILES.rear,
    },
    {
      id: 'support-node-2',
      key: 'forward',
      name: missionType === 'air-assault' ? '前沿加油点 FARP' : '前沿补给点',
      role: '油料 / 维修 / 医疗',
      coordinates: routeMidpoint,
      capacityShares: SUPPORT_NODE_SHARE_PROFILES.forward,
    },
    {
      id: 'support-node-3',
      key: 'coordination',
      name: missionType === 'air-assault' ? '机降地域保障点' : '目标方向协同点',
      role: '空域 / 医疗 / 指挥',
      coordinates: landingCenter[0] || landingCenter[1] ? landingCenter : routeMidpoint,
      capacityShares: SUPPORT_NODE_SHARE_PROFILES.coordination,
    },
  ];
}

function buildSupportNodeCapacityState(nodes = [], transportLimits = {}) {
  return Object.fromEntries(
    safeArray(nodes).map((node) => [
      node.key,
      Object.fromEntries(
        SUPPORT_RESOURCE_DEFINITIONS.map((item) => [
          item.key,
          round(Number(transportLimits[item.key] || 0) * Number(node.capacityShares?.[item.key] || 0), 1),
        ]),
      ),
    ]),
  );
}

function resolveSupportTargetGroups(resourceKey = 'ammo', groups = []) {
  const scoredGroups = safeArray(groups).map((group, index) => {
    const roleComposition = safeObject(group.roleComposition);
    let score = Number(group.unitCount || 0) * 0.6;

    if (resourceKey === 'ammo') {
      score += Number(roleComposition.strike || 0) * 22 + Number(roleComposition.cover || 0) * 10 + Number(group.firepower || 0) * 0.18;
    } else if (resourceKey === 'fuel') {
      score += Number(roleComposition.strike || 0) * 14 + Number(roleComposition.sustain || 0) * 16 + Number(group.mobility || 0) * 0.18;
    } else if (resourceKey === 'maintenance') {
      score += Number(roleComposition.support || 0) * 20 + Number(roleComposition.sustain || 0) * 18 + Number(group.unitCount || 0) * 1.2;
    } else if (resourceKey === 'medical') {
      score += Number(roleComposition.support || 0) * 24 + Number(roleComposition.sustain || 0) * 16 + Number(group.unitCount || 0) * 1.1;
    } else if (resourceKey === 'airspace') {
      score += Number(roleComposition.cover || 0) * 18 + Number(roleComposition.recon || 0) * 18 + Number(group.mobility || 0) * 0.16;
    } else if (resourceKey === 'command') {
      score += Number(roleComposition.support || 0) * 18 + Number(roleComposition.cover || 0) * 12 + Number(group.endurance || 0) * 0.14;
    }

    return {
      name: String(group.name || `群组 ${index + 1}`),
      score,
    };
  });

  const selected = sortByScore(scoredGroups, 'score').slice(0, 2).map((item) => item.name);
  return selected.length ? selected : ['主行动群'];
}

function buildSupportPlan(methodKey = 'demand-driven', context = {}, input = {}, dataset = {}) {
  const forceGrouping = safeObject(context.stageOutputs['force-grouping']);
  const targetAllocation = safeObject(context.stageOutputs['target-allocation']);
  const methodPlanning = safeObject(context.stageOutputs['method-planning']);
  const landingSelection = safeObject(context.stageOutputs['airborne-landing-site-selection']);
  const options = normalizeSupportPlanningOptions(input.options);
  const dependencyCheck = assertSupportPlanningDependencies(context, { name: '作战保障自动规划' }, options);
  const groups = dependencyCheck.groups;
  const preferredPlan = safeObject(methodPlanning.preferredPlan);
  const missionType = String(preferredPlan.missionType || (landingSelection.preferredCandidate ? 'air-assault' : 'fire-strike'));
  const damageForecast = buildSupportDamageForecast(options, preferredPlan);
  const requirements = buildSupportRequirements(forceGrouping, targetAllocation, preferredPlan, damageForecast, missionType);
  const methodProfile = buildSupportMethodProfile(methodKey, options.airspaceControl);
  const resourcePool = cloneData(options.resourcePool);
  const transportLimits = buildSupportTransportLimits(resourcePool, missionType, options.airspaceControl);
  const supportNodes = buildSupportNodes(missionType, preferredPlan, landingSelection, dataset);
  const nodeCapacityState = buildSupportNodeCapacityState(supportNodes, transportLimits);
  const initialNodeCapacityState = cloneData(nodeCapacityState);
  const initialNodeLimitsByResource = Object.fromEntries(
    SUPPORT_RESOURCE_DEFINITIONS.map((item) => [
      item.key,
      round(sumBy(supportNodes, (node) => Number(initialNodeCapacityState[node.key]?.[item.key] || 0)), 1),
    ]),
  );
  const allocations = [];

  const enrichedRequirements = requirements.map((item) => {
    const dispatchableStock = computeSupportDispatchableStock(
      safeObject(resourcePool.stock)[item.key],
      options.reserveRatio,
      safeObject(methodProfile.reserveRelease)[item.key],
    );
    const transportLimit = round(Number(transportLimits[item.key] || 0), 1);
    const nodeLimit = round(Number(initialNodeLimitsByResource[item.key] || 0), 1);
    const targetGroups = resolveSupportTargetGroups(item.key, groups);
    const supplyCeiling = round(Math.min(Number(item.demand || 0), dispatchableStock, transportLimit, nodeLimit), 1);
    const limitingFactors = [];

    if (dispatchableStock + 0.05 < Number(item.demand || 0)) limitingFactors.push('资源池库存');
    if (transportLimit + 0.05 < Number(item.demand || 0)) limitingFactors.push('运输投送能力');
    if (nodeLimit + 0.05 < Number(item.demand || 0)) limitingFactors.push('保障节点容量');

    let remainingToAllocate = supplyCeiling;
    const nodePriority = safeArray(methodProfile.nodePriority?.[item.key]).length
      ? methodProfile.nodePriority[item.key]
      : supportNodes.map((node) => node.key);

    nodePriority.forEach((nodeKey) => {
      const node = supportNodes.find((entry) => entry.key === nodeKey);
      if (!node || remainingToAllocate <= 0.05) return;
      const available = round(Math.max(0, Number(nodeCapacityState[node.key]?.[item.key] || 0)), 1);
      if (available <= 0.05) return;
      const quantity = round(Math.min(remainingToAllocate, available), 1);
      if (quantity <= 0) return;
      nodeCapacityState[node.key][item.key] = round(Math.max(0, available - quantity), 1);
      remainingToAllocate = round(Math.max(0, remainingToAllocate - quantity), 1);
      allocations.push({
        id: `allocation-${item.key}-${node.key}-${allocations.length + 1}`,
        serviceKey: item.key,
        serviceType: item.name,
        nodeId: node.id,
        nodeName: node.name,
        assignedTo: targetGroups.join(' / '),
        quantity,
        unit: item.unit,
        coverageRate: 0,
        notes: `优先支撑 ${targetGroups.join(' / ')}。`,
      });
    });

    const supplied = round(supplyCeiling - remainingToAllocate, 1);
    const gap = round(Math.max(0, Number(item.demand || 0) - supplied), 1);
    const coverageRate = Number(item.demand || 0) > 0
      ? round(clamp((supplied / Number(item.demand || 1)) * 100, 0, 100), 1)
      : 100;

    allocations
      .filter((row) => row.serviceKey === item.key && row.coverageRate === 0)
      .forEach((row) => {
        row.coverageRate = coverageRate;
        row.notes = gap > 0
          ? `${row.notes} 受 ${limitingFactors.join(' / ')} 约束，剩余缺口 ${gap}${item.unit}。`
          : `${row.notes} 当前节点分配已覆盖本项需求。`;
      });

    return {
      ...item,
      targetGroups,
      dispatchableStock,
      transportLimit,
      nodeLimit,
      supplyCeiling,
      supplied,
      gap,
      coverageRate,
      limitingFactors,
      constraintLabel: limitingFactors.length ? limitingFactors.join(' / ') : '充足',
    };
  });

  const airspaceWindows = safeArray(preferredPlan.phases).map((phase, index) => ({
    id: `airspace-window-${index + 1}`,
    name: `${phase.name}空域窗口`,
    startOffsetMin: phase.startOffsetMin,
    endOffsetMin: phase.endOffsetMin,
    role: damageForecast.criticalWindows.find((item) => item.phaseName === phase.name)
      ? '战损补充 / 空域优先窗口'
      : missionType === 'air-assault' && index === 1
        ? '直升机航路净化'
        : index === 2
          ? '主行动窗口'
          : '协调窗口',
  }));

  const stockStatus = SUPPORT_RESOURCE_DEFINITIONS.map((item) => {
    const requirement = enrichedRequirements.find((entry) => entry.key === item.key) || {};
    const configured = round(Number(safeObject(resourcePool.stock)[item.key] || 0), 1);
    const committed = round(Number(requirement.supplied || 0), 1);
    return {
      key: item.key,
      name: item.name,
      unit: item.unit,
      configured,
      dispatchable: round(Number(requirement.dispatchableStock || 0), 1),
      committed,
      remaining: round(Math.max(0, configured - committed), 1),
      transportLimit: round(Number(requirement.transportLimit || 0), 1),
      nodeLimit: round(Number(requirement.nodeLimit || 0), 1),
      activeConstraint: requirement.constraintLabel || '充足',
    };
  });

  const transportStatus = [
    { key: 'sorties', name: '运输架次', unit: '架', capacity: Number(resourcePool.transport?.sorties || 0) },
    { key: 'liftTonnagePerSortie', name: '单架次载重', unit: '吨', capacity: Number(resourcePool.transport?.liftTonnagePerSortie || 0) },
    { key: 'maintenanceTeams', name: '维修分队', unit: '组', capacity: Number(resourcePool.transport?.maintenanceTeams || 0) },
    { key: 'medicalTeams', name: '医疗分队', unit: '组', capacity: Number(resourcePool.transport?.medicalTeams || 0) },
    { key: 'airspaceCells', name: '空域协同席位', unit: '席', capacity: Number(resourcePool.transport?.airspaceCells || 0) },
    { key: 'commandLinks', name: '指挥链路', unit: '条', capacity: Number(resourcePool.transport?.commandLinks || 0) },
  ];

  const bottlenecks = enrichedRequirements
    .filter((item) => item.limitingFactors.length)
    .map((item) => ({
      id: `support-bottleneck-${item.key}`,
      key: item.key,
      title: `${item.name}受约束`,
      level: item.priority === '高' ? 'warn' : 'info',
      detail: `${item.name} 当前主要受 ${item.limitingFactors.join(' / ')} 约束，需求 ${item.demand}${item.unit}，可保障 ${item.supplied}${item.unit}。`,
    }));

  const gapCount = enrichedRequirements.filter((item) => Number(item.gap || 0) > 0.1).length;
  const criticalGapCount = enrichedRequirements.filter((item) => item.priority === '高' && Number(item.gap || 0) > 0.1).length;
  const stockBottleneckCount = enrichedRequirements.filter((item) => safeArray(item.limitingFactors).includes('资源池库存')).length;
  const transportBottleneckCount = enrichedRequirements.filter((item) => safeArray(item.limitingFactors).includes('运输投送能力')).length;
  const nodeBottleneckCount = enrichedRequirements.filter((item) => safeArray(item.limitingFactors).includes('保障节点容量')).length;
  const bottleneckCount = bottlenecks.length;
  const coverageRate = round(average(enrichedRequirements.map((item) => item.coverageRate)), 1);
  const score = round(clamp(
    coverageRate
    - criticalGapCount * 10
    - gapCount * 3.5
    - stockBottleneckCount * 4
    - transportBottleneckCount * 3
    - nodeBottleneckCount * 2
    + Number(options.reserveRatio || 18) * 0.18
    - Math.max(0, Number(damageForecast.casualtyRate || 0) - 8) * 0.4,
    0,
    100,
  ), 1);

  const matchingAnalysis = [
    criticalGapCount
      ? { title: '关键保障存在缺口', level: 'warn', detail: `当前仍有 ${criticalGapCount} 个高优先级保障项存在缺口，需要在行动前追加资源或调整任务节奏。` }
      : { title: '关键保障需求已覆盖', level: 'pass', detail: '高优先级保障要素已覆盖主要行动窗口，可支撑当前推荐战法。' },
    stockBottleneckCount
      ? { title: '资源池库存分析', level: 'warn', detail: `有 ${stockBottleneckCount} 项保障要素受库存约束，需补充资源池或降低单波次消耗。` }
      : { title: '资源池库存分析', level: 'pass', detail: '当前资源池库存可覆盖本轮保障调度需求。' },
    transportBottleneckCount || nodeBottleneckCount
      ? { title: '调度约束分析', level: 'warn', detail: `运输投送约束 ${transportBottleneckCount} 项、节点容量约束 ${nodeBottleneckCount} 项，建议调整节点前推与调度节奏。` }
      : { title: '调度约束分析', level: 'pass', detail: '运输投送能力与节点容量均能满足本轮调度计划。' },
    { title: '战损补充能力评估', level: Number(damageForecast.equipmentLossRate || 0) >= 16 || Number(damageForecast.woundedCount || 0) >= 24 ? 'warn' : 'pass', detail: `输入战损：装备损失率 ${damageForecast.equipmentLossRate}% / 人员伤亡率 ${damageForecast.casualtyRate}% / 受损装备 ${damageForecast.damagedEquipmentCount} 件 / 伤员 ${damageForecast.woundedCount} 人。` },
    { title: '空域协同分析', level: enrichedRequirements.find((item) => item.key === 'airspace' && Number(item.gap || 0) > 0) ? 'warn' : 'pass', detail: '空域窗口已与行动阶段和战损关键窗口绑定，可直接用于方法规划联动分析。' },
  ];

  const recommendations = uniqueList([
    criticalGapCount ? '建议优先前推弹药与油料节点，保障主航路和主攻群的首轮消耗补充。' : '当前关键保障项已完成覆盖，可按既定时序组织首轮行动。',
    stockBottleneckCount ? '建议提高对应保障要素的资源池库存，或拆分行动波次以降低单窗口消耗峰值。' : '当前资源池库存结构基本匹配任务需求。',
    transportBottleneckCount ? '建议增加运输架次、单架次载重或前沿补给节点转运能力。' : '运输投送能力与当前需求匹配，可保持现有保障节奏。',
    nodeBottleneckCount ? '建议扩充前沿节点或目标方向协同点的容量，避免节点拥塞导致调度折损。' : '当前保障节点容量未出现明显拥塞。',
    missionType === 'air-assault'
      ? '建议将机降接近窗口与保障空域窗口重叠配置，减少低空暴露时间。'
      : '建议保持侦察回传链路与火力压制节奏同步，便于滚动修正保障投送。',
  ]).map((text, index) => ({
    id: `support-recommendation-${index + 1}`,
    text,
  }));

  const corridors = [
    {
      id: 'support-corridor-1',
      name: '主保障走廊',
      coordinates: [
        applyAltitude(supportNodes[0].coordinates, 260),
        applyAltitude(supportNodes[1].coordinates, 220),
        applyAltitude(supportNodes[2].coordinates, 180),
      ],
    },
  ];

  const visualization = {
    entities: [
      ...supportNodes.map((node, index) => ({
        id: node.id,
        name: node.name,
        type: 'unit',
        camp: 'blue',
        layerKey: 'symbols',
        color: ['#38bdf8', '#facc15', '#22c55e'][index % 3],
        geometryType: 'point',
        coordinates: node.coordinates,
        radius: null,
        annotation: node.role,
        visible: true,
        meta: {
          unitSubtype: index === 1 ? 'transport' : index === 2 ? 'medic' : 'command',
        },
      })),
      ...corridors.map((corridor, index) => ({
        id: corridor.id,
        name: corridor.name,
        type: 'order',
        camp: 'blue',
        layerKey: 'orders',
        color: index === 0 ? '#facc15' : '#38bdf8',
        geometryType: 'polyline',
        coordinates: corridor.coordinates,
        radius: null,
        annotation: '保障调度走廊',
        visible: true,
        meta: {
          commandStyle: 'transfer',
        },
      })),
    ],
    environment: [],
  };

  return {
    id: `support-plan-${methodKey}`,
    methodKey,
    methodLabel: findMethodLabel(SUPPORT_METHODS, methodKey),
    score,
    metrics: {
      coverageRate,
      gapCount,
      criticalGapCount,
      reserveRatio: Number(options.reserveRatio || 18),
      bottleneckCount,
    },
    requirements: enrichedRequirements,
    allocations,
    airspaceWindows,
    supportNodes,
    matchingAnalysis,
    recommendations,
    damageForecast,
    resourcePool: {
      reserveRatio: Number(options.reserveRatio || 18),
      airspaceControl: options.airspaceControl,
      stockStatus,
      transportStatus,
      bottlenecks,
    },
    dependencyCheck: {
      groupingGroupCount: groups.length,
      routeCount: safeArray(preferredPlan.routes).length,
      phaseCount: safeArray(preferredPlan.phases).length,
      landingLinked: Boolean(landingSelection.preferredCandidate),
    },
    visualization,
  };
}

async function runBuiltinSupportPlanning(context, step, algorithm, input, dataset) {
  const plans = SUPPORT_METHODS.map((method) => buildSupportPlan(method.key, context, {
    ...input,
    builtinMethodKey: method.key,
  }, dataset));
  const preferredPlan = plans.find((item) => item.methodKey === input.builtinMethodKey) || plans[0];
  const systemBestPlan = sortByScore(plans, 'score')[0] || preferredPlan;

  return {
    summary: `已完成 ${plans.length} 套保障调度方案比选，并根据 ${preferredPlan.methodLabel} 输出推荐保障计划。`,
    outputPreview: [
      `保障覆盖率 ${preferredPlan.metrics.coverageRate}% / 缺口 ${preferredPlan.metrics.gapCount} 项`,
      `战损输入：装备损失率 ${preferredPlan.damageForecast.equipmentLossRate}% / 伤员 ${preferredPlan.damageForecast.woundedCount} 人`,
      `推荐保障方法：${preferredPlan.methodLabel}（评分 ${preferredPlan.score}）`,
    ],
    artifacts: [
      createArtifact('保障需求清单', '输出弹药、油料、维修、医疗、空域和通信等保障需求。'),
      createArtifact('保障资源调度结果', '输出保障节点、保障走廊和资源分配明细。'),
      createArtifact('保障匹配分析', '输出保障能力与作战需求之间的匹配程度、缺口和建议。'),
    ],
    structuredOutput: {
      implementationStatus: 'implemented',
      builtinMethodKey: input.builtinMethodKey,
      builtinMethodLabel: findMethodLabel(algorithm.builtinMethods, input.builtinMethodKey),
      comparedPlans: plans.map((item) => ({
        methodKey: item.methodKey,
        methodLabel: item.methodLabel,
        score: item.score,
        coverageRate: item.metrics.coverageRate,
        gapCount: item.metrics.gapCount,
        criticalGapCount: item.metrics.criticalGapCount,
        reserveRatio: item.metrics.reserveRatio,
        bottleneckCount: item.metrics.bottleneckCount,
      })),
      preferredPlanMethodKey: preferredPlan.methodKey,
      preferredPlan,
      systemBestPlanMethodKey: systemBestPlan.methodKey,
      damageForecast: preferredPlan.damageForecast,
    },
  };
}

const BUILTIN_EXECUTORS = {
  'enemy-threat-analysis': runBuiltinThreatAnalysis,
  'force-grouping': runBuiltinForceGrouping,
  'target-allocation': runBuiltinTargetAllocation,
  'airborne-landing-site-selection': runBuiltinAirborneLandingSiteSelection,
  'method-planning': runBuiltinMethodPlanning,
  'support-planning': runBuiltinSupportPlanning,
};

function mergeExecutionContext(context, step, algorithm, stageResult) {
  return {
    ...context,
    stageOutputs: {
      ...context.stageOutputs,
      [step.id]: cloneData(stageResult.structuredOutput || {}),
      [algorithm.id]: cloneData(stageResult.structuredOutput || {}),
    },
    handoffTrail: [
      ...safeArray(context.handoffTrail),
      {
        stepId: step.id,
        stepName: step.name,
        algorithmId: algorithm.id,
        produces: cloneData(step.produces || []),
      },
    ],
  };
}

async function executeBuiltinStep(step, algorithm, context, input, dataset) {
  const executor = BUILTIN_EXECUTORS[algorithm.id];
  if (!executor) {
    throw createPlanningRuntimeError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: `未找到算法 ${algorithm.name} 的内置执行器。`,
      details: {
        stepId: step.id,
        stepName: step.name,
        algorithmId: algorithm.id,
      },
    });
  }
  return executor(context, step, algorithm, input, dataset);
}

async function executeExternalStep(variant, task, step, algorithm, context, payload, input, events = null, signal = null) {
  throwIfPlanningAborted(signal, { stepId: step.id, algorithmId: algorithm.id, bindingId: variant.id });
  if (variant.executionMode === 'local-python') {
    return executeLocalPythonStep(variant, task, step, algorithm, context, payload, input, events, signal);
  }

  const requestPayload = {
    assessmentName: String(payload.assessmentName || `${task.name}规划任务`),
    task: {
      id: task.id,
      name: task.name,
      category: task.category,
    },
    step: cloneData(step),
    algorithm: {
      id: algorithm.id,
      name: algorithm.name,
      category: algorithm.category,
    },
    selectedImplementation: {
      id: variant.id,
      name: variant.name,
      runtimeKey: variant.runtimeKey,
      projectName: variant.projectName || '',
      projectPath: variant.projectPath || '',
      runtime: variant.runtime,
      version: variant.version,
    },
    dataset: buildExternalDatasetPayload(payload.dataset || {}, input.selectedSourceIds),
    algorithmInput: cloneData(input),
    context: cloneData(context),
  };

  let gatewayResponse = null;
  try {
    gatewayResponse = await invokeExternalAlgorithm({
      engine: variant,
      moduleKey: 'intelligent-task-planning',
      payload: requestPayload,
      assessmentName: requestPayload.assessmentName,
      algorithm: {
        key: algorithm.id,
        name: algorithm.name,
      },
      requestMeta: {
        flow: 'planning-external-step',
        stepId: step.id,
        stepName: step.name,
        bindingId: variant.id,
      },
    });
  } catch (error) {
    throw createPlanningRuntimeError({
      code: String(error?.code || 'PLANNING_ALGORITHM_FAILED'),
      type: String(error?.type || 'algorithm_failed'),
      status: Number(error?.status || 502),
      message: String(error?.message || `${variant.name} 执行失败。`),
      details: {
        stepId: step.id,
        stepName: step.name,
        algorithmId: algorithm.id,
        bindingId: variant.id,
        runtime: variant.runtimeKey,
        requestId: error?.details?.requestId || '',
      },
    });
  }

  const data = gatewayResponse?.result;
  const gatewayMeta = gatewayResponse?.callMeta;
  return {
    summary: String(data?.summary || `${algorithm.name} 外部算法工程执行完成。`),
    outputPreview: safeArray(data?.outputPreview),
    artifacts: safeArray(data?.artifacts),
    structuredOutput: cloneData(data?.structuredOutput || data?.result || {}),
    gateway: buildAlgorithmGatewayMeta(variant, gatewayMeta),
  };
}

async function executeTaskPlanning(task, template, payload = {}, dataset = {}, { db, events, signal } = {}) {
  const algorithmMap = buildAlgorithmMap(template.algorithms);
  const bindings = safeObject(payload.bindings);
  const algorithmInputs = normalizeAlgorithmInputs(template, payload);
  let context = buildInitialContext(task, payload, algorithmInputs, dataset);
  const executionSteps = [];
  const sortedSteps = [...safeArray(task.steps)].sort((left, right) => left.order - right.order);
  const totalSteps = sortedSteps.length || 1;

  for (const step of sortedSteps) {
    throwIfPlanningAborted(signal, {
      taskId: task.id,
      stepId: step.id,
      algorithmId: step.algorithmId,
    });
    const algorithm = algorithmMap.get(step.algorithmId);
    if (!algorithm) {
      throw createPlanningRuntimeError({
        code: 'PLANNING_MISSING_DATA',
        type: 'missing_data',
        status: 400,
        message: `任务步骤 ${step.name} 引用了不存在的算法 ${step.algorithmId}。`,
        details: {
          stepId: step.id,
          stepName: step.name,
          algorithmId: step.algorithmId,
        },
      });
    }

    const variant = resolveBindingVariant(step, algorithm, task, bindings);
    if (!variant) {
      throw createPlanningRuntimeError({
        code: 'PLANNING_MISSING_DATA',
        type: 'missing_data',
        status: 400,
        message: `任务步骤 ${step.name} 未找到可用算法实现。`,
        details: {
          stepId: step.id,
          stepName: step.name,
          algorithmId: algorithm.id,
        },
      });
    }

    if (variant.status !== 'active') {
      throw createPlanningRuntimeError({
        code: 'PLANNING_MISSING_DATA',
        type: 'missing_data',
        status: 400,
        message: `${step.name} 选择的算法实现 ${variant.name} 当前仅为预留扩展位。`,
        details: {
          stepId: step.id,
          stepName: step.name,
          algorithmId: algorithm.id,
          bindingId: variant.id,
        },
      });
    }

    const algorithmInput = algorithmInputs[algorithm.id] || normalizeAlgorithmInput(algorithm);
    const stepStartedAt = Date.now();
    let stageResult = null;
    const stepIndex = executionSteps.length;
    emitPlanningEvent(events, 'step-start', {
      stepId: step.id,
      stepName: step.name,
      algorithmId: algorithm.id,
      algorithmName: algorithm.name,
      bindingId: variant.id,
      bindingName: variant.name,
      order: step.order,
      totalSteps,
    });
    emitPlanningEvent(events, 'progress', {
      currentStepId: step.id,
      currentStepName: step.name,
      progress: Math.round((stepIndex / totalSteps) * 100),
      completedSteps: stepIndex,
      totalSteps,
      phase: 'running-step',
    });
    try {
      stageResult = variant.type === 'builtin'
        ? await executeBuiltinStep(step, algorithm, context, algorithmInput, dataset)
        : await executeExternalStep(variant, task, step, algorithm, context, { ...payload, dataset }, algorithmInput, events, signal);
    } catch (error) {
      const normalizedError = normalizePlanningRuntimeError(error, `${step.name} 执行失败。`);
      normalizedError.details = {
        ...(normalizedError.details || {}),
        stepId: step.id,
        stepName: step.name,
        algorithmId: algorithm.id,
        bindingId: variant.id,
        runtime: variant.runtimeKey,
      };
      recordAlgorithmCall(db, {
        moduleKey: 'planning',
        assessmentName: String(payload.assessmentName || `${task.name}规划任务`),
        taskId: Number.isFinite(Number(payload.taskCenterId)) ? Number(payload.taskCenterId) : null,
        taskRunId: Number.isFinite(Number(payload.taskRunId)) ? Number(payload.taskRunId) : null,
        algorithmKey: algorithm.id,
        algorithmName: algorithm.name,
        engineKey: variant.id,
        engineSource: variant.source || (variant.type === 'builtin' ? 'builtin' : 'external'),
        engineRuntime: variant.runtime || variant.runtimeKey,
        engineVersion: variant.version || '',
        status: 'failed',
        httpStatus: normalizedError.status,
        durationMs: Date.now() - stepStartedAt,
        requestId: normalizedError?.details?.requestId || '',
        errorCode: normalizedError.code || '',
        errorMessage: normalizedError.message || '',
        requestPayload: {
          stepId: step.id,
          stepName: step.name,
          selectedSourceCount: safeArray(algorithmInput.selectedSourceIds).length,
          uploadedFileCount: safeArray(algorithmInput.uploadedFiles).length,
        },
        responsePayload: normalizedError.details || {},
      });
      emitPlanningEvent(events, 'error', {
        stepId: step.id,
        stepName: step.name,
        algorithmId: algorithm.id,
        bindingId: variant.id,
        message: normalizedError.message,
        code: normalizedError.code,
        errorType: normalizedError.type,
      });
      throw normalizedError;
    }

    const gatewayMeta = variant.type === 'builtin'
      ? buildAlgorithmGatewayMeta(variant, {
        status: 'succeeded',
        durationMs: Date.now() - stepStartedAt,
        httpStatus: 200,
        requestId: '',
      })
      : buildAlgorithmGatewayMeta(variant, stageResult?.gateway || {
        status: 'succeeded',
        durationMs: Date.now() - stepStartedAt,
        httpStatus: 200,
      });

    const normalizedResult = {
      order: step.order,
      stepId: step.id,
      stepName: step.name,
      objective: step.objective,
      consumes: cloneData(step.consumes || []),
      produces: cloneData(step.produces || []),
      algorithm: {
        id: algorithm.id,
        name: algorithm.name,
        category: algorithm.category,
      },
      binding: {
        id: variant.id,
        name: variant.name,
        type: variant.type,
        runtimeKey: variant.runtimeKey,
        source: variant.source,
        runtime: variant.runtime,
        version: variant.version,
        executionMode: variant.executionMode || '',
        projectName: variant.projectName || '',
        projectPath: variant.projectPath || '',
      },
      config: {
        builtinMethodKey: algorithmInput.builtinMethodKey,
        selectedSourceIds: cloneData(algorithmInput.selectedSourceIds || []),
        uploadedFileCount: safeArray(algorithmInput.uploadedFiles).length,
        options: redactSensitiveOptions(cloneData(algorithmInput.options || {})),
      },
      gateway: gatewayMeta,
      status: 'completed',
      summary: stageResult.summary,
      outputPreview: safeArray(stageResult.outputPreview),
      artifacts: safeArray(stageResult.artifacts),
      structuredOutput: cloneData(stageResult.structuredOutput || {}),
    };

    recordAlgorithmCall(db, {
      moduleKey: 'planning',
      assessmentName: String(payload.assessmentName || `${task.name}规划任务`),
      taskId: Number.isFinite(Number(payload.taskCenterId)) ? Number(payload.taskCenterId) : null,
      taskRunId: Number.isFinite(Number(payload.taskRunId)) ? Number(payload.taskRunId) : null,
      algorithmKey: algorithm.id,
      algorithmName: algorithm.name,
      engineKey: variant.id,
      engineSource: gatewayMeta.source,
      engineRuntime: gatewayMeta.runtime,
      engineVersion: gatewayMeta.version,
      status: 'succeeded',
      httpStatus: gatewayMeta.httpStatus,
      durationMs: gatewayMeta.durationMs,
      requestId: gatewayMeta.requestId,
      requestPayload: {
        stepId: step.id,
        stepName: step.name,
        selectedSourceCount: safeArray(algorithmInput.selectedSourceIds).length,
        uploadedFileCount: safeArray(algorithmInput.uploadedFiles).length,
      },
      responsePayload: {
        summary: normalizedResult.summary,
        outputPreviewCount: normalizedResult.outputPreview.length,
        artifactCount: normalizedResult.artifacts.length,
      },
    });

    executionSteps.push(normalizedResult);
    emitPlanningEvent(events, 'step-complete', {
      stepId: step.id,
      stepName: step.name,
      algorithmId: algorithm.id,
      algorithmName: algorithm.name,
      bindingId: variant.id,
      bindingName: variant.name,
      order: step.order,
      durationMs: gatewayMeta.durationMs,
      summary: normalizedResult.summary,
      progress: Math.round((executionSteps.length / totalSteps) * 100),
      completedSteps: executionSteps.length,
      totalSteps,
    });
    emitPlanningEvent(events, 'progress', {
      currentStepId: step.id,
      currentStepName: step.name,
      progress: Math.round((executionSteps.length / totalSteps) * 100),
      completedSteps: executionSteps.length,
      totalSteps,
      phase: 'step-complete',
    });
    context = mergeExecutionContext(context, step, algorithm, normalizedResult);
  }

  return {
    context,
    steps: executionSteps,
    algorithmInputs,
  };
}

function buildDeliverables(task, executionSteps = []) {
  const implementedSteps = executionSteps.filter((item) => item.structuredOutput?.implementationStatus === 'implemented');
  const placeholderSteps = executionSteps.filter((item) => item.structuredOutput?.implementationStatus !== 'implemented');
  const sourceStepLabel = implementedSteps.length
    ? implementedSteps.map((item) => item.stepName).join(' / ')
    : '全流程';
  const sourceAlgorithmLabel = implementedSteps.length
    ? implementedSteps.map((item) => item.algorithm.name).join(' / ')
    : '任务规划流程';

  return safeArray(task.finalDeliverables).map((name, index) => {
    const isSummary = index === 1 || String(name).includes('汇总');
    const isAdvice = index === safeArray(task.finalDeliverables).length - 1 || String(name).includes('建议');
    const status = placeholderSteps.length && !isSummary
      ? (implementedSteps.length ? 'partial' : 'placeholder')
      : 'available';

    return {
      name,
      status,
      sourceStep: isAdvice && placeholderSteps.length
        ? placeholderSteps.map((item) => item.stepName).join(' / ')
        : sourceStepLabel,
      sourceAlgorithm: isAdvice && placeholderSteps.length
        ? placeholderSteps.map((item) => item.algorithm.name).join(' / ')
        : sourceAlgorithmLabel,
      description: isSummary
        ? '包含任务执行链路中各步骤的阶段产物与结构化中间结果。'
        : isAdvice && placeholderSteps.length
          ? '当前建议部分仍依赖占位执行器，待补充后续算法要求后继续完善。'
          : `${name} 已结合当前任务流程的已实现步骤生成首版结果。`,
    };
  });
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeExportFilePart(value = '') {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || '智能任务规划';
}

function buildExportTimestampToken(generatedAt = '') {
  const date = new Date(generatedAt || Date.now());
  if (Number.isNaN(date.getTime())) {
    return 'planning-result';
  }

  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function buildPlanningExportBaseName(assessmentName = '', taskName = '', generatedAt = '') {
  const baseName = sanitizeExportFilePart(assessmentName || taskName || '智能任务规划');
  return `${baseName}-${buildExportTimestampToken(generatedAt)}`;
}

function createOutputPackage({
  key,
  label,
  description,
  format,
  fileName,
  mimeType,
  data = undefined,
  content = undefined,
  contentBase64 = undefined,
  meta = {},
}) {
  return {
    key,
    label,
    description,
    format,
    fileName,
    mimeType,
    meta,
    ...(typeof data === 'undefined' ? {} : { data }),
    ...(typeof content === 'undefined' ? {} : { content }),
    ...(typeof contentBase64 === 'undefined' ? {} : { contentBase64 }),
  };
}

function buildGeojsonPolygonRings(coordinates = []) {
  const ring = safeArray(coordinates)
    .map((point) => normalizeCoordinate(point))
    .filter(isCoordinateTuple);

  if (!ring.length) {
    return [];
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    Number(first[0]) !== Number(last[0])
    || Number(first[1]) !== Number(last[1])
    || Number(first[2] || 0) !== Number(last[2] || 0)
  ) {
    ring.push([...first]);
  }

  return [ring];
}

function buildGeojsonCircleRing(center = [], radiusMeters = 1000, segmentCount = 32) {
  const [longitude, latitude, altitude] = normalizeCoordinate(center);
  const radiusKm = Math.max(Number(radiusMeters || 0) / 1000, 0.05);
  const latDegreeKm = 110.574;
  const toRadians = (value) => value * (Math.PI / 180);
  const lonDegreeKm = 111.32 * Math.max(0.25, Math.cos(toRadians(latitude)));
  const ring = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const angle = (Math.PI * 2 * index) / segmentCount;
    const offsetLon = (Math.cos(angle) * radiusKm) / lonDegreeKm;
    const offsetLat = (Math.sin(angle) * radiusKm) / latDegreeKm;
    ring.push([
      round(longitude + offsetLon, 6),
      round(latitude + offsetLat, 6),
      altitude,
    ]);
  }

  return [ring];
}

function buildPlanningGeojsonFeature(moduleKey = '', moduleLabel = '', sourceType = '', item = {}, geometry = null, properties = {}) {
  if (!geometry?.type || !geometry.coordinates) {
    return null;
  }

  return {
    type: 'Feature',
    id: item.id || `${moduleKey}-${sourceType}-${Math.random().toString(36).slice(2, 8)}`,
    properties: {
      moduleKey,
      moduleLabel,
      sourceType,
      name: item.name || '',
      itemType: item.type || item.kind || '',
      geometryType: item.geometryType || '',
      annotation: item.annotation || item.notes || item.weather || '',
      color: item.color || '',
      layerKey: item.layerKey || '',
      riskLevel: item.riskLevel || '',
      ...properties,
    },
    geometry,
  };
}

function buildPlanningGeojsonFromEntity(moduleKey = '', moduleLabel = '', entity = {}) {
  if (!entity?.geometryType) {
    return null;
  }

  if (entity.geometryType === 'point' && isCoordinateTuple(entity.coordinates)) {
    return buildPlanningGeojsonFeature(moduleKey, moduleLabel, 'entity', entity, {
      type: 'Point',
      coordinates: normalizeCoordinate(entity.coordinates),
    });
  }

  if (entity.geometryType === 'polyline') {
    const coordinates = safeArray(entity.coordinates)
      .map((point) => normalizeCoordinate(point))
      .filter(isCoordinateTuple);
    if (coordinates.length >= 2) {
      return buildPlanningGeojsonFeature(moduleKey, moduleLabel, 'entity', entity, {
        type: 'LineString',
        coordinates,
      });
    }
    return null;
  }

  if (entity.geometryType === 'polygon') {
    const rings = buildGeojsonPolygonRings(entity.coordinates);
    if (rings.length) {
      return buildPlanningGeojsonFeature(moduleKey, moduleLabel, 'entity', entity, {
        type: 'Polygon',
        coordinates: rings,
      });
    }
    return null;
  }

  if (entity.geometryType === 'circle' && isCoordinateTuple(entity.coordinates)) {
    return buildPlanningGeojsonFeature(moduleKey, moduleLabel, 'entity', entity, {
      type: 'Polygon',
      coordinates: buildGeojsonCircleRing(entity.coordinates, entity.radius),
    }, {
      radiusMeters: Number(entity.radius || 0),
    });
  }

  return null;
}

function buildPlanningGeojsonFromEnvironmentOverlay(moduleKey = '', moduleLabel = '', overlay = {}) {
  if (!overlay?.geometryType) {
    return null;
  }

  if (overlay.geometryType === 'polygon') {
    const rings = buildGeojsonPolygonRings(overlay.geometry);
    if (rings.length) {
      return buildPlanningGeojsonFeature(moduleKey, moduleLabel, 'environment', overlay, {
        type: 'Polygon',
        coordinates: rings,
      });
    }
    return null;
  }

  if (overlay.geometryType === 'circle' && isCoordinateTuple(overlay.geometry?.center)) {
    return buildPlanningGeojsonFeature(moduleKey, moduleLabel, 'environment', overlay, {
      type: 'Polygon',
      coordinates: buildGeojsonCircleRing(overlay.geometry.center, overlay.geometry.radius),
    }, {
      radiusMeters: Number(overlay.geometry?.radius || 0),
    });
  }

  return null;
}

function buildPlanningGeojsonFromThreatField(moduleKey = '', moduleLabel = '', heatmapGeojson = {}) {
  const features = safeArray(heatmapGeojson.features);
  return features.map((feature, index) => {
    if (feature?.type !== 'Feature' || !feature.geometry?.type || !feature.geometry?.coordinates) {
      return null;
    }
    return {
      ...cloneData(feature),
      id: feature.id || `${moduleKey}-threat-field-${index + 1}`,
      properties: {
        moduleKey,
        moduleLabel,
        sourceType: 'threat-field-grid',
        ...(feature.properties || {}),
      },
    };
  }).filter(Boolean);
}

function collectPlanningVisualizationSets(consolidatedOutputs = {}) {
  const methodVisualization = safeObject(consolidatedOutputs.methodPlanning?.preferredPlan?.visualization);
  const supportVisualization = safeObject(consolidatedOutputs.supportPlanning?.preferredPlan?.visualization);

  return [
    {
      moduleKey: 'enemy-threat-analysis',
      moduleLabel: '敌情威胁自动分析',
      visualization: safeObject(consolidatedOutputs.threatAnalysis?.visualization),
    },
    {
      moduleKey: 'airborne-landing-site-selection',
      moduleLabel: '机降地域优化选择',
      visualization: safeObject(consolidatedOutputs.airborneLandingSiteSelection?.visualization),
    },
    {
      moduleKey: 'method-planning',
      moduleLabel: '作战方法自动规划',
      visualization: methodVisualization,
    },
    {
      moduleKey: 'support-planning',
      moduleLabel: '作战保障自动规划',
      visualization: supportVisualization,
    },
  ].filter((item) => safeArray(item.visualization.entities).length || safeArray(item.visualization.environment).length);
}

function buildPlanningSpatialExportData(result = {}) {
  const consolidatedOutputs = safeObject(result.consolidatedOutputs);
  const featureSets = collectPlanningVisualizationSets(consolidatedOutputs);
  const features = featureSets.flatMap((item) => ([
    ...safeArray(item.visualization.entities).map((entity) => buildPlanningGeojsonFromEntity(item.moduleKey, item.moduleLabel, entity)),
    ...safeArray(item.visualization.environment).map((overlay) => buildPlanningGeojsonFromEnvironmentOverlay(item.moduleKey, item.moduleLabel, overlay)),
  ])).filter(Boolean);
  features.push(...buildPlanningGeojsonFromThreatField(
    'enemy-threat-analysis',
    '敌情威胁自动分析',
    safeObject(consolidatedOutputs.threatAnalysis?.heatmapGeojson),
  ));

  return {
    type: 'FeatureCollection',
    features,
    metadata: {
      moduleCount: featureSets.length,
      featureCount: features.length,
    },
  };
}

function escapeCsvCell(value = '') {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildPlanningComparisonRows(result = {}) {
  const consolidatedOutputs = safeObject(result.consolidatedOutputs);
  const rows = [];
  const threatOutput = safeObject(consolidatedOutputs.threatAnalysis);
  const groupingOutput = safeObject(consolidatedOutputs.forceGrouping);
  const allocationOutput = safeObject(consolidatedOutputs.targetAllocation);
  const landingOutput = safeObject(consolidatedOutputs.airborneLandingSiteSelection);
  const methodOutput = safeObject(consolidatedOutputs.methodPlanning);
  const supportOutput = safeObject(consolidatedOutputs.supportPlanning);

  if (threatOutput.threatLevel) {
    rows.push({
      module: '敌情威胁自动分析',
      methodKey: threatOutput.builtinMethodKey || '',
      methodLabel: threatOutput.builtinMethodLabel || '',
      score: threatOutput.threatScore || 0,
      recommended: 'yes',
      metricA: `威胁等级:${threatOutput.threatLevel}`,
      metricB: `关键节点:${threatOutput.identifiedThreatNodeCount || 0}`,
      metricC: `火力覆盖:${safeArray(threatOutput.fireCoverage).length}`,
      note: safeArray(threatOutput.enemyIntentions).map((item) => item.name).slice(0, 2).join(' / ') || '敌情态势综合分析结果',
    });
  }

  safeArray(groupingOutput.comparison).forEach((item) => {
    rows.push({
      module: '作战力量智能编组',
      methodKey: item.methodKey,
      methodLabel: item.methodLabel,
      score: item.score,
      recommended: groupingOutput.preferredSchemeId === item.schemeId ? 'yes' : 'no',
      metricA: `群组:${item.actualGroupCount}`,
      metricB: `火力:${item.firepower}`,
      metricC: `约束:${item.constraintScore || 0}`,
      note: item.optimizationNote || item.advantage || item.tradeoff || '',
    });
  });

  safeArray(allocationOutput.comparedPlans).forEach((item) => {
    rows.push({
      module: '作战目标自动分配',
      methodKey: item.methodKey,
      methodLabel: item.methodLabel,
      score: item.score,
      recommended: allocationOutput.preferredPlan?.methodKey === item.methodKey ? 'yes' : 'no',
      metricA: `已分配:${item.stats?.assignedTargetCount || 0}`,
      metricB: `待分配:${item.stats?.backlogTargetCount || 0}`,
      metricC: `覆盖率:${item.stats?.coverRate || 0}%`,
      note: '多目标分配方案对比',
    });
  });

  safeArray(landingOutput.methodComparison).forEach((item) => {
    rows.push({
      module: '机降地域优化选择',
      methodKey: item.methodKey,
      methodLabel: item.methodLabel,
      score: item.score,
      recommended: landingOutput.preferredCandidateId && landingOutput.builtinMethodKey === item.methodKey ? 'yes' : 'no',
      metricA: `最佳点位:${item.bestCandidateName}`,
      metricB: `平均分:${item.averageScore}`,
      metricC: `可用点:${item.qualifiedCount}`,
      note: '候选机降地域比选结果',
    });
  });

  safeArray(methodOutput.comparedPlans).forEach((item) => {
    rows.push({
      module: '作战方法自动规划',
      methodKey: item.methodKey,
      methodLabel: item.methodLabel,
      score: item.score,
      recommended: methodOutput.preferredPlanMethodKey === item.methodKey ? 'yes' : 'no',
      metricA: `航路:${item.routeCount}`,
      metricB: `总航程:${item.totalDistanceKm}km`,
      metricC: `威胁:${item.averageThreatScore}`,
      note: `预计完成:${item.estimatedCompletionMin}min`,
    });
  });

  safeArray(supportOutput.comparedPlans).forEach((item) => {
    rows.push({
      module: '作战保障自动规划',
      methodKey: item.methodKey,
      methodLabel: item.methodLabel,
      score: item.score,
      recommended: supportOutput.preferredPlanMethodKey === item.methodKey ? 'yes' : 'no',
      metricA: `覆盖率:${item.coverageRate}%`,
      metricB: `缺口:${item.gapCount}`,
      metricC: `预备:${item.reserveRatio}%`,
      note: `关键缺口:${item.criticalGapCount} / 瓶颈:${item.bottleneckCount || 0}`,
    });
  });

  return rows;
}

function buildPlanningComparisonCsv(rows = []) {
  const headers = ['module', 'methodKey', 'methodLabel', 'score', 'recommended', 'metricA', 'metricB', 'metricC', 'note'];
  return [
    headers.join(','),
    ...safeArray(rows).map((row) => headers.map((key) => escapeCsvCell(row[key])).join(',')),
  ].join('\n');
}

function buildPlanningReportHtml(response = {}) {
  const task = safeObject(response.task);
  const execution = safeObject(response.execution);
  const result = safeObject(response.result);
  const diagnostics = safeObject(response.diagnostics);
  const deliverableRows = safeArray(result.deliverables).map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.sourceStep || '--')}</td>
      <td>${escapeHtml(item.sourceAlgorithm || '--')}</td>
      <td>${escapeHtml(item.description || '--')}</td>
    </tr>
  `).join('');
  const stepSections = safeArray(execution.steps).map((step) => `
    <section class="card">
      <h3>${escapeHtml(step.stepName)}</h3>
      <p class="muted">${escapeHtml(step.algorithm?.name || '')} / ${escapeHtml(step.binding?.label || '')}</p>
      <p>${escapeHtml(step.summary || '--')}</p>
      <ul>
        ${safeArray(step.outputPreview).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </section>
  `).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(response.assessmentName || result.title || '智能任务规划报告')}</title>
  <style>
    body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; margin: 32px; color: #0f172a; background: #f8fafc; }
    h1, h2, h3 { margin: 0 0 12px; }
    h1 { font-size: 28px; }
    h2 { font-size: 20px; margin-top: 28px; }
    h3 { font-size: 16px; }
    p, li, td, th { font-size: 14px; line-height: 1.6; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0; }
    .card { background: #ffffff; border: 1px solid #dbe4ee; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04); }
    .muted { color: #64748b; }
    table { width: 100%; border-collapse: collapse; background: #ffffff; }
    th, td { border: 1px solid #dbe4ee; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { background: #e2e8f0; }
    ul { margin: 8px 0 0; padding-left: 20px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(response.assessmentName || result.title || '智能任务规划报告')}</h1>
  <p>${escapeHtml(result.summary || '--')}</p>

  <section class="meta">
    <div class="card">
      <strong>任务模板</strong>
      <p>${escapeHtml(task.name || '--')}</p>
    </div>
    <div class="card">
      <strong>生成时间</strong>
      <p>${escapeHtml(String(response.generatedAt || '').replace('T', ' ').slice(0, 19) || '--')}</p>
    </div>
    <div class="card">
      <strong>执行步骤</strong>
      <p>${escapeHtml(execution.summary?.completedSteps || 0)} / ${escapeHtml(task.stepCount || 0)}</p>
    </div>
    <div class="card">
      <strong>导出策略</strong>
      <p>1 个主存储 + 3 类导出</p>
    </div>
  </section>

  <section class="card">
    <h2>交付物</h2>
    <table>
      <thead>
        <tr>
          <th>交付物</th>
          <th>状态</th>
          <th>来源步骤</th>
          <th>来源算法</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>${deliverableRows}</tbody>
    </table>
  </section>

  <section class="card">
    <h2>执行步骤</h2>
    ${stepSections}
  </section>

  <section class="card">
    <h2>诊断信息</h2>
    <ul>
      <li>上传文件数：${escapeHtml(diagnostics.uploadedFileCount || 0)}</li>
      <li>选中数据源数：${escapeHtml(diagnostics.selectedSourceCount || 0)}</li>
      <li>产出工件数：${escapeHtml(diagnostics.producedArtifactCount || 0)}</li>
      <li>流程完整度：${escapeHtml(diagnostics.sequenceIntegrity || 0)}</li>
    </ul>
  </section>
</body>
</html>`;
}

function buildPlanningOutputPackages(response = {}) {
  const result = safeObject(response.result);
  const baseName = buildPlanningExportBaseName(response.assessmentName, response.task?.name, response.generatedAt);
  const storageSnapshot = cloneData(response);
  const spatialData = buildPlanningSpatialExportData(result);
  const comparisonRows = buildPlanningComparisonRows(result);
  const comparisonCsv = buildPlanningComparisonCsv(comparisonRows);
  const reportHtml = buildPlanningReportHtml(response);
  const packages = {
    storageSnapshot: createOutputPackage({
      key: 'storageSnapshot',
      label: '结构化结果快照',
      description: '用于主存储的完整 JSON 快照，可在后续回放、复算或归档时直接复用。',
      format: 'json',
      fileName: `${baseName}-snapshot.json`,
      mimeType: 'application/json',
      data: storageSnapshot,
      meta: {
        storageMode: 'browser-local',
        stepCount: safeArray(response.execution?.steps).length,
      },
    }),
    reportExport: createOutputPackage({
      key: 'reportExport',
      label: '规划报告',
      description: '面向汇报和归档的 HTML 报告，包含摘要、交付物和执行步骤说明。',
      format: 'html',
      fileName: `${baseName}-report.html`,
      mimeType: 'text/html;charset=utf-8',
      content: reportHtml,
      meta: {
        deliverableCount: safeArray(result.deliverables).length,
      },
    }),
    spatialExport: createOutputPackage({
      key: 'spatialExport',
      label: '空间结果包',
      description: '汇总三维球标注、热区、路线和保障节点的 GeoJSON 空间结果包。',
      format: 'geojson',
      fileName: `${baseName}-spatial.geojson`,
      mimeType: 'application/geo+json',
      data: spatialData,
      meta: spatialData.metadata,
    }),
    comparisonExport: createOutputPackage({
      key: 'comparisonExport',
      label: '方案比选表',
      description: '汇总威胁分析、编组、分配、选址、战法和保障等结果的 CSV 比选表。',
      format: 'csv',
      fileName: `${baseName}-comparison.csv`,
      mimeType: 'text/csv;charset=utf-8',
      content: comparisonCsv,
      meta: {
        rowCount: comparisonRows.length,
      },
    }),
  };
  return packages;
}

function buildFinalResult(task, executionSteps = []) {
  const stepOutputs = Object.fromEntries(executionSteps.map((item) => [item.stepId, cloneData(item.structuredOutput)]));
  const algorithmOutputs = Object.fromEntries(executionSteps.map((item) => [item.algorithm.id, cloneData(item.structuredOutput)]));
  const implementedCount = executionSteps.filter((item) => item.structuredOutput?.implementationStatus === 'implemented').length;
  const placeholderCount = executionSteps.filter((item) => item.structuredOutput?.implementationStatus !== 'implemented').length;
  return {
    title: `${task.name}规划结果`,
    summary: `已完成 ${executionSteps.length} 个规划步骤，其中 ${implementedCount} 个步骤输出结构化结果，${placeholderCount} 个步骤仍为占位执行器。`,
    deliverables: buildDeliverables(task, executionSteps),
    nextStepNotice: placeholderCount
      ? '下一步可继续补充仍为占位执行器的任务步骤输入输出要求，以替换当前占位实现。'
      : '当前任务流程中的全部步骤均已进入结构化结果输出阶段。',
    consolidatedOutputs: {
      threatAnalysis: stepOutputs['step-threat-analysis'] || algorithmOutputs['enemy-threat-analysis'] || {},
      forceGrouping: stepOutputs['step-force-grouping'] || algorithmOutputs['force-grouping'] || {},
      targetAllocation: stepOutputs['step-target-allocation'] || algorithmOutputs['target-allocation'] || {},
      airborneLandingSiteSelection: stepOutputs['step-airborne-landing-site-selection'] || algorithmOutputs['airborne-landing-site-selection'] || {},
      methodPlanning: stepOutputs['step-method-planning'] || algorithmOutputs['method-planning'] || {},
      supportPlanning: stepOutputs['step-support-planning'] || algorithmOutputs['support-planning'] || {},
    },
  };
}

export const __planningRuntimeTestHooks = {
  buildSupportPlan,
  normalizeSupportPlanningOptions,
};

export function getPlanningTemplate() {
  return buildPlanningTemplate();
}

export async function testPlanningLlm(payload = {}) {
  try {
    const runtimeOptions = {
      ...safeObject(payload.runtimeOptions),
      ...safeObject(payload.options),
    };
    const llmOptions = normalizeLlmRuntimeOptions(runtimeOptions);
    if (!llmOptions.model) {
      throw createPlanningRuntimeError({
        code: 'PLANNING_MISSING_DATA',
        type: 'missing_data',
        status: 400,
        message: '请填写模型名称。',
      });
    }

    const result = llmOptions.backend === 'ollama'
      ? await testOllamaLlm(llmOptions)
      : await testOpenAiCompatibleLlm(llmOptions);
    return {
      ...result,
      testedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw normalizePlanningRuntimeError(error, '大模型配置测试失败。');
  }
}

export async function validatePlanning(payload = {}, { db } = {}) {
  try {
    const template = buildPlanningTemplate();
    const task = selectTask(template, payload.taskId, payload.taskDefinition);
    if (!task) {
      throw createPlanningRuntimeError({
        code: 'PLANNING_MISSING_DATA',
        type: 'missing_data',
        status: 400,
        message: '未找到可执行的规划任务。',
      });
    }

    const sortedSteps = [...safeArray(task.steps)].sort((left, right) => left.order - right.order);
    if (!sortedSteps.length) {
      throw createPlanningRuntimeError({
        code: 'PLANNING_MISSING_DATA',
        type: 'missing_data',
        status: 400,
        message: '规划任务至少需要包含一个可执行步骤。',
        details: {
          taskId: task.id,
          taskName: task.name,
        },
      });
    }

    const dataset = loadPlanningDataset(db);
    const algorithmMap = buildAlgorithmMap(template.algorithms);
    const bindings = safeObject(payload.bindings);
    const algorithmInputs = normalizeAlgorithmInputs(template, payload);
    const normalizedBindings = {};
    const completedAlgorithms = new Set();
    const checks = [];

    for (const step of sortedSteps) {
      const algorithm = algorithmMap.get(step.algorithmId);
      if (!algorithm) {
        throw createPlanningRuntimeError({
          code: 'PLANNING_MISSING_DATA',
          type: 'missing_data',
          status: 400,
          message: `任务步骤 ${step.name} 引用了不存在的算法 ${step.algorithmId}。`,
          details: {
            taskId: task.id,
            taskName: task.name,
            stepId: step.id,
            stepName: step.name,
            algorithmId: step.algorithmId,
          },
        });
      }

      const variant = resolveBindingVariant(step, algorithm, task, bindings);
      if (!variant) {
        throw createPlanningRuntimeError({
          code: 'PLANNING_MISSING_DATA',
          type: 'missing_data',
          status: 400,
          message: `任务步骤 ${step.name} 未找到可用算法实现。`,
          details: {
            taskId: task.id,
            taskName: task.name,
            stepId: step.id,
            stepName: step.name,
            algorithmId: algorithm.id,
          },
        });
      }

      if (variant.status !== 'active') {
        throw createPlanningRuntimeError({
          code: 'PLANNING_MISSING_DATA',
          type: 'missing_data',
          status: 400,
          message: `${step.name} 选择的算法实现 ${variant.name} 当前仅为预留扩展位。`,
          details: {
            taskId: task.id,
            taskName: task.name,
            stepId: step.id,
            stepName: step.name,
            algorithmId: algorithm.id,
            bindingId: variant.id,
          },
        });
      }

      const missingUpstreamAlgorithms = resolveRequiredUpstreamAlgorithms(algorithm.id, task)
        .filter((item) => !completedAlgorithms.has(item));
      if (missingUpstreamAlgorithms.length) {
        throw createPlanningRuntimeError({
          code: 'PLANNING_MISSING_UPSTREAM',
          type: 'missing_upstream',
          status: 400,
          message: `${step.name} 缺少上游步骤产物，请先完成：${missingUpstreamAlgorithms.join(' / ')}。`,
          details: {
            taskId: task.id,
            taskName: task.name,
            stepId: step.id,
            stepName: step.name,
            algorithmId: algorithm.id,
            missingUpstreamAlgorithms,
          },
        });
      }

      const algorithmInput = algorithmInputs[algorithm.id] || normalizeAlgorithmInput(algorithm);
      if (algorithm.id === 'support-planning') {
        assertSupportPlanningInputCompleteness(step, algorithmInput.options);
      }

      normalizedBindings[step.id] = variant.id;
      completedAlgorithms.add(algorithm.id);
      checks.push({
        stepId: step.id,
        stepName: step.name,
        algorithmId: algorithm.id,
        bindingId: variant.id,
        bindingType: variant.type,
      });
    }

    if (sortedSteps.some((step) => step.algorithmId === 'enemy-threat-analysis')) {
      const threatInput = algorithmInputs['enemy-threat-analysis'] || {};
      const selectedSourceIds = uniqueNumberList(threatInput.selectedSourceIds);
      const uploadedFiles = safeArray(threatInput.uploadedFiles);

      if (!selectedSourceIds.length && !uploadedFiles.length) {
        throw createPlanningRuntimeError({
          code: 'PLANNING_MISSING_DATA',
          type: 'missing_data',
          status: 400,
          message: '敌情威胁分析缺少可用输入，请至少勾选一个资源库数据源或上传本地文件。',
          details: {
            algorithmId: 'enemy-threat-analysis',
            requiredInput: ['resource-library', 'local-file'],
          },
        });
      }
    }

    return {
      ok: true,
      task: {
        id: task.id,
        name: task.name,
        category: task.category,
        stepCount: sortedSteps.length,
      },
      summary: {
        checkedSteps: checks.length,
        activeBindings: checks.length,
        datasetSourceCount: safeArray(dataset.sources).length,
      },
      checks,
      normalizedPayload: {
        ...cloneData(payload),
        assessmentName: String(payload.assessmentName || `${task.name}规划任务`),
        taskDefinition: cloneData(task),
        bindings: cloneData(normalizedBindings),
        algorithmInputs: cloneData(algorithmInputs),
      },
      template,
      taskDefinition: task,
      dataset,
    };
  } catch (error) {
    throw normalizePlanningRuntimeError(error, '规划前置校验失败。');
  }
}

export async function evaluatePlanning(payload = {}, { db, events, signal } = {}) {
  const validation = await validatePlanning(payload, { db });
  throwIfPlanningAborted(signal, { taskId: payload.taskId || payload.taskCenterId || null });
  const normalizedPayload = validation.normalizedPayload || payload;
  const task = validation.taskDefinition || selectTask(validation.template, normalizedPayload.taskId, normalizedPayload.taskDefinition);
  const template = validation.template || buildPlanningTemplate();
  const dataset = validation.dataset || loadPlanningDataset(db);

  try {
    const execution = await executeTaskPlanning(task, template, normalizedPayload, dataset, { db, events, signal });
    const builtinSteps = execution.steps.filter((item) => item.binding.type === 'builtin').length;
    const externalSteps = execution.steps.filter((item) => item.binding.type === 'external-model').length;
    const implementedSteps = execution.steps.filter((item) => item.structuredOutput?.implementationStatus === 'implemented').length;
    const placeholderSteps = execution.steps.filter((item) => item.structuredOutput?.implementationStatus !== 'implemented').length;
    const uploadedFileCount = Object.values(execution.algorithmInputs).reduce(
      (total, item) => total + safeArray(item?.uploadedFiles).length,
      0,
    );

    const response = {
      assessmentName: String(normalizedPayload.assessmentName || `${task.name}规划任务`),
      module: 'intelligent-task-planning',
      generatedAt: new Date().toISOString(),
      task: {
        id: task.id,
        name: task.name,
        category: task.category,
        stepCount: safeArray(task.steps).length,
        finalDeliverableCount: safeArray(task.finalDeliverables).length,
      },
      execution: {
        summary: {
          completedSteps: execution.steps.length,
          builtinSteps,
          externalSteps,
          implementedSteps,
          placeholderSteps,
        },
        steps: execution.steps,
      },
      result: buildFinalResult(task, execution.steps),
      diagnostics: {
        uploadedFileCount,
        selectedSourceCount: uniqueNumberList(Object.values(execution.algorithmInputs).flatMap((item) => safeArray(item.selectedSourceIds))).length,
        producedArtifactCount: execution.steps.reduce((total, item) => total + safeArray(item.artifacts).length, 0),
        placeholderSteps,
        sequenceIntegrity: round(execution.steps.length / Math.max(safeArray(task.steps).length, 1), 4),
      },
    };

    return {
      ...response,
      result: {
        ...response.result,
        outputPackages: buildPlanningOutputPackages(response),
      },
    };
  } catch (error) {
    throw normalizePlanningRuntimeError(error, '智能任务规划计算失败。');
  }
}

