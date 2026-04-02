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