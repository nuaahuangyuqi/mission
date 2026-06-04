# 算法 4 详细设计与测试文档：机降地域优化选择

## 一、算法定位

| 项 | 内容 |
|---|---|
| 算法名称 | 机降地域优化选择 |
| 算法 id / key | `airborne-landing-site-selection` |
| 默认 methodKey | `weighted-score` |
| 可选 methodKey | `weighted-score`、`pareto-ranking`、`constraint-screening` |
| 所属模块 | `intelligent-task-planning` |
| 当前源码位置 | `apps/server/src/planning-runtime.js`：`LANDING_SITE_METHODS`、`runBuiltinAirborneLandingSiteSelection()` |
| 调用入口 | 机降任务步骤 `step-airborne-landing-site-selection` |
| 平台流程作用 | 在机降突击任务中，根据威胁、目标、地形/环境和直升机模型选择候选机降地域 |
| 上游 | `enemy-threat-analysis`、`target-allocation`；内部也读取 `force-grouping` 计算集结锚点 |
| 下游 | `method-planning`、`support-planning` |

该算法只出现在 `air-assault-task` 默认流程中。火力打击任务不会执行该步骤，但 `buildFinalResult()` 仍保留 `consolidatedOutputs.airborneLandingSiteSelection` 空对象。

## 二、接口适配说明

### 1. 输入参数结构

```json
{
  "algorithmInputs": {
    "airborne-landing-site-selection": {
      "builtinMethodKey": "weighted-score",
      "selectedSourceIds": [],
      "uploadedFiles": [],
      "options": {
        "sitePreference": "balanced",
        "helicopterModel": "medium-lift",
        "candidateCount": 5
      }
    }
  }
}
```

### 2. 字段说明

| 字段 | 类型 | 必填 | 默认值 | 前端来源 | 后端接收位置 | 含义 |
|---|---|---:|---|---|---|---|
| `builtinMethodKey` | string | 是 | `weighted-score` | 内置方法下拉框 | `evaluateLandingCandidates()` | 选择推荐排序方法 |
| `options.sitePreference` | string | 否 | `balanced` | 选址侧重下拉框 | 候选点评分 | `balanced / concealment / safety / assembly` |
| `options.helicopterModel` | string | 否 | `medium-lift` | 直升机型号下拉框 | `buildHelicopterProfile()` | `light-lift / medium-lift / heavy-lift` |
| `options.candidateCount` | number | 否 | `5` | 候选点数量输入框 | `clamp(...,3,8)` | 生成 3-8 个候选点 |

该算法不直接消费资源库选择和上传文件，主要从上游和 `dataset.environment` 读取：

- `enemy-threat-analysis`：威胁节点与威胁中心。
- `target-allocation`：目标锚点、压制/突击序列。
- `force-grouping`：我方集结锚点。
- `environment`：地形、气象、电磁等环境约束。

### 3. 输出 JSON 完整结构

| 字段 | 类型 | 生成逻辑 |
|---|---|---|
| `implementationStatus` | string | 固定 `implemented` |
| `builtinMethodKey` / `builtinMethodLabel` | string | 输入方法与 label |
| `helicopterProfile` | object | 直升机模型 `{ key,label,cruiseSpeedKmh,maxRadiusKm,liftCapacity,zoneSizeKm }` |
| `stagingAnchor` | number[] | 编组/数据集推导的出发集结点 |
| `objectiveAnchor` | number[] | 目标分配或威胁目标推导的目标锚点 |
| `methodComparison` | array | 三类选址方法的最佳点、均分、可用点数量 |
| `rankedCandidates` | array | 当前 method 排序后的候选地域 |
| `preferredCandidateId` | string | 推荐地域 id |
| `preferredCandidate` | object/null | 推荐地域完整结构 |
| `linkageAnalysis` | array | 与压制、波次、后续流程联动说明 |
| `visualization` | object | 三维点位、地域面、接近航路 |

候选地域结构：

