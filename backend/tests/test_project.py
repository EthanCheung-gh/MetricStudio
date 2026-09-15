"""Project save: cwd-write fallback (v1.7.1 HarmonyOS-parity fix)."""

from __future__ import annotations

import pytest

import backend.api.project as project_module


def _payload(path: str, name: str = "Demo") -> dict:
    return {"path": path, "name": name, "charts": [], "dashboards": [], "qa_conversations": []}


def test_save_project_relative_path_normal(tmp_path, monkeypatch, client):
    monkeypatch.chdir(tmp_path)
    resp = client.post("/api/v1/project/save", json=_payload("demo.metricstudio"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert not body.get("fallback")
    assert (tmp_path / "demo.metricstudio").is_file()


def test_save_project_relative_unwritable_falls_back(tmp_path, monkeypatch, client):
    """A read-only process cwd must not 500 — fall back to ~/.metricstudio/projects."""
    monkeypatch.chdir(tmp_path)
    original = project_module._write_zip
    calls = {"n": 0}

    def flaky_write(target, payload):
        calls["n"] += 1
        if calls["n"] == 1:
            raise PermissionError(13, "Permission denied")
        return original(target, payload)

    monkeypatch.setattr(project_module, "_write_zip", flaky_write)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setattr(project_module.Path, "home", lambda: tmp_path / "home")

    resp = client.post("/api/v1/project/save", json=_payload("demo.metricstudio"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["fallback"] is True
    assert "demo.metricstudio" in body["path"]
    assert (tmp_path / "home" / ".metricstudio" / "projects" / "demo.metricstudio").is_file()


def test_save_project_absolute_unwritable_reports_500(tmp_path, monkeypatch, client):
    monkeypatch.setattr(
        project_module, "_write_zip",
        lambda target, payload: (_ for _ in ()).throw(PermissionError(13, "Permission denied")),
    )
    resp = client.post("/api/v1/project/save", json=_payload(str(tmp_path / "locked" / "p.metricstudio")))
    assert resp.status_code == 500
    assert "Cannot write to" in resp.json()["detail"]
    assert ".metricstudio" in resp.json()["detail"]  # points at a writable suggestion
