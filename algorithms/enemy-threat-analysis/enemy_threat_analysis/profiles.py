"""Option profiles and scoring constants."""

from __future__ import annotations

from typing import Any


ANALYSIS_FOCUS_ALIASES = {
    "comprehensive": "comprehensive",
    "综合敌情": "comprehensive",
    "coverage": "coverage",
    "fire-coverage": "coverage",
    "火力覆盖优先": "coverage",
    "air-defense": "air-defense",
    "air_defense": "air-defense",
    "防空体系优先": "air-defense",
}

HEATMAP_DENSITY_ALIASES = {
    "low": "low",
    "低": "low",
    "medium": "medium",
    "中": "medium",
    "high": "high",
    "高": "high",
}

IMPACT_BIAS_ALIASES = {
    "balanced": "balanced",
    "均衡": "balanced",
    "suppression": "suppression",
    "压制优先": "suppression",
    "mobility": "mobility",
    "机动优先": "mobility",
}

ANALYSIS_FOCUS_PROFILES = {
    "comprehensive": {
        "fireWeight": 1.0,
        "airDefenseWeight": 1.0,
        "reconWeight": 0.9,
        "mobilityWeight": 0.8,
        "commandWeight": 0.9,
        "logisticsWeight": 0.7,
        "fortificationWeight": 0.8,
    },
    "coverage": {
        "fireWeight": 1.35,
        "airDefenseWeight": 0.9,
        "reconWeight": 0.8,
        "mobilityWeight": 0.8,
        "commandWeight": 0.75,
        "logisticsWeight": 0.55,
        "fortificationWeight": 0.8,
    },
    "air-defense": {
        "fireWeight": 0.85,
        "airDefenseWeight": 1.4,
        "reconWeight": 1.1,
        "mobilityWeight": 0.7,
        "commandWeight": 0.85,
        "logisticsWeight": 0.55,
        "fortificationWeight": 0.75,
    },
}

HEATMAP_DENSITY_PROFILES = {
    "low": {"gridSize": 40, "maxSamplePoints": 1600, "cellMeters": 1000, "kernelScale": 1.3},
    "medium": {"gridSize": 80, "maxSamplePoints": 6400, "cellMeters": 500, "kernelScale": 1.0},
    "high": {"gridSize": 140, "maxSamplePoints": 19600, "cellMeters": 250, "kernelScale": 0.8},
}

IMPACT_BIAS_PROFILES = {
    "balanced": {"suppressionWeight": 1.0, "mobilityWeight": 1.0, "survivabilityWeight": 1.0},
    "suppression": {"suppressionWeight": 1.3, "mobilityWeight": 0.85, "survivabilityWeight": 1.0},
    "mobility": {"suppressionWeight": 0.85, "mobilityWeight": 1.3, "survivabilityWeight": 1.1},
}

CATEGORY_BASE_THREAT = {
    "fire_unit": 0.90,
    "air_defense": 0.95,
    "recon_sensor": 0.75,
    "command_control": 0.65,
    "mobility_unit": 0.70,
    "logistics_support": 0.45,
    "fortification": 0.60,
    "electronic_warfare": 0.70,
    "unknown": 0.50,
}

CATEGORY_BASE_VALUE = {
    "command_control": 0.95,
    "air_defense": 0.90,
    "fire_unit": 0.85,
    "recon_sensor": 0.80,
    "logistics_support": 0.75,
    "mobility_unit": 0.70,
    "electronic_warfare": 0.75,
    "fortification": 0.65,
    "unknown": 0.50,
}

CATEGORY_SPATIAL_WEIGHT = {
    "fire_unit": 1.0,
    "air_defense": 1.0,
    "recon_sensor": 0.75,
    "command_control": 0.45,
    "mobility_unit": 0.7,
    "logistics_support": 0.35,
    "fortification": 0.65,
    "electronic_warfare": 0.7,
    "unknown": 0.4,
}

KNOWN_CATEGORIES = set(CATEGORY_BASE_THREAT)


def normalize_choice(value: Any, aliases: dict[str, str], fallback: str) -> str:
    text = str(value or "").strip()
    return aliases.get(text, aliases.get(text.lower(), fallback))


def normalize_options(
    analysis_focus: Any = "comprehensive",
    heatmap_density: Any = "medium",
    impact_bias: Any = "balanced",
) -> dict[str, str]:
    return {
        "analysisFocus": normalize_choice(analysis_focus, ANALYSIS_FOCUS_ALIASES, "comprehensive"),
        "heatmapDensity": normalize_choice(heatmap_density, HEATMAP_DENSITY_ALIASES, "medium"),
        "impactBias": normalize_choice(impact_bias, IMPACT_BIAS_ALIASES, "balanced"),
    }


def focus_profile(key: str) -> dict[str, float]:
    return dict(ANALYSIS_FOCUS_PROFILES.get(key, ANALYSIS_FOCUS_PROFILES["comprehensive"]))


def heatmap_profile(key: str) -> dict[str, int | float]:
    return dict(HEATMAP_DENSITY_PROFILES.get(key, HEATMAP_DENSITY_PROFILES["medium"]))


def impact_bias_profile(key: str) -> dict[str, float]:
    return dict(IMPACT_BIAS_PROFILES.get(key, IMPACT_BIAS_PROFILES["balanced"]))
