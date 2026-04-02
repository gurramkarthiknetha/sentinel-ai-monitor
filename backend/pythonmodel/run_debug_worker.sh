#!/usr/bin/env bash
set -euo pipefail

MODEL_PATH="${1:-}"
SOURCE="${2:-auto}"
CAMERA_ID_ARG="${3:-}"
API_BASE_URL="${API_BASE_URL:-http://localhost:6226/api}"
MIN_BOX_AREA_RATIO="${RTDETR_MIN_BOX_AREA_RATIO:-0.0005}"
MAX_BOX_AREA_RATIO="${RTDETR_MAX_BOX_AREA_RATIO:-0.90}"
EXCLUDE_CLASS_IDS="${RTDETR_EXCLUDE_CLASS_IDS:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

resolve_python_bin() {
  if [[ -n "${VIRTUAL_ENV:-}" && -x "$VIRTUAL_ENV/bin/python" ]]; then
    echo "$VIRTUAL_ENV/bin/python"
    return 0
  fi

  if [[ -x "$SCRIPT_DIR/.venv/bin/python" ]]; then
    echo "$SCRIPT_DIR/.venv/bin/python"
    return 0
  fi

  if [[ -x "$BACKEND_ROOT/.venv/bin/python" ]]; then
    echo "$BACKEND_ROOT/.venv/bin/python"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return 0
  fi

  echo "python"
}

PYTHON_BIN="$(resolve_python_bin)"
WORKER_PY="$SCRIPT_DIR/rtdetr_crowd_worker.py"

find_model_candidates() {
  local roots=("$BACKEND_ROOT" "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" "$HOME/clg")
  local found=0

  for root in "${roots[@]}"; do
    if [[ ! -d "$root" ]]; then
      continue
    fi

    while IFS= read -r model_file; do
      echo "$model_file"
      found=$((found + 1))
      if [[ "$found" -ge 10 ]]; then
        return 0
      fi
    done < <(find "$root" -type f \( -name "*rtdetr*.pt" -o -name "*rt-detr*.pt" \) 2>/dev/null)
  done
}

if [[ -z "$MODEL_PATH" ]]; then
  echo "Usage: $0 <MODEL_PATH.pt> [SOURCE|auto] [CAMERA_ID]"
  echo "Example: $0 $BACKEND_ROOT/rtdetr-l.pt auto 69ccbc181ef189892aa0e313"
  echo
  echo "Searching for RT-DETR model candidates..."

  MODEL_CANDIDATES="$(find_model_candidates || true)"
  if [[ -n "$MODEL_CANDIDATES" ]]; then
    echo "Found candidate model files:"
    while IFS= read -r candidate; do
      [[ -z "$candidate" ]] && continue
      echo "  - $candidate"
    done <<< "$MODEL_CANDIDATES"
  else
    echo "No RT-DETR .pt models found in common folders."
  fi

  exit 1
fi

if [[ -d "$MODEL_PATH" ]]; then
  FIRST_PT="$(find "$MODEL_PATH" -maxdepth 1 -type f \( -name "*rtdetr*.pt" -o -name "*rt-detr*.pt" \) | head -n 1 || true)"
  if [[ -n "$FIRST_PT" ]]; then
    MODEL_PATH="$FIRST_PT"
  else
    echo "Error: directory does not contain an RT-DETR .pt file: $MODEL_PATH"
    exit 1
  fi
fi

if [[ "$MODEL_PATH" == *"/REAL/"* || "$MODEL_PATH" == *"<"* || "$MODEL_PATH" == *">"* ]]; then
  echo "Error: MODEL_PATH uses placeholder text: $MODEL_PATH"
  exit 1
fi

if [[ "$MODEL_PATH" == *.py ]]; then
  echo "Error: MODEL_PATH must be a .pt model, not a Python script path."
  echo "You passed: $MODEL_PATH"
  exit 1
fi

