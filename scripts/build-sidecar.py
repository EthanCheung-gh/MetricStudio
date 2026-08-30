#!/usr/bin/env python3
"""Build the FastAPI backend as the Tauri external sidecar."""
from __future__ import annotations
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_file(src: Path, dst: Path) -> None:
    """Copy src over dst, tolerating transient Windows locks.

    The smoke test may have just executed the previous sidecar; on Windows a
    recently-exited executable can stay locked for a moment (antivirus scan,
    handle release), so unlink+copy is retried a few times before giving up.
    """
    for attempt in range(5):
        try:
            dst.unlink(missing_ok=True)
            shutil.copy2(src, dst)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(1.5 * (attempt + 1))


def main() -> None:
    try:
        rust_info = subprocess.check_output(["rustc", "-vV"], cwd=ROOT, text=True)
        triple = next(line.split("host: ", 1)[1] for line in rust_info.splitlines() if line.startswith("host: "))
    except (FileNotFoundError, StopIteration, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"error: rustc host triple unavailable: {exc}") from exc
    candidates = [
        ROOT / "backend" / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"),
        ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"),
        Path(sys.executable),
    ]
    python = str(next((path for path in candidates if path.exists()), Path(sys.executable)))
    try:
        subprocess.run([python, "-m", "PyInstaller", "--version"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"error: PyInstaller is not installed for {python}") from exc
    out_dir = ROOT / "src-tauri" / "binaries"
    out_dir.mkdir(parents=True, exist_ok=True)
    executable = "python-sidecar.exe" if os.name == "nt" else "python-sidecar"
    subprocess.run([
        python, "-m", "PyInstaller", "--onefile", "--name", "python-sidecar",
        "--paths", str(ROOT), "--add-data", f"{ROOT / 'sample_data.csv'}{os.pathsep}.",
        "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build"), "--specpath", str(ROOT / "build"),
        str(ROOT / "backend" / "main.py"),
    ], cwd=ROOT, check=True)
    built = ROOT / "dist" / executable
    target = out_dir / f"python-sidecar-{triple}{'.exe' if os.name == 'nt' else ''}"
    if not built.exists():
        raise SystemExit(f"error: PyInstaller output not found: {built}")
    replace_file(built, target)
    if os.name != "nt":
        target.chmod(0o755)
    print(f"sidecar ready: {target}")

if __name__ == "__main__":
    main()
