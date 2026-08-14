"""Tests for the read-only compute preview endpoint."""

from backend.core.session import session


def test_compute_preview_returns_values(client):
    csv = "a,b\n1,10\n2,20\n3,30\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    resp = client.post(f"/api/v1/transform/{dsid}/compute/preview", json={"expression": "a + b"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["values"] == [11, 22, 33]


def test_compute_preview_does_not_modify_history(client):
    csv = "a\n1\n2\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    client.post(f"/api/v1/transform/{dsid}/compute/preview", json={"expression": "a * 2"})
    assert session.get(dsid).history == []
    assert client.get(f"/api/v1/transform/{dsid}/history").json() == []


def test_compute_preview_invalid_expression(client):
    csv = "a\n1\n2\n"
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    dsid = resp.json()[0]["id"]

    resp = client.post(f"/api/v1/transform/{dsid}/compute/preview", json={"expression": "missing + 1"})
    assert resp.status_code == 400
