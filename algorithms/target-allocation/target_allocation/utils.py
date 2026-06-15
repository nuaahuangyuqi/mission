"""Small deterministic helpers for target allocation."""

from __future__ import annotations

import math
import re
from typing import Iterable


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def clamp_score(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0.0
    return round(clamp(number, 0.0, 100.0), 2)


def safe_number(value: object, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def average(values: Iterable[float], default: float = 0.0) -> float:
    items = list(values)
    if not items:
        return default
    return sum(items) / len(items)


def weighted_sum(metrics: dict[str, float], weights: dict[str, float]) -> float:
    return sum(float(metrics.get(key, 0.0)) * float(weight) for key, weight in weights.items())


def slugify(value: str, fallback: str = "item") -> str:
    text = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", value.strip()).strip("-").lower()
    return text or fallback


def normalize_coordinates(value: object) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    lon = safe_number(value[0], None)  # type: ignore[arg-type]
    lat = safe_number(value[1], None)  # type: ignore[arg-type]
    if lon is None or lat is None:
        return None
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    alt = safe_number(value[2], 0.0) if len(value) > 2 else 0.0
    return [round(lon, 6), round(lat, 6), round(alt, 2)]


def first_coordinates(item: dict[str, object], keys: tuple[str, ...]) -> list[float] | None:
    for key in keys:
        value = item.get(key)
        coordinates = normalize_coordinates(value)
        if coordinates is not None:
            return coordinates
        if isinstance(value, dict):
            coordinates = normalize_coordinates(value.get("coordinates"))
            if coordinates is not None:
                return coordinates
    geometry = item.get("geometry")
    if isinstance(geometry, dict):
        coordinates = normalize_coordinates(geometry.get("coordinates"))
        if coordinates is not None:
            return coordinates
    return None


def haversine_km(a: list[float] | None, b: list[float] | None) -> float | None:
    if a is None or b is None:
        return None
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(6371.0088 * 2 * math.asin(math.sqrt(h)), 2)


def variance_score(values: list[float]) -> float:
    if len(values) <= 1:
        return 100.0
    mean = average(values)
    if mean <= 0:
        return 100.0
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    coefficient = math.sqrt(variance) / mean
    return clamp_score(100.0 * (1.0 - clamp(coefficient, 0.0, 1.0)))
