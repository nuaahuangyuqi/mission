"""Build a normalized force pool from extracted unit data."""

from __future__ import annotations

from typing import Any

from .schemas import CAPABILITY_KEYS, ForceExtractionJson, ForceUnit
from .utils import clamp, clamp_score, slugify


CATEGORY_ALIASES = {
    "炮兵": "fire",
    "火力": "fire",
    "远程打击": "fire",
    "突击": "strike",
    "攻击": "strike",
    "侦察": "recon",
    "预警": "recon",
    "防空": "air-defense",
    "掩护": "air-defense",
    "保障": "support",
    "补给": "support",
    "机动": "mobility",
    "运输": "transport",
    "指挥": "command",
    "通信": "command",
    "工兵": "engineering",
    "工程": "engineering",
    "医疗": "medical",
}

ROLE_ALIASES = {
    "主攻": "main_strike",
    "突击": "main_strike",
    "支援火力": "support_fire",
    "火力支援": "support_fire",
    "侦察": "recon",
    "引导": "recon",
    "掩护": "cover",
    "防空": "air_defense",
    "机动": "mobility",
    "投送": "mobility",
    "保障": "support",
    "补给": "support",
    "指挥": "command",
    "通信": "command",
    "预备": "reserve",
}

CATEGORY_DEFAULTS = {
    "fire": {"firepower": 82, "protection": 55, "recon": 30, "mobility": 35, "support": 35, "communication": 55, "survivability": 55},
    "strike": {"firepower": 74, "protection": 60, "recon": 38, "mobility": 45, "support": 35, "communication": 58, "survivability": 60},
    "recon": {"firepower": 35, "protection": 45, "recon": 82, "mobility": 55, "support": 35, "communication": 78, "survivability": 58},
    "air-defense": {"firepower": 58, "protection": 78, "recon": 55, "mobility": 30, "support": 40, "communication": 65, "survivability": 70},
    "support": {"firepower": 30, "protection": 45, "recon": 25, "mobility": 35, "support": 82, "communication": 55, "survivability": 52},
    "mobility": {"firepower": 42, "protection": 52, "recon": 35, "mobility": 60, "support": 58, "communication": 58, "survivability": 56},
    "transport": {"firepower": 28, "protection": 42, "recon": 25, "mobility": 65, "support": 72, "communication": 50, "survivability": 48},
    "command": {"firepower": 32, "protection": 48, "recon": 62, "mobility": 40, "support": 50, "communication": 86, "survivability": 55},
    "engineering": {"firepower": 38, "protection": 60, "recon": 32, "mobility": 25, "support": 74, "communication": 48, "survivability": 62},
    "medical": {"firepower": 18, "protection": 42, "recon": 20, "mobility": 45, "support": 84, "communication": 52, "survivability": 50},
    "unknown": {"firepower": 45, "protection": 45, "recon": 45, "mobility": 35, "support": 45, "communication": 45, "survivability": 45},
}

CATEGORY_ROLE_DEFAULT = {
    "fire": "support_fire",
    "strike": "main_strike",
    "recon": "recon",
    "air-defense": "air_defense",
    "support": "support",
    "mobility": "mobility",
    "transport": "mobility",
    "command": "command",
    "engineering": "support",
    "medical": "support",
    "unknown": "reserve",
}

READINESS_FACTORS = {
    "available": 1.0,
    "online": 1.0,
    "在线": 1.0,
    "可用": 1.0,
    "完好": 1.0,
    "partial": 0.72,
    "部分可用": 0.72,
    "damaged": 0.42,
    "受损": 0.42,
    "unavailable": 0.0,
    "不可用": 0.0,
    "unknown": 0.65,
}


def normalize_category(value: str) -> str:
    raw = (value or "unknown").strip()
    if raw in CATEGORY_DEFAULTS:
        return raw
    for token, mapped in CATEGORY_ALIASES.items():
        if token in raw:
            return mapped
    return "unknown"


