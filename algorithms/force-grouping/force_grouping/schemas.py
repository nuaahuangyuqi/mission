"""Typed data models used by force grouping internals."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from .utils import clamp_score


CAPABILITY_KEYS = (
    "firepower",
    "protection",
    "recon",
    "mobility",
    "support",
    "communication",
    "survivability",
)


class Evidence(BaseModel):
    source: str = ""
    text: str = ""
    confidence: float = 0.65


class Equipment(BaseModel):
    name: str = ""
    type: str = "unknown"
    quantity: int = 1
    effectiveness: float = 50.0

    @field_validator("effectiveness")
    @classmethod
    def _clamp_effectiveness(cls, value: float) -> float:
        return clamp_score(value)


class Readiness(BaseModel):
    status: str = "available"
    readinessScore: float = 70.0
    availability: float = 1.0

    @field_validator("readinessScore")
    @classmethod
    def _clamp_readiness(cls, value: float) -> float:
        return clamp_score(value)


class UnitConstraints(BaseModel):
    cannotSeparate: bool = False
    mustWith: list[str] = Field(default_factory=list)
    cannotWith: list[str] = Field(default_factory=list)
    taskRestrictions: list[str] = Field(default_factory=list)


class ForceUnit(BaseModel):
    id: str
    name: str
    category: str = "unknown"
    role: str = "reserve"
    strength: float = 1.0
    capabilities: dict[str, float] = Field(default_factory=dict)
    readiness: Readiness = Field(default_factory=Readiness)
    equipment: list[Equipment] = Field(default_factory=list)
    location: list[float] | None = None
    constraints: UnitConstraints = Field(default_factory=UnitConstraints)
    evidence: list[Evidence] = Field(default_factory=list)
    derivedFromText: bool = True

    @field_validator("capabilities")
    @classmethod
    def _normalize_capabilities(cls, value: dict[str, Any]) -> dict[str, float]:
        return {key: clamp_score(value.get(key, 0.0)) for key in CAPABILITY_KEYS}


class ForceExtractionJson(BaseModel):
    schemaVersion: str = "force-extraction-v1"
    extractionMeta: dict[str, Any] = Field(default_factory=dict)
    inputSummary: dict[str, Any] = Field(default_factory=dict)
    forceUnits: list[ForceUnit] = Field(default_factory=list)
    globalConstraints: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[dict[str, Any]] = Field(default_factory=list)


class ThreatContext(BaseModel):
    threatScore: float = 0.0
    threatLevel: str = "低"
    dominantThreats: dict[str, float] = Field(default_factory=dict)
    enemyIntentions: list[dict[str, Any]] = Field(default_factory=list)
    threatNodes: list[dict[str, Any]] = Field(default_factory=list)
    fireCoverage: list[dict[str, Any]] = Field(default_factory=list)
    airDefenseSystem: list[dict[str, Any]] = Field(default_factory=list)
    reconEarlyWarning: list[dict[str, Any]] = Field(default_factory=list)
    antiAirborneFacilities: list[dict[str, Any]] = Field(default_factory=list)


class SchemeProfile(BaseModel):
    key: str
    label: str
    comparisonFocus: str
    weights: dict[str, float]
    description: str


ConstraintStatus = Literal["pass", "warn", "fail"]

