"""Build platform-compatible structured output for target allocation."""

from __future__ import annotations

from typing import Any

from .config import METHOD_KEY, METHOD_LABEL
from .utils import average, clamp_score, variance_score


def _coverage_status(assigned: list[dict[str, Any]], target: dict[str, Any], validation_profile: dict[str, Any]) -> str:
    if not assigned:
        return "uncovered"
    required = int(target.get("requiredGroupCount") or 1)
    avg_match = average([float(item.get("matchScore") or 0) for item in assigned])
    if len(assigned) >= required and avg_match >= float(validation_profile["lowQualityMatchScore"]):
        return "full-covered"
    if len(assigned) >= required:
        return "low-quality-covered"
    return "partial-covered"


def build_plan_summary(
    *,
    plan: dict[str, Any],
    targets: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    platforms: list[dict[str, Any]],
    loads: dict[str, list[str]],
    assigned_by_target: dict[str, list[dict[str, Any]]],
    validation_profile: dict[str, Any],
    preference: dict[str, Any],
) -> dict[str, Any]:
    target_by_id = {target["id"]: target for target in targets}
    coverage = []
    backlog = []
    for target in targets:
        assigned = assigned_by_target.get(target["id"], [])
        status = _coverage_status(assigned, target, validation_profile)
        avg_match = clamp_score(average([float(item.get("matchScore") or 0) for item in assigned]))
        avg_feasibility = clamp_score(average([float(item.get("feasibilityScore") or 0) for item in assigned]))
        row = {
            "targetId": target["id"],
            "targetName": target["name"],
            "targetType": target["type"],
            "targetTypeLabel": target["typeLabel"],
            "priorityLevel": target["priorityLevel"],
            "requiredGroupCount": target["requiredGroupCount"],
            "requiredPlatformCount": target["requiredPlatformCount"],
            "assignedGroupCount": len(assigned),
            "assignedGroupIds": [item["groupId"] for item in assigned],
            "assignedGroupNames": [item["groupName"] for item in assigned],
            "status": status,
            "averageMatchScore": avg_match,
            "averageFeasibilityScore": avg_feasibility,
        }
        coverage.append(row)
        if status == "uncovered":
            backlog.append(
                {
                    "id": target["id"],
                    "name": target["name"],
                    "type": target["type"],
                    "typeLabel": target["typeLabel"],
                    "priorityLevel": target["priorityLevel"],
                    "importance": target["importance"],
                    "difficulty": target["difficulty"],
                    "reason": "没有满足阈值且未超负荷的编组可承担该目标。",
                }
            )

    group_loads = []
    chains_by_group = {
        str(chain.get("groupId")): chain
        for chain in (plan.get("taskChains") or [])
        if isinstance(chain, dict) and chain.get("groupId")
    }
    for group in groups:
        target_ids = loads.get(group["id"], [])
        assigned_targets = [target_by_id[target_id] for target_id in target_ids if target_id in target_by_id]
        max_assignments = int(group.get("maxAssignments") or 1)
        chain = chains_by_group.get(group["id"]) or {}
        row = {
            "groupId": group["id"],
            "groupName": group["name"],
            "groupRole": group["role"],
            "normalizedRole": group["normalizedRole"],
            "assignedTargetCount": len(target_ids),
            "assignedTargetIds": target_ids,
            "assignedTargetNames": [target["name"] for target in assigned_targets],
            "orderedTargetIds": list(chain.get("orderedTargetIds") or target_ids),
            "orderedTargetNames": list(chain.get("orderedTargetNames") or [target["name"] for target in assigned_targets]),
            "chainId": chain.get("id"),
            "chainDistanceKm": chain.get("totalChainDistanceKm"),
            "chainLegCount": chain.get("legCount"),
            "maxAssignments": max_assignments,
            "loadRate": clamp_score(len(target_ids) / max(max_assignments, 1) * 100),
            "overloaded": len(target_ids) > max_assignments,
            "unassignedReason": "" if target_ids else "未找到满足当前阈值、负荷上限与角色适配的目标。",
        }
        group_loads.append(row)

    platform_by_group = {platform["groupId"]: platform for platform in platforms}
    platform_loads = []
    for group_load in group_loads:
        platform = platform_by_group.get(group_load["groupId"]) or {}
        platform_loads.append(
            {
                "platformId": platform.get("id") or f"platform-{group_load['groupId']}",
                "platformName": platform.get("name") or group_load["groupName"],
                "platformRole": platform.get("role") or group_load["normalizedRole"],
                "groupId": group_load["groupId"],
                "assignedTargetCount": group_load["assignedTargetCount"],
                "assignedTargetIds": group_load["assignedTargetIds"],
                "maxAssignments": group_load["maxAssignments"],
                "loadRate": group_load["loadRate"],
                "overloaded": group_load["overloaded"],
            }
        )

    assignments = plan.get("assignments") or []
    total_targets = max(len(targets), 1)
    covered_count = sum(1 for item in coverage if item["status"] != "uncovered")
    full_count = sum(1 for item in coverage if item["status"] == "full-covered")
    priority_targets = [item for item in coverage if item["priorityLevel"] == "一级"]
    priority_covered = sum(1 for item in priority_targets if item["status"] != "uncovered")
    required_multi = [item for item in coverage if item["requiredGroupCount"] > 1]
    collaborated = sum(1 for item in required_multi if item["assignedGroupCount"] >= 2)
    distances = [float(item["distanceKm"]) for item in assignments if item.get("distanceKm") is not None]
    origin_distances = [float(item["originDistanceKm"]) for item in assignments if item.get("originDistanceKm") is not None]
    chain_distances = [
        float(chain.get("totalChainDistanceKm") or 0)
        for chain in (plan.get("taskChains") or [])
        if isinstance(chain, dict) and chain.get("totalChainDistanceKm") is not None
    ]
    risk_values = [float(item.get("riskExposure") or 0) for item in assignments]
    match_values = [float(item.get("matchScore") or 0) for item in assignments]
    feasibility_values = [float(item.get("feasibilityScore") or 0) for item in assignments]
    load_balance = variance_score([float(item["assignedTargetCount"]) for item in group_loads])
    objectives = {
        "partialCoverRate": clamp_score(covered_count / total_targets * 100 if targets else 0),
        "fullCoverRate": clamp_score(full_count / total_targets * 100 if targets else 0),
        "priorityCoverageRate": clamp_score(priority_covered / len(priority_targets) * 100 if priority_targets else 100),
        "collaborationRate": clamp_score(collaborated / len(required_multi) * 100 if required_multi else 100),
        "averageMatchScore": clamp_score(average(match_values)),
        "averageFeasibilityScore": clamp_score(average(feasibility_values)),
        "averageDistanceKm": round(average(distances), 2) if distances else None,
        "averageOriginDistanceKm": round(average(origin_distances), 2) if origin_distances else None,
        "totalChainDistanceKm": round(sum(chain_distances), 2) if chain_distances else round(sum(distances), 2) if distances else 0.0,
        "loadBalance": load_balance,
        "riskExposure": clamp_score(average(risk_values)),
        "backlogPenalty": clamp_score(len(backlog) * 12 + sum(10 for target in backlog if target["priorityLevel"] == "一级")),
    }
    if preference["key"] == "survivability-first":
        score = (
            objectives["partialCoverRate"] * 0.18
            + objectives["fullCoverRate"] * 0.18
            + objectives["priorityCoverageRate"] * 0.12
            + objectives["averageFeasibilityScore"] * 0.20
            + objectives["loadBalance"] * 0.12
            + (100 - objectives["riskExposure"]) * 0.14
            + objectives["collaborationRate"] * 0.06
            - objectives["backlogPenalty"] * 0.25
        )
    elif preference["key"] == "firepower-first":
        score = (
            objectives["partialCoverRate"] * 0.18
            + objectives["fullCoverRate"] * 0.18
            + objectives["priorityCoverageRate"] * 0.22
            + objectives["averageMatchScore"] * 0.18
            + objectives["collaborationRate"] * 0.12
            + objectives["loadBalance"] * 0.07
            + (100 - objectives["riskExposure"]) * 0.05
            - objectives["backlogPenalty"] * 0.25
        )
    else:
        score = (
            objectives["partialCoverRate"] * 0.18
            + objectives["fullCoverRate"] * 0.20
            + objectives["priorityCoverageRate"] * 0.18
            + objectives["averageMatchScore"] * 0.15
            + objectives["averageFeasibilityScore"] * 0.12
            + objectives["collaborationRate"] * 0.08
            + objectives["loadBalance"] * 0.09
            - objectives["backlogPenalty"] * 0.25
        )
    stats = {
        "assignedTargetCount": covered_count,
        "fullyCoveredTargetCount": full_count,
        "backlogTargetCount": len(backlog),
        "averageMatchScore": objectives["averageMatchScore"],
        "averageFeasibilityScore": objectives["averageFeasibilityScore"],
        "coverRate": objectives["partialCoverRate"],
        "fullCoverRate": objectives["fullCoverRate"],
        "priorityCoverRate": objectives["priorityCoverageRate"],
        "collaborationTargetCount": collaborated,
        "averageDistanceKm": objectives["averageDistanceKm"],
        "averageOriginDistanceKm": objectives["averageOriginDistanceKm"],
        "totalChainDistanceKm": objectives["totalChainDistanceKm"],
        "loadBalance": objectives["loadBalance"],
        "platformCount": len(platforms),
        "groupCount": len(groups),
        "taskChainCount": len(plan.get("taskChains") or []),
    }
    plan["coverage"] = coverage
    plan["backlogTargets"] = backlog
    plan["groupLoads"] = group_loads
    plan["platformLoads"] = platform_loads
    plan["objectives"] = objectives
    plan["stats"] = stats
    plan["score"] = clamp_score(score)
    return plan


