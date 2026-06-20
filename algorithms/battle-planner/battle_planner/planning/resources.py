"""Resource inventory and allocation helpers."""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

from battle_planner.models import (
    AllocationIssue,
    FriendlyForces,
    PersonnelAllocation,
    PlatformAllocation,
    ResourceAllocation,
    ResourceSnapshot,
    TaskRequirement,
    WeaponAllocation,
)


FIRE_STRIKE_TASK_TYPES = {"防空压制", "火力打击", "火力压制", "通信压制", "破袭打击"}


class ResourcePool:
    def __init__(self, friendly: FriendlyForces):
        self._friendly = friendly
        self._helicopter_types = {item.model: item for item in friendly.helicopters}
        self._helicopters = {item.model: item.available for item in friendly.helicopters}
        self._weapons = {item.name: item.available for item in friendly.weapons}
        self._personnel = {item.role: item.available for item in friendly.personnel}
        self._reserve = self._calculate_reserve()
        if friendly.constraints.preserve_reserve:
            for model, count in self._reserve.helicopters.items():
                self._helicopters[model] = max(0, self._helicopters.get(model, 0) - count)
            for name, count in self._reserve.weapons.items():
                self._weapons[name] = max(0, self._weapons.get(name, 0) - count)
            for role, count in self._reserve.personnel.items():
                self._personnel[role] = max(0, self._personnel.get(role, 0) - count)

    @property
    def reserve(self) -> ResourceSnapshot:
        return self._reserve

    @property
    def max_allowed_loss_rate(self) -> float:
        return self._friendly.constraints.max_allowed_loss_rate

    def remaining(self) -> ResourceSnapshot:
        return ResourceSnapshot(
            helicopters=dict(self._helicopters),
            weapons=dict(self._weapons),
            personnel=dict(self._personnel),
        )

    def allocate(self, requirement: TaskRequirement) -> ResourceAllocation:
        allocation = ResourceAllocation()
        for role, count in requirement.required_helicopters.items():
            platforms, missing, reserve_used = self._allocate_helicopters(role, count, requirement)
            allocation.platforms.extend(platforms)
            for model, reserve_count in reserve_used.items():
                allocation.issues.append(
                    AllocationIssue(
                        severity="info",
                        requirement_id=requirement.requirement_id,
                        message=f"{requirement.task_type} 动用预备队 {model} {reserve_count} 架承担 {role} 任务",
                    )
                )
            if missing:
                allocation.issues.append(
                    AllocationIssue(
                        severity="warning",
                        requirement_id=requirement.requirement_id,
                        message=f"{requirement.task_type} 缺少 {role} 直升机 {missing} 架，已按可用资源降级分配",
                    )
                )
        allocation.platforms = _merge_platform_allocations(allocation.platforms)
        combat_scale = _combat_scale(requirement, allocation)
        for name, quantity in requirement.required_weapons.items():
            scaled_quantity = math.ceil(quantity * combat_scale)
            if quantity > 0 and scaled_quantity == 0:
                allocation.issues.append(
                    AllocationIssue(
                        severity="warning",
                        requirement_id=requirement.requirement_id,
                        message=f"因缺少武装/护航平台，武器 {name} 未挂载",
                    )
                )
                continue
            allocated, missing = self._allocate_named(self._weapons, name, scaled_quantity)
            reserve_allocated = 0
            if missing and self._can_release_reserve(requirement):
                reserve_allocated, missing = self._allocate_named(self._reserve.weapons, name, missing)
                allocated += reserve_allocated
            if allocated:
                allocation.weapons.append(WeaponAllocation(name=name, quantity=allocated))
            if reserve_allocated:
                allocation.issues.append(
                    AllocationIssue(
                        severity="info",
                        requirement_id=requirement.requirement_id,
                        message=f"{requirement.task_type} 动用预备队武器 {name} {reserve_allocated}",
                    )
                )
            if missing:
                allocation.issues.append(
                    AllocationIssue(
                        severity="warning",
                        requirement_id=requirement.requirement_id,
                        message=f"武器 {name} 缺少 {missing}，已按库存降级分配",
                    )
                )
        if is_fire_strike_task(requirement.task_type) and allocation_weapon_quantity(allocation) <= 0:
            allocation.issues.append(
                AllocationIssue(
                    severity="error",
                    requirement_id=requirement.requirement_id,
                    message=f"{requirement.task_type} 未形成实际武器装载，不能执行火力打击",
                )
            )
        transport_capacity = self._allocated_transport_capacity(allocation)
        for role, count in requirement.required_personnel.items():
            transport_limited_count = min(count, transport_capacity) if requirement.required_helicopters.get("transport") else count
            if transport_limited_count < count:
                allocation.issues.append(
                    AllocationIssue(
                        severity="warning",
                        requirement_id=requirement.requirement_id,
                        message=f"运输平台搭载能力不足，{role} 需求 {count} 名，按 {transport_limited_count} 名分配",
                    )
                )
            allocated, missing = self._allocate_named(self._personnel, role, transport_limited_count)
            reserve_allocated = 0
            if missing and self._can_release_reserve(requirement):
                reserve_allocated, missing = self._allocate_named(self._reserve.personnel, role, missing)
                allocated += reserve_allocated
            if allocated:
                allocation.personnel.append(PersonnelAllocation(role=role, count=allocated))
            if reserve_allocated:
                allocation.issues.append(
                    AllocationIssue(
                        severity="info",
                        requirement_id=requirement.requirement_id,
                        message=f"{requirement.task_type} 动用预备队人员 {role} {reserve_allocated} 名",
                    )
                )
            if missing:
                allocation.issues.append(
                    AllocationIssue(
                        severity="warning",
                        requirement_id=requirement.requirement_id,
                        message=f"人员 {role} 缺少 {missing} 名，已按可用人员降级分配",
                    )
                )
        return allocation

    def _allocated_transport_capacity(self, allocation: ResourceAllocation) -> int:
        capacity = 0
        for platform in allocation.platforms:
            helicopter = self._helicopter_types.get(platform.model)
            if helicopter and platform.role == "transport":
                capacity += platform.count * helicopter.personnel_capacity
        return capacity

    def _calculate_reserve(self) -> ResourceSnapshot:
        ratio = self._friendly.grouping_rules.reserve_ratio
        helicopters: Dict[str, int] = {}
        for item in self._friendly.helicopters:
            count = math.floor(item.available * ratio)
            if item.available >= 4 and ratio > 0:
                count = max(1, count)
            helicopters[item.model] = count
        weapons = {item.name: math.floor(item.available * ratio) for item in self._friendly.weapons}
        personnel = {item.role: math.floor(item.available * ratio) for item in self._friendly.personnel}
        return ResourceSnapshot(helicopters=helicopters, weapons=weapons, personnel=personnel)

    def _allocate_helicopters(
        self,
        role: str,
        count: int,
        requirement: TaskRequirement,
    ) -> Tuple[List[PlatformAllocation], int, Dict[str, int]]:
        if count <= 0:
            return [], 0, {}
        remaining_need = count
        platforms: List[PlatformAllocation] = []
        reserve_used: Dict[str, int] = {}
        allocated, remaining_need = self._allocate_from_inventory(self._helicopters, role, remaining_need, requirement)
        platforms.extend(allocated)
        if remaining_need and self._can_release_reserve(requirement):
            reserve_allocated, remaining_need = self._allocate_from_inventory(
                self._reserve.helicopters,
                role,
                remaining_need,
                requirement,
            )
            reserve_used = {platform.model: platform.count for platform in reserve_allocated}
            platforms.extend(reserve_allocated)
        return platforms, remaining_need, reserve_used

    def _allocate_from_inventory(
        self,
        inventory: Dict[str, int],
        role: str,
        count: int,
        requirement: TaskRequirement,
    ) -> Tuple[List[PlatformAllocation], int]:
        remaining_need = count
        platforms: List[PlatformAllocation] = []
        for model in self._candidate_models(role, requirement, inventory):
            if remaining_need <= 0:
                break
            available = inventory.get(model, 0)
            if available <= 0:
                continue
            take = min(available, remaining_need)
            inventory[model] -= take
            remaining_need -= take
            platforms.append(PlatformAllocation(model=model, role=role, count=take))
        return platforms, remaining_need

    def _candidate_models(self, role: str, requirement: TaskRequirement, inventory: Dict[str, int]) -> List[str]:
        candidates: List[Tuple[int, str]] = []
        for model, item in self._helicopter_types.items():
            if inventory.get(model, 0) <= 0:
                continue
            score = _capability_score(item, role, requirement)
            if score <= 0:
                continue
            score += min(20, inventory.get(model, 0))
            candidates.append((score, model))
        return [model for _, model in sorted(candidates, reverse=True)]

    def _can_release_reserve(self, requirement: TaskRequirement) -> bool:
        constraints = self._friendly.constraints
        return (
            constraints.preserve_reserve
            and constraints.allow_reserve_release
            and requirement.priority <= constraints.reserve_release_priority_threshold
        )

    @staticmethod
    def _allocate_named(inventory: Dict[str, int], name: str, quantity: int) -> Tuple[int, int]:
        if quantity <= 0:
            return 0, 0
        available = inventory.get(name, 0)
        allocated = min(available, quantity)
        inventory[name] = max(0, available - allocated)
        return allocated, quantity - allocated


