"""Terrain sampler bridge for target allocation."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any


def build_sampler(terrain_dir: str | Path | None) -> Any | None:
    if not terrain_dir:
        return None
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    try:
        from terrain_support import build_terrain_sampler
    except Exception:
        return None
    return build_terrain_sampler(terrain_dir)
