"""Hybrid grouping optimizer.

The first implementation creates an explainable heuristic solution and exposes
an optimizer interface that can later be replaced by MILP or other solvers.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional

from battle_planner.models import (
    AllocationIssue,
    PlanResult,
    ResourceSnapshot,
    TaskGroup,
    TaskRequirement,
)
from battle_planner.planning.resources import (
    ResourcePool,
    build_allocation_firepower_breakdown,
    is_fire_strike_task,
)


class Optimizer(ABC):
    @abstractmethod
    def optimize(self, requirements: List[TaskRequirement], pool: ResourcePool) -> PlanResult:
        """Create task groups from requirements and available resources."""


class HybridGroupingOptimizer(Optimizer):
    def optimize(self, requirements: List[TaskRequirement], pool: ResourcePool) -> PlanResult:
        task_groups: List[TaskGroup] = []
        warnings: List[str] = []
        for index, requirement in enumerate(requirements, start=1):
            allocation = pool.allocate(requirement)
            firepower_breakdown = build_allocation_firepower_breakdown(allocation)
            strike_weapon_requirement_met = (
                not is_fire_strike_task(requirement.task_type)
                or bool(firepower_breakdown["hasLoadedWeapon"])
            )
            if requirement.estimated_loss_rate > pool.max_allowed_loss_rate:
                allocation.issues.append(
                    AllocationIssue(
                        severity="warning",
                        requirement_id=requirement.requirement_id,
                        message=(
                            f"预计战损率 {requirement.estimated_loss_rate:.1%} "
                            f"超过最大允许战损率 {pool.max_allowed_loss_rate:.1%}"
                        ),
                    )
                )
            if allocation.issues:
                warnings.extend(issue.message for issue in allocation.issues if issue.severity != "info")
            group = TaskGroup(
                group_id=f"TG-{index:03d}",
                group_name=_group_name(requirement.task_type, requirement.target_name),
                task_type=requirement.task_type,
                responsible_targets=[requirement.target_name],
                disposition=requirement.disposition,
                platforms=allocation.platforms,
                weapons=allocation.weapons,
                personnel=allocation.personnel,
                expected_effect=requirement.expected_effect,
                estimated_loss_rate=requirement.estimated_loss_rate,
                priority=requirement.priority,
                support_relations=requirement.support_relations,
                firepower_score=float(firepower_breakdown["combinedFirepower"]),
                firepower_breakdown=firepower_breakdown,
                has_loaded_weapon=bool(firepower_breakdown["hasLoadedWeapon"]),
                has_loaded_personnel=bool(firepower_breakdown["hasLoadedPersonnel"]),
                strike_weapon_requirement_met=strike_weapon_requirement_met,
                assignment_eligible_for_strike=strike_weapon_requirement_met,
                issues=allocation.issues,
            )
            if not allocation.platforms:
                group.issues.append(
                    AllocationIssue(
                        severity="error",
                        requirement_id=requirement.requirement_id,
                        message="任务未分配到任何直升机平台，无法形成完整任务组",
                    )
                )
                warnings.append(f"{requirement.target_name} 未分配到直升机平台")
            task_groups.append(group)

        reserve = _reserve_group(pool.reserve)
        result = PlanResult(
            total_groups=len(task_groups) + (1 if reserve else 0),
            task_groups=task_groups,
            reserve_group=reserve,
            remaining_resources=pool.remaining(),
            warnings=warnings,
            metadata={"optimizer": "hybrid_heuristic_seed", "supports_future_solver": True},
        )
        return result


def _group_name(task_type: str, target_name: str) -> str:
    mapping = {
        "防空压制": "防空压制组",
        "火力打击": "火力打击组",
        "火力压制": "火力压制组",
        "通信压制": "通信压制组",
        "破袭打击": "破袭打击组",
        "侦察确认": "侦察确认组",
        "机降突击": "机降突击组",
    }
    return f"{mapping.get(task_type, '任务组')} - {target_name}"


def _reserve_group(reserve: ResourceSnapshot) -> Optional[TaskGroup]:
    if not any(reserve.helicopters.values()) and not any(reserve.weapons.values()) and not any(reserve.personnel.values()):
        return None
    return TaskGroup(
        group_id="TG-RESERVE",
        group_name="预备队",
        task_type="预备队",
        responsible_targets=[],
        disposition="保留机动与应急补充能力",
        platforms=[
            {"model": model, "role": "reserve", "count": count}
            for model, count in reserve.helicopters.items()
            if count > 0
        ],
        weapons=[{"name": name, "quantity": count} for name, count in reserve.weapons.items() if count > 0],
        personnel=[{"role": role, "count": count} for role, count in reserve.personnel.items() if count > 0],
        expected_effect="用于任务补充、战损替换和突发目标处置",
        estimated_loss_rate=0.0,
        priority=5,
        is_reserve=True,
    )