def is_fire_strike_task(task_type: str) -> bool:
    return str(task_type or "") in FIRE_STRIKE_TASK_TYPES


def allocation_weapon_quantity(allocation: ResourceAllocation) -> int:
    return sum(item.quantity for item in allocation.weapons if item.quantity > 0)


def allocation_personnel_count(allocation: ResourceAllocation) -> int:
    return sum(item.count for item in allocation.personnel if item.count > 0)


def build_allocation_firepower_breakdown(allocation: ResourceAllocation) -> Dict[str, float | int | bool | str | Dict[str, float]]:
    weapon_quantity = allocation_weapon_quantity(allocation)
    personnel_count = allocation_personnel_count(allocation)
    armed_helicopter_count = sum(
        platform.count
        for platform in allocation.platforms
        if platform.role in {"armed", "escort"}
    )
    transport_helicopter_count = sum(
        platform.count
        for platform in allocation.platforms
        if platform.role == "transport"
    )
    has_loaded_weapon = weapon_quantity > 0
    has_loaded_personnel = personnel_count > 0
    weapon_equipment_power = round(min(100.0, weapon_quantity * 0.8), 1) if has_loaded_weapon else 0.0
    personnel_delivery_score = round(min(100.0, personnel_count * 0.35 + transport_helicopter_count * 6), 1)

    return {
        "weaponEquipmentPower": weapon_equipment_power,
        "armedHelicopterCount": armed_helicopter_count,
        "weaponQuantity": weapon_quantity,
        "transportPersonnelPower": personnel_delivery_score,
        "personnelDeliveryScore": personnel_delivery_score,
        "transportHelicopterCount": transport_helicopter_count,
        "personnelCount": personnel_count,
        "combinedFirepower": weapon_equipment_power,
        "hasLoadedWeapon": has_loaded_weapon,
        "hasLoadedPersonnel": has_loaded_personnel,
        "weighting": {
            "weaponEquipment": 1.0,
            "transportPersonnel": 0.0,
        },
        "formula": "火力值 = 实际装载武器折算；未装载武器时火力为 0，人员/运输不计入火力",
        "description": "运输平台和人员配置只进入机动投送等其他指标，不再贡献火力值。",
    }


