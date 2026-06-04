import hashlib
import json
import math
import os
import struct
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np

from config import AirlandingConfig, CONFIG


Point = Tuple[float, float]  # lng, lat


def progress(message: str) -> None:
    print(f"[LandingZone] {message}", file=sys.stderr, flush=True)


def expand_bounds(bounds: Dict[str, float], padding_km: float) -> Dict[str, float]:
    west = float(bounds["west"])
    south = float(bounds["south"])
    east = float(bounds["east"])
    north = float(bounds["north"])
    center_lat = (south + north) / 2
    lat_pad = padding_km / 110.574
    lng_pad = padding_km / max(111.320 * math.cos(math.radians(center_lat)), 1e-6)
    return {
        "west": max(-180.0, west - lng_pad),
        "south": max(-90.0, south - lat_pad),
        "east": min(180.0, east + lng_pad),
        "north": min(90.0, north + lat_pad),
    }


def dem_cache_file(bounds: Dict[str, float], dem_type: str, cache_dir: Path) -> Path:
    normalized = {
        "demtype": dem_type,
        "west": round(float(bounds["west"]), 6),
        "south": round(float(bounds["south"]), 6),
        "east": round(float(bounds["east"]), 6),
        "north": round(float(bounds["north"]), 6),
    }
    digest = hashlib.sha256(json.dumps(normalized, sort_keys=True).encode("utf-8")).hexdigest()[:20]
    return Path(cache_dir) / f"{dem_type.lower()}_{digest}.tif"


def format_bounds(bounds: Dict[str, float]) -> str:
    return (
        f"W{float(bounds['west']):.6f}, "
        f"S{float(bounds['south']):.6f}, "
        f"E{float(bounds['east']):.6f}, "
        f"N{float(bounds['north']):.6f}"
    )


def intersect_bounds(left: Dict[str, float], right: Dict[str, float]) -> Optional[Dict[str, float]]:
    west = max(float(left["west"]), float(right["west"]))
    south = max(float(left["south"]), float(right["south"]))
    east = min(float(left["east"]), float(right["east"]))
    north = min(float(left["north"]), float(right["north"]))
    if west >= east or south >= north:
        return None
    return {
        "west": west,
        "south": south,
        "east": east,
        "north": north,
    }


