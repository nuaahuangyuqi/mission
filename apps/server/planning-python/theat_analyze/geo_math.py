"""
geo_math.py — 坐标投影、直升机编组威胁权重计算与连续空间威胁场引擎

本模块是整个管道的数学核心，包含三大功能：
1. WGS84 → UTM 自动投影转换 (pyproj)
2. 面向直升机编组的威胁权重加权和计算
3. 高斯/截断衰减的二维威胁场叠加与非线性归一化

所有计算均使用 NumPy 矩阵向量化操作，禁止双重循环遍历像素。
"""

import re
import logging
import math
from dataclasses import dataclass
from typing import Dict, List, Tuple, Union

import numpy as np
from numpy.typing import NDArray
from pyproj import Transformer

from schemas import TargetEntity, ThreatFactors, SituationMap

logger = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────
# 0. 空间衰减模型配置
# ────────────────────────────────────────────────────────

GAUSSIAN_DECAY = "gaussian"
TRUNCATED_DECAY = "truncated"


@dataclass(frozen=True)
class DecayParameters:
    """单个目标的空间衰减参数。"""

    model: str
    range_m: float
    sigma_m: float
    exponent_k: float
    weight: float
    effective_radius_m: float


TARGET_DECAY_CONFIG: Dict[str, Dict[str, Union[float, str]]] = {
    "防空阵地": {"model": TRUNCATED_DECAY, "weight": 1.15, "k": 2.2},
    "炮兵阵地": {"model": TRUNCATED_DECAY, "weight": 1.00, "k": 1.8},
    "火力节点": {"model": TRUNCATED_DECAY, "weight": 1.00, "k": 1.8},
    "C2指挥": {"model": GAUSSIAN_DECAY, "weight": 1.15, "sigma_ratio": 1.0 / 3.0},
    "雷达预警": {"model": GAUSSIAN_DECAY, "weight": 1.10, "sigma_ratio": 0.45},
    "预警节点": {"model": GAUSSIAN_DECAY, "weight": 1.10, "sigma_ratio": 0.45},
    "电子战": {"model": GAUSSIAN_DECAY, "weight": 1.10, "sigma_ratio": 0.50},
    "电子战/诱饵": {"model": GAUSSIAN_DECAY, "weight": 0.85, "sigma_ratio": 0.50},
    "通信节点": {"model": GAUSSIAN_DECAY, "weight": 0.95, "sigma_ratio": 1.0 / 3.0},
    "侦察节点": {"model": GAUSSIAN_DECAY, "weight": 1.00, "sigma_ratio": 0.45},
    "后勤节点": {"model": GAUSSIAN_DECAY, "weight": 0.80, "sigma_ratio": 1.0 / 3.0},
    "后勤/支撑": {"model": GAUSSIAN_DECAY, "weight": 0.80, "sigma_ratio": 1.0 / 3.0},
    "步兵阵地": {"model": GAUSSIAN_DECAY, "weight": 0.70, "sigma_ratio": 1.0 / 3.0},
    "预备队": {"model": GAUSSIAN_DECAY, "weight": 0.75, "sigma_ratio": 1.0 / 3.0},
}

DEFAULT_DECAY_CONFIG: Dict[str, Union[float, str]] = {
    "model": GAUSSIAN_DECAY,
    "weight": 1.0,
    "sigma_ratio": 1.0 / 3.0,
    "k": 3.0,
}

ABSOLUTE_RANGE_KEYWORDS = ("SAM", "PAC", "防空", "导弹", "火力", "炮兵")

TACTICAL_COLOR_STOPS = np.array(
    [
        [0.00, 0, 0, 0, 0],
        [0.12, 84, 178, 255, 10],
        [0.26, 44, 203, 174, 30],
        [0.42, 99, 218, 112, 52],
        [0.58, 238, 213, 92, 76],
        [0.74, 242, 146, 61, 102],
        [0.90, 224, 78, 58, 128],
        [1.00, 162, 49, 69, 148],
    ],
    dtype=np.float32,
)

