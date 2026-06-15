"""Greedy collaborative group-to-target solver."""

from __future__ import annotations

from itertools import permutations
from typing import Any

from .config import METHOD_KEY, METHOD_LABEL, PLAN_ID
from .scoring import assignment_wave, candidate_is_acceptable, score_candidate
from .utils import average, clamp_score, haversine_km, safe_number


def _assignment_reason(group: dict[str, Any], target: dict[str, Any], candidate: dict[str, Any], role_label: str) -> str:
    fragments = [
        f"该目标为{target['priorityLevel']}{target['typeLabel']}，{group['name']}以{role_label}身份承担。",
        f"能力适配 {candidate['capabilityFit']}、匹配分 {candidate['matchScore']}、可行性 {candidate['feasibilityScore']}。",
    ]
    if target.get("deploymentContextNames"):
        fragments.append(f"目标位于或邻近部署区上下文（{'、'.join(target['deploymentContextNames'])}），但分配对象仍为该实体目标。")
    if candidate.get("distanceNote"):
        fragments.append(candidate["distanceNote"])
    elif candidate.get("distanceKm") is not None:
        fragments.append(f"本腿目标距离约 {candidate['distanceKm']} km，射程利用率 {candidate['reachUtilization']}。")
        if candidate.get("originDistanceKm") is not None and candidate.get("originDistanceKm") != candidate.get("distanceKm"):
            fragments.append(f"原始阵位至目标审计距离约 {candidate['originDistanceKm']} km。")
    if candidate.get("estimatedTravelHours") is not None and candidate.get("mobilityKph") is not None:
        fragments.append(
            f"编组行进速度约 {candidate['mobilityKph']} km/h，预计响应时间约 {candidate['estimatedTravelHours']} 小时，"
            f"空间机动响应分 {candidate.get('mobilityResponseScore')}。"
        )
    terrain = candidate.get("terrain") or {}
    if terrain.get("status") not in {None, "disabled"}:
        fragments.append(
            "地形采样状态 {status}，平均坡度约 {slope} 度，地形罚分 {penalty}，有效速度系数 {speed}。".format(
                status=terrain.get("status"),
                slope=terrain.get("averageSlopeDeg"),
                penalty=terrain.get("averagePenalty"),
                speed=terrain.get("averageSpeedFactor"),
            )
        )
    if group.get("normalizedRole") in target.get("preferredRoles", []):
        fragments.append("编组角色命中目标偏好角色，适合作为主责或关键协同力量。")
    else:
        fragments.append("该编组不属于首选打击角色，但可补足协同覆盖与任务连续性。")
    return "".join(fragments)


def _make_assignment(
    *,
    sequence: int,
    group: dict[str, Any],
    target: dict[str, Any],
    candidate: dict[str, Any],
    package_index: int,
    role_label: str,
) -> dict[str, Any]:
    wave = assignment_wave(target)
    return {
        "id": f"assignment-{sequence}",
        "platformId": group["platformId"],
        "platformName": group["platformName"],
        "platformRole": group["normalizedRole"],
        "platformCategory": "group",
        "groupId": group["id"],
        "groupName": group["name"],
        "groupRole": group["role"],
        "targetId": target["id"],
        "targetName": target["name"],
        "targetType": target["type"],
        "targetTypeLabel": target["typeLabel"],
        "priority": target["importance"],
        "priorityLevel": target["priorityLevel"],
        "difficulty": target["difficulty"],
        "matchScore": candidate["matchScore"],
        "feasibilityScore": candidate["feasibilityScore"],
        "capabilityFit": candidate["capabilityFit"],
        "distanceKm": candidate["distanceKm"],
        "originDistanceKm": candidate.get("originDistanceKm"),
        "reachUtilization": candidate["reachUtilization"],
        "sequence": sequence,
        "wave": wave,
        "packageIndex": package_index,
        "requiredPlatformCount": target["requiredPlatformCount"],
        "requiredGroupCount": target["requiredGroupCount"],
        "assignmentRole": role_label,
        "reason": _assignment_reason(group, target, candidate, role_label),
        "riskExposure": candidate["riskExposure"],
        "estimatedTravelHours": candidate.get("estimatedTravelHours"),
        "mobilityKph": candidate.get("mobilityKph"),
        "mobilityResponseScore": candidate.get("mobilityResponseScore"),
        "terrain": candidate.get("terrain"),
        "terrainPenalty": candidate.get("terrainPenalty"),
        "chainId": f"chain-{group['id']}",
        "groupSequence": None,
        "legIndex": None,
        "legCount": None,
        "routeStartCoordinates": candidate.get("routeStartCoordinates") or group.get("coordinates"),
        "routeEndCoordinates": candidate.get("routeEndCoordinates") or target.get("coordinates"),
        "previousTargetId": None,
        "nextTargetId": None,
        "chainLegDistanceKm": candidate.get("distanceKm"),
        "cumulativeChainDistanceKm": None,
    }