class UploadedGeoTiffDEMProvider:
    def __init__(
        self,
        config: AirlandingConfig = CONFIG,
        bounds: Optional[Dict[str, float]] = None,
        padding_km: float = 0.0,
        dem_path: Optional[str] = None,
    ):
        if not dem_path:
            raise ValueError("缺少上传的 GeoTIFF DEM 文件，请先上传 .tif/.tiff 后再分析")
        if not bounds:
            raise ValueError("缺少分析 bounds，无法校验 GeoTIFF DEM 覆盖范围")

        self.config = config
        self.provider_name = "UploadedGeoTIFF"
        self.dataset_name = Path(dem_path).name
        self.dem_path = Path(dem_path).resolve()
        self.required_bounds = expand_bounds(bounds, max(float(padding_km or 0.0), 0.0))
        self.coverage_bounds_wgs84: Optional[Dict[str, float]] = None
        self._dataset = None
        self._transform = None
        self._transform_bounds = None
        self._ensure_dataset()

    def _cache_key(self, lng: float, lat: float) -> str:
        return f"{lat:.6f},{lng:.6f}"

    def _ensure_dataset(self) -> None:
        if not self.dem_path.exists():
            raise FileNotFoundError(f"上传的 GeoTIFF DEM 文件不存在: {self.dem_path}")
        try:
            import rasterio
            from rasterio.warp import transform, transform_bounds
        except Exception as exc:
            raise RuntimeError("rasterio 未安装，无法读取上传的 GeoTIFF DEM") from exc

        self._transform = transform
        self._transform_bounds = transform_bounds
        self._dataset = rasterio.open(self.dem_path)
        if not self._dataset.crs:
            raise RuntimeError("上传 DEM TIF 缺少 CRS 坐标系信息，无法判断经纬度覆盖范围")

        self.coverage_bounds_wgs84 = self._dataset_bounds_wgs84()
        self._validate_required_bounds()
        progress(f"上传 GeoTIFF DEM 已加载: {self.dem_path.name}")

    def _dataset_bounds_text(self) -> str:
        bounds = self._dataset.bounds
        crs_name = self._dataset.crs.to_string() if self._dataset.crs else "unknown"
        return (
            f"{crs_name} "
            f"left={bounds.left:.3f}, bottom={bounds.bottom:.3f}, "
            f"right={bounds.right:.3f}, top={bounds.top:.3f}"
        )

    def _dataset_bounds_wgs84(self) -> Dict[str, float]:
        bounds = self._dataset.bounds
        if self._dataset.crs.to_epsg() == 4326:
            west, south, east, north = bounds.left, bounds.bottom, bounds.right, bounds.top
        else:
            west, south, east, north = self._transform_bounds(
                self._dataset.crs,
                "EPSG:4326",
                bounds.left,
                bounds.bottom,
                bounds.right,
                bounds.top,
                densify_pts=21,
            )
        return {
            "west": max(-180.0, float(west)),
            "south": max(-90.0, float(south)),
            "east": min(180.0, float(east)),
            "north": min(90.0, float(north)),
        }

    def _required_bounds_in_dataset_crs(self) -> Tuple[float, float, float, float]:
        if self._dataset.crs.to_epsg() == 4326:
            return (
                float(self.required_bounds["west"]),
                float(self.required_bounds["south"]),
                float(self.required_bounds["east"]),
                float(self.required_bounds["north"]),
            )
        return self._transform_bounds(
            "EPSG:4326",
            self._dataset.crs,
            float(self.required_bounds["west"]),
            float(self.required_bounds["south"]),
            float(self.required_bounds["east"]),
            float(self.required_bounds["north"]),
            densify_pts=21,
        )

    def _validate_required_bounds(self) -> None:
        overlap = intersect_bounds(self.required_bounds, self.coverage_bounds_wgs84 or {})
        if not overlap:
            raise RuntimeError(
                "上传 DEM TIF 与当前分析区域无重叠或坐标不匹配，已停止分析。"
                f" 需要覆盖经纬度范围: {format_bounds(self.required_bounds)}；"
                f" 当前 TIF 经纬度范围: {format_bounds(self.coverage_bounds_wgs84 or {})}；"
                f" 当前 TIF 原始范围: {self._dataset_bounds_text()}"
            )
        if overlap != self.required_bounds:
            progress(
                "上传 TIF 仅覆盖分析范围的一部分，候选区域将限制在 TIF 内: "
                f"{format_bounds(self.coverage_bounds_wgs84 or {})}"
            )

    def _transform_points_for_dataset(self, points: List[Point]) -> List[Point]:
        dataset_crs = self._dataset.crs
        if dataset_crs.to_epsg() == 4326:
            return points
        lngs = [lng for lng, _lat in points]
        lats = [lat for _lng, lat in points]
        xs, ys = self._transform("EPSG:4326", dataset_crs, lngs, lats)
        return list(zip(xs, ys))

    def _point_inside_dataset(self, point: Point) -> bool:
        bounds = self._dataset.bounds
        resolution = max(abs(self._dataset.res[0] or 0), abs(self._dataset.res[1] or 0), 1e-9)
        tolerance = resolution * 2
        return (
            bounds.left - tolerance <= point[0] <= bounds.right + tolerance
            and bounds.bottom - tolerance <= point[1] <= bounds.top + tolerance
        )

    def sample(self, points: Iterable[Point]) -> Dict[str, Optional[float]]:
        points = list(points)
        if not points:
            return {}
        sample_points = self._transform_points_for_dataset(points)

        result: Dict[str, Optional[float]] = {}
        nodata = self._dataset.nodata
        inside_pairs = [
            (original, transformed)
            for original, transformed in zip(points, sample_points)
            if self._point_inside_dataset(transformed)
        ]
        for lng, lat in points:
            result[self._cache_key(lng, lat)] = None

        for (lng, lat), values in zip(
            (pair[0] for pair in inside_pairs),
            self._dataset.sample((pair[1] for pair in inside_pairs), masked=True),
        ):
            key = self._cache_key(lng, lat)
            if values is None or len(values) == 0:
                result[key] = None
                continue
            value = values[0]
            if hasattr(value, "mask") and bool(value.mask):
                result[key] = None
                continue
            try:
                elevation = float(value)
            except (TypeError, ValueError):
                result[key] = None
                continue
            if not math.isfinite(elevation) or (nodata is not None and elevation == float(nodata)):
                result[key] = None
            else:
                result[key] = elevation
        return result

    def close(self) -> None:
        if self._dataset:
            self._dataset.close()
            self._dataset = None


