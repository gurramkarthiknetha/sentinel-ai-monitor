#!/usr/bin/env python3
"""Fine-tune YOLOv8 for fire/smoke object detection.

Usage example:
python backend/pythonmodel/train_fire_detector.py \
  --data backend/pythonmodel/datasets/fire_only.example.yaml \
  --model yolov8n.pt \
  --epochs 100 --batch 16 --imgsz 640
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import yaml

try:
    import torch
except ModuleNotFoundError:
    torch = None

try:
    from ultralytics import YOLO
except ModuleNotFoundError as error:
    raise SystemExit(
        "Missing dependency: ultralytics. Install backend/pythonmodel/requirements.txt first."
    ) from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a YOLOv8 fire detection model")
    parser.add_argument("--data", required=True, help="Path to dataset YAML")
    parser.add_argument("--model", default="yolov8n.pt", help="Base YOLO model checkpoint")
    parser.add_argument("--epochs", type=int, default=100, help="Training epochs")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=640, help="Input image size")
    parser.add_argument("--lr0", type=float, default=0.003, help="Initial learning rate")
    parser.add_argument("--patience", type=int, default=30, help="Early-stop patience")
    parser.add_argument("--workers", type=int, default=4, help="Data loader workers")
    parser.add_argument("--device", default="auto", help="Device: auto/cpu/mps/0")
    parser.add_argument("--project", default="backend/pythonmodel/runs", help="Output project directory")
    parser.add_argument("--name", default="fire_detector", help="Run name")
    parser.add_argument("--optimizer", default="auto", help="Optimizer")
    parser.add_argument("--cache", action="store_true", help="Cache images for faster training")
    parser.add_argument("--cos-lr", action="store_true", help="Use cosine learning rate schedule")
    return parser.parse_args()


def read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Dataset YAML not found: {path}")

    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}

    if not isinstance(payload, dict):
        raise SystemExit("Dataset YAML must parse to an object")

    return payload


def class_names_from_config(dataset_yaml: dict[str, Any]) -> list[str]:
    names = dataset_yaml.get("names")

    if isinstance(names, dict):
        ordered = []
        for key in sorted(names.keys(), key=lambda item: int(item)):
            ordered.append(str(names[key]).strip())
        return ordered

    if isinstance(names, list):
        return [str(value).strip() for value in names]

    raise SystemExit("Dataset YAML must include 'names' as list or dict")


def validate_dataset(dataset_yaml: dict[str, Any]) -> list[str]:
    class_names = class_names_from_config(dataset_yaml)
    normalized = [name.lower().replace("_", " ").strip() for name in class_names]

    if "fire" not in normalized:
        raise SystemExit("Dataset classes must include 'fire' for fire detection training")

    nc = dataset_yaml.get("nc")
    if isinstance(nc, int) and nc != len(class_names):
        raise SystemExit(f"Dataset YAML mismatch: nc={nc} but names has {len(class_names)} entries")

    for required_key in ("train", "val"):
        if required_key not in dataset_yaml:
            raise SystemExit(f"Dataset YAML must include '{required_key}'")

    return class_names


def resolve_device(requested_device: str) -> str:
    normalized = str(requested_device or "").strip().lower() or "auto"
    if normalized != "auto":
        return requested_device

    if torch is not None:
        if getattr(getattr(torch, "backends", None), "mps", None) is not None:
            if torch.backends.mps.is_available():
                return "mps"
        if torch.cuda.is_available():
            return "0"

    return "cpu"


def main() -> int:
    args = parse_args()
    resolved_device = resolve_device(args.device)

    data_path = Path(args.data).resolve()
    dataset_yaml = read_yaml(data_path)
    class_names = validate_dataset(dataset_yaml)

    print("Training configuration:")
    print(json.dumps({
        "data": str(data_path),
        "model": args.model,
        "classes": class_names,
        "epochs": args.epochs,
        "batch": args.batch,
        "imgsz": args.imgsz,
        "lr0": args.lr0,
        "device": resolved_device,
    }, indent=2))

    model = YOLO(args.model)

    model.train(
        data=str(data_path),
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        lr0=args.lr0,
        patience=args.patience,
        workers=args.workers,
        device=resolved_device,
        project=args.project,
        name=args.name,
        optimizer=args.optimizer,
        cache=args.cache,
        cos_lr=args.cos_lr,
        pretrained=True,
    )

    best_path = getattr(getattr(model, "trainer", None), "best", None)
    if best_path:
        best_weights = Path(best_path)
        print(f"Best weights: {best_weights}")
        print(f"Set YOLO_MODEL_PATH={best_weights}")
    else:
        print("Training finished, but best checkpoint path was not returned by trainer.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
