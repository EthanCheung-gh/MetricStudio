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
import logging
import os
import random
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

from backend.core.logging_setup import get_logger

PROFILE_FIELDS = ("base_url", "model", "api_key", "provider", "data_scope", "max_tokens", "stream_usage")

DEFAULT_CONFIG: dict[str, str] = {
    "base_url": "http://localhost:11434/v1",
    "model": "llama3",
    "api_key": "",
    "provider": "local",
    "data_scope": "all",
    "max_tokens": "0",
    "stream_usage": "true",
}

# v1.10.0: providers that reject stream_options are remembered here
# (keyed by base_url|model) so later calls skip the field entirely.
_STREAM_USAGE_DEMOTED: set[str] = set()

# v1.9.0 transient-failure retry: 1 try + 2 retries with 0.4s -> 1.2s backoff.
MAX_LLM_ATTEMPTS = 3
_BACKOFF_BASE_S = 0.4
_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

_LOCK = threading.Lock()


def _is_retryable(exc: BaseException) -> bool:
    """Transient failures only: transport errors and 429/5xx.

    Auth errors, unknown models and bad requests are deterministic — retrying
    them just adds latency before the same failure.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE_STATUS
    return isinstance(exc, httpx.TransportError)


def _retry_delay_s(attempt: int) -> float:
    """Exponential backoff (0.4s, 1.2s) with +/-20% jitter."""
    delay = _BACKOFF_BASE_S * (3 ** (attempt - 1))
    return delay * (0.8 + 0.4 * random.random())


def _log_llm_retry(*, span: str, attempt: int, error: str, delay_s: float) -> None:
    get_logger("llm").event(
        "llm_retry",
        span=span,
        attempt=attempt,
        error=error,
        delay_ms=round(delay_s * 1000, 1),
    )


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


def max_tokens_from_config(cfg: dict[str, str]) -> int:
    """Parse the profile's max_tokens cap (v1.9.0). 0 / invalid = no cap.

    The cap is stored as a string like every other profile field; the API
    payload only carries it when positive so providers keep their defaults.
    """
    raw = str(cfg.get("max_tokens", "") or "").strip()
    if not raw:
        return 0
    try:
        value = int(float(raw))
    except ValueError:
        return 0
    return max(0, value)


def stream_usage_from_config(cfg: dict[str, str]) -> bool:
    """Whether to request token usage in streaming mode (v1.10.0).

    Defaults to true; providers that reject stream_options are demoted
    automatically for the lifetime of the process.
    """
    raw = str(cfg.get("stream_usage", "true")).strip().lower()
    return raw not in ("false", "0", "no", "off")


def _estimate_tokens(length: int) -> int:
    """~3.2 chars per token, a conservative middle for mixed zh/en text."""
    return int(round(length / 3.2)) if length > 0 else 0


def _usage_from(obj: Any) -> dict[str, Any] | None:
    """Extract {prompt, completion, total} from an OpenAI usage object."""
    if not isinstance(obj, dict):
        return None
    usage = obj.get("usage")
    if not isinstance(usage, dict):
        return None
    prompt = usage.get("prompt_tokens")
    completion = usage.get("completion_tokens")
    if not isinstance(prompt, int) or not isinstance(completion, int):
        return None
    total = usage.get("total_tokens")
    return {
        "prompt": prompt,
        "completion": completion,
        "total": total if isinstance(total, int) else prompt + completion,
    }


def _finalize_usage(usage: dict[str, Any] | None, prompt_chars: int, reply_chars: int) -> dict[str, Any]:
    """Attach the estimated flag; fall back to a chars-based estimate."""
    if usage is not None:
        return {**usage, "estimated": False}
    prompt = _estimate_tokens(prompt_chars)
    completion = _estimate_tokens(reply_chars)
    return {"prompt": prompt, "completion": completion, "total": prompt + completion, "estimated": True}


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


def chat(
    messages: list[dict[str, str]],
    config: dict[str, str] | None = None,
    usage_out: dict[str, Any] | None = None,
) -> str:
    """Send a chat request and return the assistant's text content.

    Raises an exception when the provider is unreachable or returns an error
    (the caller surfaces it to the user; no silent fallback). Transient
    failures (transport errors, 429/5xx) are retried up to MAX_LLM_ATTEMPTS
    with backoff before surfacing (v1.9.0). When ``usage_out`` is given it is
    filled with the call's token usage — real numbers when the provider
    reports them, a chars-based estimate flagged estimated=True otherwise
    (v1.10.0).
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
    max_tokens = max_tokens_from_config(cfg)
    if max_tokens > 0:
        payload["max_tokens"] = max_tokens
    started = time.monotonic()
    prompt_chars = sum(len(m.get("content", "")) for m in messages)
    attempts = 0
    while True:
        attempts += 1
        try:
            resp = httpx.post(url, json=payload, headers=headers, timeout=60.0)
            resp.raise_for_status()
            data = resp.json()
            reply = data["choices"][0]["message"]["content"]
        except Exception as exc:
            if attempts < MAX_LLM_ATTEMPTS and _is_retryable(exc):
                delay_s = _retry_delay_s(attempts)
                _log_llm_retry(span="chat", attempt=attempts,
                               error=str(exc) or exc.__class__.__name__, delay_s=delay_s)
                time.sleep(delay_s)
                continue
            _llm_telemetry(span="chat", cfg=cfg, messages=messages, reply=None,
                           started=started, ok=False, error=str(exc) or exc.__class__.__name__)
            raise
        usage = _finalize_usage(_usage_from(data), prompt_chars, len(reply or ""))
        if usage_out is not None:
            usage_out.clear()
            usage_out.update(usage)
        _llm_telemetry(span="chat", cfg=cfg, messages=messages, reply=reply,
                       started=started, ok=True, error=None, tokens=usage)
        return reply