def _zigzag_decode(value: int) -> int:
    return (value >> 1) ^ (-(value & 1))


def _decode_delta_zigzag_u16(values: Tuple[int, ...]) -> List[int]:
    decoded: List[int] = []
    last = 0
    for value in values:
        last += _zigzag_decode(int(value))
        decoded.append(last)
    return decoded


class QuantizedMeshTile:
    def __init__(self, tile_path: Path):
        self.tile_path = Path(tile_path)
        self.min_height = 0.0
        self.max_height = 0.0
        self.u_values: List[int] = []
        self.v_values: List[int] = []
        self.height_values: List[int] = []
        self._load()

    def _load(self) -> None:
        raw = self.tile_path.read_bytes()
        if len(raw) < 92:
            raise RuntimeError(f"terrain 瓦片数据过短: {self.tile_path}")

        header = struct.unpack_from("<3d2f3dd3d", raw, 0)
        self.min_height = float(header[3])
        self.max_height = float(header[4])
        offset = 88
        (vertex_count,) = struct.unpack_from("<I", raw, offset)
        offset += 4
        if vertex_count <= 0:
            raise RuntimeError(f"terrain 瓦片缺少顶点: {self.tile_path}")

        bytes_per_array = vertex_count * 2
        required_size = offset + (bytes_per_array * 3)
        if len(raw) < required_size:
            raise RuntimeError(f"terrain 瓦片顶点区不完整: {self.tile_path}")

        values_format = f"<{vertex_count}H"
        u_encoded = struct.unpack_from(values_format, raw, offset)
        offset += bytes_per_array
        v_encoded = struct.unpack_from(values_format, raw, offset)
        offset += bytes_per_array
        height_encoded = struct.unpack_from(values_format, raw, offset)

        self.u_values = np.asarray(_decode_delta_zigzag_u16(u_encoded), dtype=np.float32)
        self.v_values = np.asarray(_decode_delta_zigzag_u16(v_encoded), dtype=np.float32)
        self.height_values = np.asarray(_decode_delta_zigzag_u16(height_encoded), dtype=np.float32)

    def sample(self, u: float, v: float) -> float:
        target_u = max(0.0, min(32767.0, float(u)))
        target_v = max(0.0, min(32767.0, float(v)))
        distance = ((self.u_values - target_u) ** 2) + ((self.v_values - target_v) ** 2)
        best_index = int(np.argmin(distance))
        quantized_height = max(0.0, min(32767.0, float(self.height_values[best_index])))
        return self.min_height + ((quantized_height / 32767.0) * (self.max_height - self.min_height))


