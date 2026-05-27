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

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safePositive(value, fallback = 1) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) {
    return fallback;
  }
  return next;
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function buildEngineCatalog() {
  return buildStandardEngineCatalog({
    moduleKey: 'action-calculation',
    builtin: {
      key: 'builtin',
      type: 'builtin',
      runtime: 'node',
      version: String(process.env.ACTION_BUILTIN_VERSION || '1.0.0'),
      label: '内置行动计算引擎',
      description: '基于任务功能链、环境因子和节点调整系数执行行动预测与方案优化。',
      legacyKeys: ['builtin'],
    },
    externals: [
      {
        key: 'python-service',
        type: 'external-model',
        runtime: 'python',
        endpointEnv: 'ACTION_PYTHON_URL',
        versionEnv: 'ACTION_PYTHON_VERSION',
        label: 'Python 模型服务',
        activeDescription: '已通过 ACTION_PYTHON_URL 配置外部 Python 行动模型服务。',
        plannedDescription: '预留 Python 行动模型服务接入位，可通过 ACTION_PYTHON_URL 指向外部服务。',
        legacyKeys: ['python-service', 'python'],
      },
      {
        key: 'cpp-service',
        type: 'external-model',
        runtime: 'cpp',
        endpointEnv: 'ACTION_CPP_URL',
        versionEnv: 'ACTION_CPP_VERSION',
        label: 'C++ 高性能服务',
        activeDescription: '已通过 ACTION_CPP_URL 配置外部 C++ 行动模型服务。',
        plannedDescription: '预留 C++ 行动模型服务接入位，可通过 ACTION_CPP_URL 指向外部服务。',
        legacyKeys: ['cpp-service', 'cpp'],
      },
    ],
  });
}

const OBJECTIVE_CATALOG = [
  {
    key: 'balanced',
    label: '综合均衡',
    description: '兼顾任务时间、资源消耗、路径距离与风险暴露。',
  },
  {
    key: 'time',
    label: '时间优先',
    description: '优先缩短行动链总耗时。',
  },
  {
    key: 'resource',
    label: '资源优先',
    description: '优先降低燃油、弹药和保障资源消耗。',
  },
  {
    key: 'path',
    label: '路径优先',
    description: '优先压缩总路径长度与暴露距离。',
  },
];

const RESOURCE_META = {
  attackHelicopters: { label: '攻击直升机', mode: 'platform', weight: 10 },
  transportHelicopters: { label: '运输直升机', mode: 'platform', weight: 10 },
  escortHelicopters: { label: '掩护直升机', mode: 'platform', weight: 8 },
  reconHelicopters: { label: '侦察直升机', mode: 'platform', weight: 7 },
  commandSeats: { label: '指挥席位', mode: 'platform', weight: 4 },
  medicalTeams: { label: '卫勤分组', mode: 'platform', weight: 4 },
  troops: { label: '突击兵力', mode: 'payload', weight: 7 },
  rockets: { label: '火箭弹', mode: 'consumable', weight: 3 },
  missiles: { label: '导弹', mode: 'consumable', weight: 4 },
  fuel: { label: '航油', mode: 'consumable', weight: 2 },
};

function gradeByScore(score) {
  if (score >= 90) return '优';
  if (score >= 80) return '良';
  if (score >= 70) return '中';
  if (score >= 60) return '可';
  return '低';
}

