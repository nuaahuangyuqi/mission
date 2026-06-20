"""LLM client implementations."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from battle_planner.llm.parsing import extract_json_object
from battle_planner.llm.prompts import build_enemy_rule_messages, build_friendly_structure_messages
from battle_planner.models import AppConfig, DispositionRule, EnemyTarget


class LLMError(RuntimeError):
    """Raised when a required LLM call fails."""


class LLMClient(ABC):
    @abstractmethod
    def complete_json(self, system_prompt: str, user_prompt: str) -> Dict[str, Any]:
        """Run a completion request and return a parsed JSON object."""

    def extract_disposition_rules(self, targets: List[EnemyTarget]) -> Dict[str, Any]:
        system_prompt, user_prompt = build_enemy_rule_messages(targets)
        return self.complete_json(system_prompt, user_prompt)

    def generate_friendly_structure(
        self,
        document: Any,
        targets: List[EnemyTarget],
        rules: List[DispositionRule],
    ) -> Dict[str, Any]:
        system_prompt, user_prompt = build_friendly_structure_messages(document, targets, rules)
        return self.complete_json(system_prompt, user_prompt)


class OpenAIClient(LLMClient):
    def __init__(self, api_key: str, base_url: Optional[str], model_name: str, temperature: float, timeout: int):
        if not api_key:
            raise LLMError("OpenAI provider 缺少 api_key")
        if not model_name:
            raise LLMError("OpenAI provider 缺少 model_name")
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise LLMError("当前环境未安装 openai 库") from exc
        kwargs: Dict[str, Any] = {"api_key": api_key, "timeout": timeout}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = OpenAI(**kwargs)
        self._model_name = model_name
        self._temperature = temperature

    def complete_json(self, system_prompt: str, user_prompt: str) -> Dict[str, Any]:
        try:
            response = self._client.chat.completions.create(
                model=self._model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=self._temperature,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content or ""
            return extract_json_object(content)
        except Exception as exc:  # noqa: BLE001 - LLM errors should stop the pipeline with context.
            raise LLMError(f"OpenAI 大模型调用失败: {exc}") from exc


class OllamaClient(LLMClient):
    def __init__(self, model_name: str, temperature: float = 0.1):
        if not model_name:
            raise LLMError("Ollama provider 缺少 model_name")
        try:
            import ollama
        except ImportError as exc:
            raise LLMError("当前环境未安装 ollama 库") from exc
        self._ollama = ollama
        self._model_name = model_name
        self._temperature = temperature

    def complete_json(self, system_prompt: str, user_prompt: str) -> Dict[str, Any]:
        try:
            response = self._ollama.chat(
                model=self._model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                format="json",
                options={"temperature": self._temperature},
            )
            content = response["message"]["content"]
            return extract_json_object(content)
        except Exception as exc:  # noqa: BLE001
            raise LLMError(f"Ollama 大模型调用失败: {exc}") from exc


class MockLLMClient(LLMClient):
    """Deterministic offline client used by examples and tests."""

    def complete_json(self, system_prompt: str, user_prompt: str) -> Dict[str, Any]:
        if "处置规则" in user_prompt and "敌方目标" in user_prompt and "己方文档" not in user_prompt:
            return self._mock_rules(user_prompt)
        return self._mock_friendly_structure(user_prompt)

    def _mock_rules(self, user_prompt: str) -> Dict[str, Any]:
        payload = _json_after_label(user_prompt, "敌方目标：")
        rules = []
        for target in payload:
            target_type = str(target.get("target_type", "未知目标"))
            action = "摧毁"
            requires_recon = False
            requires_air_assault = False
            if "防空" in target_type:
                action = "优先压制，必要时摧毁"
            elif "通信" in target_type:
                action = "摧毁"
                if target.get("value", 0) >= 8:
                    action = "机降夺控"
                    requires_air_assault = True
            elif "侦察" in target_type or "预警" in target_type:
                action = "侦察确认后摧毁"
                requires_recon = True
            elif "后勤" in target_type or "补给" in target_type:
                action = "破袭"
            elif "预备队" in target_type:
                action = "压制"
            elif "工程" in target_type or "障碍" in target_type:
                action = "摧毁或机降夺控"
                requires_air_assault = target.get("value", 0) >= 7
            rules.append(
                {
                    "target_id": target.get("id", ""),
                    "target_name": target.get("name", ""),
                    "target_type": target_type,
                    "action": action,
                    "task_type": "",
                    "damage_requirement": 0.85 if "摧毁" in action else 0.65,
                    "suppression_requirement": 0.75 if "压制" in action else 0.0,
                    "requires_recon": requires_recon,
                    "requires_escort": bool(target.get("threat", 0) >= 7),
                    "requires_air_assault": requires_air_assault,
                    "priority_adjustment": -1 if "防空" in target_type else 0,
                    "allowed_methods": ["武装直升机火力", "机降夺控"] if requires_air_assault else ["武装直升机火力"],
                    "notes": "Mock LLM 根据目标类型生成的处置规则",
                }
            )
        return {"rules": rules}

    def _mock_friendly_structure(self, user_prompt: str) -> Dict[str, Any]:
        json_hint = _try_extract_document_json(user_prompt)
        if json_hint:
            return {"friendly_forces": json_hint}
        return {
            "friendly_forces": {
                "helicopters": [
                    {
                        "model": "二型武装直升机",
                        "role": "armed",
                        "available": 8,
                        "capabilities": ["防空压制", "火力打击", "火力压制", "通信压制", "破袭打击", "护航"],
                        "weapon_capacity": {"空地导弹": 4, "火箭弹": 16, "航炮弹": 300},
                        "personnel_capacity": 0,
                        "max_loss_rate": 0.12,
                    },
                    {
                        "model": "侦察直升机",
                        "role": "recon",
                        "available": 2,
                        "capabilities": ["侦察确认"],
                        "weapon_capacity": {},
                        "personnel_capacity": 0,
                        "max_loss_rate": 0.08,
                    },
                    {
                        "model": "运输直升机",
                        "role": "transport",
                        "available": 5,
                        "capabilities": ["机降突击", "人员输送"],
                        "weapon_capacity": {},
                        "personnel_capacity": 12,
                        "max_loss_rate": 0.10,
                    },
                ],
                "weapons": [
                    {"name": "空地导弹", "available": 32, "effects": ["摧毁", "压制"]},
                    {"name": "火箭弹", "available": 180, "effects": ["压制", "摧毁", "破袭"]},
                    {"name": "航炮弹", "available": 4200, "effects": ["压制", "火力打击"]},
                ],
                "personnel": [{"role": "机降突击人员", "available": 72}],
                "task_capabilities": ["防空压制", "火力打击", "火力压制", "通信压制", "破袭打击", "侦察确认", "机降突击"],
                "grouping_rules": {
                    "min_armed_group_size": 1,
                    "max_armed_group_size": 6,
                    "min_transport_group_size": 1,
                    "max_transport_group_size": 5,
                    "reserve_ratio": 0.15,
                    "escort_ratio": 0.5,
                    "multi_target_same_group": False,
                },
                "constraints": {
                    "max_allowed_loss_rate": 0.12,
                    "default_air_assault_personnel": 24,
                    "recon_escort_threat_threshold": 6.0,
                    "preserve_reserve": True,
                },
                "source_summary": "Mock LLM 从示例文档抽取的己方资源结构",
                "warnings": [],
            }
        }


def _json_after_label(text: str, label: str) -> Any:
    index = text.rfind(label)
    if index < 0:
        return []
    raw = text[index + len(label) :].strip()
    return json.loads(raw)


def _try_extract_document_json(user_prompt: str) -> Dict[str, Any]:
    marker = "己方文档内容："
    start = user_prompt.find(marker)
    end = user_prompt.find("\n敌方目标：", start)
    if start < 0 or end < 0:
        return {}
    content = user_prompt[start + len(marker) : end].strip()
    if not content.startswith("{"):
        return {}
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return {}
    if "friendly_forces" in data and isinstance(data["friendly_forces"], dict):
        return data["friendly_forces"]
    return data if isinstance(data, dict) else {}


def build_llm_client(config: AppConfig) -> LLMClient:
    provider = config.llm.provider
    if provider == "openai":
        settings = config.llm.openai
        return OpenAIClient(
            api_key=settings.api_key or "",
            base_url=settings.base_url,
            model_name=settings.model_name or "",
            temperature=settings.temperature,
            timeout=settings.timeout_seconds,
        )
    if provider == "ollama":
        settings = config.llm.ollama
        return OllamaClient(model_name=settings.model_name or "", temperature=settings.temperature)
    return MockLLMClient()
