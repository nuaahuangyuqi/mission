"""Second-stage LLM assessment and DOCX report orchestration."""

from __future__ import annotations

import base64
import json
import tempfile
from pathlib import Path
from typing import Any, Sequence

from .config import LLMConfig, resolve_llm_config
from .docx_report import generate_operational_assessment_docx, validate_docx_structure
from .file_loader import LoadedFile
from .llm_extractor import _chat_completion, _extract_json_text


ASSESSMENT_SYSTEM_PROMPT = """你是一名态势研判员。基于第一阶段结构化算法结果，生成敌方作战企图与部署态势研判。

硬性规则：
1. 只输出合法 JSON 对象，不要 Markdown、代码块或解释文字。
2. 不要修改第一阶段算法分数，不要提出我方具体作战方案。
3. 不确定时使用“可能/倾向于”，并降低 confidence。

必须输出结构：
{
  "version": 1,
  "enemy_force_type": "未知",
  "enemy_force_type_confidence": 0.0,
  "operational_intent": "120-260字，概括敌方主要企图、方向、时机和目的",
  "deployment_posture": "120-260字，概括部署态势、防空、侦察、反机降和火力覆盖",
  "threat_summary": "100-220字，基于 threatScore、targetAssessments 和覆盖区的摘要",
  "key_evidence": ["证据1，60字以内", "证据2，60字以内", "证据3，60字以内"],
  "confidence": 0.0
}"""


def generate_assessment_report(
    *,
    structured_output: dict[str, Any],
    loaded_files: Sequence[LoadedFile],
    llm_config: dict[str, Any] | LLMConfig | None = None,
    assessment_json: dict[str, Any] | None = None,
    output_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Generate second-stage assessment JSON and DOCX report.

    The caller should catch failures only if it wants stricter behavior. This
    function returns a failure status instead of raising for normal assessment
    issues so the first-stage algorithm result can remain usable.
    """
    try:
        assessment = normalize_assessment_json(
            assessment_json
            if assessment_json is not None
            else call_assessment_llm(structured_output, loaded_files, llm_config)
        )
        if output_dir is None:
            with tempfile.TemporaryDirectory(prefix="enemy-threat-assessment-") as temp_dir:
                docx_path = generate_operational_assessment_docx(
                    assessment=assessment,
                    structured_output=structured_output,
                    output_dir=temp_dir,
                )
                docx_bytes = Path(docx_path).read_bytes()
                qa = validate_docx_structure(docx_path)
                return _build_success_payload(assessment, docx_bytes, Path(docx_path).name, None, qa)

        docx_path = generate_operational_assessment_docx(
            assessment=assessment,
            structured_output=structured_output,
            output_dir=output_dir,
        )
        docx_bytes = Path(docx_path).read_bytes()
        qa = validate_docx_structure(docx_path)
        return _build_success_payload(assessment, docx_bytes, Path(docx_path).name, str(docx_path), qa)
    except Exception as exc:
        return {
            "assessmentReport": {
                "status": "failed",
                "error": str(exc),
            },
            "assessmentDocxBase64": "",
            "assessmentDocxFileName": "",
        }


def call_assessment_llm(
    structured_output: dict[str, Any],
    loaded_files: Sequence[LoadedFile],
    llm_config: dict[str, Any] | LLMConfig | None = None,
) -> dict[str, Any]:
    config = llm_config if isinstance(llm_config, LLMConfig) else resolve_llm_config(llm_config)
    prompt = json.dumps(build_assessment_payload(structured_output, loaded_files), ensure_ascii=False)
    content = _chat_completion(config, ASSESSMENT_SYSTEM_PROMPT, prompt)
    return json.loads(_extract_json_text(content))


def build_assessment_payload(
    structured_output: dict[str, Any],
    loaded_files: Sequence[LoadedFile],
) -> dict[str, Any]:
    return {
        "threatScore": structured_output.get("threatScore"),
        "threatLevel": structured_output.get("threatLevel"),
        "enemyIntentions": structured_output.get("enemyIntentions") or [],
        "targetAssessments": [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "category": item.get("category"),
                "threatScore": item.get("threatScore"),
                "valueScore": item.get("valueScore"),
                "priorityScore": item.get("priorityScore"),
                "coordinates": item.get("location", {}).get("coordinates"),
                "dominantFactors": item.get("dominantFactors"),
            }
            for item in (structured_output.get("targetAssessments") or [])[:30]
        ],
        "fireCoverage": structured_output.get("fireCoverage") or [],
        "airDefenseSystem": structured_output.get("airDefenseSystem") or [],
        "reconEarlyWarning": structured_output.get("reconEarlyWarning") or [],
        "antiAirborneFacilities": structured_output.get("antiAirborneFacilities") or [],
        "scoreBreakdown": structured_output.get("scoreBreakdown") or {},
        "heatmapStatistics": (structured_output.get("heatmap") or {}).get("statistics") or {},
        "sourceFiles": [
            {
                "fileId": item.file_id,
                "fileName": item.file_name,
                "fileType": item.file_type,
                "excerpt": item.text[:1800],
            }
            for item in loaded_files[:6]
        ],
    }


def normalize_assessment_json(payload: dict[str, Any]) -> dict[str, Any]:
    data = dict(payload or {})
    intent = _as_text(data.get("operational_intent") or data.get("intent") or data.get("enemy_intent"))
    posture = _as_text(data.get("deployment_posture") or data.get("posture"))
    summary = _as_text(data.get("threat_summary") or data.get("summary"))
    return {
        "version": int(data.get("version") or 1),
        "enemy_force_type": _as_text(data.get("enemy_force_type"), "未知"),
        "enemy_force_type_confidence": _as_confidence(data.get("enemy_force_type_confidence"), 0.0),
        "operational_intent": intent or "未形成明确敌方作战企图，需结合原始材料继续复核。",
        "deployment_posture": posture or "未形成完整部署态势研判，需结合目标空间分布继续复核。",
        "threat_summary": summary or "已基于第一阶段结构化目标、威胁分和覆盖区生成态势摘要。",
        "key_evidence": [
            str(item).strip()
            for item in (data.get("key_evidence") or data.get("evidence") or [])
            if str(item).strip()
        ][:8],
        "confidence": _as_confidence(data.get("confidence"), 0.55),
    }


def _build_success_payload(
    assessment: dict[str, Any],
    docx_bytes: bytes,
    file_name: str,
    docx_path: str | None,
    qa: dict[str, Any],
) -> dict[str, Any]:
    report = {
        "status": "completed",
        "assessment": assessment,
        "qa": qa,
    }
    if docx_path:
        report["docxPath"] = docx_path
    payload = {
        "assessmentReport": report,
        "assessmentDocxBase64": base64.b64encode(docx_bytes).decode("ascii"),
        "assessmentDocxFileName": file_name,
    }
    if docx_path:
        payload["assessmentDocxPath"] = docx_path
    return payload


def _as_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip() or default
    if isinstance(value, list):
        return "；".join(str(item).strip() for item in value if str(item).strip()) or default
    if isinstance(value, dict):
        return " ".join(str(item).strip() for item in value.values() if str(item).strip()) or default
    return str(value).strip() or default


def _as_confidence(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if 1.0 < number <= 100.0:
        number = number / 100.0
    return max(0.0, min(number, 1.0))
