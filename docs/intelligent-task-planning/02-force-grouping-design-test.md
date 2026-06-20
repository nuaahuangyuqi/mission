# 算法 2 详细设计与测试文档：作战力量智能编组

## 一、算法定位

| 项 | 内容 |
|---|---|
| 算法名称 | 作战力量智能编组 |
| 算法 id / key | `force-grouping` |
| 默认 methodKey | `hybrid-balanced` |
| 可选 methodKey | `rule-inference`、`genetic-optimization`、`hybrid-balanced` |
| 所属模块 | `intelligent-task-planning` |
| 当前源码位置 | `apps/server/src/planning-runtime.js`：`ALGORITHM_DEFINITIONS`、`executeLocalForceGrouping()`、`runBuiltinForceGrouping()`；Python 包位于 `algorithms/battle-planner` |
| 调用入口 | `executeTaskPlanning()` 根据步骤 `step-force-grouping` 调用 `BUILTIN_EXECUTORS['force-grouping']` |
| 平台流程作用 | 把我方兵力、文档候选单元与敌情威胁结果组织为多套功能群方案 |
| 上游 | `enemy-threat-analysis` |
| 下游 | `target-allocation`、`support-planning` |

当前智能编组实现已切换为 `battle_planner`。旧 `algorithms/force-grouping` Python 智能算法目录已删除；服务端负责把上一阶段敌情威胁结果包装为临时 `planning-artifact-export-v1` JSON，并把智能编组阶段的我方资料文档传给 `battle_planner --friendly`。

## 二、接口适配说明

### 1. 输入参数结构

```json
{
  "algorithmInputs": {
    "force-grouping": {
      "builtinMethodKey": "hybrid-balanced",
      "selectedSourceIds": [3, 4],
      "uploadedFiles": [],
      "options": {
        "ruleLibraryKey": "fire-strike-rules",
        "constraintModelKey": "baseline-constraints",
        "comparisonFocus": "balanced",
        "expectedGroupCount": 4
      }
    }
  }
}
```

### 2. 字段说明

| 字段 | 类型 | 必填 | 默认值 | 前端来源 | 后端接收位置 | 含义 |
|---|---|---:|---|---|---|---|
| `builtinMethodKey` | string | 是 | `hybrid-balanced` | 内置方法下拉框 | `runBuiltinForceGrouping()` | 决定首选推荐方案 |
| `selectedSourceIds` | number[] | 否 | `[]` | 数据源选择弹窗 | `buildSourceBundle()` | 我方资源库数据源 |
| `uploadedFiles` | object[] | 否 | `[]` | 本地文件上传 | `materializeBattlePlannerFriendlyFiles()` | 我方资料文档；`PDF / Excel / CSV` 会先转文本 |
| `options.ruleLibraryKey` | string | 否 | `fire-strike-rules` | 规则库下拉框 | 兼容保留 | Battle Planner 当前不直接消费，仅保留任务配置兼容 |
| `options.constraintModelKey` | string | 否 | `baseline-constraints` | 约束模型下拉框 | 兼容保留 | Battle Planner 当前不直接消费，仅保留任务配置兼容 |
| `options.comparisonFocus` | string | 否 | `balanced` | 对比侧重下拉框 | 兼容保留 | Battle Planner 当前不直接消费，仅保留任务配置兼容 |
| `options.expectedGroupCount` | number | 否 | `4` | 期望群组数输入框 | `buildBattlePlannerConfig()` | 映射为 Battle Planner `algorithm.max_group_size` 上限之一 |

上游要求：`validatePlanning()` 要求 `enemy-threat-analysis` 已在当前任务步骤中先执行。
用户不再上传敌情 JSON；服务端会从 `context.stageOutputs['enemy-threat-analysis']` 生成内部临时 JSON。

### 3. 输出 JSON 完整结构

顶层字段：

