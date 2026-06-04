"""Scheme scoring and constraint evaluation."""

from __future__ import annotations

from collections import Counter
from typing import Any

from .schemas import CAPABILITY_KEYS, ForceUnit, ThreatContext
from .utils import average, clamp_score, variance_score, weighted_average


METRIC_TO_CAPABILITY = {
    "firepower": "firepower",
    "protection": "protection",
    "reconCoverage": "recon",
    "endurance": "support",
    "mobility": "mobility",
}


def unit_fit_score(unit: ForceUnit, blueprint: dict[str, Any], weights: dict[str, float]) -> float:
    preferred = set(blueprint.get("preferredCategories") or [])
    role = blueprint.get("role")
    role_score = 100.0 if unit.role == role else 72.0 if unit.category in preferred else 45.0
    category_score = 100.0 if unit.category in preferred else 55.0
    required = blueprint.get("requiredCapabilities") or {}
    if required:
        caps = []
        for key, threshold in required.items():
            cap_key = "recon" if key == "communication" else key
            caps.append(min(unit.capabilities.get(cap_key, 0) / max(float(threshold), 1), 1.2) * 100)
        capability_score = min(100.0, average(caps, 50.0))
    else:
        capability_score = average(unit.capabilities.values(), 50.0)
    weighted_capability = (
        unit.capabilities.get("firepower", 0) * weights.get("firepower", 0)
        + unit.capabilities.get("protection", 0) * weights.get("protection", 0)
        + unit.capabilities.get("recon", 0) * weights.get("recon", 0)
        + unit.capabilities.get("support", 0) * weights.get("support", 0)
        + unit.capabilities.get("mobility", 0) * weights.get("mobility", 0)
    ) / max(sum(weights.get(key, 0) for key in ("firepower", "protection", "recon", "support", "mobility")), 0.01)
    readiness = unit.readiness.readinessScore
    return clamp_score(role_score * 0.25 + category_score * 0.18 + capability_score * 0.28 + weighted_capability * 0.19 + readiness * 0.10)


def build_group_metrics(group: dict[str, Any]) -> dict[str, Any]:
    units: list[ForceUnit] = group.get("_units", [])
    if not units:
        metrics = {
            "unitCount": 0,
            "totalStrength": 0,
            "firepower": 0,
            "protection": 0,
            "reconCoverage": 0,
            "endurance": 0,
            "mobility": 0,
            "readinessScore": 0,
            "roleComposition": {},
            "categories": [],
        }
        return metrics
    total_strength = sum(unit.strength for unit in units)
    metrics = {
        "unitCount": len(units),
        "totalStrength": round(total_strength, 2),
        "firepower": clamp_score(weighted_average((unit.capabilities["firepower"], unit.strength) for unit in units)),
        "protection": clamp_score(weighted_average((unit.capabilities["protection"], unit.strength) for unit in units)),
        "reconCoverage": clamp_score(weighted_average((unit.capabilities["recon"], unit.strength) for unit in units)),
        "endurance": clamp_score(weighted_average((unit.capabilities["support"], unit.strength) for unit in units)),
        "mobility": clamp_score(min(unit.capabilities["mobility"] for unit in units)),
        "readinessScore": clamp_score(weighted_average((unit.readiness.readinessScore, unit.strength) for unit in units)),
        "roleComposition": dict(Counter(unit.role for unit in units)),
        "categories": sorted(set(unit.category for unit in units)),
    }
    return metrics


def public_unit(unit: ForceUnit) -> dict[str, Any]:
    return {
        "id": unit.id,
        "name": unit.name,
        "category": unit.category,
        "role": unit.role,
        "strength": unit.strength,
        "readiness": unit.readiness.status,
        "readinessScore": unit.readiness.readinessScore,
        "capabilities": {key: clamp_score(unit.capabilities.get(key, 0)) for key in CAPABILITY_KEYS},
        "location": unit.location,
        "derivedFromText": unit.derivedFromText,
    }


