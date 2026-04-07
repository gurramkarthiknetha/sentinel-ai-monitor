#!/usr/bin/env python3
"""Prepare fire + crowd YOLO dataset without training."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    pipeline_script = script_dir / "train_fire_crowd_pipeline.py"

    cmd = [
        sys.executable,
        str(pipeline_script),
        "--skip-train",
        *sys.argv[1:],
    ]
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
