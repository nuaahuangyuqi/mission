import hashlib
import math
import random
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from pyproj import Transformer

from config import AirlandingConfig, CONFIG
from dem_provider import OpenTopoDataProvider, create_dem_provider, expand_bounds, format_bounds, intersect_bounds
from landcover_provider import OSMLandcoverProvider
from threat_field import ThreatField


Point = Tuple[float, float]


def progress(message: str) -> None:
    print(f"[LandingZone] {message}", file=sys.stderr, flush=True)


@dataclass
class Candidate:
    center: Dict[str, float]
    polygon: List[List[float]]
    threat_value: float
    terrain_score: float
    distance_score: float
    composite_score: float
    elevation_m: float
    slope_deg: float
    relief_m: float
    nearest_threat_distance_km: float
    nearest_threat_id: str
    polygon_area_sqkm: float = 0.0
    mountain_penalty: float = 0.0
    forest_penalty: float = 0.0
    urban_penalty: float = 0.0
    surface_penalty: float = 0.0
    terrain_class: str = "unknown"
    landing_id: str = ""
    candidate_id: str = ""
    zone_id: str = ""
    area_size_sqkm: float = 0.0
    area_distance_km: float = 0.0
    selected: bool = False
    refined_min_elevation_m: float = 0.0
    refined_max_elevation_m: float = 0.0
    refined_mean_elevation_m: float = 0.0
    refined_elevation_std_m: float = 0.0
    refined_relief_m: float = 0.0
    refined_max_slope_deg: float = 0.0
    refined_mean_slope_deg: float = 0.0
    refined_terrain_score: float = 0.0
    refined_rejected: bool = False
    refined_reject_reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "landing_id": self.landing_id,
            "candidate_id": self.candidate_id,
            "zone_id": self.zone_id,
            "center": self.center,
            "polygon": self.polygon,
            "area_size_sqkm": self.area_size_sqkm,
            "area_distance_km": self.area_distance_km,
            "threat_value": self.threat_value,
            "terrain_score": self.terrain_score,
            "distance_score": self.distance_score,
            "composite_score": self.composite_score,
            "elevation_m": self.elevation_m,
            "slope_deg": self.slope_deg,
            "relief_m": self.relief_m,
            "nearest_threat_distance_km": self.nearest_threat_distance_km,
            "nearest_threat_id": self.nearest_threat_id,
            "polygon_area_sqkm": self.polygon_area_sqkm,
            "mountain_penalty": self.mountain_penalty,
            "forest_penalty": self.forest_penalty,
            "urban_penalty": self.urban_penalty,
            "surface_penalty": self.surface_penalty,
            "terrain_class": self.terrain_class,
            "selected": self.selected,
            "refined_min_elevation_m": self.refined_min_elevation_m,
            "refined_max_elevation_m": self.refined_max_elevation_m,
            "refined_mean_elevation_m": self.refined_mean_elevation_m,
            "refined_elevation_std_m": self.refined_elevation_std_m,
            "refined_relief_m": self.refined_relief_m,
            "refined_max_slope_deg": self.refined_max_slope_deg,
            "refined_mean_slope_deg": self.refined_mean_slope_deg,
            "refined_terrain_score": self.refined_terrain_score,
            "refined_rejected": self.refined_rejected,
            "refined_reject_reason": self.refined_reject_reason,
        }


def resolve_bounds(payload: Dict[str, Any]) -> Dict[str, float]:
    target_points = extract_target_points(payload)
    if target_points:
        target_bounds = bounds_from_points(target_points)
        report_bounds = payload.get("bounds") or {}
        if all(isinstance(report_bounds.get(k), (int, float)) for k in ("west", "south", "east", "north")):
            report_bounds = {k: float(report_bounds[k]) for k in ("west", "south", "east", "north")}
            report_width_km, report_height_km = bounds_size_km(report_bounds)
            target_width_km, target_height_km = bounds_size_km(target_bounds)
            if report_width_km > target_width_km * 2.5 or report_height_km > target_height_km * 2.5:
                progress(
                    "报告 bounds 与目标坐标差异过大，已改用目标坐标局部边界: "
                    f"W{target_bounds['west']:.4f}, S{target_bounds['south']:.4f}, "
                    f"E{target_bounds['east']:.4f}, N{target_bounds['north']:.4f}"
                )
            else:
                progress("已优先使用目标坐标计算机降局部边界，避免热力图 bounds 过度外扩")
        return target_bounds

    bounds = payload.get("bounds") or {}
    if all(isinstance(bounds.get(k), (int, float)) for k in ("west", "south", "east", "north")):
        return {k: float(bounds[k]) for k in ("west", "south", "east", "north")}

    raise ValueError("缺少可用 bounds，且目标中没有可计算边界的经纬度")


def extract_target_points(payload: Dict[str, Any]) -> List[Point]:
    targets = payload.get("targets") or []
    points: List[Point] = []
    for target in targets:
        lng = target.get("lng")
        lat = target.get("lat")
        if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
            location = target.get("location") or {}
            if isinstance(location, dict):
                lng = location.get("lng")
                lat = location.get("lat")
        if isinstance(lng, (int, float)) and isinstance(lat, (int, float)):
            lng = float(lng)
            lat = float(lat)
            if -180 <= lng <= 180 and -90 <= lat <= 90:
                points.append((lng, lat))
    return points


def bounds_from_points(points: List[Point]) -> Dict[str, float]:
    filtered = robust_target_points(points)
    lngs = [point[0] for point in filtered]
    lats = [point[1] for point in filtered]
    return {
        "west": min(lngs),
        "south": min(lats),
        "east": max(lngs),
        "north": max(lats),
    }


