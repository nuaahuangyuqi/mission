import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __planningRuntimeTestHooks,
  evaluatePlanning,
  evaluatePlanningRealtimeStep,
  getPlanningTemplate,
  testPlanningLlm,
  validatePlanning,
} from './planning-runtime.js';

const {
  buildSupportPlan,
  executeLocalPythonStep,
  normalizeSupportPlanningOptions,
} = __planningRuntimeTestHooks;

function createBattlePlannerThreatOutput() {
  return {
    ok: true,
    implementationStatus: 'implemented',
    threatLevel: '高',
    threatScore: 82,
    enemyIntentions: [],
    fireCoverage: [
      {
        id: 'fire-1',
        name: '东侧防空节点',
        threatScore: 86,
        coordinates: [118.12, 32.04, 0],
      },
    ],
    targetAssessments: [
      {
        id: 'target-001',
        name: '东侧防空节点',
        category: 'air_defense',
        threatScore: 86,
        valueScore: 78,
        location: {
          coordinates: [118.12, 32.04],
          locationDescription: '东侧高地',
        },
        sourceTarget: {
          id: 'target-001',
          name: '东侧防空节点',
          subCategory: 'manportable_air_defense',
        },
      },
      {
        id: 'target-002',
        name: '北侧通信中继站',
        category: 'command_control',
        threatScore: 64,
        valueScore: 88,
        location: {
          coordinates: [118.22, 32.1],
          locationDescription: '北侧山脊',
        },
        sourceTarget: {
          id: 'target-002',
          name: '北侧通信中继站',
          subCategory: 'communication_relay',
        },
      },
    ],
  };
}

function createBattlePlannerFriendlyUpload() {
  return {
    fileName: 'friendly-force.txt',
    fileExtension: '.txt',
    fileContentBase64: Buffer.from([
      '二型武装直升机: 8 架',
      '运输直升机: 4 架',
      '侦察直升机: 2 架',
      '空地导弹: 32 枚',
      '火箭弹: 180 发',
      '航炮弹: 4200 发',
      '机降突击人员: 60 名',
    ].join('\n'), 'utf8').toString('base64'),
  };
}

function createBattlePlannerCsvFriendlyUpload() {
  return {
    fileName: 'friendly-force.csv',
    fileExtension: '.csv',
    fileContentBase64: Buffer.from([
      'name,count',
      '二型武装直升机,8',
      '运输直升机,4',
      '空地导弹,32',
      '火箭弹,180',
    ].join('\n'), 'utf8').toString('base64'),
  };
}

function createBattlePlannerNoWeaponsFriendlyUpload() {
  return {
    fileName: 'friendly-no-weapons.json',
    fileExtension: '.json',
    fileContentBase64: Buffer.from(JSON.stringify({
      friendly_forces: {
        helicopters: [
          {
            model: '二型武装直升机',
            role: 'armed',
            available: 4,
            capabilities: ['防空压制', '火力打击', '火力压制', '护航'],
            weapon_capacity: { 空地导弹: 4, 火箭弹: 16 },
            personnel_capacity: 0,
          },
          {
            model: '运输直升机',
            role: 'transport',
            available: 3,
            capabilities: ['机降突击', '人员输送'],
            weapon_capacity: {},
            personnel_capacity: 12,
          },
        ],
        weapons: [],
        personnel: [{ role: '机降突击人员', available: 24 }],
        constraints: { preserve_reserve: false },
      },
    }), 'utf8').toString('base64'),
  };
}

function createRealtimeForceGroupingOutput() {
  return {
    implementationStatus: 'implemented',
    preferredSchemeId: 'scheme-realtime-force',
    preferredScheme: {
      id: 'scheme-realtime-force',
      name: '实时编组结果',
      score: 86,
      groups: [
        {
          id: 'group-realtime-1',
          name: '实时主攻群',
          role: 'strike',
          unitCount: 2,
          firepower: 88,
          protection: 64,
          reconCoverage: 42,
          endurance: 55,
          units: [
            {
              id: 'unit-realtime-1',
              name: '武装直升机一号',
              category: 'attack_helicopter',
              role: 'strike',
              strength: 4,
              readiness: 'available',
              coordinates: [118.05, 32.0, 0],
              capabilities: {
                firepower: 88,
                protection: 62,
                recon: 44,
                support: 52,
              },
              weaponLoadout: [
                { name: '空地导弹', quantity: 8 },
              ],
            },
            {
              id: 'unit-realtime-2',
              name: '侦察直升机一号',
              category: 'recon_helicopter',
              role: 'recon',
              strength: 2,
              readiness: 'available',
              coordinates: [118.07, 32.02, 0],
              capabilities: {
                firepower: 35,
                protection: 48,
                recon: 86,
                support: 58,
              },
            },
          ],
        },
      ],
    },
  };
}

function createRealtimeSingleStepTask(algorithmId = 'target-allocation') {
  return {
    id: 'realtime-single-step-task',
    name: '实时单步任务',
    category: '测试任务',
    steps: [
      {
        id: `step-${algorithmId}`,
        order: 1,
        name: algorithmId === 'target-allocation' ? '作战目标自动分配' : algorithmId,
        algorithmId,
        objective: '实时执行测试',
        consumes: ['前置结果'],
        produces: ['实时产物'],
      },
    ],
  };
}

