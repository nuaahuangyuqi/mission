# Battle Planner 智能编组与智能分配算法完整报告

> 本报告面向当前学习交流版系统中的 `作战力量智能编组` 与 `作战目标自动分配 / 智能分配算法`。所有单位、目标、装备和任务语义均为虚构演示数据，不对应真实组织、装备、地点或行动。

## 1. 报告范围

当前智能任务规划链路中，`algorithms/battle-planner` 是两个智能算法的共同来源：

- `作战力量智能编组 / 智能编组算法`：调用 Python 包 `battle_planner`，根据上游敌情目标和我方资料生成任务编组。
- `作战目标自动分配 / 智能分配算法`：不再单独调用旧 `target_allocation` Python 包，而是由服务端读取编组阶段保留的 `battlePlannerResult.task_groups`，适配为平台目标分配方案、校核结果和态势图层。

本轮修复重点是武器装载显示和火力口径：

- 火力值只由实际装载武器折算。
- 未装载武器时火力为 `0`。
- 人员和运输平台仍可贡献机动投送等其他指标，但不进入火力值。
- 火力打击类任务必须装载武器；否则进入错误校核，不生成有效火力打击分配。
- 接口现在同时返回编组级摘要和单位级装载字段，确保前端单位表能显示武器装载。

## 2. 输入数据

### 2.1 敌情输入

编组阶段不再要求用户上传敌情 JSON。服务端会把上一步 `enemy-threat-analysis` 的结构化输出包装为 `planning-artifact-export-v1` 临时 JSON，再传给 Python CLI。

核心字段包括：

- `targetAssessments`：目标清单、目标类型、威胁值、价值值、位置。
- `fireCoverage / airDefenseSystem / reconEarlyWarning`：可用于目标类型和态势展示的威胁节点。
- `sourceTarget`：保留原始目标类型、装备、坐标等证据。

### 2.2 我方资料输入

智能编组阶段从资源库勾选数据和本地上传文件读取我方资料。`battle_planner` 原生支持：

- `txt`
- `md`
- `json`
- `docx`

平台会把 `pdf / xls / xlsx / csv` 先通过导入预览链路转成临时文本文件，再传给算法。

我方资料会被归一化为：

- `helicopters`：直升机型号、角色、数量、武器挂载能力、人员容量、能力标签。
- `weapons`：武器名称、可用数量、效果标签。
- `personnel`：人员类型、可用数量。
- `grouping_rules`：预备队比例、护航比例、编组规模等规则。
- `constraints`：最大战损率、默认机降人员数、预备队释放阈值等约束。

## 3. 算法流程

### 3.1 目标处置规则生成

`TaskRequirementGenerator` 会结合敌方目标和 LLM/Mock 生成的处置规则，形成标准化任务需求：

- 防空目标倾向生成 `防空压制`。
- 通信节点可生成 `火力打击` 或高价值时转为 `机降突击`。
- 侦察/预警目标可拆分为 `侦察确认` 和后续打击。
- 后勤、工程、障碍等目标按破袭、压制或机降夺控规则处理。

### 3.2 任务需求生成

每个 `TaskRequirement` 包含：

- `required_helicopters`
- `required_weapons`
- `required_personnel`
- `expected_effect`
- `estimated_loss_rate`
- `priority`
- `support_relations`

火力类任务包括：

- `防空压制`
- `火力打击`
- `火力压制`
- `通信压制`
- `破袭打击`

这些任务会生成武器需求，并在后续分配时强制校验实际武器装载。

### 3.3 资源分配

`ResourcePool.allocate()` 按任务需求分配平台、武器和人员：

1. 先按角色分配直升机平台。
2. 根据实际分配到的武装/护航平台比例缩放武器需求。
3. 再按库存分配武器。
4. 按运输平台容量约束人员分配。
5. 对缺平台、缺武器、缺人员、超战损等情况写入 `issues`。

本轮修复后，火力类任务如果没有形成任何实际武器装载，会新增错误：

```text
<任务类型> 未形成实际武器装载，不能执行火力打击
```

### 3.4 编组输出

每个 `TaskGroup` 输出：

- `platforms`：平台分配。
- `weapons`：该编组实际获得的武器。
- `personnel`：该编组实际获得的人员。
- `firepower_score`：实际武器装载折算后的火力值。
- `firepower_breakdown`：火力构成说明。
- `has_loaded_weapon`：是否实际装载武器。
- `has_loaded_personnel`：是否实际装载人员。
- `strike_weapon_requirement_met`：火力打击武器约束是否满足。
- `assignment_eligible_for_strike`：是否允许进入火力打击分配。

## 4. 火力与装载规则

### 4.1 火力值规则

当前火力值公式为：

```text
group.firepower = weaponEquipmentPower
weaponEquipmentPower = min(100, weaponQuantity * 0.8)
```

当 `weaponQuantity = 0` 时：

```text
weaponEquipmentPower = 0
group.firepower = 0
hasLoadedWeapon = false
```

### 4.2 人员和运输规则

人员和运输平台不再贡献火力值，但仍输出人员投送分：

```text
personnelDeliveryScore = personnelCount * 0.35 + transportHelicopterCount * 6
```

接口兼容保留：

- `transportPersonnelPower`
- `personnelDeliveryScore`

它们用于展示和后续机动投送类解释，不参与 `group.firepower`。

### 4.3 单位级装载字段

为修复“武器装载不显示”，服务端适配层现在将编组装载下沉到单位行：

