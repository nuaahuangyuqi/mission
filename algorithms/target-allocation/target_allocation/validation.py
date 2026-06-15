"""Validation checks and adjustment suggestions for allocation plans."""

from __future__ import annotations

from typing import Any


STATUS_RANK = {"pass": 0, "warn": 1, "fail": 2}


def _status(items: list[str]) -> str:
    if not items:
        return "pass"
    return max(items, key=lambda item: STATUS_RANK[item])


def validate_allocation_plan(
    *,
    plan: dict[str, Any],
    targets: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    validation_profile: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    coverage = plan.get("coverage") or []
    group_loads = plan.get("groupLoads") or []
    assignments = plan.get("assignments") or []
    non_entity_targets = [item for item in targets if item.get("type") == "deployment-sector"]
    non_entity_assignments = [item for item in assignments if item.get("targetType") == "deployment-sector"]
    checks.append(
        {
            "id": "non-entity-deployment-context",
            "label": "部署区非实体保护",
            "status": "fail" if non_entity_targets or non_entity_assignments else "pass",
            "detail": (
                f"候选目标中部署区 {len(non_entity_targets)} 个，分配中部署区 {len(non_entity_assignments)} 条。"
                "部署区为目标聚类区域，不是火力打击实体。"
            ),
            "suggestion": "从部署区内部真实目标实体生成候选目标，不要把 deploymentSectors 作为 assignment 目标。"
            if non_entity_targets or non_entity_assignments
            else "",
        }
    )
    uncovered = [item for item in coverage if item["status"] == "uncovered"]
    partial = [item for item in coverage if item["status"] == "partial-covered"]
    low_quality = [item for item in coverage if item["status"] == "low-quality-covered"]
    priority_incomplete = [item for item in coverage if item["priorityLevel"] == "一级" and item["status"] != "full-covered"]
    if not targets:
        checks.append(
            {
                "id": "target-pool",
                "label": "候选目标池",
                "status": "fail",
                "detail": "上游敌情未形成可分配目标。",
                "suggestion": "补充敌情威胁节点或检查第一阶段输出。",
            }
        )
    else:
        target_status = "pass"
        if uncovered or (validation_profile["key"] == "strict" and priority_incomplete):
            target_status = "fail"
        elif partial or low_quality or priority_incomplete:
            target_status = "warn"
        checks.append(
            {
                "id": "target-coverage",
                "label": "目标覆盖完整性",
                "status": target_status,
                "detail": f"完整覆盖 {sum(1 for item in coverage if item['status'] == 'full-covered')}/{len(coverage)} 个目标，未覆盖 {len(uncovered)} 个。",
                "suggestion": "提高单编组最大分配数或补充火力/侦察/防护编组。" if target_status != "pass" else "",
            }
        )

    if not groups:
        checks.append(
            {
                "id": "group-pool",
                "label": "可分配编组",
                "status": "fail",
                "detail": "上游编组结果没有 preferredScheme.groups，无法生成任务分配。",
                "suggestion": "检查第二阶段智能编组输出或补充我方兵力。",
            }
        )
    else:
        overloaded = [item for item in group_loads if item.get("overloaded")]
        idle = [item for item in group_loads if item.get("assignedTargetCount") == 0]
        checks.append(
            {
                "id": "group-load",
                "label": "编组负荷上限",
                "status": "fail" if overloaded else ("warn" if idle else "pass"),
                "detail": f"超负荷编组 {len(overloaded)} 个，未落实目标编组 {len(idle)} 个。",
                "suggestion": "降低目标协同要求、提高上限或补充可承担目标。" if overloaded or idle else "",
            }
        )

    low_feasibility = [
        item for item in assignments if float(item.get("feasibilityScore") or 0) < float(validation_profile["minFeasibilityScore"])
    ]
    checks.append(
        {
            "id": "assignment-feasibility",
            "label": "任务可行性阈值",
            "status": "fail" if low_feasibility and validation_profile["key"] == "strict" else ("warn" if low_feasibility else "pass"),
            "detail": f"低于可行性阈值的分配 {len(low_feasibility)} 条。",
            "suggestion": "为低可行性目标增加侦察、压制或防护编组。" if low_feasibility else "",
        }
    )

    high_risk_low_protection = [
        item
        for item in assignments
        if float(item.get("riskExposure") or 0) >= 35 and item.get("priorityLevel") == "一级"
    ]
    checks.append(
        {
            "id": "risk-exposure",
            "label": "高风险目标生存性",
            "status": "warn" if high_risk_low_protection else "pass",
            "detail": f"高风险暴露分配 {len(high_risk_low_protection)} 条。",
            "suggestion": "增加防护、侦察或先期压制力量。" if high_risk_low_protection else "",
        }
    )

    coordinate_missing = [
        item for item in assignments if item.get("distanceKm") is None or item.get("reachUtilization") is None
    ]
    checks.append(
        {
            "id": "spatial-reference",
            "label": "距离与射程依据",
            "status": "warn" if coordinate_missing else "pass",
            "detail": f"{len(coordinate_missing)} 条分配缺少完整坐标，空间机动响应因素按中性分处理。",
            "suggestion": "在前两阶段输出中补齐目标与编组坐标。" if coordinate_missing else "",
        }
    )
    chains = [item for item in plan.get("taskChains") or [] if isinstance(item, dict)]
    multi_target_loads = [item for item in group_loads if int(item.get("assignedTargetCount") or 0) > 1]
    chain_leg_total = sum(int(item.get("legCount") or 0) for item in chains)
    chain_status = "pass"
    if multi_target_loads and not chains:
        chain_status = "fail"
    elif chain_leg_total and chain_leg_total != len(assignments):
        chain_status = "warn"
    checks.append(
        {
            "id": "task-chain-continuity",
            "label": "连续目标链路",
            "status": chain_status,
            "detail": f"多目标编组 {len(multi_target_loads)} 个，链路 {len(chains)} 条，链路腿 {chain_leg_total} 条。",
            "suggestion": "为同一编组的多个目标生成 taskChains，并回写 assignment 链路字段。" if chain_status != "pass" else "",
        }
    )
    terrain_meta = plan.get("optimizationMeta") or {}
    checks.append(
        {
            "id": "terrain-sampling",
            "label": "地形软约束",
            "status": "pass",
            "detail": (
                f"terrainEnabled={terrain_meta.get('terrainEnabled', False)}，"
                f"status={terrain_meta.get('terrainStatus') or 'disabled'}，"
                f"已采样分配 {terrain_meta.get('terrainSampledAssignmentCount', 0)} 条。"
            ),
            "suggestion": "",
        }
    )

    status = _status([item["status"] for item in checks])
    summary = {
        "status": status,
        "issueCount": sum(1 for item in checks if item["status"] != "pass"),
        "failedCount": sum(1 for item in checks if item["status"] == "fail"),
        "warnCount": sum(1 for item in checks if item["status"] == "warn"),
        "passedCount": sum(1 for item in checks if item["status"] == "pass"),
    }
    return checks, summary


def build_adjustment_suggestions(plan: dict[str, Any], validation: list[dict[str, Any]], preference_key: str) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []
    backlog = plan.get("backlogTargets") or []
    partial = [item for item in plan.get("coverage") or [] if item.get("status") == "partial-covered"]
    idle = [item for item in plan.get("groupLoads") or [] if item.get("assignedTargetCount") == 0]
    low_feasibility_check = next((item for item in validation if item.get("id") == "assignment-feasibility" and item.get("status") != "pass"), None)
    if backlog:
        suggestions.append(
            {
                "id": "suggest-backlog",
                "priority": "high",
                "title": "处理未覆盖目标",
                "detail": f"仍有 {len(backlog)} 个目标进入 backlog，建议提高 maxAssignmentsPerGroup 或补充主攻/火力编组。",
            }
        )
    if partial:
        suggestions.append(
            {
                "id": "suggest-partial",
                "priority": "medium",
                "title": "补齐协同覆盖",
                "detail": f"{len(partial)} 个目标仅部分覆盖，建议为一级或高威胁目标增加侦察、掩护或保障协同。",
            }
        )
    if idle:
        suggestions.append(
            {
                "id": "suggest-idle-groups",
                "priority": "medium",
                "title": "落实空闲编组任务",
                "detail": f"{len(idle)} 个编组未落实到目标，建议降低验证模式或补充低优先级辅助任务。",
            }
        )
    if low_feasibility_check:
        suggestions.append(
            {
                "id": "suggest-feasibility",
                "priority": "high" if low_feasibility_check.get("status") == "fail" else "medium",
                "title": "提高低可行性分配质量",
                "detail": "存在低于可行性阈值的分配，建议提高行进速度、补充侦察/压制/防护编组，或改用标准验证模式探索方案。",
            }
        )
    if preference_key == "survivability-first" and (plan.get("objectives") or {}).get("riskExposure", 0) >= 25:
        suggestions.append(
            {
                "id": "suggest-survivability",
                "priority": "medium",
                "title": "降低高风险目标暴露",
                "detail": "当前生存优先模式下仍存在较高风险暴露，建议增加防护/侦察编组或调整为分波压制。",
            }
        )
    if preference_key == "firepower-first" and (plan.get("objectives") or {}).get("averageMatchScore", 0) < 60:
        suggestions.append(
            {
                "id": "suggest-firepower",
                "priority": "medium",
                "title": "增强火力适配",
                "detail": "火力优先模式下平均匹配分偏低，建议补充主攻火力群或延后低优先级实体目标。",
            }
        )
    if not suggestions:
        suggestions.append(
            {
                "id": "suggest-ready",
                "priority": "low",
                "title": "方案可用于后续战法规划",
                "detail": "当前分配已形成编组到目标的任务表，可继续交给后续作战方法规划读取。",
            }
        )
    return suggestions