# ────────────────────────────────────────────────────────
# 1. 坐标解析与投影转换
# ────────────────────────────────────────────────────────

def parse_coordinate_string(raw: str) -> Tuple[float, float]:
    """解析多种格式的坐标字符串，返回 (lat, lon) 十进制度。

    支持格式：
      - 十进制度: "23.2885°N, 114.0078°E"
      - 度分秒 (DMS): "23°17'18.6\"N, 114°0'28.1\"E"

    Args:
        raw: 原始坐标字符串。

    Returns:
        (latitude, longitude) 十进制度元组。
    """
    raw = str(raw).strip()
    normalized = re.sub(r"\s+", "", raw).lower().replace("\\", "/")
    if normalized in {"", "n/a", "na", "none", "null", "unknown", "unk", "无", "未知", "不详", "未提供", "待定", "-"}:
        raise ValueError(f"无法解析坐标字符串: {raw}")

    def _finish(lat: float, lon: float) -> Tuple[float, float]:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError(f"坐标超出合法经纬度范围: {raw}")
        return lat, lon

    # 尝试十进制度格式
    decimal_pat = re.compile(
        r"(\d+\.?\d*)\s*°?\s*([NS])\s*[,，]\s*(\d+\.?\d*)\s*°?\s*([EW])",
        re.IGNORECASE,
    )
    m = decimal_pat.search(raw)
    if m:
        lat = float(m.group(1)) * (1 if m.group(2).upper() == "N" else -1)
        lon = float(m.group(3)) * (1 if m.group(4).upper() == "E" else -1)
        return _finish(lat, lon)

    # 尝试经纬度写反的十进制度格式: "114.0078°E, 23.2885°N"
    lon_lat_pat = re.compile(
        r"(\d+\.?\d*)\s*°?\s*([EW])\s*[,，]\s*(\d+\.?\d*)\s*°?\s*([NS])",
        re.IGNORECASE,
    )
    m = lon_lat_pat.search(raw)
    if m:
        lon = float(m.group(1)) * (1 if m.group(2).upper() == "E" else -1)
        lat = float(m.group(3)) * (1 if m.group(4).upper() == "N" else -1)
        return _finish(lat, lon)

    # 尝试裸十进制度格式："23.2885, 114.0078"
    bare_decimal_pat = re.compile(
        r"^\s*([+-]?\d+\.?\d*)\s*[,，]\s*([+-]?\d+\.?\d*)\s*$"
    )
    m = bare_decimal_pat.search(raw)
    if m:
        lat = float(m.group(1))
        lon = float(m.group(2))
        if abs(lat) > 90 and abs(lon) <= 90:
            lat, lon = lon, lat
        return _finish(lat, lon)

    # 尝试度分秒格式
    dms_pat = re.compile(
        r"(\d+)\s*°\s*(\d+)\s*[''′]\s*([\d.]+)\s*[\"″]?\s*([NS])"
        r"\s*[,，]\s*"
        r"(\d+)\s*°\s*(\d+)\s*[''′]\s*([\d.]+)\s*[\"″]?\s*([EW])",
        re.IGNORECASE,
    )
    m = dms_pat.search(raw)
    if m:
        lat = (int(m.group(1)) + int(m.group(2)) / 60 + float(m.group(3)) / 3600)
        lat *= (1 if m.group(4).upper() == "N" else -1)
        lon = (int(m.group(5)) + int(m.group(6)) / 60 + float(m.group(7)) / 3600)
        lon *= (1 if m.group(8).upper() == "E" else -1)
        return _finish(lat, lon)

    raise ValueError(f"无法解析坐标字符串: {raw}")


