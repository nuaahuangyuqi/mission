# 算法 5 详细设计与测试文档：作战方法自动规划

## 一、算法定位

| 项 | 内容 |
|---|---|
| 算法名称 | 作战方法自动规划 |
| 算法 id / key | `method-planning` |
| 默认 methodKey | `a-star` |
| 可选 methodKey | `a-star`、`dijkstra`、`rrt` |
| 所属模块 | `intelligent-task-planning` |
| 当前源码位置 | `apps/server/src/planning-runtime.js`：`METHOD_PLANNING_METHODS`、路径代价场函数、`runBuiltinMethodPlanning()` |
| 调用入口 | 火力打击任务 `step-method-planning`；机降任务 `step-method-planning` |
| 平台流程作用 | 基于目标分配、威胁/环境约束和机降选址结果生成路线、阶段时序和关键行动 |
| 上游 | `enemy-threat-analysis`、`target-allocation`；机降任务还读取 `airborne-landing-site-selection` |
| 下游 | `support-planning` |

当前实现已经有 A*、Dijkstra、RRT 风格的二维代价网格与采样路径逻辑，但仍是演示级启发式。真实算法可替换路径求解器与代价场。

## 二、接口适配说明

### 1. 输入参数结构

```json
{
  "algorithmInputs": {
    "method-planning": {
      "builtinMethodKey": "a-star",
      "selectedSourceIds": [],
      "uploadedFiles": [],
      "options": {
        "routePreference": "balanced",
        "altitudeProfile": "terrain-following",
        "phaseTempo": "standard"
      }
    }
  }
}
```

### 2. 字段说明

| 字段 | 类型 | 必填 | 默认值 | 前端来源 | 后端接收位置 | 含义 |
|---|---|---:|---|---|---|---|
| `builtinMethodKey` | string | 是 | `a-star` | 内置方法下拉框 | `buildMethodPlan()` | 决定推荐路径方法 |
| `options.routePreference` | string | 否 | `balanced` | 航路侧重下拉框 | 路线评分/代价 | `balanced / speed / concealment` |
| `options.altitudeProfile` | string | 否 | `terrain-following` | 高度剖面下拉框 | `applyRouteAltitudeProfile()` | `terrain-following / medium / high` |
| `options.phaseTempo` | string | 否 | `standard` | 行动节奏下拉框 | `buildMethodPhases()` | `standard / aggressive / deliberate` |

上游数据：

- `target-allocation.preferredPlan.assignments`：优先生成群组-目标-波次航路任务。
- 若分配为空，当前实现会回退到目标锚点生成基础路线任务。
- `enemy-threat-analysis`：威胁节点与环境约束。
- `airborne-landing-site-selection.preferredCandidate`：机降任务的着陆/接近节点。

### 3. 输出 JSON 完整结构

| 字段 | 类型 | 生成逻辑 |
|---|---|---|
| `implementationStatus` | string | 固定 `implemented` |
| `builtinMethodKey` / `builtinMethodLabel` | string | 输入方法与 label |
| `planningBasis` | object | `{ routeTaskCount, objectiveCount, threatNodeCount }` |
| `comparedPlans` | array | 三类路径方法摘要 |
| `preferredPlanMethodKey` / `preferredPlan` | string / object | 用户选择 method 的完整方案 |
| `systemBestPlanMethodKey` | string | 系统最高分 method |
| `explanation` | string[] | 推荐理由与联动说明 |

`preferredPlan`：