def _llm_telemetry(
    *,
    span: str,
    cfg: dict[str, str],
    messages: list[dict[str, str]],
    reply: str | None,
    started: float,
    ok: bool,
    error: str | None,
    stream: bool = False,
    trace_ids: dict[str, Any] | None = None,
    tokens: dict[str, Any] | None = None,
) -> None:
    """v1.8.0: metadata+preview to app.jsonl, full bodies to agent-trace.jsonl."""
    try:
        from urllib.parse import urlsplit

        elapsed_ms = (time.monotonic() - started) * 1000
        host = urlsplit(cfg.get("base_url", "")).netloc or "unknown"
        model = cfg.get("model", "")
        empty_reply = ok and not (reply or "").strip()
        get_logger("llm").event(
            "llm_call_empty_reply" if empty_reply else ("llm_call_error" if not ok else "llm_call"),
            level=logging.WARNING if empty_reply else logging.INFO,
            span=span,
            provider_host=host,
            model=model,
            elapsed_ms=round(elapsed_ms, 1),
            ok=ok,
            stream=stream,
            prompt_messages=len(messages),
            prompt_chars=sum(len(m.get("content", "")) for m in messages),
            reply_chars=len(reply or ""),
            error=error,
            tokens=tokens,
        )
        from backend.core.agent_trace import trace_llm_call

        trace_llm_call(
            span=span, messages=messages, reply=reply, model=model,
            elapsed_ms=elapsed_ms, ok=ok, error=error, stream=stream,
            **(trace_ids or {}),
        )
    except Exception:
        pass


def iter_sse_events(lines: Any) -> Any:
    """Yield parsed JSON event dicts from an OpenAI-compatible SSE stream.

    Non-event lines (keep-alives, ``[DONE]``, unparsable fragments) are
    skipped. v1.10.0: usage-only final chunks surface here too.
    """
    for line in lines:
        if isinstance(line, bytes):
            line = line.decode("utf-8", errors="replace")
        line = line.strip()
        if not line.startswith("data:"):
            continue
        chunk = line[len("data:"):].strip()
        if not chunk or chunk == "[DONE]":
            continue
        try:
            event = json.loads(chunk)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            yield event


def iter_sse_deltas(lines: Any) -> Any:
    """Yield text deltas from an OpenAI-compatible SSE byte/line iterator."""
    for event in iter_sse_events(lines):
        choices = event.get("choices") or []
        if not choices:
            continue
        delta = (choices[0] or {}).get("delta") or {}
        content = delta.get("content")
        if isinstance(content, str) and content:
            yield content


