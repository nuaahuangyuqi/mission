"""
analyze.py — 战术威胁态势分析管道（Web 集成版）

本脚本作为 Node.js 后端的子进程调用入口，执行完整的分析管道：
  1. 解析 .docx 文档 → 通过 LLM 提取结构化目标数据 (SituationMap)
  2. WGS84 → UTM 坐标投影
  3. AHP 威胁权重计算
  4. Spatial Decay 威胁场热力图生成
  5. 将热力图渲染为 base64 PNG，连同结构化数据一起输出 JSON 到 stdout

输出 JSON 格式:
{
    "pipeline_version": 2,
    "targets": [...],          // 完整目标实体列表
    "threat_indices": [...],   // 对应每个目标的威胁指数
    "heatmap_base64": "...",   // 威胁场热力图 PNG 的 base64 编码
    "bounds": { "west": ..., "south": ..., "east": ..., "north": ... },
    "total_score": ...,        // 总威胁分数
    "utm_epsg": ...,           // UTM EPSG 代码
}
"""

import sys
import json
import io
import base64
import logging
import traceback
import signal
import os

import numpy as np
from PIL import Image

from schemas import SituationMap, TargetEntity
from extractor import extract_situation, LLMBackend, parse_file
from pyproj import Transformer
from geo_math import (
    project_targets,
    compute_all_threat_indices,
    compute_threat_heatmap,
    normalize_threat_matrix,
    smooth_normalized_matrix,
    apply_tactical_colormap,
    parse_coordinate_string,
    enrich_helicopter_threat_factors,
    explain_helicopter_threat,
)

# 抑制日志输出到 stderr，避免干扰 stdout JSON
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stderr,
)
logger = logging.getLogger("analyze")

LLM_MODEL = os.getenv("TV20_LLM_MODEL") or os.getenv("THREAT_ANALYSIS_LLM_MODEL") or "qwen-flash"
LLM_API_KEY = os.getenv("TV20_OPENAI_API_KEY") or os.getenv("THREAT_ANALYSIS_OPENAI_API_KEY") or ""
LLM_BASE_URL = os.getenv("TV20_OPENAI_BASE_URL") or os.getenv("THREAT_ANALYSIS_OPENAI_BASE_URL") or ""

ATTACK_TARGET_KEYWORDS = (
    "防空", "导弹", "火力", "炮兵", "迫榴炮", "火炮", "高炮", "机枪",
    "反坦克", "伏击", "打击", "拦截", "压制", "阻滞", "反机降", "SAM", "PAC",
)
SUPPORT_ONLY_CATEGORIES = {"C2指挥", "通信节点", "后勤节点", "后勤/支撑", "侦察节点", "预备队"}


def render_heatmap_to_base64(
    grid_x: np.ndarray,
    grid_y: np.ndarray,
    threat_matrix: np.ndarray,
    targets: list,
    xs: np.ndarray,
    ys: np.ndarray,
) -> str:
    """将威胁矩阵渲染为透明背景的 PNG 热力图，返回 base64 编码。

    仅渲染热力图本身（无坐标轴、标题等装饰），用于前端 CesiumJS 叠加。

    Args:
        grid_x: 网格 X 坐标 (m)。
        grid_y: 网格 Y 坐标 (m)。
        threat_matrix: 威胁值矩阵。
        targets: 目标实体列表。
        xs: 目标 UTM X 坐标 (m)。
        ys: 目标 UTM Y 坐标 (m)。

    Returns:
        PNG 图片的 base64 编码字符串。
    """
    t_norm, max_threshold = normalize_threat_matrix(threat_matrix, percentile=98.0)
    t_norm = smooth_normalized_matrix(t_norm, passes=2)
    logger.info("热力图归一化完成: 98%%阈值=%.6f", max_threshold)

    # NumPy 网格的第一行是南侧；PNG/Cesium 贴图第一行是北侧，因此需要上下翻转。
    rgba = apply_tactical_colormap(np.flipud(t_norm))
    image = Image.fromarray(rgba, mode="RGBA")

    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    buf.seek(0)

    return base64.b64encode(buf.read()).decode("utf-8")


