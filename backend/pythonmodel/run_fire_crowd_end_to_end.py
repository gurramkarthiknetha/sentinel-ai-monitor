#!/usr/bin/env python3
"""End-to-end fire-crowd workflow: prepare, train, infer, and launch FastAPI."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run complete fire-crowd YOLO workflow")

    parser.add_argument("--output", default="backend/pythonmodel/datasets/prepared/fire_crowd_yolo")
    parser.add_argument("--yaml-out", default="backend/pythonmodel/datasets/fire_crowd.auto.yaml")
    parser.add_argument("--max-fire-images", type=int, default=0)
    parser.add_argument("--max-crowd-images", type=int, default=0)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--crowd-label-model", default="backend/pythonmodel/yolo26n.pt")

    parser.add_argument("--model", default="backend/pythonmodel/yolov8n.pt")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--lr0", type=float, default=0.003)
    parser.add_argument("--patience", type=int, default=20)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--project", default="backend/pythonmodel/runs")
    parser.add_argument("--name", default="fire_crowd_yolov8")

    parser.add_argument("--weights", default="", help="Use existing trained weights instead of training")
    parser.add_argument("--infer-source", default="", help="Optional source for post-training inference")
    parser.add_argument("--infer-conf", type=float, default=0.25)
    parser.add_argument("--infer-max-frames", type=int, default=0)

    parser.add_argument("--skip-prepare", action="store_true")
    parser.add_argument("--skip-train", action="store_true")
    parser.add_argument("--no-server", action="store_true")

    parser.add_argument("--server-host", default="0.0.0.0")
    parser.add_argument("--server-port", type=int, default=8000)

    return parser.parse_args()


def run_cmd(cmd: list[str]) -> None:
    print("$ " + " ".join(cmd))
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def resolve_best_weights(args: argparse.Namespace) -> Path:
    if args.weights:
        weight_path = Path(args.weights).resolve()
        if not weight_path.exists():
            raise SystemExit(f"Specified weights not found: {weight_path}")
        return weight_path

    expected = Path(args.project).resolve() / args.name / "weights" / "best.pt"
    if expected.exists():
        return expected

    candidates = sorted(Path(args.project).resolve().rglob("weights/best.pt"))
    if candidates:
        return candidates[-1]

    raise SystemExit("Unable to resolve best.pt. Provide --weights or run training first.")


def main() -> int:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent

    prepare_script = script_dir / "prepare_fire_crowd_dataset.py"
    train_script = script_dir / "train_fire_crowd_yolov8.py"
    infer_script = script_dir / "infer_fire_crowd.py"
    launch_script = script_dir / "launch_fire_crowd_fastapi.py"

    if not args.skip_prepare:
        run_cmd(
            [
                sys.executable,
                str(prepare_script),
                "--output",
                args.output,
                "--yaml-out",
                args.yaml_out,
                "--max-fire-images",
                str(args.max_fire_images),
                "--max-crowd-images",
                str(args.max_crowd_images),
                "--val-ratio",
                str(args.val_ratio),
                "--crowd-label-model",
                args.crowd_label_model,
            ]
        )

    if not args.skip_train and not args.weights:
        run_cmd(
            [
                sys.executable,
                str(train_script),
                "--data",
                args.yaml_out,
                "--model",
                args.model,
                "--epochs",
                str(args.epochs),
                "--batch",
                str(args.batch),
                "--imgsz",
                str(args.imgsz),
                "--lr0",
                str(args.lr0),
                "--patience",
                str(args.patience),
                "--workers",
                str(args.workers),
                "--device",
                args.device,
                "--project",
                args.project,
                "--name",
                args.name,
            ]
        )

    best_weights = resolve_best_weights(args)
    print(f"Using weights: {best_weights}")

    if args.infer_source:
        run_cmd(
            [
                sys.executable,
                str(infer_script),
                "--weights",
                str(best_weights),
                "--source",
                args.infer_source,
                "--conf",
                str(args.infer_conf),
                "--max-frames",
                str(args.infer_max_frames),
            ]
        )

    if args.no_server:
        print("Skipping FastAPI launch (--no-server).")
        return 0

    return subprocess.call(
        [
            sys.executable,
            str(launch_script),
            "--weights",
            str(best_weights),
            "--host",
            args.server_host,
            "--port",
            str(args.server_port),
        ]
    )


if __name__ == "__main__":
    raise SystemExit(main())
