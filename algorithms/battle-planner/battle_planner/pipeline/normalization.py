"""Normalize LLM outputs into validated planning models."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from battle_planner.io import FriendlyDocument
from battle_planner.models import (
    AlgorithmConfig,
    DispositionRule,
    EnemyTarget,
    FriendlyForces,
    GroupingRules,
    HelicopterType,
    OperationalConstraints,
    PersonnelResource,
    WeaponStock,
)


def normalize_disposition_rules(raw: Dict[str, Any], targets: List[EnemyTarget]) -> Tuple[List[DispositionRule], List[str]]:
    warnings: List[str] = []
    items = raw.get("rules") or raw.get("disposition_rules") or raw.get("items") or []
    if not isinstance(items, list):
        warnings.append("大模型处置规则不是列表，已按空规则处理并使用目标类型默认规则")
        items = []

    by_id: Dict[str, Dict[str, Any]] = {}
    by_name: Dict[str, Dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("target_id"):
            by_id[str(item["target_id"])] = item
        if item.get("target_name"):
            by_name[str(item["target_name"])] = item

    rules: List[DispositionRule] = []
    for target in targets:
        data = by_id.get(target.id) or by_name.get(target.name) or {}
        if not data:
            warnings.append(f"目标 {target.name} 未获得大模型处置规则，已使用目标类型默认规则")
            data = _default_rule_for_target(target)
        missing = [
            field
            for field in ("action", "damage_requirement", "suppression_requirement")
            if field not in data
        ]
        if missing:
            warnings.append(f"目标 {target.name} 的处置规则缺少字段 {missing}，已补默认值")
        merged = {
            "target_id": target.id,
            "target_name": target.name,
            "target_type": target.target_type,
            **data,
        }
        rules.append(DispositionRule.model_validate(merged))
    return rules, warnings


def normalize_friendly_forces(
    raw: Dict[str, Any],
    document: FriendlyDocument,
    algorithm_config: AlgorithmConfig,
) -> FriendlyForces:
    data = raw.get("friendly_forces") or raw.get("forces") or raw
    if not isinstance(data, dict):
        data = {}
    if (not data.get("helicopters")) and document.structured_hint:
        hint = document.structured_hint.get("friendly_forces", document.structured_hint)
        if isinstance(hint, dict):
            data = {**hint, **data}
    elif document.structured_hint:
        hint = document.structured_hint.get("friendly_forces", document.structured_hint)
        if isinstance(hint, dict):
            data = _merge_resource_data(hint, data)

    inferred = _infer_friendly_from_text(document.content)
    data = _merge_inferred(data, inferred)
    warnings = list(data.get("warnings") or [])

    grouping = data.get("grouping_rules") or {}
    grouping.setdefault("reserve_ratio", algorithm_config.reserve_ratio)
    grouping.setdefault("escort_ratio", algorithm_config.escort_ratio)
    grouping.setdefault("max_armed_group_size", algorithm_config.max_group_size)
    data["grouping_rules"] = grouping

    constraints = data.get("constraints") or {}
    constraints.setdefault("max_allowed_loss_rate", algorithm_config.default_max_loss_rate)
    constraints.setdefault("default_air_assault_personnel", algorithm_config.default_air_assault_personnel)
    constraints.setdefault("recon_escort_threat_threshold", algorithm_config.recon_escort_threat_threshold)
    constraints.setdefault("allow_reserve_release", algorithm_config.allow_reserve_release)
    constraints.setdefault("reserve_release_priority_threshold", algorithm_config.reserve_release_priority_threshold)
    constraints.setdefault("allow_cross_task_reallocation", algorithm_config.allow_cross_task_reallocation)
    data["constraints"] = constraints

    if not data.get("helicopters"):
        warnings.append("己方资源中未识别到直升机平台，后续分配将无法满足平台需求")
    if not data.get("weapons"):
        warnings.append("己方资源中未识别到武器库存，火力类任务将记录未满足武器需求")
    data["warnings"] = warnings

    friendly = FriendlyForces.model_validate(data)
    _fill_default_capabilities(friendly)
    return friendly


def _default_rule_for_target(target: EnemyTarget) -> Dict[str, Any]:
    target_type = target.target_type
    if "防空" in target_type:
        return {"action": "优先压制，必要时摧毁", "suppression_requirement": 0.75, "damage_requirement": 0.65}
    if "通信" in target_type:
        return {"action": "摧毁", "damage_requirement": 0.85}
    if "侦察" in target_type or "预警" in target_type:
        return {"action": "侦察确认后摧毁", "requires_recon": True, "damage_requirement": 0.8}
    if "后勤" in target_type or "补给" in target_type:
        return {"action": "破袭", "damage_requirement": 0.7}
    if "预备队" in target_type:
        return {"action": "压制", "suppression_requirement": 0.65}
    if "工程" in target_type or "障碍" in target_type:
        return {"action": "摧毁或机降夺控", "damage_requirement": 0.8}
    return {"action": "摧毁", "damage_requirement": 0.8}


def _infer_friendly_from_text(text: str) -> Dict[str, Any]:
    helicopters: List[HelicopterType] = []
    weapons: List[WeaponStock] = []
    personnel: List[PersonnelResource] = []

    for model, role, count in _find_platforms(text):
        helicopters.append(
            HelicopterType(
                model=model,
                role=role,
                available=count,
                capabilities=_default_capabilities_for_role(role),
                weapon_capacity=_default_weapon_capacity_for_role(role),
                personnel_capacity=12 if role == "transport" else 0,
            )
        )
    for name in ("空地导弹", "火箭弹", "航炮弹"):
        match = re.search(rf"{name}\s*[:：]?\s*(\d+)\s*[枚发]?", text)
        if match:
            weapons.append(WeaponStock(name=name, available=int(match.group(1)), effects=["压制", "摧毁"]))
    personnel_match = re.search(r"(机降突击人员|突击人员|机降人员)\s*[:：]?\s*(\d+)\s*名?", text)
    if personnel_match:
        personnel.append(PersonnelResource(role="机降突击人员", available=int(personnel_match.group(2))))

    inferred: Dict[str, Any] = {}
    if helicopters:
        inferred["helicopters"] = [item.model_dump(mode="json") for item in helicopters]
    if weapons:
        inferred["weapons"] = [item.model_dump(mode="json") for item in weapons]
    if personnel:
        inferred["personnel"] = [item.model_dump(mode="json") for item in personnel]
    return inferred


def _find_platforms(text: str) -> List[Tuple[str, str, int]]:
    results: List[Tuple[str, str, int]] = []
    patterns = [
        (r"([\w一二三四五六七八九十型\-]+武装直升机)\s*[:：]?\s*(\d+)\s*架", "armed"),
        (r"([\w一二三四五六七八九十型\-]+运输直升机)\s*[:：]?\s*(\d+)\s*架", "transport"),
        (r"([\w一二三四五六七八九十型\-]+侦察直升机)\s*[:：]?\s*(\d+)\s*架", "recon"),
    ]
    for pattern, role in patterns:
        for match in re.finditer(pattern, text):
            results.append((match.group(1), role, int(match.group(2))))
    return results


def _merge_inferred(data: Dict[str, Any], inferred: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(data)
    for key, value in inferred.items():
        if not merged.get(key):
            merged[key] = value
    return merged


def _merge_resource_data(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for list_key, key_field in (("helicopters", "model"), ("weapons", "name"), ("personnel", "role")):
        if base.get(list_key) or override.get(list_key):
            merged[list_key] = _merge_named_items(base.get(list_key) or [], override.get(list_key) or [], key_field)
    for dict_key in ("grouping_rules", "constraints"):
        merged[dict_key] = {**(base.get(dict_key) or {}), **(override.get(dict_key) or {})}
    for list_key in ("task_capabilities", "warnings"):
        values = list(base.get(list_key) or []) + list(override.get(list_key) or [])
        merged[list_key] = sorted({str(value) for value in values})
    for key, value in override.items():
        if key not in merged or value not in (None, "", [], {}):
            merged[key] = value
    return merged


def _merge_named_items(base_items: List[Any], override_items: List[Any], key_field: str) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}
    for item in list(base_items) + list(override_items):
        if not isinstance(item, dict):
            continue
        key = str(item.get(key_field, "")).strip()
        if not key:
            continue
        if key not in merged:
            merged[key] = dict(item)
            continue
        current = merged[key]
        count_key = "available"
        if item.get(count_key) is not None:
            current[count_key] = max(int(current.get(count_key, 0) or 0), int(item.get(count_key, 0) or 0))
        for list_key in ("capabilities", "effects"):
            values = list(current.get(list_key) or []) + list(item.get(list_key) or [])
            if values:
                current[list_key] = sorted({str(value) for value in values})
        for field, value in item.items():
            if value not in (None, "", [], {}) and field not in {count_key, "capabilities", "effects"}:
                current[field] = value
    return list(merged.values())


def _default_capabilities_for_role(role: str) -> List[str]:
    if role == "armed":
        return ["防空压制", "火力打击", "火力压制", "通信压制", "破袭打击", "护航"]
    if role == "transport":
        return ["机降突击", "人员输送"]
    if role == "recon":
        return ["侦察确认"]
    return []


def _default_weapon_capacity_for_role(role: str) -> Dict[str, int]:
    if role == "armed":
        return {"空地导弹": 4, "火箭弹": 16, "航炮弹": 300}
    return {}


def _fill_default_capabilities(friendly: FriendlyForces) -> None:
    for helicopter in friendly.helicopters:
        if not helicopter.capabilities:
            helicopter.capabilities = _default_capabilities_for_role(helicopter.role)
        if not helicopter.weapon_capacity:
            helicopter.weapon_capacity = _default_weapon_capacity_for_role(helicopter.role)
    if not isinstance(friendly.grouping_rules, GroupingRules):
        friendly.grouping_rules = GroupingRules.model_validate(friendly.grouping_rules)
    if not isinstance(friendly.constraints, OperationalConstraints):
        friendly.constraints = OperationalConstraints.model_validate(friendly.constraints)