def finalize_groups(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    finalized = []
    for group in groups:
        metrics = build_group_metrics(group)
        units = [public_unit(unit) for unit in group.get("_units", [])]
        finalized.append(
            {
                "id": group["id"],
                "name": group["name"],
                "role": group["role"],
                "unitCount": metrics["unitCount"],
                "totalStrength": metrics["totalStrength"],
                "firepower": metrics["firepower"],
                "protection": metrics["protection"],
                "reconCoverage": metrics["reconCoverage"],
                "endurance": metrics["endurance"],
                "mobility": metrics["mobility"],
                "readinessScore": metrics["readinessScore"],
                "roleComposition": metrics["roleComposition"],
                "categories": metrics["categories"],
                "units": units,
            }
        )
    return finalized


def evaluate_constraints(groups: list[dict[str, Any]], threat: ThreatContext) -> dict[str, Any]:
    checks: list[dict[str, str]] = []
    empty_count = sum(1 for group in groups if not group.get("units"))
    if empty_count:
        checks.append(
            {
                "id": "group-completeness",
                "label": "功能群完整性",
                "status": "fail",
                "detail": f"存在 {empty_count} 个空功能群。",
                "suggestion": "降低期望群组数或补充可用兵力。",
            }
        )
    else:
        checks.append(
            {
                "id": "group-completeness",
                "label": "功能群完整性",
                "status": "pass",
                "detail": "所有功能群均已分配至少 1 个单位。",
                "suggestion": "",
            }
        )

    roles = Counter(unit["role"] for group in groups for unit in group.get("units", []))
    missing_roles = [role for role in ("main_strike", "recon", "support") if roles.get(role, 0) == 0]
    if missing_roles:
        checks.append(
            {
                "id": "role-coverage",
                "label": "关键角色覆盖",
                "status": "warn",
                "detail": "缺少关键角色：" + "、".join(missing_roles),
                "suggestion": "补充对应角色单位，避免影响后续目标分配与保障规划。",
            }
        )
    else:
        checks.append(
            {
                "id": "role-coverage",
                "label": "关键角色覆盖",
                "status": "pass",
                "detail": "主攻、侦察和保障角色均已覆盖。",
                "suggestion": "",
            }
        )

    protection_avg = average([group["protection"] for group in groups], 0)
    mobility_avg = average([group["mobility"] for group in groups], 0)
    threat_score = threat.threatScore
    if threat_score >= 75 and (protection_avg < 55 or mobility_avg < 55):
        checks.append(
            {
                "id": "threat-adaptation",
                "label": "威胁适配能力",
                "status": "warn",
                "detail": "上游敌情威胁较高，但防护或机动平均能力不足。",
                "suggestion": "优先增强掩护、防护、机动与分散部署能力。",
            }
        )
    else:
        checks.append(
            {
                "id": "threat-adaptation",
                "label": "威胁适配能力",
                "status": "pass",
                "detail": "当前编组与上游威胁压力基本匹配。",
                "suggestion": "",
            }
        )

    balance = variance_score([group["totalStrength"] for group in groups])
    if balance < 55:
        status = "warn"
        detail = "各群兵力负载差异较大。"
        suggestion = "可通过移动保障或机动单位改善组间均衡。"
    else:
        status = "pass"
        detail = "各群兵力负载分布基本合理。"
        suggestion = ""
    checks.append(
        {
            "id": "load-balance",
            "label": "兵力负载均衡",
            "status": status,
            "detail": detail,
            "suggestion": suggestion,
        }
    )

    passed = sum(1 for check in checks if check["status"] == "pass")
    warned = sum(1 for check in checks if check["status"] == "warn")
    failed = sum(1 for check in checks if check["status"] == "fail")
    score = clamp_score(100 - warned * 10 - failed * 28)
    overall = "fail" if failed else "warn" if warned else "pass"
    suggestions = [check["suggestion"] for check in checks if check["suggestion"]]
    return {
        "modelKey": "baseline-constraints",
        "modelLabel": "基础编组约束",
        "totalChecks": len(checks),
        "passedCount": passed,
        "warnCount": warned,
        "failedCount": failed,
        "score": score,
        "penalty": round((100 - score) / 10, 2),
        "overallStatus": overall,
        "summary": f"约束检查 {passed} 项通过、{warned} 项警告、{failed} 项失败。",
        "checks": checks,
        "suggestions": suggestions,
    }


def evaluate_scheme(
    scheme_id: str,
    method_label: str,
    groups_with_units: list[dict[str, Any]],
    rule_profile: dict[str, Any],
    threat: ThreatContext,
    variant_key: str,
    optimization_trace: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    groups = finalize_groups(groups_with_units)
    constraint_evaluation = evaluate_constraints(groups, threat)
    non_empty = [group for group in groups if group["unitCount"] > 0]
    empty_count = len(groups) - len(non_empty)
    weights = rule_profile["weightSummary"]
    metrics = {
        "firepower": clamp_score(average([group["firepower"] for group in non_empty], 0)),
        "protection": clamp_score(average([group["protection"] for group in non_empty], 0)),
        "reconCoverage": clamp_score(average([group["reconCoverage"] for group in non_empty], 0)),
        "endurance": clamp_score(average([group["endurance"] for group in non_empty], 0)),
        "mobility": clamp_score(average([group["mobility"] for group in non_empty], 0)),
        "balance": variance_score([group["totalStrength"] for group in groups]),
        "strengthTotal": round(sum(group["totalStrength"] for group in groups), 2),
        "roleFit": clamp_score(average([group.get("_roleFit", 75) for group in groups], 75)),
        "blueprintFit": clamp_score(average([group.get("_blueprintFit", 75) for group in groups], 75)),
        "readinessScore": clamp_score(average([group["readinessScore"] for group in non_empty], 0)),
        "groupCoverage": clamp_score(100 * len(non_empty) / max(len(groups), 1)),
        "constraintSatisfaction": constraint_evaluation["score"],
    }
    capability_score = clamp_score(
        metrics["firepower"] * weights.get("firepower", 0)
        + metrics["protection"] * weights.get("protection", 0)
        + metrics["reconCoverage"] * weights.get("recon", 0)
        + metrics["endurance"] * weights.get("support", 0)
        + metrics["mobility"] * weights.get("mobility", 0)
        + metrics["balance"] * weights.get("balance", 0)
    )
    base_score = clamp_score(
        capability_score * 0.45
        + metrics["roleFit"] * 0.18
        + metrics["blueprintFit"] * 0.14
        + metrics["readinessScore"] * 0.08
        + metrics["groupCoverage"] * 0.07
        + metrics["constraintSatisfaction"] * 0.08
    )
    structural_penalty = round(empty_count * 12 + max(0, 60 - metrics["balance"]) * 0.08, 2)
    score = clamp_score(base_score - structural_penalty - constraint_evaluation["penalty"])
    advantages, tradeoffs = build_scheme_narratives(variant_key, metrics, constraint_evaluation)
    return {
        "id": scheme_id,
        "methodKey": scheme_id,
        "methodLabel": method_label,
        "baseScore": base_score,
        "score": score,
        "metrics": metrics,
        "groups": groups,
        "actualGroupCount": len(groups),
        "emptyGroupCount": empty_count,
        "structuralPenalty": structural_penalty,
        "constraintEvaluation": constraint_evaluation,
        "optimizationMeta": {
            "selectedStrategy": variant_key,
            "scoreFormula": "capabilityScore*0.45 + roleFit*0.18 + blueprintFit*0.14 + readiness*0.08 + groupCoverage*0.07 + constraints*0.08 - penalties",
            "threatAware": True,
        },
        "optimizationTrace": optimization_trace or [],
        "advantages": advantages,
        "tradeoffs": tradeoffs,
    }


def build_scheme_narratives(variant_key: str, metrics: dict[str, float], constraints: dict[str, Any]) -> tuple[list[str], list[str]]:
    advantages: list[str] = []
    tradeoffs: list[str] = []
    if variant_key == "primary":
        advantages.append("综合得分与关键角色覆盖较均衡，适合作为当前倾向下的主推荐方案。")
    elif variant_key == "distributed":
        advantages.append("兵力分布更分散，降低高价值单位集中带来的风险。")
    else:
        advantages.append("预备与保障能力更强，便于后续持续行动和应急调整。")
    strongest = max(
        ("firepower", "protection", "reconCoverage", "endurance", "mobility", "balance"),
        key=lambda key: metrics.get(key, 0),
    )
    metric_label = {
        "firepower": "火力能力",
        "protection": "防护能力",
        "reconCoverage": "侦察覆盖",
        "endurance": "持续保障",
        "mobility": "行进速度",
        "balance": "组间均衡",
    }[strongest]
    advantages.append(f"{metric_label}表现相对突出。")
    if constraints["overallStatus"] == "warn":
        tradeoffs.append("存在约束警告，建议在执行前复核相关角色和能力短板。")
    elif constraints["overallStatus"] == "fail":
        tradeoffs.append("存在约束失败项，只能作为低优先级备选方案。")
    weakest = min(
        ("firepower", "protection", "reconCoverage", "endurance", "mobility", "balance"),
        key=lambda key: metrics.get(key, 0),
    )
    if metrics.get(weakest, 100) < 60:
        weak_label = {
            "firepower": "火力",
            "protection": "防护",
            "reconCoverage": "侦察",
            "endurance": "保障",
            "mobility": "行进速度",
            "balance": "均衡",
        }[weakest]
        tradeoffs.append(f"{weak_label}指标相对偏弱。")
    return advantages, tradeoffs
