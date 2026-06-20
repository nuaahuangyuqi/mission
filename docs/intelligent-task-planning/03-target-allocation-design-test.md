# 算法 3 详细设计与测试文档：作战目标自动分配

## 一、算法定位

| 项 | 内容 |
|---|---|
| 算法名称 | 作战目标自动分配 |
| 算法 id / key | `target-allocation` |
| 默认 methodKey | `multi-objective` |
| 可选 methodKey | `hungarian`、`ant-colony`、`multi-objective` |
| 所属模块 | `intelligent-task-planning` |
| 当前源码位置 | `apps/server/src/planning-runtime.js`：`TARGET_METHODS`、`TARGET_VALIDATION_PROFILES`、`runBuiltinTargetAllocation()`、`executeLocalTargetAllocation()` |
| 调用入口 | `BUILTIN_EXECUTORS['target-allocation']` |
| 平台流程作用 | 把敌情威胁目标与我方编组平台匹配为多目标、多平台、多波次分配方案 |
| 上游 | `enemy-threat-analysis`、`force-grouping` |
| 下游 | `airborne-landing-site-selection`、`method-planning` |

当前内置方法仍提供匈牙利、蚁群协同、多目标优化三类启发式方案。`target-allocation-local / 智能分配算法` 已改为 Battle Planner 适配器：不再调用旧 `target_allocation` Python 包，而是读取上游 `force-grouping` 的 `battlePlannerResult.task_groups` 生成 `preferredPlan` 和可视化箭头。

智能分配适配器会按实际武器装载计算分配火力值：`weaponEquipmentPower = weapons.quantity * 0.8`，未装载武器时 `group.firepower = 0`。运输直升机和人员配置继续输出为 `transportPersonnelPower/personnelDeliveryScore`，用于说明机动投送等其他能力，但不参与火力合成。火力打击类任务若未装载武器，会生成合理性校核失败项并阻止该编组形成有效火力打击分配。

## 二、接口适配说明

### 1. 输入参数结构

```json
{
  "algorithmInputs": {
    "target-allocation": {
      "builtinMethodKey": "multi-objective",
      "selectedSourceIds": [],
      "uploadedFiles": [],
      "options": {
        "objectivePreference": "balanced",
        "validationMode": "strict",
        "maxAssignmentsPerGroup": 2
      }
    }
  }
}
```

### 2. 字段说明

| 字段 | 类型 | 必填 | 默认值 | 前端来源 | 后端接收位置 | 含义 |
|---|---|---:|---|---|---|---|
| `builtinMethodKey` | string | 是 | `multi-objective` | 内置方法下拉框 | `runBuiltinTargetAllocation()` | 选择推荐方案 |
| `options.objectivePreference` | string | 否 | `balanced` | 目标偏好下拉框 | 匹配评分 | `balanced / firepower-first / survivability-first` |
| `options.validationMode` | string | 否 | `strict` | 验证模式下拉框 | `resolveTargetValidationProfile()` | `strict / standard` |
| `options.maxAssignmentsPerGroup` | number | 否 | `2` | 单编组最大分配数 | `clamp(...,1,6)` | 群组负荷上限 |

该算法 `supportedInputModes` 为 `upstream-result`，不直接使用资源库或上传文件。它从 `context.stageOutputs` 读取：

- `enemy-threat-analysis`：火力、防空、侦察、反机降、部署区，生成 `candidateTargets`。
- `force-grouping`：优先读取 `battlePlannerResult.task_groups` 中的编组-目标处置关系，同时复用 `preferredScheme.groups` 中的平台、坐标和单位信息。

### 3. 输出 JSON 完整结构

顶层字段：

| 字段 | 类型 | 生成逻辑 |
|---|---|---|
| `implementationStatus` | string | 固定 `implemented` |
| `builtinMethodKey` / `builtinMethodLabel` | string | 输入方法与 label |
| `appliedOptions` | object | 目标偏好、验证模式、单编组最大分配数 |
| `validationProfile` | object | 严格/标准校核阈值 |
| `candidateTargets` | array | 从威胁节点构建候选目标 |
| `platforms` | array | 从编组单位构建平台 |
| `groups` | array | 从编组群构建群组摘要 |
| `comparedPlans` | array | 内置方法为三类方法完整方案；智能分配为单个 `intelligent-allocation` 适配方案 |
| `preferredPlanMethodKey` / `preferredPlan` | string / object | 用户选择 method 对应方案 |
| `systemBestPlanMethodKey` / `systemBestPlan` | string / object | 系统最高分方案 |
| `validationSummary` | object | `{ status, issueCount }` |
| `validation` | array | 合理性校核明细 |
| `adjustmentSuggestions` | array | 调整建议 |

`candidateTargets[]`：

