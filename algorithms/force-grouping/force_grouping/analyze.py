"""Public algorithm entrypoint."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import (
    DEFAULT_CONSTRAINT_MODEL_KEY,
    DEFAULT_EXPECTED_GROUP_COUNT,
    DEFAULT_RULE_LIBRARY_KEY,
    DEFAULT_SCHEME_PROFILE_KEY,
    GENERATE_LLM_EXPLANATION,
)
from .errors import error_response
from .file_loader import load_files
from .force_pool_builder import build_force_pool, normalize_extraction
from .grouping_solver import generate_schemes
from .llm_extractor import extract_force_json_with_llm
from .output_adapter import build_structured_output, choose_preferred_scheme
from .rule_profile import resolve_rule_profile, resolve_scheme_profile
from .threat_adapter import adapt_threat_context


def _clamp_expected_group_count(expected_group_count: int, force_unit_count: int) -> tuple[int, list[str]]:
    notes: list[str] = []
    requested = int(expected_group_count or DEFAULT_EXPECTED_GROUP_COUNT)
    clamped = max(3, min(6, requested))
    if clamped != requested:
        notes.append(f"期望群组数 {requested} 已按平台约束修正为 {clamped}。")
    actual = min(clamped, force_unit_count)
    if actual < clamped:
        notes.append(f"可用兵力数量为 {force_unit_count}，实际群组数修正为 {actual}。")
    return max(1, actual), notes


def analyze(
    files: list[str | Path] | None,
    upstream_threat: dict[str, Any] | None,
    scheme_profile_key: str = DEFAULT_SCHEME_PROFILE_KEY,
    rule_library_key: str = DEFAULT_RULE_LIBRARY_KEY,
    expected_group_count: int = DEFAULT_EXPECTED_GROUP_COUNT,
    llm_config: dict[str, Any] | None = None,
    extraction_json: dict[str, Any] | None = None,
    comparison_focus: str | None = None,
    use_llm_explanation: bool = GENERATE_LLM_EXPLANATION,
) -> dict[str, Any]:
    threat = adapt_threat_context(upstream_threat)
    if threat is None:
        return error_response(
            "PLANNING_MISSING_UPSTREAM",
            "missing_upstream",
            "force-grouping requires enemy-threat-analysis output.",
        )

    file_list = list(files or [])
    file_bundles, imported_files = load_files(file_list) if file_list else ([], [])
    if extraction_json is None:
        if not file_bundles:
            return error_response(
                "PLANNING_MISSING_DATA",
                "missing_force_data",
                "缺少可解析的我方兵力文件，无法执行智能编组。",
                {"importedFiles": imported_files},
            )
        try:
            extraction_json = extract_force_json_with_llm(file_bundles, llm_config=llm_config)
        except Exception as exc:  # noqa: BLE001 - caller needs an explainable algorithm error
            return error_response(
                "FORCE_EXTRACTION_FAILED",
                "llm_extraction_failed",
                "大模型抽取我方兵力信息失败。",
                {"error": str(exc), "importedFiles": imported_files},
            )

    extraction = normalize_extraction(extraction_json)
    force_pool, evidence_trace = build_force_pool(extraction)
    if not force_pool:
        return error_response(
            "PLANNING_MISSING_DATA",
            "missing_force_data",
            "未抽取到可用于编组的我方兵力单元。",
            {"warnings": extraction.warnings},
        )

    scheme_profile = resolve_scheme_profile(scheme_profile_key, comparison_focus)
    actual_group_count, group_notes = _clamp_expected_group_count(expected_group_count, len(force_pool))
    rule_profile = resolve_rule_profile(rule_library_key, scheme_profile, threat, actual_group_count)
    schemes = generate_schemes(force_pool, rule_profile, scheme_profile, threat)
    preferred = choose_preferred_scheme(schemes, scheme_profile)
    applied_options = {
        "ruleLibraryKey": rule_profile["key"],
        "constraintModelKey": DEFAULT_CONSTRAINT_MODEL_KEY,
        "comparisonFocus": scheme_profile.comparisonFocus,
        "schemeProfileKey": scheme_profile.key,
        "schemeProfileLabel": scheme_profile.label,
        "expectedGroupCount": expected_group_count,
        "actualGroupCount": actual_group_count,
        "groupCountNotes": group_notes,
    }
    result = build_structured_output(
        extraction=extraction,
        force_pool=force_pool,
        imported_files=imported_files,
        evidence_trace=evidence_trace,
        rule_profile=rule_profile,
        scheme_profile=scheme_profile,
        schemes=schemes,
        preferred=preferred,
        threat=threat,
        applied_options=applied_options,
        llm_config=llm_config,
        use_llm_explanation=use_llm_explanation,
    )
    if group_notes:
        result["explanation"].extend(group_notes)
    return result