async function runBattlePlannerForceGroupingForTest() {
  const template = getPlanningTemplate();
  const algorithm = template.algorithms.find((item) => item.id === 'force-grouping');
  const variant = algorithm?.variants.find((item) => item.id === 'force-grouping:force-grouping-local');
  assert.ok(algorithm);
  assert.ok(variant);
  const result = await executeLocalPythonStep(
    variant,
    { id: 'test-force-grouping-local', name: 'Battle Planner 编组本地实现测试' },
    { id: 'step-force-grouping', name: '作战力量智能编组' },
    algorithm,
    {
      stageOutputs: {
        'enemy-threat-analysis': createBattlePlannerThreatOutput(),
      },
    },
    { dataset: {} },
    {
      builtinMethodKey: 'hybrid-balanced',
      uploadedFiles: [createBattlePlannerFriendlyUpload()],
      options: {
        llmBackend: 'mock',
        expectedGroupCount: 4,
      },
    },
    {},
  );
  return { result, threat: createBattlePlannerThreatOutput() };
}

test('planning template registers active local Python algorithm variants', () => {
  const template = getPlanningTemplate();
  const expectedVariants = {
    'enemy-threat-analysis': 'enemy-threat-analysis:enemy-threat-analysis-local',
    'force-grouping': 'force-grouping:force-grouping-local',
    'target-allocation': 'target-allocation:target-allocation-local',
    'airborne-landing-site-selection': 'airborne-landing-site-selection:airlanding-zone-local',
  };

  for (const [algorithmId, variantId] of Object.entries(expectedVariants)) {
    const algorithm = template.algorithms.find((item) => item.id === algorithmId);
    const variant = algorithm?.variants.find((item) => item.id === variantId);
    assert.ok(variant, `${variantId} should be registered`);
    assert.equal(variant.type, 'external-model');
    assert.equal(variant.executionMode, 'local-python');
    assert.equal(variant.status, 'active');
    if (['force-grouping', 'target-allocation'].includes(algorithmId)) {
      assert.equal(variant.projectPath, 'algorithms/battle-planner');
      assert.equal(variant.packageName, 'battle_planner');
    }
    if (algorithmId !== 'target-allocation') {
      assert.ok(variant.parameterSchema.length > 0);
    }
  }
});

test('target allocation separates builtin methods from intelligent local implementation', () => {
  const template = getPlanningTemplate();
  const algorithm = template.algorithms.find((item) => item.id === 'target-allocation');
  assert.ok(algorithm);
  assert.equal(algorithm.defaultConfig.builtinMethodKey, 'multi-objective');
  assert.deepEqual(
    algorithm.builtinMethods.map((item) => item.key),
    ['hungarian', 'ant-colony', 'multi-objective'],
  );
  assert.equal(algorithm.builtinMethods.some((item) => item.key === 'intelligent-allocation'), false);
  const intelligentVariant = algorithm.variants.find((item) => item.id === 'target-allocation:target-allocation-local');
  assert.ok(intelligentVariant);
  assert.equal(intelligentVariant.name, '智能分配算法');
  assert.equal(intelligentVariant.executionMode, 'local-python');
  assert.equal(intelligentVariant.status, 'active');
  assert.equal(intelligentVariant.projectPath, 'algorithms/battle-planner');
});

test('battle planner force grouping local implementation returns platform grouping contract', async () => {
  const { result } = await runBattlePlannerForceGroupingForTest();
  const output = result.structuredOutput;

  assert.equal(output.algorithmModel, 'battle-planner-v1');
  assert.equal(output.builtinMethodLabel, '智能编组算法');
  assert.ok(output.battlePlannerResult);
  assert.ok(output.battlePlannerResult.task_groups.length > 0);
  assert.deepEqual(
    output.schemes.map((item) => item.strategyKey).sort(),
    ['balanced', 'loss-minimized', 'resource-minimized'].sort(),
  );
  assert.ok(output.comparison.every((item) => item.strategyLabel));
  assert.ok(output.preferredScheme.groups.length > 0);
  assert.ok(output.preferredScheme.groups.some((group) => group.units.length > 0));
  const assaultFirepowerGroup = output.preferredScheme.groups.find((group) => (
    Number(group.firepowerBreakdown?.weaponEquipmentPower || 0) > 0
    && Number(group.firepowerBreakdown?.transportPersonnelPower || 0) > 0
  ));
  assert.ok(assaultFirepowerGroup);
  assert.equal(assaultFirepowerGroup.firepower, assaultFirepowerGroup.firepowerBreakdown.combinedFirepower);
  assert.equal(assaultFirepowerGroup.firepower, assaultFirepowerGroup.firepowerBreakdown.weaponEquipmentPower);
  assert.equal(assaultFirepowerGroup.firepowerBreakdown.weighting.transportPersonnel, 0);
  assert.equal(assaultFirepowerGroup.firepowerBreakdown.hasLoadedWeapon, true);
  assert.ok(Number(assaultFirepowerGroup.firepowerBreakdown.armedHelicopterCount || 0) > 0);
  assert.ok(Number(assaultFirepowerGroup.firepowerBreakdown.transportHelicopterCount || 0) > 0);
  assert.ok(Number(assaultFirepowerGroup.firepowerBreakdown.personnelCount || 0) > 0);
  assert.ok(assaultFirepowerGroup.weaponSummary.length > 0);
  assert.ok(assaultFirepowerGroup.units.some((unit) => unit.weaponLoadout?.length > 0));
  assert.ok(assaultFirepowerGroup.units.some((unit) => unit.personnelLoadout?.length > 0));
  const armedUnit = assaultFirepowerGroup.units.find((unit) => ['armed', 'escort'].includes(unit.role));
  assert.ok(armedUnit?.weaponLoadout?.some((item) => item.weaponName && Number(item.quantity || 0) > 0));
  assert.match(assaultFirepowerGroup.firepowerSummary, /武器装载/);
  assert.ok(Number(output.preferredScheme.metrics.averageTransportPersonnelPower || 0) > 0);
  assert.ok(output.importedFiles.some((file) => file.fileName === 'friendly-force.txt'));
});

