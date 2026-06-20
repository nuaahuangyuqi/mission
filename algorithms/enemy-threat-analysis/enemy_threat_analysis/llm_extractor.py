"""LLM extraction layer.

The model is asked to read files and return a strict ``threat-extraction-v1``
JSON document. It must not calculate final threat scores.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import replace
from typing import Any, Sequence

import ollama

from .config import LLMConfig, resolve_llm_config
from .errors import LLMConfigurationError, LLMExtractionError
from .file_loader import LoadedFile
from .schemas import ThreatExtractionJson


DEFAULT_COVERAGE_RADIUS_BY_CATEGORY = {
    "fire_unit": 35_000.0,
    "air_defense": 40_000.0,
    "recon_sensor": 45_000.0,
    "electronic_warfare": 35_000.0,
}

OPENAI_FILE_PROMPT_CHAR_LIMIT = 18_000
OLLAMA_FILE_PROMPT_TOTAL_CHAR_LIMIT = 200_000
OLLAMA_FILE_PROMPT_MAX_CHAR_LIMIT = 100_000
OLLAMA_FILE_PROMPT_MIN_CHAR_LIMIT = 4_000
OLLAMA_CONTEXT_FALLBACKS = (262_144, 131_072, 65_536, 32_768, 16_384)


SYSTEM_PROMPT = """你是敌情威胁证据抽取器。
只负责从输入文件抽取和归一化事实，不要计算最终 threatScore、valueScore、priorityScore。
你必须只输出 JSON，不要输出 Markdown、解释文字或代码块。
坐标必须使用 [longitude, latitude, altitude] 顺序；缺失坐标时 coordinates 写 null，并在 warnings 中说明。
目标 category 只能使用:
fire_unit, air_defense, recon_sensor, command_control, mobility_unit,
logistics_support, fortification, electronic_warfare, unknown。
严格要求：targets[].location、mobility、capabilities、coverage、importance、confidence 必须是对象；
targets[].equipment、evidence 必须是数组；targetCategories、warnings 必须是对象数组。
coverage 只描述真实作用范围：火力、防空、侦察/雷达、电子对抗等有射程/探测/干扰范围的目标可写 hasCoverage=true 和 radiusMeters；
指挥、机动、后勤、普通工事等只需点位符号的目标必须写 hasCoverage=false、radiusMeters=0、coverageTypes=[]，不要为所有目标虚构覆盖圈。
不要把 high/medium/low 写进数字字段，必须转换为 0.85/0.6/0.35。
"""


USER_PROMPT_TEMPLATE = """请把以下多文件敌情材料抽取为 schemaVersion=threat-extraction-v1 的 JSON。

必须包含顶层字段:
schemaVersion, extractionMeta, inputSummary, globalSituation, targetCategories,
targets, relations, spatialContext, warnings。

globalSituation 必须包含 enemyIntentions，且至少 1 条。每条意图必须说明：
- type: fire_suppression / air_defense_denial / reconnaissance_warning / counter_airlanding / mobility_interdiction / command_control / other
- name: 简短中文名称
- description: 说明敌方可能的目的、方向、时机或行动方式
- confidence: 0-1 数字
- evidenceIds: 引用 targets[].evidence[].evidenceId

每个 target 必须尽量包含:
id, name, category, subCategory, camp, status, location, mobility,
capabilities, coverage, equipment, importance, evidence, confidence, notes。

单个 target 的格式示例，所有 target 都必须遵守：
{
  "id": "target-001",
  "name": "北侧远程火力群",
  "category": "fire_unit",
  "camp": "red",
  "status": "active",
  "location": {
    "type": "point",
    "coordinates": [118.12, 32.04, 0],
    "coordinateConfidence": 0.86,
    "locationDescription": "北侧丘陵地带"
  },
  "mobility": {
    "isMobile": true,
    "mobilityLevel": 0.7,
    "estimatedSpeedLevel": "medium",
    "relocationProbability": 0.45
  },
  "capabilities": {
    "firepower": 0.88,
    "airDefense": 0.12,
    "reconnaissance": 0.25,
    "commandControl": 0.2,
    "mobility": 0.65,
    "protection": 0.55,
    "logistics": 0.3,
    "electronicWarfare": 0.1
  },
  "coverage": {
    "hasCoverage": true,
    "coverageTypes": ["fire"],
    "radiusMeters": 42000,
    "minRadiusMeters": 5000,
    "maxRadiusMeters": 42000,
    "coverageConfidence": 0.74
  },
  "equipment": [{"name": "远程火力装备", "type": "artillery_or_rocket", "quantity": 6, "quantityConfidence": 0.62}],
  "importance": {"missionRelevance": 0.82, "systemCentrality": 0.55, "replaceability": 0.45, "supportDependency": 0.36},
  "evidence": [{"evidenceId": "ev-1", "sourceFileId": "file-1", "sourceFileName": "enemy.txt", "text": "原文证据", "confidence": 0.78}],
  "confidence": {"classificationConfidence": 0.84, "capabilityConfidence": 0.76, "locationConfidence": 0.86, "overallConfidence": 0.81}
}

