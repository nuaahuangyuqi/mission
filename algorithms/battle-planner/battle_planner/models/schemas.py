"""Shared schemas for the task grouping and force allocation pipeline."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _normalize_score(value: Any, default: float = 5.0) -> float:
    if value is None or value == "":
        return default
    if isinstance(value, (int, float)):
        return _clamp(float(value), 0.0, 10.0)
    mapping = {
        "极高": 10,
        "很高": 9,
        "高": 8,
        "较高": 7,
        "中": 5,
        "中等": 5,
        "一般": 5,
        "较低": 3,
        "低": 2,
        "很低": 1,
    }
    text = str(value).strip()
    if text in mapping:
        return float(mapping[text])
    try:
        return _clamp(float(text), 0.0, 10.0)
    except ValueError:
        return default


def _normalize_priority(value: Any, default: int = 3) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, int):
        return int(_clamp(float(value), 1, 5))
    mapping = {
        "最高": 1,
        "极高": 1,
        "高": 2,
        "较高": 2,
        "中": 3,
        "中等": 3,
        "一般": 3,
        "较低": 4,
        "低": 5,
    }
    text = str(value).strip()
    if text in mapping:
        return mapping[text]
    try:
        return int(_clamp(float(text), 1, 5))
    except ValueError:
        return default


class PlannerBaseModel(BaseModel):
    """Base model with permissive input and deterministic serialization."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class Coordinate(PlannerBaseModel):
    x: Optional[float] = None
    y: Optional[float] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    description: Optional[str] = None


class EnemyTarget(PlannerBaseModel):
    id: str = Field(default="")
    name: str = Field(default="未命名目标")
    target_type: str = Field(default="未知目标")
    threat: float = Field(default=5.0, ge=0.0, le=10.0)
    value: float = Field(default=5.0, ge=0.0, le=10.0)
    priority: int = Field(default=3, ge=1, le=5)
    coordinate: Optional[Coordinate] = None
    coverage_range_km: Optional[float] = None
    capabilities: List[str] = Field(default_factory=list)
    intent: Optional[str] = None
    system_links: List[str] = Field(default_factory=list)
    raw: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("threat", "value", mode="before")
    @classmethod
    def normalize_scores(cls, value: Any) -> float:
        return _normalize_score(value)

    @field_validator("priority", mode="before")
    @classmethod
    def normalize_priority(cls, value: Any) -> int:
        return _normalize_priority(value)

    @model_validator(mode="after")
    def ensure_id(self) -> "EnemyTarget":
        if not self.id:
            safe_name = self.name.replace(" ", "_")
            self.id = f"target_{abs(hash((safe_name, self.target_type))) % 100000}"
        return self


class EnemySituation(PlannerBaseModel):
    targets: List[EnemyTarget] = Field(default_factory=list)
    source_file: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DispositionRule(PlannerBaseModel):
    target_id: str = ""
    target_name: str = ""
    target_type: str = ""
    action: str = "摧毁"
    task_type: str = "火力打击"
    damage_requirement: float = Field(default=0.75, ge=0.0, le=1.0)
    suppression_requirement: float = Field(default=0.0, ge=0.0, le=1.0)
    requires_recon: bool = False
    requires_escort: bool = False
    requires_air_assault: bool = False
    priority_adjustment: int = 0
    notes: str = ""
    allowed_methods: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def fill_task_type(self) -> "DispositionRule":
        action = self.action or ""
        target_type = self.target_type or ""
        if self.requires_air_assault or "夺控" in action or "机降" in action:
            self.task_type = "机降突击"
        elif self.requires_recon or "侦察" in action or "确认" in action:
            self.task_type = "侦察确认"
        elif "防空" in target_type or "防空" in action:
            self.task_type = "防空压制"
            self.suppression_requirement = max(self.suppression_requirement, 0.7)
        elif "压制" in action:
            self.task_type = "火力压制"
            self.suppression_requirement = max(self.suppression_requirement, 0.6)
        elif "破袭" in action:
            self.task_type = "破袭打击"
        elif "通信" in target_type and "压制" in action:
            self.task_type = "通信压制"
        else:
            self.task_type = self.task_type or "火力打击"
        if "摧毁" in action:
            self.damage_requirement = max(self.damage_requirement, 0.8)
        return self