class CesiumTerrainDEMProvider:
    def __init__(
        self,
        config: AirlandingConfig = CONFIG,
        bounds: Optional[Dict[str, float]] = None,
        padding_km: float = 0.0,
        terrain_root: Optional[str] = None,
    ):
        self.config = config
        self.provider_name = "LocalCesiumTerrain"
        self.terrain_root = Path(terrain_root or config.TERRAIN_ROOT).expanduser().resolve()
        self.layer_path = self.terrain_root / "layer.json"
        if not self.layer_path.exists():
            raise RuntimeError(f"离线 Cesium terrain 缺少 layer.json: {self.terrain_root}")

        self.layer = json.loads(self.layer_path.read_text(encoding="utf-8"))
        self.dataset_name = str(self.layer.get("name") or self.terrain_root.name)
        self.min_zoom = int(self.layer.get("minzoom", 0) or 0)
        self.max_zoom = int(self.layer.get("maxzoom", 14) or 14)
        self.sample_zoom = max(self.min_zoom, min(int(config.terrain_sample_zoom or self.max_zoom), self.max_zoom))
        bounds_source = self.layer.get("valid_bounds") or self.layer.get("bounds") or [-180, -90, 180, 90]
        self.coverage_bounds_wgs84 = {
            "west": float(bounds_source[0]),
            "south": float(bounds_source[1]),
            "east": float(bounds_source[2]),
            "north": float(bounds_source[3]),
        }
        self.required_bounds = expand_bounds(bounds, max(float(padding_km or 0.0), 0.0)) if bounds else None
        self._tile_cache: Dict[str, Optional[QuantizedMeshTile]] = {}
        self._validate_required_bounds()
        progress(f"离线 Cesium terrain 已加载: {self.terrain_root}，采样层级 z={self.sample_zoom}")

    def _cache_key(self, lng: float, lat: float) -> str:
        return f"{lat:.6f},{lng:.6f}"

    def _validate_required_bounds(self) -> None:
        if not self.required_bounds:
            return
        overlap = intersect_bounds(self.required_bounds, self.coverage_bounds_wgs84)
        if not overlap:
            raise RuntimeError(
                "离线 terrain 与当前分析区域无重叠，已停止分析。"
                f" 需要覆盖经纬度范围: {format_bounds(self.required_bounds)}；"
                f" 当前 terrain 范围: {format_bounds(self.coverage_bounds_wgs84)}"
            )
        if overlap != self.required_bounds:
            progress(
                "离线 terrain 仅覆盖分析范围的一部分，候选区域将限制在 terrain 内: "
                f"{format_bounds(self.coverage_bounds_wgs84)}"
            )

    def _tile_xy(self, lng: float, lat: float, zoom: int) -> Tuple[int, int]:
        x_tiles = 2 ** (zoom + 1)
        y_tiles = 2 ** zoom
        x = int(math.floor(((lng + 180.0) / 360.0) * x_tiles))
        y = int(math.floor(((90.0 - lat) / 180.0) * y_tiles))
        return max(0, min(x_tiles - 1, x)), max(0, min(y_tiles - 1, y))

    def _tile_bounds(self, zoom: int, x: int, y: int) -> Dict[str, float]:
        x_tiles = 2 ** (zoom + 1)
        y_tiles = 2 ** zoom
        west = -180.0 + (x * 360.0 / x_tiles)
        east = -180.0 + ((x + 1) * 360.0 / x_tiles)
        north = 90.0 - (y * 180.0 / y_tiles)
        south = 90.0 - ((y + 1) * 180.0 / y_tiles)
        return {
            "west": west,
            "south": south,
            "east": east,
            "north": north,
        }

    def _tile_path(self, zoom: int, x: int, y: int) -> Path:
        return self.terrain_root / str(zoom) / str(x) / f"{y}.terrain"

    def _load_tile(self, zoom: int, x: int, y: int) -> Optional[QuantizedMeshTile]:
        cache_key = f"{zoom}/{x}/{y}"
        if cache_key in self._tile_cache:
            return self._tile_cache[cache_key]
        tile_path = self._tile_path(zoom, x, y)
        if not tile_path.exists():
            self._tile_cache[cache_key] = None
            return None
        try:
            tile = QuantizedMeshTile(tile_path)
        except Exception as exc:
            progress(f"terrain 瓦片读取失败 {tile_path}: {exc}")
            tile = None
        self._tile_cache[cache_key] = tile
        return tile

    def _resolve_tile(self, lng: float, lat: float) -> Tuple[Optional[QuantizedMeshTile], Optional[Dict[str, float]]]:
        for zoom in range(self.sample_zoom, self.min_zoom - 1, -1):
            x, y = self._tile_xy(lng, lat, zoom)
            tile = self._load_tile(zoom, x, y)
            if tile:
                return tile, self._tile_bounds(zoom, x, y)
        return None, None

    def sample(self, points: Iterable[Point]) -> Dict[str, Optional[float]]:
        result: Dict[str, Optional[float]] = {}
        missing = 0
        for lng, lat in list(points):
            key = self._cache_key(lng, lat)
            if not (
                self.coverage_bounds_wgs84["west"] <= lng <= self.coverage_bounds_wgs84["east"]
                and self.coverage_bounds_wgs84["south"] <= lat <= self.coverage_bounds_wgs84["north"]
            ):
                result[key] = None
                missing += 1
                continue
            tile, tile_bounds = self._resolve_tile(lng, lat)
            if not tile or not tile_bounds:
                result[key] = None
                missing += 1
                continue
            u = ((lng - tile_bounds["west"]) / max(tile_bounds["east"] - tile_bounds["west"], 1e-12)) * 32767.0
            v = ((lat - tile_bounds["south"]) / max(tile_bounds["north"] - tile_bounds["south"], 1e-12)) * 32767.0
            result[key] = tile.sample(u, v)
        if missing:
            progress(f"离线 terrain 采样完成，{missing} 个点未命中可用瓦片或超出覆盖范围")
        return result

    def close(self) -> None:
        self._tile_cache.clear()