function buildHelicopterFireStrikeTask() {
  const nodes = [
    {
      id: 'strike-intel',
      code: 'A1',
      name: '情报装订',
      inputs: ['任务命令', '目标区域坐标', '敌情摘要'],
      outputs: ['目标坐标包', '威胁分布图'],
      constraints: ['情报时效不超过 15 分钟', '必须完成目标识别确认'],
      resourceRequirements: {
        reconHelicopters: 1,
        commandSeats: 2,
        fuel: 180,
      },
      model: {
        baseDuration: 14,
        baseDistance: 26,
        weatherImpact: 0.14,
        threatImpact: 0.1,
        terrainImpact: 0.08,
        coordinationImpact: 0.16,
      },
    },
    {
      id: 'strike-assembly',
      code: 'A2',
      name: '编队集结',
      inputs: ['目标坐标包', '威胁分布图'],
      outputs: ['起飞编队', '火力编组'],
      constraints: ['起飞窗口不超过 10 分钟', '机组状态达到出动标准'],
      resourceRequirements: {
        attackHelicopters: 6,
        escortHelicopters: 2,
        commandSeats: 4,
        fuel: 420,
      },
      model: {
        baseDuration: 18,
        baseDistance: 42,
        weatherImpact: 0.12,
        threatImpact: 0.08,
        terrainImpact: 0.06,
        coordinationImpact: 0.18,
      },
    },
    {
      id: 'strike-ingress',
      code: 'A3',
      name: '低空突防',
      inputs: ['起飞编队', '火力编组'],
      outputs: ['攻击阵位', '航线通报'],
      constraints: ['保持低空隐蔽飞行', '规避已知防空火力区'],
      resourceRequirements: {
        attackHelicopters: 6,
        escortHelicopters: 2,
        fuel: 680,
      },
      model: {
        baseDuration: 24,
        baseDistance: 86,
        weatherImpact: 0.18,
        threatImpact: 0.2,
        terrainImpact: 0.12,
        coordinationImpact: 0.14,
      },
    },
    {
      id: 'strike-engagement',
      code: 'A4',
      name: '火力打击',
      inputs: ['攻击阵位', '航线通报'],
      outputs: ['打击效果', '战场回报'],
      constraints: ['火力释放不超时', '必须完成主要目标压制'],
      resourceRequirements: {
        attackHelicopters: 6,
        escortHelicopters: 2,
        rockets: 72,
        missiles: 18,
        fuel: 520,
      },
      model: {
        baseDuration: 16,
        baseDistance: 34,
        weatherImpact: 0.08,
        threatImpact: 0.22,
        terrainImpact: 0.04,
        coordinationImpact: 0.16,
      },
    },
    {
      id: 'strike-egress',
      code: 'A5',
      name: '脱离评估',
      inputs: ['打击效果', '战场回报'],
      outputs: ['撤出编队', '战果评估'],
      constraints: ['撤离航线必须避开高威胁区', '完成战果回报闭环'],
      resourceRequirements: {
        attackHelicopters: 6,
        escortHelicopters: 2,
        reconHelicopters: 1,
        fuel: 610,
      },
      model: {
        baseDuration: 20,
        baseDistance: 74,
        weatherImpact: 0.14,
        threatImpact: 0.18,
        terrainImpact: 0.1,
        coordinationImpact: 0.12,
      },
    },
  ];

  return {
    id: 'helicopter-fire-strike',
    name: '直升机编队火力打击',
    description: '围绕目标装订、低空突防、火力释放和脱离评估构建典型火力打击行动链。',
    category: '火力打击',
    initialInputs: ['任务命令', '目标区域坐标', '敌情摘要'],
    links: nodes.slice(0, -1).map((node, index) => ({
      id: `L${index + 1}`,
      from: node.id,
      to: nodes[index + 1].id,
      type: 'sequential',
      label: '顺序衔接',
    })),
    nodes,
    defaultSchemes: [
      {
        id: 'strike-standard',
        name: '标准突击方案',
        description: '按标准编组执行突防与火力释放，兼顾效率与稳健性。',
        availableResources: {
          attackHelicopters: 6,
          escortHelicopters: 2,
          reconHelicopters: 1,
          commandSeats: 4,
          rockets: 96,
          missiles: 24,
          fuel: 3400,
        },
        environment: {
          weather: 1,
          threat: 1,
          terrain: 1,
          coordination: 1.05,
        },
      },
      {
        id: 'strike-rapid',
        name: '快速压制方案',
        description: '强化攻击编队节奏，以更短时间完成火力打击。',
        availableResources: {
          attackHelicopters: 8,
          escortHelicopters: 2,
          reconHelicopters: 1,
          commandSeats: 5,
          rockets: 120,
          missiles: 28,
          fuel: 3900,
        },
        environment: {
          weather: 1.02,
          threat: 1.08,
          terrain: 1,
          coordination: 1.12,
        },
      },
      {
        id: 'strike-low-risk',
        name: '低风险迂回方案',
        description: '通过迂回航线降低风险暴露，换取更高安全裕度。',
        availableResources: {
          attackHelicopters: 6,
          escortHelicopters: 3,
          reconHelicopters: 2,
          commandSeats: 4,
          rockets: 84,
          missiles: 20,
          fuel: 4100,
        },
        environment: {
          weather: 1,
          threat: 0.92,
          terrain: 1.06,
          coordination: 1.02,
        },
      },
    ],
  };
}

