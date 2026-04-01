#!/usr/bin/env python3
"""
High-density RT-DETR inference worker for surveillance streams.

This worker focuses on production reliability and deep diagnostics:
- Runs exported PaddleDetection RT-DETR models
- Sends live detections to Node backend API
- Includes strong debug tooling for zero-detection root-cause analysis
"""

from __future__ import annotations

import argparse
import collections
import logging
import os
import re
import signal
import time
import warnings
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple, Union
from urllib.parse import unquote

import cv2
import numpy as np
import yaml

# macOS system Python often links against LibreSSL, which triggers this noisy urllib3 warning.
warnings.filterwarnings(
    "ignore",
    message="urllib3 v2 only supports OpenSSL.*",
    category=Warning,
)

import requests

try:
    from paddle import inference
except ModuleNotFoundError as error:
    raise SystemExit(
        "Missing dependency: paddle. Run this worker with the project virtual environment python, "
        "for example: /Users/karthikgurram/clg/intern/sentinel-ai-monitor/.venv/bin/python "
        "inference/rtdetr_crowd_worker.py --help"
    ) from error


LOGGER = logging.getLogger("rtdetr-crowd-worker")
RUNNING = True
PERSON_LABEL_HINTS = ("person", "pedestrian", "people", "human")
MODEL_REQUIRED_FILES = ("model.pdmodel", "model.pdiparams", "infer_cfg.yml")
MODEL_SEARCH_ROOTS = (
    os.getcwd(),
    os.path.expanduser("~/Downloads"),
    os.path.expanduser("~/Desktop"),
    os.path.expanduser("~/Documents"),
    os.path.expanduser("~/clg"),
)


PARSER_LAYOUTS = {
    # [class_id, score, x1, y1, x2, y2]
    "cls_score_xyxy": {
        "class_idx": 0,
        "score_idx": 1,
        "bbox_idx": (2, 3, 4, 5),
        "bbox_type": "xyxy",
    },
    # [class_id, score, x, y, w, h]
    "cls_score_xywh": {
        "class_idx": 0,
        "score_idx": 1,
        "bbox_idx": (2, 3, 4, 5),
        "bbox_type": "xywh",
    },
    # [x1, y1, x2, y2, score, class_id]
    "xyxy_score_cls": {
        "class_idx": 5,
        "score_idx": 4,
        "bbox_idx": (0, 1, 2, 3),
        "bbox_type": "xyxy",
    },
    # [x, y, w, h, score, class_id]
    "xywh_score_cls": {
        "class_idx": 5,
        "score_idx": 4,
        "bbox_idx": (0, 1, 2, 3),
        "bbox_type": "xywh",
    },
    # [x1, y1, x2, y2, class_id, score]
    "xyxy_cls_score": {
        "class_idx": 4,
        "score_idx": 5,
        "bbox_idx": (0, 1, 2, 3),
        "bbox_type": "xyxy",
    },
    # [x, y, w, h, class_id, score]
    "xywh_cls_score": {
        "class_idx": 4,
        "score_idx": 5,
        "bbox_idx": (0, 1, 2, 3),
        "bbox_type": "xywh",
    },
    # [score, class_id, x1, y1, x2, y2]
    "score_cls_xyxy": {
        "class_idx": 1,
        "score_idx": 0,
        "bbox_idx": (2, 3, 4, 5),
        "bbox_type": "xyxy",
    },
    # [score, class_id, x, y, w, h]
    "score_cls_xywh": {
        "class_idx": 1,
        "score_idx": 0,
        "bbox_idx": (2, 3, 4, 5),
        "bbox_type": "xywh",
    },
}


@dataclass
class Detection:
    class_id: int
    confidence: float
    bbox_xyxy: Tuple[float, float, float, float]