class LocalRasterDEMProvider:
    def __init__(
        self,
        config: AirlandingConfig = CONFIG,
        bounds: Optional[Dict[str, float]] = None,
        padding_km: float = 0.0,
    ):
        if not bounds:
            raise ValueError("LocalRasterDEMProvider 需要 bounds 才能定位本地 DEM 缓存")
        self.config = config
        self.provider_name = "OpenTopographyLocalRaster"
        self.dataset_name = self.config.DEM_TYPE
        self.bounds = expand_bounds(bounds, max(float(padding_km or 0.0), 0.0))
        self.cache_path = dem_cache_file(self.bounds, self.config.DEM_TYPE, self.config.DEM_CACHE_DIR)
        self._dataset = None
        self._rasterio = None
        self._transform = None
        self._ensure_dataset()

    def _cache_key(self, lng: float, lat: float) -> str:
        return f"{lat:.6f},{lng:.6f}"

    def _ensure_dataset(self) -> None:
        try:
            import rasterio
            from rasterio.warp import transform
        except Exception as exc:
            raise RuntimeError("rasterio 未安装，无法读取本地 GeoTIFF DEM") from exc

        self._rasterio = rasterio
        self._transform = transform
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.cache_path.exists():
            self._download_dem()
        self._dataset = self._rasterio.open(self.cache_path)
        progress(f"本地 DEM 缓存已加载: {self.cache_path.name}")

    def _download_dem(self) -> None:
        api_key = self.config.OPENTOPOGRAPHY_API_KEY
        if not api_key:
            raise RuntimeError("缺少 OPENTOPOGRAPHY_API_KEY，无法下载 OpenTopography DEM")

        params = {
            "demtype": self.config.DEM_TYPE,
            "south": f"{self.bounds['south']:.6f}",
            "north": f"{self.bounds['north']:.6f}",
            "west": f"{self.bounds['west']:.6f}",
            "east": f"{self.bounds['east']:.6f}",
            "outputFormat": "GTiff",
            "API_Key": api_key,
        }
        url = f"{self.config.opentopography_globaldem_url}?{urllib.parse.urlencode(params)}"
        tmp_path = self.cache_path.with_suffix(".part")
        progress(
            "OpenTopography DEM 缓存缺失，开始下载 "
            f"{self.config.DEM_TYPE} GeoTIFF: "
            f"W{self.bounds['west']:.4f}, S{self.bounds['south']:.4f}, "
            f"E{self.bounds['east']:.4f}, N{self.bounds['north']:.4f}"
        )
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "tactical-visualizer-airlanding/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=max(self.config.dem_timeout_s, 60.0)) as response:
                content_type = response.headers.get("Content-Type", "")
                payload = response.read()
            if b"error" in payload[:256].lower() or "json" in content_type.lower():
                raise RuntimeError(payload[:500].decode("utf-8", errors="ignore"))
            tmp_path.write_bytes(payload)
            os.replace(tmp_path, self.cache_path)
            progress(f"OpenTopography DEM 下载完成并写入缓存: {self.cache_path.name}")
        finally:
            if tmp_path.exists() and not self.cache_path.exists():
                tmp_path.unlink(missing_ok=True)

    def _transform_points_for_dataset(self, points: List[Point]) -> List[Point]:
        dataset_crs = self._dataset.crs
        if not dataset_crs or dataset_crs.to_epsg() == 4326:
            return points
        lngs = [lng for lng, _lat in points]
        lats = [lat for _lng, lat in points]
        xs, ys = self._transform("EPSG:4326", dataset_crs, lngs, lats)
        return list(zip(xs, ys))

    def sample(self, points: Iterable[Point]) -> Dict[str, Optional[float]]:
        points = list(points)
        if not points:
            return {}
        sample_points = self._transform_points_for_dataset(points)
        result: Dict[str, Optional[float]] = {}
        nodata = self._dataset.nodata
        for (lng, lat), values in zip(points, self._dataset.sample(sample_points, masked=True)):
            key = self._cache_key(lng, lat)
            if values is None or len(values) == 0:
                result[key] = None
                continue
            value = values[0]
            if hasattr(value, "mask") and bool(value.mask):
                result[key] = None
                continue
            try:
                elevation = float(value)
            except (TypeError, ValueError):
                result[key] = None
                continue
            if not math.isfinite(elevation) or (nodata is not None and elevation == float(nodata)):
                result[key] = None
            else:
                result[key] = elevation
        return result

    def close(self) -> None:
        if self._dataset:
            self._dataset.close()
            self._dataset = None