def determine_utm_epsg(lon: float) -> int:
    """根据经度自动判断 UTM 带号并返回 EPSG 代码。

    Args:
        lon: 经度（十进制度）。

    Returns:
        UTM 投影的 EPSG 代码 (北半球: 326xx)。
    """
    zone = int((lon + 180) / 6) + 1
    epsg = 32600 + zone  # 北半球
    logger.info("经度 %.4f° → UTM Zone %d (EPSG:%d)", lon, zone, epsg)
    return epsg


def project_targets(
    targets: List[TargetEntity],
) -> Tuple[NDArray[np.float64], NDArray[np.float64], int]:
    """将所有目标的 WGS84 坐标批量投影到 UTM 坐标系。

    Args:
        targets: 目标实体列表。

    Returns:
        (xs, ys, epsg): UTM X 坐标数组(m), UTM Y 坐标数组(m), EPSG代码。
    """
    lats: List[float] = []
    lons: List[float] = []
    for t in targets:
        lat, lon = parse_coordinate_string(t.raw_coordinates)
        lats.append(lat)
        lons.append(lon)

    # 以所有目标的平均经度确定 UTM 带号
    mean_lon = sum(lons) / len(lons)
    epsg = determine_utm_epsg(mean_lon)

    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    xs_list: List[float] = []
    ys_list: List[float] = []
    for lat, lon in zip(lats, lons):
        x, y = transformer.transform(lon, lat)
        xs_list.append(x)
        ys_list.append(y)

    return np.array(xs_list), np.array(ys_list), epsg


# ────────────────────────────────────────────────────────
# 2. 直升机编组威胁权重计算
# ────────────────────────────────────────────────────────

# 直升机编组威胁权重:
# [杀伤/软杀伤距离, 电战功率, 生存能力, 目标价值, 防空拦截, 侦察预警, 反机降阻滞]
HELICOPTER_THREAT_WEIGHTS = np.array([0.16, 0.08, 0.10, 0.10, 0.28, 0.18, 0.10])


def _target_text(target: TargetEntity) -> str:
    return " ".join(
        [
            target.target_id or "",
            target.target_category or "",
            target.target_name or "",
            getattr(target, "description", "") or "",
            " ".join(str(v) for v in getattr(target, "equip_params", {}).values()),
        ]
    )


def _clip_score(value: float) -> int:
    return int(np.clip(round(float(value)), 1, 10))


def enrich_helicopter_threat_factors(target: TargetEntity) -> ThreatFactors:
    """补齐直升机编组威胁因子，兼容旧数据和弱模型输出。"""
    factors = target.factors
    text = _target_text(target)
    category = target.target_category or ""

    air_defense = getattr(factors, "air_defense_score", 1) or 1
    recon_warning = getattr(factors, "recon_warning_score", 1) or 1
    anti_airlanding = getattr(factors, "anti_airlanding_score", 1) or 1

    if re.search(r"防空|SAM|PAC|导弹|便携防空|高炮|弹炮|火控|MANPADS|Stinger|毒刺|海剑|天弓", text, re.IGNORECASE):
        air_defense = max(air_defense, 8)
    if re.search(r"近程|短程|便携|高炮|机枪|伴随", text):
        air_defense = max(air_defense, 6)
    if "防空阵地" in category:
        air_defense = max(air_defense, 9)

    if re.search(r"雷达|预警|侦察|ISR|传感|测向|电子侦察|低空|观察|无人机", text, re.IGNORECASE):
        recon_warning = max(recon_warning, 8)
    if category in {"雷达预警", "预警节点", "侦察节点"}:
        recon_warning = max(recon_warning, 9)
    if category in {"通信节点", "C2指挥"}:
        recon_warning = max(recon_warning, 5)

    if re.search(r"反机降|机降|空降|着陆|降落|障碍|拒止|伏击|预设火力|封控|阻滞|机场", text):
        anti_airlanding = max(anti_airlanding, 8)
    if category in {"步兵阵地", "预备队"}:
        anti_airlanding = max(anti_airlanding, 6)
    if category in {"炮兵阵地", "火力节点", "火力坐标"}:
        anti_airlanding = max(anti_airlanding, 5)

    factors.air_defense_score = _clip_score(air_defense)
    factors.recon_warning_score = _clip_score(recon_warning)
    factors.anti_airlanding_score = _clip_score(anti_airlanding)
    return factors


