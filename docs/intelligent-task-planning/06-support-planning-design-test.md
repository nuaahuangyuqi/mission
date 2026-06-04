# 算法 6 详细设计与测试文档：作战保障自动规划

## 一、算法定位

| 项 | 内容 |
|---|---|
| 算法名称 | 作战保障自动规划 |
| 算法 id / key | `support-planning` |
| 默认 methodKey | `demand-driven` |
| 可选 methodKey | `demand-driven`、`balanced-scheduling`、`loss-aware` |
| 所属模块 | `intelligent-task-planning` |
| 当前源码位置 | `apps/server/src/planning-runtime.js`：`SUPPORT_METHODS`、`createDefaultSupportOptions()`、`normalizeSupportPlanningOptions()`、`buildSupportPlan()`、`runBuiltinSupportPlanning()` |
| 调用入口 | 火力打击任务 `step-support-planning`；机降任务 `step-support-planning` |
| 平台流程作用 | 根据编组、战法路线、战损预测和资源池约束生成保障需求、调度分配与匹配分析 |
| 上游 | `force-grouping`、`method-planning`；机降任务还需要 `airborne-landing-site-selection` |
| 下游 | 最终交付物、输出包、CSV 对比 |

当前实现已要求显式结构化战损预测和保障资源池，不再按固定系数回填供给。真实算法应优先增强需求预测、资源调度和瓶颈优化。

## 二、接口适配说明

### 1. 输入参数结构

```json
{
  "algorithmInputs": {
    "support-planning": {
      "builtinMethodKey": "demand-driven",
      "selectedSourceIds": [],
      "uploadedFiles": [],
      "options": {
        "reserveRatio": 18,
        "airspaceControl": "standard",
        "damageForecast": {
          "source": "manual-assessment",
          "equipmentLossRate": 12,
          "casualtyRate": 6,
          "damagedEquipmentCount": 4,
          "woundedCount": 18,
          "criticalWindowCount": 2
        },
        "resourcePool": {
          "stock": {
            "ammo": 240,
            "fuel": 160,
            "maintenance": 92,
            "medical": 28,
            "airspace": 20,
            "command": 14
          },
          "transport": {
            "sorties": 16,
            "liftTonnagePerSortie": 7,
            "maintenanceTeams": 7,
            "medicalTeams": 6,
            "airspaceCells": 8,
            "commandLinks": 14
          }
        }
      }
    }
  }
}
```

### 2. 字段说明

| 字段 | 类型 | 必填 | 默认值 | 前端来源 | 后端接收位置 | 含义 |
|---|---|---:|---|---|---|---|
| `builtinMethodKey` | string | 是 | `demand-driven` | 内置方法下拉框 | `runBuiltinSupportPlanning()` | 推荐保障方法 |
| `options.reserveRatio` | number | 是 | `18` | 预备比例输入框 | `normalizeSupportPlanningOptions()` | clamp 到 8-35 |
| `options.airspaceControl` | string | 是 | `standard` | 空域管控下拉框 | `buildSupportMethodProfile()` | `tight / standard / flexible` |
| `damageForecast.equipmentLossRate` | number | 是 | `12` | 装备损失率 | `assertSupportPlanningInputCompleteness()` | 0-60 |
| `damageForecast.casualtyRate` | number | 是 | `6` | 人员伤亡率 | 同上 | 0-40 |
| `damageForecast.damagedEquipmentCount` | number | 是 | `4` | 受损装备数 | 同上 | 非负整数 |
| `damageForecast.woundedCount` | number | 是 | `18` | 伤员数 | 同上 | 非负整数 |
| `damageForecast.criticalWindowCount` | number | 是 | `2` | 关键窗口数 | 同上 | 1-4 |
| `resourcePool.stock.*` | number | 是 | 内置默认 | 保障资源池 | `assertSupportPlanningInputCompleteness()` | 弹药、油料、维修、医疗、空域、通信库存 |
| `resourcePool.transport.*` | number | 是 | 内置默认 | 投送与协同能力 | 同上 | 架次、载重、分队、席位、链路 |

验证规则：

- `validatePlanning()` 会调用 `assertSupportPlanningInputCompleteness()`。
- `buildSupportPlan()` 内还会调用 `assertSupportPlanningDependencies()`，确认编组、路线、阶段、机降地域和资源池有效。

### 3. 输出 JSON 完整结构

顶层字段：

| 字段 | 类型 | 生成逻辑 |
|---|---|---|
| `implementationStatus` | string | 固定 `implemented` |
| `builtinMethodKey` / `builtinMethodLabel` | string | 输入方法与 label |
| `comparedPlans` | array | 三种保障方法摘要 |
| `preferredPlanMethodKey` / `preferredPlan` | string / object | 用户选择 method 的完整保障方案 |
| `systemBestPlanMethodKey` | string | 系统最高分 method |
| `damageForecast` | object | 首选方案战损预测，顶层冗余便于结果页读取 |

`preferredPlan`：

