import os
from dataclasses import dataclass
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_TERRAIN_ROOT_CANDIDATES = (
    APP_ROOT / "web" / "terrain",
    APP_ROOT / "web" / "pubulic" / "terrain",
    APP_ROOT / "web" / "public" / "terrain",
)
DEM_PROVIDER = os.getenv("AIRLANDING_DEM_PROVIDER", "local_cesium_terrain")
OPENTOPOGRAPHY_API_KEY = os.getenv("OPENTOPOGRAPHY_API_KEY")
DEM_TYPE = os.getenv("AIRLANDING_DEM_TYPE", "LOCAL_CESIUM_TERRAIN")
DEM_CACHE_DIR = "algo/airlanding_zone/cache/dem"
ENABLE_TERRAIN_REFINEMENT = True
TERRAIN_REFINEMENT_GRID_SIZE = 7
MAX_REFINED_SLOPE_DEG = 12.0
MAX_REFINED_RELIEF_M = 20.0
MAX_REFINED_ELEVATION_STD_M = 7.0
MAX_ABS_ELEVATION_M = 1200.0
REFINED_TERRAIN_MIN_SCORE = 0.28


def resolve_default_terrain_root() -> Path:
    env_root = os.getenv("PLANNING_TERRAIN_ROOT") or os.getenv("AIRLANDING_TERRAIN_ROOT")
    if env_root:
        return Path(env_root).expanduser().resolve()

    for candidate in DEFAULT_TERRAIN_ROOT_CANDIDATES:
        if (candidate / "layer.json").exists():
            return candidate.resolve()
    return DEFAULT_TERRAIN_ROOT_CANDIDATES[0].resolve()


DEFAULT_LANDING_REQUIREMENTS = {
    "num": 5,
    "landing_0": {"area_size": 0.1, "area_distance": 50},
    "landing_1": {"area_size": 0.1, "area_distance": 50},
    "landing_2": {"area_size": 0.1, "area_distance": 50},
    "landing_3": {"area_size": 0.1, "area_distance": 50},
    "landing_4": {"area_size": 0.1, "area_distance": 50},
}


@dataclass(frozen=True)
class AirlandingConfig:
    required_count: int = 5
    min_spacing_km: float = 5.0
    candidate_multiplier: int = 10
    candidates_per_landing: int = 10
    min_candidates_per_landing: int = 8
    candidate_display_spacing_km: float = 0.6
    max_grid_points: int = 3200
    dem_prefilter_multiplier: int = 4
    landing_polygon_size_m: float = 500.0
    min_land_elevation_m: float = 1.0
    min_valid_terrain_samples: int = 3
    terrain_selection_thresholds: tuple = (0.7, 0.4, 0.15, 0.05)
    bounds_padding_km: float = 50.0
    expansion_step_km: float = 25.0
    max_bounds_padding_km: float = 150.0
    max_search_overrun_km: float = 15.0
    max_target_bounds_span_km: float = 500.0
    target_outlier_distance_km: float = 350.0
    relaxed_max_slope_deg: float = 12.0
    relaxed_max_relief_m: float = 35.0
    max_slope_deg: float = 7.0
    max_relief_m: float = 20.0
    dem_dataset: str = "srtm30m"
    opentopo_base_url: str = "https://api.opentopodata.org/v1"
    DEM_PROVIDER: str = DEM_PROVIDER
    OPENTOPOGRAPHY_API_KEY: str = OPENTOPOGRAPHY_API_KEY
    DEM_TYPE: str = DEM_TYPE
    TERRAIN_ROOT: Path = resolve_default_terrain_root()
    terrain_sample_zoom: int = int(os.getenv("PLANNING_TERRAIN_SAMPLE_ZOOM", "12"))
    DEM_CACHE_DIR: Path = Path(__file__).resolve().parents[2] / DEM_CACHE_DIR
    opentopography_globaldem_url: str = "https://portal.opentopography.org/API/globaldem"
    dem_batch_size: int = 80
    dem_request_interval_s: float = 1.05
    dem_timeout_s: float = 60.0
    dem_retries: int = 2
    cache_path: Path = Path(__file__).resolve().parent / "cache" / "opentopodata_srtm30m.json"
    enable_osm_landcover: bool = os.getenv("ENABLE_OSM_LANDCOVER", "0") == "1"
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    overpass_radius_m: int = 850
    overpass_timeout_s: float = 4.0
    overpass_workers: int = 2
    landcover_cache_path: Path = Path(__file__).resolve().parent / "cache" / "osm_landcover.json"
    ENABLE_TERRAIN_REFINEMENT: bool = ENABLE_TERRAIN_REFINEMENT
    TERRAIN_REFINEMENT_GRID_SIZE: int = TERRAIN_REFINEMENT_GRID_SIZE
    MAX_REFINED_SLOPE_DEG: float = MAX_REFINED_SLOPE_DEG
    MAX_REFINED_RELIEF_M: float = MAX_REFINED_RELIEF_M
    MAX_REFINED_ELEVATION_STD_M: float = MAX_REFINED_ELEVATION_STD_M
    MAX_ABS_ELEVATION_M: float = MAX_ABS_ELEVATION_M
    REFINED_TERRAIN_MIN_SCORE: float = REFINED_TERRAIN_MIN_SCORE


CONFIG = AirlandingConfig()
