import itertools
import sys
from typing import List, Tuple

from candidate_generator import Candidate
from config import AirlandingConfig, CONFIG
from threat_field import haversine_km


def progress(message: str) -> None:
    print(f"[LandingZone] {message}", file=sys.stderr, flush=True)


def spacing_ok(combo: Tuple[Candidate, ...], min_spacing_km: float) -> bool:
    for left, right in itertools.combinations(combo, 2):
        distance = haversine_km(
            left.center["lng"],
            left.center["lat"],
            right.center["lng"],
            right.center["lat"],
        )
        if distance < min_spacing_km:
            return False
    return True


def rank_candidates(candidates: List[Candidate], config: AirlandingConfig = CONFIG) -> List[Candidate]:
    threshold_counts = []

    def terrain_bucket(item: Candidate) -> int:
        for index, threshold in enumerate(config.terrain_selection_thresholds):
            if item.terrain_score >= threshold:
                return index
        return len(config.terrain_selection_thresholds)

    def surface_bucket(item: Candidate) -> int:
        if item.refined_rejected:
            return 5
        if item.urban_penalty >= 0.45:
            return 4
        if item.forest_penalty >= 0.45:
            return 3
        if item.mountain_penalty >= 0.55:
            return 2
        if item.surface_penalty >= 0.35:
            return 1
        return 0

    for threshold in config.terrain_selection_thresholds:
        threshold_counts.append(f"≥{threshold:g}:{sum(1 for item in candidates if item.terrain_score >= threshold)}")
    risk_count = sum(1 for item in candidates if item.surface_penalty >= 0.35 or item.urban_penalty >= 0.45 or item.forest_penalty >= 0.45)
    refined_rejected_count = sum(1 for item in candidates if item.refined_rejected)
    progress(f"地形/地表分层排序候选 {len(candidates)} 个 ({', '.join(threshold_counts)})，高地表风险 {risk_count} 个，精检剔除 {refined_rejected_count} 个")

    return sorted(
        candidates,
        key=lambda item: (
            item.refined_rejected,
            surface_bucket(item),
            terrain_bucket(item),
            item.surface_penalty,
            -item.refined_terrain_score,
            item.urban_penalty,
            item.forest_penalty,
            item.mountain_penalty,
            item.threat_value,
            -item.terrain_score,
            -item.nearest_threat_distance_km,
        ),
    )


def spacing_ok_with_selected(candidate: Candidate, selected: List[Candidate], min_spacing_km: float) -> bool:
    for item in selected:
        distance = haversine_km(
            candidate.center["lng"],
            candidate.center["lat"],
            item.center["lng"],
            item.center["lat"],
        )
        if distance < min_spacing_km:
            return False
    return True


def is_far_enough_from_candidates(candidate: Candidate, existing: List[Candidate], min_spacing_km: float) -> bool:
    for item in existing:
        distance = haversine_km(
            candidate.center["lng"],
            candidate.center["lat"],
            item.center["lng"],
            item.center["lat"],
        )
        if distance < min_spacing_km:
            return False
    return True


def select_one_for_landing(
    candidates: List[Candidate],
    selected: List[Candidate],
    config: AirlandingConfig = CONFIG,
) -> Tuple[Candidate, str]:
    ranked_all = rank_candidates(candidates, config)
    ranked_viable = [candidate for candidate in ranked_all if not candidate.refined_rejected]
    ranked = ranked_viable if ranked_viable else ranked_all
    if not ranked:
        return None, "没有可用候选点。"

    fallback_warning = ""
    if not ranked_viable:
        fallback_warning = "所有候选均未通过地形精检，已在极端兜底模式下允许选择 rejected 候选。"

    spacing_attempts = [
        config.min_spacing_km,
        max(config.min_spacing_km * 0.6, 1.0),
        1.0,
        0.0,
    ]
    for spacing_km in spacing_attempts:
        for candidate in ranked:
            if spacing_ok_with_selected(candidate, selected, spacing_km):
                warning = fallback_warning
                if spacing_km < config.min_spacing_km:
                    spacing_warning = f"为保证生成结果，选中点间距从 {config.min_spacing_km:g}km 放宽到 {spacing_km:g}km。"
                    warning = f"{warning} {spacing_warning}".strip()
                return candidate, warning

    warning = "未找到满足间距约束的候选点，已选择当前排序最优点。"
    if fallback_warning:
        warning = f"{fallback_warning} {warning}"
    return ranked[0], warning


def select_zones(candidates: List[Candidate], config: AirlandingConfig = CONFIG) -> Tuple[List[Candidate], List[str]]:
    warnings: List[str] = []
    if not candidates:
        return [], ["没有生成可用机降候选区域。"]
    viable_candidates = [candidate for candidate in candidates if not candidate.refined_rejected]
    if viable_candidates:
        candidates = viable_candidates
    else:
        warnings.append("所有候选均未通过地形精检，已在极端兜底模式下允许 rejected 候选进入最终选择。")

    best_combo: Tuple[Candidate, ...] = tuple()
    spacing_attempts = [
        config.min_spacing_km,
        max(config.min_spacing_km * 0.6, 1.0),
        1.0,
        0.0,
    ]

    selected_threshold = None
    selected_spacing = None
    shortlist = []
    for terrain_threshold in config.terrain_selection_thresholds:
        terrain_pool = [item for item in candidates if item.terrain_score >= terrain_threshold]
        shortlist = sorted(
            terrain_pool,
            key=lambda item: (item.threat_value, -item.terrain_score, -item.nearest_threat_distance_km),
        )
        progress(f"地形优先筛选: terrain≥{terrain_threshold:g}，候选 {len(shortlist)} 个，再按威胁值从低到高排序")
        if len(shortlist) < config.required_count:
            continue

        for spacing_km in spacing_attempts:
            selected = []
            for candidate in shortlist:
                trial = tuple(selected + [candidate])
                if not spacing_ok(trial, spacing_km):
                    continue
                selected.append(candidate)
                if len(selected) >= config.required_count:
                    break
            progress(f"地形阈值 {terrain_threshold:g}，间距阈值 {spacing_km:g}km，选出 {len(selected)} 个")
            if len(selected) >= config.required_count:
                best_combo = tuple(selected)
                selected_threshold = terrain_threshold
                selected_spacing = spacing_km
                break
        if best_combo:
            break

    if len(best_combo) < config.required_count:
        shortlist = sorted(candidates, key=lambda item: (-item.terrain_score, item.threat_value))
        best_combo = tuple(shortlist[:config.required_count])
        warnings.append(f"地形分层与间距约束下候选不足，已直接按地形优先返回 {len(best_combo)} 个机降场。")
    else:
        if selected_threshold is not None and selected_threshold < config.terrain_selection_thresholds[0]:
            warnings.append(f"为保证生成结果，地形评分阈值放宽到 {selected_threshold:g}。")
        if selected_spacing is not None and selected_spacing < config.min_spacing_km:
            warnings.append(f"为保证生成结果，最小间距从 {config.min_spacing_km:g}km 放宽到 {selected_spacing:g}km。")

    return sorted(best_combo, key=lambda item: (-item.terrain_score, item.threat_value)), warnings
