from __future__ import annotations

import json
import importlib
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest

from target_allocation import analyze
from target_allocation.adapters import build_group_profiles
from target_allocation.config import resolve_objective_preference, resolve_validation_profile
from target_allocation.scoring import score_candidate
from target_allocation.visualization import render_allocation_map


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
THREAT_SAMPLE = REPO / "force-grouping" / "docs" / "sample_enemy_threat_output.json"
GROUPING_SAMPLE = REPO / "force-grouping" / "result.json"


@pytest.fixture()
def threat_json() -> dict:
    return json.loads(THREAT_SAMPLE.read_text(encoding="utf-8"))


@pytest.fixture()
def grouping_json() -> dict:
    return json.loads(GROUPING_SAMPLE.read_text(encoding="utf-8"))


def run_default(threat_json: dict, grouping_json: dict, **kwargs) -> dict:
    return analyze(threat_json, grouping_json, **kwargs)


def with_real_positions(threat_json: dict, grouping_json: dict) -> tuple[dict, dict]:
    threat = deepcopy(threat_json)
    grouping = deepcopy(grouping_json)
    target_positions = {
        "fireCoverage": [[118.105, 32.042, 0]],
        "airDefenseSystem": [[118.228, 31.968, 0]],
        "reconEarlyWarning": [[118.036, 31.906, 0]],
        "antiAirborneFacilities": [[118.308, 32.082, 0]],
        "deploymentSectors": [[118.176, 32.126, 0]],
    }
    for key, coords in target_positions.items():
        for item, coordinate in zip(threat.get(key) or [], coords):
            item["center"] = coordinate
    threat["deploymentSectors"] = [
        {
            "id": "sector-test-1",
            "name": "主要部署区",
            "center": [118.176, 32.026, 0],
            "polygon": [
                [117.99, 31.88, 0],
                [118.36, 31.88, 0],
                [118.36, 32.16, 0],
                [117.99, 32.16, 0],
                [117.99, 31.88, 0],
            ],
            "unitCount": 4,
            "units": ["fire-1", "ad-1", "recon-1", "anti-1"],
            "posture": "由多个真实目标聚类形成的主要部署区",
        }
    ]
    group_positions = [
        [117.682, 31.808, 0],
        [117.744, 31.936, 0],
        [117.818, 31.742, 0],
        [117.902, 32.012, 0],
        [117.636, 31.922, 0],
        [117.846, 31.854, 0],
    ]
    groups = grouping.get("preferredScheme", {}).get("groups") or []
    for group, coordinate in zip(groups, group_positions):
        group["coordinates"] = coordinate
    return threat, grouping


def test_output_contains_required_top_level_fields(threat_json: dict, grouping_json: dict) -> None:
    result = run_default(threat_json, grouping_json)
    required = {
        "ok",
        "implementationStatus",
        "builtinMethodKey",
        "builtinMethodLabel",
        "appliedOptions",
        "validationProfile",
        "candidateTargets",
        "deploymentContexts",
        "targetClusters",
        "platforms",
        "groups",
        "comparedPlans",
        "preferredPlanMethodKey",
        "preferredPlan",
        "systemBestPlanMethodKey",
        "systemBestPlan",
        "validationSummary",
        "validation",
        "validationFindings",
        "adjustmentSuggestions",
    }
    assert result["ok"] is True
    assert result["builtinMethodKey"] == "intelligent-allocation"
    assert result["builtinMethodLabel"] == "智能分配算法"
    assert required.issubset(result.keys())
    assert len(result["comparedPlans"]) == 1


def test_deployment_sectors_are_context_not_assignable_targets(threat_json: dict, grouping_json: dict) -> None:
    threat, grouping = with_real_positions(threat_json, grouping_json)
    result = run_default(threat, grouping)
    assert result["deploymentContexts"]
    assert result["targetClusters"] == result["deploymentContexts"]
    assert all(target["type"] != "deployment-sector" for target in result["candidateTargets"])
    assert all(item["targetType"] != "deployment-sector" for item in result["preferredPlan"]["assignments"])
    assert all(item["targetType"] != "deployment-sector" for item in result["preferredPlan"]["coverage"])
    assert all(item["type"] != "deployment-sector" for item in result["preferredPlan"]["backlogTargets"])
    assert any(target["inDeploymentContext"] for target in result["candidateTargets"])
    assert any("部署区上下文" in item["reason"] or "部署区" in item["reason"] for item in result["preferredPlan"]["assignments"])