def robust_target_points(points: List[Point]) -> List[Point]:
    if len(points) < 4:
        return points
    raw_bounds = {
        "west": min(point[0] for point in points),
        "south": min(point[1] for point in points),
        "east": max(point[0] for point in points),
        "north": max(point[1] for point in points),
    }
    width_km, height_km = bounds_size_km(raw_bounds)
    if max(width_km, height_km) <= CONFIG.max_target_bounds_span_km:
        return points

    sorted_lng = sorted(point[0] for point in points)
    sorted_lat = sorted(point[1] for point in points)
    median_lng = sorted_lng[len(sorted_lng) // 2]
    median_lat = sorted_lat[len(sorted_lat) // 2]
    filtered = [
        point for point in points
        if approx_distance_km(point[0], point[1], median_lng, median_lat) <= CONFIG.target_outlier_distance_km
    ]
    if len(filtered) >= max(3, len(points) // 2):
        progress(f"目标坐标跨度过大，已剔除 {len(points) - len(filtered)} 个远离主区域的离群目标用于机降搜索边界")
        return filtered
    return points


def bounds_size_km(bounds: Dict[str, float]) -> Tuple[float, float]:
    center_lat = (float(bounds["south"]) + float(bounds["north"])) / 2
    width = abs(float(bounds["east"]) - float(bounds["west"])) * 111.320 * max(math.cos(math.radians(center_lat)), 1e-6)
    height = abs(float(bounds["north"]) - float(bounds["south"])) * 110.574
    return width, height


def shrink_bounds_by_km(bounds: Dict[str, float], margin_km: float) -> Dict[str, float]:
    if margin_km <= 0:
        return bounds
    center_lat = (float(bounds["south"]) + float(bounds["north"])) / 2
    lat_margin = margin_km / 110.574
    lng_margin = margin_km / max(111.320 * math.cos(math.radians(center_lat)), 1e-6)
    west = float(bounds["west"]) + lng_margin
    east = float(bounds["east"]) - lng_margin
    south = float(bounds["south"]) + lat_margin
    north = float(bounds["north"]) - lat_margin
    if west >= east or south >= north:
        return bounds
    return {
        "west": west,
        "south": south,
        "east": east,
        "north": north,
    }


def approx_distance_km(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    mean_lat = math.radians((lat1 + lat2) / 2)
    dx = (lng1 - lng2) * 111.320 * math.cos(mean_lat)
    dy = (lat1 - lat2) * 110.574
    return math.hypot(dx, dy)


def choose_utm_epsg(bounds: Dict[str, float]) -> int:
    center_lng = (bounds["west"] + bounds["east"]) / 2
    center_lat = (bounds["south"] + bounds["north"]) / 2
    zone = int((center_lng + 180) / 6) + 1
    return (32600 if center_lat >= 0 else 32700) + zone


def stable_sampling_seed(bounds: Dict[str, float], padding_km: float, landing_id: str) -> int:
    seed_key = "|".join([
        f"{bounds['west']:.6f}",
        f"{bounds['south']:.6f}",
        f"{bounds['east']:.6f}",
        f"{bounds['north']:.6f}",
        f"{padding_km:.3f}",
        landing_id or "landing",
    ])
    digest = hashlib.sha256(seed_key.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def polygon_area(points: List[Tuple[float, float]]) -> float:
    area = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        area += (x1 * y2) - (x2 * y1)
    return abs(area) / 2


def polygon_from_center(
    transformer_to_ll: Transformer,
    x: float,
    y: float,
    area_size_sqkm: float,
    fallback_size_m: float,
    terrain_points: Optional[List[Tuple[float, float, float, float]]] = None,
    center_elevation: float = 0.0,
) -> Tuple[List[List[float]], float]:
    area_m2 = max(area_size_sqkm, 0.05) * 1_000_000
    base_radius = math.sqrt(area_m2 / math.pi)
    terrain_vectors = []
    for sx, sy, distance_m, elevation in terrain_points or []:
        dx = sx - x
        dy = sy - y
        if distance_m < 1 or (abs(dx) < 1e-6 and abs(dy) < 1e-6):
            continue
        terrain_vectors.append({
            "angle": math.atan2(dy, dx),
            "grade": (elevation - center_elevation) / max(distance_m, 1.0),
            "delta": elevation - center_elevation,
        })

    vertex_count = 16
    angle_offset = math.radians(5)
    local_points = []
    for index in range(vertex_count):
        angle = angle_offset + (2 * math.pi * index / vertex_count)
        grade = 0.0
        delta = 0.0
        weight_total = 0.0
        for vector in terrain_vectors:
            diff = abs(math.atan2(math.sin(angle - vector["angle"]), math.cos(angle - vector["angle"])))
            weight = max(0.0, math.cos(diff)) ** 2
            if weight <= 0:
                continue
            grade += vector["grade"] * weight
            delta += vector["delta"] * weight
            weight_total += weight
        if weight_total:
            grade /= weight_total
            delta /= weight_total

        uphill_penalty = clamp(max(grade, 0.0) / 0.12) * 0.34
        rough_penalty = clamp((abs(grade) - 0.035) / 0.12) * 0.16
        high_penalty = clamp(max(delta, 0.0) / 28.0) * 0.18
        flat_bonus = clamp((0.045 - abs(grade)) / 0.045) * 0.12
        downhill_bonus = clamp(max(-grade, 0.0) / 0.08) * 0.08
        multiplier = clamp(1.02 + flat_bonus + downhill_bonus - uphill_penalty - rough_penalty - high_penalty, 0.58, 1.28)
        radius = max(base_radius * multiplier, max(base_radius * 0.55, 55.0))
        local_points.append((x + math.cos(angle) * radius, y + math.sin(angle) * radius))

    current_area = polygon_area(local_points)
    if current_area > 0:
        target_area = area_m2 * 1.03
        if current_area < target_area:
            scale = math.sqrt(target_area / current_area)
        elif current_area > area_m2 * 1.12:
            scale = math.sqrt((area_m2 * 1.08) / current_area)
        else:
            scale = 1.0
        local_points = [(x + (px - x) * scale, y + (py - y) * scale) for px, py in local_points]

    actual_area_sqkm = polygon_area(local_points) / 1_000_000
    polygon = [
        [round(lng, 6), round(lat, 6)]
        for lng, lat in (transformer_to_ll.transform(px, py) for px, py in local_points)
    ]
    return polygon, round(actual_area_sqkm, 4)


def _shape_points_from_radii(x: float, y: float, radii: List[Dict[str, float]]) -> List[Tuple[float, float]]:
    return [
        (x + math.cos(item["angle"]) * item["radius"], y + math.sin(item["angle"]) * item["radius"])
        for item in radii
    ]


def _expand_to_target_area(
    x: float,
    y: float,
    radii: List[Dict[str, float]],
    target_area_m2: float,
    base_radius_m: float,
) -> List[Tuple[float, float]]:
    local_points = _shape_points_from_radii(x, y, radii)
    current_area = polygon_area(local_points)
    if current_area <= 0:
        return local_points

    for _step in range(18):
        if current_area >= target_area_m2 * 1.01:
            break
        changed = False
        for item in radii:
            spare = max(item["safe_limit"] - item["radius"], 0.0)
            if spare <= 0.5:
                continue
            gain = 0.18 + (item["expandability"] * 0.55) + ((1.0 - item["risk"]) * 0.25)
            grow_by = min(spare, max(base_radius_m * 0.05, spare * gain))
            item["radius"] += grow_by
            changed = True
        local_points = _shape_points_from_radii(x, y, radii)
        next_area = polygon_area(local_points)
        if next_area <= current_area + 1:
            break
        current_area = next_area
        if not changed:
            break

    if current_area < target_area_m2:
        flexible = [item for item in radii if item["risk"] <= 0.62]
        if not flexible:
            flexible = sorted(radii, key=lambda item: item["risk"])[: max(4, len(radii) // 3)]
        for _step in range(10):
            if current_area >= target_area_m2 * 1.005:
                break
            for item in flexible:
                item["radius"] *= 1.06
                item["safe_limit"] = max(item["safe_limit"], item["radius"])
            local_points = _shape_points_from_radii(x, y, radii)
            current_area = polygon_area(local_points)

    return _shape_points_from_radii(x, y, radii)


def refine_selected_polygon(
    candidate: Candidate,
    payload: Dict[str, Any],
    config: AirlandingConfig = CONFIG,
) -> Optional[str]:
    area_size = max(candidate.area_size_sqkm or ((config.landing_polygon_size_m ** 2) / 1_000_000), 0.05)
    target_area_m2 = area_size * 1_000_000
    base_radius = math.sqrt(target_area_m2 / math.pi)

    bounds = resolve_bounds(payload)
    epsg = choose_utm_epsg(bounds)
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    to_ll = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    x, y = to_utm.transform(candidate.center["lng"], candidate.center["lat"])

    direction_count = 28
    ring_factors = (0.45, 0.65, 0.85, 1.0, 1.18, 1.38, 1.62, 1.9, 2.18)
    angles = [
        math.radians(4.0) + (2 * math.pi * index / direction_count)
        for index in range(direction_count)
    ]

    sample_lookup: Dict[Tuple[int, int], Point] = {}
    sample_points: List[Point] = []
    for direction_index, angle in enumerate(angles):
        for ring_index, factor in enumerate(ring_factors):
            radius = base_radius * factor
            lng, lat = to_ll.transform(x + math.cos(angle) * radius, y + math.sin(angle) * radius)
            sample_lookup[(direction_index, ring_index)] = (lng, lat)
            sample_points.append((lng, lat))

    progress(
        f"{candidate.zone_id or candidate.candidate_id} 开始细化机降区边界: "
        f"{direction_count} 个方向 x {len(ring_factors)} 层 DEM 探测，目标面积≥{area_size:g}km²"
    )
    dem_padding_km = float(payload.get("_dem_padding_km") or candidate.area_distance_km or config.bounds_padding_km)
    dem = create_dem_provider(
        config,
        bounds=bounds,
        padding_km=dem_padding_km,
        dem_path=payload.get("dem_path") or payload.get("uploaded_dem_path"),
        terrain_root=payload.get("terrain_root"),
    )
    elevations = dem.sample(sample_points)
    center_elevation = float(candidate.elevation_m or 0.0)

    radii: List[Dict[str, float]] = []
    for direction_index, angle in enumerate(angles):
        safe_limit = base_radius * 0.48
        max_safe_radius = safe_limit
        first_risk = 0.0
        accumulated_risk = 0.0
        measured = 0
        for ring_index, factor in enumerate(ring_factors):
            lng, lat = sample_lookup[(direction_index, ring_index)]
            elevation = elevations.get(dem._cache_key(lng, lat))
            if elevation is None:
                continue
            radius = base_radius * factor
            delta = elevation - center_elevation
            grade = delta / max(radius, 1.0)
            slope_deg = math.degrees(math.atan(abs(grade)))
            uphill_risk = clamp(max(delta, 0.0) / 22.0)
            steep_risk = clamp((slope_deg - 3.0) / 8.0)
            rough_risk = clamp((abs(delta) - 10.0) / 24.0)
            risk = clamp((steep_risk * 0.48) + (uphill_risk * 0.34) + (rough_risk * 0.18))
            if ring_index == 0:
                first_risk = risk
            accumulated_risk += risk
            measured += 1

            if slope_deg <= 6.5 and abs(delta) <= 28.0 and delta <= 22.0:
                max_safe_radius = radius
                safe_limit = radius
                continue
            if radius <= base_radius:
                safe_limit = max(base_radius * 0.42, radius * 0.72)
            break

        average_risk = accumulated_risk / measured if measured else 0.5
        safe_limit = max(safe_limit, base_radius * 0.42)
        if max_safe_radius >= base_radius * 1.38 and average_risk <= 0.28:
            safe_limit = max(safe_limit, min(max_safe_radius, base_radius * 1.42))

        risk = clamp((average_risk * 0.75) + (first_risk * 0.25))
        expandability = clamp((1.0 - risk) * (safe_limit / max(base_radius * 1.42, 1.0)))
        desired = base_radius * (1.04 + (expandability * 0.18) - (risk * 0.42))
        radius = min(max(desired, base_radius * 0.42), safe_limit)
        radii.append({
            "angle": angle,
            "radius": radius,
            "safe_limit": safe_limit,
            "risk": risk,
            "expandability": expandability,
        })

    for index, item in enumerate(radii):
        previous = radii[index - 1]
        following = radii[(index + 1) % len(radii)]
        if item["risk"] >= 0.58:
            continue
        item["radius"] = (
            item["radius"] * 0.72
            + previous["radius"] * 0.14
            + following["radius"] * 0.14
        )

    local_points = _expand_to_target_area(x, y, radii, target_area_m2, base_radius)
    actual_area_sqkm = polygon_area(local_points) / 1_000_000

    if actual_area_sqkm > area_size * 1.18:
        scale = math.sqrt((area_size * 1.12) / actual_area_sqkm)
        local_points = [(x + (px - x) * scale, y + (py - y) * scale) for px, py in local_points]
        actual_area_sqkm = polygon_area(local_points) / 1_000_000

    if actual_area_sqkm < area_size:
        scale = math.sqrt((area_size * 1.005) / max(actual_area_sqkm, 1e-6))
        scale = min(scale, 1.18)
        local_points = [(x + (px - x) * scale, y + (py - y) * scale) for px, py in local_points]
        actual_area_sqkm = polygon_area(local_points) / 1_000_000

    candidate.polygon = [
        [round(lng, 6), round(lat, 6)]
        for lng, lat in (to_ll.transform(px, py) for px, py in local_points)
    ]
    candidate.polygon_area_sqkm = round(actual_area_sqkm, 4)
    progress(
        f"{candidate.zone_id or candidate.candidate_id} 机降区边界细化完成: "
        f"实际面积 {candidate.polygon_area_sqkm:g}km²，边界点 {len(candidate.polygon)} 个"
    )

    if actual_area_sqkm < area_size:
        return (
            f"{candidate.zone_id or candidate.candidate_id} 受周边坡度约束，边界面积 "
            f"{actual_area_sqkm:.4f}km² 仍低于需求 {area_size:.4f}km²。"
        )
    return None


def build_grid(
    bounds: Dict[str, float],
    config: AirlandingConfig,
    padding_km: float = None,
    landing_id: str = "",
) -> Tuple[List[Tuple[float, float, float, float]], Transformer, Transformer]:
    epsg = choose_utm_epsg(bounds)
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    to_ll = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

    west, south = to_utm.transform(bounds["west"], bounds["south"])
    east, north = to_utm.transform(bounds["east"], bounds["north"])
    min_x, max_x = sorted([west, east])
    min_y, max_y = sorted([south, north])

    pad = (config.bounds_padding_km if padding_km is None else padding_km) * 1000
    min_x -= pad
    max_x += pad
    min_y -= pad
    max_y += pad

    width = max(max_x - min_x, 1)
    height = max(max_y - min_y, 1)
    target_count = max(config.max_grid_points, 1)
    base_spacing = max(math.sqrt((width * height) / target_count) * 0.58, config.landing_polygon_size_m * 0.75)
    rng = random.Random(stable_sampling_seed(bounds, padding_km or config.bounds_padding_km, "shared"))

    grid: List[Tuple[float, float, float, float]] = []
    spacing = base_spacing
    while len(grid) < target_count and spacing >= config.landing_polygon_size_m * 0.25:
        min_spacing_sq = spacing * spacing
        bucket_size = max(spacing, 1.0)
        buckets: Dict[Tuple[int, int], List[Tuple[float, float, float, float]]] = {}
        for point in grid:
            bucket = (int((point[0] - min_x) / bucket_size), int((point[1] - min_y) / bucket_size))
            buckets.setdefault(bucket, []).append(point)

        def has_nearby_point(x: float, y: float) -> bool:
            cell_x = int((x - min_x) / bucket_size)
            cell_y = int((y - min_y) / bucket_size)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for px, py, _lng, _lat in buckets.get((cell_x + dx, cell_y + dy), []):
                        if ((x - px) ** 2 + (y - py) ** 2) < min_spacing_sq:
                            return True
            return False

        attempts = target_count * 120
        while len(grid) < target_count and attempts > 0:
            attempts -= 1
            x = rng.uniform(min_x, max_x)
            y = rng.uniform(min_y, max_y)
            if has_nearby_point(x, y):
                continue
            lng, lat = to_ll.transform(x, y)
            point = (x, y, lng, lat)
            grid.append(point)
            bucket = (int((x - min_x) / bucket_size), int((y - min_y) / bucket_size))
            buckets.setdefault(bucket, []).append(point)
        spacing *= 0.72

    while len(grid) < target_count:
        x = rng.uniform(min_x, max_x)
        y = rng.uniform(min_y, max_y)
        lng, lat = to_ll.transform(x, y)
        grid.append((x, y, lng, lat))

    return grid, to_utm, to_ll


def terrain_samples(x: float, y: float, sample_radius_m: float) -> List[Tuple[float, float, float]]:
    offsets = [
        (0, 0),
        (-sample_radius_m, 0),
        (sample_radius_m, 0),
        (0, -sample_radius_m),
        (0, sample_radius_m),
        (-sample_radius_m, -sample_radius_m),
        (sample_radius_m, -sample_radius_m),
        (sample_radius_m, sample_radius_m),
        (-sample_radius_m, sample_radius_m),
    ]
    return [(x + dx, y + dy, math.hypot(dx, dy) or 1.0) for dx, dy in offsets]


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def _refinement_grid_size(config: AirlandingConfig) -> int:
    grid_size = max(int(config.TERRAIN_REFINEMENT_GRID_SIZE), 3)
    if grid_size % 2 == 0:
        grid_size += 1
    return grid_size


def _refinement_sample_plan(candidate: Candidate, config: AirlandingConfig) -> Tuple[List[Dict[str, Any]], int]:
    center = candidate.center or {}
    lng = float(center["lng"])
    lat = float(center["lat"])
    area_size = max(candidate.area_size_sqkm or ((config.landing_polygon_size_m ** 2) / 1_000_000), 0.05)
    area_m2 = area_size * 1_000_000
    half_extent_m = max(math.sqrt(area_m2 / math.pi) * 1.05, config.landing_polygon_size_m * 0.25)
    grid_size = _refinement_grid_size(config)
    step_m = (half_extent_m * 2) / max(grid_size - 1, 1)

    epsg = choose_utm_epsg({
        "west": lng,
        "east": lng,
        "south": lat,
        "north": lat,
    })
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    to_ll = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    cx, cy = to_utm.transform(lng, lat)

    samples: List[Dict[str, Any]] = []
    mid = grid_size // 2
    for row in range(grid_size):
        for col in range(grid_size):
            x = cx + (col - mid) * step_m
            y = cy + (row - mid) * step_m
            sample_lng, sample_lat = to_ll.transform(x, y)
            samples.append({
                "row": row,
                "col": col,
                "x": x,
                "y": y,
                "lng": sample_lng,
                "lat": sample_lat,
            })
    return samples, grid_size


def _round_metric(value: float, digits: int = 4) -> float:
    if not _is_finite_number(value):
        return 0.0
    return round(float(value), digits)


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def _apply_refinement_result(
    candidate: Candidate,
    samples: List[Dict[str, Any]],
    grid_size: int,
    elevations: Dict[str, Optional[float]],
    dem_provider: OpenTopoDataProvider,
    config: AirlandingConfig,
) -> Dict[str, Any]:
    elevation_grid: List[List[Optional[float]]] = [[None for _ in range(grid_size)] for _ in range(grid_size)]
    point_grid: List[List[Optional[Tuple[float, float]]]] = [[None for _ in range(grid_size)] for _ in range(grid_size)]

    for sample in samples:
        elevation = elevations.get(dem_provider._cache_key(sample["lng"], sample["lat"]))
        if not _is_finite_number(elevation):
            continue
        row = sample["row"]
        col = sample["col"]
        elevation_grid[row][col] = float(elevation)
        point_grid[row][col] = (float(sample["x"]), float(sample["y"]))

    valid_elevations = [
        elevation
        for row in elevation_grid
        for elevation in row
        if elevation is not None
    ]
    total_samples = grid_size * grid_size
    min_valid_samples = math.ceil(total_samples * 0.75)
    slopes: List[float] = []

    for row in range(grid_size):
        for col in range(grid_size):
            current_elevation = elevation_grid[row][col]
            current_point = point_grid[row][col]
            if current_elevation is None or current_point is None:
                continue
            for d_row, d_col in ((0, 1), (1, 0), (1, 1), (1, -1)):
                next_row = row + d_row
                next_col = col + d_col
                if next_row < 0 or next_row >= grid_size or next_col < 0 or next_col >= grid_size:
                    continue
                next_elevation = elevation_grid[next_row][next_col]
                next_point = point_grid[next_row][next_col]
                if next_elevation is None or next_point is None:
                    continue
                distance_m = math.hypot(next_point[0] - current_point[0], next_point[1] - current_point[1])
                if distance_m <= 0:
                    continue
                grade = abs(next_elevation - current_elevation) / distance_m
                slopes.append(math.degrees(math.atan(grade)))

    if valid_elevations:
        refined_min = min(valid_elevations)
        refined_max = max(valid_elevations)
        refined_mean = sum(valid_elevations) / len(valid_elevations)
        variance = sum((elevation - refined_mean) ** 2 for elevation in valid_elevations) / len(valid_elevations)
        refined_std = math.sqrt(variance)
        refined_relief = refined_max - refined_min
    else:
        refined_min = refined_max = refined_mean = refined_std = refined_relief = 0.0

    refined_max_slope = max(slopes) if slopes else 0.0
    refined_mean_slope = sum(slopes) / len(slopes) if slopes else 0.0
    slope_score = max(0.0, 1.0 - refined_max_slope / max(config.MAX_REFINED_SLOPE_DEG, 1e-6))
    relief_score = max(0.0, 1.0 - refined_relief / max(config.MAX_REFINED_RELIEF_M, 1e-6))
    std_score = max(0.0, 1.0 - refined_std / max(config.MAX_REFINED_ELEVATION_STD_M, 1e-6))
    elevation_score = max(0.0, 1.0 - max(refined_mean, 0.0) / max(config.MAX_ABS_ELEVATION_M, 1e-6))
    refined_score = (
        0.4 * slope_score
        + 0.3 * relief_score
        + 0.2 * std_score
        + 0.1 * elevation_score
    )

    rejected = False
    reject_reason = ""
    if len(valid_elevations) < min_valid_samples or not slopes:
        rejected = True
        reject_reason = "insufficient_dem"
    elif refined_max > config.MAX_ABS_ELEVATION_M:
        rejected = True
        reject_reason = "too_high_elevation"
    elif refined_max_slope > config.MAX_REFINED_SLOPE_DEG:
        rejected = True
        reject_reason = "too_steep"
    elif refined_relief > config.MAX_REFINED_RELIEF_M:
        rejected = True
        reject_reason = "too_much_relief"
    elif refined_std > config.MAX_REFINED_ELEVATION_STD_M:
        rejected = True
        reject_reason = "too_rough"
    elif refined_score < config.REFINED_TERRAIN_MIN_SCORE:
        rejected = True
        reject_reason = "low_refined_score"

    result = {
        "refined_min_elevation_m": _round_metric(refined_min, 2),
        "refined_max_elevation_m": _round_metric(refined_max, 2),
        "refined_mean_elevation_m": _round_metric(refined_mean, 2),
        "refined_elevation_std_m": _round_metric(refined_std, 2),
        "refined_relief_m": _round_metric(refined_relief, 2),
        "refined_max_slope_deg": _round_metric(refined_max_slope, 2),
        "refined_mean_slope_deg": _round_metric(refined_mean_slope, 2),
        "refined_terrain_score": _round_metric(clamp(refined_score), 4),
        "refined_rejected": rejected,
        "refined_reject_reason": reject_reason,
    }

    for key, value in result.items():
        setattr(candidate, key, value)
    recalc_candidate_score(candidate)
    return result


def refine_candidate_terrain(
    candidate: Candidate,
    dem_provider: OpenTopoDataProvider,
    config: AirlandingConfig = CONFIG,
) -> Dict[str, Any]:
    samples, grid_size = _refinement_sample_plan(candidate, config)
    elevations = dem_provider.sample((sample["lng"], sample["lat"]) for sample in samples)
    return _apply_refinement_result(candidate, samples, grid_size, elevations, dem_provider, config)


def refine_candidates_terrain(
    candidates: List[Candidate],
    config: AirlandingConfig = CONFIG,
    dem_provider: Optional[OpenTopoDataProvider] = None,
) -> None:
    if not candidates or not config.ENABLE_TERRAIN_REFINEMENT:
        return

    dem_provider = dem_provider or OpenTopoDataProvider(config)
    plans: List[Tuple[Candidate, List[Dict[str, Any]], int]] = []
    sample_points: List[Point] = []
    for candidate in candidates:
        try:
            samples, grid_size = _refinement_sample_plan(candidate, config)
        except Exception:
            candidate.refined_rejected = True
            candidate.refined_reject_reason = "invalid_geometry"
            recalc_candidate_score(candidate)
            continue
        plans.append((candidate, samples, grid_size))
        sample_points.extend((sample["lng"], sample["lat"]) for sample in samples)

    if not plans:
        return

    elevations = dem_provider.sample(sample_points)
    for candidate, samples, grid_size in plans:
        _apply_refinement_result(candidate, samples, grid_size, elevations, dem_provider, config)


def terrain_mountain_penalty(slope_deg: float, relief_m: float, elevation_m: float) -> float:
    slope_penalty = clamp((slope_deg - 3.0) / 9.0)
    relief_penalty = clamp((relief_m - 10.0) / 35.0)
    elevation_penalty = clamp((elevation_m - 700.0) / 900.0) * 0.35
    return clamp((slope_penalty * 0.52) + (relief_penalty * 0.38) + (elevation_penalty * 0.10))


def classify_surface(candidate: Candidate) -> str:
    if candidate.urban_penalty >= 0.45:
        return "urban"
    if candidate.forest_penalty >= 0.45:
        return "forest"
    if candidate.mountain_penalty >= 0.55:
        return "mountain"
    if candidate.mountain_penalty >= 0.25:
        return "rough"
    return "open"


def recalc_candidate_score(candidate: Candidate) -> None:
    threat_score = 1.0 - min(candidate.threat_value, 1.0)
    candidate.surface_penalty = round(clamp(
        (candidate.mountain_penalty * 0.55)
        + (candidate.urban_penalty * 0.45)
        + (candidate.forest_penalty * 0.35)
    ), 4)
    candidate.terrain_class = classify_surface(candidate)
    refined_available = (
        candidate.refined_terrain_score > 0
        or candidate.refined_rejected
        or bool(candidate.refined_reject_reason)
    )
    refined_score = candidate.refined_terrain_score if refined_available else candidate.terrain_score
    terrain_score = (candidate.terrain_score * 0.4) + (refined_score * 0.6)
    terrain_component = terrain_score * (1.0 - (candidate.urban_penalty * 0.35) - (candidate.forest_penalty * 0.22))
    composite = (terrain_component * 0.58) + (threat_score * 0.27) + (candidate.distance_score * 0.15) - (candidate.surface_penalty * 0.38)
    if candidate.refined_rejected:
        composite -= 0.35
    candidate.composite_score = round(clamp(composite), 4)


def apply_landcover_context(candidates: List[Candidate], config: AirlandingConfig = CONFIG) -> List[str]:
    warnings: List[str] = []
    for candidate in candidates:
        recalc_candidate_score(candidate)

    if not candidates or not config.enable_osm_landcover:
        return warnings

    provider = OSMLandcoverProvider(config)
    points = [(candidate.center["lng"], candidate.center["lat"]) for candidate in candidates]
    try:
        landcover, queried_count = provider.sample(points)
    except Exception as exc:
        warnings.append(f"OSM 城市/森林地表检查不可用，已仅使用 DEM 地形评分: {exc}")
        return warnings

    for candidate in candidates:
        key = provider._cache_key(candidate.center["lng"], candidate.center["lat"])
        context = landcover.get(key) or {}
        candidate.urban_penalty = round(float(context.get("urban_penalty") or 0.0), 4)
        candidate.forest_penalty = round(float(context.get("forest_penalty") or 0.0), 4)
        recalc_candidate_score(candidate)

    if queried_count:
        urban_count = sum(1 for item in candidates if item.urban_penalty >= 0.45)
        forest_count = sum(1 for item in candidates if item.forest_penalty >= 0.45)
        progress(f"OSM 地表检查完成: 城市/建筑风险 {urban_count} 个，森林风险 {forest_count} 个")
    return warnings


def evaluate_padding(
    bounds: Dict[str, float],
    payload: Dict[str, Any],
    config: AirlandingConfig,
    padding_km: float,
    area_size_sqkm: Optional[float] = None,
    landing_id: str = "",
    allow_relaxed_terrain: bool = False,
    target_count: Optional[int] = None,
    required_min_distance_km: Optional[float] = None,
) -> Tuple[List[Candidate], List[str]]:
    warnings: List[str] = []
    area_size = area_size_sqkm if area_size_sqkm is not None else ((config.landing_polygon_size_m ** 2) / 1_000_000)
    sample_radius = max(math.sqrt(max(area_size, 0.05) * 1_000_000 / math.pi), config.landing_polygon_size_m / 2)
    dem_padding_km = float(payload.get("_dem_padding_km") or padding_km)
    dem = create_dem_provider(
        config,
        bounds=bounds,
        padding_km=dem_padding_km,
        dem_path=payload.get("dem_path") or payload.get("uploaded_dem_path"),
        terrain_root=payload.get("terrain_root"),
    )
    search_bounds = expand_bounds(bounds, padding_km)
    grid_bounds = search_bounds
    grid_padding_km = 0.0
    coverage_bounds = getattr(dem, "coverage_bounds_wgs84", None)
    if coverage_bounds:
        edge_margin_km = max((sample_radius / 1000.0) * 2.4, config.landing_polygon_size_m / 1000.0)
        candidate_coverage_bounds = shrink_bounds_by_km(coverage_bounds, edge_margin_km)
        clipped_bounds = intersect_bounds(search_bounds, candidate_coverage_bounds)
        if not clipped_bounds:
            warnings.append(
                f"{landing_id or 'landing'} 地形数据覆盖范围内没有满足当前搜索半径的候选空间。"
            )
            return [], warnings
        grid_bounds = clipped_bounds
        progress(
            f"{landing_id or 'landing'} 候选生成范围已裁剪到地形数据覆盖范围内: "
            f"{format_bounds(grid_bounds)}"
        )

    grid, _to_utm, to_ll = build_grid(grid_bounds, config, padding_km=grid_padding_km, landing_id=landing_id)
    terrain_slope_limit = config.relaxed_max_slope_deg if allow_relaxed_terrain else config.max_slope_deg
    terrain_relief_limit = config.relaxed_max_relief_m if allow_relaxed_terrain else config.max_relief_m
    progress(
        f"{landing_id or 'landing'} 搜索区域半径 {padding_km:g}km，生成蓝噪声候选采样点: {len(grid)} 个中心点"
        + (f"，地形阈值放宽为坡度≤{terrain_slope_limit:g}°/起伏≤{terrain_relief_limit:g}m" if allow_relaxed_terrain else "")
    )
    if required_min_distance_km is not None:
        progress(f"{landing_id or 'landing'} 启用距离硬约束: 最近威胁距离必须 > {required_min_distance_km:g}km")
    threat_field = ThreatField(payload.get("targets") or [])

    progress("开始中心点 DEM 采样，先排除海洋/无高程区域；此阶段不考虑威胁度")
    center_elevations = dem.sample((lng, lat) for _x, _y, lng, lat in grid)
    dem_targets = []
    ocean_or_missing = 0
    for x, y, lng, lat in grid:
        elevation = center_elevations.get(dem._cache_key(lng, lat))
        if elevation is None or elevation < config.min_land_elevation_m:
            ocean_or_missing += 1
            continue
        dem_targets.append({
            "grid": (x, y, lng, lat),
            "center_elevation": elevation,
        })

    progress(f"海洋/无高程区域排除完成: {len(grid)} -> {len(dem_targets)} 个陆地区域，排除 {ocean_or_missing} 个")
    if not dem_targets:
        warnings.append("DEM 中未找到陆地区域候选点，已排除海洋/无高程区域后没有剩余网格。")
        return [], warnings

    distance_rejected = 0
    if required_min_distance_km is not None:
        distance_filtered = []
        for item in dem_targets:
            _x, _y, lng, lat = item["grid"]
            threat_eval = threat_field.evaluate(lng, lat)
            distance_km = float(threat_eval["nearest_threat_distance_km"])
            if distance_km <= required_min_distance_km:
                distance_rejected += 1
                continue
            item["threat_eval"] = threat_eval
            distance_filtered.append(item)
        progress(
            f"{landing_id or 'landing'} 距离硬约束过滤完成: "
            f"{len(dem_targets)} -> {len(distance_filtered)}，剔除 {distance_rejected} 个 ≤{required_min_distance_km:g}km 的候选"
        )
        dem_targets = distance_filtered
        if not dem_targets:
            warnings.append(f"{landing_id or 'landing'} 未找到满足最近威胁距离 > {required_min_distance_km:g}km 的陆地区域候选点。")
            return [], warnings

    sample_records = []
    for item in dem_targets:
        x, y, lng, lat = item["grid"]
        for sx, sy, distance_m in terrain_samples(x, y, sample_radius):
            sample_lng, sample_lat = to_ll.transform(sx, sy)
            sample_records.append({
                "grid": (x, y, lng, lat),
                "sample_xy": (sx, sy),
                "point": (sample_lng, sample_lat),
                "distance_m": distance_m,
            })

    progress(f"准备采样 DEM 高程点: {len(sample_records)} 个；数据源 {dem.provider_name}/{dem.dataset_name}")
    elevations = dem.sample(record["point"] for record in sample_records)
    progress("DEM 高程采样完成，开始计算坡度、起伏和可降落性")

    grouped: Dict[Tuple[float, float, float, float], List[Tuple[float, float, float, float]]] = {}
    for record in sample_records:
        key = record["grid"]
        lng, lat = record["point"]
        elevation = elevations.get(dem._cache_key(lng, lat))
        if elevation is None:
            continue
        sx, sy = record["sample_xy"]
        grouped.setdefault(key, []).append((sx, sy, record["distance_m"], elevation))

    candidates: List[Candidate] = []
    for item in dem_targets:
        x, y, lng, lat = item["grid"]
        samples = grouped.get((x, y, lng, lat)) or []
        if len(samples) < config.min_valid_terrain_samples:
            continue

        center_elevation = item["center_elevation"]
        neighbor_samples = [sample for sample in samples if sample[2] > 1.0]
        relief = max(e for _sx, _sy, _d, e in samples) - min(e for _sx, _sy, _d, e in samples)
        max_grade = max((abs(e - center_elevation) / max(d, 1.0) for _sx, _sy, d, e in neighbor_samples), default=0.0)
        slope_deg = math.degrees(math.atan(max_grade))

        slope_score = max(0.0, 1.0 - (slope_deg / max(terrain_slope_limit, 1e-6)))
        relief_score = max(0.0, 1.0 - (relief / max(terrain_relief_limit, 1e-6)))
        mountain_penalty = terrain_mountain_penalty(slope_deg, relief, center_elevation)
        terrain_score = max(0.01, ((slope_score * 0.58) + (relief_score * 0.42)) * (1.0 - (mountain_penalty * 0.35)))

        threat_eval = item.get("threat_eval") or threat_field.evaluate(lng, lat)
        distance_km = float(threat_eval["nearest_threat_distance_km"])
        distance_margin_km = distance_km - float(required_min_distance_km or 0.0)
        distance_score = min(max(distance_margin_km / 25.0, 0.0), 1.0)
        threat_value = round(float(threat_eval["threat_value"]), 4)
        polygon, actual_polygon_area = polygon_from_center(
            to_ll,
            x,
            y,
            area_size,
            config.landing_polygon_size_m,
            terrain_points=neighbor_samples,
            center_elevation=center_elevation,
        )

        candidate = Candidate(
            center={"lng": round(lng, 6), "lat": round(lat, 6)},
            polygon=polygon,
            threat_value=threat_value,
            terrain_score=round(terrain_score, 4),
            distance_score=round(distance_score, 4),
            composite_score=0.0,
            elevation_m=round(center_elevation, 2),
            slope_deg=round(slope_deg, 2),
            relief_m=round(relief, 2),
            nearest_threat_distance_km=round(distance_km, 2),
            nearest_threat_id=str(threat_eval["nearest_threat_id"]),
            polygon_area_sqkm=actual_polygon_area,
            mountain_penalty=round(mountain_penalty, 4),
            landing_id=landing_id,
            area_size_sqkm=round(area_size, 4),
            area_distance_km=round(float(required_min_distance_km if required_min_distance_km is not None else padding_km), 2),
        )
        recalc_candidate_score(candidate)
        candidates.append(candidate)

    progress(f"半径 {padding_km:g}km 初筛候选区域生成完成: {len(candidates)} 个")
    if config.ENABLE_TERRAIN_REFINEMENT and candidates:
        refinement_target = target_count if target_count is not None else config.required_count
        refinement_limit = min(
            len(candidates),
            max(
                refinement_target,
                refinement_target * config.candidate_multiplier,
                refinement_target + config.candidates_per_landing,
            ),
        )
        candidates = sorted(
            candidates,
            key=lambda item: (
                -item.terrain_score,
                item.mountain_penalty,
                item.threat_value,
                -item.nearest_threat_distance_km,
            ),
        )[:refinement_limit]
        progress(f"开始地形精检: {len(candidates)} 个候选，每个 {config.TERRAIN_REFINEMENT_GRID_SIZE}x{config.TERRAIN_REFINEMENT_GRID_SIZE} DEM 采样")
        refine_candidates_terrain(candidates, config, dem_provider=dem)
        accepted_count = sum(1 for candidate in candidates if not candidate.refined_rejected)
        rejected_count = len(candidates) - accepted_count
        progress(f"地形精检完成：通过 {accepted_count} 个，剔除 {rejected_count} 个")

    progress(f"半径 {padding_km:g}km 候选区域生成完成: {len(candidates)} 个可用候选")
    return candidates, warnings


def generate_candidates(
    payload: Dict[str, Any],
    config: AirlandingConfig = CONFIG,
    padding_km: Optional[float] = None,
    area_size_sqkm: Optional[float] = None,
    landing_id: str = "",
    target_count: Optional[int] = None,
) -> Tuple[List[Candidate], List[str]]:
    warnings: List[str] = []
    bounds = resolve_bounds(payload)
    progress(f"读取威胁报告边界: W{bounds['west']:.4f}, S{bounds['south']:.4f}, E{bounds['east']:.4f}, N{bounds['north']:.4f}")

    all_candidates: List[Candidate] = []
    seen_centers = set()
    requested_padding_km = padding_km if padding_km is not None else config.bounds_padding_km
    search_padding_km = requested_padding_km
    max_search_padding_km = min(
        config.max_bounds_padding_km,
        requested_padding_km + config.max_search_overrun_km,
    )
    required_candidates = target_count if target_count is not None else config.required_count
    progress(
        f"{landing_id or 'landing'} 搜索距离约束: 需求 {requested_padding_km:g}km，"
        f"最多小幅外扩至 {max_search_padding_km:g}km"
    )

    while search_padding_km <= max_search_padding_km + 1e-9:
        candidates, candidate_warnings = evaluate_padding(
            bounds,
            payload,
            config,
            search_padding_km,
            area_size_sqkm=area_size_sqkm,
            landing_id=landing_id,
            target_count=required_candidates,
            required_min_distance_km=requested_padding_km,
        )
        warnings.extend(candidate_warnings)
        for candidate in candidates:
            key = (candidate.center["lng"], candidate.center["lat"])
            if key not in seen_centers:
                seen_centers.add(key)
                all_candidates.append(candidate)

        viable_count = sum(1 for candidate in all_candidates if not candidate.refined_rejected)
        progress(f"累计可用候选区域: {viable_count} 个，精检剔除候选 {len(all_candidates) - viable_count} 个")
        if viable_count >= required_candidates:
            break

        next_padding = min(search_padding_km + config.expansion_step_km, max_search_padding_km)
        if next_padding > search_padding_km + 1e-9:
            progress(f"候选不足 {required_candidates} 个，自动扩张搜索区域: {search_padding_km:g}km -> {next_padding:g}km")
        else:
            break
        search_padding_km = next_padding

    if len(all_candidates) < required_candidates:
        progress("小幅扩张后候选仍不足，执行一次地形阈值放宽补充搜索")
        relaxed_candidates, relaxed_warnings = evaluate_padding(
            bounds,
            payload,
            config,
            max_search_padding_km,
            area_size_sqkm=area_size_sqkm,
            landing_id=landing_id,
            allow_relaxed_terrain=True,
            target_count=required_candidates,
            required_min_distance_km=requested_padding_km,
        )
        warnings.extend(relaxed_warnings)
        for candidate in relaxed_candidates:
            key = (candidate.center["lng"], candidate.center["lat"])
            if key not in seen_centers:
                seen_centers.add(key)
                all_candidates.append(candidate)

    viable_candidates = [candidate for candidate in all_candidates if not candidate.refined_rejected]
    if viable_candidates:
        if len(viable_candidates) < required_candidates:
            warnings.append(f"{landing_id or 'landing'} 地形精检后可用候选点不足 {required_candidates} 个，当前仅 {len(viable_candidates)} 个。")
        all_candidates = viable_candidates
    elif all_candidates:
        warnings.append(f"{landing_id or 'landing'} 所有候选均被地形精检剔除，已保留 rejected 候选作为极端兜底，最终选择会附带风险。")
    else:
        warnings.append(f"{landing_id or 'landing'} 可降落候选点不足 {required_candidates} 个，当前仅 0 个。")

    progress(f"候选区域生成完成: {len(all_candidates)} 个可用候选")
    return all_candidates, warnings
