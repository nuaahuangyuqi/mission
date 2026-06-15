"""Configuration profiles for intelligent target allocation."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .utils import clamp, clamp_score


METHOD_KEY = "intelligent-allocation"
METHOD_LABEL = "智能分配算法"
PLAN_ID = "plan-intelligent-allocation"

DEFAULT_OBJECTIVE_PREFERENCE = "balanced"
DEFAULT_VALIDATION_MODE = "strict"
DEFAULT_MAX_ASSIGNMENTS_PER_GROUP = 2

OBJECTIVE_PREFERENCES = {
    "balanced": {
        "key": "balanced",
        "label": "均衡",
        "weights": {
            "capabilityFit": 0.30,
            "roleFit": 0.15,
            "priority": 0.20,
            "feasibility": 0.15,
            "loadFlexibility": 0.15,
            "distanceRisk": 0.05,
        },
        "capabilityBoost": {},
    },
    "firepower-first": {
        "key": "firepower-first",
        "label": "火力优先",
        "weights": {
            "capabilityFit": 0.35,
            "roleFit": 0.15,
            "priority": 0.25,
            "feasibility": 0.10,
            "loadFlexibility": 0.10,
            "distanceRisk": 0.05,
        },
        "capabilityBoost": {"firepower": 0.12},
    },
    "survivability-first": {
        "key": "survivability-first",
        "label": "生存优先",
        "weights": {
            "capabilityFit": 0.20,
            "roleFit": 0.00,
            "priority": 0.10,
            "feasibility": 0.25,
            "loadFlexibility": 0.10,
            "distanceRisk": 0.15,
            "protection": 0.20,
        },
        "capabilityBoost": {"protection": 0.08, "mobility": 0.04, "endurance": 0.04},
    },
}

VALIDATION_PROFILES = {
    "strict": {
        "key": "strict",
        "label": "严格",
        "minMatchScore": 52.0,
        "minFeasibilityScore": 50.0,
        "lowQualityMatchScore": 60.0,
        "maxReachUtilization": 1.05,
        "requirePriorityFullCoverage": True,
        "allowPartialPriorityCoverage": False,
    },
    "standard": {
        "key": "standard",
        "label": "标准",
        "minMatchScore": 42.0,
        "minFeasibilityScore": 38.0,
        "lowQualityMatchScore": 50.0,
        "maxReachUtilization": 1.25,
        "requirePriorityFullCoverage": False,
        "allowPartialPriorityCoverage": True,
    },
}

TARGET_TYPE_PROFILES = {
    "air-defense": {
        "typeLabel": "防空节点",
        "baseImportance": 85.0,
        "baseDifficulty": 72.0,
        "preferredRoles": ["strike", "cover", "recon"],
        "capabilityWeights": {
            "firepower": 0.35,
            "protection": 0.20,
            "reconCoverage": 0.20,
            "endurance": 0.10,
            "mobility": 0.15,
        },
        "wave": 1,
    },
    "fire-coverage": {
        "typeLabel": "火力覆盖",
        "baseImportance": 80.0,
        "baseDifficulty": 68.0,
        "preferredRoles": ["strike", "cover", "mobility"],
        "capabilityWeights": {
            "firepower": 0.40,
            "protection": 0.20,
            "reconCoverage": 0.10,
            "endurance": 0.10,
            "mobility": 0.20,
        },
        "wave": 1,
    },
    "recon-warning": {
        "typeLabel": "侦察预警",
        "baseImportance": 72.0,
        "baseDifficulty": 58.0,
        "preferredRoles": ["recon", "mobility", "strike"],
        "capabilityWeights": {
            "firepower": 0.20,
            "protection": 0.10,
            "reconCoverage": 0.40,
            "endurance": 0.10,
            "mobility": 0.20,
        },
        "wave": 1,
    },
    "anti-airborne": {
        "typeLabel": "反机降设施",
        "baseImportance": 70.0,
        "baseDifficulty": 62.0,
        "preferredRoles": ["strike", "mobility", "cover"],
        "capabilityWeights": {
            "firepower": 0.30,
            "protection": 0.20,
            "reconCoverage": 0.15,
            "endurance": 0.10,
            "mobility": 0.25,
        },
        "wave": 2,
    },
    "assessed-target": {
        "typeLabel": "评估目标",
        "baseImportance": 68.0,
        "baseDifficulty": 55.0,
        "preferredRoles": ["strike", "cover", "recon"],
        "capabilityWeights": {
            "firepower": 0.32,
            "protection": 0.16,
            "reconCoverage": 0.18,
            "endurance": 0.12,
            "mobility": 0.22,
        },
        "wave": 2,
    },
}


def resolve_objective_preference(key: str | None) -> dict[str, Any]:
    profile = OBJECTIVE_PREFERENCES.get(key or "") or OBJECTIVE_PREFERENCES[DEFAULT_OBJECTIVE_PREFERENCE]
    return deepcopy(profile)


def resolve_validation_profile(key: str | None) -> dict[str, Any]:
    profile = VALIDATION_PROFILES.get(key or "") or VALIDATION_PROFILES[DEFAULT_VALIDATION_MODE]
    return deepcopy(profile)


def normalize_max_assignments(value: object) -> int:
    try:
        requested = int(value)
    except (TypeError, ValueError):
        requested = DEFAULT_MAX_ASSIGNMENTS_PER_GROUP
    return int(clamp(requested, 1, 6))


def boosted_capability_weights(target_weights: dict[str, float], preference: dict[str, Any]) -> dict[str, float]:
    weights = dict(target_weights)
    for key, boost in (preference.get("capabilityBoost") or {}).items():
        weights[key] = weights.get(key, 0.0) + float(boost)
    total = sum(max(value, 0.0) for value in weights.values()) or 1.0
    return {key: max(value, 0.0) / total for key, value in weights.items()}


def priority_level(importance: float) -> str:
    if importance >= 80:
        return "一级"
    if importance >= 65:
        return "二级"
    return "三级"


def required_group_count(target_type: str, importance: float, validation_mode: str) -> int:
    strict = validation_mode == "strict"
    if importance >= 88 and target_type in {"air-defense", "fire-coverage"}:
        return 3 if strict else 2
    if importance >= 80:
        return 2
    if importance >= 68 and target_type in {"air-defense", "fire-coverage", "recon-warning"}:
        return 2 if strict else 1
    return 1


def clamp_target_score(value: float) -> float:
    return clamp_score(value)
