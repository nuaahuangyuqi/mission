# 算法 1 详细设计与测试文档：敌情威胁自动分析

## 一、算法定位

| 项 | 内容 |
|---|---|
| 算法名称 | 敌情威胁自动分析 |
| 算法 id / key | `enemy-threat-analysis` |
| 默认 methodKey | `knowledge-fusion` |
| 可选 methodKey | `knowledge-fusion`、`coverage-priority` |
| 所属模块 | `intelligent-task-planning` |
| 当前源码位置 | `apps/server/src/planning-runtime.js`：`ALGORITHM_DEFINITIONS`、`runBuiltinThreatAnalysis()` |
| 调用入口 | `POST /api/planning/validate`、`POST /api/planning/evaluate` |
| 前端配置入口 | `apps/web/src/views/planning/PlanningAlgorithmsStep.vue` |
| 结果展示入口 | `apps/web/src/views/planning/PlanningTaskExecutionResultStep.vue` |
| 平台流程作用 | 第 1 个规划步骤，为编组、目标分配、机降选址、战法规划提供威胁节点、目标锚点和可视化约束 |
| 上下游关系 | 无硬上游；下游为 `force-grouping`、`target-allocation`、`airborne-landing-site-selection`、`method-planning` |

当前实现是内置启发式模型，主要融合资源库红方情报、环境、抽取文本和上传文件。真实算法替换时必须保持 `structuredOutput` 字段兼容。

## 二、接口适配说明

### 1. 输入参数结构

```json
{
  "algorithmInputs": {
    "enemy-threat-analysis": {
      "builtinMethodKey": "knowledge-fusion",
      "selectedSourceIds": [1, 2],
      "uploadedFiles": [
        {
          "id": "file-1",
          "fileName": "enemy.csv",
          "fileExtension": ".csv",
          "size": 1280,
          "fileContentBase64": "..."
        }
      ],
      "options": {
        "analysisFocus": "comprehensive",
        "heatmapDensity": "medium",
        "impactBias": "balanced"
      }
    }
  }
}
```

### 2. 字段说明

| 字段 | 类型 | 必填 | 默认值 | 前端来源 | 后端接收位置 | 含义 |
|---|---|---:|---|---|---|---|
| `builtinMethodKey` | string | 是 | `knowledge-fusion` | 内置方法下拉框 | `normalizeAlgorithmInput()` | 选择知识融合或覆盖优先 |
| `selectedSourceIds` | number[] | 否 | `[]` | 数据源选择弹窗 | `buildSourceBundle()` | 只使用被勾选的数据源 |
| `uploadedFiles` | object[] | 否 | `[]` | 本地文件上传 | `normalizeUploadedFiles()` | 上传 Word/PDF/Excel/CSV 文件 |
| `options.analysisFocus` | string | 否 | `comprehensive` | 分析重点下拉框 | `getAnalysisFocusProfile()` | `comprehensive / coverage / air-defense` |
| `options.heatmapDensity` | string | 否 | `medium` | 热力图密度下拉框 | `getHeatmapDensityProfile()` | `low / medium / high` |
| `options.impactBias` | string | 否 | `balanced` | 影响评估倾向下拉框 | `getImpactBiasProfile()` | `balanced / suppression / mobility` |

必填规则：如果任务包含 `enemy-threat-analysis`，`validatePlanning()` 要求 `selectedSourceIds` 或 `uploadedFiles` 至少有一个非空，否则返回 `PLANNING_MISSING_DATA`。

兼容注意：算法定义里 `supportedFileTypes` 包含 `.txt`，但 `resolveImportedFileType()` 当前只解析 Word/PDF/Excel/CSV，`.txt` 上传会被拒绝，需确认后再实现 TXT 解析或调整前端说明。

### 3. 输出 JSON 完整结构

`structuredOutput` 顶层字段：