可视化约束：
- fire_unit / air_defense / recon_sensor / electronic_warfare：如果原文支持射程、探测或干扰范围，可设置 coverage.hasCoverage=true、radiusMeters>0。
- command_control / mobility_unit / logistics_support / unknown：默认只作为点目标展示，coverage.hasCoverage=false、radiusMeters=0。
- fortification：除非原文明确给出阻滞区、雷场或封控区范围，否则只作为点目标展示，coverage.hasCoverage=false、radiusMeters=0。
- 不确定覆盖范围时不要臆造大半径；用 warnings 说明不确定性。

用户选项:
- analysisFocus: __ANALYSIS_FOCUS__
- heatmapDensity: __HEATMAP_DENSITY__
- impactBias: __IMPACT_BIAS__

待分析文件:
__FILE_BLOCKS__
"""


def extract_threat_json_with_llm(
    files: Sequence[LoadedFile],
    *,
    analysis_focus: str,
    heatmap_density: str,
    impact_bias: str,
    llm_config: dict[str, Any] | LLMConfig | None = None,
) -> ThreatExtractionJson:
    """Call an OpenAI-compatible chat completion API and parse extraction JSON."""
    config = llm_config if isinstance(llm_config, LLMConfig) else resolve_llm_config(llm_config)
    if not config.model:
        raise LLMConfigurationError("未配置大模型 model。")
    if _is_ollama_backend(config):
        if not config.ollama_host:
            raise LLMConfigurationError("未配置 Ollama 地址，请通过页面参数或 ENEMY_THREAT_LLM_OLLAMA_HOST 提供。")
    else:
        if not config.api_key:
            raise LLMConfigurationError("未配置大模型 API Key，请通过页面参数或 ENEMY_THREAT_LLM_API_KEY 提供。")
        if not config.base_url:
            raise LLMConfigurationError("未配置大模型 Base URL，请通过页面参数或 ENEMY_THREAT_LLM_BASE_URL 提供。")

    if _is_ollama_backend(config):
        content = _extract_with_ollama_context_fallback(
            files,
            config,
            analysis_focus=analysis_focus,
            heatmap_density=heatmap_density,
            impact_bias=impact_bias,
        )
    else:
        user_prompt = _build_user_prompt(
            files,
            config,
            analysis_focus=analysis_focus,
            heatmap_density=heatmap_density,
            impact_bias=impact_bias,
        )
        content = _chat_completion(config, SYSTEM_PROMPT, user_prompt)
    return parse_llm_extraction(content)


def _extract_with_ollama_context_fallback(
    files: Sequence[LoadedFile],
    config: LLMConfig,
    *,
    analysis_focus: str,
    heatmap_density: str,
    impact_bias: str,
) -> str:
    attempts = _ollama_context_attempts(config)
    last_error: Exception | None = None
    for index, num_ctx in enumerate(attempts):
        attempt_config = replace(config, ollama_num_ctx=num_ctx)
        user_prompt = _build_user_prompt(
            files,
            attempt_config,
            analysis_focus=analysis_focus,
            heatmap_density=heatmap_density,
            impact_bias=impact_bias,
        )
        try:
            return _chat_completion(attempt_config, SYSTEM_PROMPT, user_prompt)
        except LLMExtractionError as exc:
            last_error = exc
            if not _is_retryable_ollama_context_error(exc) or index >= len(attempts) - 1:
                raise
            next_ctx = attempts[index + 1]
            print(
                f"[enemy-threat-analysis] Ollama num_ctx={num_ctx} failed; retrying with num_ctx={next_ctx}.",
                file=sys.stderr,
                flush=True,
            )
    if last_error:
        raise last_error
    raise LLMExtractionError("Ollama 上下文重试未产生响应。")


def _build_user_prompt(
    files: Sequence[LoadedFile],
    config: LLMConfig,
    *,
    analysis_focus: str,
    heatmap_density: str,
    impact_bias: str,
) -> str:
    file_blocks = _build_file_blocks(files, config)
    return (
        USER_PROMPT_TEMPLATE
        .replace("__ANALYSIS_FOCUS__", analysis_focus)
        .replace("__HEATMAP_DENSITY__", heatmap_density)
        .replace("__IMPACT_BIAS__", impact_bias)
        .replace("__FILE_BLOCKS__", file_blocks)
    )


def parse_llm_extraction(content: str) -> ThreatExtractionJson:
    """Parse JSON returned by the model and validate the extraction schema."""
    json_text = _extract_json_text(content)
    try:
        payload = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise LLMExtractionError(f"大模型未返回合法 JSON: {exc}") from exc
    try:
        repaired = _coerce_extraction_payload(payload)
        return ThreatExtractionJson.model_validate(repaired)
    except Exception as exc:
        try:
            return ThreatExtractionJson.model_validate(payload)
        except Exception as repaired_exc:
            raise LLMExtractionError(f"大模型 JSON 不符合 threat-extraction-v1: {repaired_exc}") from exc


def _chat_completion(config: LLMConfig, system_prompt: str, user_prompt: str) -> str:
    if _is_ollama_backend(config):
        return _ollama_chat_completion(config, system_prompt, user_prompt)

    url = _chat_completion_url(config.base_url)
    payload = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    if config.stream:
        payload["stream"] = True
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=_openai_headers(config),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
            if config.stream:
                return _read_streaming_chat_response(response, label="enemy-threat-analysis", echo=config.stream_to_stdout)
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise LLMExtractionError(f"大模型 API HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise LLMExtractionError(f"大模型 API 请求失败: {exc}") from exc

    try:
        data = json.loads(body)
        return data["choices"][0]["message"]["content"]
    except Exception as exc:
        raise LLMExtractionError(f"大模型 API 响应格式异常: {body[:500]}") from exc


def _ollama_chat_completion(config: LLMConfig, system_prompt: str, user_prompt: str) -> str:
    if not config.ollama_host:
        raise LLMExtractionError("未配置 Ollama 地址。")
    request = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
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
                raise LLMExtractionError(_ollama_response_error_message(retry_exc, retried_without_json=True)) from retry_exc
            except Exception as retry_exc:
                raise LLMExtractionError(f"Ollama API 请求失败: {retry_exc}") from retry_exc
        raise LLMExtractionError(_ollama_response_error_message(exc)) from exc
    except Exception as exc:
        raise LLMExtractionError(f"Ollama API 请求失败: {exc}") from exc


def _post_ollama_chat(host: str, request: dict[str, Any], config: LLMConfig) -> str:
    client = ollama.Client(
        host=_ollama_client_host(host),
        timeout=config.timeout_seconds,
        trust_env=False,
    )
    response = client.chat(**request)
    if config.stream:
        return _read_streaming_ollama_chat_response(response, label="enemy-threat-analysis", echo=config.stream_to_stdout)
    return _extract_ollama_message_content(response)

    try:
        data = json.loads(body)
        return data["message"]["content"]
    except Exception as exc:
        raise LLMExtractionError(f"Ollama API 响应格式异常: {body[:500]}") from exc


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


def _chat_completion_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


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


def _build_file_blocks(files: Sequence[LoadedFile], config: LLMConfig) -> str:
    file_count = max(1, len(files))
    if _is_ollama_backend(config):
        total_limit, max_limit, min_limit = _ollama_file_char_limits(config.ollama_num_ctx)
        max_chars = max(
            min_limit,
            min(max_limit, total_limit // file_count),
        )
    else:
        max_chars = OPENAI_FILE_PROMPT_CHAR_LIMIT
    return "\n\n---\n\n".join(item.prompt_block(max_chars=max_chars) for item in files)


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
        return OLLAMA_FILE_PROMPT_TOTAL_CHAR_LIMIT, OLLAMA_FILE_PROMPT_MAX_CHAR_LIMIT, OLLAMA_FILE_PROMPT_MIN_CHAR_LIMIT
    if num_ctx >= 131_072:
        return 100_000, 50_000, 4_000
    if num_ctx >= 65_536:
        return 48_000, 24_000, 2_000
    if num_ctx >= 32_768:
        return 20_000, 10_000, 1_200
    return 8_000, 4_000, 600


def _is_retryable_ollama_context_error(exc: Exception) -> bool:
    message = str(exc)
    return "Ollama API HTTP 5" in message or "Ollama API 请求失败" in message


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
    message = f"Ollama API HTTP {code}"
    if detail:
        message = f"{message}: {detail}"
    if code >= 500:
        suffix = (
            "提示：Ollama 测试连接只验证小型请求，正式敌情抽取会携带文件上下文；"
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


def _openai_headers(config: LLMConfig) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    return headers


def _is_ollama_backend(config: LLMConfig) -> bool:
    return str(getattr(config, "backend", "") or "").strip().lower().replace("_", "-") in {"ollama", "local-ollama", "local"}


def _extract_json_text(content: str) -> str:
    text = str(content or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        candidate = text[match.start() :]
        try:
            payload, _ = decoder.raw_decode(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return json.dumps(payload, ensure_ascii=False)
    raise LLMExtractionError("大模型响应中未找到 JSON 对象。")


def _coerce_extraction_payload(payload: Any) -> dict[str, Any]:
    data = dict(payload or {}) if isinstance(payload, dict) else {}
    data.setdefault("schemaVersion", "threat-extraction-v1")
    data["globalSituation"] = _coerce_global_situation(data)
    data["targetCategories"] = _coerce_target_categories(data.get("targetCategories"))
    data["targets"] = [_coerce_target(item, index) for index, item in enumerate(_as_list(data.get("targets")), start=1)]
    data["relations"] = [_coerce_relation(item, index) for index, item in enumerate(_as_list(data.get("relations")), start=1)]
    data["spatialContext"] = _coerce_spatial_context(data.get("spatialContext"))
    data["warnings"] = [_coerce_warning(item, index) for index, item in enumerate(_as_list(data.get("warnings")), start=1)]
    return data


def _coerce_global_situation(data: dict[str, Any]) -> dict[str, Any]:
    raw = data.get("globalSituation")
    situation = dict(raw or {}) if isinstance(raw, dict) else {}
    intent_candidates = (
        situation.get("enemyIntentions")
        or situation.get("intentions")
        or data.get("enemyIntentions")
        or data.get("intentions")
        or data.get("operationalIntent")
        or data.get("intent")
    )
    intentions = []
    for index, item in enumerate(_as_list(intent_candidates), start=1):
        if isinstance(item, dict):
            intent = dict(item)
        else:
            intent = {"description": str(item)}
        description = str(intent.get("description") or intent.get("summary") or intent.get("text") or "").strip()
        name = str(intent.get("name") or intent.get("title") or "").strip()
        intent_type = str(intent.get("type") or _infer_intention_type(description or name)).strip()
        intentions.append(
            {
                "id": intent.get("id") or f"intent-{index}",
                "type": intent_type or "other",
                "name": name or _intention_name(intent_type),
                "description": description or name or "敌方意图由文档线索推断，需结合后续研判复核。",
                "confidence": _confidence_number(intent.get("confidence"), 0.55),
                "evidenceIds": [str(value) for value in _as_list(intent.get("evidenceIds") or intent.get("evidence_ids")) if str(value)],
            }
        )
    situation["enemyIntentions"] = intentions
    situation.setdefault("deploymentPosture", data.get("deploymentPosture") or data.get("deployment_posture") or "unknown")
    situation.setdefault("mainThreatDirection", data.get("mainThreatDirection") or data.get("main_threat_direction") or "")
    situation.setdefault(
        "situationSummary",
        data.get("situationSummary")
        or data.get("situation_summary")
        or data.get("summary")
        or "",
    )
    return situation


def _coerce_target_categories(value: Any) -> list[dict[str, Any]]:
    categories = []
    labels = {
        "fire_unit": "火力打击单位",
        "air_defense": "防空节点",
        "recon_sensor": "侦察预警节点",
        "command_control": "指挥控制节点",
        "mobility_unit": "机动兵力",
        "logistics_support": "后勤保障节点",
        "fortification": "阵地工事/反机降设施",
        "electronic_warfare": "电子对抗节点",
        "unknown": "未知目标",
    }
    for item in _as_list(value):
        if isinstance(item, dict):
            categories.append(item)
        else:
            key = str(item or "unknown").strip() or "unknown"
            categories.append({"category": key, "label": labels.get(key, key)})
    return categories


def _coerce_spatial_context(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        context = dict(value or {})
    elif isinstance(value, list):
        context = {"terrain": value}
    else:
        context = {}
    for key in ["terrain", "weather", "civilianOrRestrictedAreas"]:
        context[key] = _coerce_context_items(context.get(key), key)
    return context


def _coerce_context_items(value: Any, key: str) -> list[dict[str, Any]]:
    items = []
    for index, item in enumerate(_as_list(value), start=1):
        if isinstance(item, dict):
            items.append(item)
            continue
        text = str(item or "").strip()
        if text:
            items.append({"id": f"{key}-{index}", "description": text})
    return items


def _coerce_target(value: Any, index: int) -> dict[str, Any]:
    target = dict(value or {}) if isinstance(value, dict) else {"name": str(value)}
    target.setdefault("id", f"target-{index:03d}")
    target.setdefault("name", target["id"])
    target["groupId"] = str(
        target.get("groupId")
        or target.get("group_id")
        or target.get("clusterId")
        or target.get("cluster_id")
        or target.get("targetGroupId")
        or target.get("target_group_id")
        or ""
    ).strip()
    target["groupName"] = str(
        target.get("groupName")
        or target.get("group_name")
        or target.get("clusterName")
        or target.get("cluster_name")
        or target.get("targetGroupName")
        or target.get("target_group_name")
        or ""
    ).strip()
    target.setdefault("category", "unknown")
    target["subCategory"] = str(target.get("subCategory") or target.get("sub_category") or "")
    target.setdefault("camp", "red")
    if not str(target.get("camp") or "").strip():
        target["camp"] = "red"
    target.setdefault("status", "unknown")
    target["location"] = _coerce_location(target.get("location"), target)
    target["mobility"] = _coerce_mobility(target.get("mobility"))
    target["capabilities"] = _coerce_capabilities(target.get("capabilities"), target)
    target["coverage"] = _coerce_coverage(target.get("coverage"), target)
    target["equipment"] = _coerce_equipment(target.get("equipment"))
    target["importance"] = _coerce_importance(target.get("importance"))
    target["evidence"] = _coerce_evidence(target.get("evidence"), target, index)
    target["confidence"] = _coerce_confidence(target.get("confidence"))
    return target


def _coerce_location(value: Any, target: dict[str, Any]) -> dict[str, Any]:
    if isinstance(value, dict):
        location = dict(value)
    else:
        location = {"locationDescription": str(value or target.get("locationDescription") or "")}
    coordinates = (
        location.get("coordinates")
        or target.get("coordinates")
        or _coordinates_from_lon_lat(target)
        or _parse_coordinates_from_text(" ".join(str(item) for item in [value, target.get("notes"), target.get("description")] if item))
    )
    location.setdefault("type", "point")
    location["coordinates"] = coordinates
    location["coordinateConfidence"] = _confidence_number(location.get("coordinateConfidence") or target.get("locationConfidence"), 0.6)
    location.setdefault("locationDescription", str(value) if isinstance(value, str) else "")
    return location


def _coerce_mobility(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        data = dict(value)
    else:
        text = str(value or "").lower()
        data = {
            "isMobile": any(token in text for token in ["mobile", "机动", "motorized"]),
            "estimatedSpeedLevel": text or "unknown",
        }
    data.setdefault("mobilityLevel", 0.5 if data.get("isMobile") else 0.2)
    data.setdefault("relocationProbability", 0.3 if data.get("isMobile") else 0.1)
    return data


def _coerce_capabilities(value: Any, target: dict[str, Any]) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    text = " ".join(str(item) for item in _as_list(value) + [target.get("name"), target.get("category"), target.get("notes")])
    category = str(target.get("category") or "unknown")
    data = {
        "firepower": 0.2,
        "airDefense": 0.1,
        "reconnaissance": 0.1,
        "commandControl": 0.1,
        "mobility": 0.2,
        "protection": 0.3,
        "logistics": 0.1,
        "electronicWarfare": 0.1,
    }
    if category == "fire_unit" or any(word in text for word in ["火力", "压制", "炮", "导弹"]):
        data.update({"firepower": 0.85, "mobility": 0.45, "protection": 0.45})
    if category == "air_defense" or any(word in text for word in ["防空", "拦截", "对空"]):
        data.update({"airDefense": 0.9, "reconnaissance": 0.45, "protection": 0.5})
    if category == "recon_sensor" or any(word in text for word in ["侦察", "预警", "雷达", "探测"]):
        data.update({"reconnaissance": 0.85, "commandControl": 0.35})
    if category == "fortification" or any(word in text for word in ["反机降", "障碍", "伏击", "阵地"]):
        data.update({"protection": 0.65, "mobility": 0.15, "firepower": 0.45})
    return data


def _coerce_coverage(value: Any, target: dict[str, Any]) -> dict[str, Any]:
    if isinstance(value, dict):
        data = dict(value)
    else:
        radius = _numeric(value, 0.0)
        if 0 < radius < 1000:
            radius *= 1000
        data = {"radiusMeters": radius}
    category = str(target.get("category") or "unknown")
    radius = _numeric(data.get("radiusMeters") or data.get("radius") or data.get("coverageRadius"), 0.0)
    if 0 < radius < 1000:
        radius *= 1000
    coverage_types = [str(item) for item in _as_list(data.get("coverageTypes") or data.get("coverage_types")) if str(item)]
    has_coverage = _boolish(data.get("hasCoverage"), None)
    if radius <= 0 and category in DEFAULT_COVERAGE_RADIUS_BY_CATEGORY and has_coverage is not False:
        radius = DEFAULT_COVERAGE_RADIUS_BY_CATEGORY[category]
    if has_coverage is None:
        has_coverage = radius > 0 and (category in DEFAULT_COVERAGE_RADIUS_BY_CATEGORY or bool(coverage_types))
    if not has_coverage:
        radius = 0.0
    data["hasCoverage"] = bool(has_coverage)
    data["radiusMeters"] = radius
    data.setdefault("minRadiusMeters", 0)
    data["maxRadiusMeters"] = max(_numeric(data.get("maxRadiusMeters"), radius), radius)
    data["coverageConfidence"] = _confidence_number(data.get("coverageConfidence"), 0.6)
    data["coverageTypes"] = coverage_types if has_coverage else []
    if has_coverage and not data["coverageTypes"]:
        data["coverageTypes"] = _coverage_types_for_category(category)
    return data


def _coerce_equipment(value: Any) -> list[dict[str, Any]]:
    items = []
    for item in _as_list(value):
        if isinstance(item, dict):
            equipment = dict(item)
        else:
            equipment = {"name": str(item), "type": "unknown"}
        equipment.setdefault("quantity", 1)
        equipment["quantity"] = _quantity_number(equipment.get("quantity"), 1)
        equipment["quantityConfidence"] = _confidence_number(equipment.get("quantityConfidence"), 0.6)
        equipment["capabilityTags"] = [str(value) for value in _as_list(equipment.get("capabilityTags")) if str(value)]
        items.append(equipment)
    return items


def _coerce_importance(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        data = dict(value)
    else:
        score = _confidence_number(value, 0.5)
        data = {
            "missionRelevance": score,
            "systemCentrality": score,
            "replaceability": 1.0 - score,
            "supportDependency": 0.5,
        }
    return data


def _coerce_evidence(value: Any, target: dict[str, Any], target_index: int) -> list[dict[str, Any]]:
    items = []
    for evidence_index, item in enumerate(_as_list(value), start=1):
        if isinstance(item, dict):
            evidence = dict(item)
        else:
            evidence = {"text": str(item)}
        evidence.setdefault("evidenceId", f"ev-{target_index}-{evidence_index}")
        evidence.setdefault("sourceFileId", "file-1")
        evidence.setdefault("sourceFileName", "")
        evidence["confidence"] = _confidence_number(evidence.get("confidence"), 0.6)
        items.append(evidence)
    if not items and target.get("notes"):
        items.append({"evidenceId": f"ev-{target_index}-1", "text": str(target["notes"]), "confidence": 0.5})
    return items


def _coerce_confidence(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        data = dict(value)
        overall = _confidence_number(data.get("overallConfidence"), 0.6)
    else:
        overall = _confidence_number(value, 0.6)
        data = {}
    data.setdefault("classificationConfidence", overall)
    data.setdefault("capabilityConfidence", overall)
    data.setdefault("locationConfidence", overall)
    data["overallConfidence"] = overall
    return data


def _coerce_relation(value: Any, index: int) -> dict[str, Any]:
    relation = dict(value or {}) if isinstance(value, dict) else {"description": str(value)}
    relation.setdefault("id", f"rel-{index:03d}")
    relation.setdefault("type", "unknown")
    relation.setdefault("sourceTargetId", "")
    relation.setdefault("targetTargetId", "")
    relation["confidence"] = _confidence_number(relation.get("confidence"), 0.6)
    return relation


def _coerce_warning(value: Any, index: int) -> dict[str, Any]:
    if isinstance(value, dict):
        warning = dict(value)
    else:
        warning = {"message": str(value)}
    warning.setdefault("type", "llm_warning")
    warning.setdefault("severity", "medium")
    return warning


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _confidence_number(value: Any, default: float) -> float:
    if isinstance(value, (int, float)):
        number = float(value)
        return number / 100.0 if 1.0 < number <= 100.0 else max(0.0, min(number, 1.0))
    text = str(value or "").strip().lower()
    mapping = {
        "high": 0.85,
        "高": 0.85,
        "medium": 0.6,
        "中": 0.6,
        "low": 0.35,
        "低": 0.35,
        "unknown": default,
        "": default,
    }
    return mapping.get(text, _numeric(text, default))


def _boolish(value: Any, default: bool | None = False) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value or "").strip().lower()
    if not text:
        return default
    if text in {"true", "1", "yes", "y", "有", "是"}:
        return True
    if text in {"false", "0", "no", "n", "无", "否"}:
        return False
    return default


def _quantity_number(value: Any, default: int = 1) -> int:
    if isinstance(value, (int, float)):
        return max(0, int(round(float(value))))
    text = str(value or "").strip().lower()
    if not text:
        return default
    first_number = re.search(r"\d+(?:\.\d+)?", text)
    if first_number:
        return max(0, int(round(float(first_number.group(0)))))
    mapping = {
        "estimated": default,
        "estimate": default,
        "approx": default,
        "approximate": default,
        "unknown": default,
        "various": default,
        "multiple": 2,
        "several": 3,
        "many": 4,
        "少量": 1,
        "若干": 2,
        "多套": 2,
        "多种": default,
        "多个": 2,
        "大量": 4,
        "不明": default,
        "未知": default,
    }
    return mapping.get(text, default)


def _numeric(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coordinates_from_lon_lat(target: dict[str, Any]) -> list[float] | None:
    lon = target.get("longitude") or target.get("lon") or target.get("lng")
    lat = target.get("latitude") or target.get("lat")
    if lon is None or lat is None:
        return None
    try:
        return [float(lon), float(lat), float(target.get("altitude") or 0)]
    except (TypeError, ValueError):
        return None


def _parse_coordinates_from_text(text: str) -> list[float] | None:
    matches = re.findall(r"([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)", text or "")
    if not matches:
        return None
    first, second = matches[0]
    a, b = float(first), float(second)
    if abs(a) <= 90 and abs(b) > 90:
        lat, lon = a, b
    else:
        lon, lat = a, b
    if -180 <= lon <= 180 and -90 <= lat <= 90:
        return [lon, lat, 0]
    return None


def _coverage_types_for_category(category: str) -> list[str]:
    return {
        "fire_unit": ["fire"],
        "air_defense": ["air_defense"],
        "recon_sensor": ["recon"],
        "fortification": ["anti_airborne"],
        "electronic_warfare": ["electronic_warfare"],
    }.get(category, [])


def _infer_intention_type(text: str) -> str:
    if any(word in text for word in ["火力", "压制", "打击"]):
        return "fire_suppression"
    if any(word in text for word in ["防空", "拒止", "拦截"]):
        return "air_defense_denial"
    if any(word in text for word in ["侦察", "预警", "探测"]):
        return "reconnaissance_warning"
    if any(word in text for word in ["反机降", "阻滞", "伏击"]):
        return "counter_airlanding"
    if any(word in text for word in ["机动", "反击", "增援"]):
        return "mobility_interdiction"
    if any(word in text for word in ["指挥", "控制", "协同"]):
        return "command_control"
    return "other"


def _intention_name(intent_type: str) -> str:
    return {
        "fire_suppression": "火力压制准备",
        "air_defense_denial": "防空拒止",
        "reconnaissance_warning": "侦察预警",
        "counter_airlanding": "反机降阻滞",
        "mobility_interdiction": "机动阻滞",
        "command_control": "指挥协同",
        "other": "综合作战企图",
    }.get(intent_type, "综合作战企图")
