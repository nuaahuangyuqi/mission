# 智能任务规划纯算法仓库

本仓库存放智能任务规划模块的独立 Python 算法实现，用于和平台运行时对接前的算法开发、样例验证和接口固化。

## Python 虚拟环境

平台后端默认通过 `algorithms/run-with-venv.mjs` 运行本地 Python 算法。首次执行时，启动器会在本目录创建 `algorithms/.venv`，安装根目录 `requirements.txt` 以及各子算法目录中的 `requirements.txt`，随后用 `.venv` 中的 Python 执行实际 CLI 或脚本。当前依赖同步覆盖 `enemy-threat-analysis`、`force-grouping` 和 `target-allocation`。

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
| 3 作战目标自动分配 | `target-allocation` | 已接入平台方法 | 作为 `作战目标自动分配` 的内置方法 `intelligent-allocation / 智能分配算法` 调用，不登记成流程编排里的独立扩展实现；按编组落实到目标，综合速度响应评分，并为同一编组多目标任务生成连续目标链路和可视化图层。 |
| 5 作战方法自动规划 | `method-planning` | 待办 | 新增 `intelligent-planning / 智能路径规划算法`，用 A*、威胁代价地图和 DEM 地形代价地图把链路化分配结果转成连续分腿路线、阶段、关键动作和可视化。 |

## 平台接入说明

- `target-allocation` 来源于 `target_allocation.zip`，已解入平台仓库 `algorithms/target-allocation/`；接入不修改纯算法仓库本体。
- 后端在用户选择 `target-allocation.builtinMethodKey = "intelligent-allocation"` 时调用 `python -m target_allocation.cli`，输入为前序 `enemy-threat-analysis` 和 `force-grouping` 的结构化结果临时 JSON。
- Python 输出会被补齐为平台现有契约字段：`candidateTargets / platforms / groups / comparedPlans / preferredPlan / systemBestPlan / validationFindings / adjustmentSuggestions`，并新增兼容字段 `visualization` 用于三维态势展示。

