"""Prompt builders for the two LLM extraction stages."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from battle_planner.io import FriendlyDocument
from battle_planner.models import DispositionRule, EnemyTarget


ENEMY_RULE_SCHEMA: Dict[str, Any] = {
    "rules": [
        {
            "target_id": "T001",
            "target_name": "目标名称",
            "target_type": "目标类型",
            "action": "压制/摧毁/破袭/侦察确认/机降夺控",
            "task_type": "防空压制/火力打击/火力压制/通信压制/破袭打击/侦察确认/机降突击",
            "damage_requirement": 0.8,
            "suppression_requirement": 0.7,
            "requires_recon": False,
            "requires_escort": False,
            "requires_air_assault": False,
            "priority_adjustment": 0,
            "allowed_methods": ["武装直升机火力打击"],
            "notes": "规则依据",
        }
    ]
}


FRIENDLY_SCHEMA: Dict[str, Any] = {
    "friendly_forces": {
        "helicopters": [
            {
                "model": "二型武装直升机",
                "role": "armed",
                "available": 8,
                "capabilities": ["防空压制", "火力打击", "护航"],
                "weapon_capacity": {"空地导弹": 4, "火箭弹": 16, "航炮弹": 300},
                "personnel_capacity": 0,
                "max_loss_rate": 0.12,
            }
        ],
        "weapons": [
            {"name": "空地导弹", "available": 32, "effects": ["摧毁", "压制"]},
            {"name": "火箭弹", "available": 160, "effects": ["压制", "摧毁"]},
            {"name": "航炮弹", "available": 4000, "effects": ["压制"]},
        ],
        "personnel": [{"role": "机降突击人员", "available": 60}],
        "task_capabilities": ["防空压制", "火力打击", "侦察确认", "机降突击"],
        "grouping_rules": {
            "min_armed_group_size": 1,
            "max_armed_group_size": 6,
            "min_transport_group_size": 1,
            "max_transport_group_size": 8,
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
        "source_summary": "己方资源和约束摘要",
        "warnings": [],
    }
}


FRIENDLY_UNIT_COUNT_SCHEMA: Dict[str, Any] = {
    "unitCount": 0,
    "confidence": 0.0,
}


def build_enemy_rule_messages(targets: List[EnemyTarget]) -> tuple[str, str]:
    system_prompt = (
        "你是作战规则结构化抽取助手。必须只输出一个合法 JSON 对象，不要输出解释文字。"
        "请根据敌方目标类型、威胁度、价值度、优先级、能力和意图生成处置规则。"
        "字段必须完整；未知内容使用合理默认值，不要省略字段。"
    )
    target_payload = [target.model_dump(mode="json") for target in targets]
    user_prompt = (
        "请为以下敌方目标生成标准化处置规则。\n"
        "典型规则：防空阵地优先压制必要时摧毁；通信中继站摧毁或夺控；迫击炮阵地摧毁；"
        "反装甲伏击阵地摧毁；侦察预警节点先侦察确认再摧毁；后勤补给节点破袭；"
        "机动预备队压制；工程障碍节点摧毁或机降夺控。\n"
        f"输出 JSON schema 示例：{json.dumps(ENEMY_RULE_SCHEMA, ensure_ascii=False)}\n"
        f"敌方目标：{json.dumps(target_payload, ensure_ascii=False)}"
    )
    return system_prompt, user_prompt


def build_friendly_structure_messages(
    document: FriendlyDocument,
    targets: List[EnemyTarget],
    rules: List[DispositionRule],
) -> tuple[str, str]:
    system_prompt = (
        "你是己方作战资源结构化抽取助手。必须只输出一个合法 JSON 对象，不要输出解释文字。"
        "请把自然语言、JSON 或表格文本中的直升机、武器、人员、任务能力、编组规则、"
        "战损规则和约束条件转成算法可直接处理的标准结构。字段必须完整；未知内容使用默认值并写入 warnings。"
    )
    user_prompt = (
        "请基于己方信息文档、敌方目标和敌方处置规则生成标准化己方作战资源与作战目标结构化文档。\n"
        f"输出 JSON schema 示例：{json.dumps(FRIENDLY_SCHEMA, ensure_ascii=False)}\n"
        f"己方文档类型：{document.source_type}\n"
        f"己方文档内容：\n{document.content}\n"
        f"敌方目标：{json.dumps([target.model_dump(mode='json') for target in targets], ensure_ascii=False)}\n"
        f"处置规则：{json.dumps([rule.model_dump(mode='json') for rule in rules], ensure_ascii=False)}"
    )
    return system_prompt, user_prompt


def build_friendly_unit_count_messages(document: FriendlyDocument) -> tuple[str, str]:
    system_prompt = (
        "你是己方作战力量预解析助手。必须只输出一个合法 JSON 对象，不要输出解释文字。"
        "只估计后续编组算法需要结构化的己方单位对象条目数量，不要展开数量字段。"
    )
    user_prompt = (
        "请基于己方信息文档估计后续 friendly_forces 中可编组单位对象条目总数。\n"
        "计数口径：直升机/平台型号条目、可编组人员/分队条目、显式作战单位条目各算 1 个；"
        "武器、弹药、载荷、库存数量和单项装备数量不计入单位总数，也不要按 available 数量展开。\n"
        f"输出 JSON schema 示例：{json.dumps(FRIENDLY_UNIT_COUNT_SCHEMA, ensure_ascii=False)}\n"
        f"己方文档类型：{document.source_type}\n"
        f"己方文档内容：\n{document.content}"
    )
    return system_prompt, user_prompt
