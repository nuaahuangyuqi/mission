# 智能任务规划纯算法仓库

本仓库存放智能任务规划模块的独立 Python 算法实现，用于和平台运行时对接前的算法开发、样例验证和接口固化。

## Python 虚拟环境

平台后端默认通过 `algorithms/run-with-venv.mjs` 运行本地 Python 算法。首次执行时，启动器会在本目录创建 `algorithms/.venv`，安装根目录 `requirements.txt` 以及各子算法目录中的 `requirements.txt`，随后用 `.venv` 中的 Python 执行实际 CLI 或脚本。

日常使用不需要手动激活虚拟环境；如果要指定创建 venv 的基础 Python，可设置：

```bash
PLANNING_PYTHON_BOOTSTRAP_BIN=python3.11 npm run dev:server
```

如果确实要绕过自动 venv 启动器，可设置 `PLANNING_PYTHON_USE_VENV=0`，此时 `PLANNING_PYTHON_BIN` 会作为直接执行命令使用。

## 算法状态

| 阶段 | 目录 | 状态 | 说明 |
|---|---|---|---|
| 1 敌情威胁自动分析 | `enemy-threat-analysis` | 已有实现 | 生成威胁评分、火力/防空/侦察/反机降节点等下游输入。 |
| 2 作战力量智能编组 | `force-grouping` | 已有实现 | 生成 `preferredScheme.groups`，其中 `mobility` 表示行进速度 km/h。 |
| 3 作战目标自动分配 | `target-allocation` | 已实现 | 新增 `intelligent-allocation / 智能分配算法`，按编组落实到目标，综合速度响应评分，并为同一编组多目标任务生成连续目标链路。 |
| 5 作战方法自动规划 | `method-planning` | 已实现 | 新增 `intelligent-planning / 智能路径规划算法`，用 A*、威胁代价地图和 DEM 地形代价地图把链路化分配结果转成连续分腿路线、阶段、关键动作和可视化。 |

## terrain 地形文件

仓库根目录可放置 `terrain/` 地形目录。当前实现按 Cesium `quantized-mesh-1.0` 读取：

- `terrain/meta.json`
- `terrain/layer.json`
- `terrain/{z}/{x}/{y}.terrain`

地形采样模块只按经纬度定位需要的瓦片，并从最高可用层级向下回退，不递归扫描完整瓦片目录。采样结果包含高程、坡度、起伏、地形罚分、速度系数和遮蔽加成。

地形是第三/第五部分的软约束：

- 第三部分用地形修正机动响应、风险暴露、匹配分/可行性和 assignment reason。
- 第五部分用 DEM 地形代价地图参与 A* 路线搜索，并修正路线代价、预计时长、隐蔽/暴露、高度剖面和路线指标。
- 地形缺失、瓦片缺失、坐标越界或文件损坏时，算法回退中性地形，不中断整体规划。

## 第三部分输入输出

`target-allocation` 只依赖：

- `enemy-threat-analysis` 输出。
- `force-grouping` 输出中的 `preferredScheme.groups`。
- 分配偏好：
  - `objectivePreference`: `balanced / firepower-first / survivability-first`
  - `validationMode`: `strict / standard`
  - `maxAssignmentsPerGroup`: `1-6` 的整数上限

输出保持平台第三部分契约，包含：

- `candidateTargets`
- `deploymentContexts` / `targetClusters`
- `platforms`
- `groups`
- `comparedPlans`
- `preferredPlan`
- `systemBestPlan`
- `validation`
- `validationFindings`
- `adjustmentSuggestions`

说明：`deploymentSectors / 部署区` 是第一阶段根据多个真实目标聚类形成的空间区域，不是火力打击实体。第三部分不会把部署区放入 `candidateTargets`，也不会生成指向部署区的 assignment；部署区仅作为 `deploymentContexts / targetClusters` 保留，用于说明实体目标所在区域和地图背景。

第二部分字段结构不变，但 `mobility` 的真实含义是行进速度，按 km/h 理解，仍限制在 `0-100` 范围。第三部分分配不再单纯按距离近远，而是综合距离、行进速度、预计响应时间、目标波次紧迫性和能力适配。

