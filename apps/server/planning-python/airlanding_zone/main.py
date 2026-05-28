import json
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List

from candidate_generator import Candidate, apply_landcover_context, generate_candidates, refine_selected_polygon
from config import CONFIG, DEFAULT_LANDING_REQUIREMENTS
from optimizer import is_far_enough_from_candidates, rank_candidates, select_one_for_landing


def progress(message: str) -> None:
    print(f"[LandingZone] {message}", file=sys.stderr, flush=True)


def normalize_landing_requirements(payload: Dict[str, Any]) -> Dict[str, Any]:
    source = payload.get("landing_requirements") or DEFAULT_LANDING_REQUIREMENTS
    try:
        count = int(source.get("num", CONFIG.required_count))
    except (TypeError, ValueError):
        count = CONFIG.required_count

    requirements: Dict[str, Any] = {"num": max(count, 1)}
    default_item = DEFAULT_LANDING_REQUIREMENTS["landing_0"]
    for index in range(requirements["num"]):
        key = f"landing_{index}"
        item = source.get(key) or default_item
        try:
            area_size = float(item.get("area_size", default_item["area_size"]))
        except (TypeError, ValueError):
            area_size = float(default_item["area_size"])
        try:
            area_distance = float(item.get("area_distance", default_item["area_distance"]))
        except (TypeError, ValueError):
            area_distance = float(default_item["area_distance"])

        requirements[key] = {
            "area_size": max(area_size, 0.05),
            "area_distance": max(area_distance, 1.0),
        }
    return requirements


def prepare_group_candidates(
    candidates: List[Candidate],
    landing_id: str,
    reserved_candidates: List[Candidate],
) -> List[Candidate]:
    ranked = rank_candidates(candidates, CONFIG)
    picked: List[Candidate] = []
    used_keys = {
        (candidate.center["lng"], candidate.center["lat"])
        for candidate in reserved_candidates
    }

    for spacing_km in (CONFIG.candidate_display_spacing_km, 0.5, 0.0):
        for candidate in ranked:
            key = (candidate.center["lng"], candidate.center["lat"])
            if key in used_keys:
                continue
            if candidate in picked:
                continue
            if spacing_km > 0 and not is_far_enough_from_candidates(candidate, reserved_candidates + picked, spacing_km):
                continue
            picked.append(candidate)
            used_keys.add(key)
            if len(picked) >= CONFIG.candidates_per_landing:
                break
        if len(picked) >= CONFIG.candidates_per_landing:
            break

    for candidate_index, candidate in enumerate(picked):
        candidate.landing_id = landing_id
        candidate.candidate_id = f"候选_{landing_id}_{candidate_index}"
        candidate.zone_id = ""
        candidate.selected = False
    if len(picked) < CONFIG.candidates_per_landing:
        progress(f"{landing_id} 避免重叠后仅保留 {len(picked)} 个候选点")
    return picked