# Allow built-in Ultralytics names like rtdetr-l.pt.
if [[ "$MODEL_PATH" == *.pt && "$MODEL_PATH" != */* ]]; then
  :
else
  if [[ ! -f "$MODEL_PATH" ]]; then
    echo "Error: MODEL_PATH does not exist: $MODEL_PATH"
    exit 1
  fi

  MODEL_PATH="$(cd "$(dirname "$MODEL_PATH")" && pwd)/$(basename "$MODEL_PATH")"
fi

CAMERA_JSON="$(curl -s "$API_BASE_URL/cameras")"
DEFAULT_CAMERA_ID="$($PYTHON_BIN - <<'PY'
import json
import sys

payload = json.loads(sys.stdin.read() or "{}")
data = payload.get("data") or []
if not data:
    print("")
    raise SystemExit(0)

print(data[0].get("_id", ""))
PY
<<<"$CAMERA_JSON")"

CAMERA_ID="${CAMERA_ID_ARG:-$DEFAULT_CAMERA_ID}"

if [[ -z "$CAMERA_ID" ]]; then
  echo "Error: no cameras found at $API_BASE_URL/cameras"
  echo "Create a camera in UI first, then retry."
  exit 1
fi

if [[ "$SOURCE" == "auto" ]]; then
  CAMERA_SOURCE_JSON="$(curl -s "$API_BASE_URL/cameras/$CAMERA_ID")"
  SOURCE="$($PYTHON_BIN - <<'PY'
import json
import sys
from urllib.parse import unquote

payload = json.loads(sys.stdin.read() or "{}")
camera = payload.get("data") or {}
source_type = str(camera.get("sourceType") or "RTSP").upper()
rtsp_url = str(camera.get("rtspUrl") or "").strip()
device_id = str(camera.get("deviceId") or "").strip()


def parse_device_index(value):
  if isinstance(value, bool):
    return None

  if isinstance(value, int) and value >= 0:
    return value

  if value is None:
    return None

  raw = str(value).strip()
  if not raw:
    return None

  if raw.isdigit():
    return int(raw)

  lowered = raw.lower()
  for prefix in ("camera", "cam", "video"):
    if lowered.startswith(prefix):
      suffix = lowered[len(prefix):].strip()
      if suffix.isdigit():
        return int(suffix)

  return None


def parse_device_index_from_system_url(url):
  if not isinstance(url, str) or not url.lower().startswith("system://"):
    return None

  encoded_part = url[len("system://"):].strip()
  if not encoded_part:
    return None

  decoded_part = unquote(encoded_part)
  return parse_device_index(decoded_part)

if source_type == "SYSTEM":
  device_index = (
    parse_device_index(camera.get("deviceIndex"))
    or parse_device_index_from_system_url(rtsp_url)
    or parse_device_index(device_id)
  )

  if device_index is None:
    device_index = 0

  print(f"system://{device_index}")
else:
    print(rtsp_url or "0")
PY
<<<"$CAMERA_SOURCE_JSON")"
fi

echo "Using CAMERA_ID=$CAMERA_ID"
echo "Using SOURCE=$SOURCE"
echo "Using MODEL_PATH=$MODEL_PATH"
echo "Run this worker in a separate terminal from 'npm run dev'."

action_cmd=(
  "$PYTHON_BIN"
  "$WORKER_PY"
  --model-path "$MODEL_PATH"
  --source "$SOURCE"
  --camera-id "$CAMERA_ID"
  --api-base-url "$API_BASE_URL"
  --input-size 960
  --score-threshold 0.20
  --iou-threshold 0.70
  --min-box-area-ratio "$MIN_BOX_AREA_RATIO"
  --max-box-area-ratio "$MAX_BOX_AREA_RATIO"
  --frame-skip 1
  --debug-log-payload
  --show-preview
)

if [[ -n "$EXCLUDE_CLASS_IDS" ]]; then
  action_cmd+=(--exclude-class-ids "$EXCLUDE_CLASS_IDS")
fi

printf 'Running: %q ' "${action_cmd[@]}"
printf '\n'

"${action_cmd[@]}"