def test_only_deployment_sectors_do_not_create_fake_assignments(threat_json: dict, grouping_json: dict) -> None:
    threat = deepcopy(threat_json)
    for key in ("fireCoverage", "airDefenseSystem", "reconEarlyWarning", "antiAirborneFacilities", "targetAssessments"):
        threat[key] = []
    threat["deploymentSectors"] = [
        {
            "id": "sector-only-1",
            "name": "仅有部署区",
            "center": [118.18, 32.02, 0],
            "polygon": [
                [118.1, 31.95, 0],
                [118.26, 31.95, 0],
                [118.26, 32.09, 0],
                [118.1, 32.09, 0],
                [118.1, 31.95, 0],
            ],
        }
    ]
    result = run_default(threat, grouping_json)
    assert result["deploymentContexts"]
    assert result["candidateTargets"] == []
    assert result["preferredPlan"]["assignments"] == []
    assert result["preferredPlan"]["coverage"] == []
    assert result["preferredPlan"]["backlogTargets"] == []
    assert result["validationSummary"]["status"] == "fail"


def test_target_assessments_fallback_keeps_entity_targets_inside_deployment_context(threat_json: dict, grouping_json: dict) -> None:
    threat = deepcopy(threat_json)
    for key in ("fireCoverage", "airDefenseSystem", "reconEarlyWarning", "antiAirborneFacilities"):
        threat[key] = []
    threat["targetAssessments"] = [
        {
            "id": "entity-1",
            "name": "部署区内实体火力节点",
            "category": "fire_unit",
            "threatScore": 72,
            "valueScore": 70,
            "location": {"coordinates": [118.18, 32.02, 0]},
        }
    ]
    threat["deploymentSectors"] = [
        {
            "id": "sector-fallback-1",
            "name": "实体目标聚类区",
            "center": [118.18, 32.02, 0],
            "units": ["entity-1"],
            "radius": 12,
        }
    ]
    result = run_default(threat, grouping_json, validation_mode="standard")
    assert len(result["candidateTargets"]) == 1
    target = result["candidateTargets"][0]
    assert target["type"] == "assessed-target"
    assert target["coordinates"] == [118.18, 32.02, 0.0]
    assert target["inDeploymentContext"] is True
    assert target["deploymentContextNames"] == ["实体目标聚类区"]
    assert all(item["targetId"] == "entity-1" for item in result["preferredPlan"]["assignments"])


def test_plan_shape_matches_platform_contract(threat_json: dict, grouping_json: dict) -> None:
    result = run_default(threat_json, grouping_json)
    plan = result["preferredPlan"]
    assert plan["methodKey"] == "intelligent-allocation"
    assert 0 <= plan["score"] <= 100
    assert isinstance(plan["assignments"], list)
    assert isinstance(plan["coverage"], list)
    assert isinstance(plan["groupLoads"], list)
    assert isinstance(result["groups"], list)
    assert isinstance(result["platforms"], list)
    assert plan["assignments"]
    assignment = plan["assignments"][0]
    required = {
        "id",
        "groupId",
        "groupName",
        "groupRole",
        "platformId",
        "platformName",
        "platformRole",
        "targetId",
        "targetName",
        "targetType",
        "targetTypeLabel",
        "priority",
        "priorityLevel",
        "difficulty",
        "matchScore",
        "feasibilityScore",
        "capabilityFit",
        "distanceKm",
        "reachUtilization",
        "wave",
        "sequence",
        "packageIndex",
        "requiredPlatformCount",
        "requiredGroupCount",
        "reason",
    }
    assert required.issubset(assignment.keys())
    assert 0 <= assignment["matchScore"] <= 100
    assert 0 <= assignment["feasibilityScore"] <= 100


def test_each_group_is_loaded_when_feasible(threat_json: dict, grouping_json: dict) -> None:
    result = run_default(threat_json, grouping_json, max_assignments_per_group=2)
    loads = result["preferredPlan"]["groupLoads"]
    assert loads
    assert all(load["assignedTargetCount"] >= 1 for load in loads)
    assert all(load["assignedTargetCount"] <= load["maxAssignments"] for load in loads)


