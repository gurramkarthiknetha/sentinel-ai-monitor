#!/usr/bin/env python3
"""Run YOLOv8 inference on image, video, stream, or live camera."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import cv2

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


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run inference with a trained YOLOv8 model")
    parser.add_argument("--weights", required=True, help="Path to trained YOLO weights")
    parser.add_argument("--source", required=True, help="Image path, video path, stream URL, or camera index")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--iou", type=float, default=0.45, help="NMS IoU threshold")
    parser.add_argument("--imgsz", type=int, default=640, help="Inference image size")
    parser.add_argument("--device", default="auto", help="auto/mps/cpu/0")
    parser.add_argument("--show", action="store_true", help="Display live results")
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Disable writing annotated outputs to disk",
    )
    parser.add_argument(
        "--save-dir",
        default="backend/pythonmodel/runs/infer/custom",
        help="Directory for annotated outputs",
    )
    parser.add_argument(
        "--save-name",
        default="",
        help="Optional output filename stem (without extension)",
    )
    parser.add_argument("--max-frames", type=int, default=0, help="Optional frame limit for video/camera")
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


def resolve_source(raw_source: str) -> int | str:
    source = str(raw_source).strip()
    if source.isdigit():
        return int(source)
    return source


def is_image_path(source: str) -> bool:
    path = Path(source)
    return path.suffix.lower() in IMAGE_SUFFIXES


def ensure_save_dir(path: Path, enabled: bool) -> None:
    if enabled:
        path.mkdir(parents=True, exist_ok=True)


def run_image(
    model: YOLO,
    image_path: Path,
    conf: float,
    iou: float,
    imgsz: int,
    device: str,
    save_dir: Path,
    save_enabled: bool,
    save_name: str,
    show: bool,
) -> int:
    result = model.predict(
        source=str(image_path),
        conf=conf,
        iou=iou,
        imgsz=imgsz,
        device=device,
        verbose=False,
    )[0]

    boxes = getattr(result, "boxes", None)
    detection_count = int(len(boxes)) if boxes is not None else 0
    print(f"Detections: {detection_count}")

    annotated = result.plot()

    if save_enabled:
        ensure_save_dir(save_dir, True)
        stem = save_name.strip() or f"{image_path.stem}_annotated"
        out_path = save_dir / f"{stem}{image_path.suffix or '.jpg'}"
        cv2.imwrite(str(out_path), annotated)
        print(f"Saved annotated image: {out_path}")

    if show:
        cv2.imshow("YOLOv8 Inference", annotated)
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    return 0


def build_video_output_path(save_dir: Path, source: int | str, save_name: str) -> Path:
    if save_name.strip():
        return save_dir / f"{save_name.strip()}.mp4"

    if isinstance(source, int):
        source_tag = f"camera_{source}"
    else:
        source_tag = Path(str(source)).stem or "stream"

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return save_dir / f"{source_tag}_{stamp}.mp4"


def run_video_or_stream(
    model: YOLO,
    source: int | str,
    conf: float,
    iou: float,
    imgsz: int,
    device: str,
    save_dir: Path,
    save_enabled: bool,
    save_name: str,
    show: bool,
    max_frames: int,
) -> int:
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Unable to open source: {source}")

    writer = None
    out_path: Path | None = None

    if save_enabled:
        ensure_save_dir(save_dir, True)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
        if fps <= 0:
            fps = 25.0

        out_path = build_video_output_path(save_dir, source, save_name)
        writer = cv2.VideoWriter(
            str(out_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (max(1, width), max(1, height)),
        )

    frame_index = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            frame_index += 1
            result = model.predict(
                source=frame,
                conf=conf,
                iou=iou,
                imgsz=imgsz,
                device=device,
                verbose=False,
            )[0]
            annotated = result.plot()

            boxes = getattr(result, "boxes", None)
            detection_count = int(len(boxes)) if boxes is not None else 0
            print(f"frame={frame_index} detections={detection_count}")

            if writer is not None:
                writer.write(annotated)

            if show:
                cv2.imshow("YOLOv8 Inference", annotated)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            if max_frames > 0 and frame_index >= max_frames:
                break
    finally:
        cap.release()
        if writer is not None:
            writer.release()
        if show:
            cv2.destroyAllWindows()

    print(f"Processed frames: {frame_index}")
    if out_path is not None:
        print(f"Saved annotated video: {out_path}")

    return 0


def main() -> int:
    args = parse_args()

    weights = Path(args.weights).resolve()
    if not weights.exists():
        raise SystemExit(f"Weights not found: {weights}")

    source_text = str(args.source).strip()
    if not source_text:
        raise SystemExit("--source cannot be empty")

    save_enabled = not args.no_save
    if not save_enabled and not args.show:
        print("Warning: both saving and display are disabled; no visual output will be produced.")

    model = YOLO(str(weights))
    device = resolve_device(args.device)
    save_dir = Path(args.save_dir).resolve()

    if is_image_path(source_text):
        image_path = Path(source_text).resolve()
        if not image_path.exists():
            raise SystemExit(f"Image not found: {image_path}")
        return run_image(
            model=model,
            image_path=image_path,
            conf=args.conf,
            iou=args.iou,
            imgsz=args.imgsz,
            device=device,
            save_dir=save_dir,
            save_enabled=save_enabled,
            save_name=args.save_name,
            show=args.show,
        )

    source = resolve_source(source_text)
    return run_video_or_stream(
        model=model,
        source=source,
        conf=args.conf,
        iou=args.iou,
        imgsz=args.imgsz,
        device=device,
        save_dir=save_dir,
        save_enabled=save_enabled,
        save_name=args.save_name,
        show=args.show,
        max_frames=args.max_frames,
    )


if __name__ == "__main__":
    raise SystemExit(main())