同一编组承担多个目标时，第三部分会输出连续目标链路，而不是把每个目标都视为从原始阵位独立出发。`preferredPlan.assignments[]` 保留既有字段，并新增 `chainId / groupSequence / legIndex / legCount / routeStartCoordinates / routeEndCoordinates / previousTargetId / nextTargetId / chainLegDistanceKm / cumulativeChainDistanceKm / originDistanceKm`。其中 `distanceKm` 表示实际执行分腿距离，`originDistanceKm` 保留原始阵位到目标的审计距离。`preferredPlan.taskChains[]` 汇总每个编组的目标顺序、分腿距离、总链路距离和波次跨度。

目标池会合并第一阶段四类威胁节点和 `targetAssessments` 中的真实实体目标，并按 id、来源实体和名称去重；`deploymentSectors` 仍只作为部署区上下文，不会进入可打击目标。

## 运行第三部分

```bash
cd /Users/hyq/Research/projects/602/纯算法/target-allocation
python -m target_allocation.cli \
  --upstream-threat ../force-grouping/docs/sample_enemy_threat_output.json \
  --upstream-grouping ../force-grouping/result.json \
  --objective-preference balanced \
  --validation-mode strict \
  --max-assignments-per-group 2 \
  --terrain-dir ../terrain \
  --output result.json
```

当上游 JSON 含有真实经纬度时，可额外传入 `--plot-output outputs/test-allocation-map.svg` 生成分配箭头图。

## 测试

```bash
cd /Users/hyq/Research/projects/602/纯算法/target-allocation
python -m pytest
```

当前第三部分测试覆盖正常样例、三种目标偏好、两种验证模式、负荷约束、部署区非实体保护、`targetAssessments` 合并去重、连续目标链路排序、跨波次不返航、速度综合分配、地形软约束、缺目标、缺编组、缺上游、CLI 运行和真实经纬度分配箭头图生成。

第五部分测试：

```bash
cd /Users/hyq/Research/projects/602/纯算法/method-planning
python -m pytest
```

当前第五部分测试覆盖火力打击、机降突击、A* 代价图元数据、链路化 routeTasks 连续起点、航路侧重、高度剖面、行动节奏、地形高度/耗时软约束、assignment fallback、无目标空方案、CLI 运行和三类 SVG 路线底图生成。

测试图产物：

```text
target-allocation/outputs/test-allocation-map.svg
```

## 五部分联调

根目录联调脚本会执行第 1、2、3、5 部分；第四部分纯算法尚未落地，机降模式下会生成模拟选址结果供第五部分验证：

```bash
cd /Users/hyq/Research/projects/602/纯算法
python three_part_integration_test.py --output-dir integration-outputs/latest-three-part-run
```

脚本会串起：

1. `enemy-threat-analysis`
2. `force-grouping`
3. `target-allocation`
5. `method-planning`

运行时终端会持续输出阶段进度、耗时、关键数量、分配明细和产物索引。输出包包含：

- `json/01-enemy-threat-analysis.json`
- `json/02-force-grouping.json`
- `json/03-target-allocation.json`
- `json/05-method-planning.json`
- `images/01-threat-heatmap.png`
- `images/01-target-map.png`
- `images/01-combined-map.png`
- `images/03-allocation-map.svg`
- `images/05-route-map.svg`
- `images/05-route-threat-map.svg`
- `images/05-route-terrain-map.svg`
- `images/05-route-combined-map.svg`
- `tables/03-assignment-table.csv`
- `tables/05-route-table.csv`
- `reports/five-part-integration-report.md`
- `reports/five-part-integration-report.html`
- `reports/five-part-integration-report.docx`
- `reports/threat-assessment/*.docx`
- `run.log`

第三阶段分配图中，箭头只从蓝方编组指向真实目标实体；部署区若存在，只显示为半透明上下文区域。报告中会列出部署区关联的实体目标，分配表不会出现“编组 -> 部署区”的行。

