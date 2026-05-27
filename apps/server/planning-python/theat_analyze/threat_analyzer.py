import json
import math
import numpy as np
from typing import List, Dict, Any, Optional

from pyproj import Transformer
from schemas import SituationMap, TargetEntity
from geo_math import (
    parse_coordinate_string, 
    calculate_base_threat,
    compute_point_threat_contribution,
    resolve_decay_parameters,
)

class ThreatAnalyzer:
    """
    战术威胁分析类
    用于加载态势数据，并计算特定地理坐标点受各个目标影响的威胁度。
    """
    def __init__(self, situation: Optional[SituationMap] = None):
        self.situation = situation
        self.targets = situation.targets if situation else []
        self.threat_indices = []
        self.decay_params = []
        self.utm_coords = []
        self.epsg = 32651  # 默认 UTM Zone 51N
        self.transformer_to_utm = None
        
        if self.targets:
            self._initialize_math_models()

    def load_from_json_file(self, file_path: str):
        """从先前分析输出的 JSON 文件中加载状态"""
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        # 如果是前端或者后端产生的报告 JSON
        if "targets" in data:
            self.targets = []
            for t_data in data["targets"]:
                # 构建 TargetEntity
                factors = t_data.get("factors", {})
                from schemas import ThreatFactors
                tf = ThreatFactors(
                    lethality_range_km=factors.get("lethality_range_km", 0),
                    ew_erp_mw=factors.get("ew_erp_mw", 0),
                    survivability_score=factors.get("survivability_score", 5),
                    target_value=factors.get("target_value", 5),
                    air_defense_score=factors.get("air_defense_score", 1),
                    recon_warning_score=factors.get("recon_warning_score", 1),
                    anti_airlanding_score=factors.get("anti_airlanding_score", 1),
                )
                
                entity = TargetEntity(
                    target_id=t_data.get("target_id", ""),
                    target_category=t_data.get("target_category", ""),
                    target_name=t_data.get("target_name", ""),
                    raw_coordinates=t_data.get("raw_coordinates", f"{t_data.get('lat')}, {t_data.get('lng')}"),
                    heading_angle=t_data.get("heading_angle", -1.0),
                    confidence=t_data.get("confidence", 1.0),
                    factors=tf,
                    equip_params=t_data.get("equip_params", {})
                )
                # 后端历史报表通常直接存 lat/lng；保留原始坐标作为回退。
                if t_data.get("lat") is not None and t_data.get("lng") is not None:
                    entity.raw_coordinates = f"{t_data.get('lat')}, {t_data.get('lng')}"
                self.targets.append(entity)
                
        self._initialize_math_models()

    def _initialize_math_models(self):
        """初始化各个目标的空间衰减参数以及 UTM 坐标"""
        if not self.targets:
            return

        # 获取第一个目标的坐标系以确定 UTM Zone
        lat0, lon0 = parse_coordinate_string(self.targets[0].raw_coordinates)
        utm_zone = int((lon0 + 180) / 6) + 1
        hemisphere = "north" if lat0 >= 0 else "south"
        
        # 假设中国/第一岛链通常在北半球
        self.epsg = 32600 + utm_zone if hemisphere == "north" else 32700 + utm_zone
        
        self.transformer_to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{self.epsg}", always_xy=True)

        self.threat_indices = []
        self.decay_params = []
        self.utm_coords = []

        for t in self.targets:
            # 1. 计算 UTM 坐标
            lat, lon = parse_coordinate_string(t.raw_coordinates)
            utm_x, utm_y = self.transformer_to_utm.transform(lon, lat)
            self.utm_coords.append((utm_x, utm_y))

            # 2. 计算基础威胁度
            t_idx = calculate_base_threat(t.factors) * getattr(t, 'confidence', 1.0)
            self.threat_indices.append(t_idx)

            # 3. 解析空间衰减模型参数
            self.decay_params.append(resolve_decay_parameters(t, min_sigma=200.0))

    def evaluate_point(self, lon: float, lat: float) -> Dict[str, Any]:
        """
        评估指定经纬度点的威胁情况。
        
        Returns:
            dict: 包含总威胁度、主要威胁来源及其贡献度。
        """
        if not self.targets or not self.transformer_to_utm:
            return {"error": "未加载态势数据"}

        # 转换为 UTM
        px, py = self.transformer_to_utm.transform(lon, lat)
        p = np.array([px, py])

        total_threat = 0.0
        contributions = []

        for i, t in enumerate(self.targets):
            mu = np.array(self.utm_coords[i])
            T_i = self.threat_indices[i]
            params = self.decay_params[i]

            delta = p - mu
            distance_m = float(np.hypot(delta[0], delta[1]))
            threat_contribution = compute_point_threat_contribution(distance_m, T_i, params)
            
            total_threat += threat_contribution
            
            if threat_contribution > 0.0001:  # 仅记录有实质影响的威胁
                contributions.append({
                    "target_id": t.target_id,
                    "target_category": t.target_category,
                    "target_name": t.target_name,
                    "decay_model": params.model,
                    "distance_km": distance_m / 1000.0,
                    "contribution": float(threat_contribution),
                    "base_threat": float(T_i),
                    "weight": float(params.weight),
                })

        # 按贡献度从大到小排序
        contributions.sort(key=lambda x: x["contribution"], reverse=True)

        return {
            "longitude": lon,
            "latitude": lat,
            "total_threat": float(total_threat),
            "total_threat_normalized": float(min(total_threat, 1.0)),
            "threat_sources": contributions
        }

    def get_all_target_threat_indices(self) -> List[Dict[str, Any]]:
        """获取所有目标的威胁指数列表"""
        res = []
        for i, t in enumerate(self.targets):
            res.append({
                "target_id": t.target_id,
                "target_category": t.target_category,
                "target_name": t.target_name,
                "base_threat_index": float(self.threat_indices[i]) if self.threat_indices else 0.0,
                "confidence": getattr(t, 'confidence', 1.0)
            })
        return res
