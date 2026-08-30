#!/usr/bin/env python3
"""Launch a packaged sidecar, verify health and bundled sample import."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=3) as response:
        return json.load(response)


def post_json(url: str) -> dict:
    request = urllib.request.Request(url, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: smoke-sidecar.py PATH_TO_SIDECAR")
    sidecar = Path(sys.argv[1]).resolve()
    if not sidecar.is_file():
        raise SystemExit(f"sidecar not found: {sidecar}")
    port = free_port()
    env = {**os.environ, "METRICSTUDIO_PORT": str(port)}
    process = subprocess.Popen([str(sidecar)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                if get_json(f"http://127.0.0.1:{port}/health").get("status") == "ok":
                    break
            except (OSError, ValueError):
                time.sleep(0.5)
        else:
            raise SystemExit("sidecar health check timed out")
        sample = post_json(f"http://127.0.0.1:{port}/api/v1/data/sample")
        if sample.get("rows", 0) <= 0 or sample.get("cols", 0) <= 0:
            raise SystemExit(f"sample import returned invalid shape: {sample}")
        print(f"sidecar smoke OK: health=ok sample={sample['rows']}x{sample['cols']}")
    finally:
        if os.name == "nt":
            # PyInstaller onefile spawns a child process that actually runs the
            # server and owns the exe handle; terminate() only signals the
            # bootloader parent. Kill the whole process tree instead.
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True)
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


if __name__ == "__main__":
    main()
