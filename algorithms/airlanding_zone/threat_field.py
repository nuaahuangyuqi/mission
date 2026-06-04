import json
import math
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional


THEAT_ANALYZE_DIR = Path(__file__).resolve().parents[1] / "theat_analyze"
if str(THEAT_ANALYZE_DIR) not in sys.path:
    sys.path.insert(0, str(THEAT_ANALYZE_DIR))

try:
    from threat_analyzer import ThreatAnalyzer  # type: ignore  # noqa: E402
    from geo_math import parse_coordinate_string  # type: ignore  # noqa: E402
except ModuleNotFoundError:
    def parse_coordinate_string(value: str) -> tuple[float, float]:
        parts = [item.strip() for item in str(value or "").replace("，", ",").split(",") if item.strip()]
        if len(parts) < 2:
            raise ValueError("invalid coordinate string")
        first = float(parts[0])
        second = float(parts[1])
        if abs(first) <= 90 and abs(second) <= 180:
            return first, second
        return second, first

    class ThreatAnalyzer:  # type: ignore[no-redef]
        def __init__(self) -> None:
            self.targets: List[Dict[str, Any]] = []

        def load_from_json_file(self, path: str) -> None:
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
            self.targets = payload.get("targets") or []

        def evaluate_point(self, lng: float, lat: float) -> Dict[str, Any]:
            if not self.targets:
                return {"total_threat_normalized": 0.0}
            contributions: List[float] = []
            for target in self.targets:
                target_lng = target.get("lng")
                target_lat = target.get("lat")
                if target_lng is None or target_lat is None:
                    location = target.get("location") or {}
                    if isinstance(location, dict):
                        target_lng = location.get("lng")
                        target_lat = location.get("lat")
                try:
                    target_lng = float(target_lng)
                    target_lat = float(target_lat)
                except (TypeError, ValueError):
                    continue
                distance_km = haversine_km(lng, lat, target_lng, target_lat)
                base = float(target.get("threat_value") or target.get("threatScore") or 0.55)
                if base > 1:
                    base /= 100.0
                contributions.append(max(0.0, min(base, 1.0)) / (1.0 + distance_km / 18.0))
            return {"total_threat_normalized": min(sum(contributions), 1.0)}


def haversine_km(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return 2 * radius_km * math.asin(math.sqrt(a))


class ThreatField:
    def __init__(self, targets: List[Dict[str, Any]]):
        self.targets = targets or []
        self.analyzer = ThreatAnalyzer()
        self.target_points = self._extract_target_points()
        self._load_targets()

    def _load_targets(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as tmp:
            json.dump({"targets": self.targets}, tmp, ensure_ascii=False)
            tmp_path = tmp.name
        try:
            self.analyzer.load_from_json_file(tmp_path)
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def _extract_target_points(self) -> List[Dict[str, Any]]:
        points = []
        for target in self.targets:
            lng = target.get("lng")
            lat = target.get("lat")
            if lng is None or lat is None:
                try:
                    lat, lng = parse_coordinate_string(target.get("raw_coordinates", ""))
                except Exception:
                    continue
            try:
                points.append({
                    "target_id": target.get("target_id") or target.get("id") or "",
                    "lng": float(lng),
                    "lat": float(lat),
                })
            except (TypeError, ValueError):
                continue
        return points

    def evaluate(self, lng: float, lat: float) -> Dict[str, Any]:
        threat = self.analyzer.evaluate_point(lng, lat)
        normalized = float(threat.get("total_threat_normalized") or 0.0)
        nearest = self.nearest_target(lng, lat)
        return {
            "threat_value": normalized,
            "nearest_threat_id": nearest["target_id"] if nearest else "",
            "nearest_threat_distance_km": nearest["distance_km"] if nearest else 0.0,
        }

    def nearest_target(self, lng: float, lat: float) -> Optional[Dict[str, Any]]:
        nearest = None
        for target in self.target_points:
            distance = haversine_km(lng, lat, target["lng"], target["lat"])
            if nearest is None or distance < nearest["distance_km"]:
                nearest = {
                    "target_id": target["target_id"],
                    "distance_km": distance,
                }
        return nearest