```json
{
  "id": "landing-candidate-1",
  "name": "候选机降地域 1",
  "source": "seed-candidate",
  "center": [118.2, 32.1, 0],
  "zone": [
    [118.18, 32.08, 0],
    [118.22, 32.08, 0],
    [118.22, 32.12, 0],
    [118.18, 32.12, 0]
  ],
  "ingressDistanceKm": 28.5,
  "assaultDistanceKm": 6.2,
  "totalDistanceKm": 34.7,
  "threatExposure": 32,
  "concealment": 74,
  "safety": 68,
  "assemblyEfficiency": 72,
  "helicopterFit": 91,
  "qualified": true,
  "baseScore": 76.4,
  "score": 78.2,
  "rank": 1
}
```

兼容要求：

- 前端当前指标卡读取 `preferredCandidate.name/score`，但候选数量使用旧字段 `candidates?.length`，实际输出是 `rankedCandidates`；建议补前端 alias 或在真实算法中同时输出 `candidates: rankedCandidates`。
- 前端表格旧 specs 里有 `comparedPlans`，实际输出是 `methodComparison`；建议保留 `methodComparison`，可增加 alias `comparedPlans`。
- 下游 `method-planning` 读取 `preferredCandidate.center/zone` 生成机降接近点。
- `support-planning` 机降任务会校验 `landingSelection.preferredCandidate` 非空。

## 三、算法设计说明

### 1. 算法目标

在威胁暴露可控、距离可达、便于集结、适配直升机投送能力的前提下，选择最适合机降突击的地域，并为后续航路规划和保障节点提供空间锚点。

### 2. 核心问题定义

```text
Given:
  stagingAnchor, objectiveAnchor, threatNodes, environment, helicopterProfile
Generate:
  Candidate landing zones
Evaluate:
  threatExposure, concealment, safety, assemblyEfficiency, helicopterFit
Rank:
  weighted-score / pareto-ranking / constraint-screening
```

### 3. 输入预处理

1. 从编组输出计算 `stagingAnchor`。
2. 从目标分配或威胁输出计算 `objectiveAnchor`。
3. 从威胁输出构造 `threatNodes`。
4. 从环境数据抽取地形、气象、电磁等约束。
5. 根据直升机型号构建巡航速度、最大半径、载荷、地域尺寸。
6. 生成候选点数量 clamp 到 3-8。

### 4. 关键指标

| 指标 | 说明 | 建议真实算法 |
|---|---|---|
| `threatExposure` | 暴露于火力、防空、侦察等威胁的程度 | 距离衰减 + 可视域 + 敌火覆盖叠加 |
| `concealment` | 隐蔽性 | 地形遮蔽、植被/建筑、气象可见度 |
| `safety` | 安全性 | 威胁暴露反向分、地形坡度、障碍 |
| `assemblyEfficiency` | 集结效率 | 与目标/编组/道路/地域尺寸关系 |
| `helicopterFit` | 直升机适配 | 半径、载荷、着陆区尺寸、航程余量 |
| `score` | 综合分 | method 与 `sitePreference` 权重加权 |

### 5. 权重模型

推荐基础权重：

```text
balanced:
  safety 0.28
  concealment 0.22
  assemblyEfficiency 0.20
  helicopterFit 0.20
  threatExposurePenalty 0.10

safety:
  safety 0.38
  threatExposurePenalty 0.20

concealment:
  concealment 0.36

assembly:
  assemblyEfficiency 0.34
```

`constraint-screening` 应先剔除不满足最大航程、威胁暴露阈值、着陆区尺寸的候选点，再排序。

### 6. 异常与空输入

- 缺敌情或目标分配上游：`validatePlanning()` 拦截。
- 目标分配无 assignment：当前实现可回退到目标锚点/威胁锚点；真实算法需明确 fallback。
- 无候选点：输出 `rankedCandidates=[]`、`preferredCandidate=null`，但机降任务下游保障会报缺机降地域；建议前置返回 `PLANNING_MISSING_DATA`。
- 环境缺失：允许使用 fallbackAnchor，但 `linkageAnalysis` 要提示环境数据不足。

