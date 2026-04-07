#!/usr/bin/env python3
"""Build and train a YOLOv8 fire + crowd detection pipeline.

Pipeline steps:
1. Download datasets with kagglehub.
2. Convert fire dataset to YOLO detection labels.
3. Pseudo-label crowd/person boxes with a pretrained YOLO model.
4. Train YOLOv8 on the combined dataset.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import shutil
from pathlib import Path
from typing import Any

import cv2
import yaml

try:
    import kagglehub
except ModuleNotFoundError as error:  # pragma: no cover - runtime dependency guard
    raise SystemExit(
        "Missing dependency: kagglehub. Install backend/pythonmodel/requirements.txt first."
    ) from error

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


FIRE_DATASET_REF = "atulyakumar98/test-dataset"
CROWD_DATASET_REF = "unidpro/crowd-counting-dataset"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

POSITIVE_HINTS = {
    "1",
    "fire",
    "flame",
    "positive",
    "yes",
    "true",
}
NEGATIVE_HINTS = {
    "0",
    "nofire",
    "no_fire",
    "no-fire",
    "nonfire",
    "negative",
    "false",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train YOLOv8 for fire and crowd detection")
    parser.add_argument(
        "--output",
        default="backend/pythonmodel/datasets/prepared/fire_crowd_yolo",
        help="Output YOLO dataset root",
    )
    parser.add_argument(
        "--yaml-out",
        default="backend/pythonmodel/datasets/fire_crowd.auto.yaml",
        help="Output dataset YAML path",
    )
    parser.add_argument(
        "--crowd-label-model",
        default="backend/pythonmodel/yolo26n.pt",
        help="Pretrained model used to pseudo-label person boxes in crowd images",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed for split/shuffle")
    parser.add_argument("--val-ratio", type=float, default=0.2, help="Validation split ratio")
    parser.add_argument(
        "--max-fire-images",
        type=int,
        default=0,
        help="Limit fire images (0 means all)",
    )
    parser.add_argument(
        "--max-crowd-images",
        type=int,
        default=0,
        help="Limit crowd images (0 means all)",
    )
    parser.add_argument(
        "--crowd-person-conf",
        type=float,
        default=0.25,
        help="Person confidence threshold for crowd pseudo-labeling",
    )
    parser.add_argument(
        "--crowd-person-iou",
        type=float,
        default=0.45,
        help="IOU threshold for crowd pseudo-labeling",
    )
    parser.add_argument(
        "--crowd-label-imgsz",
        type=int,
        default=640,
        help="Inference image size for crowd pseudo-labeling",
    )
    parser.add_argument("--skip-train", action="store_true", help="Prepare dataset only")

    parser.add_argument("--model", default="backend/pythonmodel/yolov8n.pt", help="YOLO base model")
    parser.add_argument("--epochs", type=int, default=20, help="Training epochs")
    parser.add_argument("--batch", type=int, default=16, help="Training batch size")
    parser.add_argument("--imgsz", type=int, default=320, help="Training image size")
    parser.add_argument("--lr0", type=float, default=0.003, help="Initial learning rate")
    parser.add_argument("--patience", type=int, default=20, help="Early-stop patience")
    parser.add_argument("--workers", type=int, default=2, help="Dataloader workers")
    parser.add_argument("--device", default="auto", help="auto/mps/cpu/0")
    parser.add_argument(
        "--project",
        default="backend/pythonmodel/runs",
        help="YOLO training output project folder",
    )
    parser.add_argument("--name", default="fire_crowd_yolov8n", help="YOLO training run name")
    parser.add_argument("--cache", action="store_true", help="Enable YOLO cache option")
    parser.add_argument("--cos-lr", action="store_true", help="Enable cosine LR schedule")
    parser.add_argument("--degrees", type=float, default=8.0, help="Rotation augmentation (degrees)")
    parser.add_argument("--scale", type=float, default=0.25, help="Scale augmentation")
    parser.add_argument("--translate", type=float, default=0.10, help="Translate augmentation")
    parser.add_argument("--fliplr", type=float, default=0.5, help="Horizontal flip probability")
    parser.add_argument("--flipud", type=float, default=0.0, help="Vertical flip probability")
    parser.add_argument("--hsv-h", type=float, default=0.015, help="HSV hue augmentation")
    parser.add_argument("--hsv-s", type=float, default=0.7, help="HSV saturation augmentation")
    parser.add_argument("--hsv-v", type=float, default=0.4, help="HSV value augmentation")

    return parser.parse_args()


def list_images(root: Path) -> list[Path]:
    if not root.exists() or not root.is_dir():
        return []

    images = [path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES]
    images.sort()
    return images


def is_readable_image(path: Path) -> bool:
    try:
        image = cv2.imread(str(path))
    except Exception:
        return False

    return image is not None


def filter_valid_images(images: list[Path]) -> tuple[list[Path], int]:
    valid: list[Path] = []
    invalid_count = 0

    for image_path in images:
        if is_readable_image(image_path):
            valid.append(image_path)
        else:
            invalid_count += 1

    return valid, invalid_count


def limit_samples(items: list[Path], max_items: int, rng: random.Random) -> list[Path]:
    if max_items <= 0 or len(items) <= max_items:
        return items

    sampled = items.copy()
    rng.shuffle(sampled)
    sampled = sampled[:max_items]
    sampled.sort()
    return sampled


def split_train_val(items: list[Path], val_ratio: float, rng: random.Random) -> tuple[list[Path], list[Path]]:
    if not items:
        return [], []

    if len(items) == 1:
        return items, []

    shuffled = items.copy()
    rng.shuffle(shuffled)

    bounded_ratio = min(max(val_ratio, 0.05), 0.5)
    val_count = max(1, int(round(len(shuffled) * bounded_ratio)))
    val_count = min(val_count, len(shuffled) - 1)

    val_items = shuffled[:val_count]
    train_items = shuffled[val_count:]

    train_items.sort()
    val_items.sort()
    return train_items, val_items


def read_fire_labels_from_csv(root: Path) -> dict[str, int]:
    label_map: dict[str, int] = {}

    csv_files = sorted(root.rglob("*.csv"))
    for csv_path in csv_files:
        try:
            with csv_path.open("r", encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle)
                if not reader.fieldnames:
                    continue

                lower_fields = {name.lower().strip(): name for name in reader.fieldnames}
                file_field = next(
                    (
                        lower_fields[key]
                        for key in ("file", "filename", "image", "image_name", "path", "filepath")
                        if key in lower_fields
                    ),
                    None,
                )
                label_field = next(
                    (
                        lower_fields[key]
                        for key in ("label", "target", "class", "fire", "is_fire")
                        if key in lower_fields
                    ),
                    None,
                )

                if not file_field or not label_field:
                    continue

                for row in reader:
                    raw_file = str(row.get(file_field, "") or "").strip()
                    raw_label = str(row.get(label_field, "") or "").strip().lower()

                    if not raw_file or not raw_label:
                        continue

                    if raw_label in POSITIVE_HINTS:
                        value = 1
                    elif raw_label in NEGATIVE_HINTS:
                        value = 0
                    else:
                        try:
                            numeric = int(float(raw_label))
                        except ValueError:
                            continue

                        value = 1 if numeric == 1 else 0

                    path_name = Path(raw_file).name
                    stem = Path(raw_file).stem
                    label_map[path_name.lower()] = value
                    label_map[stem.lower()] = value
        except OSError:
            continue

    return label_map


def infer_fire_label(image_path: Path, fire_root: Path, csv_labels: dict[str, int]) -> int | None:
    file_name_key = image_path.name.lower()
    stem_key = image_path.stem.lower()

    if file_name_key in csv_labels:
        return csv_labels[file_name_key]
    if stem_key in csv_labels:
        return csv_labels[stem_key]

    relative_parts = [part.lower().strip() for part in image_path.relative_to(fire_root).parts]
    for part in reversed(relative_parts):
        compact = part.replace(" ", "").replace("_", "").replace("-", "")
        if compact in POSITIVE_HINTS:
            return 1
        if compact in NEGATIVE_HINTS:
            return 0

    base_name = image_path.stem.lower().replace(" ", "")
    if any(token in base_name for token in ("fire", "flame")):
        return 1
    if any(token in base_name for token in ("nofire", "nonfire", "negative")):
        return 0

    return None


def clean_output_root(output_root: Path) -> None:
    if output_root.exists():
        shutil.rmtree(output_root)

    for subset in ("train", "val"):
        (output_root / "images" / subset).mkdir(parents=True, exist_ok=True)
        (output_root / "labels" / subset).mkdir(parents=True, exist_ok=True)


def write_label_file(label_path: Path, rows: list[str]) -> None:
    label_path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(rows)
    if content:
        content += "\n"
    label_path.write_text(content, encoding="utf-8")


def copy_fire_samples(
    images: list[Path],
    subset: str,
    fire_root: Path,
    output_root: Path,
    csv_labels: dict[str, int],
) -> dict[str, int]:
    copied = 0
    positives = 0
    negatives = 0
    skipped = 0

    for index, image_path in enumerate(images, start=1):
        label = infer_fire_label(image_path, fire_root, csv_labels)
        if label is None:
            skipped += 1
            continue

        file_stem = f"fire_{subset}_{index:06d}"
        dst_image = output_root / "images" / subset / f"{file_stem}{image_path.suffix.lower()}"
        dst_label = output_root / "labels" / subset / f"{file_stem}.txt"

        shutil.copy2(image_path, dst_image)

        if label == 1:
            write_label_file(dst_label, ["0 0.500000 0.500000 1.000000 1.000000"])
            positives += 1
        else:
            write_label_file(dst_label, [])
            negatives += 1

        copied += 1

    return {
        "copied": copied,
        "positives": positives,
        "negatives": negatives,
        "skipped": skipped,
    }


def pseudo_label_person_rows(result: Any) -> list[str]:
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return []

    xywhn = boxes.xywhn
    if xywhn is None:
        return []

    rows: list[str] = []
    for index in range(len(xywhn)):
        x, y, w, h = [float(value) for value in xywhn[index].tolist()]
        if w <= 0 or h <= 0:
            continue

        rows.append(f"1 {x:.6f} {y:.6f} {w:.6f} {h:.6f}")

    return rows


def copy_crowd_samples(
    images: list[Path],
    subset: str,
    output_root: Path,
    person_model: YOLO,
    conf: float,
    iou: float,
    imgsz: int,
) -> dict[str, int]:
    copied = 0
    with_person = 0

    for index, image_path in enumerate(images, start=1):
        result = person_model.predict(
            source=str(image_path),
            conf=conf,
            iou=iou,
            classes=[0],
            imgsz=imgsz,
            verbose=False,
        )[0]

        label_rows = pseudo_label_person_rows(result)
        if label_rows:
            with_person += 1

        file_stem = f"crowd_{subset}_{index:06d}"
        dst_image = output_root / "images" / subset / f"{file_stem}{image_path.suffix.lower()}"
        dst_label = output_root / "labels" / subset / f"{file_stem}.txt"

        shutil.copy2(image_path, dst_image)
        write_label_file(dst_label, label_rows)

        copied += 1

    return {
        "copied": copied,
        "with_person": with_person,
        "without_person": copied - with_person,
    }


def write_dataset_yaml(dataset_root: Path, yaml_out: Path) -> None:
    yaml_out.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "path": str(dataset_root.resolve()),
        "train": "images/train",
        "val": "images/val",
        "nc": 2,
        "names": ["fire", "crowd"],
    }

    with yaml_out.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(payload, handle, sort_keys=False)


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


def safe_metric(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0

    return parsed


def train_model(args: argparse.Namespace, data_yaml_path: Path) -> tuple[str | None, dict[str, float]]:
    resolved_device = resolve_device(args.device)

    model = YOLO(args.model)
    model.train(
        data=str(data_yaml_path),
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
        data=str(data_yaml_path),
        imgsz=args.imgsz,
        device=resolved_device,
        split="val",
        verbose=False,
    )

    box_metrics = getattr(metrics, "box", None)
    metric_summary = {
        "precision": round(safe_metric(getattr(box_metrics, "mp", 0.0)), 6),
        "recall": round(safe_metric(getattr(box_metrics, "mr", 0.0)), 6),
        "map50": round(safe_metric(getattr(box_metrics, "map50", 0.0)), 6),
        "map50_95": round(safe_metric(getattr(box_metrics, "map", 0.0)), 6),
    }

    best_path = getattr(getattr(model, "trainer", None), "best", None)
    if not best_path:
        return None, metric_summary

    return str(Path(best_path).resolve()), metric_summary


def main() -> int:
    args = parse_args()
    rng = random.Random(args.seed)

    output_root = Path(args.output).resolve()
    yaml_out = Path(args.yaml_out).resolve()

    print("Downloading datasets with kagglehub...")
    fire_path = Path(kagglehub.dataset_download(FIRE_DATASET_REF)).resolve()
    crowd_path = Path(kagglehub.dataset_download(CROWD_DATASET_REF)).resolve()
    print(f"Fire dataset path: {fire_path}")
    print(f"Crowd dataset path: {crowd_path}")

    fire_images = list_images(fire_path)
    crowd_images = list_images(crowd_path)

    fire_images, fire_corrupt_count = filter_valid_images(fire_images)
    crowd_images, crowd_corrupt_count = filter_valid_images(crowd_images)

    if not fire_images:
        raise SystemExit(f"No fire images found under {fire_path}")
    if not crowd_images:
        raise SystemExit(f"No crowd images found under {crowd_path}")

    fire_images = limit_samples(fire_images, args.max_fire_images, rng)
    crowd_images = limit_samples(crowd_images, args.max_crowd_images, rng)

    fire_train, fire_val = split_train_val(fire_images, args.val_ratio, rng)
    crowd_train, crowd_val = split_train_val(crowd_images, args.val_ratio, rng)

    clean_output_root(output_root)

    csv_labels = read_fire_labels_from_csv(fire_path)
    fire_train_stats = copy_fire_samples(fire_train, "train", fire_path, output_root, csv_labels)
    fire_val_stats = copy_fire_samples(fire_val, "val", fire_path, output_root, csv_labels)

    person_model_path = Path(args.crowd_label_model).resolve()
    if not person_model_path.exists():
        raise SystemExit(
            f"Crowd pseudo-label model not found: {person_model_path}. "
            "Set --crowd-label-model to a valid YOLO checkpoint."
        )

    person_model = YOLO(str(person_model_path))
    crowd_train_stats = copy_crowd_samples(
        crowd_train,
        "train",
        output_root,
        person_model,
        conf=args.crowd_person_conf,
        iou=args.crowd_person_iou,
        imgsz=args.crowd_label_imgsz,
    )
    crowd_val_stats = copy_crowd_samples(
        crowd_val,
        "val",
        output_root,
        person_model,
        conf=args.crowd_person_conf,
        iou=args.crowd_person_iou,
        imgsz=args.crowd_label_imgsz,
    )

    write_dataset_yaml(output_root, yaml_out)

    report = {
        "datasets": {
            "fire_ref": FIRE_DATASET_REF,
            "crowd_ref": CROWD_DATASET_REF,
            "fire_path": str(fire_path),
            "crowd_path": str(crowd_path),
            "fire_corrupt_or_unreadable_images": fire_corrupt_count,
            "crowd_corrupt_or_unreadable_images": crowd_corrupt_count,
        },
        "output": {
            "dataset_root": str(output_root),
            "data_yaml": str(yaml_out),
        },
        "splits": {
            "fire_train": fire_train_stats,
            "fire_val": fire_val_stats,
            "crowd_train": crowd_train_stats,
            "crowd_val": crowd_val_stats,
        },
    }
    print("Dataset preparation summary:")
    print(json.dumps(report, indent=2))

    if args.skip_train:
        print("Skipping training (--skip-train enabled).")
        return 0

    best_weights, validation_summary = train_model(args, yaml_out)
    print("Validation summary:")
    print(json.dumps(validation_summary, indent=2))

    if best_weights:
        print(f"Training complete. Best checkpoint: {best_weights}")
        print(f"Set YOLO_MODEL_PATH={best_weights}")
    else:
        print("Training complete, but trainer.best was not available.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
