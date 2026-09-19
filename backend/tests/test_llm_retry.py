"""v1.9.0 transient-retry tests for the LLM provider layer."""

from __future__ import annotations

import httpx
import pytest

import backend.core.llm as llm

CFG = {"base_url": "http://localhost:11434/v1", "model": "m", "api_key": ""}
MESSAGES = [{"role": "user", "content": "q"}]


class FakeResponse:
    def __init__(self, status=200, payload=None, lines=None):
        self.status_code = status
        self._payload = payload or {}
        self._lines = lines or []

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", "http://test/chat/completions")
            response = httpx.Response(status_code=self.status_code, request=request)
            raise httpx.HTTPStatusError(f"HTTP {self.status_code}", request=request, response=response)

    def json(self):
        return self._payload

    def iter_lines(self):
        return iter(self._lines)


class FakeStream:
    """Stand-in for the httpx.stream(...) context manager."""

    def __init__(self, response=None, exc=None):
        self.response = response
        self.exc = exc

    def __enter__(self):
        if self.exc is not None:
            raise self.exc
        return self.response

    def __exit__(self, *args):
        return False


def ok_response():
    return FakeResponse(payload={"choices": [{"message": {"content": "ok"}}]})


@pytest.fixture
def no_sleep(monkeypatch):
    delays: list[float] = []
    monkeypatch.setattr(llm.time, "sleep", lambda s: delays.append(s))
    return delays


@pytest.fixture
def retry_log(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(llm, "_log_llm_retry", lambda **kw: calls.append(kw))
    return calls


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setattr(llm, "load_config", lambda: CFG)


def test_chat_retries_on_500_then_succeeds(monkeypatch, no_sleep, retry_log, cfg):
    responses = [FakeResponse(status=500), ok_response()]
    monkeypatch.setattr(llm.httpx, "post", lambda url, **k: responses.pop(0))

    assert llm.chat(MESSAGES) == "ok"
    assert len(retry_log) == 1 and retry_log[0]["attempt"] == 1
    assert len(no_sleep) == 1 and no_sleep[0] > 0


def test_chat_does_not_retry_auth_errors(monkeypatch, no_sleep, retry_log, cfg):
    calls: list[str] = []
    monkeypatch.setattr(llm.httpx, "post", lambda url, **k: (calls.append(url), FakeResponse(status=401))[1])

    with pytest.raises(httpx.HTTPStatusError):
        llm.chat(MESSAGES)
    assert len(calls) == 1 and retry_log == [] and no_sleep == []


def test_chat_gives_up_after_max_attempts(monkeypatch, no_sleep, retry_log, cfg):
    calls: list[str] = []
    monkeypatch.setattr(llm.httpx, "post", lambda url, **k: (calls.append(url), FakeResponse(status=503))[1])

    with pytest.raises(httpx.HTTPStatusError):
        llm.chat(MESSAGES)
    assert len(calls) == llm.MAX_LLM_ATTEMPTS
    assert len(retry_log) == llm.MAX_LLM_ATTEMPTS - 1


def test_stream_retries_connect_error_before_first_delta(monkeypatch, no_sleep, retry_log, cfg):
    streams = [
        FakeStream(exc=httpx.ConnectError("refused")),
        FakeStream(response=FakeResponse(lines=['data: {"choices":[{"delta":{"content":"你好"}}]}', "data: [DONE]"])),
    ]
    monkeypatch.setattr(llm.httpx, "stream", lambda method, url, **k: streams.pop(0))

    deltas = "".join(llm.chat_stream(MESSAGES))
    assert deltas == "你好"
    assert len(retry_log) == 1 and len(no_sleep) == 1


def test_stream_does_not_retry_after_first_delta(monkeypatch, no_sleep, retry_log, cfg):
    class BreakLines:
        def __iter__(self):
            yield 'data: {"choices":[{"delta":{"content":"部分"}}]}'
            raise httpx.ReadTimeout("stream broke mid-way")

    response = FakeResponse()
    response.iter_lines = lambda: iter(BreakLines())
    monkeypatch.setattr(llm.httpx, "stream", lambda *a, **k: FakeStream(response=response))

    with pytest.raises(httpx.ReadTimeout):
        list(llm.chat_stream(MESSAGES))
    assert retry_log == [] and no_sleep == []


def test_stream_retries_empty_stream_break(monkeypatch, no_sleep, retry_log, cfg):
    """Failure before any delta counts as pre-first-delta and is retried."""
    broken = FakeResponse()
    broken.iter_lines = lambda: iter(BrokenAtStart())
    streams = [FakeStream(response=broken), FakeStream(response=FakeResponse(lines=[]))]
    monkeypatch.setattr(llm.httpx, "stream", lambda *a, **k: streams.pop(0))

    deltas = "".join(llm.chat_stream(MESSAGES))
    assert deltas == ""
    assert len(retry_log) == 1


class BrokenAtStart:
    def __iter__(self):
        raise httpx.ReadTimeout("broke before content")
        yield  # pragma: no cover - make it a generator


# --- v1.9.0 max_tokens cap -------------------------------------------------------

def test_max_tokens_from_config_parsing():
    assert llm.max_tokens_from_config({"max_tokens": "512"}) == 512
    assert llm.max_tokens_from_config({}) == 0
    assert llm.max_tokens_from_config({"max_tokens": ""}) == 0
    assert llm.max_tokens_from_config({"max_tokens": "abc"}) == 0
    assert llm.max_tokens_from_config({"max_tokens": "-5"}) == 0
    assert llm.max_tokens_from_config({"max_tokens": "20.9"}) == 20


def test_chat_sends_max_tokens_when_positive(monkeypatch, cfg):
    captured: dict = {}

    def fake_post(url, json=None, **k):
        captured["payload"] = json
        return ok_response()

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    llm.chat(MESSAGES, config={**CFG, "max_tokens": "512"})
    assert captured["payload"]["max_tokens"] == 512

    llm.chat(MESSAGES, config={**CFG, "max_tokens": "abc"})
    assert "max_tokens" not in captured["payload"]


def test_chat_omits_max_tokens_by_default(monkeypatch, cfg):
    captured: dict = {}

    def fake_post(url, json=None, **k):
        captured["payload"] = json
        return ok_response()

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    llm.chat(MESSAGES)
    assert "max_tokens" not in captured["payload"]
