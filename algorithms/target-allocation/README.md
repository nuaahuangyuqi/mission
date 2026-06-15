# target-allocation 智能分配算法

第三阶段独立 Python 算法包，算法 id 为 `target-allocation`，方法为 `intelligent-allocation / 智能分配算法`。

## 能力

- 从第一阶段 `enemy-threat-analysis` 输出构建统一 `candidateTargets`。
- 将第一阶段 `deploymentSectors` 保留为 `deploymentContexts / targetClusters` 空间上下文，不作为可分配目标。
- 从第二阶段 `force-grouping` 的 `preferredScheme.groups` 构建可分配编组与兼容 `platforms`。
- 按目标优先级、编组能力适配、角色适配、可行性、行进速度响应、负荷上限和协同覆盖生成任务分配。
- 可选读取根目录 `terrain/` 的 Cesium quantized-mesh 地形瓦片，把坡度、起伏、速度系数和遮蔽作为软约束。
- 输出每个目标由哪些编组负责，也输出每个编组落实到哪些目标。
- 保留平台第三部分需要的 `comparedPlans / preferredPlan / validation / adjustmentSuggestions` 等字段。

## 输入参数

```python
from target_allocation import analyze

result = analyze(
    upstream_threat,
    upstream_grouping,
    objective_preference="balanced",
    validation_mode="strict",
    max_assignments_per_group=2,
    terrain_dir=None,
)
```

参数说明：

- `objective_preference`: `balanced / firepower-first / survivability-first`
- `validation_mode`: `strict / standard`
- `max_assignments_per_group`: 单编组最大分配数，内部限制为 `1-6`
- `terrain_dir`: 可选 Cesium `quantized-mesh-1.0` 地形目录，需包含 `meta.json / layer.json`

## 离线运行

```bash
python -m target_allocation.cli \
  --upstream-threat ../force-grouping/docs/sample_enemy_threat_output.json \
  --upstream-grouping ../force-grouping/result.json \
  --objective-preference balanced \
  --validation-mode strict \
  --max-assignments-per-group 2 \
  --terrain-dir ../terrain \
  --output result.json
```

`--plot-output` 可选；当上游 JSON 含真实经纬度时，传入路径会基于 `candidateTargets[].coordinates` 和 `groups[].coordinates` 生成 SVG 分配图，箭头方向为编组到目标。

部署区只会在 SVG 中显示为半透明背景区域；箭头不会指向部署区。

## 输出重点

顶层字段包含：

- `candidateTargets`
- `deploymentContexts`
- `targetClusters`
- `platforms`
- `groups`
- `comparedPlans`
- `preferredPlan`
- `systemBestPlan`
- `validation`
- `validationFindings`
- `adjustmentSuggestions`

`preferredPlan.assignments[]` 每条包含编组、平台、目标、波次、匹配分、可行性、距离/射程、所需编组数和解释原因。

`candidateTargets` 只包含真实目标实体。`deploymentSectors / 部署区` 是多个目标聚类出的区域，会以 `deploymentContexts / targetClusters` 输出；实体目标若位于或邻近部署区，会带有 `deploymentContextIds / deploymentContextNames / inDeploymentContext` 标注。

第三部分会把第二部分 `groups[].mobility` 按行进速度 km/h 使用。分配不是单纯按最近距离，而是综合距离、行进速度、预计响应时间、目标波次紧迫性、能力适配和风险暴露评分。`distanceKm / reachUtilization` 字段保持不变，assignment reason 会说明速度与预计响应时间。

如果启用 `terrain_dir`，第三部分会按编组点、目标点和中间点采样地形。坡度/起伏会降低有效速度和机动响应，复杂但可遮蔽地形会适度降低暴露风险。`distanceKm / reachUtilization / matchScore / feasibilityScore` 字段名保持不变；assignment 会额外携带 `terrain / terrainPenalty`，reason 会说明地形采样状态。地形缺失、越界或瓦片不可读时按中性地形处理，不会伪造失败。

## 分配图

可在 Python 中直接生成 SVG：

```python
from target_allocation.visualization import render_allocation_map

render_allocation_map(result, "outputs/test-allocation-map.svg")
```

测试会生成：

```text
outputs/test-allocation-map.svg
```

## 测试

```bash
python -m pytest
```

测试使用第一阶段威胁样例和第二阶段编组样例，不依赖网络或大模型 API。测试覆盖部署区非实体保护和地形软约束：部署区不会进入 `candidateTargets / assignments / coverage / backlogTargets`，只有部署区而没有实体目标时不会伪造分配；平坦/陡峭 fake terrain 会改变匹配分、可行性和 reason。
