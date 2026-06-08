"""LLM extraction and explanation helpers."""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any

import ollama

from .config import LLMConfig, resolve_llm_config


EXTRACTION_SYSTEM_PROMPT = """你是作战力量智能编组模块的信息抽取器。
只输出 JSON，不要输出 Markdown。
你负责把我方兵力文档抽取为 force-extraction-v1，不能直接编组或给最终方案分。
能力字段统一为 0-100，坐标为 [longitude, latitude, altitude]。
注意：capabilities.mobility 的真实含义是行进速度，按 km/h 理解，仍放在 0-100 数值范围内；不要另增 speed、marchSpeed 或 movementSpeedKph 字段。
"""


EXTRACTION_USER_PROMPT = """请从以下多个文件中抽取我方兵力信息，输出 JSON：

{
  "schemaVersion": "force-extraction-v1",
  "extractionMeta": {
    "generatedAt": "ISO-8601",
    "modelName": "string",
    "overallConfidence": 0.0
  },
  "inputSummary": {
    "fileCount": 0,
    "summary": "string"
  },
  "forceUnits": [
    {
      "id": "unit-001",
      "name": "单位名称",
      "category": "fire|strike|recon|air-defense|support|mobility|command|engineering|medical|transport|unknown",
      "role": "main_strike|support_fire|recon|cover|air_defense|mobility|support|command|reserve",
      "strength": 80,
      "capabilities": {
        "firepower": 70,
        "protection": 60,
        "recon": 40,
        "mobility": 45,
        "support": 45,
        "communication": 60,
        "survivability": 58
      },
      "readiness": {
        "status": "available|partial|damaged|unavailable|unknown",
        "readinessScore": 80,
        "availability": 1.0
      },
      "equipment": [
        {
          "name": "装备名称",
          "type": "fire|recon|mobility|support|communication|protection|unknown",
          "quantity": 1,
          "effectiveness": 70
        }
      ],
      "location": [118.1, 32.0, 0],
      "constraints": {
        "cannotSeparate": false,
        "mustWith": [],
        "cannotWith": [],
        "taskRestrictions": []
      },
      "evidence": [
        {
          "source": "文件名",
          "text": "原文证据片段",
          "confidence": 0.8
        }
      ],
      "derivedFromText": true
    }
  ],
  "globalConstraints": [],
  "warnings": []
}

如果原文明示行进速度、道路机动速度、越野速度或投送速度，请优先把该速度折算为 km/h 后写入 capabilities.mobility。
如果原文没有明确速度，请基于单位类型、装备、角色和世界知识保守推断 capabilities.mobility，例如远程火力/防空较慢、突击/侦察中等、运输/机动较快。
不要新增 speed、marchSpeed、movementSpeedKph 等字段；速度仍必须写在 capabilities.mobility。
如果原文没有明确数值，请根据单位类型和装备保守估计其他能力；不要编造不存在的单位。

文件内容：
"""


OPENAI_FORCE_FILE_CHAR_LIMIT = 18_000
OLLAMA_FORCE_FILE_TOTAL_CHAR_LIMIT = 200_000
OLLAMA_FORCE_FILE_MAX_CHAR_LIMIT = 100_000
OLLAMA_FORCE_FILE_MIN_CHAR_LIMIT = 4_000
OPENAI_EXPLANATION_CHAR_LIMIT = 80_000
OLLAMA_EXPLANATION_CHAR_LIMIT = 160_000
OLLAMA_CONTEXT_FALLBACKS = (262_144, 131_072, 65_536, 32_768, 16_384)


def _extract_json(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?", "", stripped, flags=re.IGNORECASE).strip()
        stripped = re.sub(r"```$", "", stripped).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", stripped, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _chat_completion(messages: list[dict[str, str]], config: LLMConfig) -> str:
    if not config.model:
        raise RuntimeError("LLM model must be configured")
    if _is_ollama_backend(config):
        return _ollama_chat_completion(messages, config)
    if not config.api_key or not config.base_url:
        raise RuntimeError("LLM API key and base URL must be configured")
    endpoint = config.base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": config.model,
        "messages": messages,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    if config.stream:
        payload["stream"] = True
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=_openai_headers(config),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
            if config.stream:
                return _read_streaming_chat_response(response, label="force-grouping", echo=config.stream_to_stdout)
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"LLM request failed: {exc.code} {body}") from exc
    return data["choices"][0]["message"]["content"]


