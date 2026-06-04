"""Adapt internal algorithm results to platform structuredOutput."""

from __future__ import annotations

from collections import Counter
from typing import Any, Sequence

from .file_loader import LoadedFile
from .profiles import focus_profile
from .schemas import ThreatExtractionJson
from .utils import average, resolve_level, round_float, top_k_average


def build_structured_output(
    *,
    extraction: ThreatExtractionJson,
    loaded_files: Sequence[LoadedFile],
    options: dict[str, str],
    target_assessments: Sequence[dict[str, Any]],
    heatmap: dict[str, Any],
    heatmap_geojson: dict[str, Any],
    heatmap_base64: str,
    target_map_base64: str,
    combined_map_base64: str,
    visualization: dict[str, Any],
) -> dict[str, Any]:
    fire_coverage = build_fire_coverage(target_assessments)
    air_defense = build_air_defense_system(target_assessments)
    recon = build_recon_early_warning(target_assessments)
    anti_airborne = build_anti_airborne_facilities(target_assessments)
    score_breakdown = build_score_breakdown(
        target_assessments,
        extraction,
        fire_coverage,
        air_defense,
        recon,
    )
    threat_score = compute_overall_threat_score(score_breakdown, options["analysisFocus"])
    threat_level = resolve_level(threat_score)
    evidence_trace = build_evidence_trace(extraction)
    imported_files = build_imported_files(extraction, loaded_files)
    node_ids = {
        item["sourceUnitId"]
        for collection in (fire_coverage, air_defense, recon, anti_airborne)
        for item in collection
    }

    return {
        "implementationStatus": "implemented",
        "builtinMethodKey": "llm-analysis",
        "builtinMethodLabel": "基于大模型分析算法",
        "appliedOptions": dict(options),
        "inputSummary": {
            "selectedSourceCount": 0,
            "uploadedFileCount": len(imported_files),
            "evidenceEntryCount": len(evidence_trace),
            "extractedTargetCount": len(extraction.targets),
            "validCoordinateTargetCount": len(
                [item for item in target_assessments if item.get("location", {}).get("coordinates")]
            ),
        },
        "selectedSources": [],
        "importedFiles": imported_files,
        "evidenceTrace": evidence_trace,
        "threatLevel": threat_level,
        "threatScore": threat_score,
        "enemyUnitCount": len(target_assessments),
        "identifiedThreatNodeCount": len(node_ids),
        "targetAssessments": list(target_assessments),
        "enemyIntentions": build_enemy_intentions(extraction, threat_score, target_assessments),
        "deploymentSectors": build_deployment_sectors(target_assessments, extraction),
        "fireCoverage": fire_coverage,
        "airDefenseSystem": air_defense,
        "reconEarlyWarning": recon,
        "antiAirborneFacilities": anti_airborne,
        "impactAnalysis": build_impact_analysis(threat_score, target_assessments, options),
        "pointThreatEvaluation": {
            "method": "weighted-kernel-threat-field",
            "description": "基于目标威胁分、覆盖半径、距离衰减、目标类型权重和置信度计算每个位置的威胁。",
        },
        "heatmap": heatmap,
        "heatmapBase64": heatmap_base64,
        "heatmapGeojson": heatmap_geojson,
        "targetMapBase64": target_map_base64,
        "combinedMapBase64": combined_map_base64,
        "visualization": visualization,
        "imageArtifacts": {
            "heatmap": {
                "fileName": "heatmap.png",
                "format": "png",
                "base64Field": "heatmapBase64",
            },
            "targetMap": {
                "fileName": "target-map.png",
                "format": "png",
                "base64Field": "targetMapBase64",
            },
            "combinedMap": {
                "fileName": "combined-map.png",
                "format": "png",
                "base64Field": "combinedMapBase64",
            },
        },
        "scoreBreakdown": score_breakdown,
        "recommendations": build_recommendations(threat_score, target_assessments, score_breakdown),
        "warnings": [item.model_dump(mode="json") for item in extraction.warnings],
        "extractionMeta": extraction.extractionMeta.model_dump(mode="json"),
    }


def build_imported_files(
    extraction: ThreatExtractionJson,
    loaded_files: Sequence[LoadedFile],
) -> list[dict[str, Any]]:
    if extraction.inputSummary.files:
        return [item.model_dump(mode="json") for item in extraction.inputSummary.files]
    return [
        {
            "fileId": item.file_id,
            "fileName": item.file_name,
            "fileType": item.file_type,
            "summary": item.text[:240],
        }
        for item in loaded_files
    ]


