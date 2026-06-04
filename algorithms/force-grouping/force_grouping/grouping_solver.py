"""Generate multiple candidate grouping schemes under one selected profile."""

from __future__ import annotations

from typing import Any

from .evaluator import evaluate_scheme, unit_fit_score
from .schemas import ForceUnit, SchemeProfile, ThreatContext


VARIANT_DEFINITIONS = {
    "primary": {"suffix": "primary", "label": "主推荐型方案"},
    "distributed": {"suffix": "distributed", "label": "分散稳健型方案"},
    "reserve-supported": {"suffix": "reserve-supported", "label": "预备保障增强型方案"},
}


def _empty_groups(blueprints: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": blueprint["id"].replace("blueprint", "group"),
            "name": blueprint["name"],
            "role": blueprint["role"],
            "blueprint": blueprint,
            "_units": [],
            "_roleFit": 75.0,
            "_blueprintFit": 75.0,
        }
        for blueprint in blueprints
    ]


def _assign_primary(units: list[ForceUnit], groups: list[dict[str, Any]], weights: dict[str, float]) -> None:
    sorted_units = sorted(
        units,
        key=lambda unit: (
            unit.capabilities.get("firepower", 0) + unit.capabilities.get("protection", 0) + unit.capabilities.get("mobility", 0),
            unit.readiness.readinessScore,
        ),
        reverse=True,
    )
    for unit in sorted_units:
        best = max(groups, key=lambda group: unit_fit_score(unit, group["blueprint"], weights) - len(group["_units"]) * 3)
        best["_units"].append(unit)


def _assign_distributed(units: list[ForceUnit], groups: list[dict[str, Any]], weights: dict[str, float]) -> None:
    sorted_units = sorted(units, key=lambda unit: unit.strength + sum(unit.capabilities.values()) / 100, reverse=True)
    for unit in sorted_units:
        best = max(
            groups,
            key=lambda group: unit_fit_score(unit, group["blueprint"], weights) - sum(u.strength for u in group["_units"]) * 0.55 - len(group["_units"]) * 4,
        )
        best["_units"].append(unit)


def _assign_reserve_supported(units: list[ForceUnit], groups: list[dict[str, Any]], weights: dict[str, float]) -> None:
    reserve_group = groups[-1]
    reserve_roles = {"support", "mobility", "reserve"}
    sorted_units = sorted(units, key=lambda unit: unit.capabilities.get("support", 0) + unit.capabilities.get("mobility", 0), reverse=True)
    for unit in sorted_units:
        if unit.role in reserve_roles and len(reserve_group["_units"]) < max(1, len(units) // max(len(groups), 1)):
            reserve_group["_units"].append(unit)
            continue
        best = max(
            groups[:-1] or groups,
            key=lambda group: unit_fit_score(unit, group["blueprint"], weights) - len(group["_units"]) * 2,
        )
        best["_units"].append(unit)


def _repair_empty_groups(groups: list[dict[str, Any]], weights: dict[str, float]) -> None:
    for group in groups:
        if group["_units"]:
            continue
        donors = [candidate for candidate in groups if len(candidate["_units"]) > 1]
        if not donors:
            continue
        donor = max(donors, key=lambda item: len(item["_units"]))
        moved = max(donor["_units"], key=lambda unit: unit_fit_score(unit, group["blueprint"], weights))
        donor["_units"].remove(moved)
        group["_units"].append(moved)


def _stamp_fit(groups: list[dict[str, Any]], weights: dict[str, float]) -> None:
    for group in groups:
        if not group["_units"]:
            group["_roleFit"] = 0
            group["_blueprintFit"] = 0
            continue
        fits = [unit_fit_score(unit, group["blueprint"], weights) for unit in group["_units"]]
        group["_roleFit"] = round(sum(fits) / len(fits), 2)
        required = group["blueprint"].get("requiredCapabilities") or {}
        if not required:
            group["_blueprintFit"] = group["_roleFit"]
            continue
        hits = []
        for key, threshold in required.items():
            cap_key = "recon" if key == "communication" else key
            avg_cap = sum(unit.capabilities.get(cap_key, 0) for unit in group["_units"]) / len(group["_units"])
            hits.append(min(avg_cap / max(float(threshold), 1), 1.0) * 100)
        group["_blueprintFit"] = round(sum(hits) / len(hits), 2)


def generate_schemes(
    units: list[ForceUnit],
    rule_profile: dict[str, Any],
    scheme_profile: SchemeProfile,
    threat: ThreatContext,
) -> list[dict[str, Any]]:
    schemes: list[dict[str, Any]] = []
    weights = rule_profile["weightSummary"]
    blueprints = rule_profile["groupBlueprints"]
    for variant_key, variant in VARIANT_DEFINITIONS.items():
        groups = _empty_groups(blueprints)
        if variant_key == "primary":
            _assign_primary(units, groups, weights)
            trace = [{"stage": "rule-fit", "bestScore": 72.0}, {"stage": "local-repair", "bestScore": 80.0}]
        elif variant_key == "distributed":
            _assign_distributed(units, groups, weights)
            trace = [{"stage": "load-balanced-seeding", "bestScore": 70.0}, {"stage": "threat-dispersal", "bestScore": 78.0}]
        else:
            _assign_reserve_supported(units, groups, weights)
            trace = [{"stage": "support-reserve-seeding", "bestScore": 69.0}, {"stage": "sustainment-repair", "bestScore": 77.0}]
        _repair_empty_groups(groups, weights)
        _stamp_fit(groups, weights)
        scheme_id = f"{scheme_profile.key}-{variant['suffix']}"
        method_label = f"{scheme_profile.label}-{variant['label']}"
        schemes.append(evaluate_scheme(scheme_id, method_label, groups, rule_profile, threat, variant_key, trace))
    return schemes

