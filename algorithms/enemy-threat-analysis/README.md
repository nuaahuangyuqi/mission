# enemy-threat-analysis

`enemy-threat-analysis` 是一个独立 Python 纯算法包，用于“基于大模型分析算法”模式下的敌情威胁自动分析。

设计原则：

- 大模型只负责从多文件中抽取 `threat-extraction-v1` 结构化 JSON。
- 稳定算法负责威胁分、价值分、优先级、空间威胁场、热力图和平台兼容 `structuredOutput`。
- 输出保留平台需要的 `threatScore / enemyIntentions / fireCoverage / airDefenseSystem / visualization` 等字段。

## 安装

```bash
cd /Users/hyq/Research/projects/602/纯算法/enemy-threat-analysis
python3 -m pip install -r requirements.txt
```

## 配置大模型接口

在 `enemy_threat_analysis/config.py` 中填写：

```python
LLM_API_KEY = "your-api-key"
LLM_BASE_URL = "https://your-openai-compatible-endpoint/v1"
LLM_MODEL = "your-model"
```

也可以使用环境变量：

```bash
export ENEMY_THREAT_LLM_API_KEY="your-api-key"
export ENEMY_THREAT_LLM_BASE_URL="https://your-openai-compatible-endpoint/v1"
export ENEMY_THREAT_LLM_MODEL="your-model"
```

## CLI

```bash
python3 -m enemy_threat_analysis.cli \
  --files examples/sample_enemy_report.txt \
  --analysis-focus comprehensive \
  --heatmap-density medium \
  --impact-bias balanced \
  --output /tmp/enemy-threat-result.json \
  --artifact-dir /tmp/enemy-threat-artifacts
```

参数取值：

- `analysis-focus`: `comprehensive` / `coverage` / `air-defense`
- `heatmap-density`: `low` / `medium` / `high`
- `impact-bias`: `balanced` / `suppression` / `mobility`

中文别名也支持：`综合敌情`、`火力覆盖优先`、`防空体系优先`、`低`、`中`、`高`、`均衡`、`压制优先`、`机动优先`。

如果传入 `--artifact-dir`，CLI 会额外写出：

- `heatmap.png`：威胁热力图图片
- `target-map.png`：目标位置与标注图片
- `combined-map.png`：热力图和目标覆盖范围合成图
- `operational_assessment_*.docx`：二阶段敌方作战企图与部署态势研判报告

二阶段研判默认开启，会在第一阶段算法完成后再次调用大模型生成研判 JSON，再由 Python 生成 DOCX。可选参数：

- `--skip-assessment`：跳过二阶段研判报告
- `--assessment-dir <dir>`：指定 DOCX 报告输出目录；未指定时使用 `--artifact-dir`，再回退到 JSON 输出目录

## Python API

```python
from enemy_threat_analysis import analyze

result = analyze(
    files=["examples/sample_enemy_report.txt"],
    analysis_focus="coverage",
    heatmap_density="low",
    impact_bias="suppression",
    assessment_output_dir="outputs/reports",
)
```

测试或离线集成时，可以直接传入已经抽取好的 `threat-extraction-v1` JSON：

```python
result = analyze(
    files=None,
    analysis_focus="comprehensive",
    heatmap_density="low",
    impact_bias="balanced",
    extraction_json=pre_extracted_json,
    generate_assessment=False,
)
```

如果已经有二阶段研判 JSON，也可以离线生成 DOCX：

```python
result = analyze(
    files=None,
    extraction_json=pre_extracted_json,
    assessment_json=pre_assessment_json,
    assessment_output_dir="outputs/reports",
)
```

## 测试

```bash
python3 -m pytest
```

测试不会调用真实大模型 API，而是使用固定抽取 JSON 验证算法主体。
