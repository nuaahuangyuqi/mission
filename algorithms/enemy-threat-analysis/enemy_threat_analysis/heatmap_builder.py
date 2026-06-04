"""Threat heatmap and GeoJSON builder."""

from __future__ import annotations

from typing import Any, Sequence

from .point_threat_field import compute_point_threat
from .profiles import heatmap_profile
from .schemas import ThreatExtractionJson
from .utils import average, round_float


def build_heatmap(
    target_assessments: Sequence[dict[str, Any]],
    extraction: ThreatExtractionJson,
    *,
    heatmap_density: str,
    analysis_focus: str,
    impact_bias: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not any(item.get("location", {}).get("coordinates") for item in target_assessments):
        empty = {
            "density": heatmap_density,
            "bounds": {},
            "grid": [],
            "statistics": {
                "maxThreat": 0.0,
                "minThreat": 0.0,
                "avgThreat": 0.0,
                "highThreatCellCount": 0,
                "mediumThreatCellCount": 0,
                "lowThreatCellCount": 0,
            },
        }
        return empty, {"type": "FeatureCollection", "features": []}

    bounds = build_threat_bounds(target_assessments, extraction)
    if not bounds:
        empty = {
            "density": heatmap_density,
            "bounds": {},
            "grid": [],
            "statistics": {
                "maxThreat": 0.0,
                "minThreat": 0.0,
                "avgThreat": 0.0,
                "highThreatCellCount": 0,
                "mediumThreatCellCount": 0,
                "lowThreatCellCount": 0,
            },
        }
        return empty, {"type": "FeatureCollection", "features": []}

    profile = heatmap_profile(heatmap_density)
    grid_size = int(profile["gridSize"])
    grid: list[dict[str, Any]] = []
    for row in range(grid_size):
        lat = bounds["minLat"] + (bounds["maxLat"] - bounds["minLat"]) * row / max(1, grid_size - 1)
        for col in range(grid_size):
            lon = bounds["minLon"] + (bounds["maxLon"] - bounds["minLon"]) * col / max(1, grid_size - 1)
            point = {"id": f"grid-{row}-{col}", "coordinates": [round_float(lon, 6), round_float(lat, 6), 0]}
            grid.append(
                compute_point_threat(
                    point,
                    target_assessments,
                    analysis_focus=analysis_focus,
                    impact_bias=impact_bias,
                )
            )

    scores = [item["threatScore"] for item in grid]
    statistics = {
        "maxThreat": round_float(max(scores) if scores else 0.0, 2),
        "minThreat": round_float(min(scores) if scores else 0.0, 2),
        "avgThreat": round_float(average(scores), 2),
        "highThreatCellCount": sum(1 for score in scores if score >= 75),
        "mediumThreatCellCount": sum(1 for score in scores if 45 <= score < 75),
        "lowThreatCellCount": sum(1 for score in scores if score < 45),
    }
    heatmap = {
        "density": heatmap_density,
        "bounds": bounds,
        "grid": grid,
        "statistics": statistics,
    }
    return heatmap, build_heatmap_geojson(grid)


def build_threat_bounds(
    target_assessments: Sequence[dict[str, Any]],
    extraction: ThreatExtractionJson,
) -> dict[str, float]:
    area = extraction.spatialContext.areaOfInterest if extraction.spatialContext else None
    if area and area.bounds:
        bounds = area.bounds
        if bounds.maxLon > bounds.minLon and bounds.maxLat > bounds.minLat:
            return {
                "minLon": bounds.minLon,
                "minLat": bounds.minLat,
                "maxLon": bounds.maxLon,
                "maxLat": bounds.maxLat,
            }

    coordinates = [
        item.get("location", {}).get("coordinates")
        for item in target_assessments
        if item.get("location", {}).get("coordinates")
    ]
    if not coordinates:
        return {}
    lons = [float(item[0]) for item in coordinates]
    lats = [float(item[1]) for item in coordinates]
    lon_pad = max((max(lons) - min(lons)) * 0.25, 0.08)
    lat_pad = max((max(lats) - min(lats)) * 0.25, 0.08)
    return {
        "minLon": round_float(min(lons) - lon_pad, 6),
        "minLat": round_float(min(lats) - lat_pad, 6),
        "maxLon": round_float(max(lons) + lon_pad, 6),
        "maxLat": round_float(max(lats) + lat_pad, 6),
    }


def build_heatmap_geojson(grid: Sequence[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": item["point"]["coordinates"],
                },
                "properties": {
                    "id": item["point"]["id"],
                    "threatScore": item["threatScore"],
                    "threatLevel": item["threatLevel"],
                    "topContributorCount": len(item["topContributors"]),
                },
            }
            for item in grid
        ],
    }