第五阶段路线图中，路线折线从编组出发点或上一目标转进点指向真实目标实体；机降模式会额外显示模拟或上游提供的机降地域。默认 `05-route-map.svg` 使用威胁+DEM 综合场底图，联调还会额外生成威胁场、DEM 地形场、综合场三张路线演示图。三张底图使用各自采样范围的相对色阶，并在图例中显示实际范围、峰值和均值，用于增强演示区分度；这不改变 A* 规划使用的原始代价值。第五部分输出保留 `preferredPlan.routes / phases / metrics.totalDistanceKm / missionType`，并新增 `preferredPlan.routeChains[]`；`routes[]` 仍是分腿路线，但同一 `chainId` 的后续腿会从上一目标坐标继续规划，不返航重算。

机降路径联调示例：

```bash
python three_part_integration_test.py \
  --mission-type air-assault \
  --output-dir integration-outputs/latest-air-assault-method-run
```

默认情况下，如果输出目录已经存在，脚本会先清理该目录，确保本次联调产物干净；如需保留历史文件，可加 `--keep-existing-output`。

联调脚本默认检测根目录 `terrain/`。如果存在 `layer.json` 和 `meta.json`，会自动把地形目录传入第三/第五部分；也可以手动指定：

```bash
python three_part_integration_test.py \
  --terrain-dir terrain \
  --output-dir integration-outputs/latest-terrain-run
```

联调报告、CSV 和终端日志会展示第三部分 assignment 地形罚分，以及第五部分路线 `terrainStatus / terrainPenalty / terrainAverageSlopeDeg / terrainSampledCount`。HTML 报告会内嵌第五部分的威胁场、DEM 地形场和威胁+DEM 综合场三张路线图。

真实大模型联调：

```bash
python three_part_integration_test.py \
  --real-llm \
  --output-dir integration-outputs/latest-real-llm-run
```

真实模式会调用第一阶段敌情抽取、第一阶段敌情研判报告、第二阶段兵力抽取和第二阶段推荐解释的大模型。可按需跳过部分调用：

```bash
python three_part_integration_test.py \
  --real-llm \
  --skip-assessment \
  --skip-grouping-llm-explanation \
  --enemy-files enemy-threat-analysis/examples/sample_enemy_report.txt \
  --force-files force-grouping/docs/sample_force_report.docx force-grouping/docs/sample_force_roster.csv \
  --output-dir integration-outputs/latest-real-llm-run
```

真实模式会在终端打印 API Key 是否已配置、Base URL、model 和 timeout，但不会打印 API Key 明文。

真实模式下，第一部分解析器会兼容大模型把 `targets[].subCategory` 返回为 `null` 的情况，并在 schema 校验前规范为空字符串，避免因为可修复的空值中断联调。

根目录提供 `run_integration.sh` 作为联调包装脚本，参数集中在脚本顶部变量区。默认使用生成的两份 TXT 输入文档并开启真实 LLM：

```bash
cd /Users/hyq/Research/projects/602/纯算法
./run_integration.sh
```

如需离线 mock 联调，可在脚本内把 `REAL_LLM=0`；如需切换任务类型、路线偏好、输出目录、地形目录、目标/兵力文档，也直接修改脚本顶部变量。

脚本默认开启 LLM 流式输出：

```bash
LLM_STREAM=1
LLM_TIMEOUT_SECONDS=300
```

真实 LLM 模式下，第一/第二阶段会在终端打印 `[enemy-threat-analysis stream]` 和 `[force-grouping stream]` 的增量 JSON 片段，便于观察模型是否持续返回、估算剩余耗时并提高对长文档抽取的超时容忍性。若不想在终端显示模型片段，可在脚本中把 `LLM_STREAM=0`。

## 已知限制

- 当前只实现纯算法包，未修改平台 Node 运行时或前端选项。
- 第四部分机降选址纯算法尚未实现；第五部分可读取 `upstream_landing_selection.preferredCandidate`，根联调在 `--mission-type air-assault` 时使用模拟机降地域。
- 坐标缺失时，距离与射程按中性分处理，并在 assignment reason 与 validation 中提示。
- 地形是软约束；如果 `terrain/` 不存在或某些瓦片不可用，第三/第五部分会回退中性地形并继续输出平台兼容 JSON。
- `comparedPlans` 仅包含一套智能分配方案，不保留旧的匈牙利/蚁群/多目标占位方案。
- 部署区不是可打击实体；如上游只输出部署区而没有真实目标实体，第三部分会返回可解释低分结果，不伪造 assignment。
