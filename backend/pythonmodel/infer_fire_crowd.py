#!/usr/bin/env python3
"""Run inference for fire-crowd model on image, video, or live camera source."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

import cv2

try:
    from ultralytics import YOLO
except ModuleNotFoundError as error:  # pragma: no cover - runtime dependency guard
    raise SystemExit(
        "Missing dependency: ultralytics. Install backend/pythonmodel/requirements.txt first."
    ) from error


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inference for fire-crowd YOLOv8 model")
    parser.add_argument("--weights", required=True, help="Path to trained YOLO weights")
    parser.add_argument("--source", required=True, help="Image path, video path, camera index, or stream URL")
    parser.add_argument("--conf", type=float, default=0.25, help="Inference confidence threshold")
    parser.add_argument("--imgsz", type=int, default=640, help="Inference image size")
    parser.add_argument(
        "--save-dir",
        default="backend/pythonmodel/runs/infer/fire_crowd",
        help="Directory to save annotated outputs",
    )
    parser.add_argument("--show", action="store_true", help="Display live preview window")
    parser.add_argument("--max-frames", type=int, default=0, help="Optional limit for processed frames")
    return parser.parse_args()


def resolve_source(raw_source: str) -> int | str:
    value = str(raw_source).strip()
    if value.isdigit():
        return int(value)
    return value


def is_image_source(source: str) -> bool:
    path = Path(source)
    return path.suffix.lower() in IMAGE_SUFFIXES


def detect_crowd_ids(names: dict[int, str]) -> set[int]:
    crowd_labels = {"crowd", "person", "people"}
    return {
        int(class_id)
        for class_id, class_name in names.items()
        if str(class_name).strip().lower() in crowd_labels
    }


def print_frame_summary(names: dict[int, str], classes: Iterable[float], confidences: Iterable[float]) -> None:
    summary: list[str] = []
    for class_id_value, confidence in zip(classes, confidences):
        class_id = int(class_id_value)
        class_name = str(names.get(class_id, f"class_{class_id}"))
        summary.append(f"{class_name}:{float(confidence):.2f}")

    if summary:
        print("Detections -> " + ", ".join(summary))


def run_image_inference(model: YOLO, source: Path, conf: float, imgsz: int, save_dir: Path, show: bool) -> int:
    result = model.predict(source=str(source), conf=conf, imgsz=imgsz, verbose=False)[0]
    annotated = result.plot()

    save_dir.mkdir(parents=True, exist_ok=True)
    out_path = save_dir / f"{source.stem}_annotated{source.suffix or '.jpg'}"
    cv2.imwrite(str(out_path), annotated)

    boxes = getattr(result, "boxes", None)
    if boxes is not None and len(boxes) > 0:
        classes = boxes.cls.tolist() if boxes.cls is not None else []
        confidences = boxes.conf.tolist() if boxes.conf is not None else []
        print_frame_summary(model.names if isinstance(model.names, dict) else {}, classes, confidences)
    else:
        print("No detections found.")

    print(f"Saved annotated image: {out_path}")

    if show:
        cv2.imshow("Fire-Crowd Detection", annotated)
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    return 0


def run_video_or_stream(
    model: YOLO,
    source: int | str,
    conf: float,
    imgsz: int,
    save_dir: Path,
    show: bool,
    max_frames: int,
) -> int:
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Unable to open source: {source}")

    save_dir.mkdir(parents=True, exist_ok=True)

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    if fps <= 0:
        fps = 25.0

    out_path = save_dir / "video_annotated.mp4"
    writer = cv2.VideoWriter(
        str(out_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (max(1, width), max(1, height)),
    )

    names = model.names if isinstance(model.names, dict) else {}
    crowd_ids = detect_crowd_ids(names)
    fire_id = next((int(class_id) for class_id, name in names.items() if str(name).strip().lower() == "fire"), 0)

    frame_index = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            frame_index += 1
            result = model.predict(frame, conf=conf, imgsz=imgsz, verbose=False)[0]
            annotated = result.plot()

            crowd_count = 0
            max_fire_conf = 0.0
            boxes = getattr(result, "boxes", None)
            if boxes is not None and len(boxes) > 0:
                classes = boxes.cls.tolist() if boxes.cls is not None else []
                confidences = boxes.conf.tolist() if boxes.conf is not None else []
                for class_id_value, confidence in zip(classes, confidences):
                    class_id = int(class_id_value)
                    if class_id in crowd_ids:
                        crowd_count += 1
                    if class_id == fire_id:
                        max_fire_conf = max(max_fire_conf, float(confidence))

            cv2.putText(
                annotated,
                f"crowd_count={crowd_count} fire_conf={max_fire_conf:.2f}",
                (16, 34),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 255),
                2,
                cv2.LINE_AA,
            )

            writer.write(annotated)

            if show:
                cv2.imshow("Fire-Crowd Detection", annotated)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            if max_frames > 0 and frame_index >= max_frames:
                break
    finally:
        cap.release()
        writer.release()
        if show:
            cv2.destroyAllWindows()

    print(f"Saved annotated video: {out_path}")
    print(f"Processed frames: {frame_index}")
    return 0


def main() -> int:
    args = parse_args()

    weights = Path(args.weights).resolve()
    if not weights.exists():
        raise SystemExit(f"Weights not found: {weights}")

    model = YOLO(str(weights))
    save_dir = Path(args.save_dir).resolve()

    raw_source = str(args.source)
    if is_image_source(raw_source):
        source_path = Path(raw_source).resolve()
        if not source_path.exists():
            raise SystemExit(f"Image not found: {source_path}")
        return run_image_inference(model, source_path, args.conf, args.imgsz, save_dir, args.show)

    source = resolve_source(raw_source)
    return run_video_or_stream(model, source, args.conf, args.imgsz, save_dir, args.show, args.max_frames)


if __name__ == "__main__":
    raise SystemExit(main())