- `group.weaponSummary`
- `group.personnelSummary`
- `unit.weaponLoadout`
- `unit.personnelLoadout`
- `unit.cargoLoadout`

分配策略：

- 武器优先挂到 `armed / escort` 平台行。
- 人员优先挂到 `transport` 平台行。
- 如没有匹配平台，则回退到第一个有效平台行。

前端单位表读取 `unit.weaponLoadout`，因此接口必须返回单位级装载；只返回 `group.weapons` 不足以显示单位表中的武器装载。

## 5. 智能目标分配适配

`target-allocation-local / 智能分配算法` 当前读取上游编组结果，不重复调用 Python。

适配流程：

1. 读取 `force-grouping.preferredScheme.groups`。
2. 读取上游敌情目标，构建目标索引。
3. 按编组承担目标生成单波分配。
4. 计算距离、匹配分、可行性分。
5. 输出覆盖摘要、编组负荷、平台池、态势图层。

本轮修复后，若火力类编组满足以下条件：

```text
isFireStrikeTask(group.taskType) && !group.assignmentEligibleForStrike
```

则不生成有效 assignment，而是输出校核失败：

```text
火力打击缺少武器装载
```

对应目标会保留为未覆盖或待补充状态，避免“无武器却分配火力打击”的错误。

## 6. 服务端接口字段

### 6.1 编组结果关键字段

```json
{
  "firepower": 69.6,
  "firepowerBreakdown": {
    "weaponEquipmentPower": 69.6,
    "weaponQuantity": 87,
    "transportPersonnelPower": 0,
    "personnelDeliveryScore": 0,
    "combinedFirepower": 69.6,
    "hasLoadedWeapon": true,
    "hasLoadedPersonnel": false
  },
  "weaponSummary": [
    {
      "weaponName": "空地导弹",
      "quantity": 2,
      "targetName": "目标名称"
    }
  ],
  "units": [
    {
      "name": "二型武装直升机",
      "role": "armed",
      "weaponLoadout": [
        {
          "weaponName": "空地导弹",
          "quantity": 2,
          "targetName": "目标名称"
        }
      ]
    }
  ]
}
```

### 6.2 目标分配关键字段

```json
{
  "groupFirepower": 69.6,
  "groupFirepowerBreakdown": {
    "weaponEquipmentPower": 69.6,
    "combinedFirepower": 69.6,
    "hasLoadedWeapon": true
  },
  "platforms": [
    {
      "name": "二型武装直升机",
      "weaponLoadout": [
        {
          "weaponName": "空地导弹",
          "quantity": 2
        }
      ]
    }
  ]
}
```

## 7. 异常与降级

### 7.1 无武器库存

如果我方资料没有识别到武器库存：

- 编组仍可形成平台和人员配置。
- 火力值为 `0`。
- 机动、人员投送等非火力指标仍可显示。
- 火力类任务写入错误 issue。
- 智能目标分配不生成有效火力打击 assignment。

### 7.2 有平台但无武器装载

如果有武装直升机但没有实际分配到武器：

- 不因平台数量产生火力。
- `hasLoadedWeapon = false`。
- `group.firepower = 0`。
- 火力打击类任务被拦截。

### 7.3 有人员但无武器

如果有运输直升机和人员：

- `personnelDeliveryScore` 可以大于 0。
- `group.firepower` 仍为 0。
- 该编组可用于机降、投送、保障类解释，但不能作为火力打击分配依据。

## 8. 测试验证

已覆盖的自动化测试：

- Python 算法测试：
  - `test_fire_strike_without_loaded_weapons_has_zero_firepower`
  - 验证火力类任务无武器时 `firepower_score = 0`，并产生错误 issue。
- 服务端接口测试：
  - 验证有武器编组输出 `weaponSummary`。
  - 验证单位行输出 `unit.weaponLoadout`。
  - 验证目标分配平台输出 `platform.weaponLoadout`。
  - 验证无武器火力类编组不生成有效火力打击分配，并输出校核失败。

当前通过命令：

```bash
node algorithms/run-with-venv.mjs -m pytest algorithms/battle-planner/tests -q
npm test --workspace @mission/server
```

## 9. 当前结论

本轮修复后，武器装载显示问题归因于接口适配层字段缺失，而不是 Python 算法完全未分配武器：

- 算法输出中已有 `group.weapons`。
- 前端单位表读取的是 `unit.weaponLoadout`。
- 服务端此前没有把 `group.weapons` 下沉到 `unit.weaponLoadout`。
- 修复后，接口同时返回编组摘要和单位级装载字段。

当前算法与接口满足以下行为：

- 有武器装载：编组摘要和单位表均显示武器装载。
- 无武器装载：火力为 0，单位表显示未挂载。
- 有人员/运输但无武器：人员投送能力仍可显示，但不增加火力。
- 火力打击缺武器：目标分配校核失败，不生成有效火力打击 assignment。

## 10. 后续建议

- 若需要更精细的单机挂载，可将当前“平台类型行装载”扩展为“按单架平台展开装载”。
- 若需要区分弹药类型效能，可为 `WeaponStock.effects` 增加毁伤系数、压制系数、目标类型适配系数。
- 若需要展示物资装载，可在 Python 友方结构化 schema 中扩展 `cargo` 资源，并按运输平台容量生成 `cargoLoadout`。
- 若接入真实外部模型，应继续保留 mock 测试作为基线，防止 LLM 输出漂移导致接口字段缺失。
