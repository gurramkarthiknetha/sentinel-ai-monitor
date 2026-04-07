#!/usr/bin/env python3
"""Launch yolo_fastapi_server.py with a selected fire-crowd model checkpoint."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch FastAPI YOLO server with custom weights")
    parser.add_argument("--weights", required=True, help="Path to trained model weights")
    parser.add_argument(
        "--server-script",
        default="backend/pythonmodel/yolo_fastapi_server.py",
        help="Path to yolo_fastapi_server.py",
    )
    parser.add_argument("--host", default="0.0.0.0", help="Server bind host")
    parser.add_argument("--port", type=int, default=8000, help="Server bind port")
    parser.add_argument("--fire-class-names", default="fire,flame", help="Comma-separated fire labels")
    parser.add_argument("--smoke-class-names", default="smoke", help="Comma-separated smoke labels")
    parser.add_argument("--crowd-class-names", default="crowd,person,people", help="Comma-separated crowd labels")
    parser.add_argument(
        "--color-fallback-enabled",
        default=os.getenv("YOLO_COLOR_FALLBACK_ENABLED", "true"),
        choices=("true", "false"),
        help="Enable HSV fallback when YOLO misses fire/smoke detections on a frame",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    weights = Path(args.weights).resolve()
    if not weights.exists():
        raise SystemExit(f"Weights not found: {weights}")

    server_script = Path(args.server_script).resolve()
    if not server_script.exists():
        raise SystemExit(f"Server script not found: {server_script}")

    env = os.environ.copy()
    env["YOLO_MODEL_PATH"] = str(weights)
    env["YOLO_SERVER_HOST"] = str(args.host)
    env["YOLO_SERVER_PORT"] = str(args.port)
    env["YOLO_FIRE_CLASS_NAMES"] = args.fire_class_names
    env["YOLO_SMOKE_CLASS_NAMES"] = args.smoke_class_names
    env["YOLO_CROWD_CLASS_NAMES"] = args.crowd_class_names
    env["YOLO_COLOR_FALLBACK_ENABLED"] = args.color_fallback_enabled

    print(f"Launching FastAPI server with weights: {weights}")
    print(f"Host: {args.host}  Port: {args.port}")
    print(f"Color fallback enabled: {args.color_fallback_enabled}")

    return subprocess.call([sys.executable, str(server_script)], env=env)


if __name__ == "__main__":
    raise SystemExit(main())