def calculate_base_threat(factors: ThreatFactors) -> float:
    """计算单个目标的基础威胁指数 (Base Threat Index)。

    面向我方直升机编组，权重由敌方防空体系、侦察预警、反机降设施主导，
    同时保留杀伤/软杀伤距离、电战功率、生存能力和目标价值。
    归一化范围为经验性全局极值：
      - lethality_range_km: [0, 65]
      - ew_erp_mw: [0, 1.5]
      - 其余评分项: [1, 10]

    Args:
        factors: 目标的威胁因子。

    Returns:
        基础威胁指数 T_i ∈ [0, 1]。
    """
    # 经验性全局极值 (根据文档中所有目标的参数范围确定)
    min_vals = np.array([0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0])
    max_vals = np.array([65.0, 1.5, 10.0, 10.0, 10.0, 10.0, 10.0])

    raw = np.array([
        factors.lethality_range_km,
        factors.ew_erp_mw,
        float(factors.survivability_score),
        float(factors.target_value),
        float(getattr(factors, "air_defense_score", 1)),
        float(getattr(factors, "recon_warning_score", 1)),
        float(getattr(factors, "anti_airlanding_score", 1)),
    ])

    # Min-Max 归一化到 [0, 1]
    normalized = np.clip((raw - min_vals) / (max_vals - min_vals + 1e-12), 0.0, 1.0)

    # 直升机编组威胁权重加权和
    threat_index: float = float(np.dot(HELICOPTER_THREAT_WEIGHTS, normalized))
    return threat_index


def explain_helicopter_threat(factors: ThreatFactors) -> Dict[str, float]:
    """返回威胁指数的归一化分项贡献，供前端和报告展示。"""
    min_vals = np.array([0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0])
    max_vals = np.array([65.0, 1.5, 10.0, 10.0, 10.0, 10.0, 10.0])
    raw = np.array([
        factors.lethality_range_km,
        factors.ew_erp_mw,
        float(factors.survivability_score),
        float(factors.target_value),
        float(getattr(factors, "air_defense_score", 1)),
        float(getattr(factors, "recon_warning_score", 1)),
        float(getattr(factors, "anti_airlanding_score", 1)),
    ])
    normalized = np.clip((raw - min_vals) / (max_vals - min_vals + 1e-12), 0.0, 1.0)
    weighted = normalized * HELICOPTER_THREAT_WEIGHTS
    keys = [
        "lethality_range",
        "electronic_warfare",
        "survivability",
        "target_value",
        "air_defense",
        "recon_warning",
        "anti_airlanding",
    ]
    return {key: float(value) for key, value in zip(keys, weighted)}


def compute_all_threat_indices(targets: List[TargetEntity]) -> NDArray[np.float64]:
    """批量计算所有目标的基础威胁指数。

    Args:
        targets: 目标实体列表。

    Returns:
        形状为 (N,) 的威胁指数数组。
    """
    for target in targets:
        enrich_helicopter_threat_factors(target)
    indices = np.array([calculate_base_threat(t.factors) * getattr(t, 'confidence', 1.0) for t in targets])
    logger.info(
        "威胁指数统计: min=%.3f, max=%.3f, mean=%.3f",
        indices.min(), indices.max(), indices.mean(),
    )
    return indices


# ────────────────────────────────────────────────────────
# 3. 空间衰减函数与威胁场叠加 (Spatial Decay Field)
# ────────────────────────────────────────────────────────

