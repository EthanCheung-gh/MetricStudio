"""LLM provider abstraction (OpenAI-compatible chat completions).

Supports local Ollama (base_url=http://localhost:11434/v1, no key) and any
OpenAI-compatible remote API.

Configuration management:
- Profiles persist under <config-dir>/llm-profiles.json (mode 0600). One of
  them is "active" and is what every LLM feature uses.
- The config dir defaults to ~/.metricstudio and can be pinned with the
  METRICSTUDIO_CONFIG_DIR environment variable, so debug sessions and LAN
  deployments never scatter settings across different HOME directories.
- Every write first copies the previous file to llm-profiles.json.bak; if the
  main file is ever corrupted, the backup is used instead of silently
  resetting to defaults.
- The legacy single-config llm-config.json is migrated automatically on
  first load and kept on disk as an extra safety copy.
"""

from __future__ import annotations

import copy
import json
import os
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any

import httpx

PROFILE_FIELDS = ("base_url", "model", "api_key", "provider", "data_scope")

DEFAULT_CONFIG: dict[str, str] = {
    "base_url": "http://localhost:11434/v1",
    "model": "llama3",
    "api_key": "",
    "provider": "local",
    "data_scope": "all",
}

_LOCK = threading.Lock()


def _config_dir() -> Path:
    override = os.environ.get("METRICSTUDIO_CONFIG_DIR", "").strip()
    return Path(override).expanduser() if override else Path.home() / ".metricstudio"


def _profiles_path() -> Path:
    return _config_dir() / "llm-profiles.json"


def _backup_path() -> Path:
    return _config_dir() / "llm-profiles.json.bak"


def _legacy_path() -> Path:
    return _config_dir() / "llm-config.json"


def _new_profile(name: str = "Default", **overrides: str) -> dict[str, str]:
    profile = {"id": uuid.uuid4().hex[:12], "name": name, **DEFAULT_CONFIG}
    profile.update({k: str(v) for k, v in overrides.items() if k in PROFILE_FIELDS})
    return profile