@dataclass
class ParseDiagnostics:
    parser_mode: str = "unknown"
    raw_rows: int = 0
    decoded_rows: int = 0
    kept_rows: int = 0
    filtered_by_score: int = 0
    filtered_by_class: int = 0
    invalid_rows: int = 0
    invalid_boxes: int = 0
    class_hist: Dict[int, int] = field(default_factory=dict)
    score_min: Optional[float] = None
    score_max: Optional[float] = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dense crowd RT-DETR worker that pushes detections to sentinel backend.",
    )

    parser.add_argument(
        "--model-dir",
        required=True,
        help="Directory containing model.pdmodel, model.pdiparams and infer_cfg.yml",
    )
    parser.add_argument(
        "--source",
        required=True,
        help="Video source: RTSP URL, file path, or webcam index (example: 0)",
    )
    parser.add_argument("--camera-id", required=True, help="Mongo camera _id in backend")
    parser.add_argument(
        "--api-base-url",
        default="http://localhost:6226/api",
        help="Backend API base URL",
    )

    parser.add_argument(
        "--input-size",
        type=int,
        default=960,
        help="Inference size. Use 960 or 1280 for dense crowds",
    )
    parser.add_argument(
        "--score-threshold",
        type=float,
        default=0.25,
        help="Detection threshold. For debugging zero detections try 0.05",
    )
    parser.add_argument(
        "--person-class-id",
        type=int,
        default=0,
        help="Configured person class id (default 0 for COCO)",
    )
    parser.add_argument(
        "--all-classes",
        action="store_true",
        help="Disable person-only filter",
    )
    parser.add_argument(
        "--disable-person-class-autodetect",
        action="store_true",
        help="Disable label-map based auto person class detection",
    )
    parser.add_argument(
        "--max-detections",
        type=int,
        default=800,
        help="Max detections sent per frame",
    )

    parser.add_argument(
        "--enable-post-nms",
        action="store_true",
        help="Apply extra class-wise NMS after model output",
    )
    parser.add_argument(
        "--post-nms-iou-threshold",
        type=float,
        default=0.9,
        help="Higher IOU keeps more overlaps for dense scenes",
    )

    parser.add_argument(
        "--parser-mode",
        choices=["auto", *PARSER_LAYOUTS.keys()],
        default="auto",
        help="Bounding-box parser layout. Use auto to infer from output tensors",
    )

    parser.add_argument(
        "--frame-skip",
        type=int,
        default=1,
        help="Skip N frames between inference passes for better throughput",
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
        help="Send empty detections payloads (backend may reject depending on validation)",
    )

    parser.add_argument("--use-gpu", action="store_true", help="Enable GPU inference")
    parser.add_argument("--gpu-device-id", type=int, default=0, help="GPU device id")
    parser.add_argument("--gpu-mem-mb", type=int, default=2048, help="GPU memory for Paddle predictor")
    parser.add_argument("--cpu-threads", type=int, default=6, help="CPU math threads")
    parser.add_argument("--enable-mkldnn", action="store_true", help="Enable MKLDNN on CPU")

    parser.add_argument("--show-preview", action="store_true", help="Display annotated preview window")
    parser.add_argument("--preview-scale", type=float, default=0.9, help="Preview display scale")
    parser.add_argument(
        "--log-every-frames",
        type=int,
        default=30,
        help="Print summary every N processed frames",
    )

    # Deep debug toggles for zero-detection issues.
    parser.add_argument(
        "--debug-output",
        action="store_true",
        help="Dump raw model output tensor stats before filtering",
    )
    parser.add_argument(
        "--debug-output-frames",
        type=int,
        default=5,
        help="Number of processed frames to dump output diagnostics",
    )
    parser.add_argument(
        "--debug-output-max-rows",
        type=int,
        default=8,
        help="Max bbox rows shown in diagnostics",
    )
    parser.add_argument(
        "--debug-disable-filters",
        action="store_true",
        help="Disable person filter, score filter and post-NMS to inspect raw detections",
    )
    parser.add_argument(
        "--debug-static-image",
        default="",
        help="Run one-time inference on a static image for pipeline verification",
    )
    parser.add_argument(
        "--debug-static-output",
        default="backend/inference/static_debug_output.jpg",
        help="Where to save static debug visualization",
    )
    parser.add_argument(
        "--exit-after-static-test",
        action="store_true",
        help="Exit immediately after static image debug",
    )
    parser.add_argument(
        "--debug-log-payload",
        action="store_true",
        help="Log outgoing detection payload sample before POST",
    )
    parser.add_argument(
        "--debug-print-frame-stats",
        action="store_true",
        help="Print per-frame shape and pixel range diagnostics",
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

        # Browser device ids are not directly usable in OpenCV; default safely to 0.
        maybe_index = re.match(r"^(?:camera|cam|video)(\d+)$", raw_device_id.lower())
        if maybe_index:
            device_index = int(maybe_index.group(1))
            LOGGER.info("Mapped source '%s' to webcam index %s", source, device_index)
            return device_index

        LOGGER.warning(
            "System source '%s' uses non-numeric device id '%s' that OpenCV cannot map directly. "
            "Falling back to webcam index 0.",
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


def find_model_candidates(max_results: int = 8) -> List[str]:
    required_files = set(MODEL_REQUIRED_FILES)
    candidates: List[str] = []
    seen = set()

    for root in MODEL_SEARCH_ROOTS:
        normalized_root = os.path.abspath(os.path.expanduser(root))
        if not os.path.isdir(normalized_root):
            continue

        for current_root, _dirs, files in os.walk(normalized_root):
            if "model.pdmodel" not in files:
                continue

            file_set = set(files)
            if not required_files.issubset(file_set):
                continue

            candidate = os.path.abspath(current_root)
            if candidate in seen:
                continue

            seen.add(candidate)
            candidates.append(candidate)

            if len(candidates) >= max_results:
                return candidates

    return candidates


def normalize_model_dir(model_dir: str) -> str:
    normalized = os.path.abspath(os.path.expanduser(model_dir.strip()))

    if os.path.isfile(normalized):
        if os.path.basename(normalized) == "model.pdmodel":
            return os.path.dirname(normalized)

        raise SystemExit(
            "--model-dir must point to a directory, or directly to model.pdmodel. "
            f"Received file path: {normalized}"
        )

    return normalized


def validate_model_dir(model_dir: str) -> str:
    if not model_dir or not model_dir.strip():
        raise SystemExit("--model-dir is required")

    normalized = normalize_model_dir(model_dir)
    placeholder_tokens = ("/REAL/", "EXPORTED/MODEL/FOLDER", "<", ">")

    if any(token in normalized for token in placeholder_tokens):
        lines = [
            f"--model-dir appears to be placeholder text: {model_dir}",
            "Replace it with the real exported model directory.",
            "",
            "Tip: run backend/inference/run_debug_worker.sh without arguments to auto-scan common folders.",
        ]
        raise SystemExit("\n".join(lines))

    if not os.path.isdir(normalized):
        lines = [
            f"--model-dir path does not exist or is not a directory: {model_dir}",
            "",
            "Expected directory contents:",
            "- model.pdmodel",
            "- model.pdiparams",
            "- infer_cfg.yml",
        ]

        candidates = find_model_candidates()
        if candidates:
            lines.append("")
            lines.append("Candidate model directories found:")
            lines.extend(f"- {candidate}" for candidate in candidates)
        else:
            lines.append("")
            lines.append("No exported model directories found in current/common folders.")

        raise SystemExit("\n".join(lines))

    missing_files = [
        filename for filename in MODEL_REQUIRED_FILES if not os.path.isfile(os.path.join(normalized, filename))
    ]
    if missing_files:
        lines = [
            f"--model-dir is missing required exported files: {normalized}",
            "Missing:",
        ]
        lines.extend(f"- {filename}" for filename in missing_files)
        raise SystemExit("\n".join(lines))

    return normalized


def load_infer_cfg(model_dir: str) -> Dict[str, object]:
    cfg_path = os.path.join(model_dir, "infer_cfg.yml")
    if not os.path.exists(cfg_path):
        raise FileNotFoundError(f"infer_cfg.yml not found in model directory: {model_dir}")

    with open(cfg_path, "r", encoding="utf-8") as handle:
        cfg = yaml.safe_load(handle) or {}

    if not isinstance(cfg, dict):
        raise RuntimeError("infer_cfg.yml is malformed: expected mapping/object")

    return cfg


def load_label_map(cfg: Dict[str, object]) -> Dict[int, str]:
    labels = cfg.get("label_list")
    if not isinstance(labels, list):
        return {}
    return {index: str(label) for index, label in enumerate(labels)}


def parse_resize_hint(cfg: Dict[str, object]) -> Optional[int]:
    preprocess = cfg.get("Preprocess")
    if not isinstance(preprocess, list):
        return None

    for op in preprocess:
        if not isinstance(op, dict) or op.get("type") != "Resize":
            continue

        target = op.get("target_size")
        if isinstance(target, int):
            return target
        if isinstance(target, list) and target:
            try:
                values = [int(v) for v in target]
                return max(values)
            except Exception:
                return None

    return None


def parse_normalize_config(
    cfg: Dict[str, object],
) -> Tuple[np.ndarray, np.ndarray, bool]:
    preprocess = cfg.get("Preprocess")
    if not isinstance(preprocess, list):
        return (
            np.array([0.485, 0.456, 0.406], dtype="float32").reshape((1, 1, 3)),
            np.array([0.229, 0.224, 0.225], dtype="float32").reshape((1, 1, 3)),
            True,
        )

    for op in preprocess:
        if not isinstance(op, dict) or op.get("type") != "NormalizeImage":
            continue

        mean_list = op.get("mean", [0.485, 0.456, 0.406])
        std_list = op.get("std", [0.229, 0.224, 0.225])
        is_scale = bool(op.get("is_scale", True))

        if not isinstance(mean_list, list) or len(mean_list) != 3:
            mean_list = [0.485, 0.456, 0.406]
        if not isinstance(std_list, list) or len(std_list) != 3:
            std_list = [0.229, 0.224, 0.225]

        mean = np.array(mean_list, dtype="float32").reshape((1, 1, 3))
        std = np.array(std_list, dtype="float32").reshape((1, 1, 3))
        return mean, std, is_scale

    return (
        np.array([0.485, 0.456, 0.406], dtype="float32").reshape((1, 1, 3)),
        np.array([0.229, 0.224, 0.225], dtype="float32").reshape((1, 1, 3)),
        True,
    )


def guess_person_class_id(
    label_map: Dict[int, str],
    configured_class_id: int,
    disabled: bool,
) -> int:
    if disabled or not label_map:
        return configured_class_id

    configured_label = label_map.get(configured_class_id, "").strip().lower()
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


def build_predictor(args: argparse.Namespace) -> inference.Predictor:
    model_file = os.path.join(args.model_dir, "model.pdmodel")
    params_file = os.path.join(args.model_dir, "model.pdiparams")

    if not os.path.exists(model_file):
        raise FileNotFoundError(f"model.pdmodel not found: {model_file}")
    if not os.path.exists(params_file):
        raise FileNotFoundError(f"model.pdiparams not found: {params_file}")

    LOGGER.info("Loading model from: %s", os.path.abspath(model_file))
    LOGGER.info("Loading params from: %s", os.path.abspath(params_file))

    config = inference.Config(model_file, params_file)

    if args.use_gpu:
        config.enable_use_gpu(args.gpu_mem_mb, args.gpu_device_id)
        LOGGER.info("Predictor configured for GPU device=%s, mem=%sMB", args.gpu_device_id, args.gpu_mem_mb)
    else:
        config.disable_gpu()
        config.set_cpu_math_library_num_threads(max(1, args.cpu_threads))
        if args.enable_mkldnn:
            config.enable_mkldnn()
        LOGGER.info(
            "Predictor configured for CPU threads=%s mkldnn=%s",
            max(1, args.cpu_threads),
            args.enable_mkldnn,
        )

    config.switch_ir_optim(True)
    config.enable_memory_optim()
    config.disable_glog_info()
    config.switch_use_feed_fetch_ops(False)

    predictor = inference.create_predictor(config)
    LOGGER.info("Predictor created successfully")
    return predictor


def preprocess_frame(
    frame_bgr: np.ndarray,
    input_size: int,
    mean: np.ndarray,
    std: np.ndarray,
    is_scale: bool,
    debug_frame_stats: bool,
) -> Dict[str, np.ndarray]:
    if frame_bgr is None or frame_bgr.size == 0:
        raise RuntimeError("Input frame is empty or corrupted")

    original_h, original_w = frame_bgr.shape[:2]

    if debug_frame_stats:
        LOGGER.info(
            "Frame stats: shape=%s dtype=%s min=%s max=%s",
            frame_bgr.shape,
            frame_bgr.dtype,
            float(frame_bgr.min()),
            float(frame_bgr.max()),
        )

    resized = cv2.resize(frame_bgr, (input_size, input_size), interpolation=cv2.INTER_LINEAR)
    image = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype("float32")

    if is_scale:
        image /= 255.0

    image = (image - mean) / std
    image = np.transpose(image, (2, 0, 1))[np.newaxis, :].astype("float32")

    # PaddleDetection uses [scale_y, scale_x]
    im_shape = np.array([[float(input_size), float(input_size)]], dtype="float32")
    scale_factor = np.array(
        [[float(input_size) / float(original_h), float(input_size) / float(original_w)]],
        dtype="float32",
    )

    return {
        "image": image,
        "im_shape": im_shape,
        "scale_factor": scale_factor,
    }


def infer_raw(
    predictor: inference.Predictor,
    model_inputs: Dict[str, np.ndarray],
) -> Dict[str, np.ndarray]:
    input_names = predictor.get_input_names()

    for input_name in input_names:
        handle = predictor.get_input_handle(input_name)
        key = input_name.lower()

        if input_name in model_inputs:
            handle.copy_from_cpu(model_inputs[input_name])
            continue

        if "image" in key:
            handle.copy_from_cpu(model_inputs["image"])
            continue

        if "im_shape" in key:
            handle.copy_from_cpu(model_inputs["im_shape"])
            continue

        if "scale" in key:
            handle.copy_from_cpu(model_inputs["scale_factor"])
            continue

        raise RuntimeError(f"Unsupported predictor input tensor: {input_name}")

    predictor.run()

    outputs: Dict[str, np.ndarray] = {}
    for output_name in predictor.get_output_names():
        outputs[output_name] = predictor.get_output_handle(output_name).copy_to_cpu()

    return outputs


def to_2d_bbox_candidate(tensor: np.ndarray) -> Optional[np.ndarray]:
    if tensor.ndim == 2 and tensor.shape[1] >= 6:
        return tensor

    if tensor.ndim == 3 and tensor.shape[-1] >= 6:
        return tensor.reshape((-1, tensor.shape[-1]))

    if tensor.ndim == 1 and tensor.size >= 6 and tensor.size % 6 == 0:
        return tensor.reshape((-1, 6))

    return None


def pick_bbox_tensor(
    outputs: Dict[str, np.ndarray],
) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], Optional[str]]:
    bbox_num = outputs.get("bbox_num")

    if "bbox" in outputs:
        candidate = to_2d_bbox_candidate(outputs["bbox"])
        if candidate is not None:
            return candidate, bbox_num, "bbox"

    for name, tensor in outputs.items():
        candidate = to_2d_bbox_candidate(tensor)
        if candidate is not None:
            return candidate, bbox_num, name

    return None, bbox_num, None