def _route_start_for_group(group: dict[str, Any], loads: dict[str, list[str]], target_lookup: dict[str, dict[str, Any]]) -> list[float] | None:
    for target_id in reversed(loads.get(group["id"], [])):
        target = target_lookup.get(target_id)
        coordinates = target.get("coordinates") if target else None
        if coordinates:
            return coordinates
    return group.get("coordinates")


def _candidate_ranking(
    *,
    target: dict[str, Any],
    groups: list[dict[str, Any]],
    loads: dict[str, list[str]],
    assigned_by_target: dict[str, list[dict[str, Any]]],
    preference: dict[str, Any],
    validation_profile: dict[str, Any],
    target_lookup: dict[str, dict[str, Any]],
    terrain_sampler: Any | None = None,
    relaxed: bool = False,
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    existing = assigned_by_target.get(target["id"], [])
    existing_group_ids = {item["groupId"] for item in existing}
    existing_roles = [item["platformRole"] for item in existing]
    ranked: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for group in groups:
        if group["id"] in existing_group_ids:
            continue
        if len(loads[group["id"]]) >= int(group.get("maxAssignments") or 1):
            continue
        route_start = _route_start_for_group(group, loads, target_lookup)
        candidate = score_candidate(
            group,
            target,
            current_load=len(loads[group["id"]]),
            existing_roles=existing_roles,
            preference=preference,
            validation_profile=validation_profile,
            terrain_sampler=terrain_sampler,
            route_start_coordinates=route_start,
        )
        if candidate_is_acceptable(candidate, validation_profile, relaxed=relaxed):
            diversity_bonus = 4 if group.get("normalizedRole") not in existing_roles else 0
            ranked.append((group, {**candidate, "_rankScore": candidate["matchScore"] + diversity_bonus}))
    return sorted(ranked, key=lambda item: item[1]["_rankScore"], reverse=True)


def _add_assignment(
    assignments: list[dict[str, Any]],
    *,
    group: dict[str, Any],
    target: dict[str, Any],
    candidate: dict[str, Any],
    loads: dict[str, list[str]],
    assigned_by_target: dict[str, list[dict[str, Any]]],
    role_label: str,
) -> None:
    sequence = len(assignments) + 1
    package_index = len(assigned_by_target.get(target["id"], [])) + 1
    assignment = _make_assignment(
        sequence=sequence,
        group=group,
        target=target,
        candidate=candidate,
        package_index=package_index,
        role_label=role_label,
    )
    assignments.append(assignment)
    loads[group["id"]].append(target["id"])
    assigned_by_target.setdefault(target["id"], []).append(assignment)


def _midpoint(start: list[float], end: list[float]) -> list[float]:
    return [
        round((float(start[0]) + float(end[0])) / 2, 6),
        round((float(start[1]) + float(end[1])) / 2, 6),
        round((float(start[2] if len(start) > 2 else 0) + float(end[2] if len(end) > 2 else 0)) / 2, 2),
    ]


def _terrain_penalty_for_leg(start: list[float] | None, end: list[float] | None, terrain_sampler: Any | None, fallback: float) -> float:
    if start is None or end is None or terrain_sampler is None:
        return fallback
    try:
        summary = terrain_sampler.sample_path([start, _midpoint(start, end), end])
    except Exception:
        return fallback
    if summary.get("status") == "sampled":
        return safe_number(summary.get("averagePenalty"), fallback)
    return fallback


def _leg_order_cost(
    *,
    start: list[float] | None,
    assignment: dict[str, Any],
    group: dict[str, Any],
    target_lookup: dict[str, dict[str, Any]],
    terrain_sampler: Any | None,
) -> float:
    target = target_lookup.get(str(assignment.get("targetId")) or "")
    end = target.get("coordinates") if target else None
    distance = haversine_km(start, end)
    if distance is None:
        distance = 55.0
    speed = max(safe_number(group.get("mobility"), 45.0), 1.0)
    travel_hours = distance / speed
    terrain_penalty = _terrain_penalty_for_leg(start, end, terrain_sampler, safe_number(assignment.get("terrainPenalty"), 0.0))
    risk = safe_number(assignment.get("riskExposure"), 0.0)
    priority = safe_number(assignment.get("priority"), 0.0)
    return distance + travel_hours * 8.0 + terrain_penalty * 0.08 + risk * 0.04 - priority * 0.01


def _order_wave_assignments(
    *,
    start: list[float] | None,
    assignments: list[dict[str, Any]],
    group: dict[str, Any],
    target_lookup: dict[str, dict[str, Any]],
    terrain_sampler: Any | None,
) -> list[dict[str, Any]]:
    if len(assignments) <= 1:
        return assignments
    best_order: tuple[float, tuple[dict[str, Any], ...]] | None = None
    for order in permutations(assignments):
        current = start
        cost = 0.0
        for assignment in order:
            cost += _leg_order_cost(
                start=current,
                assignment=assignment,
                group=group,
                target_lookup=target_lookup,
                terrain_sampler=terrain_sampler,
            )
            target = target_lookup.get(str(assignment.get("targetId")) or "")
            current = target.get("coordinates") if target else current
        if best_order is None or cost < best_order[0]:
            best_order = (cost, order)
    return list(best_order[1]) if best_order else assignments


def _candidate_for_leg(
    *,
    group: dict[str, Any],
    target: dict[str, Any],
    assignment: dict[str, Any],
    route_start: list[float] | None,
    preference: dict[str, Any],
    validation_profile: dict[str, Any],
    terrain_sampler: Any | None,
    existing_roles: list[str] | None = None,
) -> dict[str, Any]:
    candidate = score_candidate(
        group,
        target,
        current_load=max(int(assignment.get("groupSequence") or 1) - 1, 0),
        existing_roles=existing_roles or [],
        preference=preference,
        validation_profile=validation_profile,
        terrain_sampler=terrain_sampler,
        route_start_coordinates=route_start,
    )
    return {**assignment, **candidate}


def _finalize_task_chains(
    *,
    assignments: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    targets: list[dict[str, Any]],
    loads: dict[str, list[str]],
    preference: dict[str, Any],
    validation_profile: dict[str, Any],
    terrain_sampler: Any | None,
) -> list[dict[str, Any]]:
    target_lookup = {target["id"]: target for target in targets}
    group_lookup = {group["id"]: group for group in groups}
    target_roles: dict[str, list[str]] = {}
    for assignment in assignments:
        target_roles.setdefault(str(assignment.get("targetId") or ""), []).append(str(assignment.get("platformRole") or ""))
    by_group: dict[str, list[dict[str, Any]]] = {}
    for assignment in assignments:
        by_group.setdefault(str(assignment.get("groupId") or ""), []).append(assignment)

    task_chains: list[dict[str, Any]] = []
    ordered_all: list[dict[str, Any]] = []
    for group in groups:
        group_id = group["id"]
        group_assignments = by_group.get(group_id, [])
        if not group_assignments:
            loads[group_id] = []
            continue
        current = group.get("coordinates")
        ordered_group: list[dict[str, Any]] = []
        waves = sorted({int(assignment.get("wave") or 1) for assignment in group_assignments})
        for wave in waves:
            wave_items = [
                assignment
                for assignment in group_assignments
                if int(assignment.get("wave") or 1) == wave
            ]
            ordered_wave = _order_wave_assignments(
                start=current,
                assignments=wave_items,
                group=group,
                target_lookup=target_lookup,
                terrain_sampler=terrain_sampler,
            )
            ordered_group.extend(ordered_wave)
            if ordered_wave:
                last_target = target_lookup.get(str(ordered_wave[-1].get("targetId")) or "")
                current = last_target.get("coordinates") if last_target else current

        leg_count = len(ordered_group)
        cumulative = 0.0
        current = group.get("coordinates")
        chain_id = f"chain-{group_id}"
        legs: list[dict[str, Any]] = []
        for index, assignment in enumerate(ordered_group, start=1):
            target = target_lookup.get(str(assignment.get("targetId")) or "")
            if not target:
                continue
            previous_assignment = ordered_group[index - 2] if index > 1 else None
            next_assignment = ordered_group[index] if index < leg_count else None
            route_start = current or group.get("coordinates")
            updated_candidate = _candidate_for_leg(
                group=group,
                target=target,
                assignment=assignment,
                route_start=route_start,
                preference=preference,
                validation_profile=validation_profile,
                terrain_sampler=terrain_sampler,
                existing_roles=[
                    role
                    for role in target_roles.get(str(assignment.get("targetId") or ""), [])
                    if role and role != str(assignment.get("platformRole") or "")
                ],
            )
            distance = updated_candidate.get("distanceKm")
            if distance is not None:
                cumulative += safe_number(distance)
            assignment.update(
                {
                    "chainId": chain_id,
                    "groupSequence": index,
                    "legIndex": index,
                    "legCount": leg_count,
                    "routeStartCoordinates": updated_candidate.get("routeStartCoordinates") or route_start,
                    "routeEndCoordinates": updated_candidate.get("routeEndCoordinates") or target.get("coordinates"),
                    "previousTargetId": previous_assignment.get("targetId") if previous_assignment else None,
                    "previousTargetName": previous_assignment.get("targetName") if previous_assignment else None,
                    "nextTargetId": next_assignment.get("targetId") if next_assignment else None,
                    "nextTargetName": next_assignment.get("targetName") if next_assignment else None,
                    "originDistanceKm": updated_candidate.get("originDistanceKm"),
                    "distanceKm": updated_candidate.get("distanceKm"),
                    "chainLegDistanceKm": updated_candidate.get("distanceKm"),
                    "cumulativeChainDistanceKm": round(cumulative, 2),
                    "reachUtilization": updated_candidate.get("reachUtilization"),
                    "matchScore": updated_candidate.get("matchScore"),
                    "feasibilityScore": updated_candidate.get("feasibilityScore"),
                    "capabilityFit": updated_candidate.get("capabilityFit"),
                    "riskExposure": updated_candidate.get("riskExposure"),
                    "estimatedTravelHours": updated_candidate.get("estimatedTravelHours"),
                    "mobilityKph": updated_candidate.get("mobilityKph"),
                    "mobilityResponseScore": updated_candidate.get("mobilityResponseScore"),
                    "terrain": updated_candidate.get("terrain"),
                    "terrainPenalty": updated_candidate.get("terrainPenalty"),
                }
            )
            assignment["reason"] = _assignment_reason(group, target, assignment, str(assignment.get("assignmentRole") or "主承担编组"))
            legs.append(
                {
                    "assignmentId": assignment.get("id"),
                    "targetId": assignment.get("targetId"),
                    "targetName": assignment.get("targetName"),
                    "targetType": assignment.get("targetType"),
                    "wave": assignment.get("wave"),
                    "legIndex": index,
                    "startCoordinates": assignment.get("routeStartCoordinates"),
                    "endCoordinates": assignment.get("routeEndCoordinates"),
                    "distanceKm": assignment.get("chainLegDistanceKm"),
                    "previousTargetId": assignment.get("previousTargetId"),
                    "nextTargetId": assignment.get("nextTargetId"),
                    "estimatedTravelHours": updated_candidate.get("estimatedTravelHours"),
                }
            )
            current = target.get("coordinates") or current
        loads[group_id] = [str(assignment.get("targetId")) for assignment in ordered_group]
        ordered_all.extend(ordered_group)
        task_chains.append(
            {
                "id": chain_id,
                "groupId": group_id,
                "groupName": group.get("name") or group_id,
                "groupRole": group.get("role") or group.get("normalizedRole"),
                "normalizedRole": group.get("normalizedRole"),
                "startCoordinates": group.get("coordinates"),
                "endCoordinates": legs[-1]["endCoordinates"] if legs else group.get("coordinates"),
                "orderedAssignmentIds": [str(assignment.get("id")) for assignment in ordered_group],
                "orderedTargetIds": [str(assignment.get("targetId")) for assignment in ordered_group],
                "orderedTargetNames": [str(assignment.get("targetName")) for assignment in ordered_group],
                "legCount": len(legs),
                "totalChainDistanceKm": round(cumulative, 2),
                "estimatedChainTravelHours": round(
                    sum(safe_number(leg.get("estimatedTravelHours")) for leg in legs if leg.get("estimatedTravelHours") is not None),
                    2,
                )
                if any(leg.get("estimatedTravelHours") is not None for leg in legs)
                else None,
                "waveSpan": [min(waves), max(waves)] if waves else [1, 1],
                "averageMatchScore": round(average([safe_number(item.get("matchScore")) for item in ordered_group]), 2),
                "averageFeasibilityScore": round(average([safe_number(item.get("feasibilityScore")) for item in ordered_group]), 2),
                "chainContinuityScore": clamp_score(100 - cumulative / max(leg_count, 1) * 0.8),
                "legs": legs,
            }
        )

    for group_id, items in by_group.items():
        if group_id not in group_lookup:
            ordered_all.extend(items)

    assignments[:] = sorted(
        ordered_all,
        key=lambda item: (
            int(item.get("wave") or 1),
            str(item.get("chainId") or ""),
            int(item.get("legIndex") or item.get("sequence") or 0),
            str(item.get("targetId") or ""),
        ),
    )
    for sequence, assignment in enumerate(assignments, start=1):
        assignment["sequence"] = sequence
    return task_chains


def solve_intelligent_allocation(
    *,
    targets: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    preference: dict[str, Any],
    validation_profile: dict[str, Any],
    terrain_sampler: Any | None = None,
) -> tuple[dict[str, Any], dict[str, list[str]], dict[str, list[dict[str, Any]]]]:
    targets = [target for target in targets if target.get("type") != "deployment-sector"]
    target_lookup = {target["id"]: target for target in targets}
    assignments: list[dict[str, Any]] = []
    loads = {group["id"]: [] for group in groups}
    assigned_by_target: dict[str, list[dict[str, Any]]] = {target["id"]: [] for target in targets}

    sorted_targets = sorted(targets, key=lambda item: item["compositePriority"], reverse=True)

    for target in sorted_targets:
        ranked = _candidate_ranking(
            target=target,
            groups=groups,
            loads=loads,
            assigned_by_target=assigned_by_target,
            preference=preference,
            validation_profile=validation_profile,
            target_lookup=target_lookup,
            terrain_sampler=terrain_sampler,
        )
        if ranked:
            group, candidate = ranked[0]
            _add_assignment(
                assignments,
                group=group,
                target=target,
                candidate=candidate,
                loads=loads,
                assigned_by_target=assigned_by_target,
                role_label="主承担编组",
            )

    for target in sorted_targets:
        while len(assigned_by_target[target["id"]]) < int(target.get("requiredGroupCount") or 1):
            ranked = _candidate_ranking(
                target=target,
                groups=groups,
                loads=loads,
                assigned_by_target=assigned_by_target,
                preference=preference,
                validation_profile=validation_profile,
                target_lookup=target_lookup,
                terrain_sampler=terrain_sampler,
            )
            if not ranked:
                ranked = _candidate_ranking(
                    target=target,
                    groups=groups,
                    loads=loads,
                    assigned_by_target=assigned_by_target,
                    preference=preference,
                    validation_profile=validation_profile,
                    target_lookup=target_lookup,
                    terrain_sampler=terrain_sampler,
                    relaxed=validation_profile["key"] == "standard",
                )
            if not ranked:
                break
            group, candidate = ranked[0]
            _add_assignment(
                assignments,
                group=group,
                target=target,
                candidate=candidate,
                loads=loads,
                assigned_by_target=assigned_by_target,
                role_label="协同编组",
            )

    for group in groups:
        if loads[group["id"]] or not targets:
            continue
        target_candidates = sorted(
            targets,
            key=lambda item: (
                len(assigned_by_target[item["id"]]) >= int(item.get("requiredGroupCount") or 1),
                -float(item.get("compositePriority") or 0),
            ),
        )
        chosen: tuple[dict[str, Any], dict[str, Any]] | None = None
        for target in target_candidates:
            if any(item["groupId"] == group["id"] for item in assigned_by_target[target["id"]]):
                continue
            ranked = _candidate_ranking(
                target=target,
                groups=[group],
                loads=loads,
                assigned_by_target=assigned_by_target,
                preference=preference,
                validation_profile=validation_profile,
                target_lookup=target_lookup,
                terrain_sampler=terrain_sampler,
                relaxed=validation_profile["key"] == "standard",
            )
            if ranked:
                chosen = ranked[0]
                break
        if chosen:
            target = next(target for target in targets if target["id"] == chosen[1]["targetId"])
            _add_assignment(
                assignments,
                group=group,
                target=target,
                candidate=chosen[1],
                loads=loads,
                assigned_by_target=assigned_by_target,
                role_label="辅助协同编组",
            )

    task_chains = _finalize_task_chains(
        assignments=assignments,
        groups=groups,
        targets=targets,
        loads=loads,
        preference=preference,
        validation_profile=validation_profile,
        terrain_sampler=terrain_sampler,
    )

    plan = {
        "id": PLAN_ID,
        "methodKey": METHOD_KEY,
        "methodLabel": METHOD_LABEL,
        "score": 0.0,
        "assignments": assignments,
        "taskChains": task_chains,
        "backlogTargets": [],
        "coverage": [],
        "groupLoads": [],
        "platformLoads": [],
        "objectives": {},
        "optimizationMeta": {
            "algorithm": "priority-driven-group-target-matching",
            "chainAlgorithm": "route-aware-wave-preserving-chain",
            "objectivePreference": preference["key"],
            "validationMode": validation_profile["key"],
            "targetCount": len(targets),
            "groupCount": len(groups),
            "terrainEnabled": terrain_sampler is not None,
            "terrainStatus": "enabled" if terrain_sampler is not None else "disabled",
            "terrainSampledAssignmentCount": sum(1 for item in assignments if (item.get("terrain") or {}).get("sampledCount")),
        },
        "stats": {},
        "paretoRank": 1,
    }
    return plan, loads, assigned_by_target