def test_objective_preferences_change_plan_tendency(threat_json: dict, grouping_json: dict) -> None:
    balanced = run_default(threat_json, grouping_json, objective_preference="balanced")
    firepower = run_default(threat_json, grouping_json, objective_preference="firepower-first")
    survival = run_default(threat_json, grouping_json, objective_preference="survivability-first")
    assert balanced["appliedOptions"]["objectivePreference"] == "balanced"
    assert firepower["appliedOptions"]["objectivePreference"] == "firepower-first"
    assert survival["appliedOptions"]["objectivePreference"] == "survivability-first"
    scores = {
        balanced["preferredPlan"]["score"],
        firepower["preferredPlan"]["score"],
        survival["preferredPlan"]["score"],
    }
    assert len(scores) >= 2


def test_validation_modes_use_different_profiles(threat_json: dict, grouping_json: dict) -> None:
    strict = run_default(threat_json, grouping_json, validation_mode="strict")
    standard = run_default(threat_json, grouping_json, validation_mode="standard")
    assert strict["validationProfile"]["key"] == "strict"
    assert standard["validationProfile"]["key"] == "standard"
    assert strict["validationProfile"]["minMatchScore"] > standard["validationProfile"]["minMatchScore"]
    assert strict["validationSummary"]["status"] in {"pass", "warn", "fail"}
    assert standard["validationSummary"]["status"] in {"pass", "warn", "fail"}


def test_max_assignments_per_group_is_enforced(threat_json: dict, grouping_json: dict) -> None:
    result = run_default(threat_json, grouping_json, max_assignments_per_group=1, validation_mode="standard")
    assert result["appliedOptions"]["maxAssignmentsPerGroup"] == 1
    assert all(load["assignedTargetCount"] <= 1 for load in result["preferredPlan"]["groupLoads"])
    assert all(not load["overloaded"] for load in result["preferredPlan"]["groupLoads"])


def test_high_speed_group_can_beat_near_slow_group() -> None:
    threat = {
        "ok": True,
        "threatScore": 40,
        "fireCoverage": [],
        "airDefenseSystem": [
            {
                "id": "speed-target-1",
                "name": "快速响应防空节点",
                "strength": 45,
                "center": [118.0, 32.0, 0],
            }
        ],
        "reconEarlyWarning": [],
        "antiAirborneFacilities": [],
        "deploymentSectors": [],
    }
    grouping = {
        "ok": True,
        "preferredScheme": {
            "groups": [
                {
                    "id": "near-slow",
                    "name": "近距慢速主攻群",
                    "role": "strike",
                    "unitCount": 1,
                    "totalStrength": 50,
                    "firepower": 78,
                    "protection": 70,
                    "reconCoverage": 55,
                    "endurance": 60,
                    "mobility": 5,
                    "readinessScore": 85,
                    "coordinates": [118.09, 32.0, 0],
                    "units": [],
                },
                {
                    "id": "far-fast",
                    "name": "远距高速主攻群",
                    "role": "strike",
                    "unitCount": 1,
                    "totalStrength": 50,
                    "firepower": 78,
                    "protection": 70,
                    "reconCoverage": 55,
                    "endurance": 60,
                    "mobility": 90,
                    "readinessScore": 85,
                    "coordinates": [117.75, 32.0, 0],
                    "units": [],
                },
            ]
        },
    }
    result = analyze(threat, grouping, objective_preference="balanced", validation_mode="strict", max_assignments_per_group=1)
    assignment = result["preferredPlan"]["assignments"][0]
    assert assignment["groupId"] == "far-fast"
    assert "行进速度约 90.0 km/h" in assignment["reason"]
    assert "预计响应时间" in assignment["reason"]


