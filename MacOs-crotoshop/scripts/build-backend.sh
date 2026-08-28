#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/backend/.venv"

if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$ROOT/backend/requirements.txt"
mkdir -p "$ROOT/backend-models"
if [[ ! -f "$ROOT/backend-models/isnet-general-use.onnx" ]]; then
  curl -fL "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx" -o "$ROOT/backend-models/isnet-general-use.onnx"
fi
rm -rf "$ROOT/backend-dist" "$ROOT/backend-build"
"$VENV/bin/pyinstaller" \
  --noconfirm \
  --clean \
  --onedir \
  --name crotoshop-ai \
  --distpath "$ROOT/backend-dist" \
  --workpath "$ROOT/backend-build" \
  --specpath "$ROOT/backend-build" \
  "$ROOT/backend/crotoshop_ai.py"
