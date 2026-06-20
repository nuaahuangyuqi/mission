"""Configuration loading."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Union

from battle_planner.models import AppConfig


def _expand_env(value: Any) -> Any:
    if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
        return os.getenv(value[2:-1], "")
    if isinstance(value, dict):
        return {key: _expand_env(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_expand_env(item) for item in value]
    return value


def load_config(path: Union[str, Path]) -> AppConfig:
    config_path = Path(path)
    with config_path.open("r", encoding="utf-8") as file:
        raw: Dict[str, Any] = json.load(file)
    return AppConfig.model_validate(_expand_env(raw))
