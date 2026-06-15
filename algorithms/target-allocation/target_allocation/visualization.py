"""SVG visualization for group-target allocation results."""

from __future__ import annotations

from html import escape
from pathlib import Path
from typing import Any

from .terrain import build_sampler


def _coord(value: object) -> tuple[float, float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    try:
        lon = float(value[0])
        lat = float(value[1])
    except (TypeError, ValueError):
        return None
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return lon, lat


def _bounds(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    lons = [item[0] for item in points]
    lats = [item[1] for item in points]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)
    lon_pad = max((max_lon - min_lon) * 0.10, 0.02)
    lat_pad = max((max_lat - min_lat) * 0.10, 0.02)
    return min_lon - lon_pad, max_lon + lon_pad, min_lat - lat_pad, max_lat + lat_pad


def _project(
    coord: tuple[float, float],
    *,
    bounds: tuple[float, float, float, float],
    width: int,
    height: int,
    padding: int,
) -> tuple[float, float]:
    min_lon, max_lon, min_lat, max_lat = bounds
    lon_range = max(max_lon - min_lon, 0.0001)
    lat_range = max(max_lat - min_lat, 0.0001)
    x = padding + (coord[0] - min_lon) / lon_range * (width - padding * 2)
    y = height - padding - (coord[1] - min_lat) / lat_range * (height - padding * 2)
    return round(x, 2), round(y, 2)


def _target_shape(target: dict[str, Any], x: float, y: float) -> str:
    color = {
        "air-defense": "#dc2626",
        "fire-coverage": "#ea580c",
        "recon-warning": "#d97706",
        "anti-airborne": "#be123c",
        "assessed-target": "#b91c1c",
    }.get(str(target.get("type")), "#dc2626")
    label = escape(str(target.get("name") or target.get("id") or "target"))
    return (
        f'<circle cx="{x}" cy="{y}" r="8" fill="{color}" stroke="#7f1d1d" stroke-width="1.5" />\n'
        f'<text x="{x + 10}" y="{y - 10}" class="target-label">{label}</text>'
    )


def _deployment_context_shape(context: dict[str, Any], projected_points: list[tuple[float, float]], center: tuple[float, float] | None) -> str:
    label = escape(str(context.get("name") or context.get("id") or "部署区"))
    if projected_points:
        points = " ".join(f"{x},{y}" for x, y in projected_points)
        text_x, text_y = center or projected_points[0]
        return (
            f'<polygon class="deployment-context" points="{points}">'
            f'<title>{label}：目标聚类区域，仅作上下文，不作为分配目标</title>'
            "</polygon>\n"
            f'<text x="{text_x + 8}" y="{text_y - 8}" class="context-label">{label}</text>'
        )
    if center:
        return (
            f'<circle class="deployment-context" cx="{center[0]}" cy="{center[1]}" r="44">'
            f'<title>{label}：目标聚类区域，仅作上下文，不作为分配目标</title>'
            "</circle>\n"
            f'<text x="{center[0] + 12}" y="{center[1] - 12}" class="context-label">{label}</text>'
        )
    return ""


def _group_shape(group: dict[str, Any], x: float, y: float) -> str:
    label = escape(str(group.get("name") or group.get("id") or "group"))
    return (
        f'<rect x="{x - 8}" y="{y - 8}" width="16" height="16" rx="3" fill="#2563eb" stroke="#1e3a8a" stroke-width="1.5" />\n'
        f'<text x="{x + 10}" y="{y + 18}" class="group-label">{label}</text>'
    )


def _wave_color(wave: object) -> str:
    return {
        1: "#ef4444",
        2: "#f97316",
        3: "#22c55e",
    }.get(int(wave or 1), "#64748b")


def _terrain_layers(
    result: dict[str, Any],
    *,
    terrain_dir: str | Path | None,
    bounds: tuple[float, float, float, float],
    width: int,
    height: int,
    padding: int,
) -> tuple[str, str]:
    terrain_path = terrain_dir or (result.get("appliedOptions") or {}).get("terrainDir")
    sampler = build_sampler(str(terrain_path)) if terrain_path else None
    if sampler is None:
        return "", ""
    try:
        from terrain_support.svg import build_elevation_background_svg, build_elevation_legend_svg
    except Exception:
        return "", ""
    project = lambda point: _project((float(point[0]), float(point[1])), bounds=bounds, width=width, height=height, padding=padding)
    meta = build_elevation_background_svg(
        sampler,
        bounds=bounds,
        project=project,
        cols=34,
        rows=22,
        clip_id="plot-clip",
        opacity=0.70,
    )
    return meta["svg"], build_elevation_legend_svg(meta, x=width - 292, y=154, width=212)


def build_allocation_map_svg(
    result: dict[str, Any],
    *,
    width: int = 1200,
    height: int = 820,
    terrain_dir: str | Path | None = None,
) -> str:
    targets = {target["id"]: target for target in result.get("candidateTargets") or [] if _coord(target.get("coordinates"))}
    contexts = result.get("deploymentContexts") or result.get("targetClusters") or []
    groups = {group["id"]: group for group in result.get("groups") or [] if _coord(group.get("coordinates"))}
    plan = result.get("preferredPlan") or {}
    assignments = plan.get("assignments") or []
    known_points = [_coord(item.get("coordinates")) for item in list(targets.values()) + list(groups.values())]
    for context in contexts:
        if not isinstance(context, dict):
            continue
        known_points.append(_coord(context.get("coordinates") or context.get("center")))
        polygon = context.get("polygon") or []
        if isinstance(polygon, list):
            known_points.extend(_coord(point) for point in polygon)
    points = [item for item in known_points if item is not None]
    if not points:
        raise ValueError("allocation map requires at least one target or group coordinate")
    bounds = _bounds(points)
    padding = 86
    target_positions = {
        target_id: _project(_coord(target["coordinates"]), bounds=bounds, width=width, height=height, padding=padding)  # type: ignore[arg-type]
        for target_id, target in targets.items()
    }
    group_positions = {
        group_id: _project(_coord(group["coordinates"]), bounds=bounds, width=width, height=height, padding=padding)  # type: ignore[arg-type]
        for group_id, group in groups.items()
    }
    min_lon, max_lon, min_lat, max_lat = bounds
    terrain_background, terrain_legend = _terrain_layers(
        result,
        terrain_dir=terrain_dir,
        bounds=bounds,
        width=width,
        height=height,
        padding=padding,
    )
    layers: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<defs>",
        '<marker id="arrow-wave-1" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#ef4444" /></marker>',
        '<marker id="arrow-wave-2" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#f97316" /></marker>',
        '<marker id="arrow-wave-3" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#22c55e" /></marker>',
        f'<clipPath id="plot-clip"><rect x="{padding}" y="{padding}" width="{width - padding * 2}" height="{height - padding * 2}" /></clipPath>',
        "</defs>",
        "<style>",
        "text{font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;fill:#0f172a}.title{font-size:24px;font-weight:700}.subtitle{font-size:13px;fill:#475569}.target-label,.group-label,.context-label{font-size:12px}.context-label{fill:#6d28d9;font-weight:700}.axis{font-size:11px;fill:#64748b}.assignment-arrow{fill:none;stroke-width:2.4;stroke-linecap:round;opacity:.78}.deployment-context{fill:#a78bfa;fill-opacity:.16;stroke:#7c3aed;stroke-width:2;stroke-dasharray:8 5}.panel{fill:#f8fafc;stroke:#cbd5e1;stroke-width:1}.legend{font-size:13px;fill:#334155}",
        "</style>",
        '<rect width="100%" height="100%" fill="#ffffff" />',
        f'<text x="34" y="38" class="title">智能分配算法目标分配图</text>',
        f'<text x="34" y="62" class="subtitle">按输入经纬度绘制，箭头方向为编组到目标；范围 lon {min_lon:.4f}-{max_lon:.4f}, lat {min_lat:.4f}-{max_lat:.4f}</text>',
        f'<rect x="{padding}" y="{padding}" width="{width - padding * 2}" height="{height - padding * 2}" class="panel" />',
    ]
    if terrain_background:
        layers.append(terrain_background)
    for index in range(5):
        x = padding + index * (width - padding * 2) / 4
        y = padding + index * (height - padding * 2) / 4
        lon = min_lon + index * (max_lon - min_lon) / 4
        lat = max_lat - index * (max_lat - min_lat) / 4
        layers.append(f'<line x1="{x:.2f}" y1="{padding}" x2="{x:.2f}" y2="{height - padding}" stroke="#e2e8f0" />')
        layers.append(f'<line x1="{padding}" y1="{y:.2f}" x2="{width - padding}" y2="{y:.2f}" stroke="#e2e8f0" />')
        layers.append(f'<text x="{x - 26:.2f}" y="{height - padding + 22}" class="axis">{lon:.3f}</text>')
        layers.append(f'<text x="{padding - 74}" y="{y + 4:.2f}" class="axis">{lat:.3f}</text>')
    for context in contexts:
        if not isinstance(context, dict):
            continue
        polygon = context.get("polygon") or []
        projected_polygon = []
        if isinstance(polygon, list):
            projected_polygon = [
                _project(coord, bounds=bounds, width=width, height=height, padding=padding)
                for coord in (_coord(point) for point in polygon)
                if coord is not None
            ]
        center_coord = _coord(context.get("coordinates") or context.get("center"))
        center = _project(center_coord, bounds=bounds, width=width, height=height, padding=padding) if center_coord else None
        context_shape = _deployment_context_shape(context, projected_polygon, center)
        if context_shape:
            layers.append(context_shape)
    for assignment in assignments:
        group_pos = group_positions.get(str(assignment.get("groupId")))
        target_pos = target_positions.get(str(assignment.get("targetId")))
        if not group_pos or not target_pos:
            continue
        color = _wave_color(assignment.get("wave"))
        marker_id = f"arrow-wave-{int(assignment.get('wave') or 1)}"
        layers.append(
            f'<line class="assignment-arrow" x1="{group_pos[0]}" y1="{group_pos[1]}" x2="{target_pos[0]}" y2="{target_pos[1]}" stroke="{color}" marker-end="url(#{marker_id})">'
            f'<title>{escape(str(assignment.get("groupName")))} -> {escape(str(assignment.get("targetName")))} / 匹配分 {assignment.get("matchScore")}</title>'
            "</line>"
        )
    for target_id, target in targets.items():
        x, y = target_positions[target_id]
        layers.append(_target_shape(target, x, y))
    for group_id, group in groups.items():
        x, y = group_positions[group_id]
        layers.append(_group_shape(group, x, y))
    if terrain_legend:
        layers.append(terrain_legend)
    layers.extend(
        [
            f'<rect x="{width - 260}" y="28" width="222" height="122" rx="6" fill="#ffffff" stroke="#cbd5e1" />',
            f'<rect x="{width - 240}" y="50" width="16" height="16" rx="3" fill="#2563eb" /><text x="{width - 216}" y="63" class="legend">蓝方编组</text>',
            f'<circle cx="{width - 232}" cy="84" r="8" fill="#dc2626" /><text x="{width - 216}" y="88" class="legend">敌方目标</text>',
            f'<line x1="{width - 242}" y1="106" x2="{width - 214}" y2="106" stroke="#ef4444" class="assignment-arrow" marker-end="url(#arrow-wave-1)" /><text x="{width - 206}" y="110" class="legend">分配箭头</text>',
            f'<rect x="{width - 242}" y="124" width="22" height="12" fill="#a78bfa" fill-opacity=".16" stroke="#7c3aed" stroke-dasharray="4 3" /><text x="{width - 206}" y="135" class="legend">部署区上下文</text>',
            "</svg>",
        ]
    )
    return "\n".join(layers)


def render_allocation_map(
    result: dict[str, Any],
    output_path: str | Path,
    *,
    width: int = 1200,
    height: int = 820,
    terrain_dir: str | Path | None = None,
) -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_allocation_map_svg(result, width=width, height=height, terrain_dir=terrain_dir), encoding="utf-8")
    return path
