#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RAW_DIR="$SCRIPT_DIR/datasets/raw/firesmoke_v9"
EXTRACT_DIR="$RAW_DIR/extracted"
DATASET_OUT="$SCRIPT_DIR/datasets/prepared/firesmoke_v9"
DATASET_YAML="$SCRIPT_DIR/datasets/fire_smoke.kaggle.yaml"

EPOCHS="${EPOCHS:-100}"
BATCH_SIZE="${BATCH_SIZE:-16}"
IMAGE_SIZE="${IMAGE_SIZE:-640}"
LR0="${LR0:-0.003}"
PATIENCE="${PATIENCE:-30}"
WORKERS="${WORKERS:-4}"
DEVICE="${DEVICE:-auto}"
RUN_NAME="${RUN_NAME:-fire_smoke_kaggle}"

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

resolve_kaggle_bin() {
  if command -v kaggle >/dev/null 2>&1; then
    echo "kaggle"
    return 0
  fi

  if [[ -x "$REPO_ROOT/.venv/bin/kaggle" ]]; then
    echo "$REPO_ROOT/.venv/bin/kaggle"
    return 0
  fi

  return 1
}

PYTHON_BIN="$(resolve_python_bin)"
if ! KAGGLE_BIN="$(resolve_kaggle_bin)"; then
  echo "Error: kaggle CLI not found."
  echo "Install with: $PYTHON_BIN -m pip install kaggle"
  exit 1
fi

if [[ -z "${KAGGLE_USERNAME:-}" || -z "${KAGGLE_KEY:-}" ]]; then
  if [[ ! -f "$HOME/.kaggle/kaggle.json" ]]; then
    echo "Error: Kaggle API credentials are not configured."
    echo "Set KAGGLE_USERNAME and KAGGLE_KEY, or create ~/.kaggle/kaggle.json"
    exit 1
  fi
fi

mkdir -p "$RAW_DIR" "$EXTRACT_DIR"

pushd "$RAW_DIR" >/dev/null

# Required download command from user request.
"$KAGGLE_BIN" datasets download -d roscoekerby/firesmoke-detection-yolo-v9

ZIP_FILE="$(ls -t firesmoke-detection-yolo-v9*.zip 2>/dev/null | head -n 1 || true)"
if [[ -z "$ZIP_FILE" ]]; then
  echo "Error: downloaded zip not found in $RAW_DIR"
  exit 1
fi

unzip -o "$ZIP_FILE" -d "$EXTRACT_DIR" >/dev/null
popd >/dev/null

"$PYTHON_BIN" "$SCRIPT_DIR/prepare_kaggle_fire_smoke_dataset.py" \
  --source "$EXTRACT_DIR" \
  --output "$DATASET_OUT" \
  --yaml-out "$DATASET_YAML"

"$PYTHON_BIN" "$SCRIPT_DIR/train_fire_detector.py" \
  --data "$DATASET_YAML" \
  --model "$SCRIPT_DIR/yolov8n.pt" \
  --epochs "$EPOCHS" \
  --batch "$BATCH_SIZE" \
  --imgsz "$IMAGE_SIZE" \
  --lr0 "$LR0" \
  --patience "$PATIENCE" \
  --workers "$WORKERS" \
  --device "$DEVICE" \
  --name "$RUN_NAME"
