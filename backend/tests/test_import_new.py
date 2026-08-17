"""Tests for new import paths: pasted text, JSON files, and merged Excel sheets."""

import io

import pandas as pd

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def test_import_text_tsv(client):
    """Pasted TSV (an Excel copy) is parsed via separator sniffing."""
    tsv = "name\tvalue\na\t10\nb\t20\n"
    resp = client.post("/api/v1/data/import-text", json={"name": "pasted", "text": tsv})
    assert resp.status_code == 200, resp.text
    meta = resp.json()[0]
    assert meta["name"] == "pasted"
    assert meta["rows"] == 2
    assert meta["cols"] == 2


def test_import_text_json_records(client):
    text = '[{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]'
    resp = client.post("/api/v1/data/import-text", json={"name": "j", "text": text})
    assert resp.status_code == 200, resp.text
    meta = resp.json()[0]
    assert meta["rows"] == 2
    assert meta["cols"] == 2


def test_import_text_empty(client):
    resp = client.post("/api/v1/data/import-text", json={"name": "x", "text": "   "})
    assert resp.status_code == 400


def test_import_text_has_no_source(client):
    """Pasted datasets carry no refreshable source; refresh is rejected."""
    from backend.core.session import session

    resp = client.post("/api/v1/data/import-text", json={"name": "p", "text": "a,b\n1,2\n"})
    dsid = resp.json()[0]["id"]
    assert dsid not in session.sources
    resp = client.post(f"/api/v1/data/{dsid}/refresh")
    assert resp.status_code == 400


def test_import_json_file_records(client):
    text = '[{"a": 1}, {"a": 2}, {"a": 3}]'
    resp = client.post("/api/v1/data/import", files={"file": ("data.json", text.encode(), "application/json")})
    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["rows"] == 3


def test_import_json_file_ndjson(client):
    text = '{"a": 1}\n{"a": 2}\n'
    resp = client.post("/api/v1/data/import", files={"file": ("data.json", text.encode(), "application/json")})
    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["rows"] == 2


def _two_sheet_xlsx() -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame({"m": [1, 2], "v": [10, 20]}).to_excel(writer, sheet_name="jan", index=False)
        pd.DataFrame({"m": [3, 4], "v": [30, 40]}).to_excel(writer, sheet_name="feb", index=False)
    return buf.getvalue()


def test_import_excel_merge_sheets(client):
    resp = client.post(
        "/api/v1/data/import",
        files={"file": ("two.xlsx", _two_sheet_xlsx(), XLSX_MIME)},
        data={"merge_sheets": "true"},
    )
    assert resp.status_code == 200, resp.text
    results = resp.json()
    assert len(results) == 1, "merged import should produce a single dataset"
    assert results[0]["rows"] == 4


def test_import_excel_default_separate_sheets(client):
    resp = client.post(
        "/api/v1/data/import",
        files={"file": ("two.xlsx", _two_sheet_xlsx(), XLSX_MIME)},
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 2
