"""Scoring functions for group-target allocation candidates."""

from __future__ import annotations

from typing import Any

from .utils import clamp, clamp_score, haversine_km, weighted_sum


ROLE_COMPLEMENTS = {
    "strike": {"cover": 76, "recon": 72, "mobility": 68, "support": 58, "protection": 64},
    "cover": {"strike": 76, "recon": 68, "mobility": 62, "support": 60, "protection": 66},
    "recon": {"strike": 72, "cover": 68, "mobility": 78, "support": 62, "protection": 58},
    "mobility": {"strike": 68, "cover": 62, "recon": 78, "support": 62, "protection": 60},
    "support": {"strike": 58, "cover": 60, "recon": 62, "mobility": 62, "protection": 58},
    "protection": {"strike": 64, "cover": 66, "recon": 58, "mobility": 60, "support": 58},
}


def role_fit_score(group_role: str, target: dict[str, Any], existing_roles: list[str] | None = None) -> float:
    preferred = set(target.get("preferredRoles") or [])
    if group_role in preferred:
        base = 92.0
    else:
        base = max((ROLE_COMPLEMENTS.get(group_role, {}).get(role, 54) for role in preferred), default=54)
    if existing_roles and group_role not in existing_roles:
        base += 5.0
    if group_role == "support" and target.get("priorityLevel") == "一级":
        base -= 8.0
    return clamp_score(base)


def _travel_tolerance_hours(target: dict[str, Any], validation_profile: dict[str, Any]) -> float:
    wave = assignment_wave(target)
    strict = validation_profile.get("key") == "strict"
    if wave == 1:
        return 1.0 if strict else 1.35
    if wave == 2:
        return 2.0 if strict else 2.6
    return 3.5 if strict else 4.5


def distance_risk_score(
    group: dict[str, Any],
    target: dict[str, Any],
    validation_profile: dict[str, Any],
    *,
    route_start_coordinates: list[float] | None = None,
) -> tuple[float, float | None, float | None, str | None, float | None, float | None]:
    start_coordinates = route_start_coordinates or group.get("coordinates")
    distance_km = haversine_km(start_coordinates, target.get("coordinates"))
    if distance_km is None:
        return 72.0, None, None, "缺少目标或编组坐标，空间机动响应因素按中性分处理。", None, None
    range_km = max(float(group.get("engagementRangeKm") or 1.0), 1.0)
    reach = round(distance_km / range_km, 3)
    max_reach = float(validation_profile["maxReachUtilization"])
    if reach <= max_reach:
        reach_score = 100 - min(reach / max_reach, 1.0) * 26
    else:
        reach_score = 72 - min((reach - max_reach) * 56, 56)
    mobility_kph = float(group.get("mobility") or 0)
    if mobility_kph <= 0:
        distance_score = 100 - min(distance_km / 80, 1.0) * 38
        score = clamp_score(distance_score * 0.45 + reach_score * 0.35 + 72.0 * 0.20)
        return score, distance_km, reach, "缺少编组行进速度，空间机动响应按距离与射程折中评估。", None, None
    travel_hours = round(distance_km / max(mobility_kph, 1.0), 2)
    tolerance = _travel_tolerance_hours(target, validation_profile)
    travel_ratio = travel_hours / max(tolerance, 0.1)
    if travel_ratio <= 1:
        travel_score = 100 - travel_ratio * 34
    else:
        travel_score = 66 - min((travel_ratio - 1) * 38, 46)
    speed_score = clamp_score(mobility_kph)
    distance_score = 100 - min(distance_km / 90, 1.0) * 32
    score = clamp_score(travel_score * 0.50 + speed_score * 0.22 + reach_score * 0.18 + distance_score * 0.10)
    return score, distance_km, reach, None, travel_hours, mobility_kph


