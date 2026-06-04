"""SVG helpers for terrain elevation backgrounds."""

from __future__ import annotations

from typing import Any, Callable


PointProjector = Callable[[list[float]], tuple[float, float]]


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def _mix_color(left: str, right: str, ratio: float) -> str:
    lr, lg, lb = _hex_to_rgb(left)
    rr, rg, rb = _hex_to_rgb(right)
    return _rgb_to_hex(
        (
            round(lr + (rr - lr) * ratio),
            round(lg + (rg - lg) * ratio),
            round(lb + (rb - lb) * ratio),
        )
    )


def elevation_color(elevation: float, min_elevation: float, max_elevation: float) -> str:
    span = max(max_elevation - min_elevation, 1.0)
    value = max(0.0, min(1.0, (elevation - min_elevation) / span))
    stops = [
        (0.00, "#0e7490"),
        (0.22, "#22c55e"),
        (0.45, "#eab308"),
        (0.68, "#c2410c"),
        (0.86, "#92400e"),
        (1.00, "#f8fafc"),
    ]
    for index in range(len(stops) - 1):
        left_value, left_color = stops[index]
        right_value, right_color = stops[index + 1]
        if left_value <= value <= right_value:
            local = (value - left_value) / max(right_value - left_value, 0.0001)
            return _mix_color(left_color, right_color, local)
    return stops[-1][1]


def build_elevation_background_svg(
    sampler: Any,
    *,
    bounds: tuple[float, float, float, float],
    project: PointProjector,
    cols: int = 32,
    rows: int = 20,
    clip_id: str | None = None,
    opacity: float = 0.72,
) -> dict[str, Any]:
    min_lon, max_lon, min_lat, max_lat = bounds
    lon_span = max(max_lon - min_lon, 0.0001)
    lat_span = max(max_lat - min_lat, 0.0001)
    cells: list[dict[str, Any]] = []
    sample_count = cols * rows
    for row in range(rows):
        lat0 = min_lat + row / rows * lat_span
        lat1 = min_lat + (row + 1) / rows * lat_span
        center_lat = (lat0 + lat1) / 2
        for col in range(cols):
            lon0 = min_lon + col / cols * lon_span
            lon1 = min_lon + (col + 1) / cols * lon_span
            center_lon = (lon0 + lon1) / 2
            sample = sampler.sample(center_lon, center_lat)
            if not sample.ok or sample.elevationM is None:
                continue
            cells.append(
                {
                    "lon0": lon0,
                    "lon1": lon1,
                    "lat0": lat0,
                    "lat1": lat1,
                    "elevation": float(sample.elevationM),
                    "penalty": float(sample.terrainPenalty),
                    "zoomUsed": sample.zoomUsed,
                }
            )
    if not cells:
        return {
            "svg": "",
            "status": "neutral",
            "sampleCount": sample_count,
            "sampledCount": 0,
            "minElevationM": None,
            "maxElevationM": None,
            "averagePenalty": 0.0,
            "zoomUsed": None,
        }
    elevations = [cell["elevation"] for cell in cells]
    penalties = [cell["penalty"] for cell in cells]
    zooms = [cell["zoomUsed"] for cell in cells if cell["zoomUsed"] is not None]
    min_elevation = min(elevations)
    max_elevation = max(elevations)
    clip_attr = f' clip-path="url(#{clip_id})"' if clip_id else ""
    parts = [
        f'<g class="terrain-elevation-layer"{clip_attr} opacity="{opacity:.2f}">',
        f"<title>地形高程背景：{min_elevation:.1f}m - {max_elevation:.1f}m，采样 {len(cells)}/{sample_count} 点</title>",
    ]
    for cell in cells:
        x0, y0 = project([cell["lon0"], cell["lat1"], 0])
        x1, y1 = project([cell["lon1"], cell["lat0"], 0])
        color = elevation_color(cell["elevation"], min_elevation, max_elevation)
        parts.append(
            f'<rect x="{min(x0, x1):.2f}" y="{min(y0, y1):.2f}" '
            f'width="{abs(x1 - x0) + 0.8:.2f}" height="{abs(y1 - y0) + 0.8:.2f}" '
            f'fill="{color}" stroke="none" />'
        )
    parts.append("</g>")
    return {
        "svg": "\n".join(parts),
        "status": "sampled",
        "sampleCount": sample_count,
        "sampledCount": len(cells),
        "minElevationM": round(min_elevation, 2),
        "maxElevationM": round(max_elevation, 2),
        "averagePenalty": round(sum(penalties) / len(penalties), 2),
        "zoomUsed": max(zooms) if zooms else None,
    }


def build_elevation_legend_svg(meta: dict[str, Any], *, x: float, y: float, width: float = 210, height: float = 66) -> str:
    if meta.get("status") != "sampled":
        return ""
    min_elevation = float(meta.get("minElevationM") or 0.0)
    max_elevation = float(meta.get("maxElevationM") or min_elevation)
    swatch_count = 28
    swatch_width = width / swatch_count
    parts = [
        f'<g class="terrain-elevation-legend">',
        f'<rect x="{x}" y="{y}" width="{width + 24}" height="{height}" rx="6" fill="#ffffff" fill-opacity=".90" stroke="#cbd5e1" />',
        f'<text x="{x + 12}" y="{y + 20}" class="legend">地形高程背景</text>',
    ]
    for index in range(swatch_count):
        ratio = index / max(swatch_count - 1, 1)
        elevation = min_elevation + (max_elevation - min_elevation) * ratio
        parts.append(
            f'<rect x="{x + 12 + index * swatch_width:.2f}" y="{y + 29}" '
            f'width="{swatch_width + 0.3:.2f}" height="12" fill="{elevation_color(elevation, min_elevation, max_elevation)}" />'
        )
    parts.append(f'<text x="{x + 12}" y="{y + 56}" class="axis">{min_elevation:.0f}m</text>')
    parts.append(f'<text x="{x + width - 22}" y="{y + 56}" class="axis">{max_elevation:.0f}m</text>')
    parts.append("</g>")
    return "\n".join(parts)