```json
{
  "id": "target-fire-coverage-1",
  "name": "北侧远程火力群",
  "type": "fire-coverage",
  "typeLabel": "火力覆盖",
  "coordinates": [118.1, 32.0, 0],
  "importance": 82,
  "difficulty": 56,
  "priorityLevel": "二级",
  "requiredPlatformCount": 2,
  "preferredRoles": ["strike", "cover"],
  "capabilityWeights": {
    "firepower": 0.44,
    "protection": 0.12,
    "reconCoverage": 0.12,
    "endurance": 0.1,
    "mobility": 0.22
  },
  "rationale": "由火力覆盖节点转换",
  "compositePriority": 78.5
}
```

`preferredPlan / comparedPlans[]`：

```json
{
  "id": "plan-multi-objective",
  "methodKey": "multi-objective",
  "methodLabel": "多目标优化分配",
  "score": 81.3,
  "assignments": [
    {
      "id": "platform-1:target-1:1:1",
      "platformId": "platform-1",
      "platformName": "蓝方突击分队",
      "platformRole": "strike",
      "platformCategory": "突击",
      "groupId": "group-main-strike",
      "groupName": "主攻火力群",
      "groupRole": "负责高价值目标压制",
      "targetId": "target-1",
      "targetName": "防空节点",
      "targetType": "air-defense",
      "targetTypeLabel": "防空节点",
      "priority": 86,
      "priorityLevel": "一级",
      "difficulty": 60,
      "matchScore": 78,
      "feasibilityScore": 72,
      "capabilityFit": 80,
      "distanceKm": 24.5,
      "reachUtilization": 0.62,
      "sequence": 1,
      "wave": 1,
      "packageIndex": 1,
      "requiredPlatformCount": 2,
      "reason": "..."
    }
  ],
  "backlogTargets": [],
  "coverage": [],
  "groupLoads": [],
  "platformLoads": [],
  "objectives": {
    "partialCoverRate": 100,
    "fullCoverRate": 80,
    "priorityCoverageRate": 100,
    "collaborationRate": 60,
    "averageMatchScore": 76,
    "averageFeasibilityScore": 70,
    "averageDistanceKm": 28,
    "loadBalance": 82,
    "riskExposure": 12,
    "backlogPenalty": 0
  },
  "optimizationMeta": {},
  "stats": {
    "assignedTargetCount": 4,
    "fullyCoveredTargetCount": 3,
    "backlogTargetCount": 1,
    "averageMatchScore": 76,
    "averageFeasibilityScore": 70,
    "coverRate": 100,
    "fullCoverRate": 75,
    "priorityCoverRate": 100,
    "collaborationTargetCount": 2,
    "averageDistanceKm": 28,
    "loadBalance": 82,
    "platformCount": 6,
    "groupCount": 4
  },
  "paretoRank": 1
}
```

兼容要求：

- 前端当前 `TABLE_SPECS` 读取 `preferredPlan.assignments / comparedPlans / adjustmentSuggestions`，但还保留旧名 `validationFindings`，实际输出为 `validation`；建议真实算法同时输出 `validation`，必要时增加 alias `validationFindings`。
- `method-planning` 依赖 `preferredPlan.assignments`、`coverage`、`groups/platforms`，不要删除。

## 三、算法设计说明

### 1. 算法目标

把目标集合和平台集合匹配成可执行打击包，兼顾目标优先级、平台能力、射程、协同、负荷和风险。

### 2. 核心问题定义

```text
Given:
  Targets T, Platforms P, Groups G
Find:
  Assignments A subset P x T x Wave
Maximize:
  target coverage + match score + feasibility + collaboration + load balance
Subject to:
  platform max assignments, group max assignments, reach, feasibility thresholds
```

### 3. 输入预处理

1. 从敌情输出构建目标：火力、防空、侦察、反机降、部署区。
2. 用 `TARGET_TYPE_PROFILES` 补目标类型权重与偏好角色。
3. 从编组输出构建平台：单位能力、角色、群组、坐标、射程、最大任务数。
4. 从编组输出构建群组负荷模型。
5. 解析验证模式阈值。

### 4. 关键指标与评分

单平台-目标候选评分：

```text
capabilityFit = sum(platformMetric * target.capabilityWeights)
rangeScore = f(distance / platform.engagementRangeKm)
feasibilityScore =
  capabilityFit * 0.34
  + rangeScore * 0.24
  + readiness * 0.14
  + endurance * 0.10
  + roleFit * 0.10
  + protection * 0.08
  - difficulty * 0.10
  + loadFlexibility * 0.04

matchScore =
  capabilityFit * 0.28
  + feasibilityScore * 0.26
  + target.importance * 0.18
  + roleFit * 0.10
  + (100 - difficulty) * 0.08
  + rangeScore * 0.10
  + method/preference bonus
```

计划评分建议继续使用：

- 覆盖率。
- 高优先级目标覆盖。
- 平均匹配/可行性。
- 协同目标数量。
- 平均距离与风险暴露。
- 编组/平台负荷均衡。
- 未分配目标惩罚。

### 5. 约束条件