| 字段 | 类型 | 生成逻辑 |
|---|---|---|
| `implementationStatus` | string | 固定 `implemented` |
| `builtinMethodKey` | string | 回填输入方法 key |
| `builtinMethodLabel` | string | `findMethodLabel(THREAT_METHODS, key)` |
| `appliedOptions` | object | 输入 options 克隆 |
| `inputSummary` | object | 统计选中资源、抽取、上传文件、红方情报、环境、证据数量 |
| `selectedSources` | array | 选中 `sources` 的 `{ id, name, type }` |
| `importedFiles` | array | 上传文件的 `{ id, fileName, fileExtension, summary }` |
| `evidenceTrace` | array | `buildEvidenceTraceEntries(evidenceEntries, 60)`，供前端证据溯源 |
| `threatLevel` | string | `resolveThreatLevel(threatScore)`，高/中/低 |
| `threatScore` | number | 多因子加权后 clamp 到 0-100 |
| `enemyUnitCount` | number | 红方情报记录数 |
| `identifiedThreatNodeCount` | number | 火力、防空、侦察、反机降节点数量之和 |
| `enemyIntentions` | array | 由意图关键词、情报和证据文本评分排序 |
| `deploymentSectors` | array | 结构化部署区 + 文本推断部署区融合 |
| `fireCoverage` | array | 火力覆盖圈，按 `threatValue` 融合排序 |
| `airDefenseSystem` | array | 防空节点，按 `strength` 融合排序 |
| `reconEarlyWarning` | array | 侦察预警节点，按 `confidence` 融合排序 |
| `antiAirborneFacilities` | array | 反机降设施，按 `confidence` 融合排序 |
| `impactAnalysis` | array | 由威胁等级、节点数量和 `impactBias` 生成解释 |
| `visualization` | object | 三维球实体、热区、覆盖统计 |

主要数组元素结构：

```json
{
  "enemyIntentions": [
    {
      "id": "intent-fire-strike-preparation",
      "name": "火力准备与压制",
      "score": 76.5,
      "description": "...",
      "evidence": []
    }
  ],
  "fireCoverage": [
    {
      "id": "fire-coverage-1",
      "name": "北侧远程火力群",
      "sourceUnitId": "red-1",
      "source": "红方情报或文档推断",
      "center": [118.1, 32.0, 0],
      "radiusMeters": 42000,
      "coverageKm": 42,
      "threatValue": 83.2,
      "notes": "...",
      "inferredFromText": false,
      "evidence": ["..."]
    }
  ],
  "impactAnalysis": [
    {
      "id": "impact-1",
      "title": "重点方向火力压制风险",
      "level": "中",
      "detail": "..."
    }
  ]
}
```

`visualization.entities[]` 必须兼容三维球：

```json
{
  "id": "threat-fire-fire-coverage-1",
  "name": "火力覆盖圈",
  "type": "sensor",
  "camp": "red",
  "layerKey": "sensors",
  "color": "#ef4444",
  "geometryType": "circle",
  "coordinates": [118.1, 32.0, 0],
  "radius": 42000,
  "annotation": "火力覆盖 42 km / 威胁值 83.2",
  "visible": true,
  "meta": {}
}
```

与标准结果兼容要求：

- 前端指标卡读取 `threatLevel / threatScore / enemyUnitCount / identifiedThreatNodeCount`。
- 前端表格读取 `enemyIntentions / deploymentSectors / fireCoverage / airDefenseSystem / reconEarlyWarning / antiAirborneFacilities / impactAnalysis / evidenceTrace`。
- 三维结果读取 `visualization.entities` 与 `visualization.environment`。
- 通用威胁场字段 `heatmapBase64 / heatmapGeojson / bounds / targetEntities / pointThreatEvaluation / situationMap / heatmap` 当前内置算法不稳定输出；未来真实算法如输出这些字段，前端 `PlanningThreatMapPanel` 会自动渲染。

## 三、算法设计说明

### 1. 算法目标

把多源敌情、环境与文档证据转为可计算、可解释、可视化的威胁模型，为下游编组、目标分配、机降选址与战法规划提供：

- 威胁等级与量化分数。
- 敌方意图排序。
- 威胁节点集合。
- 空间覆盖区与三维标注。
- 作战影响解释。

### 2. 核心问题定义

输入是非结构化/半结构化情报集合，输出是按节点类型归一的威胁图：

```text
ThreatGraph = {
  intentions,
  deploymentSectors,
  fireCoverage,
  airDefenseSystem,
  reconEarlyWarning,
  antiAirborneFacilities
}
```

真实算法可以使用 NLP、实体抽取、规则引擎、图融合或空间聚类，但最终必须落到当前 JSON 字段。

