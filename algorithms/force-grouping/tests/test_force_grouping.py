from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from force_grouping import analyze
from force_grouping.evaluator import build_group_metrics
from force_grouping.force_pool_builder import CATEGORY_DEFAULTS, build_force_pool, normalize_extraction
from force_grouping.llm_extractor import EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


@pytest.fixture()
def extraction_json() -> dict:
    return json.loads((DOCS / "sample_force_extraction.json").read_text(encoding="utf-8"))


@pytest.fixture()
def threat_json() -> dict:
    return json.loads((DOCS / "sample_enemy_threat_output.json").read_text(encoding="utf-8"))


def run_profile(profile: str, extraction_json: dict, threat_json: dict) -> dict:
    return analyze(
        [],
        threat_json,
        scheme_profile_key=profile,
        rule_library_key="fire-strike-rules",
        expected_group_count=4,
        extraction_json=extraction_json,
        use_llm_explanation=False,
    )


def test_all_scheme_profiles_generate_multiple_schemes(extraction_json: dict, threat_json: dict) -> None:
    for profile in (
        "scheme-balanced-intelligent",
        "scheme-firepower-priority",
        "scheme-survivability-priority",
    ):
        result = run_profile(profile, extraction_json, threat_json)
        assert result["ok"] is True
        assert result["builtinMethodKey"] == "intelligent-grouping"
        assert result["appliedOptions"]["schemeProfileKey"] == profile
        assert len(result["schemes"]) == 3
        assert len(result["comparison"]) == len(result["schemes"])
        assert all(scheme["id"].startswith(profile) for scheme in result["schemes"])


def test_preferred_scheme_points_to_one_candidate(extraction_json: dict, threat_json: dict) -> None:
    result = run_profile("scheme-balanced-intelligent", extraction_json, threat_json)
    scheme_ids = {scheme["id"] for scheme in result["schemes"]}
    assert result["preferredSchemeId"] in scheme_ids
    assert result["preferredScheme"]["id"] == result["preferredSchemeId"]
    assert result["systemBestSchemeId"] in scheme_ids
    assert result["explanation"]
    assert result["preferredScheme"]["advantages"]


def test_output_contains_required_top_level_fields(extraction_json: dict, threat_json: dict) -> None:
    result = run_profile("scheme-firepower-priority", extraction_json, threat_json)
    required = {
        "implementationStatus",
        "builtinMethodKey",
        "builtinMethodLabel",
        "ruleLibrary",
        "constraintModel",
        "appliedOptions",
        "inputSummary",
        "selectedSources",
        "importedFiles",
        "evidenceTrace",
        "resolvedRuleProfile",
        "constraintSummary",
        "ruleEvidence",
        "schemes",
        "comparison",
        "preferredSchemeId",
        "preferredScheme",
        "systemBestSchemeId",
        "explanation",
    }
    assert required.issubset(result.keys())


def test_scheme_shape_matches_platform_contract(extraction_json: dict, threat_json: dict) -> None:
    result = run_profile("scheme-survivability-priority", extraction_json, threat_json)
    scheme = result["preferredScheme"]
    for key in (
        "id",
        "methodKey",
        "methodLabel",
        "baseScore",
        "score",
        "metrics",
        "groups",
        "actualGroupCount",
        "emptyGroupCount",
        "structuralPenalty",
        "constraintEvaluation",
        "optimizationMeta",
        "optimizationTrace",
        "advantages",
        "tradeoffs",
    ):
        assert key in scheme
    assert 0 <= scheme["score"] <= 100
    assert 0 <= scheme["metrics"]["constraintSatisfaction"] <= 100
    assert scheme["groups"]
    group = scheme["groups"][0]
    for key in ("id", "name", "role", "unitCount", "units", "firepower", "protection", "reconCoverage", "endurance", "mobility"):
        assert key in group


def test_downstream_units_are_complete(extraction_json: dict, threat_json: dict) -> None:
    result = run_profile("scheme-balanced-intelligent", extraction_json, threat_json)
    units = [unit for group in result["preferredScheme"]["groups"] for unit in group["units"]]
    assert units
    for unit in units:
        assert {"id", "name", "category", "role", "strength", "readiness", "capabilities"}.issubset(unit.keys())
        assert 0 <= unit["capabilities"]["firepower"] <= 100