class WeaponStock(PlannerBaseModel):
    name: str
    available: int = Field(default=0, ge=0)
    effects: List[str] = Field(default_factory=list)


class HelicopterType(PlannerBaseModel):
    model: str
    role: Literal["armed", "transport", "recon", "utility", "escort"] = "utility"
    available: int = Field(default=0, ge=0)
    capabilities: List[str] = Field(default_factory=list)
    weapon_capacity: Dict[str, int] = Field(default_factory=dict)
    personnel_capacity: int = Field(default=0, ge=0)
    max_loss_rate: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class PersonnelResource(PlannerBaseModel):
    role: str
    available: int = Field(default=0, ge=0)


class GroupingRules(PlannerBaseModel):
    min_armed_group_size: int = Field(default=1, ge=1)
    max_armed_group_size: int = Field(default=6, ge=1)
    min_transport_group_size: int = Field(default=1, ge=1)
    max_transport_group_size: int = Field(default=8, ge=1)
    reserve_ratio: float = Field(default=0.15, ge=0.0, le=0.8)
    escort_ratio: float = Field(default=0.5, ge=0.0, le=2.0)
    multi_target_same_group: bool = False


class OperationalConstraints(PlannerBaseModel):
    max_allowed_loss_rate: float = Field(default=0.12, ge=0.0, le=1.0)
    default_air_assault_personnel: int = Field(default=24, ge=0)
    recon_escort_threat_threshold: float = Field(default=6.0, ge=0.0, le=10.0)
    preserve_reserve: bool = True
    allow_reserve_release: bool = True
    reserve_release_priority_threshold: int = Field(default=2, ge=1, le=5)
    allow_cross_task_reallocation: bool = False


class FriendlyForces(PlannerBaseModel):
    helicopters: List[HelicopterType] = Field(default_factory=list)
    weapons: List[WeaponStock] = Field(default_factory=list)
    personnel: List[PersonnelResource] = Field(default_factory=list)
    grouping_rules: GroupingRules = Field(default_factory=GroupingRules)
    constraints: OperationalConstraints = Field(default_factory=OperationalConstraints)
    task_capabilities: List[str] = Field(default_factory=list)
    source_summary: str = ""
    warnings: List[str] = Field(default_factory=list)


class AlgorithmConfig(PlannerBaseModel):
    default_max_loss_rate: float = Field(default=0.12, ge=0.0, le=1.0)
    reserve_ratio: float = Field(default=0.15, ge=0.0, le=0.8)
    escort_ratio: float = Field(default=0.5, ge=0.0, le=2.0)
    max_group_size: int = Field(default=6, ge=1)
    default_air_assault_personnel: int = Field(default=24, ge=0)
    recon_escort_threat_threshold: float = Field(default=6.0, ge=0.0, le=10.0)
    allow_reserve_release: bool = True
    reserve_release_priority_threshold: int = Field(default=2, ge=1, le=5)
    allow_cross_task_reallocation: bool = False
    weapon_consumption: Dict[str, Dict[str, int]] = Field(
        default_factory=lambda: {
            "防空压制": {"空地导弹": 2, "火箭弹": 8, "航炮弹": 120},
            "火力打击": {"空地导弹": 1, "火箭弹": 6, "航炮弹": 80},
            "火力压制": {"火箭弹": 8, "航炮弹": 120},
            "通信压制": {"火箭弹": 6, "航炮弹": 100},
            "破袭打击": {"火箭弹": 4, "航炮弹": 80},
            "机降突击护航": {"空地导弹": 1, "火箭弹": 6, "航炮弹": 100},
            "侦察护航": {"火箭弹": 4, "航炮弹": 60},
        }
    )


