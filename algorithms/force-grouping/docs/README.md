# force-grouping 测试文档

本目录用于 `force-grouping` 智能编组算法的本地测试和平台接入联调。

## 文件说明

- `sample_force_report.docx`：我方兵力文字报告，供真实大模型抽取测试使用。
- `sample_force_roster.csv`：我方兵力结构化表，供文件读取和人工核对使用。
- `sample_force_extraction.json`：固定的 `force-extraction-v1` 抽取结果，供 pytest 和离线 CLI 使用。
- `sample_enemy_threat_output.json`：第一阶段 `enemy-threat-analysis` 输出样例。

## 离线测试命令

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

## 真实大模型测试命令

去掉 `--mock-extraction` 后会调用配置好的 OpenAI-compatible Chat Completions 接口：

```bash
python -m force_grouping.cli \
  --files docs/sample_force_report.docx docs/sample_force_roster.csv \
  --upstream-threat docs/sample_enemy_threat_output.json \
  --scheme-profile scheme-firepower-priority \
  --rule-library fire-strike-rules \
  --expected-group-count 4 \
  --output result-real-llm.json
```

输出 JSON 应包含 `schemes` 多套候选方案、`comparison` 对比摘要、`preferredSchemeId` 和 `preferredScheme` 最推荐方案。