def build_evidence_trace(extraction: ThreatExtractionJson) -> list[dict[str, Any]]:
    trace: list[dict[str, Any]] = []
    seen: set[str] = set()
    for target in extraction.targets:
        for evidence in target.evidence:
            evidence_id = evidence.evidenceId or f"ev-{target.id}-{len(trace) + 1}"
            if evidence_id in seen:
                continue
            seen.add(evidence_id)
            trace.append(
                {
                    "id": evidence_id,
                    "title": f"{target.name} / {evidence.pageOrSection or '证据片段'}",
                    "summary": evidence.text,
                    "sourceType": "uploaded-file",
                    "sourceId": evidence.sourceFileId,
                    "sourceName": evidence.sourceFileName,
                    "fileName": evidence.sourceFileName,
                    "extractedAt": extraction.extractionMeta.generatedAt,
                    "confidence": evidence.confidence,
                }
            )
    return trace


def build_enemy_intentions(
    extraction: ThreatExtractionJson,
    threat_score: float,
    targets: Sequence[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if extraction.globalSituation.enemyIntentions:
        return [
            {
                "id": item.id or f"intent-{index}",
                "name": item.name or item.type,
                "type": item.type,
                "score": round_float(item.confidence * 100.0, 1),
                "description": item.description,
                "evidenceIds": list(item.evidenceIds),
            }
            for index, item in enumerate(extraction.globalSituation.enemyIntentions, start=1)
        ]
    if extraction.globalSituation.situationSummary:
        return [
            {
                "id": "intent-derived-1",
                "name": "综合态势企图",
                "type": "derived",
                "score": round_float(threat_score, 1),
                "description": extraction.globalSituation.situationSummary,
                "evidenceIds": [],
            }
        ]
    targets = list(targets or [])
    if not targets:
        return [
            {
                "id": "intent-fallback-1",
                "name": "综合态势关注",
                "type": "derived",
                "score": round_float(max(threat_score, 35.0), 1),
                "description": "未从模型中抽取到明确意图，当前仅保留低置信综合态势关注项，建议补充原始敌情材料。",
                "evidenceIds": [],
            }
        ]

    category_counter = Counter(item["category"] for item in targets)
    top_targets = sorted(targets, key=lambda item: item["priorityScore"], reverse=True)[:3]
    top_names = "、".join(item["name"] for item in top_targets)
    evidence_ids = [evidence_id for item in top_targets for evidence_id in item.get("evidenceIds", [])][:8]
    dominant_category = category_counter.most_common(1)[0][0]
    intent_type, name, action = {
        "fire_unit": ("fire_suppression", "火力压制准备", "依托火力节点对关键通道或集结区域实施压制"),
        "air_defense": ("air_defense_denial", "防空拒止", "围绕防空节点构建低空拦截与区域拒止"),
        "recon_sensor": ("reconnaissance_warning", "侦察预警", "通过侦察预警节点扩大态势感知并支撑后续打击"),
        "fortification": ("counter_airlanding", "反机降阻滞", "利用反机降设施和伏击阵地阻滞机动或着陆行动"),
        "mobility_unit": ("mobility_interdiction", "机动阻滞", "依托机动力量实施增援、拦截或局部反击"),
        "command_control": ("command_control", "指挥协同", "依托指挥控制节点维持多节点协同"),
    }.get(dominant_category, ("other", "综合作战企图", "依托已识别目标形成局部控制与持续威胁"))
    return [
        {
            "id": "intent-fallback-1",
            "name": name,
            "type": intent_type,
            "score": round_float(max(45.0, min(70.0, threat_score + 12.0)), 1),
            "description": f"根据目标类别分布和高优先级目标（{top_names}）推断，敌方可能{action}。",
            "evidenceIds": evidence_ids,
        }
    ]


def build_fire_coverage(targets: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": f"fire-{item['id']}",
            "name": item["name"],
            "sourceUnitId": item["id"],
            "source": "LLM文档抽取",
            "center": item["location"]["coordinates"],
            "radiusMeters": item["coverage"]["radiusMeters"],
            "coverageKm": round_float(item["coverage"]["radiusMeters"] / 1000.0, 2),
            "threatValue": item["threatScore"],
            "notes": "火力覆盖节点",
            "inferredFromText": True,
            "evidence": item.get("dominantFactors", []),
            "evidenceIds": item.get("evidenceIds", []),
        }
        for item in targets
        if item["category"] == "fire_unit" and item["location"].get("coordinates")
    ]


def build_air_defense_system(targets: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": f"air-defense-{item['id']}",
            "name": item["name"],
            "sourceUnitId": item["id"],
            "source": "LLM文档抽取",
            "center": item["location"]["coordinates"],
            "radiusMeters": item["coverage"]["radiusMeters"],
            "coverageKm": round_float(item["coverage"]["radiusMeters"] / 1000.0, 2),
            "strength": item["threatScore"],
            "confidence": round_float(item["confidenceScore"] / 100.0, 3),
            "notes": "防空体系节点",
            "inferredFromText": True,
            "evidence": item.get("dominantFactors", []),
            "evidenceIds": item.get("evidenceIds", []),
        }
        for item in targets
        if item["category"] == "air_defense" and item["location"].get("coordinates")
    ]