- 单平台不能重复分配同一目标。
- 平台分配数不能超过 `maxAssignments`。
- 群组分配数不能超过 `maxAssignmentsPerGroup` 推导上限。
- `reachUtilization` 超过 `validationProfile.maxReachUtilization` 应 fail 或大幅降分。
- 高价值目标 `requiredPlatformCount > 1` 时应尽量多群组协同。

### 6. 异常与空输入

- 缺敌情或编组上游：由 `validatePlanning()` 拦截。
- 无目标：应输出空 `candidateTargets` 和低分方案，或明确返回 `PLANNING_MISSING_DATA`，需确认业务口径。
- 无平台：应输出空 `platforms`、全目标进入 `backlogTargets`，并在 `validation` 给出 fail。
- 所有候选低于阈值：仍输出 `backlogTargets` 与调整建议，不要伪造 assignment。

## 四、实现步骤

### 推荐函数拆分

| 函数 | 职责 |
|---|---|
| `buildCandidateTargets()` | 威胁节点转目标 |
| `buildPlatformProfiles()` | 编组结果转平台/群组 |
| `buildCandidateMatrix()` | 平台-目标候选匹配评分 |
| `solveHungarian()` | 快速全局匹配 |
| `solveAntColony()` | 多波次协同搜索 |
| `solveMultiObjective()` | Pareto/多目标优化 |
| `buildPlanSummary()` | coverage/load/objectives/stats |
| `validateAllocationPlan()` | 合理性校核 |
| `buildAdjustmentSuggestions()` | 调整建议 |

### 主流程伪代码

```ts
function runTargetAllocation(context, input) {
  const threat = context.stageOutputs['enemy-threat-analysis']
  const grouping = context.stageOutputs['force-grouping']
  const targets = buildCandidateTargets(threat)
  const { platforms, groups } = buildPlatformProfiles(grouping, input.options)
  const validationProfile = resolveTargetValidationProfile(input.options.validationMode)

  const plans = [
    solveHungarian(platforms, groups, targets, input.options, validationProfile),
    solveAntColony(platforms, groups, targets, input.options, validationProfile),
    solveMultiObjective(platforms, groups, targets, input.options, validationProfile)
  ]

  const preferred = pickByMethod(plans, input.builtinMethodKey)
  const validation = validateAllocationPlan(preferred, targets, platforms, groups, input.options, validationProfile)
  return buildStructuredOutput(targets, platforms, groups, plans, preferred, validation)
}
```

### 可保留与需重写

可保留：

- 目标/平台/分配方案 JSON。
- `TARGET_TYPE_PROFILES` 与 `TARGET_VALIDATION_PROFILES`。
- 合理性校核与建议框架。

建议重写：

- 求解器内部实现。
- 平台能力标定与射程模型。
- 多波次、协同和弹药/火力约束。
- 与真实地形/威胁场的距离风险计算。

## 五、测试方案

| 用例 | 输入 | 预期输出 | 验证点 |
|---|---|---|---|
| 正常输入 | 敌情含多个节点，编组含多个群组与单位 | 200；`candidateTargets/platforms/groups` 非空 | `comparedPlans.length=3` |
| 匈牙利方法 | `builtinMethodKey=hungarian` | `preferredPlanMethodKey=hungarian` | 首选方案切换正确 |
| 严格校核 | `validationMode=strict` | `validationProfile.key=strict` | 阈值使用严格 profile |
| 极端负荷 | `maxAssignmentsPerGroup=1` 且目标很多 | `validation` 出现 warn/fail | `groupLoads[].overloaded` 正确 |
| 无平台 | 编组输出 groups 为空 | 低分或错误 | 不产生非法 assignment |
| 标准 JSON 对齐 | 完整执行 | `preferredPlan.assignments` 为数组 | 下游战法能读取 route task |
| 前端展示兼容 | 单算法页 | 不报错 | 建议补 `validationFindings` alias 或确认前端读取 `validation` |

示例断言：

```js
assert.equal(output.implementationStatus, 'implemented');
assert.ok(Array.isArray(output.candidateTargets));
assert.ok(Array.isArray(output.platforms));
assert.ok(Array.isArray(output.comparedPlans));
assert.ok(output.preferredPlan.score >= 0 && output.preferredPlan.score <= 100);
assert.ok(['pass', 'warn', 'fail'].includes(output.validationSummary.status));
```

## 六、验收标准

- 输出必须包含 `candidateTargets/platforms/groups/comparedPlans/preferredPlan/systemBestPlan/validation/adjustmentSuggestions`。
- 所有 `score/matchScore/feasibilityScore` 必须在 `0-100`。
- 每条 assignment 必须包含平台、群组、目标、波次、匹配分、可行性、距离、原因。
- `coverage/backlogTargets/groupLoads/platformLoads/stats` 必须能解释方案质量。
- 对无法覆盖目标不得伪造分配，必须进入 `backlogTargets`。
- 与 `method-planning` 兼容：`preferredPlan.assignments[]` 字段不得破坏。
