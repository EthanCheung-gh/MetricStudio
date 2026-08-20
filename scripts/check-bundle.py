#!/usr/bin/env python3
"""Check that a Tauri bundle contains the app and external sidecar."""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: check-bundle.py PATH_TO_BUNDLE")
    bundle = Path(sys.argv[1]).resolve()
    if not bundle.is_file():
        raise SystemExit(f"bundle not found: {bundle}")
    if bundle.suffix == ".deb":
        members = subprocess.check_output(["ar", "t", str(bundle)], text=True).splitlines()
        data_name = next((name for name in members if name.startswith("data.tar")), None)
        if not data_name:
            raise SystemExit("deb has no data archive")
        data = subprocess.check_output(["ar", "p", str(bundle), data_name])
        paths = subprocess.check_output(["tar", "-tzf", "-"], input=data, text=False).decode()
    elif bundle.suffix == ".rpm":
        paths = subprocess.check_output(["rpm", "-qlp", str(bundle)], text=True)
    else:
        raise SystemExit(f"unsupported bundle type: {bundle.suffix}")
    required = ("usr/bin/metricstudio", "usr/bin/python-sidecar")
    missing = [path for path in required if path not in paths]
    if missing:
        raise SystemExit(f"bundle is missing: {', '.join(missing)}")
    print(f"bundle check OK: {bundle.name}")

if __name__ == "__main__":
    main()