def summarize_outputs(outputs: Dict[str, np.ndarray], max_rows: int) -> None:
    LOGGER.info("Raw output tensors:")
    for name, tensor in outputs.items():
        flat = tensor.reshape(-1) if tensor.size else tensor
        tensor_min = float(np.min(flat)) if tensor.size else 0.0
        tensor_max = float(np.max(flat)) if tensor.size else 0.0
        LOGGER.info(
            "  %s shape=%s dtype=%s min=%.5f max=%.5f",
            name,
            list(tensor.shape),
            tensor.dtype,
            tensor_min,
            tensor_max,
        )

    bbox, bbox_num, bbox_name = pick_bbox_tensor(outputs)
    if bbox is None:
        LOGGER.warning("No bbox-like tensor found in model outputs")
        return

    LOGGER.info(
        "Using bbox tensor '%s' rows=%s cols=%s",
        bbox_name,
        bbox.shape[0],
        bbox.shape[1],
    )

    if bbox_num is not None and bbox_num.size:
        LOGGER.info("bbox_num raw=%s", np.array(bbox_num).reshape(-1)[:8].tolist())

    preview_rows = bbox[: max(1, max_rows)]
    LOGGER.info("bbox preview:\n%s", np.array2string(preview_rows, precision=4, suppress_small=False))


