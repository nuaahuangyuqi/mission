"""Spatial point threat calculation."""

from __future__ import annotations

import math
from typing import Any, Sequence

from .profiles import CATEGORY_SPATIAL_WEIGHT, focus_profile, impact_bias_profile
from .utils import clamp, haversine_distance_m, resolve_level, round_float


INFERRED_RADIUS_BY_CATEGORY = {
    "fire_unit": 35_000.0,
    "air_defense": 45_000.0,
    "recon_sensor": 55_000.0,
    "command_control": 12_000.0,
    "mobility_unit": 18_000.0,
    "logistics_support": 8_000.0,
    "fortification": 12_000.0,
    "electronic_warfare": 35_000.0,
    "unknown": 8_000.0,
}


def compute_point_threat(
    point: dict[str, Any],
    target_assessments: Sequence[dict[str, Any]],
    *,
    analysis_focus: str,
    impact_bias: str,
) -> dict[str, Any]:
    focus = focus_profile(analysis_focus)
    bias = impact_bias_profile(impact_bias)
    coordinates = point["coordinates"]
    raw_threat = 0.0
    contributors: list[dict[str, Any]] = []

    for target in target_assessments:
        target_coordinates = target.get("location", {}).get("coordinates")
        if not target_coordinates:
            continue
        radius = float(target.get("coverage", {}).get("radiusMeters") or 0.0)
        if radius <= 0:
            radius = infer_radius_by_category(target.get("category", "unknown"))
        if radius <= 0:
            continue

        distance = haversine_distance_m(coordinates, target_coordinates)
        decay = compute_distance_decay(distance, radius)
        mask = compute_coverage_mask(distance, radius)
        spatial_weight = get_category_spatial_weight(target.get("category", "unknown"), focus)
        confidence = float(target.get("confidenceScore", 60.0)) / 100.0
        contribution = (
            float(target.get("threatScore", 0.0))
            * spatial_weight
            * decay
            * mask
            * (0.4 + 0.6 * clamp(confidence, 0.0, 1.0))
        )
        if contribution > 0.1:
            contributors.append(
                {
                    "targetId": target.get("id"),
                    "targetName": target.get("name"),
                    "category": target.get("category"),
                    "distanceMeters": int(round(distance)),
                    "contribution": round_float(contribution, 2),
                }
            )
        raw_threat += contribution

    stacked = apply_stacking_function(raw_threat)
    biased = apply_impact_bias(stacked, contributors, bias)
    score = round_float(clamp(biased, 0.0, 100.0), 2)
    return {
        "point": point,
        "threatScore": score,
        "threatLevel": resolve_level(score),
        "topContributors": sorted(contributors, key=lambda item: item["contribution"], reverse=True)[:5],
    }


def infer_radius_by_category(category: str) -> float:
    return float(INFERRED_RADIUS_BY_CATEGORY.get(category, INFERRED_RADIUS_BY_CATEGORY["unknown"]))


def compute_distance_decay(distance_meters: float, radius_meters: float, alpha: float = 2.2) -> float:
    if radius_meters <= 0:
        return 0.0
    return math.exp(-alpha * distance_meters / radius_meters)


def compute_coverage_mask(distance_meters: float, radius_meters: float) -> float:
    if radius_meters <= 0:
        return 0.0
    if distance_meters <= radius_meters:
        return 1.0
    overflow = distance_meters - radius_meters
    soft_margin = radius_meters * 0.2
    if overflow > soft_margin:
        return 0.0
    return 1.0 - overflow / soft_margin


def get_category_spatial_weight(category: str, focus: dict[str, float]) -> float:
    base = CATEGORY_SPATIAL_WEIGHT.get(category, CATEGORY_SPATIAL_WEIGHT["unknown"])
    if category == "fire_unit":
        return base * focus["fireWeight"]
    if category == "air_defense":
        return base * focus["airDefenseWeight"]
    if category == "recon_sensor":
        return base * focus["reconWeight"]
    if category == "mobility_unit":
        return base * focus["mobilityWeight"]
    if category == "fortification":
        return base * focus["fortificationWeight"]
    return base


def apply_stacking_function(raw_threat: float) -> float:
    return 100.0 * (1.0 - math.exp(-max(raw_threat, 0.0) / 100.0))


def apply_impact_bias(
    stacked_threat: float,
    contributors: Sequence[dict[str, Any]],
    bias: dict[str, float],
) -> float:
    categories = {item.get("category") for item in contributors[:5]}
    factor = 1.0
    if categories & {"fire_unit", "air_defense", "electronic_warfare"}:
        factor *= bias["suppressionWeight"]
    if categories & {"mobility_unit", "fortification"}:
        factor *= bias["mobilityWeight"]
    return stacked_threat * clamp(factor, 0.75, 1.25)