def is_attack_target(target: TargetEntity) -> bool:
    """判断目标是否应纳入火力覆盖范围。"""
    text = " ".join([
        target.target_id or "",
        target.target_category or "",
        target.target_name or "",
        getattr(target, "description", "") or "",
        " ".join(str(v) for v in getattr(target, "equip_params", {}).values()),
    ])
    range_km = float(target.factors.lethality_range_km or 0.0)
    if range_km <= 0:
        return False
    if any(keyword in text for keyword in ATTACK_TARGET_KEYWORDS):
        return True
    return target.target_category not in SUPPORT_ONLY_CATEGORIES and range_km >= 2.0


def compute_fire_coverage_areas(
    targets: list[TargetEntity],
    threat_indices: np.ndarray,
) -> list[dict]:
    """基于所有攻击目标的攻击范围生成地图覆盖区。"""
    coverage_areas = []
    for idx, target in enumerate(targets):
        if not is_attack_target(target):
            continue
        lat, lon = parse_coordinate_string(target.raw_coordinates)
        radius_km = float(target.factors.lethality_range_km or 0.0)
        if radius_km <= 0:
            continue
        coverage_areas.append({
            "target_id": target.target_id,
            "target_category": target.target_category,
            "target_name": target.target_name,
            "lat": lat,
            "lng": lon,
            "radius_km": radius_km,
            "heading_angle": float(target.heading_angle),
            "coverage_type": "sector" if target.heading_angle >= 0 else "circle",
            "threat_index": float(threat_indices[idx]),
        })
    coverage_areas.sort(key=lambda item: item["threat_index"], reverse=True)
    return coverage_areas