| 字段 | 类型 | 生成逻辑 |
|---|---|---|
| `implementationStatus` | string | 固定 `implemented` |
| `algorithmModel` | string | 当前为 `battle-planner-v1` |
| `battlePlannerResult` | object | `battle_planner` 原始 `PlanResult`，供目标分配阶段复用 |
| `builtinMethodKey` / `builtinMethodLabel` | string | 输入方法与 label |
| `ruleLibrary` | object | `{ key, label, description }` |
| `constraintModel` | object | `{ key, label, description }` |
| `appliedOptions` | object | 规则库、约束模型、对比侧重、期望/实际群组数 |
| `inputSummary` | object | 选中资源、上传文件、蓝方情报、文档候选、候选单元、证据条目计数 |
| `selectedSources` | array | 选中数据源摘要 |
| `importedFiles` | array | 上传文件摘要 |
| `evidenceTrace` | array | 证据溯源，最多 80 条 |
| `battlePlannerMetadata` | object | Battle Planner 原始 metadata |
| `constraintSummary` | object | 首选方案的约束评分与检查项 |
| `ruleEvidence` | array | 主信号命中的证据 |
| `schemes` | array | 三种 method 的完整方案 |
| `comparison` | array | 前端/CSV 用方案对比摘要 |
| `preferredSchemeId` / `preferredScheme` | string / object | 用户选择 method 对应方案 |
| `systemBestSchemeId` | string | 系统最高分方案 id |
| `explanation` | string[] | 推荐说明 |

`schemes[] / preferredScheme` 结构：

```json
{
  "id": "scheme-hybrid-balanced",
  "methodKey": "hybrid-balanced",
  "methodLabel": "混合均衡编组",
  "baseScore": 82.5,
  "score": 79.7,
  "metrics": {
    "firepower": 75,
    "protection": 68,
    "reconCoverage": 62,
    "endurance": 70,
    "mobility": 64,
    "balance": 81,
    "strengthTotal": 320,
    "roleFit": 88,
    "blueprintFit": 84,
    "readinessScore": 76,
    "groupCoverage": 100,
    "constraintSatisfaction": 92,
    "targetCoverage": 96,
    "damageSatisfaction": 94,
    "highThreatCoverage": 90,
    "threatRiskControl": 88,
    "weaponEfficiency": 82,
    "transportCoverage": 100
  },
  "groups": [
    {
      "id": "group-main-strike",
      "name": "主攻火力群",
      "role": "负责高价值目标压制与主突击打击",
      "unitCount": 3,
      "totalStrength": 88,
      "firepower": 78,
      "protection": 60,
      "reconCoverage": 54,
      "endurance": 57,
      "mobility": 61,
      "readinessScore": 75,
      "roleComposition": { "strike": 2, "cover": 1 },
      "categories": ["炮兵", "突击"],
      "units": [
        {
          "id": "unit-1",
          "name": "蓝方突击分队",
          "category": "突击",
          "role": "strike",
          "strength": 5,
          "readiness": "在线",
          "derivedFromText": false
        }
      ]
    }
  ],
  "actualGroupCount": 4,
  "emptyGroupCount": 0,
  "structuralPenalty": 0,
  "constraintEvaluation": {
    "modelKey": "baseline-constraints",
    "modelLabel": "基础编组约束",
    "totalChecks": 4,
    "passedCount": 3,
    "warnCount": 1,
    "failedCount": 0,
    "score": 92,
    "penalty": 1.4,
    "overallStatus": "warn",
    "summary": "...",
    "checks": [],
    "suggestions": []
  },
  "optimizationMeta": null,
  "optimizationTrace": [],
  "advantages": ["..."],
  "tradeoffs": ["..."]
}
```

兼容要求：

- 前端指标卡读取 `preferredScheme.score` 与 `preferredScheme.groups.length`。
- 单算法页读取 `resolvedRuleProfile / constraintModel / constraintSummary / preferredScheme.groups / comparison / ruleEvidence / evidenceTrace`。
- `comparisonExport` 读取 `comparison[].methodKey/methodLabel/score/actualGroupCount/firepower/constraintScore`。
- 下游目标分配读取 `preferredScheme.groups` 中的群组与单位能力。

## 三、算法设计说明

### 1. 算法目标

在任务规则、敌情威胁和我方兵力池约束下，形成若干功能群，使群组覆盖主攻、掩护、侦察、保障等角色，并输出可比较的多方案结果。

### 2. 核心问题定义

```text
Given:
  Threat = { overallThreat, firePressure, airDefensePressure, reconPressure, antiAirbornePressure }
  TargetDemand = { target_j(class, threatMultiplier, protection, scale, priority) }
  ForcePool = { helicopter_i(role, load, readiness, weapon compatibility) }
Find:
  Target -> firepower package, helicopter_i -> group_j, weapon/personnel/cargo -> platform_i
Maximize:
  target coverage + damage satisfaction + high threat coverage + threat risk control + transport coverage
Subject to:
  platform uniqueness, weapon stock, payload, transport capacity, one-wave target limit, reserve attack count
```

### 3. 输入预处理