function buildHelicopterAirAssaultTask() {
  const nodes = [
    {
      id: 'assault-prep',
      code: 'B1',
      name: '情报准备',
      inputs: ['任务命令', '着陆场坐标', '敌情摘要'],
      outputs: ['着陆场判定', '敌防部署'],
      constraints: ['着陆场障碍信息完整', '突击窗口已确认'],
      resourceRequirements: {
        reconHelicopters: 1,
        commandSeats: 2,
        fuel: 160,
      },
      model: {
        baseDuration: 16,
        baseDistance: 24,
        weatherImpact: 0.14,
        threatImpact: 0.1,
        terrainImpact: 0.12,
        coordinationImpact: 0.16,
      },
    },
    {
      id: 'assault-launch',
      code: 'B2',
      name: '起飞集结',
      inputs: ['着陆场判定', '敌防部署'],
      outputs: ['突击编队', '装载完成'],
      constraints: ['装载时间控制在 12 分钟内', '起飞梯次保持安全间隔'],
      resourceRequirements: {
        transportHelicopters: 6,
        escortHelicopters: 2,
        troops: 96,
        commandSeats: 4,
        fuel: 460,
      },
      model: {
        baseDuration: 20,
        baseDistance: 40,
        weatherImpact: 0.14,
        threatImpact: 0.08,
        terrainImpact: 0.08,
        coordinationImpact: 0.2,
      },
    },
    {
      id: 'assault-ingress',
      code: 'B3',
      name: '低空突入',
      inputs: ['突击编队', '装载完成'],
      outputs: ['着陆窗口', '突入航迹'],
      constraints: ['避开主防空方向', '保持编队通信可用'],
      resourceRequirements: {
        transportHelicopters: 6,
        escortHelicopters: 2,
        troops: 96,
        fuel: 760,
      },
      model: {
        baseDuration: 26,
        baseDistance: 92,
        weatherImpact: 0.18,
        threatImpact: 0.22,
        terrainImpact: 0.14,
        coordinationImpact: 0.14,
      },
    },
    {
      id: 'assault-insert',
      code: 'B4',
      name: '机降突击',
      inputs: ['着陆窗口', '突入航迹'],
      outputs: ['地面突击分队', '着陆场控制'],
      constraints: ['机降不超过 8 分钟', '首波突击必须完成着陆场压制'],
      resourceRequirements: {
        transportHelicopters: 6,
        escortHelicopters: 2,
        troops: 96,
        rockets: 24,
        fuel: 420,
      },
      model: {
        baseDuration: 18,
        baseDistance: 28,
        weatherImpact: 0.1,
        threatImpact: 0.24,
        terrainImpact: 0.08,
        coordinationImpact: 0.18,
      },
    },
    {
      id: 'assault-support',
      code: 'B5',
      name: '接应撤收',
      inputs: ['地面突击分队', '着陆场控制'],
      outputs: ['撤收通道', '行动闭环'],
      constraints: ['留空直升机保持应急接应能力', '撤收航线需具备备份路径'],
      resourceRequirements: {
        transportHelicopters: 4,
        escortHelicopters: 2,
        medicalTeams: 1,
        fuel: 540,
      },
      model: {
        baseDuration: 22,
        baseDistance: 68,
        weatherImpact: 0.16,
        threatImpact: 0.18,
        terrainImpact: 0.12,
        coordinationImpact: 0.14,
      },
    },
  ];

  return {
    id: 'helicopter-air-assault',
    name: '直升机编队机降突击',
    description: '围绕着陆场判定、低空突入、机降突击和接应撤收构建机降突击行动链。',
    category: '机降突击',
    initialInputs: ['任务命令', '着陆场坐标', '敌情摘要'],
    links: nodes.slice(0, -1).map((node, index) => ({
      id: `L${index + 1}`,
      from: node.id,
      to: nodes[index + 1].id,
      type: 'sequential',
      label: '顺序衔接',
    })),
    nodes,
    defaultSchemes: [
      {
        id: 'assault-standard',
        name: '标准机降方案',
        description: '按常规编组组织机降与接应撤收。',
        availableResources: {
          transportHelicopters: 6,
          escortHelicopters: 2,
          reconHelicopters: 1,
          commandSeats: 4,
          medicalTeams: 1,
          troops: 96,
          rockets: 36,
          fuel: 3200,
        },
        environment: {
          weather: 1,
          threat: 1,
          terrain: 1,
          coordination: 1.04,
        },
      },
      {
        id: 'assault-rapid',
        name: '快速夺控方案',
        description: '强化起飞集结与机降节奏，优先缩短夺控时间。',
        availableResources: {
          transportHelicopters: 7,
          escortHelicopters: 3,
          reconHelicopters: 1,
          commandSeats: 5,
          medicalTeams: 1,
          troops: 112,
          rockets: 48,
          fuel: 3600,
        },
        environment: {
          weather: 1.02,
          threat: 1.06,
          terrain: 1,
          coordination: 1.1,
        },
      },
      {
        id: 'assault-sustain',
        name: '稳健保障方案',
        description: '增配接应与卫勤资源，提升持续支撑能力。',
        availableResources: {
          transportHelicopters: 6,
          escortHelicopters: 3,
          reconHelicopters: 2,
          commandSeats: 4,
          medicalTeams: 2,
          troops: 96,
          rockets: 32,
          fuel: 3800,
        },
        environment: {
          weather: 1,
          threat: 0.95,
          terrain: 1.04,
          coordination: 1.06,
        },
      },
    ],
  };
}

function buildActionTasks() {
  return [
    buildHelicopterFireStrikeTask(),
    buildHelicopterAirAssaultTask(),
  ];
}

