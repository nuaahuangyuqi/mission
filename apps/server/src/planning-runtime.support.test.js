import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __planningRuntimeTestHooks,
  evaluatePlanning,
  getPlanningTemplate,
  testPlanningLlm,
  validatePlanning,
} from './planning-runtime.js';

const { buildSupportPlan, normalizeSupportPlanningOptions } = __planningRuntimeTestHooks;

test('planning template registers three active local Python algorithm variants', () => {
  const template = getPlanningTemplate();
  const expectedVariants = {
    'enemy-threat-analysis': 'enemy-threat-analysis:enemy-threat-analysis-local',
    'force-grouping': 'force-grouping:force-grouping-local',
    'airborne-landing-site-selection': 'airborne-landing-site-selection:airlanding-zone-local',
  };

  for (const [algorithmId, variantId] of Object.entries(expectedVariants)) {
    const algorithm = template.algorithms.find((item) => item.id === algorithmId);
    const variant = algorithm?.variants.find((item) => item.id === variantId);
    assert.ok(variant, `${variantId} should be registered`);
    assert.equal(variant.type, 'external-model');
    assert.equal(variant.executionMode, 'local-python');
    assert.equal(variant.status, 'active');
    assert.ok(variant.parameterSchema.length > 0);
  }
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
