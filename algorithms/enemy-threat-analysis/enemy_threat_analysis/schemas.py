"""Pydantic schemas for LLM extraction and algorithm outputs."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SchemaModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ExtractionMeta(SchemaModel):
    extractionId: str = ""
    generatedAt: str = Field(default_factory=_now_iso)
    modelName: str = "llm-extractor"
    language: str = "zh-CN"
    sourceFileCount: int = 0
    overallConfidence: float = 0.6


class InputFileSummary(SchemaModel):
    fileId: str = ""
    fileName: str = ""
    fileType: str = ""
    summary: str = ""


class ExtractionScope(SchemaModel):
    hasEnemyUnits: bool = False
    hasCoordinates: bool = False
    hasEquipment: bool = False
    hasIntentions: bool = False
    hasEnvironment: bool = False


class InputSummary(SchemaModel):
    files: list[InputFileSummary] = Field(default_factory=list)
    extractionScope: ExtractionScope = Field(default_factory=ExtractionScope)


class EnemyIntention(SchemaModel):
    id: str = ""
    type: str = "unknown"
    name: str = ""
    description: str = ""
    confidence: float = 0.6
    evidenceIds: list[str] = Field(default_factory=list)


class GlobalSituation(SchemaModel):
    enemyIntentions: list[EnemyIntention] = Field(default_factory=list)
    deploymentPosture: str = "unknown"
    mainThreatDirection: str = ""
    situationSummary: str = ""


class TargetCategory(SchemaModel):
    category: str = "unknown"
    label: str = "未知目标"
    description: str = ""
    defaultThreatWeight: float = 0.5
    defaultValueWeight: float = 0.5


class Location(SchemaModel):
    type: str = "point"
    coordinates: list[float] | None = None
    coordinateConfidence: float = 0.6
    locationDescription: str = ""


class Mobility(SchemaModel):
    isMobile: bool = False
    mobilityLevel: float = 0.0
    estimatedSpeedLevel: str = "unknown"
    relocationProbability: float = 0.0


class Capabilities(SchemaModel):
    firepower: float = 0.0
    airDefense: float = 0.0
    reconnaissance: float = 0.0
    commandControl: float = 0.0
    mobility: float = 0.0
    protection: float = 0.0
    logistics: float = 0.0
    electronicWarfare: float = 0.0


class Coverage(SchemaModel):
    hasCoverage: bool = False
    coverageTypes: list[str] = Field(default_factory=list)
    radiusMeters: float = 0.0
    minRadiusMeters: float = 0.0
    maxRadiusMeters: float = 0.0
    sectorAzimuthStart: float | None = None
    sectorAzimuthEnd: float | None = None
    coverageConfidence: float = 0.6


class Equipment(SchemaModel):
    name: str = ""
    type: str = ""
    quantity: int = 1
    quantityConfidence: float = 0.6
    capabilityTags: list[str] = Field(default_factory=list)


class Importance(SchemaModel):
    missionRelevance: float = 0.5
    systemCentrality: float = 0.5
    replaceability: float = 0.5
    supportDependency: float = 0.5


class EvidenceItem(SchemaModel):
    evidenceId: str = ""
    sourceFileId: str = ""
    sourceFileName: str = ""
    pageOrSection: str = ""
    text: str = ""
    confidence: float = 0.6


class Confidence(SchemaModel):
    classificationConfidence: float = 0.6
    capabilityConfidence: float = 0.6
    locationConfidence: float = 0.6
    overallConfidence: float = 0.6


class ExtractedTarget(SchemaModel):
    id: str = ""
    name: str = ""
    groupId: str = ""
    groupName: str = ""
    category: str = "unknown"
    subCategory: str = ""
    camp: str = "red"
    status: str = "unknown"
    location: Location = Field(default_factory=Location)
    mobility: Mobility = Field(default_factory=Mobility)
    capabilities: Capabilities = Field(default_factory=Capabilities)
    coverage: Coverage = Field(default_factory=Coverage)
    equipment: list[Equipment] = Field(default_factory=list)
    importance: Importance = Field(default_factory=Importance)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    confidence: Confidence = Field(default_factory=Confidence)
    notes: str = ""


class Relation(SchemaModel):
    id: str = ""
    type: str = "unknown"
    sourceTargetId: str = ""
    targetTargetId: str = ""
    description: str = ""
    confidence: float = 0.6


class Bounds(SchemaModel):
    minLon: float = 0.0
    minLat: float = 0.0
    maxLon: float = 0.0
    maxLat: float = 0.0

    @field_validator("maxLon")
    @classmethod
    def allow_default_bounds(cls, value: float) -> float:
        return value


class AreaOfInterest(SchemaModel):
    name: str = "任务区域"
    bounds: Bounds | None = None


class SpatialContext(SchemaModel):
    areaOfInterest: AreaOfInterest | None = None
    terrain: list[dict[str, Any]] = Field(default_factory=list)
    weather: list[dict[str, Any]] = Field(default_factory=list)
    civilianOrRestrictedAreas: list[dict[str, Any]] = Field(default_factory=list)


class WarningItem(SchemaModel):
    type: str = "unknown"
    message: str = ""
    severity: str = "medium"


class ThreatExtractionJson(SchemaModel):
    schemaVersion: str = "threat-extraction-v1"
    extractionMeta: ExtractionMeta = Field(default_factory=ExtractionMeta)
    inputSummary: InputSummary = Field(default_factory=InputSummary)
    globalSituation: GlobalSituation = Field(default_factory=GlobalSituation)
    targetCategories: list[TargetCategory] = Field(default_factory=list)
    targets: list[ExtractedTarget] = Field(default_factory=list)
    relations: list[Relation] = Field(default_factory=list)
    spatialContext: SpatialContext = Field(default_factory=SpatialContext)
    warnings: list[WarningItem] = Field(default_factory=list)


class TargetAssessment(SchemaModel):
    id: str
    name: str
    groupId: str = ""
    groupName: str = ""
    category: str
    threatScore: float
    valueScore: float
    priorityScore: float
    threatLevel: str
    valueLevel: str
    location: dict[str, Any]
    coverage: dict[str, Any]
    capabilities: dict[str, Any]
    confidenceScore: float
    threatBreakdown: dict[str, Any]
    valueBreakdown: dict[str, Any]
    dominantFactors: list[str]
    evidenceIds: list[str]
    sourceTarget: dict[str, Any]