function buildActionTemplate() {
  const tasks = buildActionTasks();
  const engines = buildEngineCatalog();

  return {
    version: '1.0.0',
    module: 'action-calculation',
    title: '作战行动计算子模块',
    description: '围绕直升机编队火力打击、机降突击等典型任务构建功能链、执行预测与优化推荐。',
    objectives: cloneData(OBJECTIVE_CATALOG),
    engines: cloneData(engines),
    tasks,
    summary: {
      taskCount: tasks.length,
      nodeCount: tasks.reduce((total, task) => total + safeArray(task.nodes).length, 0),
      linkCount: tasks.reduce((total, task) => total + safeArray(task.links).length, 0),
      schemeCount: tasks.reduce((total, task) => total + safeArray(task.defaultSchemes).length, 0),
    },
  };
}

function buildNodeMap(nodes) {
  return new Map(safeArray(nodes).map((node) => [String(node.id), node]));
}

function topologicalSort(nodes, links) {
  const nodeMap = buildNodeMap(nodes);
  const indegree = new Map();
  const adjacency = new Map();

  for (const node of safeArray(nodes)) {
    indegree.set(String(node.id), 0);
    adjacency.set(String(node.id), []);
  }

  const issues = [];
  for (const link of safeArray(links)) {
    const from = String(link.from || '');
    const to = String(link.to || '');
    if (!nodeMap.has(from) || !nodeMap.has(to)) {
      issues.push(`链路 ${link.id || `${from}-${to}`} 引用了不存在的节点。`);
      continue;
    }
    if (from === to) {
      issues.push(`节点 ${from} 存在自环链路。`);
      continue;
    }

    adjacency.get(from).push(to);
    indegree.set(to, (indegree.get(to) || 0) + 1);
  }

  const queue = safeArray(nodes)
    .filter((node) => (indegree.get(String(node.id)) || 0) === 0)
    .map((node) => String(node.id));
  const order = [];

  while (queue.length) {
    const currentId = queue.shift();
    order.push(nodeMap.get(currentId));

    for (const nextId of adjacency.get(currentId) || []) {
      indegree.set(nextId, (indegree.get(nextId) || 0) - 1);
      if ((indegree.get(nextId) || 0) === 0) {
        queue.push(nextId);
      }
    }
  }

  if (order.length !== safeArray(nodes).length) {
    issues.push('功能链存在环路或孤立节点，已按默认节点顺序处理。');
    return {
      order: safeArray(nodes),
      issues,
    };
  }

  return {
    order,
    issues,
  };
}

function normalizeResources(resourceMap = {}) {
  const normalized = {};
  for (const key of Object.keys(RESOURCE_META)) {
    normalized[key] = Math.max(Number(resourceMap[key]) || 0, 0);
  }
  return normalized;
}

function ensureNodeAdjustments(nodes, source = {}) {
  const adjustments = {};
  for (const node of safeArray(nodes)) {
    const current = source?.[node.id] || {};
    adjustments[node.id] = {
      tempo: safePositive(current.tempo, 1),
      resource: safePositive(current.resource, 1),
      path: safePositive(current.path, 1),
    };
  }
  return adjustments;
}

function normalizeScheme(task, scheme, index) {
  return {
    id: String(scheme?.id || `scheme-${index + 1}`),
    name: String(scheme?.name || `方案 ${index + 1}`),
    description: String(scheme?.description || ''),
    availableResources: normalizeResources(scheme?.availableResources || {}),
    environment: {
      weather: safePositive(scheme?.environment?.weather, 1),
      threat: safePositive(scheme?.environment?.threat, 1),
      terrain: safePositive(scheme?.environment?.terrain, 1),
      coordination: safePositive(scheme?.environment?.coordination, 1),
    },
    nodeAdjustments: ensureNodeAdjustments(task.nodes, scheme?.nodeAdjustments),
  };
}

function getObjectiveMeta(key) {
  return OBJECTIVE_CATALOG.find((item) => item.key === String(key)) || OBJECTIVE_CATALOG[0];
}

