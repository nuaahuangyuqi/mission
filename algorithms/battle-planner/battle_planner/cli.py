"""Command line interface."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from battle_planner.pipeline import PlanningPipeline


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="智能任务编组与兵力优化分配算法")
    parser.add_argument("--config", required=True, help="JSON 配置文件路径")
    parser.add_argument("--enemy", required=True, nargs="+", help="敌情威胁 JSON 文件路径，可传多个")
    parser.add_argument("--friendly", required=True, nargs="+", help="己方信息文档路径，可传多个，支持 txt/md/json/docx")
    parser.add_argument("--output-dir", default="outputs", help="输出目录")
    parser.add_argument("--print-json", action="store_true", help="同时在终端打印完整 JSON 结果")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    pipeline = PlanningPipeline.from_config(args.config)
    result = pipeline.run(enemy_files=args.enemy, friendly_files=args.friendly, output_dir=args.output_dir)
    if args.print_json:
        print(json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2))
    else:
        output = Path(args.output_dir)
        print(f"已生成 {result.total_groups} 个编组，输出目录：{output.resolve()}", file=_summary_stream())


def _summary_stream():
    if _env_bool("FORCE_GROUPING_LLM_STREAM_STDOUT") or _env_bool("LLM_STREAM_STDOUT"):
        return sys.stderr
    return sys.stdout


def _env_bool(name: str) -> bool:
    return str(os.getenv(name, "")).strip().lower() in {"1", "true", "yes", "on"}


if __name__ == "__main__":
    main()