def test_same_wave_multi_target_group_builds_low_cost_task_chain() -> None:
    threat = {
        "ok": True,
        "threatScore": 50,
        "fireCoverage": [
            {"id": "target-far", "name": "远端火力节点", "threatScore": 70, "center": [118.22, 32.0, 0]},
            {"id": "target-near", "name": "近端火力节点", "threatScore": 40, "center": [118.04, 32.0, 0]},
        ],
        "airDefenseSystem": [],
        "reconEarlyWarning": [],
        "antiAirborneFacilities": [],
        "deploymentSectors": [],
        "targetAssessments": [],
    }
    grouping = {
        "ok": True,
        "preferredScheme": {
            "groups": [
                {
                    "id": "chain-group",
                    "name": "连续打击群",
                    "role": "strike",
                    "firepower": 90,
                    "protection": 75,
                    "reconCoverage": 60,
                    "endurance": 70,
                    "mobility": 65,
                    "readinessScore": 90,
                    "coordinates": [118.0, 32.0, 0],
                    "units": [],
                }
            ]
        },
    }
    result = analyze(threat, grouping, validation_mode="standard", max_assignments_per_group=2)
    plan = result["preferredPlan"]
    chain = plan["taskChains"][0]
    assert chain["orderedTargetIds"] == ["target-near", "target-far"]
    assignments = {item["targetId"]: item for item in plan["assignments"]}
    assert assignments["target-far"]["routeStartCoordinates"] == [118.04, 32.0, 0.0]
    assert assignments["target-far"]["previousTargetId"] == "target-near"
    assert assignments["target-far"]["originDistanceKm"] != assignments["target-far"]["distanceKm"]
    assert plan["groupLoads"][0]["orderedTargetIds"] == ["target-near", "target-far"]


def test_cross_wave_group_continues_from_previous_target_without_returning() -> None:
    threat = {
        "ok": True,
        "threatScore": 55,
        "fireCoverage": [],
        "airDefenseSystem": [
            {"id": "wave-one-ad", "name": "一波防空节点", "strength": 76, "center": [118.08, 32.0, 0]},
        ],
        "reconEarlyWarning": [],
        "antiAirborneFacilities": [
            {"id": "wave-two-anti", "name": "二波反机降节点", "threatScore": 58, "center": [118.16, 32.0, 0]},
        ],
        "deploymentSectors": [],
        "targetAssessments": [],
    }
    grouping = {
        "ok": True,
        "preferredScheme": {
            "groups": [
                {
                    "id": "cross-wave-group",
                    "name": "跨波次打击群",
                    "role": "strike",
                    "firepower": 92,
                    "protection": 78,
                    "reconCoverage": 65,
                    "endurance": 72,
                    "mobility": 70,
                    "readinessScore": 91,
                    "coordinates": [118.0, 32.0, 0],
                    "units": [],
                }
            ]
        },
    }
    result = analyze(threat, grouping, validation_mode="standard", max_assignments_per_group=2)
    chain = result["preferredPlan"]["taskChains"][0]
    assert chain["orderedTargetIds"] == ["wave-one-ad", "wave-two-anti"]
    assignments = {item["targetId"]: item for item in result["preferredPlan"]["assignments"]}
    assert assignments["wave-two-anti"]["wave"] > assignments["wave-one-ad"]["wave"]
    assert assignments["wave-two-anti"]["routeStartCoordinates"] == [118.08, 32.0, 0.0]
    assert assignments["wave-two-anti"]["previousTargetId"] == "wave-one-ad"


def test_target_assessments_merge_with_primary_entity_targets() -> None:
    threat = {
        "ok": True,
        "threatScore": 60,
        "fireCoverage": [
            {"id": "fire-merge-1", "name": "已识别火力节点", "threatScore": 60, "center": [118.1, 32.0, 0]},
        ],
        "airDefenseSystem": [],
        "reconEarlyWarning": [],
        "antiAirborneFacilities": [],
        "deploymentSectors": [],
        "targetAssessments": [
            {"id": "assessment-extra-1", "name": "独立指挥通信节点", "category": "command", "threatScore": 58, "location": {"coordinates": [118.16, 32.02, 0]}},
            {"id": "assessment-dup-1", "name": "已识别火力节点", "category": "fire_unit", "threatScore": 55, "location": {"coordinates": [118.1, 32.0, 0]}},
        ],
    }
    result = analyze(threat, {"preferredScheme": {"groups": []}}, validation_mode="standard")
    ids = {target["id"] for target in result["candidateTargets"]}
    names = [target["name"] for target in result["candidateTargets"]]
    assert "fire-merge-1" in ids
    assert "assessment-extra-1" in ids
    assert names.count("已识别火力节点") == 1


