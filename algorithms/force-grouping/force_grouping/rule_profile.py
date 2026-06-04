"""Rule libraries, scheme profiles, and dynamic weight resolution."""

from __future__ import annotations

from typing import Any

from .schemas import SchemeProfile, ThreatContext
from .utils import clamp


RULE_LIBRARIES: dict[str, dict[str, Any]] = {
    "fire-strike-rules": {
        "key": "fire-strike-rules",
        "label": "火力打击任务编组规则",
        "description": "强调主攻火力、压制支援、侦察预警与保障协同。",
        "baseWeights": {
            "firepower": 0.32,
            "protection": 0.20,
            "recon": 0.16,
            "support": 0.18,
            "mobility": 0.08,
            "balance": 0.06,
        },
    },
    "air-assault-rules": {
        "key": "air-assault-rules",
        "label": "机降突击任务编组规则",
        "description": "强调机动投送、侦察引导、着陆掩护与保障救护。",
        "baseWeights": {
            "firepower": 0.24,
            "protection": 0.18,
            "recon": 0.14,
            "support": 0.14,
            "mobility": 0.22,
            "balance": 0.08,
        },
    },
}

CONSTRAINT_MODEL = {
    "key": "baseline-constraints",
    "label": "基础编组约束",
    "description": "检查功能群完整性、关键角色覆盖、威胁适配能力与兵力负载均衡。",
}

SCHEME_PROFILES: dict[str, SchemeProfile] = {
    "scheme-balanced-intelligent": SchemeProfile(
        key="scheme-balanced-intelligent",
        label="均衡协同方案",
        comparisonFocus="balanced",
        description="兼顾火力、侦察、保障、机动和组间均衡。",
        weights={"firepower": 1.0, "protection": 1.0, "recon": 1.0, "support": 1.0, "mobility": 1.0, "balance": 1.22},
    ),
    "scheme-firepower-priority": SchemeProfile(
        key="scheme-firepower-priority",
        label="火力优先方案",
        comparisonFocus="firepower-first",
        description="优先保证主攻和压制火力能力。",
        weights={"firepower": 1.35, "protection": 0.92, "recon": 0.95, "support": 0.9, "mobility": 0.9, "balance": 0.82},
    ),
    "scheme-survivability-priority": SchemeProfile(
        key="scheme-survivability-priority",
        label="生存优先方案",
        comparisonFocus="survivability-first",
        description="优先保证防护、机动、掩护和分散部署。",
        weights={"firepower": 0.9, "protection": 1.28, "recon": 1.05, "support": 1.12, "mobility": 1.2, "balance": 1.08},
    ),
}


def resolve_scheme_profile(scheme_profile_key: str | None, comparison_focus: str | None = None) -> SchemeProfile:
    if scheme_profile_key in SCHEME_PROFILES:
        return SCHEME_PROFILES[scheme_profile_key]
    focus_map = {
        "balanced": "scheme-balanced-intelligent",
        "firepower-first": "scheme-firepower-priority",
        "survivability-first": "scheme-survivability-priority",
    }
    return SCHEME_PROFILES[focus_map.get(comparison_focus or "", "scheme-balanced-intelligent")]


def resolve_rule_profile(rule_library_key: str, scheme_profile: SchemeProfile, threat: ThreatContext, actual_group_count: int) -> dict[str, Any]:
    library = RULE_LIBRARIES.get(rule_library_key) or RULE_LIBRARIES["fire-strike-rules"]
    weights = dict(library["baseWeights"])
    threat_adjustments: list[dict[str, Any]] = []
    comparison_adjustments: list[dict[str, Any]] = []

    for key, multiplier in scheme_profile.weights.items():
        old = weights.get(key, 0.0)
        weights[key] = old * multiplier
        if abs(multiplier - 1.0) > 0.01:
            comparison_adjustments.append(
                {"metric": key, "multiplier": round(multiplier, 2), "reason": scheme_profile.label}
            )

    dominant = threat.dominantThreats
    if dominant.get("fireCoverage", 0) >= 65:
        weights["protection"] += 0.04
        weights["mobility"] += 0.03
        threat_adjustments.append({"metric": "protection/mobility", "reason": "敌方火力覆盖压力较高"})
    if dominant.get("airDefense", 0) >= 65 and library["key"] == "air-assault-rules":
        weights["recon"] += 0.04
        weights["protection"] += 0.04
        weights["mobility"] += 0.03
        threat_adjustments.append({"metric": "recon/protection/mobility", "reason": "敌方防空体系压力较高"})
    if dominant.get("recon", 0) >= 60:
        weights["mobility"] += 0.03
        weights["balance"] += 0.03
        threat_adjustments.append({"metric": "mobility/balance", "reason": "敌方侦察预警压力较高"})
    if dominant.get("antiAirborne", 0) >= 55:
        weights["support"] += 0.03
        weights["firepower"] += 0.02
        threat_adjustments.append({"metric": "support/firepower", "reason": "敌方反机降设施影响较强"})

    total = sum(weights.values()) or 1.0
    normalized = {key: round(clamp(value / total, 0, 1), 4) for key, value in weights.items()}
    blueprints = build_group_blueprints(library["key"], scheme_profile.key, actual_group_count)
    return {
        "key": library["key"],
        "label": library["label"],
        "description": library["description"],
        "weightSummary": normalized,
        "mainSignals": [
            "上游敌情威胁",
            scheme_profile.label,
            "我方兵力池能力分布",
            "基础编组约束",
        ],
        "threatAdjustments": threat_adjustments,
        "comparisonFocusAdjustments": comparison_adjustments,
        "groupBlueprints": blueprints,
    }


def build_group_blueprints(rule_key: str, scheme_profile_key: str, count: int) -> list[dict[str, Any]]:
    if rule_key == "air-assault-rules":
        base = [
            ("air-assault-main", "机降突击群", "main_strike", ["strike", "mobility"], {"mobility": 45, "firepower": 62}),
            ("air-mobility", "投送机动群", "mobility", ["mobility", "transport"], {"mobility": 60}),
            ("recon-guidance", "侦察引导群", "recon", ["recon", "command"], {"recon": 65}),
            ("landing-cover", "着陆掩护群", "cover", ["air-defense", "fire"], {"protection": 62}),
            ("landing-support", "保障救护群", "support", ["support", "medical", "engineering"], {"support": 60}),
            ("reserve", "预备机动群", "reserve", ["strike", "transport", "support"], {"mobility": 40}),
        ]
    else:
        base = [
            ("main-strike", "主攻火力群", "main_strike", ["fire", "strike"], {"firepower": 70}),
            ("support-fire", "支援压制群", "support_fire", ["fire", "air-defense"], {"firepower": 64, "protection": 55}),
            ("recon-command", "侦察指挥群", "recon", ["recon", "command"], {"recon": 62, "communication": 60}),
            ("cover-support", "掩护防护群", "cover", ["air-defense", "engineering"], {"protection": 62}),
            ("logistics-mobile", "保障机动群", "support", ["support", "transport", "medical"], {"support": 60}),
            ("reserve", "预备支援群", "reserve", ["strike", "support", "mobility"], {"mobility": 40}),
        ]
    selected = base[: max(1, min(count, len(base)))]
    return [
        {
            "id": f"blueprint-{code}",
            "name": name,
            "role": role,
            "preferredCategories": categories,
            "requiredCapabilities": required,
            "minUnitCount": 1,
            "maxUnitCount": 5,
            "priority": index + 1,
            "schemeProfileKey": scheme_profile_key,
        }
        for index, (code, name, role, categories, required) in enumerate(selected)
    ]
