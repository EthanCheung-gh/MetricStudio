#!/usr/bin/env bash
# Build the Python backend into a Tauri sidecar binary with PyInstaller.
#
# Wired into `tauri build` via bundle.externalBin + beforeBuildCommand, so
# packaging always starts from a fresh sidecar. The generated binary lives in
# src-tauri/binaries/ (gitignored) — only this script is committed.
#
# Manual usage:
#   ./scripts/build-sidecar.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Rust host triple, e.g. x86_64-unknown-linux-gnu (Tauri externalBin naming).
TRIPLE="$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')"
if [ -z "$TRIPLE" ]; then
  echo "error: rustc not found; cannot determine target triple" >&2
  exit 1
fi

# Prefer the project venv, fall back to any python3 with PyInstaller.
if [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="python3"
else
  echo "error: python not found (need a venv or python3)" >&2
  exit 1
fi

if ! "$PY" -m PyInstaller --version >/dev/null 2>&1; then
  echo "error: PyInstaller is not installed for $PY" >&2
  echo "  install with: $PY -m pip install pyinstaller" >&2
  exit 1
fi

OUT_DIR="src-tauri/binaries"
mkdir -p "$OUT_DIR"

# --distpath/--workpath/--specpath keep intermediates out of the repo root.
"$PY" -m PyInstaller --onefile --name python-sidecar --paths . \
  --add-data "sample_data.csv:." \
  --distpath dist --workpath build --specpath build backend/main.py

cp "dist/python-sidecar" "$OUT_DIR/python-sidecar-${TRIPLE}"
chmod +x "$OUT_DIR/python-sidecar-${TRIPLE}"
echo "sidecar ready: $OUT_DIR/python-sidecar-${TRIPLE}"