```json
{
  "id": "method-plan-a-star",
  "methodKey": "a-star",
  "methodLabel": "A* 路径规划",
  "missionType": "air-assault",
  "score": 84.1,
  "routes": [
    {
      "id": "a-star-route-1",
      "name": "主攻火力群 -> 防空节点",
      "groupId": "group-main-strike",
      "groupName": "主攻火力群",
      "groupRole": "strike",
      "routeType": "assault | strike | support",
      "missionType": "air-assault",
      "objectiveId": "target-1",
      "objectiveName": "防空节点",
      "objectiveType": "air-defense",
      "targetImportance": 86,
      "targetDifficulty": 60,
      "targetPriorityLevel": "一级",
      "wave": 1,
      "platformCount": 2,
      "platformNames": ["蓝方突击分队"],
      "assignmentCount": 2,
      "averageMatchScore": 76,
      "averageFeasibilityScore": 70,
      "averageReachUtilization": 0.68,
      "startOffsetMin": 8,
      "endOffsetMin": 42,
      "coordinates": [[118.0, 32.0, 120]],
      "checkpoints": [
        {
          "id": "route-1-checkpoint-1",
          "name": "出发集结区",
          "coordinates": [118.0, 32.0, 120],
          "timeOffsetMin": 0
        }
      ],
      "plannerMeta": {
        "methodKey": "a-star",
        "gridWidth": 28,
        "gridHeight": 28,
        "cellSizeKm": 2.5,
        "expandedNodes": 140,
        "visitedNodes": 188,
        "fallbackSegmentCount": 0,
        "iterationCount": 0,
        "status": "solved"
      },
      "metrics": {
        "distanceKm": 42,
        "threatScore": 35,
        "terrainPenalty": 8,
        "weatherPenalty": 4,
        "electromagneticPenalty": 2,
        "concealmentScore": 72,
        "averageFieldCost": 16,
        "peakFieldCost": 24,
        "estimatedDurationMin": 32,
        "riskLevel": "中",
        "expandedNodes": 140,
        "fallbackSegmentCount": 0,
        "score": 80,
        "checkpointCount": 4
      }
    }
  ],
  "metrics": {
    "totalDistanceKm": 128,
    "averageThreatScore": 40,
    "averageConcealment": 70,
    "averageFieldCost": 18,
    "peakFieldCost": 30,
    "estimatedCompletionMin": 62,
    "checkpointCount": 12,
    "routeTaskCount": 3
  },
  "phases": [
    {
      "id": "phase-1",
      "name": "集结准备",
      "startOffsetMin": 0,
      "endOffsetMin": 12,
      "goal": "..."
    }
  ],
  "planningBasis": {
    "routeTaskCount": 3,
    "objectiveCount": 3,
    "threatNodeCount": 8
  },
  "keyActions": [
    {
      "id": "action-1",
      "title": "压制防空节点",
      "detail": "...",
      "window": "12-24 min"
    }
  ],
  "visualization": {
    "entities": [],
    "environment": []
  }
}
```

兼容要求：

- 前端指标卡读取 `preferredPlan.score`、`preferredPlan.routes.length`、`preferredPlan.metrics.checkpointCount`。
- 结果页表格读取 `preferredPlan.routes / preferredPlan.phases / preferredPlan.keyActions / comparedPlans`。
- `support-planning` 依赖 `preferredPlan.routes`、`preferredPlan.phases`、`preferredPlan.metrics.totalDistanceKm` 和 `preferredPlan.missionType`。

## 三、算法设计说明

### 1. 算法目标

生成满足任务目标、威胁规避、地形环境约束和时序协同要求的作战方法方案，包括航路、检查点、阶段和关键动作。

### 2. 核心问题定义

```text
Given:
  RouteTasks from target assignments
  ThreatNodes, Environment, LandingCandidate
Find:
  Routes for each task
Minimize:
  distance + threat cost + terrain/weather/electromagnetic penalties
Maximize:
  concealment + timing coordination + mission fit
```

### 3. 输入预处理

1. 从目标分配 assignment 聚合为 `routeTasks`。
2. 没有 assignment 时从目标锚点 fallback。
3. 根据机降地域确定机降接近点、着陆点。
4. 从敌情构建威胁风险节点。
5. 从环境构建代价覆盖。
6. 按 methodKey 创建代价场：A* 用启发式，Dijkstra 用全局累计代价，RRT 用随机扩展。

### 4. 关键指标

| 指标 | 说明 |
|---|---|
| `distanceKm` | 路线总距离 |
| `threatScore` | 沿线威胁采样均值 |
| `terrainPenalty/weatherPenalty/electromagneticPenalty` | 环境约束罚分 |
| `concealmentScore` | 隐蔽性得分 |
| `averageFieldCost/peakFieldCost` | 代价场均值与峰值 |
| `estimatedDurationMin` | 按平台/机型速度估算 |
| `riskLevel` | 由威胁和峰值代价转换 |
| `checkpointCount` | 检查点数量 |

### 5. 评分模型

计划评分可保留现有思路：

```text
planScore =
  average(route.metrics.score) * 0.64
  + survivabilityScore * 0.16
  + coordinationScore * 0.12
  + missionTypeBonus
  - max(0, peakFieldCost - 18) * 0.42
```

路线分数建议：

```text
routeScore =
  100
  - distancePenalty
  - threatPenalty
  - terrain/weather/electromagneticPenalty
  + concealmentBonus
  + assignmentQualityBonus
```

### 6. 约束条件

