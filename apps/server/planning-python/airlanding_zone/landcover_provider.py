import json
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Iterable, Tuple

from config import AirlandingConfig, CONFIG


Point = Tuple[float, float]


def progress(message: str) -> None:
    print(f"[LandingZone] {message}", file=sys.stderr, flush=True)


class OSMLandcoverProvider:
    def __init__(self, config: AirlandingConfig = CONFIG):
        self.config = config
        self.cache: Dict[str, Dict[str, float]] = {}
        self._load_cache()

    def _cache_key(self, lng: float, lat: float) -> str:
        return f"{lat:.4f},{lng:.4f},r{self.config.overpass_radius_m}"

    def _load_cache(self) -> None:
        path = self.config.landcover_cache_path
        if not path.exists():
            return
        try:
            self.cache = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            self.cache = {}

    def _save_cache(self) -> None:
        path = self.config.landcover_cache_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.cache, ensure_ascii=False, indent=2), encoding="utf-8")

    def sample(self, points: Iterable[Point]) -> Tuple[Dict[str, Dict[str, float]], int]:
        points = list(points)
        missing = []
        seen = set()
        for lng, lat in points:
            key = self._cache_key(lng, lat)
            if key in seen:
                continue
            seen.add(key)
            if key not in self.cache:
                missing.append((lng, lat))

        if missing:
            progress(f"OSM 地表环境检查: {len(missing)} 个候选点，查询城市/森林/建筑风险")
            success_count = 0
            failure_count = 0
            failure_examples = []
            with ThreadPoolExecutor(max_workers=max(self.config.overpass_workers, 1)) as executor:
                future_map = {executor.submit(self._query_point, lng, lat): (lng, lat) for lng, lat in missing}
                for future in as_completed(future_map):
                    lng, lat = future_map[future]
                    key = self._cache_key(lng, lat)
                    try:
                        self.cache[key] = future.result()
                        success_count += 1
                    except Exception as exc:
                        failure_count += 1
                        if len(failure_examples) < 3:
                            failure_examples.append(str(exc))
                        self.cache[key] = self._empty_result()
            if failure_count:
                example_text = "；示例: " + " | ".join(failure_examples) if failure_examples else ""
                progress(
                    f"OSM 地表环境检查部分不可用: 成功 {success_count} 个，失败 {failure_count} 个，"
                    f"失败点已按无城市/森林惩罚处理{example_text}"
                )
            self._save_cache()

        return {
            self._cache_key(lng, lat): self.cache.get(self._cache_key(lng, lat), self._empty_result())
            for lng, lat in points
        }, len(missing)

    def _empty_result(self) -> Dict[str, float]:
        return {
            "urban_penalty": 0.0,
            "forest_penalty": 0.0,
            "urban_hits": 0,
            "forest_hits": 0,
        }

    def _query_point(self, lng: float, lat: float) -> Dict[str, float]:
        radius = self.config.overpass_radius_m
        query = f"""
[out:json][timeout:{int(self.config.overpass_timeout_s)}];
(
  nwr(around:{radius},{lat:.6f},{lng:.6f})["landuse"~"^(residential|commercial|industrial|retail|construction|forest|orchard)$"];
  nwr(around:{radius},{lat:.6f},{lng:.6f})["natural"~"^(wood|scrub)$"];
  nwr(around:{radius},{lat:.6f},{lng:.6f})["landcover"~"^(trees|forest)$"];
  nwr(around:{int(radius * 0.65)},{lat:.6f},{lng:.6f})["building"];
  nwr(around:{int(radius * 0.85)},{lat:.6f},{lng:.6f})["place"~"^(city|town|village)$"];
  nwr(around:{int(radius * 0.55)},{lat:.6f},{lng:.6f})["amenity"~"^(school|hospital|university|marketplace)$"];
);
out tags center 80;
"""
        data = urllib.parse.urlencode({"data": query}).encode("utf-8")
        request = urllib.request.Request(
            self.config.overpass_url,
            data=data,
            headers={"User-Agent": "tactical-visualizer-airlanding/1.0"},
        )
        with urllib.request.urlopen(request, timeout=self.config.overpass_timeout_s + 4) as response:
            payload = json.loads(response.read().decode("utf-8"))

        forest_hits = 0
        urban_hits = 0
        building_hits = 0
        for element in payload.get("elements") or []:
            tags = element.get("tags") or {}
            landuse = tags.get("landuse", "")
            natural = tags.get("natural", "")
            landcover = tags.get("landcover", "")
            if landuse in {"forest", "orchard"} or natural in {"wood", "scrub"} or landcover in {"trees", "forest"}:
                forest_hits += 1
            if landuse in {"residential", "commercial", "industrial", "retail", "construction"}:
                urban_hits += 1
            if "building" in tags or tags.get("place") in {"city", "town", "village"} or "amenity" in tags:
                building_hits += 1

        urban_penalty = min(1.0, (urban_hits * 0.35) + (building_hits * 0.16))
        forest_penalty = min(1.0, forest_hits * 0.45)
        return {
            "urban_penalty": round(urban_penalty, 4),
            "forest_penalty": round(forest_penalty, 4),
            "urban_hits": urban_hits + building_hits,
            "forest_hits": forest_hits,
        }
