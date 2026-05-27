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

function round(value, digits = 2) {
  return Number((Number(value) || 0).toFixed(digits));
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + (Number(item) || 0), 0) / values.length;
}

const NATURAL_MODEL_CATALOG = [
  {
    key: 'wear-maintenance-frequency',
    label: '老化-维护-频率衰减模型',
    description: '综合服役年限、维护状态和使用频率，估计装备在评估周期内的自然损耗水平。',
  },
];

const MISSION_MODEL_CATALOG = [
  {
    key: 'fire-strike-protection',
    label: '火力-打击方式-防护对抗模型',
    description: '综合敌方火力强度、打击方式和装备防护能力，估计任务条件下的战损水平。',
  },
];

const PREDICTION_MODEL_CATALOG = [
  {
    key: 'personnel',
    label: '人员伤亡预测',
    description: '基于任务战损、医疗救治与撤收效率，预测伤亡规模与伤重结构。',
  },
  {
    key: 'ammo',
    label: '弹药消耗预测',
    description: '结合装备类别、任务持续时间和打击方式，预测弹药当量消耗。',
  },
  {
    key: 'fuel',
    label: '油料消耗预测',
    description: '结合装备数量、任务时长和作战强度，预测油料需求与消耗趋势。',
  },
];

const STRIKE_MODE_CATALOG = [
  {
    key: 'precision-strike',
    label: '精确打击',
    threatMultiplier: 0.92,
    casualtyMultiplier: 0.9,
    ammoMultiplier: 0.88,
    fuelMultiplier: 0.96,
    damageBias: 0.88,
  },
  {
    key: 'combined-fire',
    label: '联合火力',
    threatMultiplier: 1,
    casualtyMultiplier: 1,
    ammoMultiplier: 1,
    fuelMultiplier: 1,
    damageBias: 1,
  },
  {
    key: 'saturation-strike',
    label: '饱和打击',
    threatMultiplier: 1.22,
    casualtyMultiplier: 1.18,
    ammoMultiplier: 1.24,
    fuelMultiplier: 1.08,
    damageBias: 1.16,
  },
];

const OPERATION_PHASES = [
  {
    key: 'deployment',
    label: '机动展开',
    lossWeight: 0.12,
    casualtyWeight: 0.08,
    ammoWeight: 0.08,
    fuelWeight: 0.26,
  },
  {
    key: 'contact',
    label: '接敌压制',
    lossWeight: 0.24,
    casualtyWeight: 0.22,
    ammoWeight: 0.24,
    fuelWeight: 0.22,
  },
  {
    key: 'engagement',
    label: '主战打击',
    lossWeight: 0.42,
    casualtyWeight: 0.48,
    ammoWeight: 0.46,
    fuelWeight: 0.34,
  },
  {
    key: 'recovery',
    label: '稳控恢复',
    lossWeight: 0.22,
    casualtyWeight: 0.22,
    ammoWeight: 0.22,
    fuelWeight: 0.18,
  },
];

const EQUIPMENT_META = {
  groundVehicles: {
    key: 'groundVehicles',
    label: '地面车辆',
    unit: '辆',
    ammoUnit: '发',
    crewPerUnit: 3,
    ageReference: 8,
    frequencyReference: 5,
    naturalBaseRate: 0.0025,
    ageWeight: 0.2,
    maintenanceWeight: 0.78,
    frequencyWeight: 0.24,
    missionBaseRate: 0.09,
    protectionWeight: 0.72,
    referenceHours: 18,
    ammoPerHour: 18,
    ammoEquivalentFactor: 1,
    fuelPerHour: 52,
  },
  helicopters: {
    key: 'helicopters',
    label: '直升机',
    unit: '架',
    ammoUnit: '枚',
    crewPerUnit: 2.4,
    ageReference: 10,
    frequencyReference: 4,
    naturalBaseRate: 0.0032,
    ageWeight: 0.18,
    maintenanceWeight: 0.86,
    frequencyWeight: 0.3,
    missionBaseRate: 0.115,
    protectionWeight: 0.68,
    referenceHours: 16,
    ammoPerHour: 14,
    ammoEquivalentFactor: 5.6,
    fuelPerHour: 380,
  },
  supportEquipment: {
    key: 'supportEquipment',
    label: '保障设备',
    unit: '套',
    ammoUnit: '组',
    crewPerUnit: 4.2,
    ageReference: 9,
    frequencyReference: 6,
    naturalBaseRate: 0.0021,
    ageWeight: 0.16,
    maintenanceWeight: 0.74,
    frequencyWeight: 0.18,
    missionBaseRate: 0.062,
    protectionWeight: 0.84,
    referenceHours: 20,
    ammoPerHour: 5,
    ammoEquivalentFactor: 2.4,
    fuelPerHour: 26,
  },
};

