"""Top-level algorithm orchestration."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from .assessment_report import generate_assessment_report
from .file_loader import LoadedFile, load_files
from .heatmap_builder import build_cluster_heatmaps, build_heatmap
from .image_exporter import build_combined_map_base64, build_heatmap_base64, build_target_map_base64
from .llm_extractor import extract_threat_json_with_llm
from .normalize import normalize_extraction
from .output_adapter import build_structured_output
from .profiles import normalize_options
from .schemas import TargetAssessment, ThreatExtractionJson
from .target_threat_score import compute_target_threat
from .target_value_score import compute_priority_score, compute_target_value
from .utils import clamp, clamp01, round_float
from .visualization_builder import build_threat_visualization


def analyze(
    files: Iterable[str | Path] | None,
    analysis_focus: str = "comprehensive",
    heatmap_density: str = "medium",
    impact_bias: str = "balanced",
    llm_config: dict[str, Any] | None = None,
    extraction_json: dict[str, Any] | ThreatExtractionJson | None = None,
    generate_assessment: bool = True,
    assessment_output_dir: str | Path | None = None,
    assessment_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run LLM-based enemy threat analysis.

    ``extraction_json`` is provided for tests and offline integration where the
    caller has already executed the LLM extraction step.
    """
    options = normalize_options(analysis_focus, heatmap_density, impact_bias)
    loaded_files: list[LoadedFile] = load_files(files or []) if extraction_json is None else []
    raw_extraction = extraction_json
    if raw_extraction is None:
        raw_extraction = extract_threat_json_with_llm(
            loaded_files,
            analysis_focus=options["analysisFocus"],
            heatmap_density=options["heatmapDensity"],
            impact_bias=options["impactBias"],
            llm_config=llm_config,
        )
    extraction = normalize_extraction(raw_extraction, loaded_files)
    target_assessments = build_target_assessments(
        extraction,
        analysis_focus=options["analysisFocus"],
        impact_bias=options["impactBias"],
    )
    heatmap, heatmap_geojson = build_heatmap(
        target_assessments,
        extraction,
        heatmap_density=options["heatmapDensity"],
        analysis_focus=options["analysisFocus"],
        impact_bias=options["impactBias"],
    )
    cluster_heatmaps = build_cluster_heatmaps(
        target_assessments,
        heatmap_density=options["heatmapDensity"],
        analysis_focus=options["analysisFocus"],
        impact_bias=options["impactBias"],
    )
    heatmap_base64 = build_heatmap_base64(heatmap)
    cluster_overlays = build_cluster_heatmap_overlays(cluster_heatmaps)
    heatmap["overlayMode"] = "clustered" if len(cluster_overlays) > 1 else "single"
    heatmap["groupSummaries"] = [
        {
            "groupId": item.get("groupId"),
            "groupName": item.get("groupName"),
            "targetIds": item.get("targetIds", []),
            "targetCount": item.get("targetCount", 0),
            "bounds": item.get("bounds") or {},
            "statistics": item.get("statistics") or {},
        }
        for item in cluster_heatmaps
    ]
    visualization = build_threat_visualization(
        target_assessments,
        heatmap,
        image_overlays=cluster_overlays if len(cluster_overlays) > 1 else None,
    )
    target_map_base64 = build_target_map_base64(target_assessments, heatmap)
    combined_map_base64 = build_combined_map_base64(target_assessments, heatmap)
    structured_output = build_structured_output(
        extraction=extraction,
        loaded_files=loaded_files,
        options=options,
        target_assessments=target_assessments,
        heatmap=heatmap,
        heatmap_geojson=heatmap_geojson,
        heatmap_base64=heatmap_base64,
        target_map_base64=target_map_base64,
        combined_map_base64=combined_map_base64,
        visualization=visualization,
    )
    if generate_assessment:
        structured_output.update(
            generate_assessment_report(
                structured_output=structured_output,
                loaded_files=loaded_files,
                llm_config=llm_config,
                assessment_json=assessment_json,
                output_dir=assessment_output_dir,
            )
        )
    else:
        structured_output.update(
            {
                "assessmentReport": {"status": "skipped"},
                "assessmentDocxBase64": "",
                "assessmentDocxFileName": "",
            }
        )
    return structured_output


