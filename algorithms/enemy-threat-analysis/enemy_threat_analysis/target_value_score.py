"""Single-target value scoring and priority scoring."""

from __future__ import annotations

from typing import Any, Sequence

from .profiles import CATEGORY_BASE_VALUE, impact_bias_profile
from .schemas import ExtractedTarget, Relation
from .utils import clamp, clamp01, resolve_level, round_float


IMPORTANT_RELATIONS = {"commands", "protects", "supports", "coordinates"}


def compute_target_value(target: ExtractedTarget, relations: Sequence[Relation]) -> dict[str, Any]:
    category_base = CATEGORY_BASE_VALUE.get(target.category, CATEGORY_BASE_VALUE["unknown"])
    mission = 0.5 + 0.5 * clamp01(target.importance.missionRelevance, 0.5)
    centrality_raw = max(clamp01(target.importance.systemCentrality, 0.5), compute_system_centrality(target, relations))
    centrality = 0.45 + 0.55 * centrality_raw
    replaceability = 0.5 + 0.5 * (1.0 - clamp01(target.importance.replaceability, 0.5))
    support = 0.65 + 0.35 * clamp01(target.importance.supportDependency, 0.5)
    confidence = 0.4 + 0.6 * clamp01(target.confidence.overallConfidence, 0.6)
    raw = category_base * mission * centrality * replaceability * support * confidence
    score = round_float(clamp(raw * 100.0, 0.0, 100.0), 2)
    breakdown = {
        "categoryBaseValue": round_float(category_base, 4),
        "missionRelevance": round_float(mission, 4),
        "systemCentrality": round_float(centrality_raw, 4),
        "replaceabilityFactor": round_float(replaceability, 4),
        "supportDependency": round_float(support, 4),
        "confidenceFactor": round_float(confidence, 4),
    }
    return {
        "id": target.id,
        "name": target.name,
        "valueScore": score,
        "valueLevel": resolve_level(score),
        "valueBreakdown": breakdown,
        "dominantValueFactors": dominant_value_factors(target, relations, breakdown),
    }


def compute_system_centrality(target: ExtractedTarget, relations: Sequence[Relation]) -> float:
    related = [
        relation
        for relation in relations
        if relation.sourceTargetId == target.id or relation.targetTargetId == target.id
    ]
    degree_score = clamp(len(related) / 6.0, 0.0, 1.0)
    relation_bonus = 0.2 if any(relation.type in IMPORTANT_RELATIONS for relation in related) else 0.0
    return clamp(degree_score + relation_bonus, 0.0, 1.0)


def compute_priority_score(
    *,
    threat_score: float,
    value_score: float,
    confidence_score: float,
    mobility_impact: float,
    impact_bias: str,
) -> float:
    if impact_bias == "suppression":
        score = 0.65 * threat_score + 0.25 * value_score + 0.10 * confidence_score
    elif impact_bias == "mobility":
        score = (
            0.45 * threat_score
            + 0.25 * value_score
            + 0.20 * mobility_impact
            + 0.10 * confidence_score
        )
    else:
        score = 0.55 * threat_score + 0.35 * value_score + 0.10 * confidence_score
    return round_float(clamp(score, 0.0, 100.0), 2)


def dominant_value_factors(
    target: ExtractedTarget,
    relations: Sequence[Relation],
    breakdown: dict[str, float],
) -> list[str]:
    factors: list[str] = []
    if target.importance.missionRelevance >= 0.7:
        factors.append("具备较强任务相关性")
    if compute_system_centrality(target, relations) >= 0.45:
        factors.append("处于敌方体系关系链关键位置")
    if target.importance.replaceability <= 0.35:
        factors.append("可替代性较低")
    if target.category in {"command_control", "air_defense", "fire_unit"}:
        factors.append("类别基础价值较高")
    if breakdown.get("confidenceFactor", 0) >= 0.8:
        factors.append("价值判断置信度较高")
    return factors[:5] or ["具备基础体系价值"]
