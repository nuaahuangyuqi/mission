"""LLM configuration placeholders.

Fill these values directly, or set the matching environment variables:

- ENEMY_THREAT_LLM_API_KEY
- ENEMY_THREAT_LLM_BASE_URL
- ENEMY_THREAT_LLM_MODEL
- ENEMY_THREAT_LLM_TIMEOUT
- ENEMY_THREAT_LLM_STREAM
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Mapping


LLM_API_KEY = ""
LLM_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
LLM_MODEL = "qwen-flash"


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


def resolve_llm_config(overrides: Mapping[str, Any] | None = None) -> LLMConfig:
    """Resolve OpenAI-compatible chat completion configuration."""
    config = dict(overrides or {})
    return LLMConfig(
        api_key=str(
            config.get("api_key")
            or config.get("apiKey")
            or os.getenv("ENEMY_THREAT_LLM_API_KEY")
            or LLM_API_KEY
        ).strip(),
        base_url=str(
            config.get("base_url")
            or config.get("baseUrl")
            or os.getenv("ENEMY_THREAT_LLM_BASE_URL")
            or LLM_BASE_URL
        ).strip(),
        model=str(
            config.get("model")
            or os.getenv("ENEMY_THREAT_LLM_MODEL")
            or LLM_MODEL
        ).strip(),
        timeout_seconds=int(
            config.get("timeout_seconds")
            or config.get("timeoutSeconds")
            or os.getenv("ENEMY_THREAT_LLM_TIMEOUT")
            or os.getenv("LLM_TIMEOUT")
            or 120
        ),
        stream=_bool_value(config.get("stream"), _env_bool("ENEMY_THREAT_LLM_STREAM", _env_bool("LLM_STREAM", False))),
        stream_to_stdout=_bool_value(
            config.get("stream_to_stdout")
            if "stream_to_stdout" in config
            else config.get("streamToStdout")
            if "streamToStdout" in config
            else None,
            _env_bool("ENEMY_THREAT_LLM_STREAM_STDOUT", _env_bool("LLM_STREAM_STDOUT", True)),
        ),
    )
