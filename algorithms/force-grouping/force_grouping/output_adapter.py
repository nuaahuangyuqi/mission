"""Build platform-compatible structured output."""

from __future__ import annotations

from typing import Any

from .llm_extractor import explain_recommendation_with_llm
from .rule_profile import CONSTRAINT_MODEL, RULE_LIBRARIES
from .schemas import ForceExtractionJson, ForceUnit, SchemeProfile, ThreatContext


def choose_preferred_scheme(schemes: list[dict[str, Any]], scheme_profile: SchemeProfile) -> dict[str, Any]:
    non_failed = [scheme for scheme in schemes if scheme["constraintEvaluation"]["overallStatus"] != "fail"]
    candidates = non_failed or schemes

    def recommendation_score(scheme: dict[str, Any]) -> float:
        metrics = scheme["metrics"]
        constraint_score = scheme["constraintEvaluation"]["score"]
        profile_bonus = 0.0
        if scheme_profile.key == "scheme-firepower-priority":
            profile_bonus = metrics["firepower"] * 0.08
        elif scheme_profile.key == "scheme-survivability-priority":
            profile_bonus = (metrics["protection"] + metrics["mobility"] + metrics["balance"]) * 0.03
        else:
            profile_bonus = metrics["balance"] * 0.06
        return scheme["score"] * 0.72 + constraint_score * 0.18 + profile_bonus

    return max(candidates, key=recommendation_score)


def build_comparison(schemes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for scheme in schemes:
        metrics = scheme["metrics"]
        rows.append(
            {
                "methodKey": scheme["methodKey"],
                "methodLabel": scheme["methodLabel"],
                "score": scheme["score"],
                "actualGroupCount": scheme["actualGroupCount"],
                "firepower": metrics["firepower"],
                "protection": metrics["protection"],
                "reconCoverage": metrics["reconCoverage"],
                "endurance": metrics["endurance"],
                "mobility": metrics["mobility"],
                "balance": metrics["balance"],
                "constraintScore": scheme["constraintEvaluation"]["score"],
                "summary": _comparison_summary(scheme),
            }
        )
    return rows


def _comparison_summary(scheme: dict[str, Any]) -> str:
    metrics = scheme["metrics"]
    strengths = sorted(
        [
            ("火力", metrics["firepower"]),
            ("防护", metrics["protection"]),
            ("侦察", metrics["reconCoverage"]),
            ("保障", metrics["endurance"]),
            ("行进速度", metrics["mobility"]),
            ("均衡", metrics["balance"]),
        ],
        key=lambda item: item[1],
        reverse=True,
    )
    status = scheme["constraintEvaluation"]["overallStatus"]
    return f"{scheme['methodLabel']}以{strengths[0][0]}和{strengths[1][0]}表现较突出，约束状态为 {status}。"


def build_recommendation_explanation(
    preferred: dict[str, Any],
    system_best: dict[str, Any],
    schemes: list[dict[str, Any]],
    scheme_profile: SchemeProfile,
    threat: ThreatContext,
    llm_config: dict[str, Any] | None = None,
    use_llm: bool = True,
) -> list[str]:
    base = [
        f"本次先选择“{scheme_profile.label}”，算法仅在该倾向下生成并比较 {len(schemes)} 套候选编组方案。",
        f"最推荐方案为“{preferred['methodLabel']}”，综合得分 {preferred['score']}，约束状态为 {preferred['constraintEvaluation']['overallStatus']}。",
    ]
    if preferred["id"] != system_best["id"]:
        base.append(
            f"纯总分最高方案为“{system_best['methodLabel']}”，但推荐逻辑同时考虑约束风险、威胁适配和所选倾向，因此推荐方案不同。"
        )
    else:
        base.append("该方案同时也是当前候选集合中的系统最高分方案。")
    if threat.threatScore >= 75:
        base.append("上游敌情威胁等级较高，推荐时提高了约束满足、防护机动和分散稳健性的影响。")
    base.extend(preferred.get("advantages", [])[:2])
    if use_llm:
        try:
            llm_explanation = explain_recommendation_with_llm(
                {
                    "schemeProfile": scheme_profile.model_dump(),
                    "preferredScheme": {
                        "id": preferred["id"],
                        "methodLabel": preferred["methodLabel"],
                        "score": preferred["score"],
                        "metrics": preferred["metrics"],
                        "constraintEvaluation": preferred["constraintEvaluation"],
                        "advantages": preferred.get("advantages", []),
                        "tradeoffs": preferred.get("tradeoffs", []),
                    },
                    "systemBestSchemeId": system_best["id"],
                    "threat": threat.model_dump(),
                },
                llm_config,
            )
            if llm_explanation:
                return llm_explanation
        except Exception:
            return base
    return base


def build_structured_output(
    *,
    extraction: ForceExtractionJson,
    force_pool: list[ForceUnit],
    imported_files: list[dict[str, Any]],
    evidence_trace: list[dict[str, Any]],
    rule_profile: dict[str, Any],
    scheme_profile: SchemeProfile,
    schemes: list[dict[str, Any]],
    preferred: dict[str, Any],
    threat: ThreatContext,
    applied_options: dict[str, Any],
    llm_config: dict[str, Any] | None = None,
    use_llm_explanation: bool = True,
) -> dict[str, Any]:
    rule_library = RULE_LIBRARIES.get(applied_options["ruleLibraryKey"]) or RULE_LIBRARIES["fire-strike-rules"]
    comparison = build_comparison(schemes)
    system_best = max(schemes, key=lambda scheme: scheme["score"])
    explanation = build_recommendation_explanation(
        preferred,
        system_best,
        schemes,
        scheme_profile,
        threat,
        llm_config=llm_config,
        use_llm=use_llm_explanation,
    )
    return {
        "ok": True,
        "implementationStatus": "implemented",
        "builtinMethodKey": "intelligent-grouping",
        "builtinMethodLabel": "智能编组算法",
        "ruleLibrary": {
            "key": rule_library["key"],
            "label": rule_library["label"],
            "description": rule_library["description"],
        },
        "constraintModel": dict(CONSTRAINT_MODEL),
        "appliedOptions": applied_options,
        "inputSummary": {
            "selectedSourceCount": 0,
            "uploadedFileCount": len(imported_files),
            "blueIntelligenceCount": len(force_pool),
            "documentCandidateCount": len(extraction.forceUnits),
            "forceUnitCount": len(force_pool),
            "evidenceEntryCount": len(evidence_trace),
            "upstreamThreatAvailable": True,
        },
        "selectedSources": [],
        "importedFiles": imported_files,
        "evidenceTrace": evidence_trace[:80],
        "resolvedRuleProfile": rule_profile,
        "constraintSummary": preferred["constraintEvaluation"],
        "ruleEvidence": _build_rule_evidence(threat, evidence_trace),
        "schemes": schemes,
        "comparison": comparison,
        "preferredSchemeId": preferred["id"],
        "preferredScheme": preferred,
        "systemBestSchemeId": system_best["id"],
        "explanation": explanation,
    }


def _build_rule_evidence(threat: ThreatContext, evidence_trace: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    if threat.threatScore:
        items.append(
            {
                "id": "rule-ev-threat",
                "type": "upstream-threat",
                "summary": f"上游敌情威胁分 {threat.threatScore}，威胁等级 {threat.threatLevel}。",
            }
        )
    for evidence in evidence_trace[:8]:
        items.append(
            {
                "id": f"rule-ev-{len(items) + 1}",
                "type": "force-evidence",
                "summary": evidence.get("text") or evidence.get("unitName") or "",
                "source": evidence.get("source", ""),
            }
        )
    return items
