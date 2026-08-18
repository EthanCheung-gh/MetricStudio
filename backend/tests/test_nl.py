"""Tests for the NL query -> operation chain endpoint (mock LLM)."""

import json

import pytest

from backend.api.nl import _build_prompt, _parse_chain, _validate_ops
from backend.core.session import session


def test_parse_chain_extracts_plain_json():
    ops = _parse_chain('[{"type":"dedupe","params":{}}]')
    assert ops == [{"type": "dedupe", "params": {}}]


def test_parse_chain_tolerates_markdown_fence():
    ops = _parse_chain('```json\n[{"type":"sort","params":{"column":"value","ascending":true}}]\n```')
    assert ops[0]["type"] == "sort"


def test_parse_chain_rejects_non_array():
    with pytest.raises(ValueError):
        _parse_chain('{"type":"filter"}')


def test_validate_ops_rejects_invalid_type():
    with pytest.raises(ValueError):
        _validate_ops([{"type": "explode", "params": {}}])


def test_validate_ops_rejects_missing_params():
    with pytest.raises(ValueError):
        _validate_ops([{"type": "filter"}])


def test_build_prompt_includes_columns_and_query():
    ds = session.get(next(iter(session.datasets))) if session.datasets else None
    # Build a minimal fake dataset object instead of relying on session state
    class FakeMeta:
        columns = [type("C", (), {"name": "value", "dtype": "int64"})()]

    class FakeDataset:
        meta = FakeMeta()

    prompt = _build_prompt(FakeDataset(), "delete rows where value > 100")
    assert "value(int64)" in prompt
    assert "delete rows where value > 100" in prompt
    assert "filter" in prompt


