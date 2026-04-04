#!/usr/bin/env python3
"""YOLOv8 FastAPI + Socket.IO test server for quick detection experiments.

This service is intentionally simple and standalone so you can test ML detection
without changing the existing Node backend flow.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Sequence

import cv2
import numpy as np
import socketio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from ultralytics import YOLO
except ModuleNotFoundError as error:
    raise SystemExit(
        "Missing dependency: ultralytics. Install backend/pythonmodel/requirements.txt first."
    ) from error


LOGGER = logging.getLogger("yolo-fastapi-test")
LOG_LEVEL = os.getenv("YOLO_TEST_LOG_LEVEL", "INFO").strip().upper() or "INFO"
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3226",
]

DEFAULT_CAMERA_IDS = ["system_camera", "iphone_camera", *[f"system_{index}" for index in range(10)]]
VEHICLE_CLASSES = {"car", "truck", "bus", "motorcycle", "bicycle"}
WEAPON_HINTS = {"knife", "gun", "rifle", "pistol", "scissors", "baseball bat"}
DEFAULT_FIRE_CLASS_NAMES = ["fire", "flame"]
DEFAULT_SMOKE_CLASS_NAMES = ["smoke"]
SEMANTIC_CLASS_IDS = {
    "fire": 80,
    "flame": 80,
    "smoke": 81,
    "stampede": 82,
    "medical emergency": 83,
}


def parse_csv(value: str | None, fallback: List[str]) -> List[str]:
    if not value or not value.strip():
        return fallback

    parsed = [entry.strip() for entry in value.split(",") if entry.strip()]
    return parsed or fallback


def parse_float(value: str | None, fallback: float) -> float:
    if value is None:
        return fallback

    try:
        parsed = float(value)
    except ValueError:
        return fallback

    if not np.isfinite(parsed):
        return fallback

    return parsed


def parse_bool(value: str | None, fallback: bool) -> bool:
    if value is None or not str(value).strip():
        return fallback

    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False

    return fallback


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def normalize_label(value: str) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").split())


def normalize_label_set(values: Sequence[str], fallback: Sequence[str]) -> set[str]:
    normalized = {normalize_label(entry) for entry in values if normalize_label(entry)}
    if normalized:
        return normalized
    return {normalize_label(entry) for entry in fallback if normalize_label(entry)}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_scores() -> Dict[str, float]:
    return {
        "person": 0.0,
        "stampede": 0.0,
        "medical_emergency": 0.0,
        "fire": 0.0,
        "smoke": 0.0,
        "running": 0.0,
        "fallen": 0.0,
        "me": 0.0,
        "violence": 0.0,
        "crowd_density": 0.0,
        "weapon": 0.0,
        "suspicious_activity": 0.0,
    }


def resolve_model_source() -> str:
    candidates = []

    env_path = os.getenv("YOLO_MODEL_PATH", "").strip()
    if env_path:
        candidates.append(Path(env_path))

    local_candidates = [
        Path(__file__).resolve().parent / "runs" / "fire_detector" / "weights" / "best.pt",
        Path(__file__).resolve().parent / "runs" / "detect" / "fire_detector" / "weights" / "best.pt",
        Path(__file__).resolve().parent / "app" / "ml" / "models" / "yolov8n.pt",
        Path(__file__).resolve().parent / "models" / "yolov8n.pt",
        Path(__file__).resolve().parent / "yolov8n.pt",
    ]
    candidates.extend(local_candidates)

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return "yolov8n.pt"


YOLO_CONFIDENCE = parse_float(os.getenv("YOLO_CONFIDENCE", "0.25"), 0.25)
YOLO_IOU = parse_float(os.getenv("YOLO_IOU", "0.45"), 0.45)
CORS_ORIGINS = parse_csv(os.getenv("YOLO_CORS_ORIGINS"), DEFAULT_CORS_ORIGINS)
FIRE_CLASS_NAMES = normalize_label_set(
    parse_csv(os.getenv("YOLO_FIRE_CLASS_NAMES"), DEFAULT_FIRE_CLASS_NAMES),
    DEFAULT_FIRE_CLASS_NAMES,
)
SMOKE_CLASS_NAMES = normalize_label_set(
    parse_csv(os.getenv("YOLO_SMOKE_CLASS_NAMES"), DEFAULT_SMOKE_CLASS_NAMES),
    DEFAULT_SMOKE_CLASS_NAMES,
)
YOLO_FIRE_ALERT_THRESHOLD = clamp(
    parse_float(os.getenv("YOLO_FIRE_ALERT_THRESHOLD", "0.45"), 0.45),
    0.0,
    1.0,
)
YOLO_COLOR_FALLBACK_ENABLED = parse_bool(os.getenv("YOLO_COLOR_FALLBACK_ENABLED"), True)
YOLO_COLOR_MIN_REGION_RATIO = clamp(
    parse_float(os.getenv("YOLO_COLOR_MIN_REGION_RATIO", "0.0015"), 0.0015),
    0.00001,
    1.0,
)
YOLO_COLOR_MAX_REGION_RATIO = clamp(
    parse_float(os.getenv("YOLO_COLOR_MAX_REGION_RATIO", "0.95"), 0.95),
    0.001,
    1.0,
)

MODEL_SOURCE = resolve_model_source()
MODEL_ERROR = ""
yolo_model: YOLO | None = None

try:
    yolo_model = YOLO(MODEL_SOURCE)
    LOGGER.info("YOLOv8 model loaded from %s", MODEL_SOURCE)
except Exception as error:  # pragma: no cover - runtime dependency issue
    MODEL_ERROR = str(error)
    LOGGER.exception("Failed to load YOLO model")


def decode_image(contents: bytes) -> np.ndarray:
    frame = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image format")
    return frame


def is_fire_label(class_name: str) -> bool:
    return normalize_label(class_name) in FIRE_CLASS_NAMES


def is_smoke_label(class_name: str) -> bool:
    return normalize_label(class_name) in SMOKE_CLASS_NAMES


def semantic_class_id(class_name: str, fallback_class_id: int) -> int:
    mapped = SEMANTIC_CLASS_IDS.get(normalize_label(class_name))
    if mapped is not None:
        return mapped
    return int(fallback_class_id)


def build_fire_smoke_masks(frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    fire_ranges = [
        (np.array([0, 120, 90]), np.array([20, 255, 255])),
        (np.array([160, 120, 90]), np.array([180, 255, 255])),
    ]
    smoke_ranges = [
        (np.array([0, 0, 70]), np.array([180, 45, 210])),
    ]

    fire_mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for lower, upper in fire_ranges:
        fire_mask = cv2.bitwise_or(fire_mask, cv2.inRange(hsv, lower, upper))

    smoke_mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for lower, upper in smoke_ranges:
        smoke_mask = cv2.bitwise_or(smoke_mask, cv2.inRange(hsv, lower, upper))

    kernel = np.ones((5, 5), dtype=np.uint8)
    fire_mask = cv2.morphologyEx(fire_mask, cv2.MORPH_OPEN, kernel)
    fire_mask = cv2.morphologyEx(fire_mask, cv2.MORPH_DILATE, kernel)

    smoke_mask = cv2.morphologyEx(smoke_mask, cv2.MORPH_OPEN, kernel)
    smoke_mask = cv2.morphologyEx(smoke_mask, cv2.MORPH_DILATE, kernel)

    return fire_mask, smoke_mask


def mask_contour_detections(
    mask: np.ndarray,
    class_name: str,
    class_id: int,
    frame_shape: tuple[int, int, int],
) -> List[Dict[str, Any]]:
    frame_area = float(frame_shape[0] * frame_shape[1])
    if frame_area <= 0:
        return []

    contours, _hierarchy = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    detections: List[Dict[str, Any]] = []

    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        if width <= 4 or height <= 4:
            continue

        box_area = float(width * height)
        box_ratio = box_area / frame_area
        if box_ratio < YOLO_COLOR_MIN_REGION_RATIO or box_ratio > YOLO_COLOR_MAX_REGION_RATIO:
            continue

        roi = mask[y : y + height, x : x + width]
        density = float(cv2.countNonZero(roi)) / max(1.0, float(width * height))
        confidence = clamp(max(box_ratio / 0.08, density), 0.20, 0.99)

        detections.append(
            {
                "class": class_name,
                "confidence": round(float(confidence), 4),
                "class_id": class_id,
                "source": "color_fallback",
                "bbox": {
                    "x1": float(x),
                    "y1": float(y),
                    "x2": float(x + width),
                    "y2": float(y + height),
                    "width": float(width),
                    "height": float(height),
                    "center_x": float(x + width / 2),
                    "center_y": float(y + height / 2),
                    "area": box_area,
                },
            }
        )

    detections.sort(key=lambda item: item["confidence"], reverse=True)
    return detections[:5]


def extract_color_fallback_detections(
    frame: np.ndarray,
    include_fire: bool,
    include_smoke: bool,
) -> List[Dict[str, Any]]:
    fire_mask, smoke_mask = build_fire_smoke_masks(frame)
    detections: List[Dict[str, Any]] = []

    if include_fire:
        detections.extend(mask_contour_detections(fire_mask, "fire", 80, frame.shape))

    if include_smoke:
        detections.extend(mask_contour_detections(smoke_mask, "smoke", 81, frame.shape))

    return detections


def run_yolo(frame: np.ndarray) -> List[Dict[str, Any]]:
    if yolo_model is None:
        raise HTTPException(status_code=503, detail="YOLO model is not loaded")

    results = yolo_model.predict(frame, conf=YOLO_CONFIDENCE, iou=YOLO_IOU, verbose=False)
    detections: List[Dict[str, Any]] = []

    for result in results:
        boxes = result.boxes
        if boxes is None:
            continue

        for index in range(len(boxes)):
            coords = boxes.xyxy[index].cpu().numpy()
            confidence = float(boxes.conf[index].cpu().numpy())
            model_class_id = int(boxes.cls[index].cpu().numpy())
            class_name = str(yolo_model.names.get(model_class_id, f"class_{model_class_id}"))
            class_id = semantic_class_id(class_name, model_class_id)

            x1, y1, x2, y2 = [float(value) for value in coords]
            width = max(0.0, x2 - x1)
            height = max(0.0, y2 - y1)

            detections.append(
                {
                    "class": class_name,
                    "confidence": round(confidence, 4),
                    "class_id": class_id,
                    "source": "yolo",
                    "bbox": {
                        "x1": x1,
                        "y1": y1,
                        "x2": x2,
                        "y2": y2,
                        "width": width,
                        "height": height,
                        "center_x": x1 + width / 2,
                        "center_y": y1 + height / 2,
                        "area": width * height,
                    },
                }
            )

    return detections


def detect_fire_smoke_by_color(frame: np.ndarray) -> Dict[str, float]:
    fire_mask, smoke_mask = build_fire_smoke_masks(frame)

    total_pixels = float(frame.shape[0] * frame.shape[1])
    fire_ratio = cv2.countNonZero(fire_mask) / total_pixels
    smoke_ratio = cv2.countNonZero(smoke_mask) / total_pixels

    fire_confidence = float(min(max(fire_ratio / 0.03, 0.0), 1.0))
    smoke_confidence = float(min(max(smoke_ratio / 0.05, 0.0), 1.0))

    return {
        "fire": fire_confidence,
        "smoke": smoke_confidence,
    }


def score_detections(detections: List[Dict[str, Any]], frame_shape: tuple[int, int, int]) -> Dict[str, Any]:
    scores = default_scores()
    object_counts: Dict[str, int] = {}

    person_detections = []
    weapon_detections = []

    for detection in detections:
        class_name = str(detection["class"]).lower()
        object_counts[class_name] = object_counts.get(class_name, 0) + 1

        if class_name == "person":
            person_detections.append(detection)

        if any(hint in class_name for hint in WEAPON_HINTS):
            weapon_detections.append(detection)

    person_count = len(person_detections)
    frame_area = float(frame_shape[0] * frame_shape[1])
    person_area_ratio = 0.0

    if person_count > 0 and frame_area > 0:
        person_area_ratio = sum(d["bbox"]["area"] for d in person_detections) / frame_area

    if person_detections:
        scores["person"] = max(item["confidence"] * 100 for item in person_detections)

    crowd_density = min(100.0, person_count * 11.0 + person_area_ratio * 250.0)
    scores["crowd_density"] = crowd_density

    if person_count >= 4:
        scores["running"] = min(100.0, person_count * 10.0)

    fallen_persons = [
        detection
        for detection in person_detections
        if detection["bbox"]["height"] > 0 and detection["bbox"]["width"] / detection["bbox"]["height"] > 1.3
    ]

    if fallen_persons:
        scores["fallen"] = max(item["confidence"] * 100 for item in fallen_persons)
        scores["medical_emergency"] = max(60.0, scores["fallen"] * 0.9)

    if person_count > 8:
        scores["stampede"] = min(100.0, crowd_density * 0.9 + (person_count - 8) * 4.0)

    if weapon_detections:
        scores["weapon"] = max(item["confidence"] * 100 for item in weapon_detections)

    if person_count == 1 and person_detections:
        scores["me"] = max(item["confidence"] * 100 for item in person_detections)

    if person_count >= 2:
        scores["violence"] = min(100.0, person_count * 7.0 + scores["weapon"] * 0.4)

    scores["suspicious_activity"] = min(
        100.0,
        max(scores["weapon"] * 0.8, scores["crowd_density"] * 0.55, scores["violence"] * 0.9),
    )

    return {
        "scores": {key: round(value, 2) for key, value in scores.items()},
        "object_counts": object_counts,
        "person_count": person_count,
    }


def apply_fire_smoke_scores(
    scores: Dict[str, float],
    detections: List[Dict[str, Any]],
    frame: np.ndarray,
) -> Dict[str, float]:
    color_signals = detect_fire_smoke_by_color(frame)

    yolo_fire = [item["confidence"] for item in detections if is_fire_label(str(item["class"]))]
    yolo_smoke = [item["confidence"] for item in detections if is_smoke_label(str(item["class"]))]

    fire_score = max([color_signals["fire"], *yolo_fire], default=0.0) * 100
    smoke_score = max([color_signals["smoke"], *yolo_smoke], default=0.0) * 100

    scores["fire"] = round(fire_score, 2)
    scores["smoke"] = round(smoke_score, 2)

    return scores


def build_fire_detection_summary(detections: List[Dict[str, Any]]) -> Dict[str, Any]:
    fire_detections = [item for item in detections if is_fire_label(str(item["class"]))]
    smoke_detections = [item for item in detections if is_smoke_label(str(item["class"]))]

    fire_detections.sort(key=lambda item: item["confidence"], reverse=True)
    smoke_detections.sort(key=lambda item: item["confidence"], reverse=True)

    fire_confidences = [item["confidence"] for item in fire_detections]
    smoke_confidences = [item["confidence"] for item in smoke_detections]

    return {
        "fire_detected": any(conf >= YOLO_FIRE_ALERT_THRESHOLD for conf in fire_confidences),
        "fire_count": len(fire_detections),
        "max_fire_confidence": round(max(fire_confidences, default=0.0), 4),
        "fire_boxes": [
            {
                "confidence": item["confidence"],
                "bbox": [
                    item["bbox"]["x1"],
                    item["bbox"]["y1"],
                    item["bbox"]["x2"],
                    item["bbox"]["y2"],
                ],
            }
            for item in fire_detections[:10]
        ],
        "smoke_detected": any(conf >= 0.35 for conf in smoke_confidences),
        "smoke_count": len(smoke_detections),
        "max_smoke_confidence": round(max(smoke_confidences, default=0.0), 4),
        "smoke_boxes": [
            {
                "confidence": item["confidence"],
                "bbox": [
                    item["bbox"]["x1"],
                    item["bbox"]["y1"],
                    item["bbox"]["x2"],
                    item["bbox"]["y2"],
                ],
            }
            for item in smoke_detections[:10]
        ],
        "alert_threshold": YOLO_FIRE_ALERT_THRESHOLD,
    }


def build_risk_assessment(scores: Dict[str, float], person_count: int, object_counts: Dict[str, int]) -> Dict[str, Any]:
    alerts: List[str] = []

    if scores["fire"] >= 40:
        alerts.append("Potential fire-like visual pattern detected")
    if scores["smoke"] >= 45:
        alerts.append("Potential smoke-like visual pattern detected")
    if scores["stampede"] >= 55:
        alerts.append(f"Stampede risk inferred from crowd behavior ({person_count} persons)")
    if scores["medical_emergency"] >= 60:
        alerts.append("Potential fallen-person medical emergency detected")
    if scores["weapon"] >= 40:
        alerts.append("Possible weapon-like object detected")

    max_score = max(scores.values()) if scores else 0.0
    if max_score >= 80:
        risk_level = "critical"
    elif max_score >= 60:
        risk_level = "high"
    elif max_score >= 35:
        risk_level = "medium"
    else:
        risk_level = "low"

    emergency_type = None
    if scores["fire"] >= 40:
        emergency_type = "fire"
    elif scores["stampede"] >= 55:
        emergency_type = "stampede"
    elif scores["medical_emergency"] >= 60:
        emergency_type = "medical_emergency"

    return {
        "emergency_detected": emergency_type is not None,
        "emergency_type": emergency_type,
        "risk_level": risk_level,
        "alerts": alerts,
        "object_summary": [f"{name}: {count}" for name, count in sorted(object_counts.items())],
    }


def as_socket_detections(detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    socket_ready = []
    for item in detections:
        bbox = item["bbox"]
        socket_ready.append(
            {
                "class": item["class_id"],
                "confidence": item["confidence"],
                "bbox": [bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]],
                "bboxFormat": "xyxy",
            }
        )
    return socket_ready


def cache_detection(camera_id: str, payload: Dict[str, Any]) -> None:
    detection_cache[camera_id] = payload

    # Keep system aliases in sync for local testing convenience.
    if camera_id.startswith("system") or camera_id == "iphone_camera":
        for alias in DEFAULT_CAMERA_IDS:
            detection_cache[alias] = payload


app = FastAPI(title="Sentinel YOLOv8 Test API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=CORS_ORIGINS,
    logger=False,
    engineio_logger=False,
)
socket_app = socketio.ASGIApp(sio, app)

detection_cache: Dict[str, Dict[str, Any]] = {}


@sio.event
async def connect(sid: str, _environ: Dict[str, Any], _auth: Any) -> None:
    LOGGER.info("Socket connected: %s", sid)


@sio.event
async def disconnect(sid: str) -> None:
    LOGGER.info("Socket disconnected: %s", sid)


@sio.event
async def join_room(sid: str, data: Any) -> None:
    payload = data if isinstance(data, dict) else {}
    rooms = []

    for key in ("role", "zone", "cameraId"):
        value = str(payload.get(key, "")).strip()
        if value:
            rooms.append(value)
            await sio.enter_room(sid, value)

    LOGGER.info("Socket %s joined rooms: %s", sid, rooms or "none")
    await sio.emit("room:joined", {"rooms": rooms}, to=sid)


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "yolo_loaded": yolo_model is not None,
        "model_source": MODEL_SOURCE,
        "model_error": MODEL_ERROR or None,
        "fire_class_names": sorted(FIRE_CLASS_NAMES),
        "smoke_class_names": sorted(SMOKE_CLASS_NAMES),
        "color_fallback_enabled": YOLO_COLOR_FALLBACK_ENABLED,
    }


@app.get("/api/cameras")
async def get_cameras() -> Dict[str, Any]:
    return {
        "success": True,
        "data": [
            {
                "id": "system_camera",
                "name": "System Camera",
                "location": "Local Device",
                "status": "active",
            }
        ],
    }


@app.post("/api/ml/analyze/enhanced")
async def analyze_frame(file: UploadFile = File(...), camera_id: str = Form("system_camera")) -> JSONResponse:
    try:
        if yolo_model is None:
            return JSONResponse(
                status_code=503,
                content={
                    "success": False,
                    "error": f"YOLO model not loaded: {MODEL_ERROR or 'unknown error'}",
                    "detections": [],
                },
            )

        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Empty file payload")

        frame = decode_image(contents)
        detections = run_yolo(frame)

        if YOLO_COLOR_FALLBACK_ENABLED:
            has_yolo_fire = any(is_fire_label(str(item["class"])) for item in detections)
            has_yolo_smoke = any(is_smoke_label(str(item["class"])) for item in detections)
            detections.extend(
                extract_color_fallback_detections(
                    frame,
                    include_fire=not has_yolo_fire,
                    include_smoke=not has_yolo_smoke,
                )
            )

        scored = score_detections(detections, frame.shape)
        scores = apply_fire_smoke_scores(scored["scores"], detections, frame)
        fire_summary = build_fire_detection_summary(detections)

        object_counts = scored["object_counts"]
        person_count = scored["person_count"]
        timestamp = now_iso()

        risk = build_risk_assessment(scores, person_count, object_counts)

        confidence_values = [item["confidence"] for item in detections]
        avg_conf = float(np.mean(confidence_values)) if confidence_values else 0.0

        payload = {
            "camera_id": camera_id,
            "detections": detections,
            "summary": {
                "total_objects": len(detections),
                "person_count": person_count,
                "vehicle_count": sum(object_counts.get(name, 0) for name in VEHICLE_CLASSES),
                "object_counts": object_counts,
                "object_summary": risk["object_summary"],
                "unique_classes": len(object_counts),
            },
            "analysis": {
                "emergency_detected": risk["emergency_detected"],
                "emergency_type": risk["emergency_type"],
                "risk_level": risk["risk_level"],
                "alerts": risk["alerts"],
                "fire_alert": fire_summary["fire_detected"],
                "confidence_stats": {
                    "average": round(avg_conf, 3),
                    "maximum": round(max(confidence_values, default=0.0), 3),
                    "minimum": round(min(confidence_values, default=0.0), 3),
                },
            },
            "fire_detection": fire_summary,
            "scores": scores,
            "timestamp": timestamp,
            "processing_info": {
                "model": "YOLOv8",
                "model_source": MODEL_SOURCE,
                "confidence_threshold": YOLO_CONFIDENCE,
                "iou_threshold": YOLO_IOU,
                "color_fallback_enabled": YOLO_COLOR_FALLBACK_ENABLED,
            },
        }

        cache_detection(camera_id, payload)

        await sio.emit(
            "detection:update",
            {
                "cameraId": camera_id,
                "detections": as_socket_detections(detections),
                "timestamp": timestamp,
            },
        )
        await sio.emit(
            "ml:scores",
            {
                "cameraId": camera_id,
                "scores": scores,
                "fire": fire_summary,
                "timestamp": timestamp,
            },
        )

        if fire_summary["fire_detected"]:
            await sio.emit(
                "fire:alert",
                {
                    "cameraId": camera_id,
                    "timestamp": timestamp,
                    "fire": fire_summary,
                    "riskLevel": risk["risk_level"],
                },
            )

        return JSONResponse(content={"success": True, **payload})

    except HTTPException:
        raise
    except Exception as error:
        LOGGER.exception("Enhanced analysis failed")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(error),
                "detections": [],
                "scores": default_scores(),
            },
        )


@app.get("/api/cameras/{camera_id}/detection-scores")
async def get_detection_scores(camera_id: str) -> JSONResponse:
    payload = detection_cache.get(camera_id)
    if not payload:
        return JSONResponse(
            content={
                "success": True,
                "camera_id": camera_id,
                "scores": default_scores(),
                "timestamp": now_iso(),
                "message": "No detection data available",
            }
        )

    return JSONResponse(
        content={
            "success": True,
            "camera_id": camera_id,
            "scores": payload["scores"],
            "timestamp": payload["timestamp"],
            "detection_count": len(payload["detections"]),
            "person_count": payload["summary"]["person_count"],
                "fire_detected": bool(payload.get("fire_detection", {}).get("fire_detected")),
                "fire_confidence": payload.get("fire_detection", {}).get("max_fire_confidence", 0.0),
            "message": "Detection scores retrieved from cached ML analysis",
        }
    )


@app.get("/api/ml/model-info")
async def model_info() -> JSONResponse:
    if yolo_model is None:
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "error": f"Model not loaded: {MODEL_ERROR or 'unknown error'}",
            },
        )

    classes = list(yolo_model.names.values()) if isinstance(yolo_model.names, dict) else []
    return JSONResponse(
        content={
            "success": True,
            "model_info": {
                "name": "YOLOv8",
                "source": MODEL_SOURCE,
                "class_count": len(classes),
                "classes": classes,
                "fire_class_names": sorted(FIRE_CLASS_NAMES),
                "smoke_class_names": sorted(SMOKE_CLASS_NAMES),
                "fire_alert_threshold": YOLO_FIRE_ALERT_THRESHOLD,
                "color_fallback_enabled": YOLO_COLOR_FALLBACK_ENABLED,
                "confidence_threshold": YOLO_CONFIDENCE,
                "iou_threshold": YOLO_IOU,
                "framework": "Ultralytics",
            },
        }
    )


@app.get("/api/ml/supported-objects")
async def supported_objects() -> JSONResponse:
    if yolo_model is None:
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": "Model not loaded", "classes": []},
        )

    classes = list(yolo_model.names.values()) if isinstance(yolo_model.names, dict) else []
    return JSONResponse(
        content={
            "success": True,
            "total_classes": len(classes),
            "all_classes": classes,
            "fire_class_names": sorted(FIRE_CLASS_NAMES),
            "smoke_class_names": sorted(SMOKE_CLASS_NAMES),
            "derived_alerts": [
                "stampede",
                "medical_emergency",
                "fire",
                "smoke",
                "running",
                "fallen",
                "violence",
                "weapon",
                "suspicious_activity",
            ],
        }
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("YOLO_SERVER_HOST", "0.0.0.0").strip() or "0.0.0.0"
    port = int(os.getenv("YOLO_SERVER_PORT", "8000"))
    uvicorn.run(socket_app, host=host, port=port)