def _sanitize_profile(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    profile_id = raw.get("id")
    if not isinstance(profile_id, str) or not profile_id:
        return None
    profile = _new_profile()
    profile["id"] = profile_id
    name = raw.get("name")
    profile["name"] = name.strip() if isinstance(name, str) and name.strip() else "Unnamed"
    for field in PROFILE_FIELDS:
        value = raw.get(field)
        if isinstance(value, str):
            profile[field] = value
    return profile


def _migrate_legacy() -> dict[str, Any] | None:
    """Convert the legacy single-config file into a one-profile store.

    Returns the new store, or None when there is nothing to migrate. The
    legacy file is intentionally left on disk as an extra backup.
    """
    legacy = _legacy_path()
    if not legacy.exists():
        return None
    try:
        data = json.loads(legacy.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    profile = _new_profile(**{k: str(v) for k, v in data.items() if isinstance(v, str)})
    return {"version": 2, "active": profile["id"], "profiles": [profile]}


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_store() -> dict[str, Any]:
    """Load the profile store; fall back to backup, then legacy, then fresh."""
    path = _profiles_path()
    data: Any = None
    restored_from_backup = False
    if path.exists():
        try:
            data = _read_json(path)
        except (json.JSONDecodeError, OSError):
            backup = _backup_path()
            if backup.exists():
                try:
                    data = _read_json(backup)
                    restored_from_backup = True
                except (json.JSONDecodeError, OSError):
                    data = None
    if data is None:
        migrated = _migrate_legacy()
        if migrated is not None:
            _write_store(migrated)
            return migrated
        # Materialize the fresh default store so profile ids stay stable.
        fresh = _fresh_store()
        _write_store(fresh)
        return fresh
    if restored_from_backup:
        # Heal the main file from the backup so the next read is clean.
        _write_store(data if isinstance(data, dict) else _fresh_store())
    return _normalize_store(data)


def _fresh_store() -> dict[str, Any]:
    profile = _new_profile()
    return {"version": 2, "active": profile["id"], "profiles": [profile]}


def _normalize_store(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return _fresh_store()
    profiles_raw = data.get("profiles")
    profiles = [p for p in (_sanitize_profile(item) for item in profiles_raw or []) if p]
    if not profiles:
        return _fresh_store()
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for profile in profiles:
        if profile["id"] not in seen:
            seen.add(profile["id"])
            unique.append(profile)
    active = data.get("active")
    if not isinstance(active, str) or active not in seen:
        active = unique[0]["id"]
    return {"version": 2, "active": active, "profiles": unique}


def _write_store(store: dict[str, Any]) -> None:
    path = _profiles_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        shutil.copyfile(path, _backup_path())
    temp_path = path.with_suffix(".tmp")
    fd = os.open(temp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(store, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    temp_path.replace(path)


def _active_profile(store: dict[str, Any]) -> dict[str, str]:
    for profile in store["profiles"]:
        if profile["id"] == store["active"]:
            return profile
    return store["profiles"][0]


def load_config() -> dict[str, str]:
    """Flat view of the active profile (back-compat for all LLM callers)."""
    with _LOCK:
        profile = _active_profile(_load_store())
    return {**DEFAULT_CONFIG, **{k: profile.get(k, DEFAULT_CONFIG[k]) for k in PROFILE_FIELDS}}


def save_config(config: dict[str, str]) -> None:
    """Update the active profile in place (back-compat POST /config path)."""
    updates = {k: str(config.get(k, DEFAULT_CONFIG[k])) for k in PROFILE_FIELDS}
    with _LOCK:
        store = _load_store()
        profile = _active_profile(store)
        profile.update(updates)
        _write_store(store)


def list_profiles() -> dict[str, Any]:
    with _LOCK:
        return copy.deepcopy(_load_store())


def create_profile(payload: dict[str, Any]) -> dict[str, Any]:
    updates = {k: str(payload.get(k, DEFAULT_CONFIG[k])) for k in PROFILE_FIELDS}
    name = str(payload.get("name", "")).strip() or "Unnamed"
    with _LOCK:
        store = _load_store()
        profile = _new_profile(name=name, **updates)
        store["profiles"].append(profile)
        store["active"] = profile["id"]
        _write_store(store)
        return copy.deepcopy(store)


def update_profile(profile_id: str, payload: dict[str, Any], *, clear_api_key: bool = False) -> dict[str, Any]:
    with _LOCK:
        store = _load_store()
        profile = next((p for p in store["profiles"] if p["id"] == profile_id), None)
        if profile is None:
            raise KeyError(f"unknown profile: {profile_id}")
        old_key = profile.get("api_key", "")
        name = str(payload.get("name", "")).strip()
        if name:
            profile["name"] = name
        for field in PROFILE_FIELDS:
            if field in payload and payload[field] is not None:
                profile[field] = str(payload[field])
        new_key = str(payload.get("api_key", "") or "").strip()
        if clear_api_key:
            profile["api_key"] = ""
        elif not new_key:
            profile["api_key"] = old_key
        _write_store(store)
        return copy.deepcopy(store)


def delete_profile(profile_id: str) -> dict[str, Any]:
    with _LOCK:
        store = _load_store()
        remaining = [p for p in store["profiles"] if p["id"] != profile_id]
        if len(remaining) == len(store["profiles"]):
            raise KeyError(f"unknown profile: {profile_id}")
        if remaining:
            store["profiles"] = remaining
            if store["active"] == profile_id:
                store["active"] = remaining[0]["id"]
        else:
            store = _fresh_store()
        _write_store(store)
        return copy.deepcopy(store)


def activate_profile(profile_id: str) -> dict[str, Any]:
    with _LOCK:
        store = _load_store()
        if not any(p["id"] == profile_id for p in store["profiles"]):
            raise KeyError(f"unknown profile: {profile_id}")
        store["active"] = profile_id
        _write_store(store)
        return copy.deepcopy(store)


def probe_llm(base_url: str, model: str, api_key: str = "", timeout: float = 10.0) -> tuple[bool, int, str]:
    """Send a tiny chat request. Returns (ok, latency_ms, error_message)."""
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 4,
        "stream": False,
    }
    try:
        response = httpx.post(url, json=payload, headers=headers, timeout=timeout)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = ""
        try:
            detail = exc.response.json().get("error", {}).get("message", "")
        except Exception:
            detail = exc.response.text[:200]
        return False, 0, f"HTTP {exc.response.status_code}: {detail or exc.response.reason_phrase}"
    except httpx.HTTPError as exc:
        return False, 0, str(exc) or exc.__class__.__name__
    except OSError as exc:
        return False, 0, str(exc)
    return True, int(response.elapsed.total_seconds() * 1000), ""


def chat(messages: list[dict[str, str]], config: dict[str, str] | None = None) -> str:
    """Send a chat request and return the assistant's text content.

    Raises an exception when the provider is unreachable or returns an error
    (the caller surfaces it to the user; no silent fallback).
    """
    cfg = config or load_config()
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"

    payload: dict[str, Any] = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": 0,
        "stream": False,
    }
    resp = httpx.post(url, json=payload, headers=headers, timeout=60.0)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]