def decode_row_with_layout(row: np.ndarray, layout_name: str) -> Optional[Tuple[int, float, float, float, float, float]]:
    layout = PARSER_LAYOUTS[layout_name]

    try:
        class_raw = float(row[layout["class_idx"]])
        score = float(row[layout["score_idx"]])
        b0 = float(row[layout["bbox_idx"][0]])
        b1 = float(row[layout["bbox_idx"][1]])
        b2 = float(row[layout["bbox_idx"][2]])
        b3 = float(row[layout["bbox_idx"][3]])
    except Exception:
        return None

    if not np.isfinite(class_raw) or not np.isfinite(score):
        return None

    class_id = int(round(class_raw))

    if layout["bbox_type"] == "xywh":
        x1, y1 = b0, b1
        x2, y2 = b0 + b2, b1 + b3
    else:
        x1, y1, x2, y2 = b0, b1, b2, b3

    if not all(np.isfinite(v) for v in (x1, y1, x2, y2)):
        return None

    return class_id, score, x1, y1, x2, y2


def to_pixel_bbox(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    frame_w: int,
    frame_h: int,
) -> Optional[Tuple[float, float, float, float]]:
    if max(abs(x1), abs(y1), abs(x2), abs(y2)) <= 2.0:
        x1 *= frame_w
        x2 *= frame_w
        y1 *= frame_h
        y2 *= frame_h

    x1 = max(0.0, min(float(frame_w - 1), x1))
    y1 = max(0.0, min(float(frame_h - 1), y1))
    x2 = max(0.0, min(float(frame_w), x2))
    y2 = max(0.0, min(float(frame_h), y2))

    if x2 <= x1 or y2 <= y1:
        return None

    return x1, y1, x2, y2