def _build_covariance_matrix(
    heading_angle: float,
    lethality_range_km: float,
    is_omnidirectional: bool,
    min_sigma: float = 200.0,
) -> NDArray[np.float64]:
    """为单个目标构建 2×2 协方差矩阵。

    对于全向目标：各向同性高斯核 (σ_front == σ_side)。
    对于有方向目标：各向异性高斯核 (σ_front = 3 × σ_side)。

    方差大小与 lethality_range_km 正相关：
      σ_front = lethality_range_km × 1000 / 2  (米)
      （使得 ~95% 的高斯质量落在 2σ ≈ 杀伤距离范围内）

    Args:
        heading_angle: 航向角 (0-360, 正北为0, 顺时针)。-1 为全向。
        lethality_range_km: 杀伤距离 (km)。
        is_omnidirectional: 是否为全向目标。
        min_sigma: 最小方差限制，防止目标因网格过大而被漏采样。

    Returns:
        2×2 协方差矩阵 Σ。
    """
    # 将杀伤距离转换为方差参数 (米)
    # σ_front 设为杀伤距离的一半，使得 2σ ≈ 杀伤距离
    sigma_front = max(lethality_range_km * 1000.0 / 2.0, min_sigma)  # 动态最小限制

    if is_omnidirectional:
        # 各向同性：圆形高斯核
        sigma_side = sigma_front
    else:
        # 各向异性：水滴/扇形场
        # σ_front = 3 × σ_side
        sigma_side = sigma_front / 3.0

    if is_omnidirectional:
        # 无需旋转
        cov = np.array([
            [sigma_front ** 2, 0.0],
            [0.0, sigma_side ** 2],
        ])
    else:
        # 航向角 → 数学极坐标角
        # φ = 90° - θ (正北为0顺时针 → 数学角正东为0逆时针)
        phi_deg = 90.0 - heading_angle
        phi_rad = math.radians(phi_deg)

        cos_phi = math.cos(phi_rad)
        sin_phi = math.sin(phi_rad)

        # 旋转矩阵 R(φ)
        R = np.array([
            [cos_phi, -sin_phi],
            [sin_phi, cos_phi],
        ])

        # 对角方差矩阵
        D = np.array([
            [sigma_front ** 2, 0.0],
            [0.0, sigma_side ** 2],
        ])

        # Σ = R · D · R^T
        cov = R @ D @ R.T

    return cov


def _uses_absolute_range(target: TargetEntity) -> bool:
    """判断目标是否应采用截断/阶跃式射程衰减。"""
    haystack = " ".join(
        [
            target.target_id or "",
            target.target_category or "",
            target.target_name or "",
            " ".join(str(v) for v in getattr(target, "equip_params", {}).values()),
        ]
    )
    return any(keyword in haystack for keyword in ABSOLUTE_RANGE_KEYWORDS)


def resolve_decay_parameters(
    target: TargetEntity,
    min_sigma: float = 200.0,
) -> DecayParameters:
    """根据目标类别、装备类型和射程解析空间衰减参数。

    高斯模型用于阵地、基地、C2、雷达、电战等边界不清晰的区域威慑；
    截断模型用于防空、导弹、炮兵、火力节点等存在明确最大射程的武器。
    """
    config = dict(DEFAULT_DECAY_CONFIG)
    config.update(TARGET_DECAY_CONFIG.get(target.target_category, {}))

    if _uses_absolute_range(target):
        config["model"] = TRUNCATED_DECAY

    range_m = max(float(target.factors.lethality_range_km or 0.0) * 1000.0, min_sigma * 2.0)
    weight = float(config.get("weight", 1.0))
    exponent_k = float(config.get("k", 3.0))

    if config.get("model") == TRUNCATED_DECAY:
        return DecayParameters(
            model=TRUNCATED_DECAY,
            range_m=range_m,
            sigma_m=0.0,
            exponent_k=exponent_k,
            weight=weight,
            effective_radius_m=range_m,
        )

    sigma_ratio = float(config.get("sigma_ratio", 1.0 / 3.0))
    sigma_m = max(range_m * sigma_ratio, min_sigma)
    return DecayParameters(
        model=GAUSSIAN_DECAY,
        range_m=range_m,
        sigma_m=sigma_m,
        exponent_k=exponent_k,
        weight=weight,
        effective_radius_m=max(3.0 * sigma_m, range_m),
    )


