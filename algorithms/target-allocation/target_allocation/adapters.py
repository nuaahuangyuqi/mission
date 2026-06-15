"""Adapt upstream threat and grouping outputs into allocation profiles."""

from __future__ import annotations

from typing import Any

from .config import (
    TARGET_TYPE_PROFILES,
    boosted_capability_weights,
    priority_level,
    required_group_count,
)
from .utils import average, clamp, clamp_score, first_coordinates, haversine_km, normalize_coordinates, safe_number, slugify


SOURCE_SPECS = (
    ("fireCoverage", "fire-coverage", ("threatValue", "threatScore", "score", "coverageScore")),
    ("airDefenseSystem", "air-defense", ("strength", "threatValue", "threatScore", "score")),
    ("reconEarlyWarning", "recon-warning", ("confidence", "threatValue", "threatScore", "score")),
    ("antiAirborneFacilities", "anti-airborne", ("confidence", "threatValue", "threatScore", "score")),
)

COORDINATE_KEYS = ("coordinates", "center", "location", "position", "centroid")
DEFAULT_DEPLOYMENT_CONTEXT_RADIUS_KM = 15.0


def _first_score(item: dict[str, Any], keys: tuple[str, ...], default: float = 60.0) -> float:
    for key in keys:
        if item.get(key) is not None:
            return clamp_score(item.get(key))
    return clamp_score(default)


def _radius_score(item: dict[str, Any]) -> float:
    raw = item.get("radiusMeters")
    if raw is None:
        raw = item.get("radius")
    if raw is None and item.get("coverageKm") is not None:
        return clamp_score(safe_number(item.get("coverageKm")) / 60 * 100)
    radius = safe_number(raw)
    if radius <= 0:
        return 45.0
    radius_km = radius / 1000 if radius > 500 else radius
    return clamp_score(radius_km / 60 * 100)


def _node_name(item: dict[str, Any], source_key: str, index: int, type_label: str) -> str:
    return str(item.get("name") or item.get("label") or item.get("title") or f"{type_label}{index}")


def _importance(
    *,
    profile: dict[str, Any],
    node_score: float,
    overall_threat_score: float,
    intention_score: float,
) -> float:
    return clamp_score(
        float(profile["baseImportance"]) * 0.50
        + node_score * 0.34
        + overall_threat_score * 0.12
        + intention_score * 0.04
    )


def _difficulty(profile: dict[str, Any], node_score: float, radius_score: float, item: dict[str, Any]) -> float:
    confidence = safe_number(item.get("confidence"), 0.72)
    if confidence > 1:
        confidence = confidence / 100
    uncertainty = (1 - clamp(confidence, 0.0, 1.0)) * 100
    return clamp_score(float(profile["baseDifficulty"]) * 0.45 + node_score * 0.32 + radius_score * 0.16 + uncertainty * 0.07)


def _target_from_item(
    item: dict[str, Any],
    *,
    source_key: str,
    target_type: str,
    index: int,
    score_keys: tuple[str, ...],
    overall_threat_score: float,
    intention_score: float,
    validation_mode: str,
    preference: dict[str, Any],
) -> dict[str, Any]:
    profile = TARGET_TYPE_PROFILES[target_type]
    node_score = _first_score(item, score_keys)
    radius_score = _radius_score(item)
    importance = _importance(
        profile=profile,
        node_score=node_score,
        overall_threat_score=overall_threat_score,
        intention_score=intention_score,
    )
    difficulty = _difficulty(profile, node_score, radius_score, item)
    level = priority_level(importance)
    required = required_group_count(target_type, importance, validation_mode)
    target_id = str(item.get("id") or f"target-{target_type}-{index}")
    source_entity_id = str(item.get("sourceUnitId") or item.get("sourceTargetId") or item.get("entityId") or item.get("unitId") or target_id)
    composite = clamp_score(importance * 0.66 + node_score * 0.20 + (100 - difficulty) * 0.06 + radius_score * 0.08)
    return {
        "id": target_id,
        "name": _node_name(item, source_key, index, str(profile["typeLabel"])),
        "type": target_type,
        "typeLabel": profile["typeLabel"],
        "coordinates": first_coordinates(item, COORDINATE_KEYS),
        "importance": importance,
        "difficulty": difficulty,
        "priorityLevel": level,
        "requiredPlatformCount": required,
        "requiredGroupCount": required,
        "preferredRoles": list(profile["preferredRoles"]),
        "capabilityWeights": boosted_capability_weights(dict(profile["capabilityWeights"]), preference),
        "rationale": f"由上游 {source_key} 节点转换，节点强度 {node_score}。",
        "sourceKey": source_key,
        "sourceNodeId": target_id,
        "sourceEntityId": source_entity_id,
        "nodeScore": node_score,
        "radiusScore": radius_score,
        "compositePriority": composite,
        "waveHint": profile["wave"],
        "raw": item,
    }


