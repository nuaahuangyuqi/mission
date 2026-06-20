"""Robust JSON extraction from LLM text responses."""

from __future__ import annotations

import json
import re
from typing import Any, Dict


def _strip_code_fence(text: str) -> str:
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    return fenced.group(1).strip() if fenced else text.strip()


def extract_json_object(text: str) -> Dict[str, Any]:
    """Extract a JSON object from an LLM response.

    The prompt asks for strict JSON, but this helper also tolerates Markdown code
    fences and leading/trailing prose. It intentionally returns only objects
    because the downstream schemas expect named top-level fields.
    """

    candidate = _strip_code_fence(text)
    try:
        data = json.loads(candidate)
        if isinstance(data, dict):
            return data
        return {"items": data}
    except json.JSONDecodeError:
        pass

    start = candidate.find("{")
    end = candidate.rfind("}")
    if start >= 0 and end > start:
        data = json.loads(candidate[start : end + 1])
        if isinstance(data, dict):
            return data
        return {"items": data}
    raise ValueError("大模型输出中未找到可解析的 JSON 对象")

