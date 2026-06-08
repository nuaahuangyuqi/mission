# force-grouping 智能编组算法

第二阶段独立 Python 算法包，算法 id 为 `force-grouping`，对外方法为 `intelligent-grouping / 智能编组算法`。

## 能力

- 使用大模型从多份我方文件中抽取 `force-extraction-v1` 兵力 JSON。
- 消费第一阶段 `enemy-threat-analysis` 输出。
- 用户先选择编组倾向：
  - `scheme-balanced-intelligent`：均衡协同。
  - `scheme-firepower-priority`：火力优先。
  - `scheme-survivability-priority`：生存优先。
- 在所选倾向下生成多套候选方案：
  - `*-primary`
  - `*-distributed`
  - `*-reserve-supported`
- 输出一个算法最推荐方案：`preferredSchemeId / preferredScheme`。
- 保持平台文档要求的 `schemes / comparison / constraintSummary / resolvedRuleProfile / evidenceTrace / explanation` 字段。
- `preferredScheme.groups[].units[]` 会保留 `location`，便于下游目标分配按真实经纬度计算距离并绘制分配箭头图。
- 本阶段不把第一阶段 `deploymentSectors / 部署区` 当作编组或打击目标；部署区是第三阶段使用的空间上下文，火力分配对象应为部署区内部或邻近的真实目标实体。
- 字段结构保持不变，但 `capabilities.mobility`、`groups[].mobility` 和 `metrics.mobility` 的真实含义已调整为行进速度，按 km/h 理解，仍限制在 `0-100` 范围内。文档没有明示速度时，真实大模型抽取会基于单位类型、装备、角色和世界知识保守推断。
- 编组级 `groups[].mobility` 采用慢速约束原则，表示组内最慢单位的有效行进速度，而不是抽象机动评分或加权平均。

## 配置

全局配置位于：

```text
/Users/hyq/Research/projects/602/纯算法/config.py
```

算法内配置位于：

```text
force_grouping/config.py
```

环境变量优先级最高：

- `FORCE_GROUPING_LLM_BACKEND`
- `FORCE_GROUPING_LLM_API_KEY`
- `FORCE_GROUPING_LLM_BASE_URL`
- `FORCE_GROUPING_LLM_OLLAMA_HOST`
- `FORCE_GROUPING_LLM_MODEL`
- `FORCE_GROUPING_LLM_TIMEOUT`
- `FORCE_GROUPING_LLM_OLLAMA_NUM_CTX` / `OLLAMA_NUM_CTX`

`FORCE_GROUPING_LLM_BACKEND=openai-compatible` 时使用外部 OpenAI-compatible API，需要 API Key、Base URL 和模型名称。
`FORCE_GROUPING_LLM_BACKEND=ollama` 时使用本地 Ollama，默认连接 `http://localhost:11434`（或 `OLLAMA_HOST`），不需要 API Key 或 Base URL。
外部 OpenAI-compatible API 与本地 Ollama 共用同一套抽取/解释提示词；Ollama 分支使用官方 `ollama` Python 包直接调用本地模型，不使用 OpenAI SDK，并通过 `trust_env=False` 避免系统代理干扰 localhost；Ollama 请求会显式发送 `think:false`，关闭支持该参数模型的 thinking 模式。正式抽取默认使用 `num_ctx=262144`，并把本地文件片段上限放开到 200k 总字符 / 100k 单文件字符以适配 256k 上下文模型。

若未配置本算法或全局配置，会尝试复用第一阶段算法已有的大模型配置作为本地联调 fallback。

## 离线运行

```bash
python -m force_grouping.cli \
  --files docs/sample_force_report.docx docs/sample_force_roster.csv \
  --upstream-threat docs/sample_enemy_threat_output.json \
  --mock-extraction docs/sample_force_extraction.json \
  --scheme-profile scheme-balanced-intelligent \
  --rule-library fire-strike-rules \
  --expected-group-count 4 \
  --no-llm-explanation \
  --output result.json
```

## 真实大模型运行

```bash
python -m force_grouping.cli \
  --files docs/sample_force_report.docx docs/sample_force_roster.csv \
  --upstream-threat docs/sample_enemy_threat_output.json \
  --scheme-profile scheme-firepower-priority \
  --rule-library fire-strike-rules \
  --expected-group-count 4 \
  --output result-real-llm.json
```

## 测试

```bash
python -m pytest
```

默认测试使用 mock extraction，不依赖真实网络或大模型 API。
