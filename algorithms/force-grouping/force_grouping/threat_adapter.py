"""Adapt enemy-threat-analysis output for force grouping."""

from __future__ import annotations

from typing import Any

from .schemas import ThreatContext
from .utils import clamp_score


def _pressure(items: list[dict[str, Any]], score_keys: tuple[str, ...]) -> float:
    scores = []
    for item in items:
        for key in score_keys:
            if isinstance(item, dict) and item.get(key) is not None:
                try:
                    scores.append(float(item[key]))
                    break
                except (TypeError, ValueError):
                    continue
    if not scores:
        return 0.0
    return clamp_score(max(scores) * 0.55 + (sum(scores) / len(scores)) * 0.45)


def adapt_threat_context(upstream_threat: dict[str, Any] | None) -> ThreatContext | None:
    if not upstream_threat:
        return None
    if upstream_threat.get("ok") is False:
        return None
    fire = list(upstream_threat.get("fireCoverage") or [])
    air = list(upstream_threat.get("airDefenseSystem") or [])
    recon = list(upstream_threat.get("reconEarlyWarning") or [])
    anti = list(upstream_threat.get("antiAirborneFacilities") or [])
    targets = list(upstream_threat.get("targetAssessments") or [])
    score_breakdown = upstream_threat.get("scoreBreakdown") or {}
    dominant = {
        "fireCoverage": clamp_score(score_breakdown.get("firePressure") or _pressure(fire, ("threatScore", "score", "coverageScore"))),
        "airDefense": clamp_score(score_breakdown.get("airDefensePressure") or _pressure(air, ("threatScore", "score"))),
        "recon": clamp_score(score_breakdown.get("reconPressure") or _pressure(recon, ("threatScore", "score"))),
        "antiAirborne": clamp_score(_pressure(anti, ("threatScore", "score"))),
    }
    return ThreatContext(
        threatScore=clamp_score(upstream_threat.get("threatScore", 0)),
        threatLevel=str(upstream_threat.get("threatLevel") or "低"),
        dominantThreats=dominant,
        enemyIntentions=list(upstream_threat.get("enemyIntentions") or []),
        threatNodes=targets,
        fireCoverage=fire,
        airDefenseSystem=air,
        reconEarlyWarning=recon,
        antiAirborneFacilities=anti,
    )

