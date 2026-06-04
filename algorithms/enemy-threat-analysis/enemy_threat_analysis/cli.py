"""Command-line interface for enemy threat analysis."""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

from .analyze import analyze
from .image_exporter import write_base64_png


def main() -> None:
    parser = argparse.ArgumentParser(description="Run LLM-based enemy threat analysis.")
    parser.add_argument("--files", nargs="+", required=True, help="Input files: txt/csv/json/docx/pdf/xlsx")
    parser.add_argument("--analysis-focus", default="comprehensive", help="comprehensive / coverage / air-defense")
    parser.add_argument("--heatmap-density", default="medium", help="low / medium / high")
    parser.add_argument("--impact-bias", default="balanced", help="balanced / suppression / mobility")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--artifact-dir", help="Optional directory to write heatmap.png and target-map.png")
    parser.add_argument("--assessment-dir", help="Optional directory to write operational assessment DOCX")
    parser.add_argument("--skip-assessment", action="store_true", help="Skip second-stage LLM assessment DOCX")
    args = parser.parse_args()

    output_path = Path(args.output)
    artifact_dir = Path(args.artifact_dir) if args.artifact_dir else None
    assessment_dir = Path(args.assessment_dir) if args.assessment_dir else (artifact_dir or output_path.parent)
    result = analyze(
        args.files,
        analysis_focus=args.analysis_focus,
        heatmap_density=args.heatmap_density,
        impact_bias=args.impact_bias,
        generate_assessment=not args.skip_assessment,
        assessment_output_dir=assessment_dir if not args.skip_assessment else None,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if artifact_dir:
        write_base64_png(result.get("heatmapBase64", ""), artifact_dir / "heatmap.png")
        write_base64_png(result.get("targetMapBase64", ""), artifact_dir / "target-map.png")
        write_base64_png(result.get("combinedMapBase64", ""), artifact_dir / "combined-map.png")
        docx_name = result.get("assessmentDocxFileName")
        docx_base64 = result.get("assessmentDocxBase64")
        docx_path = result.get("assessmentDocxPath")
        if docx_name and docx_base64 and not docx_path:
            (artifact_dir / docx_name).write_bytes(base64.b64decode(docx_base64))
    print(str(output_path))


if __name__ == "__main__":
    main()