def _ollama_chat_completion(messages: list[dict[str, str]], config: LLMConfig) -> str:
    if not config.ollama_host:
        raise RuntimeError("Ollama host must be configured")
    request = {
        "model": config.model,
        "messages": messages,
        "stream": bool(config.stream),
        "think": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_ctx": config.ollama_num_ctx},
    }
    try:
        return _post_ollama_chat(config.ollama_host, request, config)
    except ollama.ResponseError as exc:
        if _ollama_response_status(exc) in {500, 502, 503, 504}:
            retry_request = dict(request)
            retry_request.pop("format", None)
            try:
                return _post_ollama_chat(config.ollama_host, retry_request, config)
            except ollama.ResponseError as retry_exc:
                raise RuntimeError(_ollama_response_error_message(retry_exc, retried_without_json=True)) from retry_exc
            except Exception as retry_exc:
                raise RuntimeError(f"Ollama request failed: {retry_exc}") from retry_exc
        raise RuntimeError(_ollama_response_error_message(exc)) from exc
    except Exception as exc:
        raise RuntimeError(f"Ollama request failed: {exc}") from exc


def _post_ollama_chat(host: str, request: dict[str, Any], config: LLMConfig) -> str:
    client = ollama.Client(
        host=_ollama_client_host(host),
        timeout=config.timeout_seconds,
        trust_env=False,
    )
    response = client.chat(**request)
    if config.stream:
        return _read_streaming_ollama_chat_response(response, label="force-grouping", echo=config.stream_to_stdout)
    return _extract_ollama_message_content(response)