function validateActionTask(task, scheme = null) {
  const nodes = safeArray(task.nodes);
  const links = safeArray(task.links);
  const issues = [];
  const warnings = [];
  const nodeChecks = [];

  const duplicateIds = new Set();
  const seenIds = new Set();
  for (const node of nodes) {
    if (seenIds.has(String(node.id))) {
      duplicateIds.add(String(node.id));
    }
    seenIds.add(String(node.id));
  }

  if (duplicateIds.size) {
    issues.push(`存在重复节点编号：${[...duplicateIds].join('、')}。`);
  }

  const topology = topologicalSort(nodes, links);
  issues.push(...topology.issues);

  const availableOutputs = new Set(safeArray(task.initialInputs).map((item) => String(item)));
  const structuralDemand = {};

  for (const node of topology.order) {
    const inputs = safeArray(node.inputs).map((item) => String(item));
    const outputs = safeArray(node.outputs).map((item) => String(item));
    const constraints = safeArray(node.constraints).map((item) => String(item));
    const requirementEntries = Object.entries(node.resourceRequirements || {});
    const missingInputs = inputs.filter((item) => !availableOutputs.has(item));

    if (!inputs.length) {
      issues.push(`节点 ${node.name} 缺少输入定义。`);
    }
    if (!outputs.length) {
      issues.push(`节点 ${node.name} 缺少输出定义。`);
    }
    if (missingInputs.length) {
      issues.push(`节点 ${node.name} 缺少上游输出：${missingInputs.join('、')}。`);
    }
    if (!constraints.length) {
      warnings.push(`节点 ${node.name} 未设置约束条件。`);
    }
    if (!requirementEntries.length) {
      warnings.push(`节点 ${node.name} 未设置资源需求。`);
    }

    for (const output of outputs) {
      availableOutputs.add(output);
    }

    for (const [key, value] of requirementEntries) {
      const meta = RESOURCE_META[key];
      if (!meta) continue;
      const amount = Math.max(Number(value) || 0, 0);
      if (meta.mode === 'consumable') {
        structuralDemand[key] = (structuralDemand[key] || 0) + amount;
      } else {
        structuralDemand[key] = Math.max(structuralDemand[key] || 0, amount);
      }
    }

    nodeChecks.push({
      nodeId: node.id,
      nodeName: node.name,
      inputCount: inputs.length,
      outputCount: outputs.length,
      constraintCount: constraints.length,
      resourceKinds: requirementEntries.length,
      missingInputs,
      passed: !missingInputs.length && inputs.length > 0 && outputs.length > 0,
    });
  }

  const resourceChecks = Object.entries(structuralDemand).map(([key, required]) => {
    const available = scheme ? Math.max(Number(scheme.availableResources[key]) || 0, 0) : 0;
    const sufficient = scheme ? available >= required : true;
    if (scheme && !sufficient) {
      issues.push(`${RESOURCE_META[key].label} 需求 ${required.toFixed(1)}，可用 ${available.toFixed(1)}。`);
    }
    return {
      key,
      label: RESOURCE_META[key].label,
      required: Number(required.toFixed(2)),
      available: Number(available.toFixed(2)),
      sufficient,
    };
  });

  return {
    passed: issues.length === 0,
    issueCount: issues.length,
    warningCount: warnings.length,
    issues,
    warnings,
    nodeChecks,
    resourceChecks,
  };
}

function calculateNodePrediction(node, scheme, currentTime) {
  const model = node.model || {};
  const adjustments = scheme.nodeAdjustments[node.id] || { tempo: 1, resource: 1, path: 1 };
  const { weather, threat, terrain, coordination } = scheme.environment;

  const durationFactor = Math.max(
    0.55,
    safePositive(adjustments.tempo, 1)
      * (1 + ((weather - 1) * safePositive(model.weatherImpact, 0)))
      * (1 + ((threat - 1) * safePositive(model.threatImpact, 0)))
      * (1 + ((terrain - 1) * safePositive(model.terrainImpact, 0)))
      * Math.max(0.7, 1 - ((coordination - 1) * safePositive(model.coordinationImpact, 0))),
  );

  const pathFactor = Math.max(
    0.65,
    safePositive(adjustments.path, 1)
      * (1 + ((terrain - 1) * 0.12))
      * (1 + ((threat - 1) * 0.06)),
  );

  const resourceFactor = Math.max(
    0.75,
    safePositive(adjustments.resource, 1)
      * (1 + ((weather - 1) * 0.06))
      * (1 + ((threat - 1) * 0.1)),
  );

  const duration = Math.max(1, safePositive(model.baseDuration, 1) * durationFactor);
  const distance = Math.max(1, safePositive(model.baseDistance, 1) * pathFactor);
  const startTime = currentTime;
  const endTime = startTime + duration;
  const riskScore = clamp(
    35
      + ((weather - 1) * 18)
      + ((threat - 1) * 28)
      + ((terrain - 1) * 16)
      + ((pathFactor - 1) * 12)
      + ((durationFactor - 1) * 10),
    20,
    100,
  );

  const resources = {};
  for (const [key, rawValue] of Object.entries(node.resourceRequirements || {})) {
    const meta = RESOURCE_META[key];
    const value = Math.max(Number(rawValue) || 0, 0);
    if (!meta || value <= 0) continue;

    if (meta.mode === 'consumable') {
      const distanceRatio = safePositive(model.baseDistance, 1) ? distance / safePositive(model.baseDistance, 1) : 1;
      const consumptionFactor = key === 'fuel'
        ? resourceFactor * distanceRatio
        : resourceFactor * (1 + ((threat - 1) * 0.08));
      resources[key] = value * consumptionFactor;
    } else {
      resources[key] = value;
    }
  }

  return {
    id: node.id,
    code: node.code,
    name: node.name,
    inputs: cloneData(node.inputs || []),
    outputs: cloneData(node.outputs || []),
    constraints: cloneData(node.constraints || []),
    startTime: Number(startTime.toFixed(2)),
    endTime: Number(endTime.toFixed(2)),
    duration: Number(duration.toFixed(2)),
    distance: Number(distance.toFixed(2)),
    riskScore: Number(riskScore.toFixed(2)),
    adjustments,
    resources,
  };
}

