"""Build frontend-compatible visualization entities."""

from __future__ import annotations

from typing import Any, Sequence


CATEGORY_COLORS = {
    "fire_unit": "#ef4444",
    "air_defense": "#f97316",
    "recon_sensor": "#38bdf8",
    "command_control": "#a855f7",
    "mobility_unit": "#22c55e",
    "logistics_support": "#eab308",
    "fortification": "#64748b",
    "electronic_warfare": "#14b8a6",
    "unknown": "#94a3b8",
}

CATEGORY_LAYER = {
    "fire_unit": "fireCoverage",
    "air_defense": "airDefense",
    "recon_sensor": "sensors",
    "command_control": "command",
    "mobility_unit": "forces",
    "logistics_support": "support",
    "fortification": "obstacles",
    "electronic_warfare": "sensors",
    "unknown": "threats",
}

COVERAGE_ENTITY_CATEGORIES = {"fire_unit", "air_defense", "recon_sensor", "electronic_warfare"}
HEATMAP_OVERLAY_ALPHA = 0.82


def build_threat_visualization(
    target_assessments: Sequence[dict[str, Any]],
    heatmap: dict[str, Any],
) -> dict[str, Any]:
    entities: list[dict[str, Any]] = []
    for target in target_assessments:
        coordinates = target.get("location", {}).get("coordinates")
        if not coordinates:
            continue
        category = target.get("category", "unknown")
        color = CATEGORY_COLORS.get(category, CATEGORY_COLORS["unknown"])
        layer = CATEGORY_LAYER.get(category, "threats")
        radius = float(target.get("coverage", {}).get("radiusMeters") or 0.0)
        entities.append(
            {
                "id": f"threat-target-{target['id']}",
                "name": target.get("name") or target["id"],
                "type": "enemy-unit",
                "camp": "red",
                "layerKey": layer,
                "color": color,
                "geometryType": "point",
                "coordinates": coordinates,
                "radius": 0,
                "annotation": f"{target.get('threatLevel')}威胁 / {target.get('threatScore')}分",
                "visible": True,
                "meta": {
                    "targetId": target["id"],
                    "targetCategory": category,
                    "category": category,
                    "priorityScore": target.get("priorityScore"),
                    "valueScore": target.get("valueScore"),
                },
            }
        )
        has_coverage = bool(target.get("coverage", {}).get("hasCoverage", radius > 0))
        if radius > 0 and has_coverage and category in COVERAGE_ENTITY_CATEGORIES:
            entities.append(
                {
                    "id": f"threat-coverage-{target['id']}",
                    "name": f"{target.get('name') or target['id']}覆盖区",
                    "type": "sensor",
                    "camp": "red",
                    "layerKey": layer,
                    "color": color,
                    "geometryType": "circle",
                    "coordinates": coordinates,
                    "radius": radius,
                    "annotation": f"覆盖半径 {round(radius / 1000, 1)} km / 威胁 {target.get('threatScore')}",
                    "visible": True,
                    "meta": {
                        "targetId": target["id"],
                        "targetCategory": category,
                        "category": category,
                        "coverageTypes": target.get("coverage", {}).get("coverageTypes", []),
                    },
                }
            )

    bounds = heatmap.get("bounds") or {}
    image_overlays = []
    if bounds:
        image_overlays.append(
            {
                "id": "threat-spatial-field",
                "type": "image-overlay",
                "role": "threat-heatmap",
                "name": "数学威胁场热力图",
                "imageBase64Field": "heatmapBase64",
                "bounds": {
                    "west": bounds["minLon"],
                    "south": bounds["minLat"],
                    "east": bounds["maxLon"],
                    "north": bounds["maxLat"],
                },
                "alpha": HEATMAP_OVERLAY_ALPHA,
                "zIndex": 20,
                "rendering": "single-tile-image",
                "background": "transparent",
                "normalizedForDisplay": True,
                "displayVersion": "soft-continuous-v2",
            }
        )

    environment = []
    if bounds:
        environment.append(
            {
                "id": "threat-heat",
                "type": "threat-heat",
                "name": "威胁场范围",
                "bounds": {
                    "west": bounds["minLon"],
                    "south": bounds["minLat"],
                    "east": bounds["maxLon"],
                    "north": bounds["maxLat"],
                },
            }
        )

    return {
        "entities": entities,
        "environment": environment,
        "imageOverlays": image_overlays,
        "statistics": {
            "entityCount": len(entities),
            "targetEntityCount": len([item for item in entities if item["geometryType"] == "point"]),
            "coverageEntityCount": len([item for item in entities if item["geometryType"] == "circle"]),
            "heatmapCellCount": len(heatmap.get("grid") or []),
        },
    }