def test_nl_transform_endpoint_with_mock(client, monkeypatch):
    import backend.api.nl as nl_module

    csv = "name,value\na,10\nb,20\nc,30\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    monkeypatch.setattr(
        nl_module, "chat",
        lambda messages: '[{"type":"filter","params":{"column":"value","operator":"gt","value":15}}]',
    )
    resp = client.post("/api/v1/nl/transform", json={"dataset_id": dsid, "query": "keep value above 15"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["operations"] == [{"type": "filter", "params": {"column": "value", "operator": "gt", "value": 15}}]

    # executable: apply the returned chain via batch
    r = client.post(f"/api/v1/transform/{dsid}/batch", json={"operations": body["operations"]})
    assert r.status_code == 200 and r.json()["totalRows"] == 2


def test_nl_transform_llm_unavailable(client, monkeypatch):
    import backend.api.nl as nl_module

    csv = "a\n1\n2\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    def boom(messages):
        raise RuntimeError("no llm")

    monkeypatch.setattr(nl_module, "chat", boom)
    resp = client.post("/api/v1/nl/transform", json={"dataset_id": dsid, "query": "anything"})
    assert resp.status_code == 502


def test_nl_transform_invalid_output(client, monkeypatch):
    import backend.api.nl as nl_module

    csv = "a\n1\n2\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    monkeypatch.setattr(nl_module, "chat", lambda messages: "I cannot help with that")
    resp = client.post("/api/v1/nl/transform", json={"dataset_id": dsid, "query": "anything"})
    assert resp.status_code == 422


def test_ask_endpoint_returns_answer(client, monkeypatch):
    import backend.api.nl as nl_module

    csv = "name,value\na,10\nb,20\nc,30\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    captured = {}

    def fake_chat(messages):
        captured["prompt"] = messages[0]["content"]
        return "The max value is 30 (row c)."

    monkeypatch.setattr(nl_module, "chat", fake_chat)
    resp = client.post("/api/v1/nl/ask", json={"dataset_id": dsid, "question": "what is the max value?"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["answer"] == "The max value is 30 (row c)."
    # prompt carries real data context
    assert "value" in captured["prompt"]
    assert "a=10" in captured["prompt"] or "name=a" in captured["prompt"]


def test_ask_llm_unavailable(client, monkeypatch):
    import backend.api.nl as nl_module

    csv = "a\n1\n2\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    monkeypatch.setattr(nl_module, "chat", lambda messages: (_ for _ in ()).throw(RuntimeError("no llm")))
    resp = client.post("/api/v1/nl/ask", json={"dataset_id": dsid, "question": "anything"})
    assert resp.status_code == 502


def test_narrate_endpoint(client, monkeypatch):
    import backend.api.nl as nl_module

    csv = "date,value\n2024-01-01,100\n2024-02-01,150\n2024-03-01,200\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    captured = {}

    def fake_chat(messages):
        captured["prompt"] = messages[0]["content"]
        return "value 均值从 100 上升到 200，涨幅 100%。"

    monkeypatch.setattr(nl_module, "chat", fake_chat)
    resp = client.post("/api/v1/nl/narrate", json={"dataset_id": dsid})
    assert resp.status_code == 200, resp.text
    assert "上升" in resp.json()["narrative"]
    # prompt carries insight text
    assert "均值" in captured["prompt"]


def test_explain_chart_endpoint(client, monkeypatch):
    import backend.api.nl as nl_module

    csv = "date,value\n2024-01-01,100\n2024-02-01,200\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    captured = {}

    def fake_chat(messages):
        captured["prompt"] = messages[0]["content"]
        return "value 从 100 上升到 200，接近翻倍。"

    monkeypatch.setattr(nl_module, "chat", fake_chat)
    resp = client.post(
        "/api/v1/nl/explain-chart",
        json={
            "dataset_id": dsid,
            "encoding": {
                "chartType": "line",
                "x": {"field": "date"},
                "yFields": [{"field": "value", "aggregate": "sum"}],
            },
        },
    )
    assert resp.status_code == 200, resp.text
    assert "上升" in resp.json()["explanation"]
    # prompt carries both chart config and data context
    assert "line" in captured["prompt"]
    assert "value" in captured["prompt"]


def test_explain_chart_llm_unavailable(client, monkeypatch):
    import backend.api.nl as nl_module

    csv = "a\n1\n2\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    monkeypatch.setattr(nl_module, "chat", lambda messages: (_ for _ in ()).throw(RuntimeError("no llm")))
    resp = client.post("/api/v1/nl/explain-chart", json={"dataset_id": dsid, "encoding": {}})
    assert resp.status_code == 502


def test_llm_config_round_trip(client, monkeypatch, tmp_path):
    import backend.core.llm as llm_module

    config_path = tmp_path / "llm-config.json"
    monkeypatch.setattr(llm_module, "CONFIG_PATH", config_path)
    monkeypatch.setattr("backend.api.nl.load_config", llm_module.load_config)
    monkeypatch.setattr("backend.api.nl.save_config", llm_module.save_config)

    payload = {"base_url": "https://example.invalid/v1", "model": "test-model", "api_key": "secret"}
    response = client.post("/api/v1/nl/config", json=payload)
    assert response.status_code == 200, response.text
    public_payload = {**payload, "api_key": ""}
    assert response.json() == public_payload
    assert client.get("/api/v1/nl/config").json() == public_payload
    assert llm_module.load_config() == payload
    assert config_path.exists()
    assert config_path.stat().st_mode & 0o777 == 0o600
    assert not config_path.with_suffix(".tmp").exists()

    # Leaving the key blank updates endpoint/model without erasing the saved secret.
    updated = {"base_url": "https://other.invalid/v1", "model": "other-model", "api_key": ""}
    response = client.post("/api/v1/nl/config", json=updated)
    assert response.status_code == 200
    assert response.json() == updated
    assert llm_module.load_config()["api_key"] == "secret"

    response = client.post("/api/v1/nl/config", json={**updated, "api_key": " ", "clear_api_key": True})
    assert response.status_code == 200
    assert llm_module.load_config()["api_key"] == ""


def test_llm_config_rejects_empty_endpoint_and_model(client):
    response = client.post("/api/v1/nl/config", json={"base_url": " ", "model": "", "api_key": ""})
    assert response.status_code == 422


def test_explain_chart_unknown_dataset(client):
    resp = client.post("/api/v1/nl/explain-chart", json={"dataset_id": "nope", "encoding": {}})
    assert resp.status_code == 404