```json
{
  "id": "support-plan-demand-driven",
  "methodKey": "demand-driven",
  "methodLabel": "需求牵引调度",
  "score": 86.4,
  "metrics": {
    "coverageRate": 92.5,
    "gapCount": 1,
    "criticalGapCount": 0,
    "reserveRatio": 18,
    "bottleneckCount": 1
  },
  "requirements": [
    {
      "key": "ammo",
      "name": "弹药",
      "unit": "基数",
      "priority": "高",
      "demand": 120,
      "targetGroups": ["主攻火力群"],
      "dispatchableStock": 220,
      "transportLimit": 210,
      "nodeLimit": 180,
      "supplyCeiling": 120,
      "supplied": 120,
      "gap": 0,
      "coverageRate": 100,
      "limitingFactors": [],
      "constraintLabel": "充足"
    }
  ],
  "allocations": [
    {
      "id": "allocation-ammo-rear-1",
      "serviceKey": "ammo",
      "serviceType": "弹药",
      "nodeId": "support-node-1",
      "nodeName": "后方装载补给点",
      "assignedTo": "主攻火力群",
      "quantity": 80,
      "unit": "基数",
      "coverageRate": 100,
      "notes": "..."
    }
  ],
  "airspaceWindows": [
    {
      "id": "airspace-window-1",
      "name": "集结空域窗口",
      "startOffsetMin": 0,
      "endOffsetMin": 12,
      "role": "协调窗口"
    }
  ],
  "supportNodes": [],
  "matchingAnalysis": [],
  "recommendations": [],
  "damageForecast": {
    "source": "manual-assessment",
    "equipmentLossRate": 12,
    "casualtyRate": 6,
    "damagedEquipmentCount": 4,
    "woundedCount": 18,
    "criticalWindowCount": 2,
    "criticalWindows": []
  },
  "resourcePool": {
    "reserveRatio": 18,
    "airspaceControl": "standard",
    "stockStatus": [],
    "transportStatus": [],
    "bottlenecks": []
  },
  "dependencyCheck": {
    "groupingGroupCount": 4,
    "routeCount": 3,
    "phaseCount": 4,
    "landingLinked": true
  },
  "visualization": {
    "entities": [],
    "environment": []
  }
}
```

兼容要求：

- 前端指标卡读取 `preferredPlan.metrics.coverageRate/gapCount/reserveRatio`。
- 表格读取 `preferredPlan.requirements / allocations / airspaceWindows / matchingAnalysis / comparedPlans`。
- `comparisonExport` 读取 `comparedPlans[].score/coverageRate/gapCount/criticalGapCount/reserveRatio/bottleneckCount`。

## 三、算法设计说明

### 1. 算法目标

在资源库存、运输投送能力和保障节点容量约束下，计算弹药、油料、维修、医疗、空域和通信指挥等保障需求，给出资源分配、缺口、瓶颈和建议。

### 2. 核心问题定义

```text
Given:
  Groups, Routes, Phases, DamageForecast, ResourcePool
Compute:
  Requirements per support resource
Allocate:
  Stock + transport + node capacity to requirements
Optimize:
  coverage, critical gap minimization, reserve preservation, bottleneck mitigation
```

### 3. 输入预处理

1. `normalizeSupportPlanningOptions()` clamp 战损、预备比例和资源池。
2. `assertSupportPlanningDependencies()` 校验上游群组、路线、阶段、机降地域。
3. 从 `methodPlanning.preferredPlan` 读取路线、阶段、总航程、任务类型。
4. 从 `forceGrouping.preferredScheme.groups` 读取群组能力。
5. 从 `targetAllocation.preferredPlan.assignments` 读取目标数量。

### 4. 关键指标

| 指标 | 说明 |
|---|---|
| `demand` | 保障需求量 |
| `dispatchableStock` | 扣除预备比例后可调库存 |
| `transportLimit` | 运输架次/分队/席位/链路形成的投送上限 |
| `nodeLimit` | 保障节点容量上限 |
| `supplyCeiling` | `min(demand, dispatchableStock, transportLimit, nodeLimit)` |
| `supplied` | 实际分配量 |
| `gap` | `demand - supplied` |
| `coverageRate` | `supplied / demand * 100` |
| `bottleneckCount` | 有限制因素的保障项数量 |

### 5. 权重与评分模型

当前方案分数：

```text
score =
  coverageRate
  - criticalGapCount * 10
  - gapCount * 3.5
  - stockBottleneckCount * 4
  - transportBottleneckCount * 3
  - nodeBottleneckCount * 2
  + reserveRatio * 0.18
  - max(0, casualtyRate - 8) * 0.4
```

真实算法可以改用线性规划、整数规划或启发式调度，但必须保留 `requirements` 中的三类约束上限和缺口解释。

### 6. 约束条件

- 保障资源池库存总和必须大于 0。
- 运输/保障投送能力总和必须大于 0。
- 火力打击任务至少有编组和方法结果。
- 机降任务还必须有 `preferredCandidate`。
- `coverageRate` 必须在 `0-100`。
- 分配量不能超过 `dispatchableStock/transportLimit/nodeLimit`。