def evaluate_parser_layout(rows: np.ndarray, frame_shape: Tuple[int, int], layout_name: str) -> Tuple[int, int, int]:
    frame_h, frame_w = frame_shape
    valid_boxes = 0
    score_like = 0
    class_like = 0

    sample_rows = rows[: min(120, len(rows))]

    for row in sample_rows:
        decoded = decode_row_with_layout(row, layout_name)
        if decoded is None:
            continue

        class_id, score, x1, y1, x2, y2 = decoded

        if 0.0 <= score <= 1.5:
            score_like += 1
        if -1 <= class_id <= 1000:
            class_like += 1

        if to_pixel_bbox(x1, y1, x2, y2, frame_w, frame_h) is not None:
            valid_boxes += 1

    return valid_boxes, score_like, class_like


def select_parser_layout(
    rows: np.ndarray,
    frame_shape: Tuple[int, int],
    parser_mode: str,
) -> str:
    if parser_mode != "auto":
        return parser_mode

    best_layout = "cls_score_xyxy"
    best_score = -1

    for layout_name in PARSER_LAYOUTS:
        valid_boxes, score_like, class_like = evaluate_parser_layout(rows, frame_shape, layout_name)
        total_score = valid_boxes * 100 + score_like * 3 + class_like

        if total_score > best_score:
            best_layout = layout_name
            best_score = total_score

    LOGGER.info("Auto-selected parser layout: %s", best_layout)
    return best_layout


