"""Custom-chart authoring workbench: unsaved preview + LLM manifest drafting.

Two endpoints are covered:

* ``POST /api/v1/chart/custom/preview`` — render a manifest that is not on
  disk, through the exact pipeline the saved dispatch uses (filters, base
  layout, sampling rule, built-in palette), writing nothing.
* ``POST /api/v1/chart/custom/draft`` — one sentence to one *validated*
  manifest, with one repair round, a 422 that carries the draft + errors, and
  the app-wide 502 ``LLM unavailable:`` contract.

Every test runs against a ``tmp_path`` chart directory; the real
``~/.metricstudio/charts`` is never read or written.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

import backend.core.custom_chart_agent as custom_chart_agent
from backend.core import chart_registry
from backend.core import custom_charts as cc

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / "examples" / "charts"
REAL_CHART_DIR = Path.home() / ".metricstudio" / "charts"

DUMBBELL_CSV = """city,start,end
A,10,18
B,20,17
C,30,45
"""

MANY_ROWS_CSV = "city,start,end\n" + "\n".join(
    f"c{i:02d},{i},{i + 12}" for i in range(1, 13)
) + "\n"

ID_RE = r"^[a-z][a-z0-9_-]{1,39}$"


# ---------------------------------------------------------------------------
# Fixtures: chart storage isolation
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def real_chart_dir_untouched():
    """Fail the session if any test leaked into the real chart directory."""

    def snapshot():
        try:
            return (
                REAL_CHART_DIR.exists(),
                tuple(
                    sorted(
                        (path.name, path.stat().st_mtime_ns, path.stat().st_size)
                        for path in REAL_CHART_DIR.glob("*.json")
                    )
                ),
            )
        except OSError:
            return (REAL_CHART_DIR.exists(), ())

    before = snapshot()
    yield
    assert snapshot() == before, "a test wrote into the real ~/.metricstudio/charts"


@pytest.fixture(autouse=True)
def charts_dir(tmp_path, monkeypatch):
    """Point every manifest path at tmp_path and clear the mtime cache."""
    directory = tmp_path / "charts"
    monkeypatch.setattr(cc, "CHART_DIR", directory)
    invalidate = getattr(cc, "_invalidate_cache", None)
    if callable(invalidate):
        invalidate()
    assert cc.CHART_DIR != REAL_CHART_DIR
    assert tmp_path in cc.CHART_DIR.parents
    yield directory
    if callable(invalidate):
        invalidate()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def manifest_payload(name: str = "dumbbell") -> dict:
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


def dumbbell_encoding(**overrides) -> dict:
    encoding = {
        "chartType": "dumbbell",
        "x": {"field": "city", "type": "nominal"},
        "yFields": [
            {"field": "start", "type": "quantitative"},
            {"field": "end", "type": "quantitative"},
        ],
    }
    encoding.update(overrides)
    return encoding


def import_csv(client, csv: str, name: str = "data.csv") -> str:
    resp = client.post(
        "/api/v1/data/import",
        files={"file": (name, csv.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


def preview(client, manifest: dict, dataset_id: str, encoding: dict, filters=None):
    body = {"manifest": manifest, "dataset_id": dataset_id, "encoding": encoding}
    if filters is not None:
        body["filters"] = filters
    return client.post("/api/v1/chart/custom/preview", json=body)


def reply(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


# ---------------------------------------------------------------------------
# 1. /custom/preview
# ---------------------------------------------------------------------------

def test_preview_renders_unsaved_manifest(client, charts_dir):
    dataset_id = import_csv(client, DUMBBELL_CSV)

    resp = preview(client, manifest_payload(), dataset_id, dumbbell_encoding())
    assert resp.status_code == 200, resp.text
    figure = resp.json()
    assert figure["data"], "the unsaved manifest must render"
    for trace in figure["data"]:
        assert trace["type"] in cc.TRACE_TYPES
    # The manifest layout patch is merged over the app's base layout.
    assert figure["layout"]["margin"] == {"l": 70, "r": 20, "t": 30, "b": 50}
    assert figure["layout"]["autosize"] is True
    # Previewing never persists anything.
    assert not charts_dir.exists()
    assert cc.manifest_map() == {}


def test_preview_invalid_manifest_is_400_with_message(client):
    dataset_id = import_csv(client, DUMBBELL_CSV)
    broken = manifest_payload()
    broken["traces"] = [dict(broken["traces"][0], type="mesh3d")]

    resp = preview(client, broken, dataset_id, dumbbell_encoding())
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "unsupported trace type 'mesh3d'" in detail

    # A non-object manifest is the same 400 as POST /custom, never a 422/500.
    non_object = preview(client, [], dataset_id, dumbbell_encoding())
    assert non_object.status_code == 400
    assert non_object.json()["detail"] == "manifest must be a JSON object"


def test_preview_unknown_dataset_is_404(client):
    resp = preview(client, manifest_payload(), "does-not-exist", dumbbell_encoding())
    assert resp.status_code == 404
    assert "Dataset not found" in resp.json()["detail"]


def test_preview_applies_dashboard_filters(client):
    dataset_id = import_csv(client, DUMBBELL_CSV)

    unfiltered = preview(client, manifest_payload(), dataset_id, dumbbell_encoding())
    assert unfiltered.status_code == 200, unfiltered.text
    unfiltered_figure = unfiltered.json()
    # Both marker traces see all three rows, and so do the connector shapes.
    assert [len(trace["x"]) for trace in unfiltered_figure["data"]] == [3, 3]
    assert len(unfiltered_figure["layout"]["shapes"]) == 3

    filtered = preview(
        client,
        manifest_payload(),
        dataset_id,
        dumbbell_encoding(),
        filters=[{"field": "city", "op": "in", "values": ["A"]}],
    )
    assert filtered.status_code == 200, filtered.text
    figure = filtered.json()
    # Only row A survives: both marker traces collapse to that single point...
    assert [trace["x"] for trace in figure["data"]] == [["A"], ["A"]]
    assert [trace["y"] for trace in figure["data"]] == [[10], [18]]
    # ...and the connector (now a layout shape, not a trace) is A's one segment.
    assert len(figure["layout"]["shapes"]) == 1
    connector = figure["layout"]["shapes"][0]
    assert (
        connector["x0"],
        connector["x1"],
        connector["y0"],
        connector["y1"],
    ) == ("A", "A", 10, 18)


def test_preview_indicator_arity_error_is_400(client):
    dataset_id = import_csv(client, "value\n1\n2\n3\n4\n5\n")
    payload = manifest_payload("kpi-gauge")
    payload["id"] = "kpiarity"
    payload["transforms"] = []          # no reduce: $y0 keeps one value per row
    payload["traces"][0]["value"] = "$y0"

    resp = preview(
        client,
        payload,
        dataset_id,
        {
            "chartType": "kpiarity",
            "yFields": [{"field": "value", "type": "quantitative"}],
        },
    )
    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    assert "needs exactly one row" in detail
    assert "reduce" in detail


def test_preview_rejects_oversized_manifest_like_save(client, charts_dir):
    dataset_id = import_csv(client, DUMBBELL_CSV)
    oversized = manifest_payload()
    # A ~300 KB string is valid as a style value but pushes the serialized
    # manifest past the 256 KB cap.
    oversized["traces"][0]["hovertemplate"] = "x" * (300 * 1024)

    resp = preview(client, oversized, dataset_id, dumbbell_encoding())
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == "manifest is larger than 256 KB"

    # The save path reports the very same message (one shared enforcement
    # point in validate_payload) and writes nothing.
    saved = client.post("/api/v1/chart/custom", json=oversized)
    assert saved.status_code == 400
    assert saved.json()["detail"] == "manifest is larger than 256 KB"
    assert not (charts_dir / "dumbbell.json").exists()


def test_preview_sampling_is_honoured(client, monkeypatch):
    dataset_id = import_csv(client, MANY_ROWS_CSV)
    monkeypatch.setenv("METRICSTUDIO_CHART_MAX_POINTS", "5")

    sampled = preview(
        client,
        manifest_payload("lollipop"),
        dataset_id,
        {
            "chartType": "lollipop",
            "x": {"field": "city", "type": "nominal"},
            "yFields": [{"field": "start", "type": "quantitative"}],
        },
    )
    assert sampled.status_code == 200, sampled.text
    figure = sampled.json()
    assert figure["layout"]["meta"]["sampled"] == {"total": 12, "shown": 5, "max": 5}
    assert len(figure["data"][0]["x"]) == 5

    # dumbbell's `limit` transform changes row semantics -> never sampled.
    unsampled = preview(client, manifest_payload(), dataset_id, dumbbell_encoding())
    assert unsampled.status_code == 200, unsampled.text
    figure = unsampled.json()
    assert "meta" not in figure["layout"]
    assert len(figure["data"][1]["x"]) == 12


# ---------------------------------------------------------------------------
# 2. /custom/draft
# ---------------------------------------------------------------------------

def test_draft_valid_first_attempt(client, monkeypatch):
    dataset_id = import_csv(client, DUMBBELL_CSV)
    captured: dict = {}

    def fake_chat(messages, **kwargs):
        captured["prompt"] = messages[0]["content"]
        return reply(manifest_payload())

    monkeypatch.setattr(custom_chart_agent, "chat", fake_chat)

    resp = client.post(
        "/api/v1/chart/custom/draft",
        json={"request": "make a dumbbell chart", "dataset_id": dataset_id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["attempts"] == 1
    assert body["manifest"]["id"] == "dumbbell"
    assert body["manifest"]["channels"]["yFields"] == {"mode": "range"}

    prompt = captured["prompt"]
    assert "Manifest schema" in prompt
    assert "custom-make-a-dumbbell-chart" in prompt  # pinned safe id
    # Dataset columns are supplied as untrusted data.
    assert "<<<DATA_BEGIN>>>" in prompt
    assert "city(" in prompt


def test_draft_repairs_once_then_succeeds(client, monkeypatch):
    broken = manifest_payload()
    broken["traces"] = [dict(broken["traces"][0], type="mesh3d")]
    replies = [reply(broken), reply(manifest_payload())]
    captured: list[str] = []

    def fake_chat(messages, **kwargs):
        captured.append(messages[-1]["content"])
        return replies.pop(0)

    monkeypatch.setattr(custom_chart_agent, "chat", fake_chat)

    resp = client.post("/api/v1/chart/custom/draft", json={"request": "dumbbell"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["attempts"] == 2
    # The repair round carried the validator's own message back to the model.
    assert "unsupported trace type 'mesh3d'" in captured[1]


def test_draft_invalid_twice_is_422(client, monkeypatch):
    broken = manifest_payload()
    broken["traces"] = [dict(broken["traces"][0], type="mesh3d")]
    monkeypatch.setattr(
        custom_chart_agent, "chat", lambda messages, **kwargs: reply(broken)
    )

    resp = client.post("/api/v1/chart/custom/draft", json={"request": "dumbbell"})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["message"] == "draft did not validate"
    assert isinstance(detail["errors"], list) and detail["errors"]
    assert any("unsupported trace type 'mesh3d'" in e for e in detail["errors"])
    # The workbench can show the offending draft next to the errors.
    assert isinstance(detail["draft"], dict)
    assert detail["draft"]["schemaVersion"] == 1


def test_draft_handler_is_sync_for_the_threadpool():
    """The draft handler must not run its blocking LLM call on the event loop.

    ``custom_chart_agent.draft_manifest`` uses the blocking ``httpx`` client
    (transport retries × up to two prompt attempts). A plain ``def`` makes
    FastAPI run it in the threadpool, exactly like every LLM endpoint in
    ``backend/api/nl.py``; an ``async def`` would stall the single-process loop
    for the whole call.
    """
    import inspect

    from backend.api.chart import draft_custom_chart

    assert inspect.iscoroutinefunction(draft_custom_chart) is False


def test_draft_windows_reserved_id_is_rewritten(client, monkeypatch):
    payload = manifest_payload()
    payload["id"] = "con"  # reserved on Windows -> validate_payload rejects it
    monkeypatch.setattr(
        custom_chart_agent, "chat", lambda messages, **kwargs: reply(payload)
    )

    resp = client.post(
        "/api/v1/chart/custom/draft", json={"request": "make a dumbbell chart"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Rewritten before validation, so no repair round was wasted.
    assert body["attempts"] == 1
    chart_id = body["manifest"]["id"]
    assert chart_id == "custom-make-a-dumbbell-chart"
    assert chart_id not in cc._WINDOWS_RESERVED_STEMS


def test_draft_llm_unavailable_is_502(client, monkeypatch):
    def failing_chat(messages, **kwargs):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(custom_chart_agent, "chat", failing_chat)

    resp = client.post("/api/v1/chart/custom/draft", json={"request": "dumbbell"})
    assert resp.status_code == 502
    assert resp.json()["detail"].startswith("LLM unavailable:")


def test_draft_builtin_id_is_rewritten(client, monkeypatch):
    payload = manifest_payload()
    payload["id"] = "bar"  # collides with a built-in chart type
    monkeypatch.setattr(
        custom_chart_agent, "chat", lambda messages, **kwargs: reply(payload)
    )

    resp = client.post(
        "/api/v1/chart/custom/draft", json={"request": "make a dumbbell chart"}
    )
    assert resp.status_code == 200, resp.text
    chart_id = resp.json()["manifest"]["id"]
    assert chart_id != "bar"
    assert re.fullmatch(ID_RE, chart_id)
    assert chart_registry.is_known_chart_type(chart_id) is False
    # Deterministically derived from the request, so repeated drafts agree.
    assert chart_id == "custom-make-a-dumbbell-chart"


# ---------------------------------------------------------------------------
# 3. Neither endpoint writes manifests
# ---------------------------------------------------------------------------

def test_workbench_endpoints_never_write_manifest_files(client, monkeypatch, charts_dir):
    dataset_id = import_csv(client, DUMBBELL_CSV)
    monkeypatch.setattr(
        custom_chart_agent,
        "chat",
        lambda messages, **kwargs: reply(manifest_payload()),
    )

    assert preview(
        client, manifest_payload(), dataset_id, dumbbell_encoding()
    ).status_code == 200
    assert (
        client.post(
            "/api/v1/chart/custom/draft",
            json={"request": "dumbbell", "dataset_id": dataset_id},
        ).status_code
        == 200
    )

    assert not charts_dir.exists()
    assert cc.manifest_map() == {}
    assert cc.list_manifests() == ([], [])