def build_cluster_heatmap_overlays(cluster_heatmaps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    overlays: list[dict[str, Any]] = []
    for index, item in enumerate(cluster_heatmaps, start=1):
        bounds = item.get("bounds") or {}
        image_base64 = build_heatmap_base64(item)
        if not image_base64 or not bounds:
            continue
        overlays.append(
            {
                "id": f"threat-spatial-field-{item.get('groupId') or index}",
                "type": "image-overlay",
                "role": "threat-heatmap",
                "name": f"{item.get('groupName') or f'目标群 {index}'}热力图",
                "imageBase64": image_base64,
                "bounds": {
                    "west": bounds["minLon"],
                    "south": bounds["minLat"],
                    "east": bounds["maxLon"],
                    "north": bounds["maxLat"],
                },
                "groupId": item.get("groupId") or f"threat-group-{index:03d}",
                "groupName": item.get("groupName") or f"目标群 {index}",
                "targetIds": list(item.get("targetIds") or []),
                "targetCount": item.get("targetCount", len(item.get("targetIds") or [])),
                "alpha": 0.82,
                "zIndex": 20 + index,
                "rendering": "single-tile-image",
                "background": "transparent",
                "normalizedForDisplay": True,
                "displayVersion": "soft-continuous-v2",
            }
        )
    return overlays


def build_target_assessments(
    extraction: ThreatExtractionJson,
    *,
    analysis_focus: str,
    impact_bias: str,
) -> list[dict[str, Any]]:
    assessments: list[dict[str, Any]] = []
    for target in extraction.targets:
        threat = compute_target_threat(target, analysis_focus)
        value = compute_target_value(target, extraction.relations)
        confidence_score = round_float(clamp01(target.confidence.overallConfidence, 0.6) * 100.0, 2)
        mobility_impact = round_float(clamp01(target.capabilities.mobility, 0.0) * 100.0, 2)
        priority = compute_priority_score(
            threat_score=threat["threatScore"],
            value_score=value["valueScore"],
            confidence_score=confidence_score,
            mobility_impact=mobility_impact,
            impact_bias=impact_bias,
        )
        data = TargetAssessment(
            id=target.id,
            name=target.name,
            groupId=target.groupId,
            groupName=target.groupName,
            category=target.category,
            threatScore=threat["threatScore"],
            valueScore=value["valueScore"],
            priorityScore=priority,
            threatLevel=threat["threatLevel"],
            valueLevel=value["valueLevel"],
            location={
                "coordinates": target.location.coordinates,
                "coordinateConfidence": target.location.coordinateConfidence,
                "locationDescription": target.location.locationDescription,
            },
            coverage={
                "hasCoverage": target.coverage.hasCoverage,
                "coverageTypes": list(target.coverage.coverageTypes),
                "radiusMeters": round_float(max(0.0, target.coverage.radiusMeters), 2),
                "minRadiusMeters": round_float(max(0.0, target.coverage.minRadiusMeters), 2),
                "maxRadiusMeters": round_float(max(target.coverage.radiusMeters, target.coverage.maxRadiusMeters), 2),
                "coverageConfidence": target.coverage.coverageConfidence,
            },
            capabilities=target.capabilities.model_dump(mode="json"),
            confidenceScore=confidence_score,
            threatBreakdown=threat["threatBreakdown"],
            valueBreakdown=value["valueBreakdown"],
            dominantFactors=(threat["dominantThreatFactors"] + value["dominantValueFactors"])[:8],
            evidenceIds=threat["evidenceIds"],
            sourceTarget=target.model_dump(mode="json"),
        )
        normalized = data.model_dump(mode="json")
        normalized["priorityScore"] = round_float(clamp(normalized["priorityScore"], 0.0, 100.0), 2)
        assessments.append(normalized)
    return assessments