def build_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    warnings: List[str] = []
    progress("启动机降地域选择算法")
    dem_path = payload.get("dem_path") or payload.get("uploaded_dem_path")
    dem_path_obj = Path(str(dem_path)).resolve() if dem_path else None
    terrain_root = payload.get("terrain_root") or str(CONFIG.TERRAIN_ROOT)
    terrain_root_obj = Path(str(terrain_root)).resolve() if terrain_root else None
    if dem_path_obj and not dem_path_obj.exists():
        raise FileNotFoundError(f"配置的 GeoTIFF DEM 文件不存在: {dem_path_obj}")
    if not dem_path_obj and (not terrain_root_obj or not (terrain_root_obj / "layer.json").exists()):
        raise FileNotFoundError(f"离线 Cesium terrain 不可用，请检查 terrain/layer.json: {terrain_root_obj}")

    requirements = normalize_landing_requirements(payload)
    max_area_distance = max(
        float(requirements[f"landing_{index}"]["area_distance"])
        for index in range(requirements["num"])
    )
    max_dem_padding_km = max_area_distance + CONFIG.max_search_overrun_km
    payload["_dem_padding_km"] = max_dem_padding_km
    progress(f"读取机降需求: {requirements['num']} 个机降点，每点保留 {CONFIG.min_candidates_per_landing}-{CONFIG.candidates_per_landing} 个候选")
    progress(f"机降距离硬约束: 候选点必须大于对应需求距离，最大需求 {max_area_distance:g}km")
    if dem_path_obj:
        progress(f"GeoTIFF DEM 覆盖范围将按最大搜索距离和小幅余量 {max_dem_padding_km:g}km 自动校验")
    else:
        payload["terrain_root"] = str(terrain_root_obj)
        progress(f"使用系统离线 Cesium terrain 进行地形采样: {terrain_root_obj}")

    selected: List[Candidate] = []
    group_objects: List[Dict[str, Any]] = []
    all_reserved_candidates: List[Candidate] = []
    candidate_cache: Dict[str, List[Candidate]] = {}

    for index in range(requirements["num"]):
        landing_id = f"landing_{index}"
        requirement = requirements[landing_id]
        progress(
            f"开始生成 {landing_id}: 面积 {requirement['area_size']:g}km²，搜索距离 {requirement['area_distance']:g}km"
        )
        cache_key = f"{requirement['area_size']:.4f}:{requirement['area_distance']:.2f}"
        if cache_key not in candidate_cache:
            candidates, candidate_warnings = generate_candidates(
                payload,
                CONFIG,
                padding_km=requirement["area_distance"],
                area_size_sqkm=requirement["area_size"],
                landing_id=landing_id,
                target_count=CONFIG.candidates_per_landing * requirements["num"],
            )
            candidate_cache[cache_key] = candidates
            warnings.extend(candidate_warnings)
        else:
            progress(f"{landing_id} 复用同面积/同距离的高密度候选池，避免重复 DEM 请求")
        candidates = deepcopy(candidate_cache[cache_key])

        group_candidates = prepare_group_candidates(candidates, landing_id, all_reserved_candidates)
        all_reserved_candidates.extend(group_candidates)
        if len(group_candidates) < CONFIG.min_candidates_per_landing:
            warnings.append(
                f"{landing_id} 候选点不足 {CONFIG.min_candidates_per_landing} 个，当前仅 {len(group_candidates)} 个。"
            )
        group_objects.append({
            "landing_id": landing_id,
            "requirement": requirement,
            "candidates": group_candidates,
        })

    all_candidate_objects = [candidate for group in group_objects for candidate in group["candidates"]]
    warnings.extend(apply_landcover_context(all_candidate_objects, CONFIG))

    groups: List[Dict[str, Any]] = []
    all_candidate_dicts: List[Dict[str, Any]] = []
    for index, group in enumerate(group_objects):
        landing_id = group["landing_id"]
        group_candidates = group["candidates"]
        chosen, optimizer_warning = select_one_for_landing(group_candidates, selected, CONFIG)
        selected_dict = None
        if chosen:
            chosen.selected = True
            chosen.zone_id = f"LZ-{index + 1:02d}"
            refine_warning = refine_selected_polygon(chosen, payload, CONFIG)
            if refine_warning:
                warnings.append(refine_warning)
            selected.append(chosen)
            selected_dict = chosen.to_dict()
            progress(
                f"{landing_id} 选中 {chosen.candidate_id}: 威胁值 {chosen.threat_value}, "
                f"地形 {chosen.terrain_score}, 地表风险 {chosen.surface_penalty}"
            )
        else:
            warnings.append(f"{landing_id} 没有生成可用候选区域。")
        if optimizer_warning:
            warnings.append(f"{landing_id}: {optimizer_warning}")

        candidate_dicts = [candidate.to_dict() for candidate in group_candidates]
        all_candidate_dicts.extend(candidate_dicts)
        groups.append({
            "landing_id": landing_id,
            "requirement": group["requirement"],
            "selected": selected_dict,
            "candidates": candidate_dicts,
        })

    progress(f"组合优化完成: 输出 {len(selected)} 个机降场，候选点 {len(all_candidate_dicts)} 个")

    zones = [candidate.to_dict() for candidate in selected]

    return {
        "source_report_id": payload.get("report_id"),
        "config": {
            "required_count": requirements["num"],
            "min_spacing_km": CONFIG.min_spacing_km,
            "candidate_multiplier": CONFIG.candidate_multiplier,
            "candidates_per_landing": CONFIG.candidates_per_landing,
            "max_grid_points": CONFIG.max_grid_points,
        },
        "landing_requirements": requirements,
        "dem_source": {
            "provider": CONFIG.DEM_PROVIDER,
            "dataset": CONFIG.DEM_TYPE,
            "filename": payload.get("dem_filename") or (dem_path_obj.name if dem_path_obj else terrain_root_obj.name),
            "terrain_root": str(terrain_root_obj) if terrain_root_obj else "",
        },
        "candidate_count": len(all_candidate_dicts),
        "candidates": all_candidate_dicts,
        "landing_groups": groups,
        "zones": zones,
        "warnings": warnings,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "未提供机降区域输入 JSON 路径"}, ensure_ascii=False))
        sys.exit(1)

    input_path = Path(sys.argv[1])
    if not input_path.exists():
        print(json.dumps({"error": f"输入文件不存在: {input_path}"}, ensure_ascii=False))
        sys.exit(1)

    try:
        payload = json.loads(input_path.read_text(encoding="utf-8"))
        response = build_response(payload)
        print(json.dumps(response, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": f"机降区域选择失败: {exc}"}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