def compute_spatial_decay(
    distance_m: NDArray[np.float64],
    base_threat: float,
    params: DecayParameters,
) -> NDArray[np.float64]:
    """计算向量化空间衰减贡献 T(d)。"""
    weighted_base = float(base_threat) * params.weight

    if params.model == TRUNCATED_DECAY:
        contribution = np.zeros_like(distance_m, dtype=np.float64)
        mask = distance_m <= params.range_m
        if np.any(mask):
            ratio = np.clip(distance_m[mask] / max(params.range_m, 1e-9), 0.0, 1.0)
            shaped_ratio = np.power(ratio, 1.0 / max(params.exponent_k, 1e-9))
            cosine_taper = 0.5 * (1.0 + np.cos(np.pi * shaped_ratio))
            contribution[mask] = weighted_base * np.clip(cosine_taper, 0.0, 1.0)
        return contribution

    sigma = max(params.sigma_m, 1e-9)
    return weighted_base * np.exp(-np.square(distance_m) / (2.0 * sigma * sigma))


def compute_point_threat_contribution(
    distance_m: float,
    base_threat: float,
    params: DecayParameters,
) -> float:
    """计算单点到单目标的威胁贡献。"""
    distance = np.array([distance_m], dtype=np.float64)
    return float(compute_spatial_decay(distance, base_threat, params)[0])


def normalize_threat_matrix(
    threat_matrix: NDArray[np.float64],
    percentile: float = 98.0,
) -> Tuple[NDArray[np.float32], float]:
    """使用正值 95 分位阈值和 log1p 映射压缩热力图动态范围。"""
    matrix = np.nan_to_num(threat_matrix, nan=0.0, posinf=0.0, neginf=0.0)
    matrix = np.maximum(matrix, 0.0)
    positive_values = matrix[matrix > 0.0]
    if positive_values.size == 0:
        return np.zeros_like(matrix, dtype=np.float32), 0.0

    max_threshold = float(np.percentile(positive_values, percentile))
    max_threshold = max(max_threshold, 1e-12)
    clipped = np.minimum(matrix, max_threshold)
    normalized = np.log1p(clipped) / math.log1p(max_threshold)
    return np.clip(normalized, 0.0, 1.0).astype(np.float32), max_threshold


def smooth_normalized_matrix(
    normalized_matrix: NDArray[np.float32],
    passes: int = 2,
) -> NDArray[np.float32]:
    """轻量平滑归一化矩阵，降低色带分界和截断边缘的视觉突兀感。"""
    smoothed = normalized_matrix.astype(np.float32, copy=True)
    for _ in range(max(passes, 0)):
        padded = np.pad(smoothed, ((1, 1), (1, 1)), mode="edge")
        smoothed = (
            padded[:-2, :-2] + 2.0 * padded[:-2, 1:-1] + padded[:-2, 2:]
            + 2.0 * padded[1:-1, :-2] + 4.0 * padded[1:-1, 1:-1] + 2.0 * padded[1:-1, 2:]
            + padded[2:, :-2] + 2.0 * padded[2:, 1:-1] + padded[2:, 2:]
        ) / 16.0
    return np.clip(smoothed, 0.0, 1.0).astype(np.float32)


def apply_tactical_colormap(
    normalized_matrix: NDArray[np.float32],
) -> NDArray[np.uint8]:
    """将 [0,1] 归一化威胁矩阵映射为战术 RGBA 色带。"""
    norm = np.clip(normalized_matrix, 0.0, 1.0)
    rgba = np.zeros((*norm.shape, 4), dtype=np.float32)

    for i in range(len(TACTICAL_COLOR_STOPS) - 1):
        left = TACTICAL_COLOR_STOPS[i]
        right = TACTICAL_COLOR_STOPS[i + 1]
        left_v, right_v = left[0], right[0]
        if i == len(TACTICAL_COLOR_STOPS) - 2:
            mask = (norm >= left_v) & (norm <= right_v)
        else:
            mask = (norm >= left_v) & (norm < right_v)

        if not np.any(mask):
            continue

        local_t = (norm[mask] - left_v) / max(right_v - left_v, 1e-9)
        rgba[mask] = left[1:] + (right[1:] - left[1:]) * local_t[:, np.newaxis]

    rgba[norm <= 0.0, 3] = 0.0
    return np.clip(np.rint(rgba), 0, 255).astype(np.uint8)