function aggregateResourceUsage(nodeResults, scheme) {
  const totals = {};
  for (const node of nodeResults) {
    for (const [key, value] of Object.entries(node.resources || {})) {
      const meta = RESOURCE_META[key];
      if (!meta) continue;
      if (meta.mode === 'consumable') {
        totals[key] = (totals[key] || 0) + value;
      } else {
        totals[key] = Math.max(totals[key] || 0, value);
      }
    }
  }

  const details = Object.keys(RESOURCE_META)
    .map((key) => {
      const available = Math.max(Number(scheme.availableResources[key]) || 0, 0);
      const used = Math.max(Number(totals[key]) || 0, 0);
      if (!available && !used) {
        return null;
      }
      const utilization = available > 0 ? used / available : used > 0 ? 1.5 : 0;
      return {
        key,
        label: RESOURCE_META[key].label,
        mode: RESOURCE_META[key].mode,
        used: Number(used.toFixed(2)),
        available: Number(available.toFixed(2)),
        utilization: Number(utilization.toFixed(4)),
      };
    })
    .filter(Boolean);

  const resourceCost = details.reduce((sum, item) => {
    const weight = RESOURCE_META[item.key]?.weight || 1;
    return sum + (item.utilization * weight);
  }, 0);

  return {
    details,
    resourceCost: Number(resourceCost.toFixed(4)),
  };
}

function buildSuggestions(validation, nodeResults, resourceDetails, totals, objectiveKey) {
  const suggestions = [];

  if (validation.issues.length) {
    suggestions.push(`优先修复功能链校验问题：${validation.issues[0]}`);
  }

  const longestNode = [...nodeResults].sort((left, right) => right.duration - left.duration)[0];
  if (longestNode) {
    suggestions.push(`重点压缩节点“${longestNode.name}”的执行时间，它是当前时间占比最高的环节。`);
  }

  const longestDistanceNode = [...nodeResults].sort((left, right) => right.distance - left.distance)[0];
  if (longestDistanceNode) {
    suggestions.push(`节点“${longestDistanceNode.name}”路径长度最大，可优先调整航线或路径系数。`);
  }

  const highUtilization = [...resourceDetails]
    .sort((left, right) => right.utilization - left.utilization)
    .find((item) => item.utilization >= 0.85);
  if (highUtilization) {
    suggestions.push(`${highUtilization.label} 利用率较高，建议补充保障资源或调整对应节点资源系数。`);
  }

  if (objectiveKey === 'time') {
    suggestions.push(`当前优化目标为时间优先，建议提高关键节点 tempo 系数并降低迂回路径比重。`);
  } else if (objectiveKey === 'resource') {
    suggestions.push(`当前优化目标为资源优先，建议降低火力释放与航迹绕飞带来的消耗。`);
  } else if (objectiveKey === 'path') {
    suggestions.push(`当前优化目标为路径优先，建议优先优化“${longestDistanceNode?.name || '关键路径'}”节点航线。`);
  } else {
    suggestions.push(`当前采用综合均衡目标，建议同步关注总时间 ${totals.totalTime.toFixed(1)} 分钟与总路径 ${totals.totalDistance.toFixed(1)} 公里。`);
  }

  return suggestions.slice(0, 4);
}

function evaluateScheme(task, scheme, objectiveKey) {
  const validation = validateActionTask(task, scheme);
  const executionOrder = topologicalSort(task.nodes, task.links).order;
  let clock = 0;
  const nodeResults = safeArray(executionOrder).map((node) => {
    const result = calculateNodePrediction(node, scheme, clock);
    clock = result.endTime;
    return result;
  });

  const totalTime = nodeResults.length ? nodeResults[nodeResults.length - 1].endTime : 0;
  const totalDistance = nodeResults.reduce((sum, node) => sum + node.distance, 0);
  const averageRisk = nodeResults.length
    ? nodeResults.reduce((sum, node) => sum + node.riskScore, 0) / nodeResults.length
    : 0;
  const aggregatedResources = aggregateResourceUsage(nodeResults, scheme);

  const totals = {
    totalTime: Number(totalTime.toFixed(2)),
    totalDistance: Number(totalDistance.toFixed(2)),
    resourceCost: aggregatedResources.resourceCost,
    averageRisk: Number(averageRisk.toFixed(2)),
  };

  return {
    id: scheme.id,
    name: scheme.name,
    description: scheme.description,
    validation,
    totals,
    nodes: nodeResults,
    resourceUsage: aggregatedResources.details,
    predictions: {
      time: totals.totalTime,
      path: totals.totalDistance,
      resources: totals.resourceCost,
    },
    suggestions: buildSuggestions(validation, nodeResults, aggregatedResources.details, totals, objectiveKey),
  };
}