def parse_detections(
    outputs: Dict[str, np.ndarray],
    frame_shape: Tuple[int, int],
    score_threshold: float,
    person_only: bool,
    person_class_id: int,
    parser_mode: str,
    disable_filters: bool,
) -> Tuple[List[Detection], ParseDiagnostics]:
    frame_h, frame_w = frame_shape
    bbox, bbox_num, bbox_name = pick_bbox_tensor(outputs)

    diagnostics = ParseDiagnostics()

    if bbox is None or bbox.size == 0:
        LOGGER.warning("No bbox tensor could be parsed from model outputs")
        return [], diagnostics

    rows = bbox
    if bbox_num is not None and bbox_num.size > 0:
        count = int(np.array(bbox_num).reshape(-1)[0])
        if count > 0:
            rows = rows[:count]

    diagnostics.raw_rows = int(len(rows))

    if len(rows) == 0:
        return [], diagnostics

    chosen_layout = select_parser_layout(rows, frame_shape, parser_mode)
    diagnostics.parser_mode = chosen_layout

    detections: List[Detection] = []
    class_hist: Dict[int, int] = collections.defaultdict(int)
    score_values: List[float] = []

    effective_threshold = -1.0 if disable_filters else float(score_threshold)
    effective_person_only = False if disable_filters else bool(person_only)

    for row in rows:
        decoded = decode_row_with_layout(row, chosen_layout)
        if decoded is None:
            diagnostics.invalid_rows += 1
            continue

        class_id, confidence, x1, y1, x2, y2 = decoded

        diagnostics.decoded_rows += 1
        class_hist[class_id] += 1
        score_values.append(confidence)

        if confidence < effective_threshold:
            diagnostics.filtered_by_score += 1
            continue

        if effective_person_only and class_id != person_class_id:
            diagnostics.filtered_by_class += 1
            continue

        pixel_bbox = to_pixel_bbox(x1, y1, x2, y2, frame_w, frame_h)
        if pixel_bbox is None:
            diagnostics.invalid_boxes += 1
            continue

        detections.append(
            Detection(
                class_id=class_id,
                confidence=float(confidence),
                bbox_xyxy=pixel_bbox,
            )
        )

    diagnostics.kept_rows = len(detections)
    diagnostics.class_hist = dict(sorted(class_hist.items(), key=lambda item: item[0]))

    if score_values:
        diagnostics.score_min = float(min(score_values))
        diagnostics.score_max = float(max(score_values))

    LOGGER.debug("Parsed rows from tensor '%s' using layout '%s'", bbox_name, chosen_layout)
    return detections, diagnostics


