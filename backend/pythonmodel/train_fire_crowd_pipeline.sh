#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

EPOCHS="${EPOCHS:-20}"
BATCH_SIZE="${BATCH_SIZE:-16}"
IMAGE_SIZE="${IMAGE_SIZE:-320}"
LR0="${LR0:-0.003}"
PATIENCE="${PATIENCE:-20}"
WORKERS="${WORKERS:-2}"
DEVICE="${DEVICE:-auto}"
RUN_NAME="${RUN_NAME:-fire_crowd_yolov8n}"
CROWD_LABEL_MODEL="${CROWD_LABEL_MODEL:-$SCRIPT_DIR/yolo26n.pt}"
MAX_FIRE_IMAGES="${MAX_FIRE_IMAGES:-0}"
MAX_CROWD_IMAGES="${MAX_CROWD_IMAGES:-0}"
VAL_RATIO="${VAL_RATIO:-0.2}"

resolve_python_bin() {
  if [[ -n "${VIRTUAL_ENV:-}" && -x "$VIRTUAL_ENV/bin/python" ]]; then
    echo "$VIRTUAL_ENV/bin/python"
    return 0
  fi

  if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    echo "$REPO_ROOT/.venv/bin/python"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return 0
  fi

  echo "python"
}

PYTHON_BIN="$(resolve_python_bin)"

"$PYTHON_BIN" "$SCRIPT_DIR/train_fire_crowd_pipeline.py" \
  --model "$SCRIPT_DIR/yolov8n.pt" \
  --crowd-label-model "$CROWD_LABEL_MODEL" \
  --epochs "$EPOCHS" \
  --batch "$BATCH_SIZE" \
  --imgsz "$IMAGE_SIZE" \
  --lr0 "$LR0" \
  --patience "$PATIENCE" \
  --workers "$WORKERS" \
  --device "$DEVICE" \
  --name "$RUN_NAME" \
  --max-fire-images "$MAX_FIRE_IMAGES" \
  --max-crowd-images "$MAX_CROWD_IMAGES" \
  --val-ratio "$VAL_RATIO" \
  "$@"