function buildEngineCatalog() {
  return buildStandardEngineCatalog({
    moduleKey: 'consumption-calculation',
    builtin: {
      key: 'builtin',
      type: 'builtin',
      runtime: 'node',
      version: String(process.env.CONSUMPTION_BUILTIN_VERSION || '1.0.0'),
      label: '内置消耗计算引擎',
      description: '基于自然损耗、任务战损、人员伤亡、弹药与油料模型的一体化计算引擎。',
      legacyKeys: ['builtin'],
    },
    externals: [
      {
        key: 'python-service',
        type: 'external-model',
        runtime: 'python',
        endpointEnv: 'CONSUMPTION_PYTHON_URL',
        versionEnv: 'CONSUMPTION_PYTHON_VERSION',
        label: 'Python 外部算法服务',
        activeDescription: '已通过 CONSUMPTION_PYTHON_URL 配置外部 Python 算法服务。',
        plannedDescription: '预留 Python 算法服务接入口，可通过 CONSUMPTION_PYTHON_URL 指向外部服务。',
        legacyKeys: ['python-service', 'python'],
      },
      {
        key: 'cpp-service',
        type: 'external-model',
        runtime: 'cpp',
        endpointEnv: 'CONSUMPTION_CPP_URL',
        versionEnv: 'CONSUMPTION_CPP_VERSION',
        label: 'C++ 外部算法服务',
        activeDescription: '已通过 CONSUMPTION_CPP_URL 配置外部 C++ 算法服务。',
        plannedDescription: '预留 C++ 高性能算法服务接入口，可通过 CONSUMPTION_CPP_URL 指向外部服务。',
        legacyKeys: ['cpp-service', 'cpp'],
      },
    ],
  });
}

function buildDefaultSchemes() {
  return [
    {
      id: 'balanced-force',
      name: '均衡推进方案',
      description: '兼顾推进节奏与防护部署，控制战损和补给压力。',
      durationDays: 7,
      operatingHours: 14,
      mission: {
        enemyFireIntensity: 62,
        strikeMode: 'combined-fire',
      },
      personnel: {
        deployed: 640,
        medicalSupportLevel: 78,
        evacuationEfficiency: 76,
      },
      equipment: {
        groundVehicles: {
          quantity: 48,
          serviceYears: 7,
          maintenanceLevel: 82,
          usageFrequency: 5.2,
          protectionCapability: 74,
        },
        helicopters: {
          quantity: 12,
          serviceYears: 6,
          maintenanceLevel: 85,
          usageFrequency: 3.6,
          protectionCapability: 68,
        },
        supportEquipment: {
          quantity: 18,
          serviceYears: 8,
          maintenanceLevel: 80,
          usageFrequency: 4.8,
          protectionCapability: 82,
        },
      },
    },
    {
      id: 'rapid-assault',
      name: '高强突击方案',
      description: '强调攻击节奏和持续压制，换取更高补给和损耗压力。',
      durationDays: 5,
      operatingHours: 18,
      mission: {
        enemyFireIntensity: 84,
        strikeMode: 'saturation-strike',
      },
      personnel: {
        deployed: 700,
        medicalSupportLevel: 70,
        evacuationEfficiency: 68,
      },
      equipment: {
        groundVehicles: {
          quantity: 56,
          serviceYears: 8,
          maintenanceLevel: 76,
          usageFrequency: 6.2,
          protectionCapability: 70,
        },
        helicopters: {
          quantity: 16,
          serviceYears: 7,
          maintenanceLevel: 78,
          usageFrequency: 4.6,
          protectionCapability: 63,
        },
        supportEquipment: {
          quantity: 20,
          serviceYears: 9,
          maintenanceLevel: 75,
          usageFrequency: 5.5,
          protectionCapability: 76,
        },
      },
    },
    {
      id: 'protected-sustain',
      name: '稳健防护方案',
      description: '提升防护与救治保障，压低战损和人员伤亡，适合持续作战。',
      durationDays: 8,
      operatingHours: 12,
      mission: {
        enemyFireIntensity: 56,
        strikeMode: 'precision-strike',
      },
      personnel: {
        deployed: 620,
        medicalSupportLevel: 86,
        evacuationEfficiency: 84,
      },
      equipment: {
        groundVehicles: {
          quantity: 44,
          serviceYears: 6,
          maintenanceLevel: 88,
          usageFrequency: 4.2,
          protectionCapability: 82,
        },
        helicopters: {
          quantity: 10,
          serviceYears: 5,
          maintenanceLevel: 90,
          usageFrequency: 3.1,
          protectionCapability: 74,
        },
        supportEquipment: {
          quantity: 22,
          serviceYears: 7,
          maintenanceLevel: 87,
          usageFrequency: 4.1,
          protectionCapability: 88,
        },
      },
    },
  ];
}

