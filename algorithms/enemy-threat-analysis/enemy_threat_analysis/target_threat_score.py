"""Single-target threat scoring."""

from __future__ import annotations

import math
from typing import Any

from .profiles import CATEGORY_BASE_THREAT, focus_profile
from .schemas import ExtractedTarget
from .utils import clamp, clamp01, resolve_level, round_float


STATUS_FACTOR = {
    "active": 1.0,
    "suspected": 0.8,
    "inactive": 0.45,
    "destroyed": 0.1,
    "unknown": 0.65,
}

CATEGORY_FOCUS_KEY = {
    "fire_unit": "fireWeight",
    "air_defense": "airDefenseWeight",
    "recon_sensor": "reconWeight",
    "command_control": "commandWeight",
    "mobility_unit": "mobilityWeight",
    "logistics_support": "logisticsWeight",
    "fortification": "fortificationWeight",
    "electronic_warfare": "reconWeight",
}


def compute_target_threat(target: ExtractedTarget, analysis_focus: str) -> dict[str, Any]:
    profile = focus_profile(analysis_focus)
    category_base = CATEGORY_BASE_THREAT.get(target.category, CATEGORY_BASE_THREAT["unknown"])
    capability = compute_capability_threat(target, profile)
    coverage = compute_coverage_factor(target)
    status = STATUS_FACTOR.get(target.status, STATUS_FACTOR["unknown"])
    confidence = compute_confidence_factor(target)
    focus = compute_focus_factor(target, profile)
    raw = category_base * capability * coverage * status * confidence * focus
    score = round_float(clamp(raw * 100.0, 0.0, 100.0), 2)
    breakdown = {
        "categoryBaseThreat": round_float(category_base, 4),
        "capabilityThreat": round_float(capability, 4),
        "coverageFactor": round_float(coverage, 4),
        "statusFactor": round_float(status, 4),
        "confidenceFactor": round_float(confidence, 4),
        "focusFactor": round_float(focus, 4),
    }
    return {
        "id": target.id,
        "name": target.name,
        "category": target.category,
        "threatScore": score,
        "threatLevel": resolve_level(score),
        "threatBreakdown": breakdown,
        "dominantThreatFactors": dominant_threat_factors(target, breakdown),
        "evidenceIds": [item.evidenceId for item in target.evidence if item.evidenceId],
    }


def compute_capability_threat(target: ExtractedTarget, profile: dict[str, float]) -> float:
    c = target.capabilities
    raw = (
        0.28 * clamp01(c.firepower) * profile["fireWeight"]
        + 0.24 * clamp01(c.airDefense) * profile["airDefenseWeight"]
        + 0.15 * clamp01(c.reconnaissance) * profile["reconWeight"]
        + 0.10 * clamp01(c.commandControl) * profile["commandWeight"]
        + 0.10 * clamp01(c.mobility) * profile["mobilityWeight"]
        + 0.08 * clamp01(c.protection)
        + 0.03 * clamp01(c.electronicWarfare)
        + 0.02 * clamp01(c.logistics) * profile["logisticsWeight"]
    )
    return clamp(raw, 0.05, 1.0)


def compute_coverage_factor(target: ExtractedTarget) -> float:
    radius = float(target.coverage.radiusMeters or 0.0)
    if not target.coverage.hasCoverage or radius <= 0:
        return 0.75
    max_expected_radius = 100_000.0
    normalized = math.log(1 + radius) / math.log(1 + max_expected_radius)
    return 0.6 + 0.4 * clamp(normalized, 0.0, 1.0)


def compute_confidence_factor(target: ExtractedTarget) -> float:
    return 0.4 + 0.6 * clamp01(target.confidence.overallConfidence, 0.6)


def compute_focus_factor(target: ExtractedTarget, profile: dict[str, float]) -> float:
    key = CATEGORY_FOCUS_KEY.get(target.category)
    return float(profile.get(key, 1.0)) if key else 1.0


def dominant_threat_factors(target: ExtractedTarget, breakdown: dict[str, float]) -> list[str]:
    factors: list[str] = []
    if target.capabilities.firepower >= 0.7:
        factors.append("火力能力较强")
    if target.capabilities.airDefense >= 0.7:
        factors.append("防空拦截能力较强")
    if target.capabilities.reconnaissance >= 0.65:
        factors.append("侦察预警能力较强")
    if target.coverage.radiusMeters >= 20_000:
        factors.append("覆盖半径较大")
    if breakdown.get("confidenceFactor", 0) >= 0.8:
        factors.append("抽取置信度较高")
    if not target.location.coordinates:
        factors.append("缺少有效坐标，空间影响需复核")
    return factors[:5] or ["基础威胁因子完整"]
