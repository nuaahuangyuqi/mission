"""PNG image rendering for heatmaps and annotated target maps."""

from __future__ import annotations

import base64
import io
import math
from pathlib import Path
from typing import Any, Sequence

from PIL import Image, ImageDraw, ImageFilter, ImageFont


IMAGE_SIZE = 960
PADDING = 68
RESAMPLE_BICUBIC = getattr(getattr(Image, "Resampling", Image), "BICUBIC")
RESAMPLE_LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS")


def build_heatmap_base64(heatmap: dict[str, Any]) -> str:
    image = _render_heatmap_texture(heatmap)
    if image is None:
        return ""
    return _image_to_base64(image)


def build_target_map_base64(
    target_assessments: Sequence[dict[str, Any]],
    heatmap: dict[str, Any],
) -> str:
    targets = [item for item in target_assessments if item.get("location", {}).get("coordinates")]
    bounds = _view_bounds(targets, heatmap.get("bounds") or {})
    if not targets or not bounds:
        return ""

    image = Image.new("RGB", (IMAGE_SIZE, IMAGE_SIZE), "#f8fafc")
    draw = ImageDraw.Draw(image, "RGBA")
    font = _load_font(24)
    small_font = _load_font(18)

    _draw_grid(draw, bounds, small_font)
    for target in sorted(targets, key=lambda item: float(item.get("priorityScore") or 0.0)):
        coordinates = target["location"]["coordinates"]
        x, y = _project(coordinates[0], coordinates[1], bounds)
        radius_m = float(target.get("coverage", {}).get("radiusMeters") or 0.0)
        if radius_m > 0:
            pixel_radius = max(8, int(_meters_to_pixel_radius(radius_m, coordinates[1], bounds)))
            draw.ellipse(
                [x - pixel_radius, y - pixel_radius, x + pixel_radius, y + pixel_radius],
                outline=(239, 68, 68, 90),
                width=2,
                fill=(239, 68, 68, 22),
            )
        color = _category_color(target.get("category", "unknown"))
        draw.ellipse([x - 7, y - 7, x + 7, y + 7], fill=color, outline=(15, 23, 42, 255), width=2)
        label = f"{target.get('name', target.get('id'))} {target.get('threatScore')}分"
        _draw_target_label(draw, x, y, label, small_font)

    title = "敌情威胁目标位置与标注"
    draw.rectangle([0, 0, IMAGE_SIZE, 54], fill=(15, 23, 42, 230))
    draw.text((24, 14), title, fill=(255, 255, 255, 255), font=font)
    return _image_to_base64(image)


def build_combined_map_base64(
    target_assessments: Sequence[dict[str, Any]],
    heatmap: dict[str, Any],
) -> str:
    """Render heatmap and target coverage annotations in one view."""
    targets = [item for item in target_assessments if item.get("location", {}).get("coordinates")]
    bounds = _view_bounds(targets, heatmap.get("bounds") or {})
    if not targets or not bounds:
        return ""

    image = Image.new("RGBA", (IMAGE_SIZE, IMAGE_SIZE), (248, 250, 252, 255))
    _paste_heatmap_overlay(image, heatmap, bounds, opacity_scale=0.55)
    draw = ImageDraw.Draw(image, "RGBA")
    font = _load_font(24)
    small_font = _load_font(18)

    _draw_grid(draw, bounds, small_font)
    _draw_targets(draw, targets, bounds, small_font, coverage_fill_alpha=0)

    title = "敌情威胁热力图与目标覆盖"
    draw.rectangle([0, 0, IMAGE_SIZE, 54], fill=(15, 23, 42, 230))
    draw.text((24, 14), title, fill=(255, 255, 255, 255), font=font)
    return _image_to_base64(image)


def write_base64_png(data: str, path: str | Path) -> None:
    if not data:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(base64.b64decode(data))


