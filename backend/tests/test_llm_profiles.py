"""Tests for LLM profile management: persistence, migration, recovery, API."""

from __future__ import annotations

import json

import pytest

import backend.core.llm as llm


@pytest.fixture(autouse=True)
def _isolated_config_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("METRICSTUDIO_CONFIG_DIR", str(tmp_path))
    return tmp_path


def test_default_store_created_on_first_load(tmp_path):
    assert llm.load_config() == {**llm.DEFAULT_CONFIG}
    # First load materializes the default store with a stable id.
    path = tmp_path / "llm-profiles.json"
    assert path.exists()
    assert path.stat().st_mode & 0o777 == 0o600
    first = llm.list_profiles()
    assert first["version"] == 2
    assert len(first["profiles"]) == 1
    assert first["active"] == first["profiles"][0]["id"]
    assert llm.list_profiles()["active"] == first["active"]


def test_legacy_config_is_migrated(tmp_path):
    legacy = {
        "base_url": "https://old.example/v1",
        "model": "old-model",
        "api_key": "sk-old",
        "provider": "cloud",
        "data_scope": "all",
    }
    (tmp_path / "llm-config.json").write_text(json.dumps(legacy), encoding="utf-8")

    store = llm.list_profiles()
    assert len(store["profiles"]) == 1
    profile = store["profiles"][0]
    assert profile["base_url"] == "https://old.example/v1"
    assert profile["api_key"] == "sk-old"
    assert llm.load_config()["api_key"] == "sk-old"
    # The legacy file stays on disk as an extra safety copy.
    assert (tmp_path / "llm-config.json").exists()


def test_create_activate_update_delete_flow(client):
    default_view = client.get("/api/v1/nl/profiles").json()
    assert len(default_view["profiles"]) == 1
    default_id = default_view["profiles"][0]["id"]

    payload = {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "api_key": "sk-abc12345",
        "provider": "cloud",
        "data_scope": "redact_sensitive",
    }
    resp = client.post("/api/v1/nl/profiles", json=payload)
    assert resp.status_code == 200, resp.text
    created = resp.json()
    new_id = created["created_id"]
    assert created["active_id"] == new_id
    view = next(p for p in created["profiles"] if p["id"] == new_id)
    assert view["has_api_key"] is True
    assert view["api_key_hint"] == "2345"
    assert "api_key" not in view
    assert llm.load_config()["base_url"] == "https://api.deepseek.com/v1"

    # Updating with a blank key keeps the stored secret.
    resp = client.put(
        f"/api/v1/nl/profiles/{new_id}",
        json={**payload, "name": "DeepSeek v2", "base_url": "https://api2.deepseek.com/v1", "api_key": ""},
    )
    assert resp.status_code == 200, resp.text
    flat = llm.load_config()
    assert flat["api_key"] == "sk-abc12345"
    assert flat["base_url"] == "https://api2.deepseek.com/v1"
    assert flat["data_scope"] == "redact_sensitive"

    # Clearing the key requires the explicit flag.
    resp = client.put(f"/api/v1/nl/profiles/{new_id}", json={**payload, "api_key": "", "clear_api_key": True})
    assert resp.status_code == 200
    assert llm.load_config()["api_key"] == ""

    # Switching the active profile changes what every LLM feature uses.
    resp = client.post(f"/api/v1/nl/profiles/{default_id}/activate")
    assert resp.status_code == 200
    assert llm.load_config()["base_url"] == llm.DEFAULT_CONFIG["base_url"]

    # Deleting the active profile falls back to the remaining one.
    resp = client.delete(f"/api/v1/nl/profiles/{default_id}")
    assert resp.status_code == 200
    assert resp.json()["active_id"] == new_id


def test_delete_last_profile_recreates_default(client):
    only_id = client.get("/api/v1/nl/profiles").json()["profiles"][0]["id"]
    resp = client.delete(f"/api/v1/nl/profiles/{only_id}")
    assert resp.status_code == 200
    store = resp.json()
    assert len(store["profiles"]) == 1
    assert store["active_id"] == store["profiles"][0]["id"]
    assert client.get("/api/v1/nl/profiles").status_code == 200


def test_unknown_profile_returns_404(client):
    assert client.delete("/api/v1/nl/profiles/nope").status_code == 404
    assert client.post("/api/v1/nl/profiles/nope/activate").status_code == 404
    resp = client.put("/api/v1/nl/profiles/nope", json={"base_url": "http://x/v1", "model": "m"})
    assert resp.status_code == 404


def test_corrupt_main_file_is_healed_from_backup(tmp_path):
    llm.save_config(llm.DEFAULT_CONFIG)  # ensure a store exists on disk
    main = tmp_path / "llm-profiles.json"
    backup = tmp_path / "llm-profiles.json.bak"
    backup.write_text(main.read_text(encoding="utf-8"), encoding="utf-8")
    main.write_text("{corrupted", encoding="utf-8")

    store = llm.list_profiles()
    assert len(store["profiles"]) >= 1
    # The main file is rewritten from the backup on the next save/heal pass.
    assert main.read_text(encoding="utf-8") != "{corrupted"


def test_test_endpoint_probes_without_saving(client, monkeypatch):
    calls: dict[tuple[str, str, str], None] = {}

    def fake_probe(base_url, model, api_key, timeout=10.0):
        calls[(base_url, model, api_key)] = None
        return True, 42, ""

    monkeypatch.setattr("backend.api.nl.probe_llm", fake_probe)
    resp = client.post("/api/v1/nl/test", json={"base_url": "http://probe.invalid/v1", "model": "m"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "latency_ms": 42, "error": ""}
    assert list(calls)[0][0] == "http://probe.invalid/v1"
    # Nothing was persisted by the probe.
    assert llm.load_config()["base_url"] == llm.DEFAULT_CONFIG["base_url"]


def test_test_endpoint_reports_failure(client, monkeypatch):
    monkeypatch.setattr("backend.api.nl.probe_llm", lambda *a, **k: (False, 0, "HTTP 401: bad key"))
    resp = client.post("/api/v1/nl/test", json={"base_url": "http://x/v1", "model": "m", "api_key": "k"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert "401" in body["error"]


def test_test_endpoint_falls_back_to_active_config(client, monkeypatch):
    calls: dict[tuple[str, str, str], None] = {}

    def fake_probe(base_url, model, api_key, timeout=10.0):
        calls[(base_url, model, api_key)] = None
        return True, 7, ""

    monkeypatch.setattr("backend.api.nl.probe_llm", fake_probe)
    resp = client.post("/api/v1/nl/test", json={})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "latency_ms": 7, "error": ""}
    base_url, model, _ = list(calls)[0]
    assert base_url == llm.DEFAULT_CONFIG["base_url"]
    assert model == llm.DEFAULT_CONFIG["model"]