def test_first_wave_targets_are_more_speed_sensitive() -> None:
    preference = resolve_objective_preference("balanced")
    validation = resolve_validation_profile("strict")
    group = {
        "id": "slow-response",
        "name": "慢速响应群",
        "normalizedRole": "strike",
        "maxAssignments": 2,
        "firepower": 70,
        "protection": 65,
        "reconCoverage": 50,
        "endurance": 55,
        "mobility": 10,
        "readinessScore": 85,
        "engagementRangeKm": 80,
        "coordinates": [118.2, 32.0, 0],
    }
    base_target = {
        "id": "time-target",
        "name": "时间敏感目标",
        "type": "assessed-target",
        "typeLabel": "评估目标",
        "coordinates": [118.0, 32.0, 0],
        "importance": 60,
        "difficulty": 50,
        "priorityLevel": "三级",
        "preferredRoles": ["strike"],
        "capabilityWeights": {
            "firepower": 0.32,
            "protection": 0.16,
            "reconCoverage": 0.18,
            "endurance": 0.12,
            "mobility": 0.22,
        },
    }
    wave_one = {**base_target, "priorityLevel": "一级", "importance": 82, "waveHint": 1}
    wave_three = {**base_target, "priorityLevel": "三级", "importance": 60, "waveHint": 3}
    first_wave_candidate = score_candidate(
        group,
        wave_one,
        current_load=0,
        existing_roles=[],
        preference=preference,
        validation_profile=validation,
    )
    third_wave_candidate = score_candidate(
        group,
        wave_three,
        current_load=0,
        existing_roles=[],
        preference=preference,
        validation_profile=validation,
    )
    assert first_wave_candidate["estimatedTravelHours"] == third_wave_candidate["estimatedTravelHours"]
    assert first_wave_candidate["mobilityResponseScore"] < third_wave_candidate["mobilityResponseScore"]


def test_group_engagement_range_no_longer_depends_on_mobility() -> None:
    grouping = {
        "preferredScheme": {
            "groups": [
                {"id": "slow", "name": "慢速火力群", "role": "strike", "firepower": 70, "mobility": 10, "units": []},
                {"id": "fast", "name": "高速火力群", "role": "strike", "firepower": 70, "mobility": 90, "units": []},
            ]
        }
    }
    groups, _ = build_group_profiles(grouping, max_assignments_per_group=2)
    ranges = {group["id"]: group["engagementRangeKm"] for group in groups}
    assert ranges["slow"] == ranges["fast"]


def test_no_groups_returns_explainable_low_score(threat_json: dict, grouping_json: dict) -> None:
    grouping_json = dict(grouping_json)
    preferred = dict(grouping_json["preferredScheme"])
    preferred["groups"] = []
    grouping_json["preferredScheme"] = preferred
    result = run_default(threat_json, grouping_json)
    assert result["ok"] is True
    assert result["preferredPlan"]["assignments"] == []
    assert result["preferredPlan"]["backlogTargets"]
    assert result["validationSummary"]["status"] == "fail"


def test_no_targets_returns_explainable_result(threat_json: dict, grouping_json: dict) -> None:
    threat_json = dict(threat_json)
    for key in ("fireCoverage", "airDefenseSystem", "reconEarlyWarning", "antiAirborneFacilities", "deploymentSectors", "targetAssessments"):
        threat_json[key] = []
    result = run_default(threat_json, grouping_json)
    assert result["ok"] is True
    assert result["candidateTargets"] == []
    assert result["preferredPlan"]["assignments"] == []
    assert result["validationSummary"]["status"] == "fail"


def test_missing_upstream_returns_error(grouping_json: dict) -> None:
    result = analyze(None, grouping_json)
    assert result["ok"] is False
    assert result["error"]["code"] == "PLANNING_MISSING_UPSTREAM"


