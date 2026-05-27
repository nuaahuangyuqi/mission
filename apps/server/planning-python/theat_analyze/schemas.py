"""
schemas.py — 态势数据的 Pydantic V2 数据模型定义

本模块定义了军事情报处理管道中所有结构化数据的数据模型，
包括威胁因素、目标实体与态势图等核心 Schema。
所有模型基于 Pydantic V2，支持 LLM 结构化输出约束与 JSON Schema 生成。
"""

import re

from pydantic import BaseModel, Field, field_validator
from typing import List, Dict


class ThreatFactors(BaseModel):
    """单个目标实体的威胁量化因子模型。

    包含四个维度的威胁指标，用于 AHP 加权计算基础威胁指数 (Base Threat Index)。
    所有数值均为标量，便于后续 Min-Max 归一化处理。
    """

    lethality_range_km: float = Field(
        ...,
        description="最大硬杀伤或软杀伤有效距离(km)。"
                    "例如防空导弹的杀伤远界、电子战设备的有效干扰半径等。"
    )
    ew_erp_mw: float = Field(
        0.0,
        description="电子战有效辐射功率(MW)。非电战设备（如纯火力单元）设为 0.0。"
    )
    survivability_score: int = Field(
        ...,
        ge=1,
        le=10,
        description="生存能力评分(1-10)。"
                    "深层地下掩体/反斜面阵地为 9-10，开阔地暴露目标为 1-3。"
    )
    target_value: int = Field(
        ...,
        ge=1,
        le=10,
        description="目标高价值指数(1-10)。"
                    "旅级C2指挥所/主预警雷达为 9-10，普通步兵哨位为 1-3。"
    )
    air_defense_score: int = Field(
        1,
        ge=1,
        le=10,
        description="对直升机编组的防空拦截威胁评分(1-10)。"
                    "中远程防空导弹/火控雷达为 8-10，便携防空/高炮为 5-8，非防空目标为 1-3。"
    )
    recon_warning_score: int = Field(
        1,
        ge=1,
        le=10,
        description="侦察预警与低空发现能力评分(1-10)。"
                    "主预警雷达/被动测向/低空监视网为 8-10，普通观察哨为 3-6。"
    )
    anti_airlanding_score: int = Field(
        1,
        ge=1,
        le=10,
        description="反机降/反直升机着陆阻滞能力评分(1-10)。"
                    "机降场障碍、反机降伏击阵地、预设火力区为 7-10，普通阵地为 1-4。"
    )


class TargetEntity(BaseModel):
    """单个目标实体的完整描述模型。

    聚合了目标的标识信息、地理坐标、威胁朝向、量化因子与装备参数。
    作为 LLM 结构化输出的原子单元。
    """

    target_id: str = Field(
        ...,
        description="目标编号，如 'C2-01', 'SAM-01', 'EA-01'。"
                    "遵循 '类别缩写-序号' 格式。"
    )
    target_category: str = Field(
        ...,
        description="目标类别。取值范围："
                    "C2指挥 / 雷达预警 / 防空阵地 / 炮兵阵地 / 电子战 / "
                    "步兵阵地 / 后勤节点 / 火力节点 / 通信节点 / 侦察节点 / "
                    "预备队 / 预警节点 / 电子战/诱饵"
    )
    target_name: str = Field(
        "",
        description="目标名称的完整描述，如 '旅基本指挥所主控方舱'"
    )
    description: str = Field(
        "",
        description="根据原文情报提取的该目标的详细战术描述与原文摘要（50-200字）。"
    )
    raw_coordinates: str = Field(
        ...,
        description="可解析的 WGS84 坐标字符串。"
                    "必须包含纬度和经度两个数字，并使用逗号分隔。"
                    "例如 '23.2885°N, 114.0078°E'、'23°17'18.6\"N, 114°0'28.1\"E' 或 '23.2885, 114.0078'。"
                    "禁止使用 N/A、NA、未知、无、null、None、- 等占位值；原文缺失坐标时必须根据地名估算近似经纬度。"
    )
    heading_angle: float = Field(
        ...,
        description="主要威胁朝向角度(0-360，正北为0，顺时针)。"
                    "全向设备（如全向雷达、全向迫榴炮）设为 -1。"
                    "定向天线/导弹阵地的射界中心方位角。"
    )
    factors: ThreatFactors
    equip_params: Dict[str, str] = Field(
        default_factory=dict,
        description="其他核心装备参数字典。"
                    "例如 {'max_targets': '8', 'reaction_time_s': '6-8'}。"
    )
    confidence: float = Field(
        1.0,
        ge=0.0,
        le=1.0,
        description="数据置信度(0.0-1.0)。原文明确写出的给 0.9-1.0；部分缺失靠常识推断的给 0.6-0.8；完全缺失靠纯猜测补全的给 0.1-0.5。"
    )

    @field_validator("raw_coordinates")
    @classmethod
    def validate_raw_coordinates_shape(cls, value: str) -> str:
        text = str(value).strip()
        normalized = re.sub(r"\s+", "", text).lower().replace("\\", "/")
        placeholders = {
            "",
            "n/a",
            "na",
            "none",
            "null",
            "unknown",
            "unk",
            "无",
            "未知",
            "不详",
            "未提供",
            "待定",
            "-",
        }
        if normalized in placeholders:
            raise ValueError("raw_coordinates 不能是缺失占位值，必须是可解析的经纬度坐标")

        numbers = re.findall(r"[+-]?\d+(?:\.\d+)?", text)
        if len(numbers) < 2 or not re.search(r"[,，]", text):
            raise ValueError("raw_coordinates 必须至少包含两个数字并用逗号分隔")

        return text


class SituationMap(BaseModel):
    """态势图数据模型 — LLM 结构化输出的顶层容器。

    聚合所有从情报文档中提取的目标实体列表，
    是整个管道的数据中枢。
    """

    targets: List[TargetEntity] = Field(
        ...,
        description="从情报文档中提取的所有目标实体列表。"
    )
    enemy_force_type: str = Field(
        "未知",
        description="基于文档与模型世界知识判断的敌方军队类型，如台军、越军、美军、英军、日军等。"
    )
    enemy_force_type_confidence: float = Field(
        0.0,
        ge=0.0,
        le=1.0,
        description="敌方军队类型判断置信度。"
    )
    enemy_force_type_basis: str = Field(
        "",
        description="判断军队类型的主要依据，50-150字。"
    )
