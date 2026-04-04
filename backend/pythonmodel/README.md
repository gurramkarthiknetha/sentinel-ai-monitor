Ultralytics RT-DETR Worker

Purpose
- Run RT-DETR (`.pt`) inference in real time on CCTV/RTSP/system camera sources.
- Push detections into backend API for Socket.IO dashboard updates.
- Keep camera ONLINE state alive via periodic heartbeat updates.

Model requirements
- Use an Ultralytics-compatible RT-DETR `.pt` model.
- Default project model: `backend/rtdetr-l.pt`

Install
1. Create and activate a Python environment.
2. Install dependencies:
   pip install -r backend/pythonmodel/requirements.txt

Run worker manually
python backend/pythonmodel/rtdetr_crowd_worker.py \
  --model-path backend/rtdetr-l.pt \
  --source auto \
  --camera-id YOUR_CAMERA_ID \
  --api-base-url http://localhost:6226/api \
  --input-size 960 \
  --score-threshold 0.25 \
  --frame-skip 1

Debug launcher
- The helper script auto-fetches cameraId from your running backend:
  backend/pythonmodel/run_debug_worker.sh /absolute/path/to/rtdetr_model.pt [SOURCE|auto] [CAMERA_ID]
- Example:
  backend/pythonmodel/run_debug_worker.sh backend/rtdetr-l.pt auto

System camera mapping behavior
- `system://default` maps to `cv2.VideoCapture(0)`.
- `system://<number>` maps to `cv2.VideoCapture(<number>)`.
- `system://<non-numeric-device-id>` falls back to webcam index `0`.

Backend-managed runtime
- Backend service `backend/services/rtdetrWorkerManager.js` manages one worker per ONLINE camera.
- Setting camera status ONLINE starts worker automatically.
- OFFLINE/delete stops worker automatically.
- On unexpected worker exit, manager attempts auto-restart when camera is still ONLINE.

Detection payload format
{
  "cameraId": "<mongo-camera-id>",
  "detections": [
    {
      "class": 0,
      "confidence": 0.87,
      "bbox": [x1, y1, x2, y2],
      "bboxFormat": "xyxy"
    }
  ]
}

Notes
- By default, worker sends person class only. Set `RTDETR_ALL_CLASSES=true` to disable that filter.
- False-positive controls:
  - `RTDETR_MIN_BOX_AREA_RATIO` and `RTDETR_MAX_BOX_AREA_RATIO` filter extremely tiny or near-full-frame boxes.
  - `RTDETR_EXCLUDE_CLASS_IDS` skips noisy classes (for example `62` for TV in webcam scenes).
- Press `q` to stop when running with `--show-preview`.
- Optional remote model integration:
  - Set `PYTHONMODEL=http://127.0.0.1:8000` in backend env.
  - Worker will call `PYTHONMODEL/api/ml/analyze/enhanced` for frame inference.
  - On remote failure, worker falls back to local RT-DETR for reliability.

YOLOv8 FastAPI Test Server (with Socket.IO)
- File: `backend/pythonmodel/yolo_fastapi_server.py`
- Purpose: quick ML endpoint testing with YOLOv8 and Socket.IO events without changing Node backend routes.

Run
1. Install dependencies:
  pip install -r backend/pythonmodel/requirements.txt
2. Start server:
  python backend/pythonmodel/yolo_fastapi_server.py

Default URL and endpoints
- Base URL: `http://localhost:8000`
- Health: `GET /health`
- Analyze frame: `POST /api/ml/analyze/enhanced` (multipart form with `file` and optional `camera_id`)
- Detection scores: `GET /api/cameras/{camera_id}/detection-scores`
- Model info: `GET /api/ml/model-info`
- Supported objects: `GET /api/ml/supported-objects`

Socket.IO events
- Inbound: `join_room` with `{ role?, zone?, cameraId? }`
- Outbound: `detection:update`, `ml:scores`, `room:joined`

Optional environment variables
- `YOLO_MODEL_PATH` (default: auto-search then `yolov8n.pt`)
- `YOLO_SERVER_HOST` (default: `0.0.0.0`)
- `YOLO_SERVER_PORT` (default: `8000`)
- `YOLO_CONFIDENCE` (default: `0.25`)
- `YOLO_IOU` (default: `0.45`)
- `YOLO_CORS_ORIGINS` (comma-separated origins)
- `YOLO_FIRE_CLASS_NAMES` (default: `fire,flame`)
- `YOLO_SMOKE_CLASS_NAMES` (default: `smoke`)
- `YOLO_FIRE_ALERT_THRESHOLD` (default: `0.45`)
- `YOLO_COLOR_FALLBACK_ENABLED` (default: `true`)
- `YOLO_COLOR_MIN_REGION_RATIO` (default: `0.0015`)
- `YOLO_COLOR_MAX_REGION_RATIO` (default: `0.95`)

Fire Detection Training (YOLOv8 Fine-Tune)
- Goal: train a model that detects `fire` as an explicit object class, optionally `smoke`.
- Training script: `backend/pythonmodel/train_fire_detector.py`

Dataset format (YOLO)
- Directory layout:
  - `images/train`, `images/val`, optional `images/test`
  - `labels/train`, `labels/val`, optional `labels/test`
- Label file line format:
  - `<class_id> <x_center> <y_center> <width> <height>` (all normalized 0..1)
- Include diverse scenes:
  - indoor fire, outdoor fire, low-light/night fire, smoke + flame, non-fire negatives.

Dataset YAML templates
- Fire only: `backend/pythonmodel/datasets/fire_only.example.yaml`
- Fire + smoke: `backend/pythonmodel/datasets/fire_smoke.example.yaml`

Train command examples
- Fire-only model:
  - `python backend/pythonmodel/train_fire_detector.py --data backend/pythonmodel/datasets/fire_only.example.yaml --model yolov8n.pt --epochs 120 --batch 16 --imgsz 640 --lr0 0.003`
- Fire+smoke model:
  - `python backend/pythonmodel/train_fire_detector.py --data backend/pythonmodel/datasets/fire_smoke.example.yaml --model yolov8n.pt --epochs 140 --batch 16 --imgsz 640 --lr0 0.003`

Use trained weights in FastAPI
1. Find trained best checkpoint (for example `.../weights/best.pt`).
2. Set `YOLO_MODEL_PATH=/absolute/path/to/best.pt`.
3. Restart FastAPI server.

Fire-aware API output
- `POST /api/ml/analyze/enhanced` now includes:
  - `fire_detection.fire_detected` (boolean)
  - `fire_detection.fire_boxes` (bbox + confidence)
  - `fire_detection.smoke_detected` and `smoke_boxes`
  - `analysis.fire_alert` boolean
- Socket events:
  - `fire:alert` is emitted when fire confidence crosses threshold.
