"""Cesium quantized-mesh terrain sampler.

The sampler intentionally avoids recursive directory scans. It reads only
``meta.json``/``layer.json`` and then opens tiles calculated from requested
coordinates, falling back from higher zooms to lower zooms when a tile is
missing.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
import gzip
import json
import math
import struct
from pathlib import Path
from typing import Any


MAX_QUANTIZED = 32767.0


@dataclass(frozen=True)
class TerrainSample:
    ok: bool
    status: str
    elevationM: float | None
    slopeDeg: float
    roughnessScore: float
    terrainPenalty: float
    speedFactor: float
    concealmentBonus: float
    zoomUsed: int | None
    tile: tuple[int, int, int] | None
    note: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if self.tile is not None:
            data["tile"] = {"z": self.tile[0], "x": self.tile[1], "y": self.tile[2]}
        return data


def neutral_sample(note: str = "地形数据不可用，按中性地形处理。") -> TerrainSample:
    return TerrainSample(
        ok=False,
        status="neutral",
        elevationM=None,
        slopeDeg=0.0,
        roughnessScore=0.0,
        terrainPenalty=0.0,
        speedFactor=1.0,
        concealmentBonus=0.0,
        zoomUsed=None,
        tile=None,
        note=note,
    )


def _zig_zag_decode(value: int) -> int:
    return (value >> 1) ^ (-(value & 1))


def _decode_delta_array(values: list[int]) -> list[int]:
    decoded: list[int] = []
    current = 0
    for value in values:
        current += _zig_zag_decode(value)
        decoded.append(current)
    return decoded


def _read_exact(data: bytes, offset: int, size: int) -> tuple[bytes, int]:
    end = offset + size
    if end > len(data):
        raise ValueError("quantized-mesh tile truncated")
    return data[offset:end], end


@dataclass(frozen=True)
class QuantizedMeshTile:
    z: int
    x: int
    y: int
    west: float
    south: float
    east: float
    north: float
    min_height: float
    max_height: float
    vertices: tuple[tuple[float, float, float], ...]

    @classmethod
    def from_bytes(cls, data: bytes, *, z: int, x: int, y: int, bounds: tuple[float, float, float, float]) -> "QuantizedMeshTile":
        if data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        offset = 0
        # 3 doubles + 2 floats + 4 doubles + 3 doubles = 88 bytes.
        header, offset = _read_exact(data, offset, 88)
        unpacked = struct.unpack("<dddffddddddd", header)
        min_height = float(unpacked[3])
        max_height = float(unpacked[4])
        raw_count, offset = _read_exact(data, offset, 4)
        vertex_count = struct.unpack("<I", raw_count)[0]
        if vertex_count <= 0 or vertex_count > 2_000_000:
            raise ValueError(f"invalid quantized-mesh vertex count: {vertex_count}")
        array_size = vertex_count * 2
        u_bytes, offset = _read_exact(data, offset, array_size)
        v_bytes, offset = _read_exact(data, offset, array_size)
        h_bytes, offset = _read_exact(data, offset, array_size)
        u_values = _decode_delta_array(list(struct.unpack(f"<{vertex_count}H", u_bytes)))
        v_values = _decode_delta_array(list(struct.unpack(f"<{vertex_count}H", v_bytes)))
        h_values = _decode_delta_array(list(struct.unpack(f"<{vertex_count}H", h_bytes)))
        west, south, east, north = bounds
        lon_span = east - west
        lat_span = north - south
        height_span = max_height - min_height
        vertices = []
        for u, v, h in zip(u_values, v_values, h_values):
            lon = west + max(0, min(u, 32767)) / MAX_QUANTIZED * lon_span
            lat = south + max(0, min(v, 32767)) / MAX_QUANTIZED * lat_span
            elevation = min_height + max(0, min(h, 32767)) / MAX_QUANTIZED * height_span
            vertices.append((lon, lat, elevation))
        return cls(z=z, x=x, y=y, west=west, south=south, east=east, north=north, min_height=min_height, max_height=max_height, vertices=tuple(vertices))

    def sample_elevation(self, lon: float, lat: float, *, nearest_count: int = 6) -> float | None:
        if not self.vertices:
            return None
        candidates: list[tuple[float, float]] = []
        for vertex_lon, vertex_lat, elevation in self.vertices:
            dx = (lon - vertex_lon) * math.cos(math.radians(lat))
            dy = lat - vertex_lat
            distance_sq = dx * dx + dy * dy
            if distance_sq <= 1e-14:
                return round(elevation, 2)
            candidates.append((distance_sq, elevation))
        candidates.sort(key=lambda item: item[0])
        selected = candidates[: max(1, nearest_count)]
        weighted = 0.0
        total_weight = 0.0
        for distance_sq, elevation in selected:
            weight = 1.0 / max(distance_sq, 1e-14)
            weighted += elevation * weight
            total_weight += weight
        if total_weight <= 0:
            return None
        return round(weighted / total_weight, 2)


class TerrainSampler:
    def __init__(self, terrain_dir: str | Path, *, preferred_zoom: int | None = None) -> None:
        self.root = Path(terrain_dir).expanduser().resolve()
        meta_path = self.root / "meta.json"
        layer_path = self.root / "layer.json"
        if not meta_path.exists() or not layer_path.exists():
            raise FileNotFoundError("terrain directory must contain meta.json and layer.json")
        self.meta = json.loads(meta_path.read_text(encoding="utf-8-sig"))
        self.layer = json.loads(layer_path.read_text(encoding="utf-8-sig"))
        bounds = self.meta.get("latLonBounds") or self.meta.get("bounds") or {}
        self.west = float(bounds.get("west", -180.0))
        self.south = float(bounds.get("south", -90.0))
        self.east = float(bounds.get("east", 180.0))
        self.north = float(bounds.get("north", 90.0))
        self.minzoom = int(self.meta.get("minzoom", self.layer.get("minzoom", 0)))
        self.maxzoom = int(self.meta.get("maxzoom", self.layer.get("maxzoom", 0)))
        self.preferred_zoom = min(preferred_zoom if preferred_zoom is not None else self.maxzoom, self.maxzoom)
        self.scheme = str(self.layer.get("scheme") or self.meta.get("tiletrans") or "tms").lower()
        self.format = str(self.layer.get("format") or self.meta.get("contentType") or "")

    @property
    def available(self) -> bool:
        return self.root.exists() and self.format.startswith("quantized-mesh")

    def in_bounds(self, lon: float, lat: float) -> bool:
        return self.west <= lon <= self.east and self.south <= lat <= self.north

    def tile_xy(self, lon: float, lat: float, z: int) -> tuple[int, int]:
        tiles_x = 2 ** (z + 1)
        tiles_y = 2**z
        lon_ratio = (lon + 180.0) / 360.0
        lat_ratio = (lat + 90.0) / 180.0
        x = int(math.floor(lon_ratio * tiles_x))
        y = int(math.floor(lat_ratio * tiles_y))
        x = max(0, min(x, tiles_x - 1))
        y = max(0, min(y, tiles_y - 1))
        return x, y

    def tile_bounds(self, z: int, x: int, y: int) -> tuple[float, float, float, float]:
        tiles_x = 2 ** (z + 1)
        tiles_y = 2**z
        west = -180.0 + x / tiles_x * 360.0
        east = -180.0 + (x + 1) / tiles_x * 360.0
        south = -90.0 + y / tiles_y * 180.0
        north = -90.0 + (y + 1) / tiles_y * 180.0
        return west, south, east, north

    @lru_cache(maxsize=512)
    def _load_tile(self, z: int, x: int, y: int) -> QuantizedMeshTile | None:
        path = self.root / str(z) / str(x) / f"{y}.terrain"
        if not path.exists():
            return None
        try:
            return QuantizedMeshTile.from_bytes(path.read_bytes(), z=z, x=x, y=y, bounds=self.tile_bounds(z, x, y))
        except Exception:
            return None

    def _sample_elevation_only(self, lon: float, lat: float) -> tuple[float | None, int | None, tuple[int, int, int] | None]:
        if not self.available:
            return None, None, None
        if not self.in_bounds(lon, lat):
            return None, None, None
        for z in range(self.preferred_zoom, self.minzoom - 1, -1):
            x, y = self.tile_xy(lon, lat, z)
            tile = self._load_tile(z, x, y)
            if tile is None:
                continue
            elevation = tile.sample_elevation(lon, lat)
            if elevation is not None:
                return elevation, z, (z, x, y)
        return None, None, None

    def sample(self, lon: float, lat: float) -> TerrainSample:
        if not self.available:
            return neutral_sample("地形格式不是 quantized-mesh，按中性地形处理。")
        if not self.in_bounds(lon, lat):
            return neutral_sample("坐标超出 terrain 覆盖范围，按中性地形处理。")
        elevation, zoom, tile_id = self._sample_elevation_only(lon, lat)
        if elevation is None:
            return neutral_sample("未找到可用地形瓦片，按中性地形处理。")

        delta = 0.006
        neighbors = []
        for dlon, dlat in ((delta, 0), (-delta, 0), (0, delta), (0, -delta)):
            value, _, _ = self._sample_elevation_only(lon + dlon, lat + dlat)
            if value is not None:
                distance_km = _haversine_km(lon, lat, lon + dlon, lat + dlat)
                if distance_km > 0:
                    neighbors.append((value, distance_km))
        slope_values = [abs(value - elevation) / (distance_km * 1000.0) for value, distance_km in neighbors]
        avg_grade = sum(slope_values) / len(slope_values) if slope_values else 0.0
        slope_deg = round(math.degrees(math.atan(avg_grade)), 2)
        roughness = 0.0
        if neighbors:
            neighbor_elevations = [value for value, _ in neighbors]
            roughness = min(max(neighbor_elevations) - min(neighbor_elevations), 1000.0)
        roughness_score = round(min(100.0, roughness / 2.8), 2)
        terrain_penalty = round(min(32.0, slope_deg * 1.15 + roughness_score * 0.18), 2)
        speed_factor = round(max(0.52, min(1.05, 1.0 - terrain_penalty / 90.0)), 3)
        concealment_bonus = round(min(12.0, slope_deg * 0.25 + roughness_score * 0.04), 2)
        return TerrainSample(
            ok=True,
            status="sampled",
            elevationM=round(elevation, 2),
            slopeDeg=slope_deg,
            roughnessScore=roughness_score,
            terrainPenalty=terrain_penalty,
            speedFactor=speed_factor,
            concealmentBonus=concealment_bonus,
            zoomUsed=zoom,
            tile=tile_id,
            note="地形采样成功。",
        )

    def sample_path(self, points: list[list[float]]) -> dict[str, Any]:
        samples = [self.sample(float(point[0]), float(point[1])) for point in points if isinstance(point, list) and len(point) >= 2]
        sampled = [sample for sample in samples if sample.ok]
        if not samples:
            return {"status": "neutral", "sampleCount": 0, "sampledCount": 0, "averagePenalty": 0.0, "averageSlopeDeg": 0.0, "averageSpeedFactor": 1.0, "averageConcealmentBonus": 0.0, "minElevationM": None, "maxElevationM": None, "zoomUsed": None, "samples": []}
        penalties = [sample.terrainPenalty for sample in samples]
        slopes = [sample.slopeDeg for sample in samples]
        speed_factors = [sample.speedFactor for sample in samples]
        concealment = [sample.concealmentBonus for sample in samples]
        elevations = [sample.elevationM for sample in sampled if sample.elevationM is not None]
        zooms = [sample.zoomUsed for sample in sampled if sample.zoomUsed is not None]
        return {
            "status": "sampled" if sampled else "neutral",
            "sampleCount": len(samples),
            "sampledCount": len(sampled),
            "averagePenalty": round(sum(penalties) / len(penalties), 2),
            "averageSlopeDeg": round(sum(slopes) / len(slopes), 2),
            "averageSpeedFactor": round(sum(speed_factors) / len(speed_factors), 3),
            "averageConcealmentBonus": round(sum(concealment) / len(concealment), 2),
            "minElevationM": min(elevations) if elevations else None,
            "maxElevationM": max(elevations) if elevations else None,
            "zoomUsed": max(zooms) if zooms else None,
            "samples": [sample.to_dict() for sample in samples],
        }


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    rlon1, rlat1, rlon2, rlat2 = map(math.radians, (lon1, lat1, lon2, lat2))
    dlon = rlon2 - rlon1
    dlat = rlat2 - rlat1
    h = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(h))


def build_terrain_sampler(terrain_dir: str | Path | None, *, preferred_zoom: int | None = None) -> TerrainSampler | None:
    if not terrain_dir:
        return None
    try:
        return TerrainSampler(terrain_dir, preferred_zoom=preferred_zoom)
    except Exception:
        return None