class LLMProviderConfig(PlannerBaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    temperature: float = 0.1
    timeout_seconds: int = 60


class LLMConfig(PlannerBaseModel):
    provider: Literal["openai", "ollama", "mock"] = "mock"
    openai: LLMProviderConfig = Field(default_factory=LLMProviderConfig)
    ollama: LLMProviderConfig = Field(default_factory=LLMProviderConfig)
    mock: LLMProviderConfig = Field(default_factory=lambda: LLMProviderConfig(model_name="mock-planner"))


class AppConfig(PlannerBaseModel):
    llm: LLMConfig = Field(default_factory=LLMConfig)
    algorithm: AlgorithmConfig = Field(default_factory=AlgorithmConfig)


class TaskRequirement(PlannerBaseModel):
    requirement_id: str
    target_id: str
    target_name: str
    target_type: str
    task_type: str
    disposition: str
    priority: int = Field(default=3, ge=1, le=5)
    score: float = 0.0
    required_helicopters: Dict[str, int] = Field(default_factory=dict)
    required_weapons: Dict[str, int] = Field(default_factory=dict)
    required_personnel: Dict[str, int] = Field(default_factory=dict)
    expected_effect: str = ""
    estimated_loss_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    support_relations: List[str] = Field(default_factory=list)
    rationale: str = ""


class PlatformAllocation(PlannerBaseModel):
    model: str
    role: str
    count: int = Field(default=0, ge=0)


class WeaponAllocation(PlannerBaseModel):
    name: str
    quantity: int = Field(default=0, ge=0)


class PersonnelAllocation(PlannerBaseModel):
    role: str
    count: int = Field(default=0, ge=0)


class AllocationIssue(PlannerBaseModel):
    severity: Literal["info", "warning", "error"] = "warning"
    message: str
    requirement_id: Optional[str] = None


class ResourceAllocation(PlannerBaseModel):
    platforms: List[PlatformAllocation] = Field(default_factory=list)
    weapons: List[WeaponAllocation] = Field(default_factory=list)
    personnel: List[PersonnelAllocation] = Field(default_factory=list)
    issues: List[AllocationIssue] = Field(default_factory=list)


class TaskGroup(PlannerBaseModel):
    group_id: str
    group_name: str
    task_type: str
    responsible_targets: List[str] = Field(default_factory=list)
    disposition: str = ""
    platforms: List[PlatformAllocation] = Field(default_factory=list)
    weapons: List[WeaponAllocation] = Field(default_factory=list)
    personnel: List[PersonnelAllocation] = Field(default_factory=list)
    expected_effect: str = ""
    estimated_loss_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    priority: int = Field(default=3, ge=1, le=5)
    support_relations: List[str] = Field(default_factory=list)
    is_reserve: bool = False
    firepower_score: float = Field(default=0.0, ge=0.0, le=100.0)
    firepower_breakdown: Dict[str, Any] = Field(default_factory=dict)
    has_loaded_weapon: bool = False
    has_loaded_personnel: bool = False
    strike_weapon_requirement_met: bool = True
    assignment_eligible_for_strike: bool = True
    issues: List[AllocationIssue] = Field(default_factory=list)


class ResourceSnapshot(PlannerBaseModel):
    helicopters: Dict[str, int] = Field(default_factory=dict)
    weapons: Dict[str, int] = Field(default_factory=dict)
    personnel: Dict[str, int] = Field(default_factory=dict)


class PlanResult(PlannerBaseModel):
    total_groups: int = 0
    task_groups: List[TaskGroup] = Field(default_factory=list)
    reserve_group: Optional[TaskGroup] = None
    remaining_resources: ResourceSnapshot = Field(default_factory=ResourceSnapshot)
    warnings: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    generated_at: str = Field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