def _image_to_base64(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _heat_color(
    score: float,
    heatmap: dict[str, Any] | None = None,
    *,
    display_floor: float | None = None,
) -> tuple[int, int, int, int]:
    statistics = heatmap.get("statistics") if heatmap else {}
    max_score = float((statistics or {}).get("maxThreat") or 100.0)
    scale = max(max_score, 1.0)
    score = max(0.0, float(score or 0.0))
    if display_floor is not None:
        floor = max(0.0, min(display_floor, scale * 0.9))
        floor_ratio = floor / scale if scale > 0 else 0.0
        raw_value = score / scale
        if raw_value <= floor_ratio:
            value = 0.1 * (raw_value / max(floor_ratio, 1e-9))
        else:
            value = 0.1 + ((raw_value - floor_ratio) / max(1.0 - floor_ratio, 1e-9)) * 0.9
    else:
        value = score / scale
    value = max(0.0, min(value, 1.0))
    if value <= 0.004:
        return (0, 0, 0, 0)
    color_value = math.sqrt(value)
    if color_value < 0.33:
        ratio = color_value / 0.33
        r = int(34 + ratio * (234 - 34))
        g = int(197 + ratio * (179 - 197))
        b = int(94 + ratio * (8 - 94))
    elif color_value < 0.66:
        ratio = (color_value - 0.33) / 0.33
        r = int(234 + ratio * (249 - 234))
        g = int(179 + ratio * (115 - 179))
        b = int(8 + ratio * (22 - 8))
    else:
        ratio = (color_value - 0.66) / 0.34
        r = int(249 + ratio * (185 - 249))
        g = int(115 + ratio * (28 - 115))
        b = int(22 + ratio * (28 - 22))
    alpha = int((value**0.85) * 224)
    return (r, g, b, max(0, min(alpha, 224)))


def _grid_size_from_heatmap(heatmap: dict[str, Any]) -> int:
    grid = heatmap.get("grid") or []
    grid_size = int(round(math.sqrt(len(grid))))
    if grid_size <= 0 or grid_size * grid_size != len(grid):
        return 0
    return grid_size


def _heatmap_display_floor(heatmap: dict[str, Any]) -> float:
    grid = heatmap.get("grid") or []
    scores = sorted(float(item.get("threatScore") or 0.0) for item in grid if float(item.get("threatScore") or 0.0) > 0)
    if not scores:
        return 0.0
    statistics = heatmap.get("statistics") or {}
    max_score = max(float(statistics.get("maxThreat") or 0.0), scores[-1], 1.0)
    percentile_index = int((len(scores) - 1) * 0.35)
    percentile_floor = scores[percentile_index]
    return min(max(percentile_floor, max_score * 0.18), max_score * 0.75)


def _parse_grid_position(item: dict[str, Any], grid_size: int) -> tuple[int, int] | None:
    point_id = str(item.get("point", {}).get("id") or "")
    parts = point_id.split("-")
    if len(parts) < 3:
        return None
    try:
        row = int(parts[-2])
        col = int(parts[-1])
    except ValueError:
        return None
    if not (0 <= row < grid_size and 0 <= col < grid_size):
        return None
    return row, col


def _heatmap_blur_radius(size: int, grid_size: int) -> float:
    if grid_size <= 0:
        return 0.0
    cell = size / grid_size
    return max(2.0, min(18.0, cell * 0.72))


def _render_heatmap_texture(
    heatmap: dict[str, Any],
    *,
    size: int = IMAGE_SIZE,
) -> Image.Image | None:
    grid = heatmap.get("grid") or []
    bounds = heatmap.get("bounds") or {}
    grid_size = _grid_size_from_heatmap(heatmap)
    if not grid or not bounds or grid_size <= 0:
        return None

    source = Image.new("RGBA", (grid_size, grid_size), (0, 0, 0, 0))
    pixels = source.load()
    display_floor = _heatmap_display_floor(heatmap)
    for item in grid:
        position = _parse_grid_position(item, grid_size)
        if position is None:
            continue
        row, col = position
        score = float(item.get("threatScore") or 0.0)
        color = _heat_color(score, heatmap, display_floor=display_floor)
        if color[3] <= 0:
            continue
        pixels[col, grid_size - row - 1] = color

    image = source.resize((size, size), RESAMPLE_BICUBIC)
    blur_radius = _heatmap_blur_radius(size, grid_size)
    if blur_radius <= 0:
        return image

    padding = int(math.ceil(blur_radius * 3))
    padded = Image.new("RGBA", (size + padding * 2, size + padding * 2), (0, 0, 0, 0))
    padded.alpha_composite(image, (padding, padding))
    blurred = padded.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    return blurred.crop((padding, padding, padding + size, padding + size))


def _scale_alpha(image: Image.Image, opacity_scale: float) -> Image.Image:
    if opacity_scale >= 0.999:
        return image
    scaled = image.copy()
    alpha = scaled.getchannel("A").point(lambda value: int(value * max(0.0, min(opacity_scale, 1.0))))
    scaled.putalpha(alpha)
    return scaled


def _paste_heatmap_overlay(
    image: Image.Image,
    heatmap: dict[str, Any],
    view_bounds: dict[str, float],
    *,
    opacity_scale: float,
) -> None:
    heat_bounds = heatmap.get("bounds") or {}
    if not heat_bounds:
        return
    texture = _render_heatmap_texture(heatmap)
    if texture is None:
        return

    x1, y1 = _project(float(heat_bounds["minLon"]), float(heat_bounds["minLat"]), view_bounds)
    x2, y2 = _project(float(heat_bounds["maxLon"]), float(heat_bounds["maxLat"]), view_bounds)
    left, right = sorted((x1, x2))
    top, bottom = sorted((y1, y2))
    width = max(1, right - left)
    height = max(1, bottom - top)
    texture = _scale_alpha(texture.resize((width, height), RESAMPLE_LANCZOS), opacity_scale)

    crop_left = max(0, -left)
    crop_top = max(0, -top)
    crop_right = width - max(0, right - IMAGE_SIZE)
    crop_bottom = height - max(0, bottom - IMAGE_SIZE)
    if crop_left >= crop_right or crop_top >= crop_bottom:
        return
    texture = texture.crop((crop_left, crop_top, crop_right, crop_bottom))
    image.alpha_composite(texture, (max(0, left), max(0, top)))


def _category_color(category: str) -> tuple[int, int, int, int]:
    colors = {
        "fire_unit": (239, 68, 68, 255),
        "air_defense": (249, 115, 22, 255),
        "recon_sensor": (14, 165, 233, 255),
        "command_control": (168, 85, 247, 255),
        "mobility_unit": (34, 197, 94, 255),
        "logistics_support": (234, 179, 8, 255),
        "fortification": (100, 116, 139, 255),
        "electronic_warfare": (20, 184, 166, 255),
    }
    return colors.get(category, (148, 163, 184, 255))


def _view_bounds(targets: Sequence[dict[str, Any]], base_bounds: dict[str, float] | None = None) -> dict[str, float]:
    bounds = _bounds_including_coverage(targets)
    base = dict(base_bounds or {})
    if base and {"minLon", "minLat", "maxLon", "maxLat"} <= set(base):
        if bounds:
            bounds = {
                "minLon": min(bounds["minLon"], float(base["minLon"])),
                "minLat": min(bounds["minLat"], float(base["minLat"])),
                "maxLon": max(bounds["maxLon"], float(base["maxLon"])),
                "maxLat": max(bounds["maxLat"], float(base["maxLat"])),
            }
        else:
            bounds = {
                "minLon": float(base["minLon"]),
                "minLat": float(base["minLat"]),
                "maxLon": float(base["maxLon"]),
                "maxLat": float(base["maxLat"]),
            }
    if not bounds:
        return {}
    return _pad_bounds(bounds, 0.08)


def _bounds_including_coverage(targets: Sequence[dict[str, Any]]) -> dict[str, float]:
    extents: list[tuple[float, float, float, float]] = []
    for target in targets:
        coordinates = target.get("location", {}).get("coordinates")
        if not coordinates:
            continue
        lon = float(coordinates[0])
        lat = float(coordinates[1])
        radius_m = max(0.0, float(target.get("coverage", {}).get("radiusMeters") or 0.0))
        lat_delta = radius_m / 111_320.0
        lon_delta = radius_m / (111_320.0 * max(0.2, math.cos(math.radians(lat))))
        point_pad = 0.02
        extents.append(
            (
                lon - max(lon_delta, point_pad),
                lat - max(lat_delta, point_pad),
                lon + max(lon_delta, point_pad),
                lat + max(lat_delta, point_pad),
            )
        )
    if not extents:
        return {}
    return {
        "minLon": min(item[0] for item in extents),
        "minLat": min(item[1] for item in extents),
        "maxLon": max(item[2] for item in extents),
        "maxLat": max(item[3] for item in extents),
    }


def _pad_bounds(bounds: dict[str, float], ratio: float) -> dict[str, float]:
    lon_span = max(bounds["maxLon"] - bounds["minLon"], 1e-6)
    lat_span = max(bounds["maxLat"] - bounds["minLat"], 1e-6)
    lon_pad = max(lon_span * ratio, 0.02)
    lat_pad = max(lat_span * ratio, 0.02)
    return {
        "minLon": bounds["minLon"] - lon_pad,
        "minLat": bounds["minLat"] - lat_pad,
        "maxLon": bounds["maxLon"] + lon_pad,
        "maxLat": bounds["maxLat"] + lat_pad,
    }


def _project(lon: float, lat: float, bounds: dict[str, float]) -> tuple[int, int]:
    min_lon, max_lon = bounds["minLon"], bounds["maxLon"]
    min_lat, max_lat = bounds["minLat"], bounds["maxLat"]
    width = max(max_lon - min_lon, 1e-9)
    height = max(max_lat - min_lat, 1e-9)
    x = PADDING + (lon - min_lon) / width * (IMAGE_SIZE - PADDING * 2)
    y = IMAGE_SIZE - PADDING - (lat - min_lat) / height * (IMAGE_SIZE - PADDING * 2)
    return int(round(x)), int(round(y))


def _meters_to_pixel_radius(radius_m: float, lat: float, bounds: dict[str, float]) -> float:
    meters_per_degree_lon = 111_320.0 * max(0.2, math.cos(math.radians(lat)))
    lon_span_m = max((bounds["maxLon"] - bounds["minLon"]) * meters_per_degree_lon, 1.0)
    drawable = IMAGE_SIZE - PADDING * 2
    return radius_m / lon_span_m * drawable


def _draw_grid(draw: ImageDraw.ImageDraw, bounds: dict[str, float], font: ImageFont.ImageFont) -> None:
    frame = [PADDING, PADDING, IMAGE_SIZE - PADDING, IMAGE_SIZE - PADDING]
    draw.rectangle(frame, outline=(51, 65, 85, 255), width=2)
    for index in range(1, 5):
        x = PADDING + (IMAGE_SIZE - PADDING * 2) * index / 5
        y = PADDING + (IMAGE_SIZE - PADDING * 2) * index / 5
        draw.line([x, PADDING, x, IMAGE_SIZE - PADDING], fill=(148, 163, 184, 70), width=1)
        draw.line([PADDING, y, IMAGE_SIZE - PADDING, y], fill=(148, 163, 184, 70), width=1)
    draw.text((PADDING, IMAGE_SIZE - PADDING + 12), f"{bounds['minLon']:.3f}, {bounds['minLat']:.3f}", fill=(71, 85, 105), font=font)
    draw.text((IMAGE_SIZE - PADDING - 190, PADDING + 8), f"{bounds['maxLon']:.3f}, {bounds['maxLat']:.3f}", fill=(71, 85, 105), font=font)


def _draw_heatmap_overlay(
    draw: ImageDraw.ImageDraw,
    heatmap: dict[str, Any],
    view_bounds: dict[str, float],
) -> None:
    grid = heatmap.get("grid") or []
    heat_bounds = heatmap.get("bounds") or {}
    if not grid or not heat_bounds:
        return
    grid_size = int(round(math.sqrt(len(grid))))
    if grid_size <= 0:
        return
    lon_step = (float(heat_bounds["maxLon"]) - float(heat_bounds["minLon"])) / max(1, grid_size - 1)
    lat_step = (float(heat_bounds["maxLat"]) - float(heat_bounds["minLat"])) / max(1, grid_size - 1)
    for item in grid:
        lon, lat = item["point"]["coordinates"][:2]
        x1, y1 = _project(float(lon) - lon_step / 2, float(lat) - lat_step / 2, view_bounds)
        x2, y2 = _project(float(lon) + lon_step / 2, float(lat) + lat_step / 2, view_bounds)
        score = float(item.get("threatScore") or 0.0)
        color = _heat_color(score, heatmap)
        color = (color[0], color[1], color[2], int(color[3] * 0.55))
        draw.rectangle([min(x1, x2), min(y1, y2), max(x1, x2) + 1, max(y1, y2) + 1], fill=color)


def _draw_targets(
    draw: ImageDraw.ImageDraw,
    targets: Sequence[dict[str, Any]],
    bounds: dict[str, float],
    font: ImageFont.ImageFont,
    *,
    coverage_fill_alpha: int,
) -> None:
    for target in sorted(targets, key=lambda item: float(item.get("priorityScore") or 0.0)):
        coordinates = target["location"]["coordinates"]
        x, y = _project(coordinates[0], coordinates[1], bounds)
        radius_m = float(target.get("coverage", {}).get("radiusMeters") or 0.0)
        color = _category_color(target.get("category", "unknown"))
        if radius_m <= 0:
            continue
        pixel_radius = max(8, int(_meters_to_pixel_radius(radius_m, coordinates[1], bounds)))
        draw.ellipse(
            [x - pixel_radius, y - pixel_radius, x + pixel_radius, y + pixel_radius],
            outline=(255, 255, 255, 220),
            width=6,
        )
        draw.ellipse(
            [x - pixel_radius, y - pixel_radius, x + pixel_radius, y + pixel_radius],
            outline=(color[0], color[1], color[2], 230),
            width=3,
            fill=(color[0], color[1], color[2], coverage_fill_alpha) if coverage_fill_alpha > 0 else None,
        )

    for target in sorted(targets, key=lambda item: float(item.get("priorityScore") or 0.0)):
        coordinates = target["location"]["coordinates"]
        x, y = _project(coordinates[0], coordinates[1], bounds)
        color = _category_color(target.get("category", "unknown"))
        draw.ellipse([x - 7, y - 7, x + 7, y + 7], fill=color, outline=(15, 23, 42, 255), width=2)
        label = f"{target.get('name', target.get('id'))} {target.get('threatScore')}分"
        _draw_target_label(draw, x, y, label, font)


def _draw_target_label(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    label: str,
    font: ImageFont.ImageFont,
) -> None:
    bbox = draw.textbbox((0, 0), label, font=font)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    label_x = x + 12
    label_y = y - height // 2
    if label_x + width + 8 > IMAGE_SIZE - PADDING:
        label_x = x - width - 12
    if label_y < PADDING:
        label_y = y + 12
    if label_y + height + 8 > IMAGE_SIZE - PADDING:
        label_y = y - height - 14
    label_x = max(PADDING + 4, min(label_x, IMAGE_SIZE - PADDING - width - 4))
    label_y = max(PADDING + 4, min(label_y, IMAGE_SIZE - PADDING - height - 4))
    draw.rounded_rectangle(
        [label_x - 4, label_y - 3, label_x + width + 4, label_y + height + 3],
        radius=4,
        fill=(248, 250, 252, 205),
        outline=(148, 163, 184, 160),
        width=1,
    )
    draw.text((label_x, label_y), label, fill=(15, 23, 42, 255), font=font)


def _load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                continue
    return ImageFont.load_default()
