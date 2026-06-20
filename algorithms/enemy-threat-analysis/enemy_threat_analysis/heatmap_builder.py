"""Threat heatmap and GeoJSON builder."""

from __future__ import annotations

import math
from typing import Any, Sequence

from .point_threat_field import compute_point_threat, infer_radius_by_category
from .profiles import heatmap_profile
from .schemas import ThreatExtractionJson
from .utils import average, haversine_distance_m, round_float


METERS_PER_LAT_DEGREE = 111_320.0
MIN_LOCAL_PADDING_DEGREES = 0.08
MIN_CLUSTER_LINK_METERS = 30_000.0
MAX_CLUSTER_LINK_METERS = 120_000.0


def build_heatmap(
    target_assessments: Sequence[dict[str, Any]],
    extraction: ThreatExtractionJson,
    *,
    heatmap_density: str,
    analysis_focus: str,
    impact_bias: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not any(item.get("location", {}).get("coordinates") for item in target_assessments):
        empty = build_empty_heatmap(heatmap_density)
        return empty, {"type": "FeatureCollection", "features": []}

    bounds = build_threat_bounds(target_assessments, extraction)
    if not bounds:
        empty = build_empty_heatmap(heatmap_density)
        return empty, {"type": "FeatureCollection", "features": []}

    heatmap = build_heatmap_for_bounds(
        target_assessments,
        bounds,
        heatmap_density=heatmap_density,
        analysis_focus=analysis_focus,
        impact_bias=impact_bias,
    )
    return heatmap, build_heatmap_geojson(heatmap.get("grid") or [])


def build_empty_heatmap(heatmap_density: str) -> dict[str, Any]:
    return {
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


def build_heatmap_for_bounds(
    target_assessments: Sequence[dict[str, Any]],
    bounds: dict[str, float],
    *,
    heatmap_density: str,
    analysis_focus: str,
    impact_bias: str,
) -> dict[str, Any]:
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
    return heatmap


def build_cluster_heatmaps(
    target_assessments: Sequence[dict[str, Any]],
    *,
    heatmap_density: str,
    analysis_focus: str,
    impact_bias: str,
) -> list[dict[str, Any]]:
    groups = build_target_groups(target_assessments)
    heatmaps: list[dict[str, Any]] = []
    for group in groups:
        targets = group["targets"]
        bounds = build_local_threat_bounds(targets)
        if not bounds:
            continue
        heatmap = build_heatmap_for_bounds(
            targets,
            bounds,
            heatmap_density=heatmap_density,
            analysis_focus=analysis_focus,
            impact_bias=impact_bias,
        )
        target_ids = [str(item.get("id")) for item in targets if item.get("id")]
        heatmap.update(
            {
                "groupId": group["groupId"],
                "groupName": group["groupName"],
                "targetIds": target_ids,
                "targetCount": len(target_ids),
            }
        )
        heatmaps.append(heatmap)
    return heatmaps


def build_target_groups(target_assessments: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    targets = [item for item in target_assessments if item.get("location", {}).get("coordinates")]
    if not targets:
        return []

    explicit_groups: dict[str, dict[str, Any]] = {}
    auto_targets: list[dict[str, Any]] = []
    for target in targets:
        group_id = resolve_explicit_group_value(target, "groupId", "group_id", "clusterId", "cluster_id", "targetGroupId")
        group_name = resolve_explicit_group_value(
            target,
            "groupName",
            "group_name",
            "clusterName",
            "cluster_name",
            "targetGroupName",
        )
        if group_id:
            explicit_groups.setdefault(
                group_id,
                {"groupId": group_id, "groupName": group_name or group_id, "targets": []},
            )["targets"].append(target)
        else:
            auto_targets.append(target)

    groups = list(explicit_groups.values())
    groups.extend(build_spatial_target_groups(auto_targets, start_index=len(groups) + 1))
    groups.sort(key=lambda item: group_sort_key(item["targets"]))
    for index, group in enumerate(groups, start=1):
        if not group.get("groupId"):
            group["groupId"] = f"threat-group-{index:03d}"
        if not group.get("groupName"):
            group["groupName"] = f"空间目标群 {index}"
    return groups


def build_spatial_target_groups(targets: Sequence[dict[str, Any]], *, start_index: int = 1) -> list[dict[str, Any]]:
    if not targets:
        return []
    if len(targets) == 1:
        return [
            {
                "groupId": f"threat-group-{start_index:03d}",
                "groupName": target_group_name(targets[0], start_index),
                "targets": [targets[0]],
            }
        ]

    parent = list(range(len(targets)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for left_index, left in enumerate(targets):
        for right_index in range(left_index + 1, len(targets)):
            right = targets[right_index]
            if should_link_targets(left, right):
                union(left_index, right_index)

    by_root: dict[int, list[dict[str, Any]]] = {}
    for index, target in enumerate(targets):
        by_root.setdefault(find(index), []).append(target)

    groups: list[dict[str, Any]] = []
    for offset, items in enumerate(sorted(by_root.values(), key=group_sort_key), start=start_index):
        groups.append(
            {
                "groupId": f"threat-group-{offset:03d}",
                "groupName": target_group_name(items[0], offset) if len(items) == 1 else f"空间目标群 {offset}",
                "targets": items,
            }
        )
    return groups


def should_link_targets(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_coordinates = left.get("location", {}).get("coordinates")
    right_coordinates = right.get("location", {}).get("coordinates")
    if not left_coordinates or not right_coordinates:
        return False
    distance = haversine_distance_m(left_coordinates, right_coordinates)
    link_distance = max(
        MIN_CLUSTER_LINK_METERS,
        min(MAX_CLUSTER_LINK_METERS, (target_radius_meters(left) + target_radius_meters(right)) * 0.75),
    )
    return distance <= link_distance


def target_radius_meters(target: dict[str, Any]) -> float:
    radius = float(target.get("coverage", {}).get("radiusMeters") or 0.0)
    if radius <= 0:
        radius = infer_radius_by_category(str(target.get("category") or "unknown"))
    return max(radius, 0.0)


def target_group_name(target: dict[str, Any], index: int) -> str:
    name = str(target.get("name") or target.get("id") or "").strip()
    return f"{name}目标群" if name else f"空间目标群 {index}"


def group_sort_key(targets: Sequence[dict[str, Any]]) -> tuple[float, float, str]:
    max_priority = max((float(item.get("priorityScore") or 0.0) for item in targets), default=0.0)
    max_threat = max((float(item.get("threatScore") or 0.0) for item in targets), default=0.0)
    first_id = str((targets[0] if targets else {}).get("id") or "")
    return (-max_priority, -max_threat, first_id)


def resolve_explicit_group_value(target: dict[str, Any], *keys: str) -> str:
    containers = [target, target.get("sourceTarget") or {}, target.get("meta") or {}]
    for container in containers:
        if not isinstance(container, dict):
            continue
        for key in keys:
            value = str(container.get(key) or "").strip()
            if value:
                return value
    return ""


def build_local_threat_bounds(target_assessments: Sequence[dict[str, Any]]) -> dict[str, float]:
    coordinates = [
        item.get("location", {}).get("coordinates")
        for item in target_assessments
        if item.get("location", {}).get("coordinates")
    ]
    if not coordinates:
        return {}

    lons = [float(item[0]) for item in coordinates]
    lats = [float(item[1]) for item in coordinates]
    center_lat = average(lats)
    max_radius = max((target_radius_meters(item) for item in target_assessments), default=0.0)
    radius_lat_pad = max_radius / METERS_PER_LAT_DEGREE
    radius_lon_pad = radius_lat_pad / max(0.2, math.cos(math.radians(center_lat)))
    lon_pad = max((max(lons) - min(lons)) * 0.35, radius_lon_pad * 1.1, MIN_LOCAL_PADDING_DEGREES)
    lat_pad = max((max(lats) - min(lats)) * 0.35, radius_lat_pad * 1.1, MIN_LOCAL_PADDING_DEGREES)

    return {
        "minLon": round_float(max(-180.0, min(lons) - lon_pad), 6),
        "minLat": round_float(max(-90.0, min(lats) - lat_pad), 6),
        "maxLon": round_float(min(180.0, max(lons) + lon_pad), 6),
        "maxLat": round_float(min(90.0, max(lats) + lat_pad), 6),
    }


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
