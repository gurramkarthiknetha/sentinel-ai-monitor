#!/usr/bin/env python3
"""
Ultralytics RT-DETR streaming worker for Sentinel AI Monitor.

This worker:
- Runs RT-DETR (.pt) inference using Ultralytics
- Reads RTSP/file/system camera sources via OpenCV
- Posts detections to backend /api/detections
- Sends ONLINE heartbeats to keep camera status fresh
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import signal
import sys
import time
import warnings
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple, Union
from urllib.parse import unquote

import cv2

# Suppress noisy macOS LibreSSL warning from urllib3 v2 before requests import.
warnings.filterwarnings(
    "ignore",
    message=r"urllib3 v2 only supports OpenSSL 1\.1\.1\+.*LibreSSL.*",
    category=Warning,
    module=r"urllib3(\..*)?",
)

import requests

try:
    from ultralytics import RTDETR
except ModuleNotFoundError as error:
    raise SystemExit(
        "Missing dependency: ultralytics. Install backend/pythonmodel/requirements.txt "
        "in your Python environment before running this worker."
    ) from error


LOGGER = logging.getLogger("ultralytics-rtdetr-worker")
RUNNING = True
PERSON_LABEL_HINTS = ("person", "pedestrian", "people", "human")
MODEL_SEARCH_ROOTS = (
    os.getcwd(),
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
    os.path.expanduser("~/Downloads"),
    os.path.expanduser("~/Desktop"),
    os.path.expanduser("~/Documents"),
)


@dataclass
class Detection:
    class_id: int
    confidence: float
    bbox_xyxy: Tuple[float, float, float, float]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ultralytics RT-DETR worker that pushes detections to sentinel backend.",
    )

    parser.add_argument(
        "--model-path",
        required=True,
        help="Path to RT-DETR .pt weights (for example: backend/rtdetr-l.pt)",
    )
    parser.add_argument(
        "--source",
        required=True,
        help="Video source: RTSP URL, file path, webcam index, or system:// device URL",
    )
    parser.add_argument("--camera-id", required=True, help="Mongo camera _id in backend")
    parser.add_argument(
        "--api-base-url",
        default="http://localhost:6226/api",
        help="Backend API base URL",
    )
    parser.add_argument(
        "--worker-api-key",
        default="",
        help="Optional shared key sent as x-worker-key header",
    )

    parser.add_argument(
        "--input-size",
        type=int,
        default=960,
        help="Inference size in pixels",
    )
    parser.add_argument(
        "--score-threshold",
        type=float,
        default=0.25,
        help="Confidence threshold",
    )
    parser.add_argument(
        "--iou-threshold",
        type=float,
        default=0.7,
        help="NMS IoU threshold",
    )
    parser.add_argument(
        "--person-class-id",
        type=int,
        default=0,
        help="Configured person class id",
    )
    parser.add_argument(
        "--all-classes",
        action="store_true",
        help="Disable person-only filter",
    )
    parser.add_argument(
        "--max-detections",
        type=int,
        default=300,
        help="Maximum detections sent per frame",
    )
    parser.add_argument(
        "--min-box-area-ratio",
        type=float,
        default=0.0005,
        help="Minimum bbox area as ratio of frame area",
    )
    parser.add_argument(
        "--max-box-area-ratio",
        type=float,
        default=0.90,
        help="Maximum bbox area as ratio of frame area",
    )

    parser.add_argument(
        "--frame-skip",
        type=int,
        default=1,
        help="Skip N frames between inference passes",
    )
    parser.add_argument(
        "--status-heartbeat-seconds",
        type=float,
        default=8.0,
        help="Camera ONLINE heartbeat interval",
    )
    parser.add_argument(
        "--backend-timeout-seconds",
        type=float,
        default=2.5,
        help="HTTP timeout to backend",
    )
    parser.add_argument(
        "--reconnect-delay-seconds",
        type=float,
        default=2.0,
        help="Delay before reconnecting dropped stream",
    )
    parser.add_argument(
        "--send-empty",
        action="store_true",
        help="Send empty detections payloads",
    )

    parser.add_argument(
        "--device",
        default="auto",
        help="Ultralytics device (auto/cpu/mps/0)",
    )
    parser.add_argument("--half", action="store_true", help="Enable half precision")
    parser.add_argument("--show-preview", action="store_true", help="Display annotated preview window")
    parser.add_argument("--preview-scale", type=float, default=0.9, help="Preview display scale")
    parser.add_argument(
        "--log-every-frames",
        type=int,
        default=30,
        help="Print summary every N processed frames",
    )
    parser.add_argument(
        "--debug-log-payload",
        action="store_true",
        help="Log outgoing detection payload sample before POST",
    )

    if len(sys.argv) == 1:
        parser.print_help()
        parser.exit(
            2,
            "\nTip: use run_debug_worker.sh for a quick local run:\n"
            "  backend/pythonmodel/run_debug_worker.sh backend/rtdetr-l.pt auto\n",
        )

    return parser.parse_args()


def install_signal_handlers() -> None:
    def _handle_signal(signum, _frame):
        global RUNNING
        RUNNING = False
        LOGGER.info("Received signal %s, stopping worker...", signum)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)


def resolve_source(source: str) -> Union[int, str]:
    source = source.strip()

    if source.isdigit():
        return int(source)

    lower_source = source.lower()
    if lower_source.startswith("system://"):
        raw_device_id = unquote(source[len("system://") :]).strip()

        if raw_device_id in ("", "default", "camera", "webcam"):
            LOGGER.info("Mapped source '%s' to webcam index 0", source)
            return 0

        if raw_device_id.isdigit():
            device_index = int(raw_device_id)
            LOGGER.info("Mapped source '%s' to webcam index %s", source, device_index)
            return device_index

        maybe_index = re.match(r"^(?:camera|cam|video)(\d+)$", raw_device_id.lower())
        if maybe_index:
            device_index = int(maybe_index.group(1))
            LOGGER.info("Mapped source '%s' to webcam index %s", source, device_index)
            return device_index

        LOGGER.info(
            "System source '%s' uses browser device id '%s'. Using webcam index 0 for OpenCV capture.",
            source,
            raw_device_id,
        )
        return 0

    return source


def resolve_source_from_camera(
    session: requests.Session,
    api_base_url: str,
    camera_id: str,
    timeout_seconds: float,
) -> str:
    endpoint = f"{api_base_url.rstrip('/')}/cameras/{camera_id}"
    response = session.get(endpoint, timeout=timeout_seconds)

    if response.status_code >= 300:
        raise RuntimeError(
            f"Unable to fetch camera details for source auto-resolution ({response.status_code}): {response.text}"
        )

    payload = response.json() if response.content else {}
    camera = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(camera, dict):
        raise RuntimeError("Malformed camera response while resolving source")

    source_type = str(camera.get("sourceType") or "RTSP").strip().upper()
    rtsp_url = str(camera.get("rtspUrl") or "").strip()
    device_id = str(camera.get("deviceId") or "").strip()

    if source_type == "SYSTEM":
        if rtsp_url.startswith("system://"):
            return rtsp_url
        if device_id:
            return f"system://{device_id}"
        return "system://default"

    if rtsp_url:
        return rtsp_url

    raise RuntimeError("Camera has no usable source (missing rtspUrl/deviceId)")


def find_model_candidates(max_results: int = 10) -> List[str]:
    candidates: List[str] = []
    seen = set()

    for root in MODEL_SEARCH_ROOTS:
        normalized_root = os.path.abspath(os.path.expanduser(root))
        if not os.path.isdir(normalized_root):
            continue

        for current_root, _dirs, files in os.walk(normalized_root):
            for file_name in files:
                lower = file_name.lower()
                if not lower.endswith(".pt"):
                    continue
                if "rtdetr" not in lower and "rt-detr" not in lower:
                    continue

                candidate = os.path.abspath(os.path.join(current_root, file_name))
                if candidate in seen:
                    continue

                seen.add(candidate)
                candidates.append(candidate)

                if len(candidates) >= max_results:
                    return candidates

    return candidates


def validate_model_path(model_path: str) -> str:
    if not model_path or not model_path.strip():
        raise SystemExit("--model-path is required")

    model_path = model_path.strip()
    normalized = os.path.abspath(os.path.expanduser(model_path))

    if os.path.isdir(normalized):
        raise SystemExit(
            "--model-path must point to an RT-DETR .pt file, not a directory. "
            f"Received: {model_path}"
        )

    if os.path.isfile(normalized):
        if normalized.lower().endswith(".pt"):
            return normalized

        raise SystemExit(f"--model-path is not a .pt file: {normalized}")

    # Allow Ultralytics built-in model names like rtdetr-l.pt.
    if os.path.sep not in model_path and model_path.lower().endswith(".pt"):
        return model_path

    lines = [
        f"--model-path does not exist: {model_path}",
        "",
        "Expected a local .pt path or a valid Ultralytics model name (example: rtdetr-l.pt).",
    ]

    candidates = find_model_candidates()
    if candidates:
        lines.append("")
        lines.append("Candidate RT-DETR .pt files found:")
        lines.extend(f"- {candidate}" for candidate in candidates)

    raise SystemExit("\n".join(lines))


def guess_person_class_id(label_map: Dict[int, str], configured_class_id: int) -> int:
    configured_label = str(label_map.get(configured_class_id, "")).strip().lower()
    if any(hint in configured_label for hint in PERSON_LABEL_HINTS):
        return configured_class_id

    for class_id, label in label_map.items():
        normalized = str(label).strip().lower()
        if any(hint in normalized for hint in PERSON_LABEL_HINTS):
            LOGGER.warning(
                "Configured person class id %s maps to '%s', but '%s' appears at class id %s. "
                "Auto-switching person class id.",
                configured_class_id,
                label_map.get(configured_class_id, "<unknown>"),
                label,
                class_id,
            )
            return class_id

    return configured_class_id


def get_label_map(model: RTDETR) -> Dict[int, str]:
    names = getattr(model, "names", None)

    if isinstance(names, dict):
        normalized: Dict[int, str] = {}
        for key, value in names.items():
            try:
                class_id = int(key)
            except Exception:
                continue
            normalized[class_id] = str(value)
        return normalized

    if isinstance(names, list):
        return {index: str(value) for index, value in enumerate(names)}

    return {}


def to_pixel_bbox(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    frame_w: int,
    frame_h: int,
) -> Optional[Tuple[float, float, float, float]]:
    x1 = max(0.0, min(float(frame_w - 1), float(x1)))
    y1 = max(0.0, min(float(frame_h - 1), float(y1)))
    x2 = max(0.0, min(float(frame_w), float(x2)))
    y2 = max(0.0, min(float(frame_h), float(y2)))

    if x2 <= x1 or y2 <= y1:
        return None

    return x1, y1, x2, y2


def run_prediction(
    model: RTDETR,
    frame,
    args: argparse.Namespace,
    detect_all_classes: bool,
    person_class_id: int,
):
    device = None if str(args.device).strip().lower() == "auto" else str(args.device).strip()
    classes = None if detect_all_classes else [int(person_class_id)]

    results = model.predict(
        source=frame,
        conf=float(args.score_threshold),
        iou=float(args.iou_threshold),
        imgsz=int(args.input_size),
        device=device,
        classes=classes,
        max_det=int(args.max_detections),
        half=bool(args.half),
        verbose=False,
    )

    if not results:
        return None

    return results[0]


def parse_detections(
    result,
    frame_shape: Sequence[int],
    score_threshold: float,
    detect_all_classes: bool,
    person_class_id: int,
    min_box_area_ratio: float,
    max_box_area_ratio: float,
) -> List[Detection]:
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return []

    xyxy_tensor = getattr(boxes, "xyxy", None)
    cls_tensor = getattr(boxes, "cls", None)
    conf_tensor = getattr(boxes, "conf", None)

    if xyxy_tensor is None or cls_tensor is None or conf_tensor is None:
        return []

    xyxy = xyxy_tensor.cpu().tolist()
    class_ids = cls_tensor.cpu().tolist()
    confidences = conf_tensor.cpu().tolist()

    frame_h, frame_w = int(frame_shape[0]), int(frame_shape[1])
    frame_area = max(1.0, float(frame_w * frame_h))
    detections: List[Detection] = []

    for row, class_raw, confidence_raw in zip(xyxy, class_ids, confidences):
        try:
            class_id = int(round(float(class_raw)))
            confidence = float(confidence_raw)
            x1, y1, x2, y2 = [float(value) for value in row]
        except Exception:
            continue

        if confidence < float(score_threshold):
            continue

        if (not detect_all_classes) and class_id != int(person_class_id):
            continue

        bbox_xyxy = to_pixel_bbox(x1, y1, x2, y2, frame_w, frame_h)
        if bbox_xyxy is None:
            continue

        bx1, by1, bx2, by2 = bbox_xyxy
        box_area = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
        box_area_ratio = box_area / frame_area

        if box_area_ratio < float(min_box_area_ratio):
            continue

        if box_area_ratio > float(max_box_area_ratio):
            continue

        detections.append(
            Detection(
                class_id=class_id,
                confidence=confidence,
                bbox_xyxy=bbox_xyxy,
            )
        )

    detections.sort(key=lambda item: item.confidence, reverse=True)
    return detections


def detections_to_payload(
    detections: Iterable[Detection],
    frame_w: int,
    frame_h: int,
) -> List[Dict[str, Union[int, float, List[float], str]]]:
    payload: List[Dict[str, Union[int, float, List[float], str]]] = []

    safe_w = max(1, int(frame_w))
    safe_h = max(1, int(frame_h))

    for det in detections:
        x1, y1, x2, y2 = det.bbox_xyxy
        width = max(0.0, x2 - x1)
        height = max(0.0, y2 - y1)

        normalized_bbox = [
            max(0.0, min(1.0, x1 / safe_w)),
            max(0.0, min(1.0, y1 / safe_h)),
            max(0.0, min(1.0, width / safe_w)),
            max(0.0, min(1.0, height / safe_h)),
        ]

        payload.append(
            {
                "class": int(det.class_id),
                "confidence": round(float(det.confidence), 4),
                "bbox": [round(value, 6) for value in normalized_bbox],
                "bboxFormat": "xywh",
            }
        )

    return payload


def post_detections(
    session: requests.Session,
    api_base_url: str,
    camera_id: str,
    detections_payload: Sequence[Dict[str, Union[int, float, List[float], str]]],
    timeout_seconds: float,
    debug_log_payload: bool,
) -> None:
    endpoint = f"{api_base_url.rstrip('/')}/detections"

    if debug_log_payload:
        LOGGER.info(
            "POST detections count=%s sample=%s",
            len(detections_payload),
            list(detections_payload)[:3],
        )

    response = session.post(
        endpoint,
        json={"cameraId": camera_id, "detections": list(detections_payload)},
        timeout=timeout_seconds,
    )

    if response.status_code >= 300:
        LOGGER.warning("Detection POST failed (%s): %s", response.status_code, response.text)
    elif debug_log_payload:
        LOGGER.info("Detection POST success status=%s", response.status_code)


def heartbeat_online(
    session: requests.Session,
    api_base_url: str,
    camera_id: str,
    timeout_seconds: float,
) -> None:
    endpoint = f"{api_base_url.rstrip('/')}/cameras/{camera_id}/status"
    response = session.patch(
        endpoint,
        json={"status": "ONLINE"},
        timeout=timeout_seconds,
    )

    if response.status_code >= 300:
        LOGGER.warning("Heartbeat PATCH failed (%s): %s", response.status_code, response.text)


def maybe_send_heartbeat(
    session: requests.Session,
    api_base_url: str,
    camera_id: str,
    timeout_seconds: float,
    heartbeat_interval_seconds: float,
    now_monotonic: float,
    last_heartbeat_monotonic: float,
) -> float:
    if now_monotonic - last_heartbeat_monotonic < heartbeat_interval_seconds:
        return last_heartbeat_monotonic

    try:
        heartbeat_online(
            session=session,
            api_base_url=api_base_url,
            camera_id=camera_id,
            timeout_seconds=timeout_seconds,
        )
    except requests.RequestException as error:
        LOGGER.warning("Heartbeat request failed: %s", error)

    return now_monotonic


def draw_preview(
    frame,
    detections: Sequence[Detection],
    label_map: Dict[int, str],
    preview_scale: float,
):
    canvas = frame.copy()

    for det in detections:
        x1, y1, x2, y2 = det.bbox_xyxy
        pt1 = (int(x1), int(y1))
        pt2 = (int(x2), int(y2))

        color = (0, 64, 255) if det.class_id == 0 else (0, 180, 255)
        cv2.rectangle(canvas, pt1, pt2, color, 2)

        class_text = label_map.get(det.class_id, str(det.class_id))
        text = f"{class_text}:{det.class_id} {det.confidence:.2f}"
        text_origin = (pt1[0], max(14, pt1[1] - 4))
        cv2.putText(canvas, text, text_origin, cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)

    cv2.putText(
        canvas,
        f"detections: {len(detections)}",
        (10, 24),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (0, 255, 180),
        2,
        cv2.LINE_AA,
    )

    if preview_scale != 1.0:
        return cv2.resize(
            canvas,
            None,
            fx=preview_scale,
            fy=preview_scale,
            interpolation=cv2.INTER_AREA,
        )

    return canvas


def main() -> int:
    args = parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    install_signal_handlers()

    model_path = validate_model_path(args.model_path)

    session = requests.Session()
    worker_api_key = str(args.worker_api_key or "").strip()
    if worker_api_key:
        session.headers.update({"x-worker-key": worker_api_key})

    source_value = args.source.strip()
    if source_value.lower() in ("auto", "camera:auto"):
        source_value = resolve_source_from_camera(
            session=session,
            api_base_url=args.api_base_url,
            camera_id=args.camera_id,
            timeout_seconds=float(args.backend_timeout_seconds),
        )

    resolved_source = resolve_source(source_value)

    LOGGER.info("Loading RT-DETR model from: %s", model_path)
    model = RTDETR(model_path)
    label_map = get_label_map(model)

    detect_all_classes = bool(args.all_classes)
    person_class_id = int(args.person_class_id)
    if not detect_all_classes:
        person_class_id = guess_person_class_id(label_map, person_class_id)

    LOGGER.info(
        "Runtime config: source=%s input=%s threshold=%.4f iou=%.4f detect_all_classes=%s person_class_id=%s device=%s",
        resolved_source,
        args.input_size,
        args.score_threshold,
        args.iou_threshold,
        detect_all_classes,
        person_class_id,
        args.device,
    )

    capture = cv2.VideoCapture(resolved_source)
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open source: {source_value}")

    frame_index = 0
    processed_frames = 0
    process_every = max(1, int(args.frame_skip) + 1)
    last_heartbeat = 0.0
    start_time = time.perf_counter()
    last_preview_detections: List[Detection] = []

    try:
        while RUNNING:
            ok, frame = capture.read()
            now = time.monotonic()

            if not ok or frame is None:
                last_heartbeat = maybe_send_heartbeat(
                    session=session,
                    api_base_url=args.api_base_url,
                    camera_id=args.camera_id,
                    timeout_seconds=float(args.backend_timeout_seconds),
                    heartbeat_interval_seconds=float(args.status_heartbeat_seconds),
                    now_monotonic=now,
                    last_heartbeat_monotonic=last_heartbeat,
                )

                LOGGER.warning(
                    "Stream frame read failed. Reconnecting in %.1fs...",
                    args.reconnect_delay_seconds,
                )
                capture.release()
                time.sleep(max(0.2, float(args.reconnect_delay_seconds)))
                capture = cv2.VideoCapture(resolved_source)
                continue

            frame_index += 1

            should_process = frame_index % process_every == 0
            if should_process:
                result = run_prediction(
                    model=model,
                    frame=frame,
                    args=args,
                    detect_all_classes=detect_all_classes,
                    person_class_id=person_class_id,
                )

                detections = (
                    parse_detections(
                        result=result,
                        frame_shape=frame.shape[:2],
                        score_threshold=float(args.score_threshold),
                        detect_all_classes=detect_all_classes,
                        person_class_id=person_class_id,
                        min_box_area_ratio=float(args.min_box_area_ratio),
                        max_box_area_ratio=float(args.max_box_area_ratio),
                    )
                    if result is not None
                    else []
                )

                detections = detections[: max(1, int(args.max_detections))]
                last_preview_detections = detections

                payload_detections = detections_to_payload(
                    detections=detections,
                    frame_w=int(frame.shape[1]),
                    frame_h=int(frame.shape[0]),
                )

                if payload_detections or args.send_empty:
                    try:
                        post_detections(
                            session=session,
                            api_base_url=args.api_base_url,
                            camera_id=args.camera_id,
                            detections_payload=payload_detections,
                            timeout_seconds=float(args.backend_timeout_seconds),
                            debug_log_payload=bool(args.debug_log_payload),
                        )
                    except requests.RequestException as error:
                        LOGGER.warning("Detection POST request failed: %s", error)
                elif args.debug_log_payload:
                    LOGGER.info("No detections to post for frame=%s", frame_index)

                processed_frames += 1
                if args.log_every_frames > 0 and processed_frames % int(args.log_every_frames) == 0:
                    elapsed = max(1e-6, time.perf_counter() - start_time)
                    fps = processed_frames / elapsed
                    LOGGER.info(
                        "Processed=%s | FPS=%.2f | detections=%s",
                        processed_frames,
                        fps,
                        len(detections),
                    )

            now = time.monotonic()
            last_heartbeat = maybe_send_heartbeat(
                session=session,
                api_base_url=args.api_base_url,
                camera_id=args.camera_id,
                timeout_seconds=float(args.backend_timeout_seconds),
                heartbeat_interval_seconds=float(args.status_heartbeat_seconds),
                now_monotonic=now,
                last_heartbeat_monotonic=last_heartbeat,
            )

            if args.show_preview:
                preview = draw_preview(
                    frame=frame,
                    detections=last_preview_detections,
                    label_map=label_map,
                    preview_scale=float(args.preview_scale),
                )
                cv2.imshow("Ultralytics RT-DETR Monitor", preview)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    LOGGER.info("Preview requested stop (q key)")
                    break

    finally:
        capture.release()
        if args.show_preview:
            cv2.destroyAllWindows()

    LOGGER.info("Worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())