def normalize_role(value: str, category: str) -> str:
    raw = (value or "").strip()
    valid = {
        "main_strike",
        "support_fire",
        "recon",
        "cover",
        "air_defense",
        "mobility",
        "support",
        "command",
        "reserve",
    }
    if raw in valid:
        return raw
    for token, mapped in ROLE_ALIASES.items():
        if token in raw:
            return mapped
    return CATEGORY_ROLE_DEFAULT.get(category, "reserve")


def _normalize_location(location: Any) -> list[float] | None:
    if not location or not isinstance(location, list) or len(location) < 2:
        return None
    try:
        lon = float(location[0])
        lat = float(location[1])
        alt = float(location[2]) if len(location) > 2 else 0.0
    except (TypeError, ValueError):
        return None
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return [lon, lat, alt]


def normalize_extraction(raw: dict[str, Any]) -> ForceExtractionJson:
    raw = dict(raw or {})
    units = []
    for index, item in enumerate(raw.get("forceUnits") or raw.get("units") or [], start=1):
        item = dict(item)
        item.setdefault("id", f"unit-{index:03d}")
        item.setdefault("name", f"未命名单元{index}")
        category = normalize_category(str(item.get("category", "")))
        role = normalize_role(str(item.get("role", "")), category)
        defaults = CATEGORY_DEFAULTS[category]
        capabilities = dict(item.get("capabilities") or {})
        item["capabilities"] = {
            key: clamp_score(capabilities.get(key, defaults[key]))
            for key in CAPABILITY_KEYS
        }
        item["category"] = category
        item["role"] = role
        item["strength"] = clamp(float(item.get("strength") or 1), 1, 5000)
        item["location"] = _normalize_location(item.get("location"))
        units.append(item)
    raw["forceUnits"] = units
    raw["globalConstraints"] = [
        item if isinstance(item, dict) else {"type": "text", "description": str(item)}
        for item in raw.get("globalConstraints", [])
    ]
    raw["warnings"] = [
        item if isinstance(item, dict) else {"type": "llm_warning", "message": str(item)}
        for item in raw.get("warnings", [])
    ]
    raw.setdefault("schemaVersion", "force-extraction-v1")
    raw.setdefault("extractionMeta", {})
    raw.setdefault("inputSummary", {})
    return ForceExtractionJson.model_validate(raw)


def build_force_pool(extraction: ForceExtractionJson) -> tuple[list[ForceUnit], list[dict[str, Any]]]:
    """Deduplicate units and apply readiness factors to capabilities."""

    seen: dict[str, ForceUnit] = {}
    evidence_trace: list[dict[str, Any]] = []
    for unit in extraction.forceUnits:
        key = slugify(unit.name)
        readiness_status = unit.readiness.status
        factor = READINESS_FACTORS.get(readiness_status, READINESS_FACTORS.get(readiness_status.lower(), 0.65))
        readiness_factor = min(factor, unit.readiness.availability)
        adjusted = unit.model_copy(deep=True)
        adjusted.capabilities = {
            key_name: clamp_score(value if key_name == "mobility" else value * readiness_factor)
            for key_name, value in adjusted.capabilities.items()
        }
        adjusted.readiness.availability = clamp(readiness_factor, 0, 1)
        if key in seen:
            existing = seen[key]
            merged = existing.model_copy(deep=True)
            merged.strength = max(existing.strength, adjusted.strength)
            merged.capabilities = {
                cap: clamp_score(max(existing.capabilities.get(cap, 0), adjusted.capabilities.get(cap, 0)))
                for cap in CAPABILITY_KEYS
            }
            merged.evidence.extend(adjusted.evidence)
            seen[key] = merged
        else:
            seen[key] = adjusted
        for evidence in unit.evidence:
            evidence_trace.append(
                {
                    "id": f"ev-{len(evidence_trace) + 1}",
                    "unitId": unit.id,
                    "unitName": unit.name,
                    "source": evidence.source,
                    "text": evidence.text,
                    "confidence": evidence.confidence,
                }
            )
    pool = list(seen.values())
    for index, unit in enumerate(pool, start=1):
        if not unit.id:
            unit.id = f"unit-{index:03d}"
    return pool, evidence_trace