function buildConsumptionTemplate() {
  const engines = buildEngineCatalog();
  const schemes = buildDefaultSchemes();
  const equipmentTypes = Object.values(EQUIPMENT_META).map((item) => ({
    key: item.key,
    label: item.label,
    unit: item.unit,
    ammoUnit: item.ammoUnit,
  }));

  return {
    version: '1.0.0',
    module: 'consumption-calculation',
    title: '消耗计算子模块',
    description: '面向装备自然损耗、任务战损、人员伤亡和补给消耗的一体化预测与可视化模块。',
    naturalModels: cloneData(NATURAL_MODEL_CATALOG),
    missionModels: cloneData(MISSION_MODEL_CATALOG),
    predictionModels: cloneData(PREDICTION_MODEL_CATALOG),
    engines,
    equipmentTypes,
    strikeModes: cloneData(STRIKE_MODE_CATALOG),
    phases: cloneData(OPERATION_PHASES),
    schemes: cloneData(schemes),
    summary: {
      equipmentTypeCount: equipmentTypes.length,
      schemeCount: schemes.length,
      predictionModelCount: PREDICTION_MODEL_CATALOG.length,
      engineCount: engines.length,
      phaseCount: OPERATION_PHASES.length,
    },
  };
}

function getStrikeMode(key) {
  return STRIKE_MODE_CATALOG.find((item) => item.key === String(key)) || STRIKE_MODE_CATALOG[1];
}

function normalizeEquipmentState(key, source = {}) {
  const meta = EQUIPMENT_META[key];
  return {
    quantity: Math.max(Number(source.quantity) || 0, 0),
    serviceYears: clamp(source.serviceYears, 1, 30),
    maintenanceLevel: clamp(source.maintenanceLevel, 35, 100),
    usageFrequency: clamp(source.usageFrequency, 1, 12),
    protectionCapability: clamp(source.protectionCapability, 20, 100),
    label: meta.label,
    unit: meta.unit,
  };
}

function normalizeScheme(source = {}, index = 0) {
  const equipment = {};
  for (const key of Object.keys(EQUIPMENT_META)) {
    equipment[key] = normalizeEquipmentState(key, source?.equipment?.[key] || {});
  }

  return {
    id: String(source.id || `scheme-${index + 1}`),
    name: String(source.name || `方案 ${index + 1}`),
    description: String(source.description || ''),
    durationDays: clamp(source.durationDays, 1, 30),
    operatingHours: clamp(source.operatingHours, 6, 24),
    mission: {
      enemyFireIntensity: clamp(source?.mission?.enemyFireIntensity, 20, 100),
      strikeMode: getStrikeMode(source?.mission?.strikeMode).key,
    },
    personnel: {
      deployed: Math.max(Number(source?.personnel?.deployed) || 0, 0),
      medicalSupportLevel: clamp(source?.personnel?.medicalSupportLevel, 30, 100),
      evacuationEfficiency: clamp(source?.personnel?.evacuationEfficiency, 30, 100),
    },
    equipment,
  };
}

