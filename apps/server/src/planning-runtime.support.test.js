import test from 'node:test';
import assert from 'node:assert/strict';
import { __planningRuntimeTestHooks, evaluatePlanning } from './planning-runtime.js';

const { buildSupportPlan, normalizeSupportPlanningOptions } = __planningRuntimeTestHooks;

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

test('planning execution preserves earlier step results when a later step fails', async () => {
  const previousMode = process.env.PLANNING_THREAT_PYTHON_MODE;
  process.env.PLANNING_THREAT_PYTHON_MODE = 'off';

  try {
    const response = await evaluatePlanning({
      assessmentName: '阶段解耦回归',
      taskDefinition: {
        id: 'partial-execution-review',
        name: '阶段解耦回归',
        category: 'review',
        finalDeliverables: ['阶段成果', '阶段汇总', '建议'],
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
            consumes: ['威胁模型', '本地文件'],
            produces: ['编组方案'],
          },
        ],
      },
      bindings: {
        'step-threat-analysis': 'enemy-threat-analysis:builtin',
        'step-force-grouping': 'force-grouping:builtin',
      },
      algorithmInputs: {
        'enemy-threat-analysis': {
          builtinMethodKey: 'knowledge-fusion',
          selectedSourceIds: [],
          uploadedFiles: [{
            id: 'threat-text-1',
            fileName: 'threat-input.txt',
            fileExtension: '.txt',
            fileContentBase64: Buffer.from('防空阵地坐标 23.2885, 114.0078。', 'utf8').toString('base64'),
          }],
          options: {},
        },
        'force-grouping': {
          builtinMethodKey: 'hybrid-balanced',
          selectedSourceIds: [],
          uploadedFiles: [{
            id: 'bad-upload-1',
            fileName: 'unsupported.json',
            fileExtension: '.json',
            fileContentBase64: Buffer.from('{"bad":true}', 'utf8').toString('base64'),
          }],
          options: {},
        },
      },
    });

    assert.equal(response.execution.steps.length, 2);
    assert.equal(response.execution.steps[0].structuredOutput?.implementationStatus, 'implemented');
    assert.equal(response.execution.steps[1].structuredOutput?.implementationStatus, 'failed');
    assert.match(response.execution.steps[1].summary, /执行失败/);
    assert.equal(response.execution.summary.implementedSteps, 1);
    assert.equal(response.execution.summary.failedSteps, 1);
    assert.equal(response.result.consolidatedOutputs.threatAnalysis?.implementationStatus, 'implemented');
    assert.equal(response.result.consolidatedOutputs.forceGrouping?.implementationStatus, 'failed');
  } finally {
    if (previousMode === undefined) delete process.env.PLANNING_THREAT_PYTHON_MODE;
    else process.env.PLANNING_THREAT_PYTHON_MODE = previousMode;
  }
});
