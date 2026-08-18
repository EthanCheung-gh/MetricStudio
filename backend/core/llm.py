"""LLM provider abstraction (OpenAI-compatible chat completions).

Supports local Ollama (base_url=http://localhost:11434/v1, no key) and any
OpenAI-compatible remote API. Config persists under ~/.metricstudio/llm-config.json.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx

CONFIG_PATH = Path.home() / ".metricstudio" / "llm-config.json"

DEFAULT_CONFIG: dict[str, str] = {
    "base_url": "http://localhost:11434/v1",
    "model": "llama3",
    "api_key": "",
}


def load_config() -> dict[str, str]:
    if not CONFIG_PATH.exists():
        return dict(DEFAULT_CONFIG)
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return {**DEFAULT_CONFIG, **{k: str(v) for k, v in data.items() if isinstance(v, str)}}
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULT_CONFIG)


def save_config(config: dict[str, str]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = CONFIG_PATH.with_suffix(".tmp")
    fd = os.open(temp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(config, stream, ensure_ascii=False, indent=2)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    temp_path.replace(CONFIG_PATH)


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
