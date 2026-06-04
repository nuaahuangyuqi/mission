"""Configuration for the intelligent force grouping algorithm."""

from __future__ import annotations

import importlib.util
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


LLM_API_KEY = ""
LLM_BASE_URL = ""
LLM_MODEL = ""
LLM_TIMEOUT = 120

DEFAULT_SCHEME_PROFILE_KEY = "scheme-balanced-intelligent"
DEFAULT_RULE_LIBRARY_KEY = "fire-strike-rules"
DEFAULT_CONSTRAINT_MODEL_KEY = "baseline-constraints"
DEFAULT_EXPECTED_GROUP_COUNT = 4
GENERATE_LLM_EXPLANATION = True


@dataclass(frozen=True)
class LLMConfig:
    api_key: str
    base_url: str
    model: str
    timeout_seconds: int = 120
    stream: bool = False
    stream_to_stdout: bool = True


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return _bool_value(raw, default)


def _bool_value(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _load_module_from_path(path: Path, module_name: str) -> Any | None:
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _global_config() -> Any | None:
    return _load_module_from_path(Path(__file__).resolve().parents[2] / "config.py", "_force_grouping_global_config")


def _enemy_config_fallback() -> Any | None:
    path = Path(__file__).resolve().parents[2] / "enemy-threat-analysis" / "enemy_threat_analysis" / "config.py"
    return _load_module_from_path(path, "_force_grouping_enemy_config_fallback")


def resolve_llm_config(overrides: Mapping[str, Any] | None = None) -> LLMConfig:
    """Resolve OpenAI-compatible chat completion settings.

    Priority: explicit overrides, environment variables, this module,
    shared global config, and finally the already configured first-stage
    algorithm config when present.
    """

    overrides = dict(overrides or {})
    global_config = _global_config()
    enemy_config = _enemy_config_fallback()

    def pick(name: str, env_name: str, override_names: tuple[str, ...], default: Any = "") -> Any:
        for key in override_names:
            if overrides.get(key):
                return overrides[key]
        if os.getenv(env_name):
            return os.getenv(env_name)
        local_value = globals().get(name)
        if local_value:
            return local_value
        if global_config is not None and getattr(global_config, name, ""):
            return getattr(global_config, name)
        if enemy_config is not None and getattr(enemy_config, name, ""):
            return getattr(enemy_config, name)
        return default

    timeout = (
        overrides.get("timeout_seconds")
        or overrides.get("timeoutSeconds")
        or os.getenv("FORCE_GROUPING_LLM_TIMEOUT")
        or os.getenv("LLM_TIMEOUT")
        or LLM_TIMEOUT
        or getattr(global_config, "LLM_TIMEOUT", 120)
    )
    return LLMConfig(
        api_key=str(pick("LLM_API_KEY", "FORCE_GROUPING_LLM_API_KEY", ("api_key", "apiKey"))).strip(),
        base_url=str(pick("LLM_BASE_URL", "FORCE_GROUPING_LLM_BASE_URL", ("base_url", "baseUrl"))).strip(),
        model=str(pick("LLM_MODEL", "FORCE_GROUPING_LLM_MODEL", ("model",))).strip(),
        timeout_seconds=int(timeout),
        stream=_bool_value(overrides.get("stream"), _env_bool("FORCE_GROUPING_LLM_STREAM", _env_bool("LLM_STREAM", False))),
        stream_to_stdout=_bool_value(
            overrides.get("stream_to_stdout")
            if "stream_to_stdout" in overrides
            else overrides.get("streamToStdout")
            if "streamToStdout" in overrides
            else None,
            _env_bool("FORCE_GROUPING_LLM_STREAM_STDOUT", _env_bool("LLM_STREAM_STDOUT", True)),
        ),
    )