def _target_identity_values(target: dict[str, Any]) -> set[str]:
    raw = target.get("raw") or {}
    values = {
        str(target.get("id") or ""),
        str(target.get("sourceNodeId") or ""),
        str(target.get("sourceEntityId") or ""),
        str(raw.get("id") or ""),
        str(raw.get("sourceUnitId") or ""),
        str(raw.get("sourceTargetId") or ""),
        str(raw.get("entityId") or ""),
        str(raw.get("unitId") or ""),
    }
    return {value for value in values if value}


def _target_name_key(target: dict[str, Any]) -> str:
    return str(target.get("name") or "").strip().lower()


def _append_unique_target(targets: list[dict[str, Any]], target: dict[str, Any], seen_ids: set[str], seen_names: set[str]) -> bool:
    identities = _target_identity_values(target)
    name_key = _target_name_key(target)
    if identities & seen_ids:
        return False
    if name_key and name_key in seen_names:
        return False
    seen_ids.update(identities)
    if name_key:
        seen_names.add(name_key)
    targets.append(target)
    return True


def _dominant_intention_score(threat: dict[str, Any]) -> float:
    scores = []
    for item in threat.get("enemyIntentions") or []:
        if not isinstance(item, dict):
            continue
        scores.append(_first_score(item, ("score", "confidence", "threatScore"), 50.0))
    return average(scores, 50.0)


def _deployment_context_radius_km(item: dict[str, Any], center: list[float] | None, polygon: list[list[float]]) -> float:
    if item.get("coverageKm") is not None:
        return round(max(safe_number(item.get("coverageKm"), DEFAULT_DEPLOYMENT_CONTEXT_RADIUS_KM), 0.1), 2)
    raw_radius = item.get("radiusMeters")
    if raw_radius is None:
        raw_radius = item.get("radius")
    if raw_radius is not None:
        radius = safe_number(raw_radius, DEFAULT_DEPLOYMENT_CONTEXT_RADIUS_KM)
        if radius > 500:
            radius = radius / 1000
        return round(max(radius, 0.1), 2)
    if center and polygon:
        distances = [haversine_km(center, point) for point in polygon]
        valid = [distance for distance in distances if distance is not None]
        if valid:
            return round(max(valid), 2)
    return DEFAULT_DEPLOYMENT_CONTEXT_RADIUS_KM


def _polygon_points(item: dict[str, Any]) -> list[list[float]]:
    raw = item.get("polygon")
    if not isinstance(raw, list):
        return []
    points = []
    for point in raw:
        coordinate = normalize_coordinates(point)
        if coordinate:
            points.append(coordinate)
    return points


def _point_in_polygon(point: list[float], polygon: list[list[float]]) -> bool:
    if len(polygon) < 3:
        return False
    x, y = point[0], point[1]
    inside = False
    j = len(polygon) - 1
    for i, vertex in enumerate(polygon):
        xi, yi = vertex[0], vertex[1]
        xj, yj = polygon[j][0], polygon[j][1]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 0.0000001) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def build_deployment_contexts(upstream_threat: dict[str, Any]) -> list[dict[str, Any]]:
    contexts: list[dict[str, Any]] = []
    sectors = upstream_threat.get("deploymentSectors") or []
    if not isinstance(sectors, list):
        return contexts
    for index, item in enumerate(sectors, start=1):
        if not isinstance(item, dict):
            continue
        center = first_coordinates(item, COORDINATE_KEYS)
        polygon = _polygon_points(item)
        context_id = str(item.get("id") or f"deployment-context-{index}")
        member_ids = [str(value) for value in (item.get("units") or item.get("targetIds") or [])]
        evidence = [str(value) for value in (item.get("evidence") or [])]
        contexts.append(
            {
                "id": context_id,
                "name": str(item.get("name") or item.get("label") or f"部署区{index}"),
                "type": "deployment-context",
                "typeLabel": "部署区上下文",
                "assignable": False,
                "coordinates": center,
                "center": center,
                "polygon": polygon,
                "radiusKm": _deployment_context_radius_km(item, center, polygon),
                "unitCount": int(safe_number(item.get("unitCount"), len(member_ids))),
                "averageStrength": clamp_score(item.get("averageStrength") or item.get("threatScore") or item.get("score")),
                "posture": item.get("posture") or item.get("description") or "",
                "mainCategory": item.get("mainCategory") or "",
                "memberSourceIds": member_ids,
                "evidence": evidence,
                "source": item.get("source") or "enemy-threat-analysis.deploymentSectors",
                "rationale": "部署区由多个目标实体聚类形成，仅作为空间上下文，不作为火力分配对象。",
                "raw": item,
            }
        )
    return contexts