def build_recon_early_warning(targets: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": f"recon-{item['id']}",
            "name": item["name"],
            "sourceUnitId": item["id"],
            "source": "LLM文档抽取",
            "center": item["location"]["coordinates"],
            "radiusMeters": item["coverage"]["radiusMeters"],
            "confidence": item["threatScore"],
            "notes": "侦察预警或电子对抗节点",
            "inferredFromText": True,
            "evidence": item.get("dominantFactors", []),
            "evidenceIds": item.get("evidenceIds", []),
        }
        for item in targets
        if item["category"] in {"recon_sensor", "electronic_warfare"} and item["location"].get("coordinates")
    ]


def build_anti_airborne_facilities(targets: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": f"anti-airborne-{item['id']}",
            "name": item["name"],
            "sourceUnitId": item["id"],
            "source": "LLM文档抽取",
            "center": item["location"]["coordinates"],
            "radiusMeters": item["coverage"]["radiusMeters"],
            "confidence": item["threatScore"],
            "notes": "反机降或区域阻滞设施",
            "inferredFromText": True,
            "evidence": item.get("dominantFactors", []),
            "evidenceIds": item.get("evidenceIds", []),
        }
        for item in targets
        if item["category"] == "fortification" and item["location"].get("coordinates")
    ]


def build_deployment_sectors(
    targets: Sequence[dict[str, Any]],
    extraction: ThreatExtractionJson,
) -> list[dict[str, Any]]:
    located = [item for item in targets if item.get("location", {}).get("coordinates")]
    if not located:
        return []
    lons = [item["location"]["coordinates"][0] for item in located]
    lats = [item["location"]["coordinates"][1] for item in located]
    west, east = min(lons), max(lons)
    south, north = min(lats), max(lats)
    lon_pad = max((east - west) * 0.20, 0.03)
    lat_pad = max((north - south) * 0.20, 0.03)
    category_counter = Counter(item["category"] for item in located)
    posture = extraction.globalSituation.deploymentPosture or "综合防御型部署"
    return [
        {
            "id": "sector-1",
            "name": "主要部署区",
            "center": [round_float(average(lons), 6), round_float(average(lats), 6), 0],
            "polygon": [
                [round_float(west - lon_pad, 6), round_float(south - lat_pad, 6), 0],
                [round_float(east + lon_pad, 6), round_float(south - lat_pad, 6), 0],
                [round_float(east + lon_pad, 6), round_float(north + lat_pad, 6), 0],
                [round_float(west - lon_pad, 6), round_float(north + lat_pad, 6), 0],
                [round_float(west - lon_pad, 6), round_float(south - lat_pad, 6), 0],
            ],
            "unitCount": len(located),
            "averageStrength": round_float(average([item["threatScore"] for item in located]), 2),
            "posture": posture,
            "mainCategory": category_counter.most_common(1)[0][0],
            "source": "LLM文档抽取",
            "evidence": [item["name"] for item in sorted(located, key=lambda row: row["threatScore"], reverse=True)[:6]],
            "units": [item["id"] for item in located],
            "inferredFromText": True,
        }
    ]


