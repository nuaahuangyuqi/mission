# Battle Planner 智能编组与智能分配接入说明

> 适用范围：本文说明当前学习交流版智能任务规划模块中 `battle_planner` 的平台接入方式。文中数据、装备、目标和任务均为虚构演示内容。

## 一、接入目标

`battle_planner` 现在是 `作战力量智能编组` 和 `作战目标自动分配` 的唯一智能算法来源：

- 编组阶段运行 `python -m battle_planner.cli`。
- 分配阶段不重复调用 Python 或 LLM，直接复用编组阶段保存的 `battlePlannerResult.task_groups`。
- 旧 `algorithms/force-grouping` 与 `algorithms/target-allocation` Python 智能算法目录已删除。
- 平台算法 id、历史绑定 id 和前端展示名继续兼容：`force-grouping`、`target-allocation`、`force-grouping:force-grouping-local`、`target-allocation:target-allocation-local`。

## 二、编组阶段流程

1. `validatePlanning()` 确认 `enemy-threat-analysis` 已在当前任务中先执行。
2. `executeLocalForceGrouping()` 从 `context.stageOutputs['enemy-threat-analysis']` 读取上游威胁结果。
3. 服务端把威胁结果包装为临时 `planning-artifact-export-v1` JSON，作为 `battle_planner --enemy` 输入。
4. 用户在智能编组阶段上传或勾选的我方资料作为 `--friendly` 输入：
   - `TXT / MD / JSON / DOCX` 直接传入。
   - `PDF / XLS / XLSX / CSV` 先用现有导入预览链路转成文本临时文件。
5. 服务端动态生成 `battle-planner-config.json`，把页面 LLM 参数映射为 `openai / ollama`；自动化测试使用 `mock` provider。
6. `battle_planner` 输出 `grouping_result.json`，平台读取为 `battlePlannerResult`。
7. 平台适配输出 `schemes / preferredScheme / groups / importedFiles / evidenceTrace / constraintSummary`，供结果页和下游使用。

## 三、分配阶段流程

`executeLocalTargetAllocation()` 不再启动 Python 子进程：

1. 读取上游 `force-grouping` 结果。
2. 优先使用 `battlePlannerResult.task_groups` 中的编组-目标处置关系。
3. 结合 `preferredScheme.groups` 中的单位、平台、坐标和角色信息生成 `groups / platforms`。
4. 从上游威胁结果和编组目标名生成 `candidateTargets`。
5. 输出单个 `intelligent-allocation` 方案：
   - `preferredPlan.assignments`
   - `coverage`
   - `groupLoads`
   - `validationFindings`
   - `adjustmentSuggestions`
   - `visualization`

内置 `hungarian / ant-colony / multi-objective` 三种目标分配方法仍保留，默认方法仍为 `multi-objective`。

## 四、关键契约

编组输出必须保留：

- `algorithmModel = "battle-planner-v1"`
- `battlePlannerResult`
- `preferredScheme.groups[].units`
- `preferredScheme.groups[].targetNames / targetIds`
- `constraintSummary`
- `evidenceTrace`

分配输出必须保留：

- `builtinMethodKey = "intelligent-allocation"`
- `planningBasis.source = "battlePlannerResult.task_groups"`
- `candidateTargets`
- `groups`
- `platforms`
- `preferredPlan.assignments`
- `preferredPlan.visualization`
- `validationFindings`

## 五、验证

当前应至少运行：

```bash
node algorithms/run-with-venv.mjs -m pytest algorithms/battle-planner/tests -q
npm test --workspace @mission/server
npm run build
```

已知限制：

- 自动化测试使用 `mock` LLM；真实外部 OpenAI-compatible API 或 Ollama 需在页面或环境变量中配置。
- `battle_planner` 原生不读取 PDF/Excel/CSV，平台通过文本转换兜底。
- 分配阶段遵循编组阶段已形成的目标处置关系，不再重新搜索独立分配解。
