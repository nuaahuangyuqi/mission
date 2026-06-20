# battle-planner 智能编组与智能分配算法

`battle_planner` 是当前智能任务规划中 `作战力量智能编组` 与 `作战目标自动分配` 的唯一 Python 智能算法来源。

平台接入方式：

- `force-grouping / 智能编组算法` 调用 `python -m battle_planner.cli`。
- 输入敌情来自上一阶段 `enemy-threat-analysis` 的结构化结果，由服务端写成临时 JSON，不再要求用户上传敌情 JSON。
- 输入我方资料仍来自智能编组阶段勾选的资源库数据和上传文件。
- `battle_planner` 原生读取 `txt / md / json / docx`；平台会把 `pdf / xls / xlsx / csv` 先转成文本临时文件再传入。
- `target-allocation / 智能分配算法` 不重复调用大模型，直接读取编组阶段保留的 `battlePlannerResult.task_groups` 并适配为平台目标分配 contract。
- 火力值只由实际武器装载折算；没有装载武器时火力为 0。人员和运输平台仍可贡献机动投送等其他指标，但火力打击类任务必须装载武器，否则会输出错误并在目标分配适配阶段被拦截。
- 服务端适配会把编组级武器/人员下沉为 `group.weaponSummary / group.personnelSummary` 和 `unit.weaponLoadout / unit.personnelLoadout`，用于结果页单位表显示实际装载。

CLI 示例：

```bash
python -m battle_planner.cli \
  --config config.json \
  --enemy upstream-threat.json \
  --friendly friendly.txt \
  --output-dir outputs \
  --print-json
```

测试：

```bash
node ../run-with-venv.mjs -m pytest tests -q
```
