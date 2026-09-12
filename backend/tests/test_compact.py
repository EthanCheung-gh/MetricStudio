"""v1.6.0 history compaction: /nl/compact endpoint + history-block rendering."""

from __future__ import annotations

from backend.core.qa_agent import HISTORY_ROUNDS, _build_history_block


def _import_csv(client) -> str:
    csv = "name,value\na,10\n"
    return client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")}).json()[0]["id"]


def test_compact_endpoint_returns_summary(client, monkeypatch):
    import backend.api.nl as nl_module

    dataset_id = _import_csv(client)
    monkeypatch.setattr(nl_module, "chat", lambda messages: " 用户问了行数（3 行）与均值（2）。 ")
    resp = client.post("/api/v1/nl/compact", json={
        "dataset_id": dataset_id,
        "turns": [
            {"question": "多少行？", "answer": "3 行 [1]。"},
            {"question": "均值？", "answer": "2 [1]。"},
        ],
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"] == "用户问了行数（3 行）与均值（2）。"
    assert body["turns_compacted"] == 2
    assert body["model"]


def test_compact_endpoint_requires_two_turns(client):
    dataset_id = _import_csv(client)
    resp = client.post("/api/v1/nl/compact", json={"dataset_id": dataset_id, "turns": [{"question": "q", "answer": "a"}]})
    assert resp.status_code == 422


def test_compact_endpoint_llm_failure_is_502(client, monkeypatch):
    import backend.api.nl as nl_module

    dataset_id = _import_csv(client)
    monkeypatch.setattr(nl_module, "chat", lambda messages: (_ for _ in ()).throw(RuntimeError("no llm")))
    resp = client.post("/api/v1/nl/compact", json={
        "dataset_id": dataset_id,
        "turns": [{"question": "q1", "answer": "a1"}, {"question": "q2", "answer": "a2"}],
    })
    assert resp.status_code == 502


def test_history_block_renders_compaction_summaries():
    history = [
        {"question": "q1", "answer": "a1", "kind": "compaction", "summary": "先前确认共 3 行", "compacted_range": [1, 2]},
        {"question": "q3", "answer": "a3"},
    ]
    block = _build_history_block(history)
    assert "Summary of turns 1-2 (context compacted):" in block
    assert "先前确认共 3 行" in block
    assert "User: q3" in block  # dialog turns still verbatim


def test_history_block_compaction_turns_do_not_fill_recent_window():
    dialog = [{"question": f"q{i}", "answer": "a"} for i in range(HISTORY_ROUNDS + 2)]
    history = [{"question": "old", "answer": "s", "kind": "compaction", "summary": "SUM"}] + dialog
    block = _build_history_block(history)
    assert "Summary of earlier turns (context compacted):\nSUM" in block
    assert "User: q1" not in block  # oldest dialog falls out of the window
    assert f"User: q{HISTORY_ROUNDS + 1}" in block


def test_history_block_skips_empty_compaction():
    history = [
        {"question": "x", "answer": "", "kind": "compaction"},
        {"question": "q", "answer": "a"},
    ]
    block = _build_history_block(history)
    assert "context compacted" not in block
    assert "User: q" in block