function normalizeSchemes(payloadSchemes, templateSchemes) {
  const selected = Array.isArray(payloadSchemes) && payloadSchemes.length ? payloadSchemes : templateSchemes;
  return selected.map((scheme, index) => normalizeScheme(scheme, index));
}

function calculateNaturalLoss(meta, state, durationDays) {
  const ageFactor = clamp(0.78 + ((state.serviceYears / meta.ageReference) * meta.ageWeight), 0.72, 1.92);
  const maintenanceFactor = clamp(1.46 - ((state.maintenanceLevel / 100) * meta.maintenanceWeight), 0.56, 1.48);
  const frequencyFactor = clamp(0.82 + ((state.usageFrequency / meta.frequencyReference) * meta.frequencyWeight), 0.76, 1.72);
  const lossRate = clamp(meta.naturalBaseRate * durationDays * ageFactor * maintenanceFactor * frequencyFactor, 0, 0.22);
  const lostUnits = state.quantity * lossRate;

  return {
    lossRate,
    lostUnits,
    ageFactor,
    maintenanceFactor,
    frequencyFactor,
  };
}

function calculateTaskLoss(meta, state, scheme, availableUnits) {
  const strikeMode = getStrikeMode(scheme.mission.strikeMode);
  const fireFactor = 0.68 + ((scheme.mission.enemyFireIntensity / 100) * 1.18);
  const timeFactor = clamp(scheme.operatingHours / meta.referenceHours, 0.68, 1.85);
  const protectionFactor = clamp(1.28 - ((state.protectionCapability / 100) * meta.protectionWeight), 0.38, 1.22);
  const lossRate = clamp(
    meta.missionBaseRate * fireFactor * timeFactor * protectionFactor * strikeMode.threatMultiplier,
    0,
    0.72,
  );
  const lostUnits = availableUnits * lossRate;
  const damageIndex = clamp(
    (lossRate * 100 * 0.92)
      + (scheme.mission.enemyFireIntensity * 0.42)
      + ((strikeMode.damageBias - 1) * 28)
      - (state.protectionCapability * 0.2),
    10,
    100,
  );

  return {
    strikeMode,
    fireFactor,
    timeFactor,
    protectionFactor,
    lossRate,
    lostUnits,
    damageIndex,
  };
}

function calculatePersonnelPrediction(scheme, equipmentBreakdown) {
  const strikeMode = getStrikeMode(scheme.mission.strikeMode);
  const crewExposure = equipmentBreakdown.reduce(
    (sum, item) => sum + ((item.taskLoss.units + (item.naturalLoss.units * 0.2)) * item.crewPerUnit),
    0,
  );
  const backgroundExposure = scheme.personnel.deployed
    * (scheme.mission.enemyFireIntensity / 100)
    * (scheme.operatingHours / 24)
    * 0.012;
  const fatalityRate = clamp(
    0.04
      + ((scheme.mission.enemyFireIntensity / 100) * 0.08)
      + ((strikeMode.casualtyMultiplier - 1) * 0.18)
      - ((scheme.personnel.medicalSupportLevel / 100) * 0.03)
      - ((scheme.personnel.evacuationEfficiency / 100) * 0.025),
    0.03,
    0.2,
  );
  const injuryRate = clamp(
    0.22
      + ((scheme.mission.enemyFireIntensity / 100) * 0.22)
      + ((strikeMode.casualtyMultiplier - 1) * 0.24)
      - ((scheme.personnel.medicalSupportLevel / 100) * 0.08)
      - ((scheme.personnel.evacuationEfficiency / 100) * 0.04),
    0.12,
    0.52,
  );
  const fatalities = (crewExposure * fatalityRate) + (backgroundExposure * 0.16);
  const injuries = (crewExposure * injuryRate) + (backgroundExposure * 0.84);
  const total = fatalities + injuries;
  const casualtyRate = scheme.personnel.deployed > 0 ? total / scheme.personnel.deployed : 0;

  return {
    deployed: scheme.personnel.deployed,
    crewExposure: round(crewExposure, 2),
    fatalities: round(fatalities, 2),
    injuries: round(injuries, 2),
    total: round(total, 2),
    casualtyRate: round(casualtyRate, 4),
  };
}