1. 服务端从上游 `enemy-threat-analysis` 输出生成 `planning-artifact-export-v1` 临时敌情 JSON。
2. 服务端把用户在智能编组阶段传入的 `TXT / MD / JSON / DOCX` 直接传给 `battle_planner`，把 `PDF / Excel / CSV` 转成文本临时文件。
3. `battle_planner` 读取敌情目标、调用 LLM 生成处置规则，再从我方资料生成友方资源结构。
4. `battle_planner` 生成 `PlanResult.task_groups / reserve_group / remaining_resources / warnings`。
5. 平台适配层把 `PlanResult` 转成 `schemes / preferredScheme / groups / targetCoverage / evidenceTrace / constraintSummary`，并保留 `battlePlannerResult`。

### 4. 关键指标

| 指标 | 含义 | 建议真实算法计算 |
|---|---|---|
| `firepower` | 火力集中度 | 单位火力能力加权均值 |
| `protection` | 掩护防护能力 | 防护/防空/电子对抗能力 |
| `reconCoverage` | 侦察覆盖能力 | 侦察角色、传感器半径、覆盖面积 |
| `endurance` | 持续保障能力 | 保障角色、补给能力、续航 |
| `mobility` | 机动转换能力 | 速度、航程、机动平台数量 |
| `balance` | 群组均衡度 | 组间能力方差反向分 |
| `roleFit` | 角色适配 | 单位角色与蓝图偏好匹配 |
| `constraintSatisfaction` | 约束满足 | `constraintEvaluation.score` |
| `targetCoverage` | 目标覆盖率 | 目标火力覆盖率均值 |
| `damageSatisfaction` | 毁伤满足度 | 已分配毁伤 / 需求毁伤 |
| `highThreatCoverage` | 高威胁目标覆盖 | 高威胁目标覆盖率 |
| `threatRiskControl` | 敌情风险控制 | 高威胁覆盖叠加侦察/护航链路 |
| `weaponEfficiency` | 武器效率 | 毁伤需求匹配和毁伤/重量效率 |
| `transportCoverage` | 运输覆盖 | 人员与物资装载覆盖 |

### 5. 权重模型

当前规则库：

- `fire-strike-rules`：火力 `0.32`、防护 `0.2`、侦察 `0.16`、保障 `0.18`、机动 `0.08`、均衡 `0.06`。
- `air-assault-rules`：火力 `0.24`、防护 `0.18`、侦察 `0.14`、保障 `0.14`、机动 `0.22`、均衡 `0.08`。

真实算法建议把规则库权重作为可配置 profile，允许按任务类型加载，但必须把最终权重写入 `resolvedRuleProfile.weightSummary`。

### 6. 评分模型

当前 v3 方案总分：

```text
score =
  targetCoverage*0.20
  + damageSatisfaction*0.18
  + highThreatCoverage*0.14
  + threatRiskControl*0.12
  + weaponEfficiency*0.10
  + transportCoverage*0.10
  + readiness*0.08
  + loadBalance*0.05
  + explanationConfidence*0.03
  - constraintPenalty
```

目标火力需求公式：

```text
requiredDamage =
  baseDamageByTargetClass
  * threatMultiplier
  * protectionMultiplier
  * scaleMultiplier
  * priorityMultiplier
```

其中 `threatMultiplier` 由目标自身威胁、上游总体威胁、火力覆盖压力、防空压力、侦察预警压力和反机降压力共同计算。

### 7. 约束条件

当前 `baseline-constraints` 校验：

- 功能群完整性。
- 高威胁目标覆盖。
- 敌情风险控制链。
- 兵力负载均衡。

真实约束模型应输出同构结构：

```json
{
  "overallStatus": "pass | warn | fail",
  "score": 0,
  "checks": [
    {
      "id": "role-coverage",
      "label": "关键角色覆盖",
      "status": "pass",
      "detail": "...",
      "suggestion": "..."
    }
  ]
}
```

### 8. 异常与空输入

- 缺敌情上游：`validatePlanning()` 返回 `PLANNING_MISSING_UPSTREAM`。
- 无蓝方情报但有上传文件：允许从文档拆候选。
- 无任何候选兵力：允许输出低分/空组方案，但解释必须提示补充我方兵力；如果真实算法不能计算，可返回 `PLANNING_MISSING_DATA`，但要确认前端流程是否接受。
- `expectedGroupCount` 超界：后端已 clamp 到 `3-6`。

## 四、实现步骤

### 推荐函数拆分

| 函数 | 职责 |
|---|---|
| `collectForceInputs()` | 读取蓝方情报、上传文件、敌情上游 |
| `buildForcePool()` | 统一单位能力结构，补齐角色与能力 |
| `buildRuleProfile()` | 生成规则库权重、主信号、群组蓝图 |
| `solveGrouping()` | 按 methodKey 执行编组求解 |
| `evaluateGrouping()` | 计算 metrics 与 score |
| `evaluateConstraints()` | 执行约束模型 |
| `buildGroupingExplanation()` | 输出解释文本 |