def terrain_context(
    group: dict[str, Any],
    target: dict[str, Any],
    terrain_sampler: Any | None,
    *,
    route_start_coordinates: list[float] | None = None,
) -> dict[str, Any]:
    if terrain_sampler is None:
        return {
            "status": "disabled",
            "sampleCount": 0,
            "sampledCount": 0,
            "averagePenalty": 0.0,
            "averageSlopeDeg": 0.0,
            "averageSpeedFactor": 1.0,
            "averageConcealmentBonus": 0.0,
            "note": "未启用地形采样。",
        }
    start = route_start_coordinates or group.get("coordinates")
    end = target.get("coordinates")
    if not start or not end:
        return {
            "status": "neutral",
            "sampleCount": 0,
            "sampledCount": 0,
            "averagePenalty": 0.0,
            "averageSlopeDeg": 0.0,
            "averageSpeedFactor": 1.0,
            "averageConcealmentBonus": 0.0,
            "note": "缺少编组或目标坐标，地形按中性处理。",
        }
    midpoint = [
        round((float(start[0]) + float(end[0])) / 2, 6),
        round((float(start[1]) + float(end[1])) / 2, 6),
        0.0,
    ]
    summary = terrain_sampler.sample_path([start, midpoint, end])
    summary["note"] = "地形采样成功。" if summary.get("sampledCount") else "未采到可用地形，按中性处理。"
    return summary


def capability_fit_score(group: dict[str, Any], target: dict[str, Any]) -> float:
    metrics = {
        "firepower": float(group.get("firepower") or 0),
        "protection": float(group.get("protection") or 0),
        "reconCoverage": float(group.get("reconCoverage") or 0),
        "endurance": float(group.get("endurance") or 0),
        "mobility": float(group.get("mobility") or 0),
    }
    return clamp_score(weighted_sum(metrics, target.get("capabilityWeights") or {}))


def load_flexibility_score(current_load: int, max_assignments: int) -> float:
    if max_assignments <= 0:
        return 0.0
    if current_load >= max_assignments:
        return 0.0
    return clamp_score(100 * (1 - current_load / max_assignments))


def feasibility_score(
    *,
    capability_fit: float,
    role_fit: float,
    mobility_response_score: float,
    group: dict[str, Any],
    target: dict[str, Any],
    preference_key: str,
) -> float:
    protection = float(group.get("protection") or 0)
    endurance = float(group.get("endurance") or 0)
    mobility = float(group.get("mobility") or 0)
    readiness = float(group.get("readinessScore") or 70)
    difficulty = float(target.get("difficulty") or 50)
    if preference_key == "survivability-first":
        value = (
            protection * 0.20
            + endurance * 0.12
            + mobility * 0.12
            + readiness * 0.16
            + capability_fit * 0.22
            + mobility_response_score * 0.14
            + role_fit * 0.06
            - difficulty * 0.08
        )
    else:
        value = (
            capability_fit * 0.32
            + mobility_response_score * 0.14
            + readiness * 0.16
            + endurance * 0.11
            + role_fit * 0.11
            + protection * 0.10
            + mobility * 0.06
            - difficulty * 0.08
        )
    return clamp_score(value)


def risk_exposure_score(group: dict[str, Any], target: dict[str, Any]) -> float:
    difficulty = float(target.get("difficulty") or 50)
    protection_gap = max(0.0, 100.0 - float(group.get("protection") or 0))
    return clamp_score(difficulty * protection_gap / 100)