def build_score_breakdown(
    targets: Sequence[dict[str, Any]],
    extraction: ThreatExtractionJson,
    fire_coverage: Sequence[dict[str, Any]],
    air_defense: Sequence[dict[str, Any]],
    recon: Sequence[dict[str, Any]],
) -> dict[str, float]:
    scores = [item["threatScore"] for item in targets]
    return {
        "maxTargetThreat": round_float(max(scores) if scores else 0.0, 2),
        "avgTopKThreat": round_float(top_k_average(scores, 5), 2),
        "firePressure": round_float(average([item["threatValue"] for item in fire_coverage]), 2),
        "airDefensePressure": round_float(average([item["strength"] for item in air_defense]), 2),
        "reconPressure": round_float(average([item["confidence"] for item in recon]), 2),
        "mobilityPressure": round_float(
            average([item["threatScore"] for item in targets if item["category"] in {"mobility_unit", "fortification"}]),
            2,
        ),
        "commandSystemValue": round_float(
            average([item["valueScore"] for item in targets if item["category"] == "command_control"]),
            2,
        ),
        "evidenceConfidence": round_float(extraction.extractionMeta.overallConfidence * 100.0, 2),
    }


def compute_overall_threat_score(breakdown: dict[str, float], analysis_focus: str) -> float:
    if analysis_focus == "coverage":
        score = (
            0.20 * breakdown["maxTargetThreat"]
            + 0.18 * breakdown["avgTopKThreat"]
            + 0.32 * breakdown["firePressure"]
            + 0.14 * breakdown["airDefensePressure"]
            + 0.06 * breakdown["reconPressure"]
            + 0.05 * breakdown["mobilityPressure"]
            + 0.05 * breakdown["evidenceConfidence"]
        )
    elif analysis_focus == "air-defense":
        score = (
            0.20 * breakdown["maxTargetThreat"]
            + 0.16 * breakdown["avgTopKThreat"]
            + 0.14 * breakdown["firePressure"]
            + 0.32 * breakdown["airDefensePressure"]
            + 0.10 * breakdown["reconPressure"]
            + 0.03 * breakdown["mobilityPressure"]
            + 0.05 * breakdown["evidenceConfidence"]
        )
    else:
        score = (
            0.25 * breakdown["maxTargetThreat"]
            + 0.20 * breakdown["avgTopKThreat"]
            + 0.20 * breakdown["firePressure"]
            + 0.18 * breakdown["airDefensePressure"]
            + 0.07 * breakdown["reconPressure"]
            + 0.05 * breakdown["mobilityPressure"]
            + 0.05 * breakdown["evidenceConfidence"]
        )
    return round_float(max(0.0, min(score, 100.0)), 2)


def build_impact_analysis(
    threat_score: float,
    targets: Sequence[dict[str, Any]],
    options: dict[str, str],
) -> list[dict[str, Any]]:
    top_targets = sorted(targets, key=lambda item: item["priorityScore"], reverse=True)[:5]
    bias = options["impactBias"]
    if bias == "suppression":
        title = "压制优先影响"
        detail = "高优先级火力、防空、电子对抗节点会影响压制顺序和重点打击窗口。"
    elif bias == "mobility":
        title = "机动优先影响"
        detail = "机动兵力、反机降设施和覆盖边界会影响通道选择、绕行代价与行动安全裕度。"
    else:
        title = "综合敌情影响"
        detail = "综合威胁、价值和置信度显示需同步关注高威胁节点与体系关键节点。"
    return [
        {
            "id": "impact-1",
            "title": title,
            "level": resolve_level(threat_score),
            "detail": detail,
            "relatedTargets": [item["id"] for item in top_targets],
            "evidenceIds": [evidence_id for item in top_targets for evidence_id in item.get("evidenceIds", [])][:12],
        }
    ]


def build_recommendations(
    threat_score: float,
    targets: Sequence[dict[str, Any]],
    breakdown: dict[str, float],
) -> list[str]:
    recommendations = ["建议优先关注高威胁火力节点与防空节点重叠区域。"]
    low_confidence_high_priority = [
        item for item in targets if item["priorityScore"] >= 60 and item["confidenceScore"] < 65
    ]
    if low_confidence_high_priority:
        recommendations.append("建议对低置信度但高影响节点进行人工复核。")
    if breakdown["airDefensePressure"] >= breakdown["firePressure"] and breakdown["airDefensePressure"] > 0:
        recommendations.append("防空体系压力较突出，后续选址和航路规划应避开防空覆盖核心区。")
    if threat_score < 45:
        recommendations.append("当前总体威胁较低，但仍需补充坐标和装备状态证据以降低不确定性。")
    return recommendations
