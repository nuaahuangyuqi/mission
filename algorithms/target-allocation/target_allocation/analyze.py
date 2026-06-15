"""Public algorithm entrypoint."""

from __future__ import annotations

from typing import Any

from .adapters import build_candidate_targets, build_deployment_contexts, build_group_profiles
from .config import (
    METHOD_KEY,
    METHOD_LABEL,
    normalize_max_assignments,
    resolve_objective_preference,
    resolve_validation_profile,
)
from .errors import error_response
from .output_adapter import build_empty_plan, build_plan_summary, build_structured_output
from .solver import solve_intelligent_allocation
from .terrain import build_sampler
from .validation import build_adjustment_suggestions, validate_allocation_plan


def _missing_upstream(upstream: dict[str, Any] | None) -> bool:
    if not upstream:
        return True
    return upstream.get("ok") is False


def analyze(
    upstream_threat: dict[str, Any] | None,
    upstream_grouping: dict[str, Any] | None,
    objective_preference: str = "balanced",
    validation_mode: str = "strict",
    max_assignments_per_group: int = 2,
    terrain_dir: str | None = None,
) -> dict[str, Any]:
    if _missing_upstream(upstream_threat) or _missing_upstream(upstream_grouping):
        return error_response(
            "PLANNING_MISSING_UPSTREAM",
            "missing_upstream",
            "target-allocation requires enemy-threat-analysis and force-grouping outputs.",
            {
                "enemyThreatAvailable": bool(upstream_threat and upstream_threat.get("ok") is not False),
                "forceGroupingAvailable": bool(upstream_grouping and upstream_grouping.get("ok") is not False),
            },
        )

    preference = resolve_objective_preference(objective_preference)
    validation_profile = resolve_validation_profile(validation_mode)
    max_assignments = normalize_max_assignments(max_assignments_per_group)
    terrain_sampler = build_sampler(terrain_dir)
    deployment_contexts = build_deployment_contexts(upstream_threat or {})
    targets = build_candidate_targets(
        upstream_threat or {},
        validation_mode=validation_profile["key"],
        preference=preference,
        deployment_contexts=deployment_contexts,
    )
    groups, platforms = build_group_profiles(upstream_grouping or {}, max_assignments_per_group=max_assignments)

    if targets and groups:
        plan, loads, assigned_by_target = solve_intelligent_allocation(
            targets=targets,
            groups=groups,
            preference=preference,
            validation_profile=validation_profile,
            terrain_sampler=terrain_sampler,
        )
        plan = build_plan_summary(
            plan=plan,
            targets=targets,
            groups=groups,
            platforms=platforms,
            loads=loads,
            assigned_by_target=assigned_by_target,
            validation_profile=validation_profile,
            preference=preference,
        )
    else:
        plan = build_empty_plan(
            targets=targets,
            groups=groups,
            platforms=platforms,
            validation_profile=validation_profile,
            preference=preference,
        )

    validation, validation_summary = validate_allocation_plan(
        plan=plan,
        targets=targets,
        groups=groups,
        validation_profile=validation_profile,
    )
    suggestions = build_adjustment_suggestions(plan, validation, preference["key"])
    return build_structured_output(
        targets=targets,
        groups=groups,
        platforms=platforms,
        plan=plan,
        preference=preference,
        validation_profile=validation_profile,
        max_assignments_per_group=max_assignments,
        terrain_dir=terrain_dir,
        terrain_enabled=terrain_sampler is not None,
        deployment_contexts=deployment_contexts,
        validation=validation,
        validation_summary=validation_summary,
        adjustment_suggestions=suggestions,
    )


__all__ = ["analyze", "METHOD_KEY", "METHOD_LABEL"]
