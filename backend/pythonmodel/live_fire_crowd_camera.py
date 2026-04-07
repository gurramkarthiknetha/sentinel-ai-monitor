#!/usr/bin/env python3
"""Run live webcam inference for fire + crowd detection with a trained YOLO model."""

from __future__ import annotations

import argparse
import time

import cv2

try:
    from ultralytics import YOLO
except ModuleNotFoundError as error:  # pragma: no cover - runtime dependency guard
    raise SystemExit(
        "Missing dependency: ultralytics. Install backend/pythonmodel/requirements.txt first."
    ) from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Live webcam inference for fire + crowd detection")
    parser.add_argument("--weights", required=True, help="Path to trained YOLO weights (best.pt)")
    parser.add_argument("--camera", default="0", help="Camera source index or URL")
    parser.add_argument("--conf", type=float, default=0.25, help="Inference confidence threshold")
    parser.add_argument("--imgsz", type=int, default=640, help="Inference image size")
    parser.add_argument("--fire-alert-threshold", type=float, default=0.90, help="Fire alert confidence")
    parser.add_argument("--crowd-alert-count", type=int, default=8, help="Crowd count alert threshold")
    parser.add_argument("--alert-cooldown", type=float, default=3.0, help="Seconds between console alerts")
    return parser.parse_args()


def resolve_source(camera: str) -> int | str:
    stripped = str(camera).strip()
    if stripped.isdigit():
        return int(stripped)
    return stripped


def class_name_to_id_map(model: YOLO) -> dict[str, int]:
    names = model.names if isinstance(model.names, dict) else {}
    lookup: dict[str, int] = {}
    for class_id, class_name in names.items():
        normalized = str(class_name).strip().lower()
        if normalized:
            lookup[normalized] = int(class_id)
    return lookup


def resolve_crowd_class_ids(class_lookup: dict[str, int]) -> set[int]:
    ids = {
        class_id
        for label, class_id in class_lookup.items()
        if label in {"crowd", "people", "person"}
    }

    if not ids and "person" in class_lookup:
        ids.add(class_lookup["person"])

    if not ids and "crowd" in class_lookup:
        ids.add(class_lookup["crowd"])

    return ids or {1}


def main() -> int:
    args = parse_args()

    model = YOLO(args.weights)
    class_lookup = class_name_to_id_map(model)
    fire_class_id = class_lookup.get("fire", 0)
    crowd_class_ids = resolve_crowd_class_ids(class_lookup)

    source = resolve_source(args.camera)
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Unable to open camera source: {source}")

    print("Live inference started. Press 'q' to exit.")
    last_alert_at = 0.0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                continue

            result = model.predict(frame, conf=args.conf, imgsz=args.imgsz, verbose=False)[0]
            annotated = result.plot()

            fire_confidences = []
            crowd_count = 0

            boxes = getattr(result, "boxes", None)
            if boxes is not None and len(boxes) > 0:
                classes = boxes.cls.tolist() if boxes.cls is not None else []
                confidences = boxes.conf.tolist() if boxes.conf is not None else []

                for class_id_value, confidence in zip(classes, confidences):
                    class_id = int(class_id_value)
                    if class_id == fire_class_id:
                        fire_confidences.append(float(confidence))
                    if class_id in crowd_class_ids:
                        crowd_count += 1

            now = time.time()
            can_alert = now - last_alert_at >= max(0.5, args.alert_cooldown)

            max_fire_confidence = max(fire_confidences, default=0.0)
            if can_alert:
                if max_fire_confidence >= args.fire_alert_threshold:
                    print(f"[ALERT] Fire detected ({max_fire_confidence:.2f})")
                    last_alert_at = now
                elif crowd_count >= args.crowd_alert_count:
                    print(f"[ALERT] Crowd threshold reached ({crowd_count} people)")
                    last_alert_at = now

            cv2.imshow("Live Fire + Crowd Detection", annotated)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
