"""Tests for the NL query -> operation chain endpoint (mock LLM)."""

import json

import pandas as pd
import pytest

from backend.api.nl import _build_prompt, _parse_chain, _validate_ops
from backend.core.privacy import prepare_for_llm, sensitive_columns
from backend.core.session import session


def test_parse_chain_extracts_plain_json():
    ops = _parse_chain('[{"type":"dedupe","params":{}}]')
    assert ops == [{"type": "dedupe", "params": {}}]


def test_privacy_detection_and_field_scopes():
    df = pd.DataFrame({"email": ["a@example.com"], "customer_id": ["123"], "value": [10]})
    assert sensitive_columns(list(df.columns)) == ["email", "customer_id"]
    redacted, sensitive = prepare_for_llm(df, {"data_scope": "redact_sensitive"})
    assert sensitive == ["email", "customer_id"]
    assert redacted["email"].tolist() == ["[REDACTED]"]
    excluded, _ = prepare_for_llm(df, {"data_scope": "exclude_sensitive"})
    assert excluded.columns.tolist() == ["value"]


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
    import backend.core.qa_agent as qa_agent_module

    csv = "name,value\na,10\nb,20\nc,30\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    captured = {}

    def fake_chat(messages):
        captured["system"] = messages[0]["content"]
        return "The max value is 30 (row c)."

    monkeypatch.setattr(qa_agent_module, "chat", fake_chat)
    resp = client.post("/api/v1/nl/ask", json={"dataset_id": dsid, "question": "what is the max value?"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["answer"] == "The max value is 30 (row c)."
    # The system prompt carries the adaptive data context.
    assert "value" in captured["system"]
    assert "Dataset overview: 3 rows × 2 columns" in captured["system"]
    assert "count=3" in captured["system"] and "missing=0" in captured["system"]
    assert "name=a" in captured["system"]
    assert body["evidence"]
    assert any(item["kind"] == "statistics" for item in body["evidence"])
    overview = next(item for item in body["evidence"] if item["id"] == "overview")
    assert overview["kind"] == "overview"
    assert "3 rows × 2 columns" in overview["detail"]
    # A plain-text reply is treated as the final answer in round 1.
    assert body["rounds_used"] == 1
    assert body["tool_call_count"] == 0


def test_ask_endpoint_uses_bound_snapshot_and_filters(client, monkeypatch):
    import backend.core.qa_agent as qa_agent_module

    csv = "name,region,value\na,North,10\nb,South,20\nc,North,30\n"
    dataset_id = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")}).json()[0]["id"]
    snapshot = client.post(f"/api/v1/data/{dataset_id}/snapshots", json={"name": "Original"}).json()
    client.post(f"/api/v1/transform/{dataset_id}/filter", json={"column": "value", "operator": "gt", "value": 20})

    def fake_chat(messages):
        return "North values are 10 and 30."

    monkeypatch.setattr(qa_agent_module, "chat", fake_chat)
    response = client.post(
        "/api/v1/nl/ask",
        json={
            "dataset_id": dataset_id,
            "question": "North 的值有哪些？",
            "snapshot_id": snapshot["id"],
            "filters": [{"field": "region", "op": "in", "values": ["North"]}],
        },
    )
    assert response.status_code == 200, response.text
    # The snapshot binding is reflected on every evidence item's source.
    for item in response.json()["evidence"]:
        assert item["source"].get("snapshotId") == snapshot["id"]


def test_ask_endpoint_rejects_snapshot_from_other_dataset(client, monkeypatch):
    import backend.api.nl as nl_module

    first_id = client.post("/api/v1/data/import", files={"file": ("first.csv", b"value\n1\n", "text/csv")}).json()[0]["id"]
    second_id = client.post("/api/v1/data/import", files={"file": ("second.csv", b"value\n2\n", "text/csv")}).json()[0]["id"]
    snapshot = client.post(f"/api/v1/data/{second_id}/snapshots", json={"name": "Other"}).json()
    monkeypatch.setattr(nl_module, "chat", lambda messages: "unused")

    response = client.post(
        "/api/v1/nl/ask",
        json={"dataset_id": first_id, "question": "test", "snapshot_id": snapshot["id"]},
    )
    assert response.status_code == 400


def test_ask_endpoint_includes_previous_conversation(client, monkeypatch):
    import backend.core.qa_agent as qa_agent_module

    csv = "name,value\na,10\nb,20\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]
    captured = {}

    def fake_chat(messages):
        captured["messages"] = messages
        return "b 最高。"

    monkeypatch.setattr(qa_agent_module, "chat", fake_chat)
    resp = client.post(
        "/api/v1/nl/ask",
        json={
            "dataset_id": dsid,
            "question": "那它的值是多少？",
            "history": [{"question": "谁最高？", "answer": "b"}],
        },
    )
    assert resp.status_code == 200, resp.text
    user_content = captured["messages"][-1]["content"]
    assert "Previous conversation:" in user_content
    assert "谁最高？" in user_content
    assert "b" in user_content


def test_ask_llm_unavailable(client, monkeypatch):
    import backend.core.qa_agent as qa_agent_module

    csv = "a\n1\n2\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    monkeypatch.setattr(qa_agent_module, "chat", lambda messages: (_ for _ in ()).throw(RuntimeError("no llm")))
    resp = client.post("/api/v1/nl/ask", json={"dataset_id": dsid, "question": "anything"})
    assert resp.status_code == 502


# --- v1.2.0 iterative agent ---------------------------------------------------

def test_ask_tool_call_feeds_exact_facts(client, monkeypatch):
    import backend.core.qa_agent as qa_agent_module

    csv = "name,region,value\na,North,10\nb,South,20\nc,North,30\n"
    dataset_id = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")}).json()[0]["id"]

    calls = {"n": 0}
    captured = {}

    def fake_chat(messages):
        calls["n"] += 1
        if calls["n"] == 1:
            assert "Available tools" in messages[0]["content"]
            return '{"tools": [{"name": "row_count", "args": {}}, {"name": "distinct_count", "args": {"column": "region"}}]}'
        captured["results"] = messages[-1]["content"]
        return '{"answer": "共 3 行 [1]，region 有 2 个不同取值 [2]。", "followups": ["region 的分布是怎样的？"], "clarify": null}'

    monkeypatch.setattr(qa_agent_module, "chat", fake_chat)
    resp = client.post("/api/v1/nl/ask", json={"dataset_id": dataset_id, "question": "这个数据集有多少行？"})
    assert resp.status_code == 200, resp.text
    assert calls["n"] == 2
    assert "[1] row_count (ok): row_count = 3" in captured["results"]
    assert "[2] distinct_count (ok): distinct_count(region) = 2" in captured["results"]
    body = resp.json()
    assert body["answer"].startswith("共 3 行")
    assert body["followups"] == ["region 的分布是怎样的？"]
    assert body["clarify"] is None
    assert body["rounds_used"] == 2
    assert body["tool_call_count"] == 2
    assert body["facts"] == [
        {"n": 1, "tool": "row_count", "detail": "row_count = 3"},
        {"n": 2, "tool": "distinct_count", "detail": "distinct_count(region) = 2"},
    ]
    tool_ids = [item["id"] for item in body["evidence"] if item["kind"] == "tool"]
    assert tool_ids == ["fact:1", "fact:2"]


def test_ask_midloop_llm_failure_degrades_to_facts(client, monkeypatch):
    import backend.core.qa_agent as qa_agent_module

    csv = "name,value\na,10\nb,20\n"
    dataset_id = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")}).json()[0]["id"]

    calls = {"n": 0}

    def flaky_chat(messages):
        calls["n"] += 1
        if calls["n"] == 1:
            return '{"tools": [{"name": "row_count", "args": {}}]}'
        raise RuntimeError("llm died mid-loop")

    monkeypatch.setattr(qa_agent_module, "chat", flaky_chat)
    resp = client.post("/api/v1/nl/ask", json={"dataset_id": dataset_id, "question": "有多少行？"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert calls["n"] == 2
    assert "[1] row_count = 2" in body["answer"]
    assert body["facts"][0]["detail"] == "row_count = 2"


def test_ask_plain_text_reply_is_final_answer(client, monkeypatch):
    import backend.core.qa_agent as qa_agent_module

    csv = "name,value\na,10\n"
    dataset_id = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")}).json()[0]["id"]

    calls = {"n": 0}

    def fake_chat(messages):
        calls["n"] += 1
        return "我觉得不需要工具，数据概览已足够。"

    monkeypatch.setattr(qa_agent_module, "chat", fake_chat)
    resp = client.post("/api/v1/nl/ask", json={"dataset_id": dataset_id, "question": "test"})
    assert resp.status_code == 200
    assert calls["n"] == 1
    body = resp.json()
    assert body["answer"] == "我觉得不需要工具，数据概览已足够。"
    assert body["facts"] == []
    assert body["tool_call_count"] == 0


def test_ask_tool_errors_are_fed_back(client, monkeypatch):
    import backend.core.qa_agent as qa_agent_module

    csv = "name,value\na,10\n"
    dataset_id = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")}).json()[0]["id"]

    calls = {"n": 0}
    captured = {}

    def fake_chat(messages):
        calls["n"] += 1
        if calls["n"] == 1:
            return '{"tools": [{"name": "column_stats", "args": {"column": "name"}}, {"name": "distinct_count", "args": {"column": "missing_col"}}]}'
        captured["results"] = messages[-1]["content"]
        return '{"answer": "工具失败，基于概览回答。", "followups": [], "clarify": null}'

    monkeypatch.setattr(qa_agent_module, "chat", fake_chat)
    resp = client.post("/api/v1/nl/ask", json={"dataset_id": dataset_id, "question": "test"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"] == "工具失败，基于概览回答。"
    assert body["tool_call_count"] == 2
    # Error details are fed back to the LLM so it can correct its arguments.
    assert "[1] column_stats (error)" in captured["results"]
    assert "[2] distinct_count (error)" in captured["results"]
    assert "column 'missing_col' not found" in captured["results"]


def test_ask_clarify_payload_passes_through(client, monkeypatch):
    import backend.core.qa_agent as qa_agent_module

    csv = "name,value\na,10\n"
    dataset_id = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")}).json()[0]["id"]

    def fake_chat(messages):
        return '{"answer": "", "followups": [], "clarify": {"question": "你指的是哪一列的平均值？", "options": ["value", "name"]}}'

    monkeypatch.setattr(qa_agent_module, "chat", fake_chat)
    resp = client.post("/api/v1/nl/ask", json={"dataset_id": dataset_id, "question": "平均值是多少？"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["clarify"] == {"question": "你指的是哪一列的平均值？", "options": ["value", "name"]}
    assert body["answer"] == ""



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

    monkeypatch.setenv("METRICSTUDIO_CONFIG_DIR", str(tmp_path))
    config_path = tmp_path / "llm-profiles.json"

    payload = {"base_url": "https://example.invalid/v1", "model": "test-model", "api_key": "secret", "provider": "cloud", "data_scope": "redact_sensitive"}
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
    updated = {**payload, "base_url": "https://other.invalid/v1", "model": "other-model", "api_key": ""}
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