def compute_threat_heatmap(
    xs: NDArray[np.float64],
    ys: NDArray[np.float64],
    threat_indices: NDArray[np.float64],
    targets: List[TargetEntity],
    grid_resolution: int = 500,
    padding_ratio: float = 0.20,
) -> Tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], Tuple[float, float, float, float]]:
    """计算整个战场区域的二维威胁热力图。

    对态势图上的每个网格点 p=(x,y)，威胁值为所有目标威胁场的叠加：
      U(p) = Σ_i w_i · T_i(d_i)

    其中 T_i(d_i) 按目标类型选择高斯衰减或截断衰减。

    使用 NumPy 矩阵向量化操作，避免双重循环。

    Args:
        xs: 目标 UTM X 坐标 (m)，形状 (N,)。
        ys: 目标 UTM Y 坐标 (m)，形状 (N,)。
        threat_indices: 基础威胁指数 (N,)。
        targets: 目标实体列表。
        grid_resolution: 网格分辨率（每维的网格点数）。
        padding_ratio: 边界外扩比例。

    Returns:
        (grid_x, grid_y, threat_matrix, extents): 网格坐标与威胁矩阵，以及边界(x_min, x_max, y_min, y_max)。
        grid_x, grid_y 形状为 (resolution, resolution)，
        threat_matrix 形状相同。
    """
    n_targets = len(targets)
    initial_params = [resolve_decay_parameters(t, min_sigma=200.0) for t in targets]

    # 计算边界并外扩
    x_min, x_max = xs.min(), xs.max()
    y_min, y_max = ys.min(), ys.max()
    x_range = x_max - x_min
    y_range = y_max - y_min

    # 确保范围不为零
    x_range = max(x_range, 1000.0)
    y_range = max(y_range, 1000.0)

    max_effective_radius_m = max([p.effective_radius_m for p in initial_params] + [1000.0])
    padding_x = max(x_range * padding_ratio, max_effective_radius_m)
    padding_y = max(y_range * padding_ratio, max_effective_radius_m)

    x_min -= padding_x
    x_max += padding_x
    y_min -= padding_y
    y_max += padding_y

    # 生成网格
    gx = np.linspace(x_min, x_max, grid_resolution)
    gy = np.linspace(y_min, y_max, grid_resolution)
    grid_x, grid_y = np.meshgrid(gx, gy)  # 各 (res, res)

    # 初始化总威胁矩阵
    total_threat = np.zeros_like(grid_x, dtype=np.float32)

    # 计算网格步长，防止小目标因像素过稀而被漏采样。
    dx = (x_max - x_min) / grid_resolution
    dy = (y_max - y_min) / grid_resolution
    dynamic_min_sigma = max(dx, dy) * 1.5

    for i in range(n_targets):
        t = targets[i]
        T_i = threat_indices[i]
        params = resolve_decay_parameters(
            t,
            min_sigma=max(200.0, dynamic_min_sigma),
        )
        distance = np.hypot(grid_x - xs[i], grid_y - ys[i])
        total_threat += compute_spatial_decay(distance, T_i, params).astype(np.float32)

    logger.info(
        "空间威胁场计算完成: 网格 %dx%d, 原始峰值=%.4f, 目标数=%d",
        grid_resolution, grid_resolution, total_threat.max(), n_targets,
    )

    return grid_x, grid_y, total_threat, (x_min, x_max, y_min, y_max)