def score_candidate(
    group: dict[str, Any],
    target: dict[str, Any],
    *,
    current_load: int,
    existing_roles: list[str],
    preference: dict[str, Any],
    validation_profile: dict[str, Any],
    terrain_sampler: Any | None = None,
    route_start_coordinates: list[float] | None = None,
) -> dict[str, Any]:
    capability_fit = capability_fit_score(group, target)
    role_fit = role_fit_score(str(group.get("normalizedRole") or "support"), target, existing_roles)
    mobility_response, distance_km, reach, distance_note, estimated_travel_hours, mobility_kph = distance_risk_score(
        group,
        target,
        validation_profile,
        route_start_coordinates=route_start_coordinates,
    )
    terrain = terrain_context(group, target, terrain_sampler, route_start_coordinates=route_start_coordinates)
    terrain_penalty = float(terrain.get("averagePenalty") or 0.0)
    terrain_speed_factor = float(terrain.get("averageSpeedFactor") or 1.0)
    terrain_concealment_bonus = float(terrain.get("averageConcealmentBonus") or 0.0)
    if estimated_travel_hours is not None:
        estimated_travel_hours = round(estimated_travel_hours / max(terrain_speed_factor, 0.1), 2)
    mobility_response = clamp_score(mobility_response * terrain_speed_factor - terrain_penalty * 0.55)
    load_flex = load_flexibility_score(current_load, int(group.get("maxAssignments") or 1))
    feasibility = feasibility_score(
        capability_fit=capability_fit,
        role_fit=role_fit,
        mobility_response_score=mobility_response,
        group=group,
        target=target,
        preference_key=str(preference["key"]),
    )
    risk_exposure = clamp_score(risk_exposure_score(group, target) + terrain_penalty * 0.22 - terrain_concealment_bonus * 0.35)
    distance_risk = clamp_score(mobility_response * 0.64 + (100 - risk_exposure) * 0.36)
    weighted = 0.0
    components = {
        "capabilityFit": capability_fit,
        "roleFit": role_fit,
        "priority": float(target.get("importance") or 0),
        "feasibility": feasibility,
        "loadFlexibility": load_flex,
        "distanceRisk": distance_risk,
        "protection": float(group.get("protection") or 0),
        "mobilityResponse": mobility_response,
        "terrain": clamp_score(100 - terrain_penalty),
    }
    for key, weight in (preference.get("weights") or {}).items():
        weighted += components.get(key, 0.0) * float(weight)
    if preference["key"] == "firepower-first":
        weighted += float(group.get("firepower") or 0) * 0.04
    elif preference["key"] == "survivability-first":
        weighted -= risk_exposure * 0.05
    if target.get("priorityLevel") == "一级" and str(group.get("normalizedRole")) in {"strike", "cover", "recon"}:
        weighted += 2.0
    return {
        "groupId": group["id"],
        "targetId": target["id"],
        "routeStartCoordinates": route_start_coordinates or group.get("coordinates"),
        "routeEndCoordinates": target.get("coordinates"),
        "originDistanceKm": haversine_km(group.get("coordinates"), target.get("coordinates")),
        "matchScore": clamp_score(weighted),
        "feasibilityScore": feasibility,
        "capabilityFit": capability_fit,
        "roleFit": role_fit,
        "distanceScore": mobility_response,
        "mobilityResponseScore": mobility_response,
        "estimatedTravelHours": estimated_travel_hours,
        "mobilityKph": mobility_kph,
        "distanceKm": distance_km,
        "reachUtilization": reach,
        "loadFlexibility": load_flex,
        "riskExposure": risk_exposure,
        "distanceNote": distance_note,
        "terrain": terrain,
        "terrainPenalty": round(terrain_penalty, 2),
        "components": components,
    }


def candidate_is_acceptable(candidate: dict[str, Any], validation_profile: dict[str, Any], *, relaxed: bool = False) -> bool:
    match_threshold = float(validation_profile["minMatchScore"])
    feasibility_threshold = float(validation_profile["minFeasibilityScore"])
    if relaxed:
        match_threshold *= 0.82
        feasibility_threshold *= 0.82
    if candidate["matchScore"] < match_threshold:
        return False
    if candidate["feasibilityScore"] < feasibility_threshold:
        return False
    reach = candidate.get("reachUtilization")
    if reach is not None and reach > float(validation_profile["maxReachUtilization"]) * (1.08 if relaxed else 1.0):
        return False
    return True


def assignment_wave(target: dict[str, Any]) -> int:
    if target.get("type") in {"air-defense", "recon-warning"}:
        return 1
    if target.get("priorityLevel") == "一级":
        return 1
    if target.get("type") in {"fire-coverage", "anti-airborne"}:
        return 2
    return int(clamp(float(target.get("waveHint") or 3), 1, 3))
