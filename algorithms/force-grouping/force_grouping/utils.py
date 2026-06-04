"""Small deterministic math and normalization helpers."""

from __future__ import annotations

import math
import re
from typing import Iterable


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def clamp_score(value: float) -> float:
    return round(clamp(float(value), 0.0, 100.0), 2)


def clamp_confidence(value: float | int | None, default: float = 0.65) -> float:
    if value is None:
        return default
    return clamp(float(value), 0.0, 1.0)


def safe_number(value: object, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def slugify(value: str, fallback: str = "item") -> str:
    text = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", value.strip()).strip("-").lower()
    return text or fallback


def average(values: Iterable[float], default: float = 0.0) -> float:
    items = list(values)
    if not items:
        return default
    return sum(items) / len(items)


def weighted_average(pairs: Iterable[tuple[float, float]], default: float = 0.0) -> float:
    items = [(float(value), max(float(weight), 0.0)) for value, weight in pairs]
    total_weight = sum(weight for _, weight in items)
    if total_weight <= 0:
        return default
    return sum(value * weight for value, weight in items) / total_weight


def variance_score(values: list[float]) -> float:
    if len(values) <= 1:
        return 100.0
    mean = average(values)
    if mean <= 0:
        return 100.0
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    coefficient = math.sqrt(variance) / mean
    return clamp_score(100.0 * (1.0 - clamp(coefficient, 0.0, 1.0)))