function calculateAmmoPrediction(scheme, equipmentBreakdown) {
  const strikeMode = getStrikeMode(scheme.mission.strikeMode);
  const intensityFactor = 0.56 + ((scheme.mission.enemyFireIntensity / 100) * 0.86);
  const items = equipmentBreakdown.map((item) => {
    const rawAmount = item.availableAfterNatural
      * scheme.operatingHours
      * item.ammoPerHour
      * intensityFactor
      * strikeMode.ammoMultiplier;
    const equivalent = rawAmount * item.ammoEquivalentFactor;

    return {
      key: item.key,
      label: item.label,
      unit: item.ammoUnit,
      rawAmount: round(rawAmount, 2),
      equivalent: round(equivalent, 2),
    };
  });

  return {
    totalEquivalent: round(items.reduce((sum, item) => sum + item.equivalent, 0), 2),
    items,
  };
}

function calculateFuelPrediction(scheme, equipmentBreakdown) {
  const strikeMode = getStrikeMode(scheme.mission.strikeMode);
  const intensityFactor = 0.82 + ((scheme.mission.enemyFireIntensity / 100) * 0.34);
  const items = equipmentBreakdown.map((item) => {
    const used = item.availableAfterNatural
      * scheme.operatingHours
      * item.fuelPerHour
      * intensityFactor
      * strikeMode.fuelMultiplier;

    return {
      key: item.key,
      label: item.label,
      unit: '升',
      used: round(used, 2),
    };
  });

  return {
    totalUsed: round(items.reduce((sum, item) => sum + item.used, 0), 2),
    items,
  };
}

function buildPhaseTrend(totals) {
  return OPERATION_PHASES.map((phase) => ({
    key: phase.key,
    label: phase.label,
    naturalLoss: round(totals.naturalLossUnits / OPERATION_PHASES.length, 2),
    taskLoss: round(totals.taskLossUnits * phase.lossWeight, 2),
    casualties: round(totals.casualties * phase.casualtyWeight, 2),
    ammoEquivalent: round(totals.ammoEquivalent * phase.ammoWeight, 2),
    fuelUsed: round(totals.fuelUsed * phase.fuelWeight, 2),
  }));
}

