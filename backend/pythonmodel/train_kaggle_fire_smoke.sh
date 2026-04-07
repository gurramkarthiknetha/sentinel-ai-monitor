#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[deprecated] train_kaggle_fire_smoke.sh now forwards to fire+crowd pipeline."
echo "[deprecated] Use train_fire_crowd_pipeline.sh for new runs."

exec "$SCRIPT_DIR/train_fire_crowd_pipeline.sh" "$@"
