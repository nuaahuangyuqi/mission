"""Command-line interface for intelligent force grouping."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .analyze import analyze


def main() -> None:
    parser = argparse.ArgumentParser(description="Run intelligent force grouping.")
    parser.add_argument("--files", nargs="+", required=True, help="Input force files: txt/csv/json/docx/pdf/xlsx")
    parser.add_argument("--upstream-threat", required=True, help="enemy-threat-analysis output JSON")
    parser.add_argument("--scheme-profile", default="scheme-balanced-intelligent")
    parser.add_argument("--rule-library", default="fire-strike-rules")
    parser.add_argument("--comparison-focus", default=None)
    parser.add_argument("--expected-group-count", type=int, default=4)
    parser.add_argument("--mock-extraction", help="Optional force-extraction-v1 JSON to bypass LLM")
    parser.add_argument("--no-llm-explanation", action="store_true", help="Use rule-based recommendation explanation")
    parser.add_argument("--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    upstream = json.loads(Path(args.upstream_threat).read_text(encoding="utf-8"))
    extraction = None
    if args.mock_extraction:
        extraction = json.loads(Path(args.mock_extraction).read_text(encoding="utf-8"))
    result = analyze(
        args.files,
        upstream,
        scheme_profile_key=args.scheme_profile,
        rule_library_key=args.rule_library,
        expected_group_count=args.expected_group_count,
        extraction_json=extraction,
        comparison_focus=args.comparison_focus,
        use_llm_explanation=not args.no_llm_explanation,
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(output_path))


if __name__ == "__main__":
    main()

