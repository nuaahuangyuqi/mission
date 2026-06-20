# 智能任务规划纯算法仓库

本目录存放智能任务规划模块的本地 Python 算法实现，用于和平台运行时对接前的算法开发、样例验证和接口固化。

## Python 虚拟环境

平台后端默认通过 `algorithms/run-with-venv.mjs` 运行本地 Python 算法。首次执行时，启动器会在本目录创建 `algorithms/.venv`，安装根目录 `requirements.txt` 以及各子算法目录中的 `requirements.txt`，随后用 `.venv` 中的 Python 执行实际 CLI 或脚本。

当前依赖同步覆盖：

- `algorithms/requirements.txt`
- `algorithms/enemy-threat-analysis/requirements.txt`
- `algorithms/battle-planner/requirements.txt`

日常使用不需要手动激活虚拟环境；如果要指定创建 venv 的基础 Python，可设置：

```bash
PLANNING_PYTHON_BOOTSTRAP_BIN=python3.11 npm run dev:server
```

如果确实要绕过自动 venv 启动器，可设置 `PLANNING_PYTHON_USE_VENV=0`，此时 `PLANNING_PYTHON_BIN` 会作为直接执行命令使用。

## 算法状态

| 阶段 | 目录 | 状态 | 说明 |
|---|---|---|---|
| 1 敌情威胁自动分析 | `enemy-threat-analysis` | 已有实现 | 生成威胁评分、火力/防空/侦察/反机降节点等下游输入。 |
| 2 作战力量智能编组 | `battle-planner` | 已接入平台实现 | `force-grouping-local / 智能编组算法` 调用 `python -m battle_planner.cli`，上游威胁由服务端自动写入临时 JSON，用户只在智能编组阶段传入我方资料文档或资源库数据。 |
| 3 作战目标自动分配 | `battle-planner` | 已接入平台实现 | `target-allocation-local / 智能分配算法` 不重复调用 Python 或 LLM，直接复用编组阶段保留的 `battlePlannerResult.task_groups` 适配为目标分配方案。 |
| 5 作战方法自动规划 | `method-planning` | 待办 | 后续可基于链路化目标分配结果生成连续分腿路线、阶段、关键动作和可视化。 |

## 平台接入说明

- 旧 `algorithms/force-grouping` 与 `algorithms/target-allocation` Python 智能算法目录已删除；两个平台算法 id 和历史 variant id 继续保留，但都指向 `algorithms/battle-planner`。
- `force-grouping:builtin` 作为兼容入口桥接到 `battle_planner`，默认使用 mock LLM 以避免内置兼容路径强制依赖外部模型配置。
- `battle_planner` 原生支持 `txt / md / json / docx` 友方资料；平台会把 `pdf / xls / xlsx / csv` 上传和资源库预览转换成文本临时文件再传入。
- 编组输出会被补齐为平台现有契约字段：`schemes / preferredScheme / groups / importedFiles / evidenceTrace / constraintSummary`，并保留原始 `battlePlannerResult`。装载字段会同时输出编组级 `weaponSummary / personnelSummary` 和单位级 `unit.weaponLoadout / unit.personnelLoadout`。
- 智能分配输出保持平台字段：`candidateTargets / platforms / groups / comparedPlans / preferredPlan / systemBestPlan / validationFindings / adjustmentSuggestions / visualization`。
- 平台适配层会为 Battle Planner 编组补充 `firepowerBreakdown`：`weaponEquipmentPower` 和 `group.firepower` 只由实际武器装载折算；运输直升机人员配置保留为 `transportPersonnelPower/personnelDeliveryScore`，但不再进入火力值。火力打击类任务没有武器装载时会在智能分配阶段被合理性校核拦截。

## 验证

```bash
node algorithms/run-with-venv.mjs -m pytest algorithms/battle-planner/tests -q
npm test --workspace @mission/server
```