class OpenTopoDataProvider:
    def __init__(self, config: AirlandingConfig = CONFIG):
        self.config = config
        self.provider_name = "OpenTopoData"
        self.dataset_name = self.config.dem_dataset
        self.cache: Dict[str, Optional[float]] = {}
        self._last_request_at = 0.0
        self._load_cache()

    def _cache_key(self, lng: float, lat: float) -> str:
        return f"{lat:.6f},{lng:.6f}"

    def _load_cache(self) -> None:
        path = self.config.cache_path
        if not path.exists():
            return
        try:
            self.cache = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            self.cache = {}

    def _save_cache(self) -> None:
        path = self.config.cache_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.cache, ensure_ascii=False, indent=2), encoding="utf-8")

    def sample(self, points: Iterable[Point]) -> Dict[str, Optional[float]]:
        points = list(points)
        unique: List[Point] = []
        seen = set()
        for lng, lat in points:
            key = self._cache_key(lng, lat)
            if key in seen:
                continue
            seen.add(key)
            if key not in self.cache:
                unique.append((lng, lat))

        for idx in range(0, len(unique), self.config.dem_batch_size):
            batch = unique[idx:idx + self.config.dem_batch_size]
            progress(f"OpenTopoData 高程请求 {idx + 1}-{idx + len(batch)} / {len(unique)}，首次运行需要联网访问 api.opentopodata.org")
            self._request_batch(batch)

        self._save_cache()
        return {self._cache_key(lng, lat): self.cache.get(self._cache_key(lng, lat)) for lng, lat in points}

    def _request_batch(self, points: List[Point]) -> None:
        if not points:
            return

        elapsed = time.time() - self._last_request_at
        if self._last_request_at and elapsed < self.config.dem_request_interval_s:
            time.sleep(self.config.dem_request_interval_s - elapsed)

        locations = "|".join(f"{lat:.6f},{lng:.6f}" for lng, lat in points)
        query = urllib.parse.urlencode({"locations": locations})
        url = f"{self.config.opentopo_base_url}/{self.config.dem_dataset}?{query}"

        request = urllib.request.Request(
            url,
            headers={"User-Agent": "tactical-visualizer-airlanding/1.0"},
        )

        payload = None
        last_error = None
        for attempt in range(self.config.dem_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.config.dem_timeout_s) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                break
            except Exception as exc:
                last_error = exc
                if attempt < self.config.dem_retries:
                    time.sleep(1.5 * (attempt + 1))
                else:
                    raise RuntimeError(f"OpenTopoData 请求失败: {last_error}") from exc
            finally:
                self._last_request_at = time.time()

        if payload.get("status") != "OK":
            raise RuntimeError(f"OpenTopoData 返回异常: {payload.get('error') or payload.get('status')}")

        results = payload.get("results") or []
        if len(results) != len(points):
            raise RuntimeError("OpenTopoData 返回数量与请求点数量不一致")

        for point, result in zip(points, results):
            lng, lat = point
            key = self._cache_key(lng, lat)
            elevation = result.get("elevation")
            self.cache[key] = float(elevation) if elevation is not None else None


OpenTopoDataDEMProvider = OpenTopoDataProvider

_reported_local_provider_failures = set()


def create_dem_provider(
    config: AirlandingConfig = CONFIG,
    bounds: Optional[Dict[str, float]] = None,
    padding_km: float = 0.0,
    dem_path: Optional[str] = None,
    terrain_root: Optional[str] = None,
):
    if config.DEM_PROVIDER == "local_cesium_terrain" or terrain_root:
        return CesiumTerrainDEMProvider(
            config,
            bounds=bounds,
            padding_km=padding_km,
            terrain_root=terrain_root,
        )

    if config.DEM_PROVIDER == "uploaded_geotiff" or dem_path:
        return UploadedGeoTiffDEMProvider(
            config,
            bounds=bounds,
            padding_km=padding_km,
            dem_path=dem_path,
        )

    if config.DEM_PROVIDER == "local_opentopography":
        try:
            return LocalRasterDEMProvider(config, bounds=bounds, padding_km=padding_km)
        except Exception as exc:
            reason = str(exc)
            if reason not in _reported_local_provider_failures:
                progress(f"本地 OpenTopography DEM 不可用，回退 OpenTopoData 点采样: {reason}")
                _reported_local_provider_failures.add(reason)
    return OpenTopoDataProvider(config)