test('battle planner force grouping keeps non-fire scores but zeroes firepower without loaded weapons', async () => {
  const template = getPlanningTemplate();
  const algorithm = template.algorithms.find((item) => item.id === 'force-grouping');
  const variant = algorithm?.variants.find((item) => item.id === 'force-grouping:force-grouping-local');
  const result = await executeLocalPythonStep(
    variant,
    { id: 'test-force-grouping-no-weapons', name: '无武器装载火力测试' },
    { id: 'step-force-grouping', name: '作战力量智能编组' },
    algorithm,
    {
      stageOutputs: {
        'enemy-threat-analysis': createBattlePlannerThreatOutput(),
      },
    },
    { dataset: {} },
    {
      uploadedFiles: [createBattlePlannerNoWeaponsFriendlyUpload()],
      options: { llmBackend: 'mock' },
    },
    {},
  );

  const output = result.structuredOutput;
  const fireGroups = output.preferredScheme.groups.filter((group) => (
    ['防空压制', '火力打击', '火力压制', '通信压制', '破袭打击'].includes(group.taskType)
  ));
  assert.ok(fireGroups.length > 0);
  assert.ok(fireGroups.every((group) => group.firepower === 0));
  assert.ok(fireGroups.every((group) => group.firepowerBreakdown.weaponEquipmentPower === 0));
  assert.ok(fireGroups.every((group) => group.firepowerBreakdown.hasLoadedWeapon === false));
  assert.ok(fireGroups.every((group) => group.strikeWeaponRequirementMet === false));
  assert.ok(fireGroups.every((group) => group.weaponSummary.length === 0));
  assert.ok(fireGroups.every((group) => group.units.every((unit) => (unit.weaponLoadout || []).length === 0)));
  assert.ok(fireGroups.some((group) => Number(group.mobility || 0) > 0));
  assert.ok(fireGroups.some((group) => group.issues.some((issue) => issue.severity === 'error' && /未形成实际武器装载/.test(issue.message))));
});

test('battle planner force grouping converts csv friendly uploads to text', async () => {
  const template = getPlanningTemplate();
  const algorithm = template.algorithms.find((item) => item.id === 'force-grouping');
  const variant = algorithm?.variants.find((item) => item.id === 'force-grouping:force-grouping-local');
  const result = await executeLocalPythonStep(
    variant,
    { id: 'test-force-grouping-csv', name: 'CSV 友方资料转换测试' },
    { id: 'step-force-grouping', name: '作战力量智能编组' },
    algorithm,
    {
      stageOutputs: {
        'enemy-threat-analysis': createBattlePlannerThreatOutput(),
      },
    },
    { dataset: {} },
    {
      uploadedFiles: [createBattlePlannerCsvFriendlyUpload()],
      options: { llmBackend: 'mock' },
    },
    {},
  );

  const output = result.structuredOutput;
  const csvImport = output.importedFiles.find((file) => file.fileName === 'friendly-force.csv');
  assert.ok(csvImport);
  assert.equal(csvImport.convertedToText, true);
  assert.ok(output.preferredScheme.groups.length > 0);
});

test('battle planner force grouping rejects missing upstream threat output', async () => {
  const template = getPlanningTemplate();
  const algorithm = template.algorithms.find((item) => item.id === 'force-grouping');
  const variant = algorithm?.variants.find((item) => item.id === 'force-grouping:force-grouping-local');
  await assert.rejects(
    () => executeLocalPythonStep(
      variant,
      { id: 'test-force-grouping-missing-upstream', name: '缺上游测试' },
      { id: 'step-force-grouping', name: '作战力量智能编组' },
      algorithm,
      { stageOutputs: {} },
      { dataset: {} },
      {
        uploadedFiles: [createBattlePlannerFriendlyUpload()],
        options: { llmBackend: 'mock' },
      },
      {},
    ),
    /缺少上一步敌情威胁分析结果/,
  );
});

test('battle planner force grouping rejects missing friendly documents', async () => {
  const template = getPlanningTemplate();
  const algorithm = template.algorithms.find((item) => item.id === 'force-grouping');
  const variant = algorithm?.variants.find((item) => item.id === 'force-grouping:force-grouping-local');
  await assert.rejects(
    () => executeLocalPythonStep(
      variant,
      { id: 'test-force-grouping-missing-docs', name: '缺文档测试' },
      { id: 'step-force-grouping', name: '作战力量智能编组' },
      algorithm,
      {
        stageOutputs: {
          'enemy-threat-analysis': createBattlePlannerThreatOutput(),
        },
      },
      { dataset: {} },
      {
        uploadedFiles: [],
        options: { llmBackend: 'mock' },
      },
      {},
    ),
    /缺少我方资源库数据或上传文件/,
  );
});

