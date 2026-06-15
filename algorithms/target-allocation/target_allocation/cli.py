"""Command-line interface for intelligent target allocation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .analyze import analyze
from .visualization import render_allocation_map


def main() -> None:
    parser = argparse.ArgumentParser(description="Run intelligent target allocation.")
    parser.add_argument("--upstream-threat", required=True, help="enemy-threat-analysis output JSON")
    parser.add_argument("--upstream-grouping", required=True, help="force-grouping output JSON")
    parser.add_argument("--objective-preference", default="balanced", choices=["balanced", "firepower-first", "survivability-first"])
    parser.add_argument("--validation-mode", default="strict", choices=["strict", "standard"])
    parser.add_argument("--max-assignments-per-group", type=int, default=2)
    parser.add_argument("--terrain-dir", help="Optional Cesium quantized-mesh terrain directory")
    parser.add_argument("--plot-output", help="Optional SVG path for a lon/lat allocation arrow map")
    parser.add_argument("--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    upstream_threat = json.loads(Path(args.upstream_threat).read_text(encoding="utf-8"))
    upstream_grouping = json.loads(Path(args.upstream_grouping).read_text(encoding="utf-8"))
    result = analyze(
        upstream_threat,
        upstream_grouping,
        objective_preference=args.objective_preference,
        validation_mode=args.validation_mode,
        max_assignments_per_group=args.max_assignments_per_group,
        terrain_dir=args.terrain_dir,
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.plot_output:
        render_allocation_map(result, args.plot_output, terrain_dir=args.terrain_dir)
    print(str(output_path))


if __name__ == "__main__":
    main()
