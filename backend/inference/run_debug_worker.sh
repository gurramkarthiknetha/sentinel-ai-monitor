#!/usr/bin/env bash
set -euo pipefail

MODEL_DIR="${1:-}"
SOURCE="${2:-auto}"
CAMERA_ID_ARG="${3:-}"
API_BASE_URL="${API_BASE_URL:-http://localhost:6226/api}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

resolve_python_bin() {
  if [[ -n "${VIRTUAL_ENV:-}" && -x "$VIRTUAL_ENV/bin/python" ]]; then
    echo "$VIRTUAL_ENV/bin/python"
    return 0
  fi

  if [[ -x "$SCRIPT_DIR/.venv/bin/python" ]]; then
    echo "$SCRIPT_DIR/.venv/bin/python"
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
WORKER_PY="$SCRIPT_DIR/rtdetr_crowd_worker.py"

# If a user passes the pdmodel file itself, normalize to its parent directory.
# If any other file is passed (for example the worker .py file), fail with a clear message.
if [[ -n "$MODEL_DIR" && -f "$MODEL_DIR" ]]; then
  if [[ "$(basename "$MODEL_DIR")" == "model.pdmodel" ]]; then
    MODEL_DIR="$(cd "$(dirname "$MODEL_DIR")" && pwd)"
  else
    echo "Error: MODEL_DIR must be a directory containing model.pdmodel, model.pdiparams, and infer_cfg.yml"
    echo "You passed a file path: $MODEL_DIR"
    if [[ "$MODEL_DIR" == *.py ]]; then
      echo "Tip: this is a Python script path, not an exported Paddle model directory."
    fi
    exit 1
  fi
fi

find_model_candidates() {
  local roots=("$REPO_ROOT" "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" "$HOME/clg")
  local found=0

  for root in "${roots[@]}"; do
    if [[ ! -d "$root" ]]; then
      continue
    fi

    while IFS= read -r pdmodel_path; do
      local model_dir="${pdmodel_path%/model.pdmodel}"
      if [[ -f "$model_dir/model.pdiparams" && -f "$model_dir/infer_cfg.yml" ]]; then
        echo "$model_dir"
        found=$((found + 1))
      fi

      if [[ "$found" -ge 10 ]]; then
        return 0
      fi
    done < <(find "$root" -type f -name "model.pdmodel" 2>/dev/null)
  done
}

if [[ -z "$MODEL_DIR" ]]; then
  echo "Usage: $0 <MODEL_DIR> [SOURCE|auto] [CAMERA_ID]"
  echo "Example: $0 /absolute/path/to/exported_rtdetr_model auto 69ccbc181ef189892aa0e313"
  echo
  echo "Tip: do not use placeholder paths like /REAL/MODEL_DIR."
  echo "Searching common folders for exported model directories..."

  MODEL_CANDIDATES="$(find_model_candidates || true)"
  if [[ -n "$MODEL_CANDIDATES" ]]; then
    echo "Found candidate model directories:"
    while IFS= read -r candidate; do
      if [[ -z "$candidate" ]]; then
        continue
      fi
      echo "  - $candidate"
    done <<< "$MODEL_CANDIDATES"
    echo "Run this script again using one of the candidate paths above."
  else
    echo "No exported model directories found in workspace/common folders."
    echo "Export RT-DETR model first so model.pdmodel, model.pdiparams and infer_cfg.yml exist together."
  fi
  exit 1
fi

if [[ "$MODEL_DIR" == *"/REAL/"* || "$MODEL_DIR" == *"EXPORTED/MODEL/FOLDER"* || "$MODEL_DIR" == *"<"* || "$MODEL_DIR" == *">"* ]]; then
  echo "Error: MODEL_DIR uses placeholder text: $MODEL_DIR"
  echo "Replace it with a real exported model directory path."
  exit 1
fi

if [[ "$MODEL_DIR" == *.py ]]; then
  echo "Error: MODEL_DIR must be an exported model directory, not a Python file path."
  echo "You passed: $MODEL_DIR"
  echo "Use a directory containing model.pdmodel, model.pdiparams, and infer_cfg.yml."
  exit 1
fi

if [[ ! -e "$MODEL_DIR" ]]; then
  echo "Error: MODEL_DIR path does not exist: $MODEL_DIR"
  echo "Use an absolute path to the exported model directory."
  exit 1
fi

MODEL_DIR="$(cd "$MODEL_DIR" && pwd)"

if [[ ! -f "$MODEL_DIR/model.pdmodel" ]]; then
  echo "Error: missing $MODEL_DIR/model.pdmodel"
  exit 1
fi

if [[ ! -f "$MODEL_DIR/model.pdiparams" ]]; then
  echo "Error: missing $MODEL_DIR/model.pdiparams"
  exit 1
fi

if [[ ! -f "$MODEL_DIR/infer_cfg.yml" ]]; then
  echo "Error: missing $MODEL_DIR/infer_cfg.yml"
  exit 1
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

payload = json.loads(sys.stdin.read() or "{}")
camera = payload.get("data") or {}
source_type = str(camera.get("sourceType") or "RTSP").upper()
rtsp_url = str(camera.get("rtspUrl") or "").strip()
device_id = str(camera.get("deviceId") or "").strip()

if source_type == "SYSTEM":
  if rtsp_url.startswith("system://"):
    print(rtsp_url)
  elif device_id:
    print(f"system://{device_id}")
  else:
    print("system://default")
else:
  print(rtsp_url or "0")
PY
<<<"$CAMERA_SOURCE_JSON")"
fi

echo "Using CAMERA_ID=$CAMERA_ID"
echo "Using SOURCE=$SOURCE"
echo "Using MODEL_DIR=$MODEL_DIR"
echo "Run this worker in a separate terminal from 'npm run dev'."

action_cmd=(
  "$PYTHON_BIN"
  "$WORKER_PY"
  --model-dir "$MODEL_DIR"
  --source "$SOURCE"
  --camera-id "$CAMERA_ID"
  --api-base-url "$API_BASE_URL"
  --input-size 1280
  --score-threshold 0.05
  --debug-disable-filters
  --debug-output
  --debug-output-frames 20
  --debug-print-frame-stats
  --debug-log-payload
  --show-preview
)

printf 'Running: %q ' "${action_cmd[@]}"
printf '\n'

"${action_cmd[@]}"
