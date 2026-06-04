"""Error helpers for platform-compatible algorithm failures."""

from __future__ import annotations

from typing import Any


def error_response(code: str, error_type: str, message: str, detail: Any | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {
        "code": code,
        "type": error_type,
        "message": message,
    }
    if detail is not None:
        error["detail"] = detail
    return {
        "ok": False,
        "implementationStatus": "failed",
        "error": error,
    }

