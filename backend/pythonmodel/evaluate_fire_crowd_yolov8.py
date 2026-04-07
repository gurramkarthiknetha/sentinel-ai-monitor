#!/usr/bin/env python3
"""Evaluate a trained YOLOv8 fire-crowd detector on a validation split."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

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
    parser = argparse.ArgumentParser(description="Evaluate YOLOv8 fire-crowd model")
    parser.add_argument("--weights", required=True, help="Path to trained weights (best.pt)")
    parser.add_argument("--data", required=True, help="Path to YOLO data YAML")
    parser.add_argument("--imgsz", type=int, default=640, help="Validation image size")
    parser.add_argument("--batch", type=int, default=16, help="Validation batch size")
    parser.add_argument("--device", default="auto", help="auto/mps/cpu/0")
    parser.add_argument("--split", default="val", help="Dataset split: val/test")
    parser.add_argument("--summary-out", default="", help="Optional JSON path for evaluation summary")
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


def main() -> int:
    args = parse_args()
    resolved_device = resolve_device(args.device)

    weights = Path(args.weights).resolve()
    data_yaml = Path(args.data).resolve()

    if not weights.exists():
        raise SystemExit(f"Weights not found: {weights}")
    if not data_yaml.exists():
        raise SystemExit(f"Data YAML not found: {data_yaml}")

    model = YOLO(str(weights))
    metrics = model.val(
        data=str(data_yaml),
        imgsz=args.imgsz,
        batch=args.batch,
        device=resolved_device,
        split=args.split,
        verbose=False,
    )

    box_metrics = getattr(metrics, "box", None)
    names = model.names if isinstance(model.names, dict) else {}
    maps = list(getattr(box_metrics, "maps", []) or [])

    per_class_map50_95 = {}
    for class_id, class_name in names.items():
        index = int(class_id)
        per_class_map50_95[str(class_name)] = round(safe_float(maps[index] if index < len(maps) else 0.0), 6)

    summary = {
        "weights": str(weights),
        "data": str(data_yaml),
        "split": args.split,
        "precision": round(safe_float(getattr(box_metrics, "mp", 0.0)), 6),
        "recall": round(safe_float(getattr(box_metrics, "mr", 0.0)), 6),
        "map50": round(safe_float(getattr(box_metrics, "map50", 0.0)), 6),
        "map50_95": round(safe_float(getattr(box_metrics, "map", 0.0)), 6),
        "per_class_map50_95": per_class_map50_95,
    }

    print("Evaluation summary:")
    print(json.dumps(summary, indent=2))

    if args.summary_out:
        out_path = Path(args.summary_out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(f"Saved evaluation summary to {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