## 四、实现步骤

### 推荐函数拆分

| 函数 | 职责 |
|---|---|
| `resolveAnchors()` | 计算集结、目标、威胁中心 |
| `buildHelicopterProfile()` | 直升机参数归一 |
| `generateLandingCandidates()` | 候选点生成，支持网格/采样/外部地形候选 |
| `evaluateLandingCandidate()` | 计算五类指标 |
| `rankLandingCandidates()` | 按 methodKey 排序 |
| `buildLandingLinkageAnalysis()` | 解释与流程联动 |
| `buildLandingVisualization()` | 地图/三维实体 |

### 主流程伪代码

```ts
function runLandingSelection(context, input, dataset) {
  const threat = context.stageOutputs['enemy-threat-analysis']
  const allocation = context.stageOutputs['target-allocation']
  const grouping = context.stageOutputs['force-grouping']
  const anchors = resolveAnchors(grouping, allocation, threat, dataset)
  const heli = buildHelicopterProfile(input.options.helicopterModel)
  const raw = generateLandingCandidates(anchors, threat, dataset.environment, heli, input.options.candidateCount)
  const evaluated = raw.map(candidate => evaluateLandingCandidate(candidate, anchors, threat, dataset.environment, heli))
  const byMethod = methods.map(method => rankLandingCandidates(evaluated, method.key, input.options.sitePreference))
  const ranked = byMethod[input.builtinMethodKey] || byMethod['weighted-score']
  const preferred = ranked[0] || null
  return buildStructuredOutput(heli, anchors, byMethod, ranked, preferred)
}
```

### 可保留与需重写

可保留：

- `helicopterProfile`、`rankedCandidates`、`methodComparison`、`visualization` 字段。
- `linkageAnalysis` 文案结构。

建议重写：

- 候选点生成：接入 DEM、坡度、障碍物、可着陆面积。
- 威胁暴露：接入真实威胁场/射界/雷达覆盖。
- 直升机适配：接入机型性能库与航线油耗。

## 五、测试方案

| 用例 | 输入 | 预期输出 | 验证点 |
|---|---|---|---|
| 正常机降流程 | 执行 `air-assault-task` 至选址 | 200；`rankedCandidates.length` 在 3-8 | `preferredCandidate` 非空 |
| 切换方法 | `builtinMethodKey=pareto-ranking` | `preferredCandidate` 来源于 Pareto 排序 | `methodComparison` 三项齐全 |
| 极端候选数 | `candidateCount=99` | clamp 为最多 8 | 输出数量不超过 8 |
| 轻型直升机 | `helicopterModel=light-lift` | `helicopterProfile.key=light-lift` | 航程/适配影响评分 |
| 无环境数据 | 空 `dataset.environment` | 仍可输出候选 | `linkageAnalysis` 存在 |
| 无可用候选 | 威胁极高或约束筛选全部失败 | `preferredCandidate=null` 或返回 400 | 不输出非法中心点 |
| 前端兼容 | 单算法页 | 不报错 | 建议 `candidates` alias 或前端读 `rankedCandidates` |

示例断言：

```js
assert.equal(output.implementationStatus, 'implemented');
assert.ok(Array.isArray(output.methodComparison));
assert.ok(Array.isArray(output.rankedCandidates));
assert.ok(output.rankedCandidates.length <= 8);
assert.ok(output.preferredCandidate === null || output.preferredCandidate.score <= 100);
```

## 六、验收标准

- 必须输出 `helicopterProfile/stagingAnchor/objectiveAnchor/methodComparison/rankedCandidates/preferredCandidate/visualization`。
- 候选点分数必须在 `0-100`。
- 每个候选点必须包含 `center` 和 `zone`，坐标格式为 `[lon,lat,alt]`。
- `qualified=false` 的候选点可以保留，但不能被 `constraint-screening` 推荐为首选。
- 机降任务中 `preferredCandidate` 缺失时，下游保障应明确报错。
- 保持当前字段，并建议增加 `candidates`、`comparedPlans` alias 以改善前端兼容。