test('intelligent target allocation local implementation returns platform contract and visualization entities', async () => {
  const template = getPlanningTemplate();
  const algorithm = template.algorithms.find((item) => item.id === 'target-allocation');
  const variant = algorithm?.variants.find((item) => item.id === 'target-allocation:target-allocation-local');
  const { result: groupingResult, threat } = await runBattlePlannerForceGroupingForTest();
  const grouping = JSON.parse(JSON.stringify(groupingResult.structuredOutput));
  grouping.candidateTargets = grouping.candidateTargets.map((target) => ({
    ...target,
    coordinates: [0, 0, 0],
    coordinateSource: '',
  }));
  assert.ok(variant);
  const result = await executeLocalPythonStep(
    variant,
    { id: 'test-target-allocation-local', name: '目标分配本地实现测试' },
    { id: 'step-target-allocation', name: '作战目标自动分配' },
    algorithm,
    {
      stageOutputs: {
        'enemy-threat-analysis': threat,
        'force-grouping': grouping,
      },
    },
    { dataset: {} },
    {
      builtinMethodKey: 'multi-objective',
      options: {
        objectivePreference: 'balanced',
        validationMode: 'strict',
        maxAssignmentsPerGroup: 2,
      },
    },
    {},
  );

  const output = result.structuredOutput;
  assert.equal(output.builtinMethodKey, 'intelligent-allocation');
  assert.equal(output.builtinMethodLabel, '智能分配算法');
  assert.equal(output.preferredPlanMethodKey, 'intelligent-allocation');
  assert.equal(output.planningBasis.source, 'battlePlannerResult.task_groups');
  assert.deepEqual(
    output.comparedPlans.map((item) => item.strategyKey).sort(),
    ['balanced', 'loss-minimized', 'resource-minimized'].sort(),
  );
  assert.ok(output.comparedPlans.every((item) => item.methodKey === 'intelligent-allocation'));
  assert.ok(output.comparedPlans.every((item) => item.visualization?.entities?.length > 0));
  assert.equal(output.preferredPlan.strategyKey, 'balanced');
  assert.equal(output.preferredPlanId, output.preferredPlan.id);
  assert.ok(output.candidateTargets.length > 0);
  assert.ok(output.groups.length > 0);
  assert.ok(output.groups.every((group) => group.firepowerBreakdown));
  assert.ok(output.preferredPlan.assignments.length > 0);
  assert.ok(output.preferredPlan.assignments.every((assignment) => assignment.groupFirepowerBreakdown));
  assert.ok(output.preferredPlan.assignments.some((assignment) => (
    Number(assignment.groupFirepowerBreakdown?.weaponEquipmentPower || 0) > 0
    && Number(assignment.groupFirepowerBreakdown?.transportPersonnelPower || 0) > 0
  )));
  assert.ok(output.preferredPlan.assignments.every((assignment) => (
    assignment.groupFirepower === assignment.groupFirepowerBreakdown.combinedFirepower
  )));
  assert.ok(output.preferredPlan.assignments.every((assignment) => (
    assignment.groupFirepower === assignment.groupFirepowerBreakdown.weaponEquipmentPower
  )));
  assert.ok(output.platforms.some((platform) => (platform.weaponLoadout || []).length > 0));
  assert.ok(Number(output.preferredPlan.metrics.averageGroupFirepower || 0) > 0);
  assert.ok(Number(output.preferredPlan.metrics.averageWeaponEquipmentPower || 0) > 0);
  assert.ok(Number(output.preferredPlan.metrics.averageTransportPersonnelPower || 0) > 0);
  assert.ok(Number(output.comparedPlans[0].metrics.averageGroupFirepower || 0) > 0);
  const eastTarget = output.candidateTargets.find((item) => item.name === '东侧防空节点');
  const northTarget = output.candidateTargets.find((item) => item.name === '北侧通信中继站');
  assert.deepEqual(eastTarget?.coordinates?.slice(0, 2), [118.12, 32.04]);
  assert.deepEqual(northTarget?.coordinates?.slice(0, 2), [118.22, 32.1]);
  assert.ok(output.originalTargets.some((item) => item.name === '东侧防空节点'));
  assert.ok(output.originalTargets.some((item) => item.name === '北侧通信中继站'));
  assert.ok(output.visualization.entities.some((item) => String(item.id).startsWith('allocation-group-')));
  assert.ok(output.visualization.entities.some((item) => String(item.id).startsWith('allocation-target-')));
  assert.ok(output.visualization.entities.some((item) => String(item.id).startsWith('allocation-original-target-')));
  assert.ok(output.visualization.entities.some((item) => String(item.id).startsWith('allocation-order-')));
  const eastTargetEntity = output.visualization.entities.find((item) => (
    String(item.id).startsWith('allocation-target-') && item.name === '东侧防空节点'
  ));
  const northTargetEntity = output.visualization.entities.find((item) => (
    String(item.id).startsWith('allocation-target-') && item.name === '北侧通信中继站'
  ));
  const eastOriginalTargetEntity = output.visualization.entities.find((item) => (
    String(item.id).startsWith('allocation-original-target-') && item.name === '原始目标-东侧防空节点'
  ));
  const groupEntity = output.visualization.entities.find((item) => String(item.id).startsWith('allocation-group-'));
  const orderEntity = output.visualization.entities.find((item) => String(item.id).startsWith('allocation-order-'));
  assert.deepEqual(eastTargetEntity?.coordinates?.slice(0, 2), [118.12, 32.04]);
  assert.deepEqual(northTargetEntity?.coordinates?.slice(0, 2), [118.22, 32.1]);
  assert.deepEqual(eastOriginalTargetEntity?.coordinates?.slice(0, 2), [118.12, 32.04]);
  assert.equal(eastTargetEntity?.visible, false);
  assert.equal(eastTargetEntity?.meta?.showLabel, false);
  assert.equal(eastOriginalTargetEntity?.visible, true);
  assert.equal(eastOriginalTargetEntity?.meta?.showLabel, true);
  assert.equal(groupEntity?.meta?.showLabel, false);
  assert.equal(orderEntity?.meta?.showLabel, false);
  assert.equal(output.preferredPlan.visualization, output.visualization);
  assert.ok(Array.isArray(output.validationFindings));
  assert.ok(output.systemBestPlanMethodKey);
});