def build_empty_plan(
    *,
    targets: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    platforms: list[dict[str, Any]],
    validation_profile: dict[str, Any],
    preference: dict[str, Any],
) -> dict[str, Any]:
    plan = {
        "id": "plan-intelligent-allocation",
        "methodKey": METHOD_KEY,
        "methodLabel": METHOD_LABEL,
        "score": 0.0,
        "assignments": [],
        "backlogTargets": [],
        "coverage": [],
        "groupLoads": [],
        "platformLoads": [],
        "objectives": {},
        "optimizationMeta": {
            "algorithm": "priority-driven-group-target-matching",
            "objectivePreference": preference["key"],
            "validationMode": validation_profile["key"],
            "targetCount": len(targets),
            "groupCount": len(groups),
        },
        "stats": {},
        "paretoRank": 1,
    }
    loads = {group["id"]: [] for group in groups}
    assigned = {target["id"]: [] for target in targets}
    return build_plan_summary(
        plan=plan,
        targets=targets,
        groups=groups,
        platforms=platforms,
        loads=loads,
        assigned_by_target=assigned,
        validation_profile=validation_profile,
        preference=preference,
    )


def build_structured_output(
    *,
    targets: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    platforms: list[dict[str, Any]],
    plan: dict[str, Any],
    preference: dict[str, Any],
    validation_profile: dict[str, Any],
    max_assignments_per_group: int,
    deployment_contexts: list[dict[str, Any]],
    validation: list[dict[str, Any]],
    validation_summary: dict[str, Any],
    adjustment_suggestions: list[dict[str, Any]],
    terrain_dir: str | None = None,
    terrain_enabled: bool = False,
) -> dict[str, Any]:
    applied_options = {
        "objectivePreference": preference["key"],
        "objectivePreferenceLabel": preference["label"],
        "validationMode": validation_profile["key"],
        "validationModeLabel": validation_profile["label"],
        "maxAssignmentsPerGroup": max_assignments_per_group,
        "terrainDir": terrain_dir,
        "terrainEnabled": terrain_enabled,
    }
    return {
        "ok": True,
        "implementationStatus": "implemented",
        "builtinMethodKey": METHOD_KEY,
        "builtinMethodLabel": METHOD_LABEL,
        "appliedOptions": applied_options,
        "validationProfile": validation_profile,
        "candidateTargets": targets,
        "deploymentContexts": deployment_contexts or [],
        "targetClusters": deployment_contexts or [],
        "platforms": platforms,
        "groups": groups,
        "comparedPlans": [plan],
        "preferredPlanMethodKey": METHOD_KEY,
        "preferredPlan": plan,
        "systemBestPlanMethodKey": METHOD_KEY,
        "systemBestPlan": plan,
        "validationSummary": validation_summary,
        "validation": validation,
        "validationFindings": validation,
        "adjustmentSuggestions": adjustment_suggestions,
    }