def test_cli_can_run_with_samples(tmp_path: Path) -> None:
    output = tmp_path / "result.json"
    command = [
        sys.executable,
        "-m",
        "target_allocation.cli",
        "--upstream-threat",
        str(THREAT_SAMPLE),
        "--upstream-grouping",
        str(GROUPING_SAMPLE),
        "--objective-preference",
        "balanced",
        "--validation-mode",
        "strict",
        "--max-assignments-per-group",
        "2",
        "--output",
        str(output),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    data = json.loads(output.read_text(encoding="utf-8"))
    assert data["ok"] is True
    assert data["builtinMethodLabel"] == "智能分配算法"
    assert len(data["comparedPlans"]) == 1
    assert 0 <= data["preferredPlan"]["score"] <= 100


def test_cli_can_render_plot_with_positioned_inputs(tmp_path: Path, threat_json: dict, grouping_json: dict) -> None:
    threat, grouping = with_real_positions(threat_json, grouping_json)
    threat_file = tmp_path / "threat.json"
    grouping_file = tmp_path / "grouping.json"
    output = tmp_path / "result.json"
    plot = tmp_path / "allocation-map.svg"
    threat_file.write_text(json.dumps(threat, ensure_ascii=False, indent=2), encoding="utf-8")
    grouping_file.write_text(json.dumps(grouping, ensure_ascii=False, indent=2), encoding="utf-8")
    command = [
        sys.executable,
        "-m",
        "target_allocation.cli",
        "--upstream-threat",
        str(threat_file),
        "--upstream-grouping",
        str(grouping_file),
        "--objective-preference",
        "balanced",
        "--validation-mode",
        "strict",
        "--max-assignments-per-group",
        "2",
        "--plot-output",
        str(plot),
        "--output",
        str(output),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    assert output.exists()
    assert plot.exists()
    svg = plot.read_text(encoding="utf-8")
    assert "assignment-arrow" in svg
    assert "deployment-context" in svg
    assert "-> 主要部署区" not in svg


def test_visualization_renders_real_position_assignment_arrows(threat_json: dict, grouping_json: dict) -> None:
    threat, grouping = with_real_positions(threat_json, grouping_json)
    result = analyze(threat, grouping, objective_preference="balanced", validation_mode="strict", max_assignments_per_group=2)
    output = ROOT / "outputs" / "test-allocation-map.svg"
    render_allocation_map(result, output)
    svg = output.read_text(encoding="utf-8")
    assert output.exists()
    assert "<svg" in svg
    assert "assignment-arrow" in svg
    assert "marker-end" in svg
    assert "智能分配算法目标分配图" in svg
    assert "蓝方" in svg
    assert "东侧防空节点" in svg
    assert "deployment-context" in svg
    assert "-> 主要部署区" not in svg


class _FakeTerrainSampler:
    def __init__(self, *, penalty: float, speed_factor: float) -> None:
        self.penalty = penalty
        self.speed_factor = speed_factor

    def sample_path(self, points: list[list[float]]) -> dict:
        return {
            "status": "sampled",
            "sampleCount": len(points),
            "sampledCount": len(points),
            "averagePenalty": self.penalty,
            "averageSlopeDeg": round(self.penalty / 2, 2),
            "averageSpeedFactor": self.speed_factor,
            "averageConcealmentBonus": min(8.0, self.penalty * 0.2),
            "minElevationM": 100,
            "maxElevationM": 180 + self.penalty,
            "zoomUsed": 10,
            "samples": [],
        }


def test_terrain_soft_constraint_changes_assignment_scores(monkeypatch: pytest.MonkeyPatch, threat_json: dict, grouping_json: dict) -> None:
    threat, grouping = with_real_positions(threat_json, grouping_json)
    analyze_module = importlib.import_module("target_allocation.analyze")
    monkeypatch.setattr(analyze_module, "build_sampler", lambda _path: _FakeTerrainSampler(penalty=0, speed_factor=1.0))
    flat = analyze_module.analyze(threat, grouping, terrain_dir="flat-terrain")
    monkeypatch.setattr(analyze_module, "build_sampler", lambda _path: _FakeTerrainSampler(penalty=28, speed_factor=0.58))
    steep = analyze_module.analyze(threat, grouping, terrain_dir="steep-terrain")
    flat_by_id = {assignment["id"]: assignment for assignment in flat["preferredPlan"]["assignments"]}
    steep_by_id = {assignment["id"]: assignment for assignment in steep["preferredPlan"]["assignments"]}
    common_id = next(assignment_id for assignment_id in steep_by_id if assignment_id in flat_by_id)
    flat_assignment = flat_by_id[common_id]
    steep_assignment = steep_by_id[common_id]
    assert steep_assignment["terrainPenalty"] > flat_assignment["terrainPenalty"]
    assert steep_assignment["matchScore"] <= flat_assignment["matchScore"]
    assert "地形采样状态" in steep_assignment["reason"]
    assert steep["appliedOptions"]["terrainEnabled"] is True


def test_no_obsolete_shadow_modules_remain() -> None:
    obsolete = {
        ROOT / "target_allocation" / "group_builder.py",
        ROOT / "target_allocation" / "target_builder.py",
    }
    assert not any(path.exists() for path in obsolete)
