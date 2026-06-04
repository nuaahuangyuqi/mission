"""LLM extraction and explanation helpers."""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

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
    if not config.api_key or not config.base_url or not config.model:
        raise RuntimeError("LLM API key, base URL, and model must be configured")
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
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
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


def extract_force_json_with_llm(
    file_bundles: list[dict[str, Any]],
    llm_config: dict[str, Any] | LLMConfig | None = None,
) -> dict[str, Any]:
    config = llm_config if isinstance(llm_config, LLMConfig) else resolve_llm_config(llm_config)
    files_text = []
    for item in file_bundles:
        files_text.append(
            f"\n--- FILE {item.get('fileId')} | {item.get('fileName')} ---\n{item.get('text', '')}"
        )
    content = EXTRACTION_USER_PROMPT + "\n".join(files_text)
    response = _chat_completion(
        [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        config,
    )
    extraction = _extract_json(response)
    extraction.setdefault("schemaVersion", "force-extraction-v1")
    extraction.setdefault("extractionMeta", {})
    extraction["extractionMeta"].setdefault("generatedAt", datetime.now(timezone.utc).isoformat())
    extraction["extractionMeta"].setdefault("modelName", config.model)
    return extraction


def explain_recommendation_with_llm(
    payload: dict[str, Any],
    llm_config: dict[str, Any] | LLMConfig | None = None,
) -> list[str]:
    config = llm_config if isinstance(llm_config, LLMConfig) else resolve_llm_config(llm_config)
    prompt = (
        "你是作战力量智能编组结果解释器。请只基于给定 JSON 解释为什么 preferredScheme 是最推荐方案。"
        "不要修改任何分数、编组、约束。输出 JSON：{\"explanation\":[\"...\", \"...\"]}。\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)[:80_000]
    )
    response = _chat_completion(
        [
            {"role": "system", "content": "只输出 JSON。"},
            {"role": "user", "content": prompt},
        ],
        config,
    )
    data = _extract_json(response)
    explanation = data.get("explanation", [])
    return [str(item) for item in explanation if str(item).strip()]