function evaluateScheme(scheme) {
  const equipmentBreakdown = Object.keys(EQUIPMENT_META).map((key) => {
    const meta = EQUIPMENT_META[key];
    const state = normalizeEquipmentState(key, scheme.equipment[key]);
    const naturalLoss = calculateNaturalLoss(meta, state, scheme.durationDays);
    const availableAfterNatural = Math.max(state.quantity - naturalLoss.lostUnits, 0);
    const taskLoss = calculateTaskLoss(meta, state, scheme, availableAfterNatural);
    const totalLostUnits = naturalLoss.lostUnits + taskLoss.lostUnits;
    const remainingUnits = Math.max(state.quantity - totalLostUnits, 0);
    const totalLossRate = state.quantity > 0 ? totalLostUnits / state.quantity : 0;

    return {
      key,
      label: meta.label,
      unit: meta.unit,
      ammoUnit: meta.ammoUnit,
      crewPerUnit: meta.crewPerUnit,
      ammoPerHour: meta.ammoPerHour,
      ammoEquivalentFactor: meta.ammoEquivalentFactor,
      fuelPerHour: meta.fuelPerHour,
      quantity: round(state.quantity, 2),
      serviceYears: round(state.serviceYears, 2),
      maintenanceLevel: round(state.maintenanceLevel, 2),
      usageFrequency: round(state.usageFrequency, 2),
      protectionCapability: round(state.protectionCapability, 2),
      availableAfterNatural: round(availableAfterNatural, 2),
      naturalLoss: {
        units: round(naturalLoss.lostUnits, 2),
        rate: round(naturalLoss.lossRate, 4),
        ageFactor: round(naturalLoss.ageFactor, 4),
        maintenanceFactor: round(naturalLoss.maintenanceFactor, 4),
        frequencyFactor: round(naturalLoss.frequencyFactor, 4),
      },
      taskLoss: {
        units: round(taskLoss.lostUnits, 2),
        rate: round(taskLoss.lossRate, 4),
        damageIndex: round(taskLoss.damageIndex, 2),
        fireFactor: round(taskLoss.fireFactor, 4),
        timeFactor: round(taskLoss.timeFactor, 4),
        protectionFactor: round(taskLoss.protectionFactor, 4),
      },
      totalLostUnits: round(totalLostUnits, 2),
      totalLossRate: round(totalLossRate, 4),
      remainingUnits: round(remainingUnits, 2),
    };
  });

  const casualties = calculatePersonnelPrediction(scheme, equipmentBreakdown);
  const ammo = calculateAmmoPrediction(scheme, equipmentBreakdown);
  const fuel = calculateFuelPrediction(scheme, equipmentBreakdown);
  const totalEquipment = equipmentBreakdown.reduce((sum, item) => sum + item.quantity, 0);
  const naturalLossUnits = equipmentBreakdown.reduce((sum, item) => sum + item.naturalLoss.units, 0);
  const taskLossUnits = equipmentBreakdown.reduce((sum, item) => sum + item.taskLoss.units, 0);
  const totalLossUnits = naturalLossUnits + taskLossUnits;
  const totalLossRate = totalEquipment > 0 ? totalLossUnits / totalEquipment : 0;
  const damageIndex = mean(equipmentBreakdown.map((item) => item.taskLoss.damageIndex));
  const readiness = totalEquipment > 0 ? (totalEquipment - totalLossUnits) / totalEquipment : 0;
  const phaseTrend = buildPhaseTrend({
    naturalLossUnits,
    taskLossUnits,
    casualties: casualties.total,
    ammoEquivalent: ammo.totalEquivalent,
    fuelUsed: fuel.totalUsed,
  });

  return {
    id: scheme.id,
    name: scheme.name,
    description: scheme.description,
    durationDays: scheme.durationDays,
    operatingHours: scheme.operatingHours,
    mission: {
      enemyFireIntensity: scheme.mission.enemyFireIntensity,
      strikeMode: getStrikeMode(scheme.mission.strikeMode),
    },
    personnel: {
      deployed: scheme.personnel.deployed,
      medicalSupportLevel: scheme.personnel.medicalSupportLevel,
      evacuationEfficiency: scheme.personnel.evacuationEfficiency,
      casualties,
    },
    totals: {
      equipmentCount: round(totalEquipment, 2),
      naturalLossUnits: round(naturalLossUnits, 2),
      taskLossUnits: round(taskLossUnits, 2),
      totalLossUnits: round(totalLossUnits, 2),
      totalLossRate: round(totalLossRate, 4),
      readiness: round(readiness, 4),
      damageIndex: round(damageIndex, 2),
      ammoEquivalent: ammo.totalEquivalent,
      fuelUsed: fuel.totalUsed,
    },
    equipmentBreakdown,
    ammo,
    fuel,
    phaseTrend,
  };
}

function normalizeSmallBetter(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return 0.5;
  }
  return (value - min) / (max - min);
}

function rankSchemes(schemeResults) {
  const entries = Object.values(schemeResults);
  const lossRates = entries.map((item) => item.totals.totalLossRate);
  const casualties = entries.map((item) => item.personnel.casualties.total);
  const ammoValues = entries.map((item) => item.totals.ammoEquivalent);
  const fuelValues = entries.map((item) => item.totals.fuelUsed);

  return entries
    .map((item) => {
      const penalty = (
        (normalizeSmallBetter(item.totals.totalLossRate, Math.min(...lossRates), Math.max(...lossRates)) * 0.36)
        + (normalizeSmallBetter(item.personnel.casualties.total, Math.min(...casualties), Math.max(...casualties)) * 0.3)
        + (normalizeSmallBetter(item.totals.ammoEquivalent, Math.min(...ammoValues), Math.max(...ammoValues)) * 0.18)
        + (normalizeSmallBetter(item.totals.fuelUsed, Math.min(...fuelValues), Math.max(...fuelValues)) * 0.16)
      );
      const sustainabilityScore = clamp((1 - penalty) * 100, 0, 100);

      return {
        schemeId: item.id,
        name: item.name,
        sustainabilityScore: round(sustainabilityScore, 2),
        totalLossUnits: item.totals.totalLossUnits,
        totalLossRate: item.totals.totalLossRate,
        casualties: item.personnel.casualties.total,
        ammoEquivalent: item.totals.ammoEquivalent,
        fuelUsed: item.totals.fuelUsed,
        readiness: item.totals.readiness,
        damageIndex: item.totals.damageIndex,
      };
    })
    .sort((left, right) => right.sustainabilityScore - left.sustainabilityScore)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
}

