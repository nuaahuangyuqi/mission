"""LLM configuration placeholders.

Fill these values directly, or set the matching environment variables:

- ENEMY_THREAT_LLM_API_KEY
- ENEMY_THREAT_LLM_BASE_URL
- ENEMY_THREAT_LLM_BACKEND
- ENEMY_THREAT_LLM_OLLAMA_HOST
- ENEMY_THREAT_LLM_MODEL
- ENEMY_THREAT_LLM_TIMEOUT
- ENEMY_THREAT_LLM_STREAM
- ENEMY_THREAT_LLM_OLLAMA_NUM_CTX
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Mapping


LLM_API_KEY = ""
LLM_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
LLM_MODEL = "qwen-flash"
LLM_BACKEND = "openai-compatible"
LLM_OLLAMA_HOST = "http://localhost:11434"


@dataclass(frozen=True)
class LLMConfig:
    api_key: str
    base_url: str
    model: str
    backend: str = "openai-compatible"
    ollama_host: str = "http://localhost:11434"
    timeout_seconds: int = 120
    stream: bool = False
    stream_to_stdout: bool = True
    ollama_num_ctx: int = 262144


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


def _normalize_backend(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("_", "-")
    if normalized in {"ollama", "local-ollama", "local"}:
        return "ollama"
    return "openai-compatible"


def _int_value(value: Any, default: int, *, min_value: int, max_value: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(min_value, min(max_value, parsed))


def resolve_llm_config(overrides: Mapping[str, Any] | None = None) -> LLMConfig:
    """Resolve OpenAI-compatible or local Ollama chat configuration."""
    config = dict(overrides or {})
    backend = _normalize_backend(
        config.get("backend")
        or config.get("llmBackend")
        or os.getenv("ENEMY_THREAT_LLM_BACKEND")
        or os.getenv("LLM_BACKEND")
        or LLM_BACKEND
    )
    return LLMConfig(
        api_key=str(
            config.get("api_key")
            or config.get("apiKey")
            or config.get("openaiApiKey")
            or os.getenv("ENEMY_THREAT_LLM_API_KEY")
            or LLM_API_KEY
        ).strip(),
        base_url=str(
            config.get("base_url")
            or config.get("baseUrl")
            or config.get("openaiBaseUrl")
            or os.getenv("ENEMY_THREAT_LLM_BASE_URL")
            or LLM_BASE_URL
        ).strip(),
        model=str(
            config.get("model")
            or config.get("llmModel")
            or os.getenv("ENEMY_THREAT_LLM_MODEL")
            or LLM_MODEL
        ).strip(),
        backend=backend,
        ollama_host=str(
            config.get("ollama_host")
            or config.get("ollamaHost")
            or os.getenv("ENEMY_THREAT_LLM_OLLAMA_HOST")
            or os.getenv("LLM_OLLAMA_HOST")
            or os.getenv("OLLAMA_HOST")
            or LLM_OLLAMA_HOST
        ).strip(),
        timeout_seconds=int(
            config.get("timeout_seconds")
            or config.get("timeoutSeconds")
            or config.get("llmTimeout")
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
        ollama_num_ctx=_int_value(
            config.get("ollama_num_ctx")
            or config.get("ollamaNumCtx")
            or config.get("llmNumCtx")
            or os.getenv("ENEMY_THREAT_LLM_OLLAMA_NUM_CTX")
            or os.getenv("LLM_OLLAMA_NUM_CTX")
            or os.getenv("OLLAMA_NUM_CTX")
            or 262144,
            262144,
            min_value=2048,
            max_value=262144,
        ),
    )