### 3. 预处理

1. 使用 `selectedSourceIds` 筛选资源库。
2. 从 `source_contents` 提取预览文本。
3. 从 `extractions` 提取摘要/正文。
4. 从 `intelligence` 过滤 `camp === "red"` 的记录。
5. 从 `environment` 过滤选中数据源关联环境。
6. 对上传文件调用 `normalizeImportedPreview()`，生成 `extractionDrafts`。
7. 合并为 `evidenceCorpus` 和 `evidenceEntries`。

### 4. 关键指标计算

建议真实算法保留当前分数构成：

| 指标 | 建议算法 |
|---|---|
| 火力压力 | 火力节点威胁值均值 + 覆盖半径 + 文本置信度 |
| 防空压力 | 防空节点强度 + 覆盖半径 + 侦察证据 |
| 侦察预警压力 | 预警节点置信度 + 覆盖半径 |
| 反机降压力 | 设施置信度 + 与环境/目标锚点距离 |
| 证据充分度 | 证据条目数、来源多样性、抽取置信度 |
| 部署复杂度 | 部署方向数量与平均强度 |

### 5. 权重与评分模型

当前 `threatScore` 由以下部分组成，并 clamp 到 `0-100`：

```text
16
+ redUnitCount contribution
+ redUnitStrength contribution
+ firePressure * analysisFocus.fireCoverage
+ airDefensePressure * analysisFocus.airDefenseSystem
+ reconPressure * analysisFocus.reconEarlyWarning
+ antiAirbornePressure * analysisFocus.antiAirborneFacilities
+ deploymentSectorCount * analysisFocus.deploymentSectors
+ identifiedThreatNodeCount
+ evidenceEntryCount
```

真实算法建议把每项拆成可解释的 `scoreBreakdown`，但新增字段不能替代现有 `threatScore`。

### 6. 约束条件

- `threatScore` 必须在 `0-100`。
- 坐标必须是 `[lon, lat, alt]`。
- 半径字段必须非负。
- 无坐标证据需使用 `buildThreatAnchorPack()` 或等效锚点推断，不能返回非法坐标。
- 证据溯源字段必须可追到来源名称/类型/文件名/抽取时间；缺失时用空字符串或 `0`，不要省略字段。

### 7. 异常与空输入处理

- 无资源且无上传文件：在 `validatePlanning()` 拦截，返回 400。
- 上传不支持格式：`normalizePlanningUpload()` 返回 `PLANNING_MISSING_DATA`。
- 资源库选中但无红方情报：允许执行，输出低分、空数组和提示型 `impactAnalysis`。
- 解析失败：建议把失败文件加入错误 `details.fileName`，不要输出半结构化失败结果。

### 8. 结果解释文本

`summary` 说明使用的方法、融合情报条数和上传材料数。`outputPreview` 固定至少三条：

1. 威胁等级与评分。
2. 识别的部署方向、火力覆盖、防空节点数量。
3. 主导敌方意图或未识别提示。

`impactAnalysis[].detail` 应说明“为什么是该等级”和“对下游行动的影响”。

## 四、实现步骤

### 推荐数据结构

```ts
type ThreatNode = {
  id: string
  name: string
  category: 'fireCoverage' | 'airDefenseSystem' | 'reconEarlyWarning' | 'antiAirborneFacilities'
  location: [number, number, number]
  score: number
  confidence: number
  evidenceIds: string[]
}
```

### 推荐函数拆分

| 函数 | 职责 |
|---|---|
| `collectThreatInputs()` | 封装 `buildSourceBundle`、上传解析、红方情报过滤 |
| `extractThreatEvidence()` | 从文本/表格抽取实体、关系、坐标、节点类型 |
| `buildThreatNodes()` | 结构化节点归一与去重融合 |
| `scoreThreatNodes()` | 计算各节点威胁值/强度/置信度 |
| `scoreThreatSituation()` | 生成 `threatScore / threatLevel` |
| `buildThreatVisualization()` | 生成 `visualization` 与可选热力字段 |
| `buildThreatExplanation()` | 生成 `summary / outputPreview / impactAnalysis` |

### 主流程伪代码

