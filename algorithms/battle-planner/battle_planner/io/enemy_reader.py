"""Enemy situation JSON reader."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union

from battle_planner.models import Coordinate, EnemySituation, EnemyTarget


_TARGET_KEYS = ("targets", "enemy_targets", "目标", "目标列表", "敌方目标", "enemy")
_TEMPLATE_SCHEMA_VERSION = "planning-artifact-export-v1"


def _first_present(data: Dict[str, Any], keys: Iterable[str], default: Any = None) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    return default


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        separators = ["，", ",", ";", "；", "、"]
        items = [value]
        for separator in separators:
            if separator in value:
                items = value.split(separator)
                break
        return [item.strip() for item in items if item.strip()]
    return [str(value)]


def _normalize_coordinate(raw: Any) -> Optional[Coordinate]:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return Coordinate.model_validate(
            {
                "x": _first_present(raw, ("x", "X", "横坐标")),
                "y": _first_present(raw, ("y", "Y", "纵坐标")),
                "lat": _first_present(raw, ("lat", "latitude", "纬度")),
                "lon": _first_present(raw, ("lon", "lng", "longitude", "经度")),
                "description": _first_present(raw, ("description", "desc", "位置描述")),
            }
        )
    if isinstance(raw, (list, tuple)) and len(raw) >= 2:
        return Coordinate(x=float(raw[0]), y=float(raw[1]))
    return Coordinate(description=str(raw))


def _normalize_template_coordinate(raw: Any) -> Optional[Coordinate]:
    if not isinstance(raw, dict):
        return _normalize_coordinate(raw)
    coordinates = raw.get("coordinates")
    description = raw.get("locationDescription")
    if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
        return Coordinate(
            x=float(coordinates[0]),
            y=float(coordinates[1]),
            lon=float(coordinates[0]),
            lat=float(coordinates[1]),
            description=description,
        )
    return Coordinate(description=description) if description else None


def _normalize_target(raw: Dict[str, Any], index: int) -> EnemyTarget:
    target = {
        "id": _first_present(raw, ("id", "target_id", "编号", "目标编号"), f"T{index:03d}"),
        "name": _first_present(raw, ("name", "target_name", "名称", "目标名称"), f"目标{index}"),
        "target_type": _first_present(raw, ("target_type", "type", "目标类型", "类型"), "未知目标"),
        "threat": _first_present(raw, ("threat", "threat_level", "威胁度", "威胁等级"), 5),
        "value": _first_present(raw, ("value", "value_level", "价值度", "目标价值"), 5),
        "priority": _first_present(raw, ("priority", "优先级", "处置优先级"), 3),
        "coordinate": _normalize_coordinate(
            _first_present(raw, ("coordinate", "coordinates", "location", "坐标", "位置"))
        ),
        "coverage_range_km": _first_present(raw, ("coverage_range_km", "coverage", "覆盖范围", "覆盖半径")),
        "capabilities": _as_list(_first_present(raw, ("capabilities", "能力属性", "能力"))),
        "intent": _first_present(raw, ("intent", "敌方意图", "意图")),
        "system_links": _as_list(_first_present(raw, ("system_links", "体系关联关系", "关联关系"))),
        "raw": raw,
    }
    return EnemyTarget.model_validate(target)


def _normalize_template_target(
    raw: Dict[str, Any],
    index: int,
    priority: int,
    output: Dict[str, Any],
) -> EnemyTarget:
    source_target = raw.get("sourceTarget") or {}
    category = str(raw.get("category") or source_target.get("category") or "")
    sub_category = str(source_target.get("subCategory") or "")
    target_type = _map_template_target_type(category, sub_category, str(raw.get("name", "")))
    coverage = raw.get("coverage") or source_target.get("coverage") or {}
    location = raw.get("location") or source_target.get("location")
    threat_score = _score_100_to_10(raw.get("threatScore"))
    value_score = _score_100_to_10(raw.get("valueScore"))
    evidence_ids = _as_list(raw.get("evidenceIds"))

    capabilities = _template_capabilities(raw)
    intent = _template_intent(output, evidence_ids, source_target)
    system_links = _template_system_links(raw.get("id", ""), output)

    target = {
        "id": raw.get("id") or source_target.get("id") or f"T{index:03d}",
        "name": raw.get("name") or source_target.get("name") or f"目标{index}",
        "target_type": target_type,
        "threat": threat_score,
        "value": value_score,
        "priority": priority,
        "coordinate": _normalize_template_coordinate(location),
        "coverage_range_km": _coverage_km(coverage),
        "capabilities": capabilities,
        "intent": intent,
        "system_links": system_links,
        "raw": raw,
    }
    return EnemyTarget.model_validate(target)


def _extract_targets(raw: Any) -> List[Dict[str, Any]]:
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    if not isinstance(raw, dict):
        raise ValueError("敌情 JSON 顶层必须是对象或目标数组")
    for key in _TARGET_KEYS:
        if key in raw and isinstance(raw[key], list):
            return [item for item in raw[key] if isinstance(item, dict)]
    if any(key in raw for key in ("目标名称", "name", "target_name", "target_type", "目标类型")):
        return [raw]
    raise ValueError("敌情 JSON 中未找到目标列表字段")


def _is_template_artifact(raw: Any) -> bool:
    return (
        isinstance(raw, dict)
        and raw.get("schemaVersion") == _TEMPLATE_SCHEMA_VERSION
        and isinstance(raw.get("output"), dict)
        and isinstance(raw["output"].get("targetAssessments"), list)
    )


def _extract_template_targets(raw: Dict[str, Any]) -> List[EnemyTarget]:
    output = raw["output"]
    assessments = [item for item in output.get("targetAssessments", []) if isinstance(item, dict)]
    priority_map = _template_priority_map(assessments)
    return [
        _normalize_template_target(item, index + 1, priority_map.get(str(item.get("id", "")), 3), output)
        for index, item in enumerate(assessments)
    ]


def _template_priority_map(assessments: List[Dict[str, Any]]) -> Dict[str, int]:
    scored = []
    for index, item in enumerate(assessments):
        target_id = str(item.get("id") or f"index-{index}")
        try:
            score = float(item.get("priorityScore", 0) or 0)
        except (TypeError, ValueError):
            score = 0.0
        scored.append((score, target_id))
    if not scored:
        return {}
    ordered = sorted(scored, reverse=True)
    total = len(ordered)
    result: Dict[str, int] = {}
    for rank, (_, target_id) in enumerate(ordered, start=1):
        bucket = int(((rank - 1) * 5) / max(1, total)) + 1
        result[target_id] = min(5, max(1, bucket))
    return result


def _map_template_target_type(category: str, sub_category: str, name: str) -> str:
    category_map = {
        "air_defense": "防空阵地",
        "recon_sensor": "侦察预警节点",
        "mobility_unit": "机动预备队",
        "logistics_support": "后勤补给节点",
        "command_control": "通信中继站",
        "fortification": "工程障碍节点",
    }
    sub_category_map = {
        "anti-armor": "反装甲伏击阵地",
        "indirect_fire": "迫击炮阵地",
        "communication_relay": "通信中继站",
        "explosive_barrier": "工程障碍节点",
        "mobile_reinforcement": "机动预备队",
        "underground_supply_cave": "后勤补给节点",
        "ground_vibration_sensor": "侦察预警节点",
        "manportable_air_defense": "防空阵地",
    }
    if sub_category in sub_category_map:
        return sub_category_map[sub_category]
    if "迫击炮" in name:
        return "迫击炮阵地"
    if "反装甲" in name or "伏击" in name:
        return "反装甲伏击阵地"
    return category_map.get(category, category or "未知目标")


def _score_100_to_10(value: Any) -> float:
    try:
        return max(0.0, min(10.0, float(value) / 10.0))
    except (TypeError, ValueError):
        return 5.0


def _coverage_km(coverage: Any) -> Optional[float]:
    if not isinstance(coverage, dict):
        return None
    if coverage.get("coverageKm") is not None:
        try:
            return float(coverage["coverageKm"])
        except (TypeError, ValueError):
            return None
    if coverage.get("radiusMeters") is not None:
        try:
            return float(coverage["radiusMeters"]) / 1000.0
        except (TypeError, ValueError):
            return None
    return None


def _template_capabilities(raw: Dict[str, Any]) -> List[str]:
    capabilities: List[str] = []
    capability_scores = raw.get("capabilities") or {}
    capability_names = {
        "firepower": "火力",
        "airDefense": "防空",
        "reconnaissance": "侦察预警",
        "commandControl": "指挥控制",
        "mobility": "机动",
        "protection": "防护",
        "logistics": "后勤保障",
        "electronicWarfare": "电子对抗",
    }
    if isinstance(capability_scores, dict):
        for key, label in capability_names.items():
            try:
                if float(capability_scores.get(key, 0) or 0) >= 0.4:
                    capabilities.append(label)
            except (TypeError, ValueError):
                continue
    source_target = raw.get("sourceTarget") or {}
    for equipment in source_target.get("equipment") or []:
        if isinstance(equipment, dict) and equipment.get("name"):
            quantity = equipment.get("quantity")
            suffix = f"×{quantity}" if quantity else ""
            capabilities.append(f"{equipment['name']}{suffix}")
    capabilities.extend(str(item) for item in raw.get("dominantFactors") or [])
    return capabilities


def _template_intent(output: Dict[str, Any], evidence_ids: List[str], source_target: Dict[str, Any]) -> Optional[str]:
    matched = []
    evidence_set = set(evidence_ids)
    for intent in output.get("enemyIntentions") or []:
        if not isinstance(intent, dict):
            continue
        if evidence_set.intersection(set(_as_list(intent.get("evidenceIds")))):
            name = intent.get("name", "")
            description = intent.get("description", "")
            matched.append(f"{name}: {description}" if description else str(name))
    notes = source_target.get("notes")
    if notes:
        matched.append(str(notes))
    return "；".join(item for item in matched if item) or None


def _template_system_links(target_id: str, output: Dict[str, Any]) -> List[str]:
    links = set()
    for sector in output.get("deploymentSectors") or []:
        if not isinstance(sector, dict):
            continue
        units = _as_list(sector.get("units"))
        if target_id in units:
            links.update(unit for unit in units if unit != target_id)
    for impact in output.get("impactAnalysis") or []:
        if not isinstance(impact, dict):
            continue
        related = _as_list(impact.get("relatedTargets"))
        if target_id in related:
            links.update(unit for unit in related if unit != target_id)
    for section in ("fireCoverage", "airDefenseSystem", "reconEarlyWarning", "antiAirborneFacilities"):
        for item in output.get(section) or []:
            if isinstance(item, dict) and item.get("sourceUnitId") == target_id and item.get("id"):
                links.add(str(item["id"]))
    return sorted(links)


def read_enemy_situation(path: Union[str, Path]) -> EnemySituation:
    source = Path(path)
    with source.open("r", encoding="utf-8") as file:
        raw = json.load(file)
    if _is_template_artifact(raw):
        targets = _extract_template_targets(raw)
        metadata = {
            "schemaVersion": raw.get("schemaVersion"),
            "generatedAt": raw.get("generatedAt"),
            "step": raw.get("step", {}),
            "artifact": raw.get("artifact", {}),
            "output_summary": {
                "threatLevel": raw["output"].get("threatLevel"),
                "threatScore": raw["output"].get("threatScore"),
                "targetCount": len(targets),
            },
        }
    else:
        targets = [_normalize_target(item, index + 1) for index, item in enumerate(_extract_targets(raw))]
        metadata = raw.get("metadata", {}) if isinstance(raw, dict) else {}
    return EnemySituation(targets=targets, source_file=str(source), metadata=metadata)


def read_enemy_situations(paths: Sequence[Union[str, Path]]) -> EnemySituation:
    if not paths:
        raise ValueError("至少需要一个敌情威胁 JSON 文件")

    all_targets: List[EnemyTarget] = []
    source_files: List[str] = []
    metadata: Dict[str, Any] = {"source_files": source_files}
    seen_ids: Dict[str, int] = {}

    for file_index, path in enumerate(paths, start=1):
        situation = read_enemy_situation(path)
        source_files.append(str(path))
        if situation.metadata:
            metadata[f"metadata_{file_index}"] = situation.metadata
        for target in situation.targets:
            original_id = target.id
            if original_id in seen_ids:
                seen_ids[original_id] += 1
                target = target.model_copy(update={"id": f"{original_id}_{seen_ids[original_id]}"})
            else:
                seen_ids[original_id] = 1
            all_targets.append(target)

    return EnemySituation(
        targets=all_targets,
        source_file=";".join(source_files),
        metadata=metadata,
    )