test('intelligent target allocation blocks fire strike assignments without loaded weapons', async () => {
  const template = getPlanningTemplate();
  const forceAlgorithm = template.algorithms.find((item) => item.id === 'force-grouping');
  const forceVariant = forceAlgorithm?.variants.find((item) => item.id === 'force-grouping:force-grouping-local');
  const targetAlgorithm = template.algorithms.find((item) => item.id === 'target-allocation');
  const targetVariant = targetAlgorithm?.variants.find((item) => item.id === 'target-allocation:target-allocation-local');
  const threat = createBattlePlannerThreatOutput();
  const groupingResult = await executeLocalPythonStep(
    forceVariant,
    { id: 'test-force-grouping-no-weapons-allocation', name: '目标分配无武器编组测试' },
    { id: 'step-force-grouping', name: '作战力量智能编组' },
    forceAlgorithm,
    {
      stageOutputs: {
        'enemy-threat-analysis': threat,
      },
    },
    { dataset: {} },
    {
      uploadedFiles: [createBattlePlannerNoWeaponsFriendlyUpload()],
      options: { llmBackend: 'mock' },
    },
    {},
  );

  const allocationResult = await executeLocalPythonStep(
    targetVariant,
    { id: 'test-target-allocation-no-weapons', name: '无武器目标分配测试' },
    { id: 'step-target-allocation', name: '作战目标自动分配' },
    targetAlgorithm,
    {
      stageOutputs: {
        'enemy-threat-analysis': threat,
        'force-grouping': groupingResult.structuredOutput,
      },
    },
    { dataset: {} },
    {
      options: {
        validationMode: 'strict',
        maxAssignmentsPerGroup: 2,
      },
    },
    {},
  );

  const output = allocationResult.structuredOutput;
  assert.equal(output.validationSummary.status, 'fail');
  assert.ok(output.validationFindings.some((item) => item.title === '火力打击缺少武器装载'));
  assert.ok(output.preferredPlan.assignments.every((assignment) => !(assignment.groupRole === 'strike' && assignment.groupFirepower === 0)));
  assert.ok(output.groups.some((group) => group.taskType === '防空压制' && group.firepower === 0));
  assert.ok(Number(output.preferredPlan.stats.blockedAssignmentCount || 0) > 0);
});

test('local Python LLM parameter schema supports external API and Ollama backends', () => {
  const template = getPlanningTemplate();
  const enemy = template.algorithms.find((item) => item.id === 'enemy-threat-analysis');
  const force = template.algorithms.find((item) => item.id === 'force-grouping');
  for (const variant of [
    enemy?.variants.find((item) => item.runtimeKey === 'enemy-threat-analysis-local'),
    force?.variants.find((item) => item.runtimeKey === 'force-grouping-local'),
  ]) {
    assert.ok(variant);
    const fields = new Map(variant.parameterSchema.map((field) => [field.key, field]));
    assert.equal(fields.get('llmBackend')?.type, 'select');
    assert.deepEqual(fields.get('llmBackend')?.options.map((item) => item.value), ['openai-compatible', 'ollama']);
    assert.equal(fields.get('llmApiKey')?.type, 'password');
    assert.equal(fields.get('llmBaseUrl')?.section, 'llm');
    assert.equal(fields.has('ollamaHost'), false);
    assert.equal(variant.defaultOptions.llmBackend, 'openai-compatible');
    assert.equal(variant.defaultOptions.ollamaHost, 'http://localhost:11434');
  }
});

test('LLM test endpoint validation rejects incomplete configuration before network calls', async () => {
  await assert.rejects(
    () => testPlanningLlm({ runtimeOptions: { llmBackend: 'ollama', ollamaHost: 'http://localhost:11434' } }),
    /请填写模型名称/,
  );

  await assert.rejects(
    () => testPlanningLlm({
      runtimeOptions: {
        llmBackend: 'openai-compatible',
        llmModel: 'demo-model',
        llmBaseUrl: 'https://example.invalid/v1',
      },
    }),
    /请填写外部 API Key/,
  );
});

