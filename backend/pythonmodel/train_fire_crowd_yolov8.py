#!/usr/bin/env python3
"""Train YOLOv8 on a fire + crowd dataset defined by a YOLO data YAML."""

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
except ModuleNotFoundError as error:  # pragma: no cover - runtime dependency guard
    raise SystemExit(
        "Missing dependency: ultralytics. Install backend/pythonmodel/requirements.txt first."
    ) from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train YOLOv8 for fire and crowd classes")
    parser.add_argument("--data", required=True, help="Path to dataset YAML")
    parser.add_argument("--model", default="backend/pythonmodel/yolov8n.pt", help="Base YOLO model")
    parser.add_argument("--epochs", type=int, default=20, help="Training epochs")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=320, help="Input image size")
    parser.add_argument("--lr0", type=float, default=0.003, help="Initial learning rate")
    parser.add_argument("--patience", type=int, default=20, help="Early-stop patience")
    parser.add_argument("--workers", type=int, default=2, help="Data loader workers")
    parser.add_argument("--device", default="auto", help="auto/mps/cpu/0")
    parser.add_argument("--project", default="backend/pythonmodel/runs", help="Training output project")
    parser.add_argument("--name", default="fire_crowd_yolov8", help="Training run name")
    parser.add_argument("--cache", action="store_true", help="Enable cache")
    parser.add_argument("--cos-lr", action="store_true", help="Use cosine LR")
    parser.add_argument("--degrees", type=float, default=8.0, help="Rotation augmentation")
    parser.add_argument("--scale", type=float, default=0.25, help="Scale augmentation")
    parser.add_argument("--translate", type=float, default=0.10, help="Translate augmentation")
    parser.add_argument("--fliplr", type=float, default=0.5, help="Horizontal flip probability")
    parser.add_argument("--flipud", type=float, default=0.0, help="Vertical flip probability")
    parser.add_argument("--hsv-h", type=float, default=0.015, help="HSV hue augmentation")
    parser.add_argument("--hsv-s", type=float, default=0.7, help="HSV saturation augmentation")
    parser.add_argument("--hsv-v", type=float, default=0.4, help="HSV value augmentation")
    parser.add_argument("--summary-out", default="", help="Optional JSON path to save training summary")
    return parser.parse_args()


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


def safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def read_data_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Dataset YAML not found: {path}")

    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}

    if not isinstance(payload, dict):
        raise SystemExit("Dataset YAML must parse to an object")

    return payload


def resolve_class_names(payload: dict[str, Any]) -> list[str]:
    names = payload.get("names")
    if isinstance(names, dict):
        ordered = []
        for key in sorted(names.keys(), key=lambda item: int(item)):
            ordered.append(str(names[key]).strip())
        return ordered
    if isinstance(names, list):
        return [str(item).strip() for item in names]
    return []


def main() -> int:
    args = parse_args()
    resolved_device = resolve_device(args.device)

    data_path = Path(args.data).resolve()
    data_payload = read_data_yaml(data_path)
    class_names = resolve_class_names(data_payload)

    print("Training configuration:")
    print(
        json.dumps(
            {
                "data": str(data_path),
                "model": args.model,
                "classes": class_names,
                "epochs": args.epochs,
                "batch": args.batch,
                "imgsz": args.imgsz,
                "device": resolved_device,
            },
            indent=2,
        )
    )

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
        cache=args.cache,
        cos_lr=args.cos_lr,
        degrees=args.degrees,
        scale=args.scale,
        translate=args.translate,
        fliplr=args.fliplr,
        flipud=args.flipud,
        hsv_h=args.hsv_h,
        hsv_s=args.hsv_s,
        hsv_v=args.hsv_v,
        pretrained=True,
    )

    metrics = model.val(
        data=str(data_path),
        imgsz=args.imgsz,
        device=resolved_device,
        split="val",
        verbose=False,
    )
    box_metrics = getattr(metrics, "box", None)

    best_path = getattr(getattr(model, "trainer", None), "best", None)
    summary = {
        "best_weights": str(Path(best_path).resolve()) if best_path else None,
        "precision": round(safe_float(getattr(box_metrics, "mp", 0.0)), 6),
        "recall": round(safe_float(getattr(box_metrics, "mr", 0.0)), 6),
        "map50": round(safe_float(getattr(box_metrics, "map50", 0.0)), 6),
        "map50_95": round(safe_float(getattr(box_metrics, "map", 0.0)), 6),
    }

    print("Training and validation summary:")
    print(json.dumps(summary, indent=2))

    if args.summary_out:
        out_path = Path(args.summary_out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(f"Saved summary to {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
