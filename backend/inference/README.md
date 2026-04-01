RT-DETR Crowd Worker (PaddleDetection)

Purpose
- Run exported RT-DETR in real time on CCTV/RTSP/video sources.
- Optimize dense crowd person detection.
- Push detections into backend API for Socket.IO dashboard rendering.

Expected model files
- model.pdmodel
- model.pdiparams
- infer_cfg.yml

These should exist in one exported model directory.

Install
1. Create and activate a Python environment.
2. Install dependencies:
   pip install -r backend/inference/requirements.txt

Fastest way to run deep debug
- The helper script auto-fetches cameraId from your running backend:
  backend/inference/run_debug_worker.sh /absolute/path/to/exported_rtdetr_model [SOURCE|auto] [CAMERA_ID]
- If your shell is already inside backend/, run:
  ./inference/run_debug_worker.sh /absolute/path/to/exported_rtdetr_model [SOURCE|auto] [CAMERA_ID]
- If you are unsure where your model is, run script with no args once. It now scans common folders and prints candidate model directories.
- Example:
  backend/inference/run_debug_worker.sh /absolute/path/to/exported_rtdetr_model auto

System camera mapping behavior
- If camera source is system://default, worker maps it to cv2.VideoCapture(0).
- If source is system://<number>, worker maps to cv2.VideoCapture(<number>).
- If source is system://<non-numeric-device-id>, worker logs a warning and falls back to webcam index 0.

Run (dense crowd baseline)
python backend/inference/rtdetr_crowd_worker.py \
  --model-dir /absolute/path/to/rtdetr_exported_model \
  --source rtsp://username:password@camera-ip:554/stream1 \
  --camera-id YOUR_CAMERA_ID \
  --api-base-url http://localhost:6226/api \
  --input-size 1280 \
  --score-threshold 0.25 \
  --frame-skip 1 \
  --max-detections 800

Critical zero-detection debug flow
1) Static image verification (no stream dependency):
python backend/inference/rtdetr_crowd_worker.py \
  --model-dir /absolute/path/to/rtdetr_exported_model \
  --source 0 \
  --camera-id YOUR_CAMERA_ID \
  --api-base-url http://localhost:6226/api \
  --input-size 1280 \
  --score-threshold 0.05 \
  --debug-static-image /absolute/path/to/test_people_image.jpg \
  --debug-disable-filters \
  --debug-output \
  --debug-log-payload \
  --exit-after-static-test

2) Live stream deep debug:
python backend/inference/rtdetr_crowd_worker.py \
  --model-dir /absolute/path/to/rtdetr_exported_model \
  --source rtsp://username:password@camera-ip:554/stream1 \
  --camera-id YOUR_CAMERA_ID \
  --api-base-url http://localhost:6226/api \
  --input-size 1280 \
  --score-threshold 0.05 \
  --debug-disable-filters \
  --debug-output \
  --debug-output-frames 20 \
  --debug-log-payload \
  --show-preview

What these debug flags do
- --debug-output: prints raw model output tensor names, shapes, min/max, and bbox sample rows.
- --debug-disable-filters: disables score/person/NMS filters to expose raw detections.
- --parser-mode auto: automatically chooses bbox row layout from common RT-DETR export formats.
- --debug-static-image: verifies model/inference path independent of live stream.
- --debug-log-payload: prints outgoing payload sample before POST to backend.

Recommended high-density tuning
- score-threshold: 0.20 to 0.30
- input-size: 960 or 1280
- keep --enable-post-nms disabled for denser outputs
- if extra NMS is needed, use:
  --enable-post-nms --post-nms-iou-threshold 0.85

JSON payload sent to backend
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
- By default, only class 0 (person) is sent. Use --all-classes to disable that filter.
- The worker sends ONLINE heartbeat updates to keep camera state fresh.
- Press q to stop when using --show-preview.