def compute_iou(box_a: Sequence[float], box_b: Sequence[float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    if inter_area <= 0:
        return 0.0

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)

    denom = area_a + area_b - inter_area
    if denom <= 0:
        return 0.0

    return inter_area / denom


def classwise_nms(detections: Iterable[Detection], iou_threshold: float) -> List[Detection]:
    grouped: Dict[int, List[Detection]] = collections.defaultdict(list)
    for det in detections:
        grouped[det.class_id].append(det)

    kept: List[Detection] = []

    for class_id, class_dets in grouped.items():
        remaining = sorted(class_dets, key=lambda item: item.confidence, reverse=True)
        class_kept: List[Detection] = []

        while remaining:
            chosen = remaining.pop(0)
            class_kept.append(chosen)

            next_remaining = []
            for candidate in remaining:
                iou = compute_iou(chosen.bbox_xyxy, candidate.bbox_xyxy)
                if iou <= iou_threshold:
                    next_remaining.append(candidate)

            remaining = next_remaining

        LOGGER.debug("Class %s kept %s after NMS", class_id, len(class_kept))
        kept.extend(class_kept)

    return sorted(kept, key=lambda item: item.confidence, reverse=True)


def detections_to_payload(detections: Sequence[Detection]) -> List[Dict[str, Union[int, float, List[float], str]]]:
    payload = []
    for det in detections:
        x1, y1, x2, y2 = det.bbox_xyxy
        payload.append(
            {
                "class": det.class_id,
                "confidence": round(float(det.confidence), 4),
                "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                "bboxFormat": "xyxy",
            }
        )

    return payload


def draw_preview(
    frame: np.ndarray,
    detections: Sequence[Detection],
    label_map: Dict[int, str],
    preview_scale: float,
) -> np.ndarray:
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
        resized = cv2.resize(
            canvas,
            None,
            fx=preview_scale,
            fy=preview_scale,
            interpolation=cv2.INTER_AREA,
        )
        return resized

    return canvas


def log_parse_diagnostics(
    diagnostics: ParseDiagnostics,
    label_map: Dict[int, str],
    person_class_id: int,
) -> None:
    class_parts = []
    for class_id, count in sorted(diagnostics.class_hist.items(), key=lambda item: item[1], reverse=True)[:12]:
        class_name = label_map.get(class_id, str(class_id))
        class_parts.append(f"{class_id}:{class_name}={count}")

    LOGGER.info(
        "Parser=%s raw=%s decoded=%s kept=%s filtered(score=%s,class=%s) invalid(rows=%s,boxes=%s) score[min=%.4f,max=%.4f]",
        diagnostics.parser_mode,
        diagnostics.raw_rows,
        diagnostics.decoded_rows,
        diagnostics.kept_rows,
        diagnostics.filtered_by_score,
        diagnostics.filtered_by_class,
        diagnostics.invalid_rows,
        diagnostics.invalid_boxes,
        diagnostics.score_min if diagnostics.score_min is not None else -1.0,
        diagnostics.score_max if diagnostics.score_max is not None else -1.0,
    )

    if class_parts:
        LOGGER.info("Detected classes histogram: %s", ", ".join(class_parts))

    person_label = label_map.get(person_class_id, "<unknown>")
    LOGGER.info("Current person class id=%s label='%s'", person_class_id, person_label)


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


def run_static_image_debug(
    args: argparse.Namespace,
    predictor: inference.Predictor,
    mean: np.ndarray,
    std: np.ndarray,
    is_scale: bool,
    label_map: Dict[int, str],
    person_only: bool,
    person_class_id: int,
) -> None:
    image_path = args.debug_static_image.strip()
    if not image_path:
        return

    LOGGER.info("Running static image debug on: %s", image_path)

    image = cv2.imread(image_path)
    if image is None:
        raise RuntimeError(f"Unable to read static debug image: {image_path}")

    model_inputs = preprocess_frame(
        frame_bgr=image,
        input_size=int(args.input_size),
        mean=mean,
        std=std,
        is_scale=bool(is_scale),
        debug_frame_stats=True,
    )
    outputs = infer_raw(predictor, model_inputs)

    summarize_outputs(outputs, int(args.debug_output_max_rows))

    detections, diagnostics = parse_detections(
        outputs=outputs,
        frame_shape=image.shape[:2],
        score_threshold=float(args.score_threshold),
        person_only=person_only,
        person_class_id=person_class_id,
        parser_mode=args.parser_mode,
        disable_filters=bool(args.debug_disable_filters),
    )

    if args.enable_post_nms and not args.debug_disable_filters:
        detections = classwise_nms(detections, float(args.post_nms_iou_threshold))

    log_parse_diagnostics(diagnostics, label_map, person_class_id)
    LOGGER.info("Static image detections after active filters: %s", len(detections))

    preview = draw_preview(
        frame=image,
        detections=detections,
        label_map=label_map,
        preview_scale=1.0,
    )

    out_path = args.debug_static_output
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    cv2.imwrite(out_path, preview)
    LOGGER.info("Saved static debug visualization to: %s", out_path)


def main() -> int:
    args = parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    install_signal_handlers()

    args.model_dir = validate_model_dir(args.model_dir)

    cfg = load_infer_cfg(args.model_dir)
    arch = str(cfg.get("arch", "unknown"))
    preprocess_ops = cfg.get("Preprocess", [])

    if "rtdetr" not in arch.lower():
        LOGGER.warning("infer_cfg arch is '%s' (expected RT-DETR compatible export)", arch)

    LOGGER.info("infer_cfg arch=%s", arch)
    LOGGER.info("infer_cfg preprocess=%s", preprocess_ops)

    resize_hint = parse_resize_hint(cfg)
    if resize_hint is not None and int(args.input_size) != int(resize_hint):
        LOGGER.warning(
            "CLI input-size=%s differs from infer_cfg Resize target=%s. This can affect results.",
            args.input_size,
            resize_hint,
        )

    mean, std, is_scale = parse_normalize_config(cfg)
    LOGGER.info(
        "Normalize config: is_scale=%s mean=%s std=%s",
        is_scale,
        mean.reshape(-1).tolist(),
        std.reshape(-1).tolist(),
    )

    label_map = load_label_map(cfg)
    if label_map:
        LOGGER.info("Loaded %s labels from infer_cfg", len(label_map))

    person_only = not args.all_classes
    person_class_id = guess_person_class_id(
        label_map=label_map,
        configured_class_id=int(args.person_class_id),
        disabled=bool(args.disable_person_class_autodetect),
    )

    if args.debug_disable_filters:
        LOGGER.warning("Debug disable-filters is ON: score/person/NMS filtering will be bypassed")

    predictor = build_predictor(args)

    LOGGER.info(
        "Runtime config: input=%s threshold=%.4f person_only=%s person_class_id=%s parser_mode=%s",
        args.input_size,
        args.score_threshold,
        person_only,
        person_class_id,
        args.parser_mode,
    )

    if args.debug_static_image:
        run_static_image_debug(
            args=args,
            predictor=predictor,
            mean=mean,
            std=std,
            is_scale=is_scale,
            label_map=label_map,
            person_only=person_only,
            person_class_id=person_class_id,
        )

        if args.exit_after_static_test:
            LOGGER.info("Exiting after static test as requested")
            return 0

    session = requests.Session()

    source_value = args.source.strip()
    if source_value.lower() in ("auto", "camera:auto"):
        source_value = resolve_source_from_camera(
            session=session,
            api_base_url=args.api_base_url,
            camera_id=args.camera_id,
            timeout_seconds=float(args.backend_timeout_seconds),
        )

    resolved_source = resolve_source(source_value)

    LOGGER.info(
        "Processing camera: %s | requested_source=%s | resolved_source=%s",
        args.camera_id,
        source_value,
        resolved_source,
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
            if not ok or frame is None:
                LOGGER.warning(
                    "Stream frame read failed. Reconnecting in %.1fs...",
                    args.reconnect_delay_seconds,
                )
                capture.release()
                time.sleep(max(0.2, args.reconnect_delay_seconds))
                capture = cv2.VideoCapture(resolved_source)
                continue

            frame_index += 1
            now = time.monotonic()

            should_process = frame_index % process_every == 0
            if should_process:
                if args.debug_print_frame_stats and processed_frames < int(args.debug_output_frames):
                    LOGGER.info("Frame received: %s", frame is not None)
                    if frame is not None:
                        LOGGER.info("Frame shape: %s", frame.shape)

                model_inputs = preprocess_frame(
                    frame_bgr=frame,
                    input_size=int(args.input_size),
                    mean=mean,
                    std=std,
                    is_scale=bool(is_scale),
                    debug_frame_stats=bool(args.debug_print_frame_stats and processed_frames < args.debug_output_frames),
                )

                outputs = infer_raw(predictor, model_inputs)

                should_dump_output = bool(args.debug_output and processed_frames < int(args.debug_output_frames))
                if should_dump_output:
                    summarize_outputs(outputs, int(args.debug_output_max_rows))

                detections, diagnostics = parse_detections(
                    outputs=outputs,
                    frame_shape=frame.shape[:2],
                    score_threshold=float(args.score_threshold),
                    person_only=person_only,
                    person_class_id=int(person_class_id),
                    parser_mode=args.parser_mode,
                    disable_filters=bool(args.debug_disable_filters),
                )

                if should_dump_output or (processed_frames % max(1, int(args.log_every_frames)) == 0):
                    log_parse_diagnostics(diagnostics, label_map, person_class_id)

                if args.enable_post_nms and not args.debug_disable_filters:
                    detections = classwise_nms(detections, float(args.post_nms_iou_threshold))

                detections = sorted(detections, key=lambda item: item.confidence, reverse=True)
                detections = detections[: max(1, int(args.max_detections))]
                last_preview_detections = detections

                payload_detections = detections_to_payload(detections)

                if payload_detections or args.send_empty:
                    post_detections(
                        session=session,
                        api_base_url=args.api_base_url,
                        camera_id=args.camera_id,
                        detections_payload=payload_detections,
                        timeout_seconds=float(args.backend_timeout_seconds),
                        debug_log_payload=bool(args.debug_log_payload),
                    )
                elif args.debug_log_payload:
                    LOGGER.info("No detections to post for frame=%s", frame_index)

                processed_frames += 1
                if args.log_every_frames > 0 and processed_frames % args.log_every_frames == 0:
                    elapsed = max(1e-6, time.perf_counter() - start_time)
                    fps = processed_frames / elapsed
                    LOGGER.info(
                        "Processed=%s | FPS=%.2f | detections(after filters)=%s",
                        processed_frames,
                        fps,
                        len(detections),
                    )

            if now - last_heartbeat >= float(args.status_heartbeat_seconds):
                heartbeat_online(
                    session=session,
                    api_base_url=args.api_base_url,
                    camera_id=args.camera_id,
                    timeout_seconds=float(args.backend_timeout_seconds),
                )
                last_heartbeat = now

            if args.show_preview:
                preview = draw_preview(
                    frame=frame,
                    detections=last_preview_detections,
                    label_map=label_map,
                    preview_scale=float(args.preview_scale),
                )
                cv2.imshow("RT-DETR Crowd Monitor", preview)
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