def _read_streaming_chat_response(response: Any, *, label: str, echo: bool) -> str:
    chunks: list[str] = []
    if echo:
        print(f"\n[{label} stream] begin", flush=True)
    for raw_line in response:
        line = raw_line.decode("utf-8", errors="ignore").strip()
        if not line or not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue
        choice = (event.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        content = delta.get("content")
        if content is None:
            content = (choice.get("message") or {}).get("content")
        if not content:
            continue
        text = str(content)
        chunks.append(text)
        if echo:
            sys.stdout.write(text)
            sys.stdout.flush()
    if echo:
        print(f"\n[{label} stream] end, chars={sum(len(item) for item in chunks)}", flush=True)
    return "".join(chunks)


def _read_streaming_ollama_chat_response(response: Any, *, label: str, echo: bool) -> str:
    chunks: list[str] = []
    if echo:
        print(f"\n[{label} stream] begin", flush=True)
    for event in response:
        content = _extract_ollama_message_content(event, default="")
        if not content:
            continue
        text = str(content)
        chunks.append(text)
        if echo:
            sys.stdout.write(text)
            sys.stdout.flush()
        if _ollama_response_done(event):
            break
    if echo:
        print(f"\n[{label} stream] end, chars={sum(len(item) for item in chunks)}", flush=True)
    return "".join(chunks)


def _ollama_chat_url(host: str) -> str:
    normalized = host.rstrip("/")
    if normalized.endswith("/api/chat"):
        return normalized
    return f"{normalized}/api/chat"


def _ollama_client_host(host: str) -> str:
    normalized = str(host or "").rstrip("/")
    if normalized.endswith("/api/chat"):
        return normalized[: -len("/api/chat")]
    if normalized.endswith("/api"):
        return normalized[: -len("/api")]
    return normalized


def _extract_ollama_message_content(response: Any, default: str | None = None) -> str:
    if isinstance(response, dict):
        message = response.get("message") or {}
        return str(message.get("content") or default or "")
    message = getattr(response, "message", None)
    if isinstance(message, dict):
        return str(message.get("content") or default or "")
    return str(getattr(message, "content", None) or default or "")


def _ollama_response_done(response: Any) -> bool:
    if isinstance(response, dict):
        return bool(response.get("done"))
    return bool(getattr(response, "done", False))


def _openai_headers(config: LLMConfig) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    return headers


def _is_ollama_backend(config: LLMConfig) -> bool:
    return str(getattr(config, "backend", "") or "").strip().lower().replace("_", "-") in {"ollama", "local-ollama", "local"}


def _file_prompt_char_limit(config: LLMConfig, file_count: int) -> int:
    if not _is_ollama_backend(config):
        return OPENAI_FORCE_FILE_CHAR_LIMIT
    total_limit, max_limit, min_limit = _ollama_file_char_limits(config.ollama_num_ctx)
    return max(
        min_limit,
        min(max_limit, total_limit // max(1, file_count)),
    )


def _ollama_context_attempts(config: LLMConfig) -> list[int]:
    start = int(getattr(config, "ollama_num_ctx", 262_144) or 262_144)
    candidates = [start, *OLLAMA_CONTEXT_FALLBACKS]
    attempts: list[int] = []
    for value in candidates:
        if value > start or value < 2_048 or value in attempts:
            continue
        attempts.append(value)
    return attempts or [start]


def _ollama_file_char_limits(num_ctx: int) -> tuple[int, int, int]:
    if num_ctx >= 262_144:
        return OLLAMA_FORCE_FILE_TOTAL_CHAR_LIMIT, OLLAMA_FORCE_FILE_MAX_CHAR_LIMIT, OLLAMA_FORCE_FILE_MIN_CHAR_LIMIT
    if num_ctx >= 131_072:
        return 100_000, 50_000, 4_000
    if num_ctx >= 65_536:
        return 48_000, 24_000, 2_000
    if num_ctx >= 32_768:
        return 20_000, 10_000, 1_200
    return 8_000, 4_000, 600


def _ollama_explanation_char_limit(num_ctx: int) -> int:
    if num_ctx >= 262_144:
        return OLLAMA_EXPLANATION_CHAR_LIMIT
    if num_ctx >= 131_072:
        return 90_000
    if num_ctx >= 65_536:
        return 44_000
    if num_ctx >= 32_768:
        return 18_000
    return 8_000


def _is_retryable_ollama_context_error(exc: Exception) -> bool:
    message = str(exc)
    return "Ollama request failed: HTTP 5" in message or "Ollama request failed:" in message


def _read_http_error_detail(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="ignore").strip()
    except Exception:
        body = ""
    if not body:
        return ""
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return body
    if isinstance(payload, dict):
        for key in ("error", "message", "detail"):
            value = payload.get(key)
            if value:
                return str(value)
    return body


def _ollama_http_error_message(code: int, detail: str = "", *, retried_without_json: bool = False) -> str:
    message = f"Ollama request failed: HTTP {code}"
    if detail:
        message = f"{message}: {detail}"
    if code >= 500:
        suffix = (
            "提示：Ollama 测试连接只验证小型请求，正式编组抽取会携带文件上下文；"
            "当前已对本地模型输入按 256k 上下文窗口截断，默认使用 num_ctx=262144，并在 JSON 模式失败后重试普通聊天模式。"
            "若仍失败，请确认模型已加载、上下文窗口/内存足够，或用 OLLAMA_NUM_CTX 调整上下文窗口。"
        )
        if retried_without_json:
            suffix = f"{suffix} 普通聊天模式重试也失败。"
        message = f"{message}。{suffix}"
    return message


def _ollama_response_status(exc: ollama.ResponseError) -> int:
    return int(getattr(exc, "status_code", -1) or -1)


def _ollama_response_error_message(exc: ollama.ResponseError, *, retried_without_json: bool = False) -> str:
    return _ollama_http_error_message(
        _ollama_response_status(exc),
        str(exc).strip(),
        retried_without_json=retried_without_json,
    )


def extract_force_json_with_llm(
    file_bundles: list[dict[str, Any]],
    llm_config: dict[str, Any] | LLMConfig | None = None,
) -> dict[str, Any]:
    config = llm_config if isinstance(llm_config, LLMConfig) else resolve_llm_config(llm_config)
    if _is_ollama_backend(config):
        response = _extract_force_json_with_ollama_context_fallback(file_bundles, config)
    else:
        response = _chat_completion(_build_force_extraction_messages(file_bundles, config), config)
    extraction = _extract_json(response)
    extraction.setdefault("schemaVersion", "force-extraction-v1")
    extraction.setdefault("extractionMeta", {})
    extraction["extractionMeta"].setdefault("generatedAt", datetime.now(timezone.utc).isoformat())
    extraction["extractionMeta"].setdefault("modelName", config.model)
    return extraction


def _extract_force_json_with_ollama_context_fallback(file_bundles: list[dict[str, Any]], config: LLMConfig) -> str:
    attempts = _ollama_context_attempts(config)
    last_error: Exception | None = None
    for index, num_ctx in enumerate(attempts):
        attempt_config = replace(config, ollama_num_ctx=num_ctx)
        try:
            return _chat_completion(_build_force_extraction_messages(file_bundles, attempt_config), attempt_config)
        except RuntimeError as exc:
            last_error = exc
            if not _is_retryable_ollama_context_error(exc) or index >= len(attempts) - 1:
                raise
            next_ctx = attempts[index + 1]
            print(
                f"[force-grouping] Ollama num_ctx={num_ctx} failed; retrying with num_ctx={next_ctx}.",
                file=sys.stderr,
                flush=True,
            )
    if last_error:
        raise last_error
    raise RuntimeError("Ollama context retry did not produce a response")


def _build_force_extraction_messages(file_bundles: list[dict[str, Any]], config: LLMConfig) -> list[dict[str, str]]:
    text_limit = _file_prompt_char_limit(config, len(file_bundles))
    files_text = []
    for item in file_bundles:
        text = str(item.get("text", ""))
        content = text[:text_limit]
        omitted = max(0, len(text) - len(content))
        suffix = f"\n[已截断 {omitted} 个字符]" if omitted else ""
        files_text.append(
            f"\n--- FILE {item.get('fileId')} | {item.get('fileName')} ---\n{content}{suffix}"
        )
    content = EXTRACTION_USER_PROMPT + "\n".join(files_text)
    return [
        {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
        {"role": "user", "content": content},
    ]


def explain_recommendation_with_llm(
    payload: dict[str, Any],
    llm_config: dict[str, Any] | LLMConfig | None = None,
) -> list[str]:
    config = llm_config if isinstance(llm_config, LLMConfig) else resolve_llm_config(llm_config)
    if _is_ollama_backend(config):
        response = _explain_with_ollama_context_fallback(payload, config)
    else:
        response = _chat_completion(_build_explanation_messages(payload, config, OPENAI_EXPLANATION_CHAR_LIMIT), config)
    data = _extract_json(response)
    explanation = data.get("explanation", [])
    return [str(item) for item in explanation if str(item).strip()]


def _explain_with_ollama_context_fallback(payload: dict[str, Any], config: LLMConfig) -> str:
    attempts = _ollama_context_attempts(config)
    last_error: Exception | None = None
    for index, num_ctx in enumerate(attempts):
        attempt_config = replace(config, ollama_num_ctx=num_ctx)
        payload_limit = _ollama_explanation_char_limit(num_ctx)
        try:
            return _chat_completion(_build_explanation_messages(payload, attempt_config, payload_limit), attempt_config)
        except RuntimeError as exc:
            last_error = exc
            if not _is_retryable_ollama_context_error(exc) or index >= len(attempts) - 1:
                raise
            next_ctx = attempts[index + 1]
            print(
                f"[force-grouping] Ollama explanation num_ctx={num_ctx} failed; retrying with num_ctx={next_ctx}.",
                file=sys.stderr,
                flush=True,
            )
    if last_error:
        raise last_error
    raise RuntimeError("Ollama explanation context retry did not produce a response")


def _build_explanation_messages(payload: dict[str, Any], config: LLMConfig, payload_limit: int) -> list[dict[str, str]]:
    prompt = (
        "你是作战力量智能编组结果解释器。请只基于给定 JSON 解释为什么 preferredScheme 是最推荐方案。"
        "不要修改任何分数、编组、约束。输出 JSON：{\"explanation\":[\"...\", \"...\"]}。\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)[:payload_limit]
    )
    return [
        {"role": "system", "content": "只输出 JSON。"},
        {"role": "user", "content": prompt},
    ]