def chat_stream(
    messages: list[dict[str, str]],
    config: dict[str, str] | None = None,
    trace_ids: dict[str, Any] | None = None,
    usage_out: dict[str, Any] | None = None,
) -> Any:
    """Streaming variant of :func:`chat`; yields text deltas as they arrive.

    Raises the same way as chat() when the provider is unreachable. The
    returned iterator must be fully consumed (or closed) by the caller.
    Transient failures are retried (v1.9.0) — but only while nothing has been
    yielded yet: after the first delta a retry would duplicate content, so
    mid-stream breaks keep the caller's degradation path.
    Token usage (v1.10.0): requests ``stream_options.include_usage`` unless
    the provider already demoted it; a 400 complaining about stream_options
    demotes it for this process and retries once without the field. Without
    provider usage, tokens are estimated from char counts (estimated=True).
    trace_ids: explicit correlation ids for the agent-trace sink — required
    when called from sync generators whose ContextVar writes don't persist
    across threadpool iterations.
    """
    cfg = config or load_config()
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"

    max_tokens = max_tokens_from_config(cfg)
    demote_key = f"{cfg.get('base_url', '')}|{cfg.get('model', '')}"
    include_usage = stream_usage_from_config(cfg) and demote_key not in _STREAM_USAGE_DEMOTED

    def _build_payload(with_usage: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": cfg["model"],
            "messages": messages,
            "temperature": 0,
            "stream": True,
        }
        if max_tokens > 0:
            payload["max_tokens"] = max_tokens
        if with_usage:
            payload["stream_options"] = {"include_usage": True}
        return payload

    started = time.monotonic()

    def _close_quietly(active: Any) -> None:
        try:
            active.__exit__(None, None, None)
        except Exception:  # noqa: BLE001 - cleanup must never mask the real error
            pass

    def _open(payload: dict[str, Any]) -> tuple[Any, Any]:
        stream = httpx.stream("POST", url, json=payload, headers=headers, timeout=120.0)
        response = stream.__enter__()
        try:
            response.raise_for_status()
        except BaseException:
            _close_quietly(stream)
            raise
        return stream, response

    def _is_unsupported_stream_options(exc: BaseException) -> bool:
        if not (isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 400):
            return False
        detail = ""
        try:
            detail = exc.response.text
        except Exception:  # noqa: BLE001 - body best-effort only
            detail = ""
        return "stream_options" in detail or "stream option" in detail

    attempts = 0
    demoted_here = False
    while True:
        attempts += 1
        try:
            stream, response = _open(_build_payload(include_usage))
        except Exception as exc:
            if not demoted_here and include_usage and _is_unsupported_stream_options(exc):
                # v1.10.0: provider rejects stream_options — drop it for this
                # call and remember the demotion (not counted as a retry).
                _STREAM_USAGE_DEMOTED.add(demote_key)
                demoted_here = True
                include_usage = False
                get_logger("llm").event(
                    "llm_stream_usage_demoted", span="chat_stream",
                    provider_model=cfg.get("model", ""), error=str(exc)[:200],
                )
                attempts -= 1
                continue
            if attempts < MAX_LLM_ATTEMPTS and _is_retryable(exc):
                delay_s = _retry_delay_s(attempts)
                _log_llm_retry(span="chat_stream", attempt=attempts,
                               error=str(exc) or exc.__class__.__name__, delay_s=delay_s)
                time.sleep(delay_s)
                continue
            _llm_telemetry(span="chat_stream", cfg=cfg, messages=messages, reply=None,
                           started=started, ok=False, error=str(exc) or exc.__class__.__name__,
                           stream=True, trace_ids=trace_ids)
            raise
        break

    def generator() -> Any:
        nonlocal stream, response, attempts
        chunks: list[str] = []
        collected_usage: dict[str, Any] | None = None
        failed = False
        try:
            while True:
                produced = False
                retry_error: str | None = None
                try:
                    for event in iter_sse_events(response.iter_lines()):
                        found = _usage_from(event)
                        if found is not None:
                            collected_usage = found
                            continue
                        choices = event.get("choices") or []
                        if not choices:
                            continue
                        delta = (choices[0] or {}).get("delta") or {}
                        content = delta.get("content")
                        if isinstance(content, str) and content:
                            produced = True
                            chunks.append(content)
                            yield content
                    return  # stream ended normally
                except Exception as exc:
                    if produced or attempts >= MAX_LLM_ATTEMPTS or not _is_retryable(exc):
                        raise
                    retry_error = str(exc) or exc.__class__.__name__
                # Transient break before the first delta: reconnect and replay.
                delay_s = _retry_delay_s(attempts - 1)
                _log_llm_retry(span="chat_stream", attempt=attempts - 1,
                               error=retry_error or "unknown", delay_s=delay_s)
                time.sleep(delay_s)
                attempts += 1
                stream, response = _open(_build_payload(include_usage))
        except Exception as exc:
            failed = True
            _llm_telemetry(span="chat_stream", cfg=cfg, messages=messages,
                           reply="".join(chunks) or None, started=started, ok=False,
                           error=str(exc) or exc.__class__.__name__, stream=True,
                           trace_ids=trace_ids)
            raise
        finally:
            _close_quietly(stream)
            usage = _finalize_usage(collected_usage,
                                    sum(len(m.get("content", "")) for m in messages),
                                    len("".join(chunks)))
            if usage_out is not None:
                usage_out.clear()
                usage_out.update(usage)
            if not failed:
                # Success telemetry fires after the generator is exhausted (or
                # closed early by a disconnect) — reply is what was streamed.
                _llm_telemetry(span="chat_stream", cfg=cfg, messages=messages,
                               reply="".join(chunks) or None, started=started, ok=True,
                               error=None, stream=True, trace_ids=trace_ids, tokens=usage)

    return generator()