function normalizeSmallBetter(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return 0.5;
  }
  return (value - min) / (max - min);
}

function selectObjectiveWeights(objectiveKey) {
  if (objectiveKey === 'time') {
    return { time: 0.55, resource: 0.15, path: 0.15, risk: 0.15 };
  }
  if (objectiveKey === 'resource') {
    return { time: 0.2, resource: 0.5, path: 0.15, risk: 0.15 };
  }
  if (objectiveKey === 'path') {
    return { time: 0.2, resource: 0.15, path: 0.5, risk: 0.15 };
  }
  return { time: 0.35, resource: 0.25, path: 0.2, risk: 0.2 };
}

function resolveMissionActionTaskId(missionContext = {}) {
  const missionType = String(missionContext?.missionType || '');
  if (missionType === 'air-assault') {
    return 'helicopter-air-assault';
  }
  if (missionType === 'fire-strike') {
    return 'helicopter-fire-strike';
  }
  return '';
}

function rankSchemes(schemeResults, objectiveKey) {
  const entries = Object.values(schemeResults);
  const times = entries.map((item) => item.totals.totalTime);
  const distances = entries.map((item) => item.totals.totalDistance);
  const resources = entries.map((item) => item.totals.resourceCost);
  const risks = entries.map((item) => item.totals.averageRisk);
  const weights = selectObjectiveWeights(objectiveKey);

  return entries
    .map((item) => {
      const penalties = {
        time: normalizeSmallBetter(item.totals.totalTime, Math.min(...times), Math.max(...times)),
        resource: normalizeSmallBetter(item.totals.resourceCost, Math.min(...resources), Math.max(...resources)),
        path: normalizeSmallBetter(item.totals.totalDistance, Math.min(...distances), Math.max(...distances)),
        risk: normalizeSmallBetter(item.totals.averageRisk, Math.min(...risks), Math.max(...risks)),
      };

      const structuralPenalty = item.validation.issueCount ? clamp(item.validation.issueCount / 6, 0, 1) : 0;
      const weightedPenalty = (
        (penalties.time * weights.time)
        + (penalties.resource * weights.resource)
        + (penalties.path * weights.path)
        + (penalties.risk * weights.risk)
        + (structuralPenalty * 0.15)
      );
      const recommendationScore = clamp((1 - weightedPenalty) * 100, 0, 100);

      return {
        schemeId: item.id,
        name: item.name,
        recommendationScore: Number(recommendationScore.toFixed(2)),
        totalTime: item.totals.totalTime,
        totalDistance: item.totals.totalDistance,
        resourceCost: item.totals.resourceCost,
        averageRisk: item.totals.averageRisk,
        grade: gradeByScore(recommendationScore),
        issueCount: item.validation.issueCount,
      };
    })
    .sort((left, right) => right.recommendationScore - left.recommendationScore)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
}

function selectTask(template, payload) {
  const payloadTask = payload?.task;
  if (payloadTask?.nodes?.length) {
    return {
      id: String(payloadTask.id || 'custom-task'),
      name: String(payloadTask.name || '自定义任务'),
      description: String(payloadTask.description || ''),
      category: String(payloadTask.category || '自定义'),
      initialInputs: cloneData(payloadTask.initialInputs || []),
      links: cloneData(payloadTask.links || []),
      nodes: cloneData(payloadTask.nodes || []),
      defaultSchemes: cloneData(payloadTask.defaultSchemes || []),
    };
  }

  const missionTaskId = resolveMissionActionTaskId(payload?.missionContext);
  const selectedTaskId = String(payload?.taskId || missionTaskId || '');
  return template.tasks.find((task) => task.id === selectedTaskId) || template.tasks[0];
}

function normalizeSchemes(task, payloadSchemes) {
  const selected = Array.isArray(payloadSchemes) && payloadSchemes.length ? payloadSchemes : task.defaultSchemes;
  return selected.map((scheme, index) => normalizeScheme(task, scheme, index));
}

