"""Progress helpers for platform SSE integration."""

from __future__ import annotations

import json
import re
import sys
from typing import Any


PROGRESS_PREFIX = "@@MISSION_PROGRESS@@"


def emit_progress(
    step_progress: float,
    phase_key: str,
    phase_label: str,
    *,
    unit_progress: dict[str, Any] | None = None,
    message: str = "",
) -> None:
    payload: dict[str, Any] = {
        "stepProgress": max(0.0, min(100.0, float(step_progress))),
        "phaseKey": phase_key,
        "phaseLabel": phase_label,
    }
    if message:
        payload["message"] = message
    if unit_progress:
        payload["unitProgress"] = unit_progress
    print(f"{PROGRESS_PREFIX} {json.dumps(payload, ensure_ascii=False)}", file=sys.stderr, flush=True)


def count_completed_objects_in_array(text: str, array_key: str) -> int:
    match = re.search(rf'"{re.escape(array_key)}"\s*:\s*\[', text)
    if not match:
        return 0

    count = 0
    object_depth = 0
    in_string = False
    escape = False
    in_object = False

    for char in text[match.end() :]:
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char == "{":
            object_depth += 1
            in_object = True
            continue
        if char == "}":
            if object_depth > 0:
                object_depth -= 1
                if object_depth == 0 and in_object:
                    count += 1
                    in_object = False
            continue
        if char == "]" and object_depth == 0:
            break

    return count


def count_friendly_unit_objects_in_text(text: str) -> int:
    return (
        count_completed_objects_in_array(text, "helicopters")
        + count_completed_objects_in_array(text, "personnel")
        + count_completed_objects_in_array(text, "units")
    )


def count_friendly_unit_objects(payload: dict[str, Any]) -> int:
    friendly = payload.get("friendly_forces") if isinstance(payload.get("friendly_forces"), dict) else payload
    if not isinstance(friendly, dict):
        return 0
    total = 0
    for key in ("helicopters", "personnel", "units"):
        value = friendly.get(key)
        if isinstance(value, list):
            total += len([item for item in value if isinstance(item, dict)])
    return total