def _combat_scale(requirement: TaskRequirement, allocation: ResourceAllocation) -> float:
    required_combat = sum(
        count
        for role, count in requirement.required_helicopters.items()
        if role in {"armed", "escort"}
    )
    if required_combat <= 0:
        return 1.0
    allocated_combat = sum(platform.count for platform in allocation.platforms if platform.role in {"armed", "escort"})
    return max(0.0, min(1.0, allocated_combat / required_combat))


def _merge_platform_allocations(platforms: List[PlatformAllocation]) -> List[PlatformAllocation]:
    merged: Dict[Tuple[str, str], int] = {}
    for platform in platforms:
        key = (platform.model, platform.role)
        merged[key] = merged.get(key, 0) + platform.count
    return [
        PlatformAllocation(model=model, role=role, count=count)
        for (model, role), count in merged.items()
        if count > 0
    ]


def _capability_score(item, role: str, requirement: TaskRequirement) -> int:
    capabilities = _capability_text(item.capabilities)
    task_type = requirement.task_type
    score = 0
    if item.role == role:
        score += 100
    if role == "escort" and item.role in {"armed", "escort"}:
        score += 80
    if role == "armed" and item.role in {"armed", "escort"}:
        score += 80
    if role == "recon" and item.role == "recon":
        score += 100
    if role == "transport" and item.role == "transport":
        score += 100

    if task_type in item.capabilities:
        score += 40
    if role == "escort" and _has_any(capabilities, ["护航", "掩护", "火力支援", "伴随保障"]):
        score += 60
    if role == "recon" and _has_any(capabilities, ["侦察", "侦察确认", "目标指示", "监视", "观察"]):
        score += 70
    if role == "transport" and (
        item.personnel_capacity > 0 or _has_any(capabilities, ["运输", "输送", "机降", "人员搭载"])
    ):
        score += 70
    if role in {"armed", "escort"} and _has_weapon_capacity(item.weapon_capacity):
        score += 55
    if role == "armed" and _has_any(capabilities, ["火力", "打击", "压制", "摧毁", "破袭"]):
        score += 45
    if role == "escort" and item.role == "transport" and _has_weapon_capacity(item.weapon_capacity):
        score += 15

    if role == "recon" and score < 70:
        return 0
    if role == "transport" and item.personnel_capacity <= 0 and not _has_any(capabilities, ["运输", "输送", "机降", "人员搭载"]):
        return 0
    if role in {"armed", "escort"} and not _has_weapon_capacity(item.weapon_capacity) and score < 100:
        return 0
    return score


def _capability_text(capabilities: List[str]) -> str:
    return " ".join(str(item) for item in capabilities)


def _has_any(text: str, keywords: List[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def _has_weapon_capacity(weapon_capacity: Optional[Dict[str, int]]) -> bool:
    return any(quantity > 0 for quantity in (weapon_capacity or {}).values())