### 7. 异常与空输入

- 缺编组：400，`PLANNING_MISSING_UPSTREAM`，`missingFrom=['force-grouping']`。
- 缺路线或阶段：400，`missingFrom=['method-planning']`。
- 机降任务缺选址：400，`missingFrom=['airborne-landing-site-selection']`。
- 缺战损字段：400，`details.fieldGroup='damageForecast'`。
- 资源池全 0：400，`details.fieldGroup='resourcePool'`。

## 四、实现步骤

### 推荐函数拆分

| 函数 | 职责 |
|---|---|
| `validateSupportInputs()` | 校验战损、资源池、上游 |
| `buildDamageForecast()` | 展开关键窗口 |
| `buildSupportRequirements()` | 计算六类资源需求 |
| `buildTransportLimits()` | 计算运输/分队/席位上限 |
| `buildSupportNodes()` | 构建保障节点与容量份额 |
| `allocateResources()` | 按 method profile 调度资源 |
| `analyzeMatching()` | 匹配分析、瓶颈、建议 |
| `buildSupportVisualization()` | 节点与保障走廊 |

### 主流程伪代码

```ts
function runSupportPlanning(context, input, dataset) {
  const options = normalizeSupportPlanningOptions(input.options)
  const deps = assertSupportPlanningDependencies(context, step, options)

  const plans = SUPPORT_METHODS.map(method => {
    const profile = buildSupportMethodProfile(method.key, options.airspaceControl)
    const damage = buildDamageForecast(options, deps.preferredPlan)
    const requirements = buildSupportRequirements(context, deps.preferredPlan, damage)
    const capacity = buildCapacity(options.resourcePool, deps.preferredPlan, method.key)
    const allocations = allocateResources(requirements, capacity, profile)
    return scoreAndExplainSupportPlan(method, requirements, allocations, damage, capacity)
  })

  const preferred = pickByMethod(plans, input.builtinMethodKey)
  return buildStructuredOutput(plans, preferred)
}
```

### 可保留与需重写

可保留：

- 结构化输入 `damageForecast/resourcePool`。
- `requirements/allocations/resourcePool/dependencyCheck` 字段。
- 错误处理与上游校验。

建议重写：

- 保障需求公式。
- 调度分配算法。
- 节点容量模型。
- 战损预测模型。
- 保障资源数据库标定。

## 五、测试方案

现有测试 `planning-runtime.support.test.js` 已覆盖一部分，应继续扩展。

| 用例 | 输入 | 预期输出 | 验证点 |
|---|---|---|---|
| 正常输入 | 完整编组、路线、阶段、默认保障参数 | 200；`comparedPlans.length=3` | `preferredPlan.requirements.length=6` |
| 低资源池 | 库存和运输能力很低 | 200；出现缺口和瓶颈 | `gapCount>0`、`resourcePool.bottlenecks.length>0` |
| 缺编组 | `force-grouping.preferredScheme.groups=[]` | 400 | 错误包含“缺少有效的作战编组结果” |
| 缺路线 | `method-planning.preferredPlan.routes=[]` | 400 | `missingFrom=['method-planning']` |
| 机降缺选址 | 机降任务但无 `preferredCandidate` | 400 | `missingFrom=['airborne-landing-site-selection']` |
| 缺战损字段 | damageForecast 有非数字 | 400 | `details.fieldGroup=damageForecast` |
| 资源全 0 | stock/transport 全 0 | 400 | `details.fieldGroup=resourcePool` |
| 方法切换 | `builtinMethodKey=loss-aware` | 首选 `loss-aware` | `preferredPlanMethodKey=loss-aware` |
| 前端展示兼容 | 单算法页 | 不报错 | 需求、调度、窗口、匹配分析表显示 |

示例断言：

```js
assert.equal(output.implementationStatus, 'implemented');
assert.ok(Array.isArray(output.comparedPlans));
assert.ok(output.preferredPlan.metrics.coverageRate >= 0);
assert.ok(output.preferredPlan.metrics.coverageRate <= 100);
assert.equal(output.preferredPlan.requirements.length, 6);
assert.ok(Array.isArray(output.preferredPlan.allocations));
```

## 六、验收标准

- 必须输出 `comparedPlans/preferredPlan/systemBestPlanMethodKey/damageForecast`。
- `preferredPlan.requirements` 必须覆盖 `ammo/fuel/maintenance/medical/airspace/command` 六类资源。
- 每项需求必须说明需求、可调库存、运输上限、节点上限、供给、缺口、覆盖率和限制因素。
- 资源调度不得超过库存、运输和节点容量。
- 缺少上游或结构化输入时必须返回结构化错误。
- `coverageRate` 范围 `0-100`；缺口和瓶颈必须有可读解释。
- 前端展示和 CSV 导出必须继续兼容当前字段名。