function evaluateWithBuiltinEngine(payload = {}) {
  const template = buildActionTemplate();
  const engineCatalog = buildEngineCatalog();
  const task = selectTask(template, payload);
  const objective = getObjectiveMeta(payload.objective);
  const schemes = normalizeSchemes(task, payload.schemes);
  const schemeResults = {};

  for (const scheme of schemes) {
    schemeResults[scheme.id] = evaluateScheme(task, scheme, objective.key);
  }

  const ranking = rankSchemes(schemeResults, objective.key);
  const recommended = ranking[0] || null;

  for (const item of ranking) {
    if (schemeResults[item.schemeId]) {
      schemeResults[item.schemeId].recommendationScore = item.recommendationScore;
      schemeResults[item.schemeId].grade = item.grade;
      schemeResults[item.schemeId].rank = item.rank;
    }
  }

  return {
    assessmentName: String(payload.assessmentName || `${task.name}行动评估`),
    engine: engineCatalog[0],
    objective,
    missionContext: cloneData(payload.missionContext || null),
    generatedAt: new Date().toISOString(),
    task: {
      id: task.id,
      name: task.name,
      description: task.description,
      category: task.category,
      nodeCount: safeArray(task.nodes).length,
      linkCount: safeArray(task.links).length,
    },
    comparison: {
      ranking,
      recommendedSchemeId: recommended?.schemeId || '',
      recommendedSchemeName: recommended?.name || '',
    },
    schemes: schemeResults,
  };
}

async function evaluateWithExternalEngine(engine, payload) {
  return invokeExternalAlgorithm({
    engine,
    moduleKey: 'action-calculation',
    payload,
    assessmentName: String(payload.assessmentName || '作战行动评估任务'),
    algorithm: {
      key: 'action-evaluation',
      name: '作战行动评估',
    },
    requestMeta: {
      flow: 'action-evaluate',
      taskId: String(payload.taskId || ''),
    },
  });
}

function normalizeActionEvaluationResult(rawResult, payload, engine, gatewayMeta) {
  const normalized = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
    ? cloneData(rawResult)
    : { result: rawResult };

  return {
    ...normalized,
    assessmentName: String(normalized.assessmentName || payload.assessmentName || '作战行动评估任务'),
    engine: {
      ...cloneData(engine),
      status: 'active',
    },
    algorithmGateway: buildAlgorithmGatewayMeta(engine, gatewayMeta),
  };
}

export function getActionTemplate() {
  return buildActionTemplate();
}

export async function evaluateAction(payload = {}, options = {}) {
  const { db } = options;
  const engineCatalog = buildEngineCatalog();
  const engine = resolveEngineByKey(engineCatalog, payload.engine || 'builtin');
  const assessmentName = String(payload.assessmentName || '作战行动评估任务');

  if (!engine) {
    const error = new Error('不支持的行动计算引擎。');
    error.status = 400;
    error.code = 'ACTION_ENGINE_UNSUPPORTED';
    error.type = 'missing_data';
    throw error;
  }

  if (engine.key !== 'builtin' && engine.status !== 'active') {
    const error = new Error(`${engine.label}当前仅保留扩展位，尚未接入实际行动计算服务。`);
    error.status = 400;
    error.code = 'ACTION_ENGINE_NOT_READY';
    error.type = 'missing_data';
    throw error;
  }

  const algorithmKey = String(payload.taskId || 'action-evaluation');
  const algorithmName = '作战行动评估';
  const requestSummary = summarizeAlgorithmPayload(payload);

  if (engine.key === 'builtin') {
    const result = evaluateWithBuiltinEngine(payload);
    const normalizedResult = normalizeActionEvaluationResult(result, payload, engine, {
      status: 'succeeded',
      durationMs: 0,
      httpStatus: 200,
      requestId: '',
    });
    recordAlgorithmCall(db, {
      moduleKey: 'action',
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
        rankingCount: safeArray(normalizedResult.comparison?.ranking).length,
      },
    });
    return normalizedResult;
  }

  try {
    const external = await evaluateWithExternalEngine(engine, payload);
    const normalizedResult = normalizeActionEvaluationResult(
      external.result,
      payload,
      engine,
      external.callMeta,
    );
    recordAlgorithmCall(db, {
      moduleKey: 'action',
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
        rankingCount: safeArray(normalizedResult.comparison?.ranking).length,
      },
    });
    return normalizedResult;
  } catch (error) {
    recordAlgorithmCall(db, {
      moduleKey: 'action',
      assessmentName,
      algorithmKey,
      algorithmName,
      engineKey: engine.key,
      engineSource: engine.source,
      engineRuntime: engine.runtime,
      engineVersion: engine.version,
      status: 'failed',
      httpStatus: error?.status,
      requestId: error?.details?.requestId,
      errorCode: error?.code || 'ACTION_ENGINE_FAILED',
      errorMessage: error?.message || '作战行动外部算法执行失败。',
      requestPayload: requestSummary,
      responsePayload: error?.details || {},
    });
    throw error;
  }
}