- 路线坐标必须至少两个点；没有解时应显式 fallback 并记录 `plannerMeta.status`。
- 坐标必须 `[lon,lat,alt]`。
- `phase.startOffsetMin < phase.endOffsetMin`。
- `routes[].checkpoints` 必须按时间递增。
- `preferredPlan.routes.length` 为 0 时，`support-planning` 会报缺上游。

### 7. 异常与空输入

- 缺敌情或目标分配上游：`validatePlanning()` 拦截。
- 分配无 assignment：当前允许 fallback 到目标锚点；真实算法需输出 `planningBasis` 说明 fallback。
- 威胁/环境数据为空：允许执行，代价场只包含距离和默认成本。
- 路径不可达：输出 fallback 直连或返回 `PLANNING_ALGORITHM_FAILED`，需按任务风险确认。

## 四、实现步骤

### 推荐函数拆分

| 函数 | 职责 |
|---|---|
| `buildRouteTasks()` | assignment/目标锚点转路线任务 |
| `buildCostField()` | 地形、威胁、气象、电磁代价场 |
| `solveRouteSegment()` | A*/Dijkstra/RRT 求解 |
| `applyAltitudeProfile()` | 高度剖面 |
| `evaluateRouteMetrics()` | 路线指标 |
| `buildMethodPhases()` | 阶段时序 |
| `buildMethodVisualization()` | 路线与约束层 |

### 主流程伪代码

```ts
function runMethodPlanning(context, input, dataset) {
  const scenario = buildMethodPlanningScenario(context, input, dataset)
  const plans = ['a-star', 'dijkstra', 'rrt'].map(method => {
    const routes = scenario.routeTasks.map(task => {
      const field = buildCostField(task, scenario.threatNodes, scenario.environment, input.options, method)
      const path = solveRoute(field, method)
      const coordinates = applyAltitudeProfile(path, input.options.altitudeProfile)
      return evaluateRoute(task, coordinates, field)
    })
    return buildMethodPlan(method, routes, scenario, input.options)
  })
  const preferred = pickByMethod(plans, input.builtinMethodKey)
  return buildStructuredOutput(scenario, plans, preferred)
}
```

### 可保留与需重写

可保留：

- `preferredPlan` 结构。
- 阶段、关键行动、三维可视化实体格式。
- method 对比字段。

建议重写：

- 代价场接入真实地形、威胁、禁飞区。
- RRT 随机扩展策略与碰撞检测。
- 多平台/多波次时序协调。
- 航路可行性验证。

## 五、测试方案

| 用例 | 输入 | 预期输出 | 验证点 |
|---|---|---|---|
| 正常火力打击 | 执行 `fire-strike-task` | 200；`preferredPlan.missionType=fire-strike` | routes/phases/keyActions 非空 |
| 正常机降突击 | 执行 `air-assault-task` 且有选址 | 200；`missionType=air-assault` | 路线包含机降联动节点 |
| 切换方法 | `builtinMethodKey=rrt` | `preferredPlanMethodKey=rrt` | `plannerMeta.methodKey=rrt` |
| 无 assignment fallback | 上游目标分配无有效分配 | 仍生成基础路线或明确错误 | `planningBasis.routeTaskCount` 有解释 |
| 极端环境 | 高威胁/高惩罚环境 | 分数下降且 `riskLevel` 提高 | `averageFieldCost/peakFieldCost` 合理 |
| 标准 JSON 对齐 | 完整执行 | 字段齐全 | `support-planning` 可继续执行 |
| 前端展示兼容 | 单算法页 | 不报错 | 三维路线实体可渲染 |

示例断言：

```js
assert.equal(output.implementationStatus, 'implemented');
assert.ok(Array.isArray(output.comparedPlans));
assert.ok(output.preferredPlan.score >= 0 && output.preferredPlan.score <= 100);
assert.ok(Array.isArray(output.preferredPlan.routes));
assert.ok(Array.isArray(output.preferredPlan.phases));
assert.ok(output.preferredPlan.metrics.checkpointCount >= 0);
```

## 六、验收标准

- 必须输出 `planningBasis/comparedPlans/preferredPlan/systemBestPlanMethodKey/explanation`。
- `preferredPlan.routes[]` 每条必须有 `coordinates/checkpoints/metrics/plannerMeta`。
- `preferredPlan.phases[]` 时间窗口必须合法。
- `preferredPlan.visualization.entities` 必须可被三维组件消费。
- 无有效上游目标时必须明确 fallback 或错误，不允许静默输出空保障可用方案。
- 与 `support-planning` 兼容：`routes` 和 `phases` 不得为空。

