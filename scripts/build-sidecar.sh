#!/usr/bin/env bash
# Compatibility wrapper for Unix development environments.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${PYTHON:-python3}" "$ROOT/scripts/build-sidecar.py" "$@"