def run_pipeline(doc_paths: list) -> dict:
    """执行完整的分析管道。

    Args:
        doc_paths: .docx 文件路径列表。

    Returns:
        包含所有分析结果的字典。
    """
    # ─── Step 1: LLM 数据提取 ─────────────────────────
    logger.info("Step 1: 文档解析与 LLM 结构化数据提取")
    try:
        situation = extract_situation(
            doc_paths=doc_paths,
            backend=LLMBackend.OPENAI_API,
            model=LLM_MODEL,
            api_key=LLM_API_KEY,
            base_url=LLM_BASE_URL,
        )
    except KeyboardInterrupt:
        # extractor.py 内部已捕获信号并返回了部分结果，此处仅做日志记录
        logger.info("\n[analyze] 侦测到中断信号，推演已截断。利用当前已提取数据完成解算...")
        # 此处不 raise，让程序继续向下执行 Steps 2-6
        # 兜底：如果 extractor 没能返回对象（极端情况），我们需要从局部变量尝试恢复，
        # 但目前 extractor.py 已经保证了返回 SituationMap 实例。
        pass

    n = len(situation.targets)
    logger.info("提取完成: 共 %d 个目标实体", n)

    if n == 0:
        return {
            "pipeline_version": 2,
            "targets": [],
            "threat_indices": [],
            "heatmap_base64": "",
            "bounds": {},
            "total_score": 0,
            "utm_epsg": 0,
            "error": "未提取到任何目标实体",
        }

    # ─── Step 2: 坐标投影 ──────────────────────────────
    logger.info("Step 2: WGS84 → UTM 坐标投影")
    xs, ys, epsg = project_targets(situation.targets)

    # ─── Step 3: AHP 威胁权重计算 ──────────────────────
    logger.info("Step 3: 直升机编组威胁权重计算")
    threat_indices = compute_all_threat_indices(situation.targets)

    # ─── Step 4: Spatial Decay 威胁场计算 ──────────────
    logger.info("Step 4: Spatial Decay 威胁场计算")
    grid_x, grid_y, threat_matrix, extents = compute_threat_heatmap(
        xs=xs,
        ys=ys,
        threat_indices=threat_indices,
        targets=situation.targets,
        grid_resolution=500,
    )

    # 将 UTM 网格整体投影为 WGS84 经纬度网格，消除因为直接将 UTM 贴图到 Cesium 矩形产生的剪切畸变
    transformer = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    grid_lon, grid_lat = transformer.transform(grid_x, grid_y)

    # ─── Step 5: 渲染热力图为 base64 PNG ──────────────
    logger.info("Step 5: 渲染热力图为 base64 PNG")
    heatmap_b64 = render_heatmap_to_base64(
        grid_lon, grid_lat, threat_matrix,
        situation.targets, xs, ys,
    )

    # ─── 计算地理边界 ─────────────────────────────────
    logger.info("Step 6: 计算热力图精确 WGS84 边界")
    bounds = {
        "west": float(grid_lon.min()),
        "south": float(grid_lat.min()),
        "east": float(grid_lon.max()),
        "north": float(grid_lat.max()),
    }

    # ─── 构建输出 ────────────────────────────────────
    targets_data = []
    for i, t in enumerate(situation.targets):
        enrich_helicopter_threat_factors(t)
        lat, lon = parse_coordinate_string(t.raw_coordinates)
        targets_data.append({
            "target_id": t.target_id,
            "target_category": t.target_category,
            "target_name": t.target_name,
            "description": getattr(t, 'description', ''),
            "raw_coordinates": t.raw_coordinates,
            "lat": lat,
            "lng": lon,
            "heading_angle": t.heading_angle,
            "factors": {
                "lethality_range_km": t.factors.lethality_range_km,
                "ew_erp_mw": t.factors.ew_erp_mw,
                "survivability_score": t.factors.survivability_score,
                "target_value": t.factors.target_value,
                "air_defense_score": t.factors.air_defense_score,
                "recon_warning_score": t.factors.recon_warning_score,
                "anti_airlanding_score": t.factors.anti_airlanding_score,
            },
            "equip_params": t.equip_params,
            "threat_index": float(threat_indices[i]),
            "threat_breakdown": explain_helicopter_threat(t.factors),
            "confidence": getattr(t, 'confidence', 1.0),
        })

    fire_coverage_areas = compute_fire_coverage_areas(situation.targets, threat_indices)
    total_score = int(np.round(threat_indices.sum() * 100))

    return {
        "pipeline_version": 2,
        "targets": targets_data,
        "threat_indices": [float(x) for x in threat_indices],
        "heatmap_base64": heatmap_b64,
        "bounds": bounds,
        "total_score": total_score,
        "utm_epsg": int(epsg),
        "enemy_force_type": situation.enemy_force_type,
        "enemy_force_type_confidence": situation.enemy_force_type_confidence,
        "enemy_force_type_basis": situation.enemy_force_type_basis,
        "fire_coverage_areas": fire_coverage_areas,
        "operational_intent": "",
        "deployment_posture": "",
        "assessment": {},
        "assessment_docx_path": "",
        "assessment_status": "pending",
    }


def main():
    """主入口：统一使用 V2 管道进行全要素提取与热力图计算。"""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "未提供任何有效文件路径"}))
        sys.exit(1)

    file_paths = sys.argv[1:]

    try:
        logger.info("启动统一推演管道 (V2)")
        result = run_pipeline(file_paths)
        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        logger.error("管道执行失败: %s", str(e))
        print("\n" + "═" * 60, file=sys.stderr, flush=True)
        print("❌ 管道执行发生崩溃 (Python Exception):", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        print("═" * 60 + "\n", file=sys.stderr, flush=True)
        print(json.dumps({
            "error": f"分析管道执行失败: {str(e)}",
            "pipeline_version": 2,
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