```ts
async function runThreatAnalysis(context, step, algorithm, input, dataset) {
  const sourceBundle = buildSourceBundle(dataset, input.selectedSourceIds)
  const uploadedFiles = await normalizeUploadedFiles(input.uploadedFiles)
  const redIntel = buildSelectedIntelligence(dataset, 'red', sourceBundle.sourceIdSet)
  const evidence = extractThreatEvidence(sourceBundle, uploadedFiles, redIntel)

  const intentions = inferEnemyIntentions(redIntel, evidence, input.options.analysisFocus)
  const nodes = buildThreatNodes(redIntel, evidence, sourceBundle.selectedEnvironment)
  const scored = scoreThreatNodes(nodes, input.builtinMethodKey, input.options)
  const sectors = inferDeploymentSectors(scored, redIntel, evidence)
  const threatScore = scoreThreatSituation(scored, sectors, redIntel, evidence, input.options)
  const threatLevel = resolveThreatLevel(threatScore)

  return buildPlatformResult({
    method: input.builtinMethodKey,
    options: input.options,
    inputSummary,
    evidenceTrace,
    intentions,
    sectors,
    scored,
    threatScore,
    threatLevel
  })
}
```

### 与现有实现替换关系

可保留：

- `normalizeUploadedFiles()`、`buildSourceBundle()`、`buildSelectedIntelligence()`。
- 输出字段组装结构。
- `buildThreatVisualizationV2()` 的实体格式。
- `buildThreatImpactAnalysisV2()` 的文本框架。

建议重写：

- 文本实体抽取逻辑。
- 节点去重融合。
- 威胁评分权重。
- 坐标/覆盖半径推断。
- 若接入真实热力图，新增 `heatmapBase64 / heatmapGeojson / bounds`。

## 五、测试方案

| 用例 | 输入 | 预期输出 | 验证点 |
|---|---|---|---|
| 正常输入：CSV 上传 | `uploadedFiles` 含 `.csv`，文本包含“火力、防空、侦察、反机降” | 200；`threatScore` 为 number；四类节点至少可由文本推断部分生成 | `implementationStatus=implemented`；`fireCoverage/airDefenseSystem/reconEarlyWarning/antiAirborneFacilities` 为数组 |
| 正常输入：资源库 | `selectedSourceIds=[1]`，DB 有 red intelligence/source_contents/extractions | 200；`inputSummary.selectedSourceCount=1` | 未勾选资源不会进入输出 |
| 空输入 | `selectedSourceIds=[]`、`uploadedFiles=[]` | 400 | `error.code=PLANNING_MISSING_DATA`，提示至少勾选或上传 |
| 缺字段 | `options={}` | 200 | 使用默认 `analysisFocus/heatmapDensity/impactBias` 或安全空值 |
| 极端值 | 红方强度极高、节点很多 | 200；`threatScore<=100` | 分数 clamp |
| 多数据源 | 同时选多个 source + 上传文件 | 200；`evidenceTrace` 包含资源和文件来源 | 证据字段完整 |
| 标准 JSON 对齐 | 执行后读取 `structuredOutput` | 所有顶层字段存在 | 前端 `FIELD_LABELS/TABLE_SPECS` 不报错 |
| 前端展示兼容 | 打开 `/planning/tasks/execute/step/step-threat-analysis` | 指标卡、表格、三维面板正常 | `visualization.entities` 可渲染 |

示例断言：

```js
assert.equal(output.implementationStatus, 'implemented');
assert.equal(typeof output.threatScore, 'number');
assert.ok(output.threatScore >= 0 && output.threatScore <= 100);
assert.ok(Array.isArray(output.evidenceTrace));
assert.ok(Array.isArray(output.visualization.entities));
```

## 六、验收标准

- `structuredOutput` 必须包含本文列出的顶层字段。
- `threatScore` 必须为 `0-100`，`threatLevel` 只能为 `高/中/低`。
- 威胁节点数组可以为空，但必须是数组。
- `evidenceTrace` 每条至少包含 `id/title/summary/sourceType/sourceName/fileName/extractedAt`。
- `visualization.entities` 中坐标、半径和 `geometryType` 必须满足三维组件要求。
- 无数据时必须给出明确错误，不允许输出伪造高置信结果。
- 新增字段允许，但不得删除或重命名现有字段。

