"""Generate mission requirements from targets, rules, and friendly constraints."""

from __future__ import annotations

import math
from typing import Dict, List, Optional

from battle_planner.models import AlgorithmConfig, DispositionRule, EnemyTarget, FriendlyForces, TaskRequirement


class TaskRequirementGenerator:
    def __init__(self, config: AlgorithmConfig):
        self._config = config

    def generate(
        self,
        targets: List[EnemyTarget],
        rules: List[DispositionRule],
        friendly: FriendlyForces,
    ) -> List[TaskRequirement]:
        requirements: List[TaskRequirement] = []
        rule_map = {rule.target_id: rule for rule in rules}
        for index, target in enumerate(targets, start=1):
            rule = rule_map.get(target.id) or DispositionRule(target_id=target.id, target_name=target.name)
            if rule.requires_recon and "摧毁" in rule.action:
                recon_id = f"REQ-{index:03d}-R"
                strike_id = f"REQ-{index:03d}-S"
                requirements.append(self._build_requirement(recon_id, target, rule, friendly, override_task_type="侦察确认"))
                strike_rule = rule.model_copy(update={"requires_recon": False, "task_type": "火力打击", "action": "摧毁"})
                strike = self._build_requirement(strike_id, target, strike_rule, friendly)
                strike.support_relations.append(recon_id)
                requirements.append(strike)
            else:
                requirements.append(self._build_requirement(f"REQ-{index:03d}", target, rule, friendly))
        return sorted(requirements, key=lambda item: (-item.score, item.priority, item.requirement_id))

    def _build_requirement(
        self,
        requirement_id: str,
        target: EnemyTarget,
        rule: DispositionRule,
        friendly: FriendlyForces,
        override_task_type: Optional[str] = None,
    ) -> TaskRequirement:
        task_type = override_task_type or rule.task_type
        priority = max(1, min(5, target.priority + rule.priority_adjustment))
        score = (6 - priority) * 20 + target.threat * 5 + target.value * 4
        helicopters: Dict[str, int] = {}
        weapons: Dict[str, int] = {}
        personnel: Dict[str, int] = {}

        if task_type == "机降突击":
            personnel_need = _target_personnel_need(target, friendly.constraints.default_air_assault_personnel)
            transport_capacity = _best_transport_capacity(friendly)
            transport_count = max(1, math.ceil(personnel_need / max(1, transport_capacity)))
            escort_count = max(1, math.ceil(transport_count * friendly.grouping_rules.escort_ratio))
            helicopters["transport"] = transport_count
            helicopters["escort"] = escort_count
            personnel["机降突击人员"] = personnel_need
            weapons = _multiply_weapons(self._config.weapon_consumption.get("机降突击护航", {}), escort_count)
        elif task_type == "侦察确认":
            helicopters["recon"] = 1
            if rule.requires_escort or target.threat >= friendly.constraints.recon_escort_threat_threshold:
                helicopters["escort"] = 1
                weapons = _multiply_weapons(self._config.weapon_consumption.get("侦察护航", {}), 1)
        else:
            armed_count = self._armed_count(task_type, target)
            helicopters["armed"] = armed_count
            weapons = _multiply_weapons(self._config.weapon_consumption.get(task_type, self._config.weapon_consumption["火力打击"]), armed_count)

        return TaskRequirement(
            requirement_id=requirement_id,
            target_id=target.id,
            target_name=target.name,
            target_type=target.target_type,
            task_type=task_type,
            disposition=rule.action,
            priority=priority,
            score=score,
            required_helicopters=helicopters,
            required_weapons=weapons,
            required_personnel=personnel,
            expected_effect=_expected_effect(task_type, rule),
            estimated_loss_rate=_estimated_loss_rate(task_type, target),
            rationale=f"基于优先级{priority}、威胁度{target.threat:.1f}、价值度{target.value:.1f}生成",
        )

    def _armed_count(self, task_type: str, target: EnemyTarget) -> int:
        if task_type == "防空压制":
            base = max(2, math.ceil((target.threat + target.value) / 8))
        elif task_type in {"火力压制", "通信压制", "破袭打击"}:
            base = max(1, math.ceil((target.threat + target.value) / 12))
        else:
            base = max(1, math.ceil((target.threat + target.value) / 10))
        return min(self._config.max_group_size, base)


def _multiply_weapons(per_aircraft: Dict[str, int], count: int) -> Dict[str, int]:
    return {name: quantity * count for name, quantity in per_aircraft.items() if quantity > 0 and count > 0}


def _target_personnel_need(target: EnemyTarget, default: int) -> int:
    for key in ("air_assault_personnel", "机降人员需求", "突击人员需求"):
        if key in target.raw:
            try:
                return max(0, int(target.raw[key]))
            except (TypeError, ValueError):
                return default
    return default


def _best_transport_capacity(friendly: FriendlyForces) -> int:
    capacities = [item.personnel_capacity for item in friendly.helicopters if item.role == "transport" and item.personnel_capacity > 0]
    return max(capacities) if capacities else 12


def _estimated_loss_rate(task_type: str, target: EnemyTarget) -> float:
    base = 0.02 + target.threat * 0.012
    if task_type == "防空压制":
        base += 0.04
    elif task_type == "机降突击":
        base += 0.03
    elif task_type == "侦察确认":
        base += 0.01
    return min(0.35, round(base, 3))


def _expected_effect(task_type: str, rule: DispositionRule) -> str:
    if task_type == "防空压制":
        return f"预计达成不低于 {rule.suppression_requirement:.0%} 的防空压制效果"
    if task_type == "机降突击":
        return "预计完成目标夺控并保持局部控制能力"
    if task_type == "侦察确认":
        return "预计完成目标识别、威胁确认和后续打击支援"
    if "压制" in task_type:
        return f"预计达成不低于 {max(rule.suppression_requirement, 0.6):.0%} 的压制效果"
    return f"预计达成不低于 {rule.damage_requirement:.0%} 的毁伤效果"

