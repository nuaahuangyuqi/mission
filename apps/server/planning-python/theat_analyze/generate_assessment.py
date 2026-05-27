"""
generate_assessment.py — 第二阶段敌情研判入口。

Node 后端在第一阶段热力图和目标信息入库后异步调用本脚本。
输入是第一阶段结果 JSON，输出为包含作战企图、部署态势和 DOCX 路径的 JSON。
"""

import json
import logging
import sys
import signal
import os
from pathlib import Path

from assessment_report import generate_operational_assessment_docx
from schemas import SituationMap

LLM_MODEL = os.getenv("TV20_STAGE2_MODEL") or os.getenv("THREAT_ASSESSMENT_LLM_MODEL") or "qwen-plus"
LLM_API_KEY = os.getenv("TV20_OPENAI_API_KEY") or os.getenv("THREAT_ASSESSMENT_OPENAI_API_KEY") or os.getenv("THREAT_ANALYSIS_OPENAI_API_KEY") or ""
LLM_BASE_URL = os.getenv("TV20_OPENAI_BASE_URL") or os.getenv("THREAT_ASSESSMENT_OPENAI_BASE_URL") or os.getenv("THREAT_ANALYSIS_OPENAI_BASE_URL") or ""

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stderr,
)
logger = logging.getLogger("generate_assessment")


def build_situation(payload: dict) -> SituationMap:
    return SituationMap.model_validate({
        "enemy_force_type": payload.get("enemy_force_type") or "未知",
        "enemy_force_type_confidence": payload.get("enemy_force_type_confidence") or 0.0,
        "enemy_force_type_basis": payload.get("enemy_force_type_basis") or "",
        "targets": payload.get("targets") or [],
    })


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "未提供第二阶段输入 JSON 路径"}, ensure_ascii=False))
        sys.exit(1)

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(json.dumps({"error": f"输入文件不存在: {input_path}"}, ensure_ascii=False))
        sys.exit(1)

    with input_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    try:
        situation = build_situation(payload)
        logger.info("开始第二阶段研判: targets=%d coverage=%d", len(payload.get("targets") or []), len(payload.get("fire_coverage_areas") or []))
        result = generate_operational_assessment_docx(
            doc_paths=payload.get("doc_paths") or [],
            situation=situation,
            targets_data=payload.get("targets") or [],
            fire_coverage_areas=payload.get("fire_coverage_areas") or [],
            output_dir=str(Path(__file__).resolve().parent / "generated_reports"),
            model=LLM_MODEL,
            api_key=LLM_API_KEY,
            base_url=LLM_BASE_URL,
        )
        assessment = result.get("assessment") or {}
        print(json.dumps({
            "operational_intent": assessment.get("operational_intent", ""),
            "deployment_posture": assessment.get("deployment_posture", ""),
            "assessment": assessment,
            "assessment_docx_path": result.get("docx_path", ""),
        }, ensure_ascii=False))
    except Exception as exc:
        logger.exception("第二阶段研判失败")
        print(json.dumps({"error": f"第二阶段研判失败: {exc}"}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