test('Ollama LLM test request disables thinking mode', async () => {
  const originalFetch = globalThis.fetch;
  let capturedPayload = null;
  globalThis.fetch = async (url, init = {}) => {
    capturedPayload = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return JSON.stringify({ message: { content: '{"ok":true,"message":"pong"}' } });
      },
    };
  };

  try {
    const defaultResult = await testPlanningLlm({
      runtimeOptions: {
        llmBackend: 'ollama',
        llmModel: 'qwen3:8b',
        ollamaHost: 'http://127.0.0.1:11434',
      },
    });
    assert.equal(defaultResult.ok, true);
    assert.equal(defaultResult.backend, 'ollama');
    assert.equal(capturedPayload.think, false);
    assert.equal(capturedPayload.options.num_ctx, 262144);

    const result = await testPlanningLlm({
      runtimeOptions: {
        llmBackend: 'ollama',
        llmModel: 'qwen3:8b',
        ollamaHost: 'http://127.0.0.1:11434',
        llmNumCtx: 12288,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.backend, 'ollama');
    assert.equal(capturedPayload.think, false);
    assert.equal(capturedPayload.options.num_ctx, 12288);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('planning validation accepts local Python variants in a mixed task flow', async () => {
  const validation = await validatePlanning({
    taskDefinition: {
      id: 'local-python-flow-validation',
      name: '本地 Python 算法接入校验',
      category: '机降任务',
      steps: [
        {
          id: 'step-threat-analysis',
          order: 1,
          name: '敌情威胁自动分析',
          algorithmId: 'enemy-threat-analysis',
          objective: 'review',
          consumes: ['敌情数据源', '本地文件'],
          produces: ['威胁模型'],
        },
        {
          id: 'step-force-grouping',
          order: 2,
          name: '作战力量智能编组',
          algorithmId: 'force-grouping',
          objective: 'review',
          consumes: ['威胁模型', '我方兵力'],
          produces: ['编组方案'],
        },
        {
          id: 'step-target-allocation',
          order: 3,
          name: '作战目标自动分配',
          algorithmId: 'target-allocation',
          objective: 'review',
          consumes: ['威胁模型', '编组方案'],
          produces: ['目标分配'],
        },
        {
          id: 'step-airlanding',
          order: 4,
          name: '机降地域优化选择',
          algorithmId: 'airborne-landing-site-selection',
          objective: 'review',
          consumes: ['威胁模型', '目标分配'],
          produces: ['机降地域'],
        },
      ],
    },
    bindings: {
      'step-threat-analysis': 'enemy-threat-analysis:enemy-threat-analysis-local',
      'step-force-grouping': 'force-grouping:force-grouping-local',
      'step-target-allocation': 'target-allocation:builtin',
      'step-airlanding': 'airborne-landing-site-selection:airlanding-zone-local',
    },
    algorithmInputs: {
      'enemy-threat-analysis': {
        selectedSourceIds: [],
        uploadedFiles: [{ fileName: 'enemy.txt', fileContentBase64: '5pWM5oOF5oOF5oql' }],
        options: {
          runtimeOptions: {
            'enemy-threat-analysis-local': {
              llmApiKey: 'test-key',
              llmStream: true,
            },
          },
        },
      },
      'force-grouping': {
        selectedSourceIds: [],
        uploadedFiles: [{ fileName: 'force.txt', fileContentBase64: '5oiR5pa55YW15Yqb' }],
        options: {
          runtimeOptions: {
            'force-grouping-local': {
              llmApiKey: 'test-key',
              expectedGroupCount: 4,
            },
          },
        },
      },
      'target-allocation': {
        builtinMethodKey: 'multi-objective',
        options: {},
      },
      'airborne-landing-site-selection': {
        options: {
          runtimeOptions: {
            'airlanding-zone-local': {
              candidateCount: 5,
            },
          },
        },
      },
    },
  });

  assert.equal(validation.ok, true);
  assert.deepEqual(
    validation.checks.map((item) => item.bindingId),
    [
      'enemy-threat-analysis:enemy-threat-analysis-local',
      'force-grouping:force-grouping-local',
      'target-allocation:builtin',
      'airborne-landing-site-selection:airlanding-zone-local',
    ],
  );
});

test('realtime step execution injects upstream artifacts into single algorithm context', async () => {
  const result = await evaluatePlanningRealtimeStep({
    assessmentName: '实时目标分配测试',
    taskDefinition: createRealtimeSingleStepTask('target-allocation'),
    algorithmId: 'target-allocation',
    stepId: 'step-target-allocation',
    bindings: {
      'step-target-allocation': 'target-allocation:target-allocation-local',
    },
    algorithmInputs: {
      'target-allocation': {
        builtinMethodKey: 'multi-objective',
        selectedSourceIds: [],
        uploadedFiles: [],
        options: {
          objectivePreference: 'balanced',
          validationMode: 'standard',
          maxAssignmentsPerGroup: 2,
        },
      },
    },
    inputResultRefs: [
      { sourceType: 'task-run-step', taskId: 101, runId: 201, stepId: 'step-threat-analysis' },
      { sourceType: 'task-run-step', taskId: 102, runId: 202, stepId: 'step-force-grouping' },
    ],
    inputArtifacts: [
      {
        id: 'task-run-step:101:201:step-threat-analysis',
        sourceType: 'task-run-step',
        algorithmId: 'enemy-threat-analysis',
        stepId: 'step-threat-analysis',
        displayName: '历史敌情结果',
        resultPayload: {
          structuredOutput: createBattlePlannerThreatOutput(),
        },
      },
      {
        id: 'task-run-step:102:202:step-force-grouping',
        sourceType: 'task-run-step',
        algorithmId: 'force-grouping',
        stepId: 'step-force-grouping',
        displayName: '历史编组结果',
        resultPayload: {
          structuredOutput: createRealtimeForceGroupingOutput(),
        },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'realtime-step');
  assert.equal(result.step.algorithm.id, 'target-allocation');
  assert.equal(result.context.injectedArtifactCount, 2);
  assert.deepEqual(
    result.inputResultRefs.map((item) => item.sourceType),
    ['task-run-step', 'task-run-step'],
  );
  assert.ok(result.structuredOutput.preferredPlan.assignments.length > 0);
});

test('realtime step execution rejects duplicate upstream algorithm artifacts', async () => {
  await assert.rejects(
    () => evaluatePlanningRealtimeStep({
      assessmentName: '重复上游结果测试',
      taskDefinition: createRealtimeSingleStepTask('target-allocation'),
      algorithmId: 'target-allocation',
      stepId: 'step-target-allocation',
      bindings: {
        'step-target-allocation': 'target-allocation:builtin',
      },
      algorithmInputs: {
        'target-allocation': {
          builtinMethodKey: 'multi-objective',
          selectedSourceIds: [],
          uploadedFiles: [],
          options: {},
        },
      },
      inputArtifacts: [
        {
          id: 'artifact-threat-1',
          algorithmId: 'enemy-threat-analysis',
          stepId: 'step-threat-analysis',
          resultPayload: { structuredOutput: createBattlePlannerThreatOutput() },
        },
        {
          id: 'artifact-threat-2',
          algorithmId: 'enemy-threat-analysis',
          stepId: 'step-threat-analysis-alt',
          resultPayload: { structuredOutput: createBattlePlannerThreatOutput() },
        },
      ],
    }),
    /同一算法类型一次只能选择一个输入产物/,
  );
});

function createSupportContext() {
  return {
    stageOutputs: {
      'force-grouping': {
        preferredScheme: {
          groups: [
            {
              name: '主攻群',
              unitCount: 6,
              firepower: 78,
              mobility: 56,
              endurance: 42,
              roleComposition: {
                strike: 4,
                cover: 1,
              },
            },
            {
              name: '保障群',
              unitCount: 4,
              firepower: 30,
              mobility: 38,
              endurance: 82,
              roleComposition: {
                support: 2,
                sustain: 2,
              },
            },
          ],
        },
      },
      'target-allocation': {
        preferredPlan: {
          assignments: [
            { id: 'assignment-1' },
            { id: 'assignment-2' },
          ],
        },
      },
      'method-planning': {
        preferredPlan: {
          missionType: 'fire-strike',
          routes: [
            {
              id: 'route-1',
              coordinates: [
                [118.1, 32.0, 0],
                [118.4, 32.2, 0],
                [118.8, 32.4, 0],
              ],
            },
          ],
          phases: [
            { name: '集结', startOffsetMin: 0, endOffsetMin: 12 },
            { name: '突击接敌', startOffsetMin: 12, endOffsetMin: 24 },
            { name: '主行动', startOffsetMin: 24, endOffsetMin: 46 },
            { name: '收拢', startOffsetMin: 46, endOffsetMin: 60 },
          ],
          metrics: {
            totalDistanceKm: 128,
            averageThreatScore: 67,
          },
        },
      },
    },
  };
}

test('support planning uses structured damage inputs and resource constraints', () => {
  const context = createSupportContext();
  const options = normalizeSupportPlanningOptions({
    reserveRatio: 18,
    airspaceControl: 'tight',
    damageForecast: {
      equipmentLossRate: 18.5,
      casualtyRate: 9.2,
      damagedEquipmentCount: 7,
      woundedCount: 28,
      criticalWindowCount: 3,
    },
    resourcePool: {
      stock: {
        ammo: 18,
        fuel: 20,
        maintenance: 12,
        medical: 4,
        airspace: 2.5,
        command: 2,
      },
      transport: {
        sorties: 2,
        liftTonnagePerSortie: 3,
        maintenanceTeams: 1,
        medicalTeams: 1,
        airspaceCells: 1,
        commandLinks: 2,
      },
    },
  });

  const plan = buildSupportPlan('loss-aware', context, { options }, {});
  const ammoRequirement = plan.requirements.find((item) => item.key === 'ammo');
  const ammoAllocations = plan.allocations.filter((item) => item.serviceKey === 'ammo');
  const allocatedAmmo = ammoAllocations.reduce((total, item) => total + Number(item.quantity || 0), 0);

  assert.equal(plan.damageForecast.equipmentLossRate, 18.5);
  assert.equal(plan.damageForecast.woundedCount, 28);
  assert.ok(ammoRequirement);
  assert.ok(ammoRequirement.gap > 0);
  assert.ok(ammoRequirement.supplied <= ammoRequirement.dispatchableStock);
  assert.ok(ammoRequirement.supplied <= ammoRequirement.transportLimit);
  assert.ok(ammoRequirement.coverageRate <= 100);
  assert.equal(Number(allocatedAmmo.toFixed(1)), ammoRequirement.supplied);
  assert.ok(plan.resourcePool.bottlenecks.length > 0);
});

test('support planning rejects missing upstream grouping results', () => {
  const context = createSupportContext();
  context.stageOutputs['force-grouping'] = { preferredScheme: { groups: [] } };

  assert.throws(
    () => buildSupportPlan('demand-driven', context, {
      options: normalizeSupportPlanningOptions({}),
    }, {}),
    /缺少有效的作战编组结果/,
  );
});

test('evaluatePlanning surfaces dependency validation errors for support-only task', async () => {
  await assert.rejects(
    () => evaluatePlanning({
      taskDefinition: {
        id: 'support-only-review',
        name: '保障单步校验',
        category: 'review',
        steps: [
          {
            id: 'step-support-planning',
            order: 1,
            name: '作战保障自动规划',
            algorithmId: 'support-planning',
            objective: 'review',
            consumes: ['作战方法方案', '作战编组方案', '战损预测输入', '保障资源池'],
            produces: ['保障计划'],
          },
        ],
      },
      bindings: {
        'step-support-planning': 'support-planning:builtin',
      },
      algorithmInputs: {
        'support-planning': {
          builtinMethodKey: 'demand-driven',
          options: normalizeSupportPlanningOptions({}),
        },
      },
    }),
    /缺少上游步骤产物/,
  );
});

test('enemy threat planning accepts uploaded txt files', async () => {
  const result = await evaluatePlanning({
    assessmentName: 'TXT 敌情材料规划测试',
    taskDefinition: {
      id: 'threat-txt-upload-review',
      name: 'TXT 敌情材料规划测试',
      category: 'review',
      steps: [
        {
          id: 'step-threat-analysis',
          order: 1,
          name: '敌情威胁自动分析',
          algorithmId: 'enemy-threat-analysis',
          objective: 'review',
          consumes: ['本地文件'],
          produces: ['威胁模型'],
        },
      ],
    },
    bindings: {
      'step-threat-analysis': 'enemy-threat-analysis:builtin',
    },
    algorithmInputs: {
      'enemy-threat-analysis': {
        builtinMethodKey: 'knowledge-fusion',
        selectedSourceIds: [],
        uploadedFiles: [
          {
            fileName: 'enemy-report.txt',
            fileExtension: '.txt',
            fileContentBase64: Buffer.from('敌方防空节点位于北侧高地。\n火力覆盖半径约 8 公里。', 'utf8').toString('base64'),
          },
        ],
        options: {},
      },
    },
  });

  assert.equal(result.execution.summary.completedSteps, 1);
  const output = result.execution.steps[0].structuredOutput;
  assert.equal(output.inputSummary.uploadedFileCount, 1);
  assert.equal(output.importedFiles[0].fileName, 'enemy-report.txt');
  assert.equal(output.importedFiles[0].fileExtension, '.txt');
  assert.match(output.importedFiles[0].summary, /防空节点/);
});

test('enemy threat analysis requires an explicit selected source or uploaded file', async () => {
  const rows = {
    sources: [{
      id: 1,
      name: '现有资源',
      type: 'database',
      format: 'JSON',
      status: '在线',
      description: '已有资源不应在未勾选时自动进入规划算法。',
      updated_at: '2026-05-17 10:00',
      preview_type: 'json',
      access_mode: 'sample',
      task_id: null,
    }],
    source_contents: [{
      source_id: 1,
      preview_type: 'json',
      payload: JSON.stringify({ text: '防空节点与火力覆盖示例。' }),
      created_at: '2026-05-17 10:00',
    }],
    intelligence: [{
      id: 1,
      camp: 'red',
      category: '防空',
      name: '红方示例节点',
      role: '防空警戒',
      latitude: 30.28,
      longitude: 120.18,
      strength: 5,
      readiness: '在线',
      tags: JSON.stringify(['防空']),
      source_id: 1,
      notes: '现有红方情报。',
      updated_at: '2026-05-17 10:00',
    }],
    environment: [],
    extractions: [],
  };
  const db = {
    prepare(sql) {
      if (sql.includes('FROM sources')) return { all: () => rows.sources };
      if (sql.includes('FROM source_contents')) return { all: () => rows.source_contents };
      if (sql.includes('FROM intelligence')) return { all: () => rows.intelligence };
      if (sql.includes('FROM environment')) return { all: () => rows.environment };
      if (sql.includes('FROM extractions')) return { all: () => rows.extractions };
      return { all: () => [] };
    },
  };

  await assert.rejects(
    () => evaluatePlanning({
      taskDefinition: {
        id: 'threat-only-explicit-input',
        name: '敌情威胁显式输入校验',
        category: 'review',
        steps: [
          {
            id: 'step-threat-analysis',
            order: 1,
            name: '敌情威胁自动分析',
            algorithmId: 'enemy-threat-analysis',
            objective: 'review',
            consumes: ['敌情数据源', '本地文件'],
            produces: ['威胁模型'],
          },
        ],
      },
      bindings: {
        'step-threat-analysis': 'enemy-threat-analysis:builtin',
      },
      algorithmInputs: {
        'enemy-threat-analysis': {
          builtinMethodKey: 'knowledge-fusion',
          selectedSourceIds: [],
          uploadedFiles: [],
          options: {},
        },
      },
    }, { db }),
    /请至少勾选一个资源库数据源或上传本地文件/,
  );
});
