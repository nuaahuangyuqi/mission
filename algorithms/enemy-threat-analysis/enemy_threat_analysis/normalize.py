"""Normalize and harden LLM extraction JSON."""

from __future__ import annotations

from typing import Any, Sequence

from .file_loader import LoadedFile
from .profiles import KNOWN_CATEGORIES
from .schemas import InputFileSummary, TargetCategory, ThreatExtractionJson
from .utils import clamp01, normalize_coordinate


DEFAULT_TARGET_CATEGORIES = [
    {"category": "fire_unit", "label": "火力打击单位", "defaultThreatWeight": 0.9, "defaultValueWeight": 0.85},
    {"category": "air_defense", "label": "防空节点", "defaultThreatWeight": 0.95, "defaultValueWeight": 0.9},
    {"category": "recon_sensor", "label": "侦察预警节点", "defaultThreatWeight": 0.75, "defaultValueWeight": 0.8},
    {"category": "command_control", "label": "指挥控制节点", "defaultThreatWeight": 0.65, "defaultValueWeight": 0.95},
    {"category": "mobility_unit", "label": "机动兵力", "defaultThreatWeight": 0.7, "defaultValueWeight": 0.7},
    {"category": "logistics_support", "label": "后勤保障节点", "defaultThreatWeight": 0.45, "defaultValueWeight": 0.75},
    {"category": "fortification", "label": "阵地工事/反机降设施", "defaultThreatWeight": 0.6, "defaultValueWeight": 0.65},
    {"category": "electronic_warfare", "label": "电子对抗节点", "defaultThreatWeight": 0.7, "defaultValueWeight": 0.75},
    {"category": "unknown", "label": "未知目标", "defaultThreatWeight": 0.5, "defaultValueWeight": 0.5},
]


def normalize_extraction(
    raw: ThreatExtractionJson | dict[str, Any],
    loaded_files: Sequence[LoadedFile] | None = None,
) -> ThreatExtractionJson:
    extraction = raw if isinstance(raw, ThreatExtractionJson) else ThreatExtractionJson.model_validate(raw)
    if extraction.schemaVersion != "threat-extraction-v1":
        extraction.schemaVersion = "threat-extraction-v1"

    loaded_files = list(loaded_files or [])
    if loaded_files and not extraction.inputSummary.files:
        extraction.inputSummary.files = [
            InputFileSummary(
                fileId=item.file_id,
                fileName=item.file_name,
                fileType=item.file_type,
                summary=item.text[:240],
            )
            for item in loaded_files
        ]
    if loaded_files:
        extraction.extractionMeta.sourceFileCount = len(loaded_files)

    if not extraction.targetCategories:
        extraction.targetCategories = [TargetCategory.model_validate(item) for item in DEFAULT_TARGET_CATEGORIES]

    for index, target in enumerate(extraction.targets, start=1):
        if not target.id:
            target.id = f"target-{index:03d}"
        if not target.name:
            target.name = target.id
        if target.category not in KNOWN_CATEGORIES:
            target.category = "unknown"
        target.camp = target.camp or "red"
        target.status = (target.status or "unknown").lower()
        target.location.coordinates = normalize_coordinate(target.location.coordinates)
        target.location.coordinateConfidence = clamp01(target.location.coordinateConfidence, 0.6)

        for field_name in target.capabilities.__class__.model_fields:
            setattr(target.capabilities, field_name, clamp01(getattr(target.capabilities, field_name), 0.0))

        target.coverage.radiusMeters = max(0.0, float(target.coverage.radiusMeters or 0.0))
        target.coverage.minRadiusMeters = max(0.0, float(target.coverage.minRadiusMeters or 0.0))
        target.coverage.maxRadiusMeters = max(target.coverage.radiusMeters, float(target.coverage.maxRadiusMeters or 0.0))
        target.coverage.coverageConfidence = clamp01(target.coverage.coverageConfidence, 0.6)

        for field_name in target.importance.__class__.model_fields:
            setattr(target.importance, field_name, clamp01(getattr(target.importance, field_name), 0.5))
        for field_name in target.confidence.__class__.model_fields:
            setattr(target.confidence, field_name, clamp01(getattr(target.confidence, field_name), 0.6))

        for evidence_index, evidence in enumerate(target.evidence, start=1):
            if not evidence.evidenceId:
                evidence.evidenceId = f"ev-{index}-{evidence_index}"
            evidence.confidence = clamp01(evidence.confidence, target.confidence.overallConfidence)
            if not evidence.sourceFileName and loaded_files:
                evidence.sourceFileName = loaded_files[0].file_name
            if not evidence.sourceFileId and loaded_files:
                evidence.sourceFileId = loaded_files[0].file_id

    for relation_index, relation in enumerate(extraction.relations, start=1):
        if not relation.id:
            relation.id = f"rel-{relation_index:03d}"
        relation.confidence = clamp01(relation.confidence, 0.6)

    return extraction