def _target_context_match(target: dict[str, Any], context: dict[str, Any]) -> bool:
    member_ids = set(context.get("memberSourceIds") or [])
    if member_ids:
        identifiers = {
            str(target.get("id") or ""),
            str(target.get("sourceNodeId") or ""),
            str(target.get("sourceEntityId") or ""),
            str((target.get("raw") or {}).get("id") or ""),
            str((target.get("raw") or {}).get("sourceUnitId") or ""),
        }
        if identifiers & member_ids:
            return True
    target_coord = target.get("coordinates")
    if not isinstance(target_coord, list):
        return False
    polygon = context.get("polygon") or []
    if isinstance(polygon, list) and _point_in_polygon(target_coord, polygon):
        return True
    center = context.get("center") or context.get("coordinates")
    if isinstance(center, list):
        distance = haversine_km(center, target_coord)
        radius_km = safe_number(context.get("radiusKm"), DEFAULT_DEPLOYMENT_CONTEXT_RADIUS_KM)
        if distance is not None and distance <= radius_km:
            return True
    return False


def annotate_targets_with_deployment_contexts(targets: list[dict[str, Any]], contexts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not contexts:
        for target in targets:
            target["deploymentContextIds"] = []
            target["deploymentContextNames"] = []
            target["inDeploymentContext"] = False
        return targets
    for target in targets:
        matched = [context for context in contexts if _target_context_match(target, context)]
        target["deploymentContextIds"] = [context["id"] for context in matched]
        target["deploymentContextNames"] = [context["name"] for context in matched]
        target["inDeploymentContext"] = bool(matched)
        if matched:
            names = "、".join(context["name"] for context in matched)
            target["rationale"] = f"{target.get('rationale', '')} 位于或邻近部署区上下文：{names}。"
    return targets


def build_candidate_targets(
    upstream_threat: dict[str, Any],
    *,
    validation_mode: str,
    preference: dict[str, Any],
    deployment_contexts: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    overall = clamp_score(upstream_threat.get("threatScore", 0))
    intention_score = _dominant_intention_score(upstream_threat)
    targets: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for source_key, target_type, score_keys in SOURCE_SPECS:
        items = upstream_threat.get(source_key) or []
        if not isinstance(items, list):
            continue
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            target = _target_from_item(
                item,
                source_key=source_key,
                target_type=target_type,
                index=index,
                score_keys=score_keys,
                overall_threat_score=overall,
                intention_score=intention_score,
                validation_mode=validation_mode,
                preference=preference,
            )
            if target["id"] in seen_ids:
                target["id"] = f"{target['id']}-{len(seen_ids) + 1}"
            _append_unique_target(targets, target, seen_ids, seen_names)

    for index, item in enumerate(upstream_threat.get("targetAssessments") or [], start=1):
        if not isinstance(item, dict):
            continue
        target = _target_from_item(
            item,
            source_key="targetAssessments",
            target_type="assessed-target",
            index=index,
            score_keys=("threatScore", "valueScore", "score"),
            overall_threat_score=overall,
            intention_score=intention_score,
            validation_mode=validation_mode,
            preference=preference,
        )
        _append_unique_target(targets, target, seen_ids, seen_names)
    return annotate_targets_with_deployment_contexts(
        sorted(targets, key=lambda item: item["compositePriority"], reverse=True),
        deployment_contexts or [],
    )


def _role_from_text(text: str) -> str | None:
    lower = text.lower()
    if any(token in lower for token in ("recon", "侦察", "预警", "sensor")):
        return "recon"
    if any(token in lower for token in ("support", "sustain", "保障", "command", "指挥", "通信")):
        return "support"
    if any(token in lower for token in ("cover", "fire", "support_fire", "掩护", "压制", "火力")):
        return "cover"
    if any(token in lower for token in ("mobility", "机动", "快速", "突击机动")):
        return "mobility"
    if any(token in lower for token in ("protect", "防护", "防空")):
        return "protection"
    if any(token in lower for token in ("strike", "main", "attack", "主攻", "突击", "打击")):
        return "strike"
    return None


def normalize_group_role(group: dict[str, Any]) -> str:
    composition = group.get("roleComposition") or {}
    if isinstance(composition, dict) and composition:
        dominant = max(composition.items(), key=lambda item: safe_number(item[1], 0))[0]
        role = _role_from_text(str(dominant))
        if role:
            return role
    role_text = " ".join(str(group.get(key) or "") for key in ("role", "name"))
    role = _role_from_text(role_text)
    if role:
        return role
    for unit in group.get("units") or []:
        if isinstance(unit, dict):
            role = _role_from_text(f"{unit.get('role', '')} {unit.get('category', '')} {unit.get('name', '')}")
            if role:
                return role
    return "support"


def _group_location(group: dict[str, Any]) -> list[float] | None:
    direct = first_coordinates(group, COORDINATE_KEYS)
    if direct:
        return direct
    unit_locations = []
    for unit in group.get("units") or []:
        if not isinstance(unit, dict):
            continue
        location = first_coordinates(unit, COORDINATE_KEYS)
        if location:
            unit_locations.append(location)
    if not unit_locations:
        return None
    return [
        round(average([item[0] for item in unit_locations]), 6),
        round(average([item[1] for item in unit_locations]), 6),
        round(average([item[2] for item in unit_locations]), 2),
    ]


def _readiness_score(group: dict[str, Any]) -> float:
    if group.get("readinessScore") is not None:
        return clamp_score(group.get("readinessScore"))
    scores = []
    for unit in group.get("units") or []:
        if not isinstance(unit, dict):
            continue
        readiness = unit.get("readiness")
        if unit.get("readinessScore") is not None:
            scores.append(clamp_score(unit.get("readinessScore")))
        elif isinstance(readiness, dict):
            scores.append(clamp_score(readiness.get("readinessScore") or 70))
        else:
            scores.append(70.0)
    return average(scores, 70.0)


def _group_metric(group: dict[str, Any], key: str, fallback_unit_key: str | None = None) -> float:
    if group.get(key) is not None:
        return clamp_score(group.get(key))
    values = []
    unit_key = fallback_unit_key or key
    for unit in group.get("units") or []:
        if not isinstance(unit, dict):
            continue
        capabilities = unit.get("capabilities") or {}
        if isinstance(capabilities, dict):
            values.append(clamp_score(capabilities.get(unit_key)))
    return average(values, 55.0)


def _engagement_range_km(*, firepower: float, role: str) -> float:
    role_bonus = {
        "strike": 8.0,
        "cover": 7.0,
        "protection": 5.0,
        "recon": 2.0,
        "mobility": 2.0,
        "support": 0.0,
    }.get(role, 0.0)
    return round(22 + firepower * 0.65 + role_bonus, 2)


def build_group_profiles(upstream_grouping: dict[str, Any], *, max_assignments_per_group: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    scheme = upstream_grouping.get("preferredScheme") or upstream_grouping.get("systemBestScheme") or upstream_grouping
    source_groups = scheme.get("groups") if isinstance(scheme, dict) else []
    if not isinstance(source_groups, list):
        source_groups = []
    groups: list[dict[str, Any]] = []
    platforms: list[dict[str, Any]] = []
    for index, group in enumerate(source_groups, start=1):
        if not isinstance(group, dict):
            continue
        group_id = str(group.get("id") or f"group-{index}")
        role = normalize_group_role(group)
        location = _group_location(group)
        firepower = _group_metric(group, "firepower")
        protection = _group_metric(group, "protection")
        recon_coverage = _group_metric(group, "reconCoverage", "recon")
        endurance = _group_metric(group, "endurance", "support")
        mobility = _group_metric(group, "mobility")
        profile = {
            "id": group_id,
            "name": str(group.get("name") or f"作战编组{index}"),
            "role": str(group.get("role") or role),
            "normalizedRole": role,
            "unitCount": int(safe_number(group.get("unitCount"), len(group.get("units") or []))),
            "totalStrength": round(safe_number(group.get("totalStrength"), 0), 2),
            "firepower": firepower,
            "protection": protection,
            "reconCoverage": recon_coverage,
            "endurance": endurance,
            "mobility": mobility,
            "readinessScore": _readiness_score(group),
            "roleComposition": group.get("roleComposition") or {},
            "categories": list(group.get("categories") or []),
            "units": list(group.get("units") or []),
            "coordinates": location,
            "maxAssignments": max_assignments_per_group,
            "engagementRangeKm": _engagement_range_km(firepower=firepower, role=role),
        }
        platform = {
            "id": f"platform-{slugify(group_id, str(index))}",
            "name": profile["name"],
            "role": role,
            "category": "group",
            "groupId": group_id,
            "groupName": profile["name"],
            "firepower": profile["firepower"],
            "protection": profile["protection"],
            "reconCoverage": profile["reconCoverage"],
            "endurance": profile["endurance"],
            "mobility": profile["mobility"],
            "readinessScore": profile["readinessScore"],
            "coordinates": normalize_coordinates(location),
            "engagementRangeKm": profile["engagementRangeKm"],
            "maxAssignments": max_assignments_per_group,
        }
        profile["platformId"] = platform["id"]
        profile["platformName"] = platform["name"]
        groups.append(profile)
        platforms.append(platform)
    return groups, platforms