### 主流程伪代码

```ts
async function runForceGrouping(context, step, algorithm, input, dataset) {
  const threat = context.stageOutputs['enemy-threat-analysis']
  const sourceBundle = buildSourceBundle(dataset, input.selectedSourceIds)
  const uploadedFiles = await normalizeUploadedFiles(input.uploadedFiles)
  const blueIntel = buildSelectedIntelligence(dataset, 'blue', sourceBundle.sourceIdSet)
  const evidence = buildGroupingEvidence(sourceBundle, uploadedFiles, blueIntel, threat)

  const requestedCount = clamp(input.options.expectedGroupCount, 3, 6)
  const forcePool = buildForcePool(blueIntel, evidence, requestedCount)
  const actualCount = resolveActualGroupCount(requestedCount, forcePool.length)
  const ruleProfile = buildRuleProfile(input.options.ruleLibraryKey, evidence, threat, actualCount)

  const schemes = methods.map(method => {
    const assignment = solveGrouping(method.key, forcePool, ruleProfile, input.options)
    const metrics = evaluateGrouping(assignment, ruleProfile)
    const constraints = evaluateConstraints(input.options.constraintModelKey, assignment, threat)
    return buildScheme(method, assignment, metrics, constraints)
  })

  const preferred = pickByMethod(schemes, input.builtinMethodKey)
  return buildStructuredOutput(preferred, schemes, ruleProfile, evidence)
}
```

### 可保留与需重写

可保留：

- 统一输入、证据溯源、输出组装。
- `GROUPING_RULE_LIBRARIES` 和 `GROUPING_CONSTRAINT_MODELS` 注册式扩展。
- `comparison` 与 `constraintSummary` 字段。

建议重写：

- `buildDocumentGroupingCandidates()` 的简单文本候选生成。
- `assignGroupingHeuristically()` 与遗传算法参数。
- 真实能力值标定。
- 复杂约束，例如通信链路、平台互斥、时序可用性。

## 五、测试方案

| 用例 | 输入 | 预期输出 | 验证点 |
|---|---|---|---|
| 正常输入：结构化蓝方情报 | DB 有 blue intelligence，已完成敌情上游 | 200；`schemes.length=3` | `preferredScheme.groups` 非空 |
| 正常输入：仅上传 CSV/Excel | `force-grouping.uploadedFiles` 含兵力表 | 200；`documentCandidateCount>0` | 文档候选可生成基础方案 |
| 空候选 | 有敌情上游，但无 blue intelligence 和上传文件 | 200 或按真实算法返回 400 需确认 | 如 200，`explanation` 必须提示补充兵力 |
| 缺上游 | 自定义任务把 `force-grouping` 放第一步 | 400 | `error.type=missing_upstream` |
| 极端群组数 | `expectedGroupCount=99` | 200 | `appliedOptions.expectedGroupCount<=6` |
| 约束测试 | 候选兵力集中到单一角色 | 200；`constraintSummary.overallStatus` 为 `warn/fail` | checks 有明细 |
| 标准 JSON 对齐 | 完整执行 | 顶层字段齐全 | `comparison` 可被 CSV 导出读取 |
| 前端展示兼容 | 打开单算法结果页 | 不报错 | `preferredScheme.groups` 表格显示 |

示例断言：

```js
assert.equal(output.implementationStatus, 'implemented');
assert.ok(Array.isArray(output.schemes));
assert.equal(output.schemes.length, 3);
assert.ok(output.preferredScheme);
assert.ok(output.preferredScheme.score >= 0 && output.preferredScheme.score <= 100);
assert.ok(['pass', 'warn', 'fail'].includes(output.constraintSummary.overallStatus));
```

## 六、验收标准

- 必须输出 `schemes / comparison / preferredScheme / constraintSummary / explanation`。
- 方案分数与核心 metrics 必须在 `0-100`。
- `expectedGroupCount` 必须影响实际求解，不能只是展示字段。
- 编组结果至少包含 `groups[]`，每组包含 `id/name/role/unitCount/units/能力指标`。
- 约束模型必须返回可解释 checks，不允许只返回一个总分。
- 下游 `target-allocation` 能从 `preferredScheme.groups[].units` 构建平台。
- 与当前标准结果兼容，不删除 `ruleEvidence/evidenceTrace/resolvedRuleProfile`。