def test_llm_prompt_defines_mobility_as_march_speed() -> None:
    prompt = EXTRACTION_SYSTEM_PROMPT + EXTRACTION_USER_PROMPT
    assert "capabilities.mobility 的真实含义是行进速度" in prompt
    assert "km/h" in prompt
    assert "世界知识" in prompt
    assert "不要新增 speed、marchSpeed、movementSpeedKph" in prompt


def test_missing_mobility_uses_category_speed_default() -> None:
    extraction = normalize_extraction(
        {
            "schemaVersion": "force-extraction-v1",
            "forceUnits": [
                {
                    "id": "unit-speed-default",
                    "name": "运输速度默认单位",
                    "category": "transport",
                    "role": "mobility",
                    "strength": 20,
                    "capabilities": {"firepower": 20, "protection": 30, "recon": 20, "support": 60},
                }
            ],
        }
    )
    assert extraction.forceUnits[0].capabilities["mobility"] == CATEGORY_DEFAULTS["transport"]["mobility"]


def test_readiness_does_not_scale_mobility_speed() -> None:
    extraction = normalize_extraction(
        {
            "schemaVersion": "force-extraction-v1",
            "forceUnits": [
                {
                    "id": "unit-partial-speed",
                    "name": "部分可用速度单位",
                    "category": "strike",
                    "role": "main_strike",
                    "strength": 20,
                    "capabilities": {
                        "firepower": 80,
                        "protection": 70,
                        "recon": 40,
                        "mobility": 45,
                        "support": 30,
                        "communication": 50,
                        "survivability": 60,
                    },
                    "readiness": {"status": "partial", "readinessScore": 60, "availability": 0.5},
                }
            ],
        }
    )
    pool, _ = build_force_pool(extraction)
    unit = pool[0]
    assert unit.capabilities["mobility"] == 45
    assert unit.capabilities["firepower"] == 40


def test_group_mobility_uses_slowest_unit_speed() -> None:
    extraction = normalize_extraction(
        {
            "schemaVersion": "force-extraction-v1",
            "forceUnits": [
                {
                    "id": "unit-fast",
                    "name": "快速单位",
                    "category": "transport",
                    "role": "mobility",
                    "strength": 30,
                    "capabilities": {"mobility": 70},
                },
                {
                    "id": "unit-slow",
                    "name": "慢速单位",
                    "category": "air-defense",
                    "role": "air_defense",
                    "strength": 30,
                    "capabilities": {"mobility": 28},
                },
            ],
        }
    )
    pool, _ = build_force_pool(extraction)
    metrics = build_group_metrics({"_units": pool})
    assert metrics["mobility"] == 28


def test_missing_upstream_returns_error(extraction_json: dict) -> None:
    result = analyze([], None, extraction_json=extraction_json, use_llm_explanation=False)
    assert result["ok"] is False
    assert result["error"]["code"] == "PLANNING_MISSING_UPSTREAM"


def test_missing_force_data_returns_error(threat_json: dict) -> None:
    result = analyze([], threat_json, extraction_json={"schemaVersion": "force-extraction-v1", "forceUnits": []})
    assert result["ok"] is False
    assert result["error"]["code"] == "PLANNING_MISSING_DATA"


def test_group_count_is_clamped(extraction_json: dict, threat_json: dict) -> None:
    result = analyze(
        [],
        threat_json,
        scheme_profile_key="scheme-balanced-intelligent",
        expected_group_count=99,
        extraction_json=extraction_json,
        use_llm_explanation=False,
    )
    assert result["appliedOptions"]["actualGroupCount"] == 6
    assert result["appliedOptions"]["groupCountNotes"]


def test_cli_can_run_with_docs(tmp_path: Path) -> None:
    output = tmp_path / "result.json"
    command = [
        sys.executable,
        "-m",
        "force_grouping.cli",
        "--files",
        str(DOCS / "sample_force_report.docx"),
        str(DOCS / "sample_force_roster.csv"),
        "--upstream-threat",
        str(DOCS / "sample_enemy_threat_output.json"),
        "--mock-extraction",
        str(DOCS / "sample_force_extraction.json"),
        "--scheme-profile",
        "scheme-balanced-intelligent",
        "--expected-group-count",
        "4",
        "--no-llm-explanation",
        "--output",
        str(output),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    data = json.loads(output.read_text(encoding="utf-8"))
    assert data["ok"] is True
    assert len(data["schemes"]) == 3
    assert data["preferredSchemeId"]
