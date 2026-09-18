"""v1.8.0 logging system: JSONL protocol, trace middleware, agent trace."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd
import pytest

from backend.core import agent_trace, logging_setup, qa_agent


@pytest.fixture()
def log_env(tmp_path, monkeypatch):
    """Isolated log dir + a fresh logging setup per test."""
    log_dir = tmp_path / "logs"
    monkeypatch.setenv("METRICSTUDIO_LOG_DIR", str(log_dir))
    # Re-arm setup_logging for this test and undo handlers afterwards.
    logging_setup._CONFIGURED = False
    root = logging.getLogger()
    before = list(root.handlers)
    trace_logger = logging.getLogger("agent.trace")
    trace_before = list(trace_logger.handlers)
    logging_setup.setup_logging()
    yield log_dir
    for handler in list(root.handlers):
        if handler not in before:
            root.removeHandler(handler)
            handler.close()
    for handler in list(trace_logger.handlers):
        if handler not in trace_before:
            trace_logger.removeHandler(handler)
            handler.close()
    logging_setup._CONFIGURED = False


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_setup_logging_writes_jsonl_with_protocol_fields(log_env):
    log = logging_setup.get_logger("test")
    log.event("my_event", span="unit", rows=7, note="你好")
    lines = _read_jsonl(log_env / "app.jsonl")
    assert lines and lines[-1]["event"] == "my_event"
    assert lines[-1]["level"] == "info"
    assert lines[-1]["span"] == "unit"
    assert lines[-1]["rows"] == 7
    assert lines[-1]["note"] == "你好"
    assert "ts" in lines[-1]


def test_preview_truncates_long_payloads():
    out = logging_setup.preview("x" * 500, limit=200)
    assert out.startswith("x" * 200)
    assert "(+300)" in out


def test_trace_llm_call_records_full_bodies(log_env):
    agent_trace.trace_llm_call(
        span="chat", messages=[{"role": "user", "content": "完整的问题"}],
        reply="完整的回答", model="m1", elapsed_ms=12.3, ok=True,
    )
    lines = _read_jsonl(log_env / "agent-trace.jsonl")
    assert lines[-1]["event"] == "llm_call"
    assert lines[-1]["prompt_messages"][0]["content"] == "完整的问题"
    assert lines[-1]["reply"] == "完整的回答"
    assert lines[-1]["model"] == "m1"
    # Full bodies must not leak into the app log.
    app_text = (log_env / "app.jsonl").read_text(encoding="utf-8") if (log_env / "app.jsonl").exists() else ""
    assert "完整的问题" not in app_text


def test_tombstone_and_purge(log_env):
    agent_trace.trace_event("llm_call", span="chat", reply="body")
    agent_trace.tombstone_session("sess-1")
    lines = _read_jsonl(log_env / "agent-trace.jsonl")
    assert any(line["event"] == "qa_session_deleted" and line["deleted_session_id"] == "sess-1" for line in lines)

    agent_trace.trace_event("llm_call", span="chat", reply="body2")
    before = (log_env / "agent-trace.jsonl").stat().st_size
    assert before > 0
    reclaimed = agent_trace.purge_traces()
    assert reclaimed >= before
    remaining = [line for line in _read_jsonl(log_env / "agent-trace.jsonl") if line["event"] != "trace_purged"]
    assert remaining == []


def test_middleware_attaches_trace_id(log_env, client):
    response = client.get("/health")
    assert response.headers.get("x-trace-id") is None  # /health is excluded from tracing

    response = client.get("/api/v1/data/list", headers={"X-Trace-Id": "abc123"})
    assert response.headers.get("x-trace-id") == "abc123"
    lines = [line for line in _read_jsonl(log_env / "app.jsonl") if line.get("event") == "request"]
    assert lines and lines[-1]["trace_id"] == "abc123"
    assert lines[-1]["client_generated"] is True
    assert lines[-1]["status"] == 200
    assert "elapsed_ms" in lines[-1]

    # Without a header the middleware generates one.
    response = client.get("/api/v1/data/list")
    assert response.headers.get("x-trace-id")


def test_agent_stream_writes_traceable_chain(log_env, monkeypatch):
    """A full streamed Q&A must produce a traceable chain in agent-trace."""
    calls = iter([
        # round 1: tool call, round 2: final answer
        '{"tools": [{"name": "row_count", "args": {}}]}',
        '{"answer": "共 [1] 行", "followups": [], "clarify": null}',
    ])

    def fake_chat_stream(messages, config=None):
        yield next(calls)

    monkeypatch.setattr(qa_agent, "chat_stream", fake_chat_stream)
    df = pd.DataFrame({"a": [1, 2, 3]})
    events = list(qa_agent.run_agent_stream("有多少行？", df, "ctx", []))
    assert events[-1]["type"] == "done"

    lines = _read_jsonl(log_env / "agent-trace.jsonl")
    kinds = [line["event"] for line in lines]
    assert kinds.count("agent_start") == 1
    assert "round_start" in kinds
    assert "llm_decision" in kinds
    assert any(line["event"] == "tool_call" and line["tool"] == "row_count" for line in lines)
    assert kinds.count("agent_done") == 1


def test_llm_chat_telemetry_split(log_env, monkeypatch):
    """chat() writes metadata to app.jsonl and the full body to agent-trace."""
    from backend.core import llm

    class FakeResponse:
        def raise_for_status(self): return None
        def json(self):
            return {"choices": [{"message": {"content": "模型回答全文"}}]}

    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: FakeResponse())
    monkeypatch.setattr(llm, "load_config", lambda: {"base_url": "http://localhost:11434/v1", "model": "llama3", "api_key": ""})
    reply = llm.chat([{"role": "user", "content": "用户问题全文"}])
    assert reply == "模型回答全文"

    app_lines = _read_jsonl(log_env / "app.jsonl")
    meta = [line for line in app_lines if line["event"] == "llm_call"]
    assert meta and meta[-1]["model"] == "llama3"
    assert meta[-1]["reply_chars"] == len("模型回答全文")
    assert "模型回答全文" not in json.dumps(meta)  # bodies stay out of the app log

    trace_lines = _read_jsonl(log_env / "agent-trace.jsonl")
    assert trace_lines[-1]["event"] == "llm_call"
    assert trace_lines[-1]["reply"] == "模型回答全文"
    assert trace_lines[-1]["prompt_messages"][0]["content"] == "用户问题全文"


def test_client_log_batch_ingestion(log_env, client):
    """SPA batches land in client.jsonl; privacy tombstones reach agent-trace."""
    response = client.post("/api/v1/logs/client", json={
        "entries": [
            {"level": "error", "event": "window_error", "span": "global",
             "trace_id": "t-1", "msg": "boom", "extra": {"line": 3}},
            {"level": "info", "event": "qa_session_deleted", "span": "privacy",
             "session_id": "sess-42"},
        ],
    })
    assert response.status_code == 200
    assert response.json() == {"accepted": 2}

    client_lines = _read_jsonl(log_env / "client.jsonl")
    assert client_lines[0]["event"] == "window_error"
    assert client_lines[0]["trace_id"] == "t-1"
    assert client_lines[0]["line"] == 3

    trace_lines = _read_jsonl(log_env / "agent-trace.jsonl")
    assert any(
        line["event"] == "qa_session_deleted" and line["deleted_session_id"] == "sess-42"
        for line in trace_lines
    )


def test_diagnostics_export_excludes_trace_by_default(log_env, client):
    agent_trace.trace_llm_call(
        span="chat", messages=[{"role": "user", "content": "机密提问"}],
        reply="机密回答", model="m", elapsed_ms=1, ok=True,
    )
    logging_setup.get_logger("test").event("app_event_for_bundle")

    response = client.get("/api/v1/logs/diagnostics/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"

    import io
    import zipfile as zipfile_mod

    with zipfile_mod.ZipFile(io.BytesIO(response.content)) as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        assert "app.jsonl" in names
        assert "agent-trace.jsonl" not in names
        assert "机密提问" not in zf.read("manifest.json").decode()

    # Explicit opt-in includes the trace.
    response = client.get("/api/v1/logs/diagnostics/export?include_trace=true")
    with zipfile_mod.ZipFile(io.BytesIO(response.content)) as zf:
        assert "agent-trace.jsonl" in zf.namelist()


def test_purge_trace_endpoint(log_env, client):
    agent_trace.trace_event("llm_call", span="chat", reply="body")
    assert (log_env / "agent-trace.jsonl").stat().st_size > 0
    response = client.post("/api/v1/logs/purge-trace")
    assert response.status_code == 200
    assert response.json()["purged"] is True
    remaining = [
        line for line in _read_jsonl(log_env / "agent-trace.jsonl")
        if line["event"] != "trace_purged"
    ]
    assert remaining == []