function evaluateWithBuiltinEngine(payload = {}) {
  const template = buildConsumptionTemplate();
  const schemes = normalizeSchemes(payload.schemes, template.schemes);
  const schemeResults = {};

  for (const scheme of schemes) {
    schemeResults[scheme.id] = evaluateScheme(scheme);
  }

  const ranking = rankSchemes(schemeResults);
  const recommended = ranking[0] || null;

  for (const item of ranking) {
    if (schemeResults[item.schemeId]) {
      schemeResults[item.schemeId].sustainabilityScore = item.sustainabilityScore;
      schemeResults[item.schemeId].rank = item.rank;
    }
  }

  return {
    assessmentName: String(payload.assessmentName || '消耗计算任务'),
    engine: buildEngineCatalog()[0],
    generatedAt: new Date().toISOString(),
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
    moduleKey: 'consumption-calculation',
    payload,
    assessmentName: String(payload.assessmentName || '消耗计算任务'),
    algorithm: {
      key: 'consumption-evaluation',
      name: '消耗计算评估',
    },
    requestMeta: {
      flow: 'consumption-evaluate',
    },
  });
}

function normalizeConsumptionEvaluationResult(rawResult, payload, engine, gatewayMeta) {
  const normalized = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
    ? cloneData(rawResult)
    : { result: rawResult };

  return {
    ...normalized,
    assessmentName: String(normalized.assessmentName || payload.assessmentName || '消耗计算任务'),
    engine: {
      ...cloneData(engine),
      status: 'active',
    },
    algorithmGateway: buildAlgorithmGatewayMeta(engine, gatewayMeta),
  };
}

export function getConsumptionTemplate() {
  return buildConsumptionTemplate();
}

export async function evaluateConsumption(payload = {}, options = {}) {
  const { db } = options;
  const engineCatalog = buildEngineCatalog();
  const engine = resolveEngineByKey(engineCatalog, payload.engine || 'builtin');
  const assessmentName = String(payload.assessmentName || '消耗计算任务');

  if (!engine) {
    const error = new Error('不支持的消耗计算引擎。');
    error.status = 400;
    error.code = 'CONSUMPTION_ENGINE_UNSUPPORTED';
    error.type = 'missing_data';
    throw error;
  }

  if (engine.key !== 'builtin' && engine.status !== 'active') {
    const error = new Error(`${engine.label}当前仅保留扩展位，尚未接入实际计算服务。`);
    error.status = 400;
    error.code = 'CONSUMPTION_ENGINE_NOT_READY';
    error.type = 'missing_data';
    throw error;
  }

  const algorithmKey = 'consumption-evaluation';
  const algorithmName = '消耗计算评估';
  const requestSummary = summarizeAlgorithmPayload(payload);

  if (engine.key === 'builtin') {
    const result = evaluateWithBuiltinEngine(payload);
    const normalizedResult = normalizeConsumptionEvaluationResult(result, payload, engine, {
      status: 'succeeded',
      durationMs: 0,
      httpStatus: 200,
      requestId: '',
    });
    recordAlgorithmCall(db, {
      moduleKey: 'consumption',
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
    const normalizedResult = normalizeConsumptionEvaluationResult(
      external.result,
      payload,
      engine,
      external.callMeta,
    );
    recordAlgorithmCall(db, {
      moduleKey: 'consumption',
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
      moduleKey: 'consumption',
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
      errorCode: error?.code || 'CONSUMPTION_ENGINE_FAILED',
      errorMessage: error?.message || '消耗计算外部算法执行失败。',
      requestPayload: requestSummary,
      responsePayload: error?.details || {},
    });
    throw error;
  }
}
