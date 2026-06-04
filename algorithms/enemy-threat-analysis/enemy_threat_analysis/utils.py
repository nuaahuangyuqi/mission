"""Small numeric and geospatial helpers."""

from __future__ import annotations

import math
from typing import Iterable, Sequence


EARTH_RADIUS_M = 6_371_000.0


def clamp(value: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = low
    return max(low, min(number, high))


def clamp01(value: float, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    if number > 1.0 and number <= 100.0:
        number = number / 100.0
    return clamp(number, 0.0, 1.0)


def round_float(value: float, digits: int = 2) -> float:
    return float(round(float(value or 0.0), digits))


def average(values: Iterable[float]) -> float:
    numbers = [float(item) for item in values if item is not None]
    if not numbers:
        return 0.0
    return sum(numbers) / len(numbers)


def top_k_average(values: Sequence[float], k: int = 5) -> float:
    numbers = sorted((float(item) for item in values if item is not None), reverse=True)
    if not numbers:
        return 0.0
    return average(numbers[:k])


def resolve_level(score: float) -> str:
    if score >= 75:
        return "高"
    if score >= 45:
        return "中"
    return "低"


def normalize_coordinate(coordinates: Sequence[float] | None) -> list[float] | None:
    """Normalize coordinates to [longitude, latitude, altitude]."""
    if not coordinates or len(coordinates) < 2:
        return None
    try:
        first = float(coordinates[0])
        second = float(coordinates[1])
        altitude = float(coordinates[2]) if len(coordinates) >= 3 else 0.0
    except (TypeError, ValueError):
        return None

    lon, lat = first, second
    if abs(lon) <= 90 and abs(lat) > 90:
        lon, lat = lat, lon
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return [round_float(lon, 6), round_float(lat, 6), round_float(altitude, 2)]


def haversine_distance_m(left: Sequence[float], right: Sequence[float]) -> float:
    lon1, lat1 = float(left[0]), float(left[1])
    lon2, lat2 = float(right[0]), float(right[1])
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
