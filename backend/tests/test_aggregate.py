"""Tests for the single-value aggregate endpoint (drives dashboard KPI cards)."""


def _import(client, csv: str) -> str:
    resp = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


def test_aggregate_sum(client):
    dsid = _import(client, "name,value\na,10\nb,20\nc,30\n")
    resp = client.get(f"/api/v1/data/{dsid}/aggregate?field=value&agg=sum")
    assert resp.status_code == 200, resp.text
    assert resp.json()["value"] == 60.0


def test_aggregate_mean_and_count(client):
    dsid = _import(client, "v\n10\n20\n30\n")
    assert client.get(f"/api/v1/data/{dsid}/aggregate?field=v&agg=mean").json()["value"] == 20.0
    assert client.get(f"/api/v1/data/{dsid}/aggregate?field=v&agg=count").json()["value"] == 3.0


def test_aggregate_nunique(client):
    dsid = _import(client, "c\na\nb\na\n")
    assert client.get(f"/api/v1/data/{dsid}/aggregate?field=c&agg=nunique").json()["value"] == 2.0


def test_aggregate_unknown_field(client):
    dsid = _import(client, "v\n1\n")
    resp = client.get(f"/api/v1/data/{dsid}/aggregate?field=nope&agg=sum")
    assert resp.status_code == 404


def test_aggregate_bad_agg(client):
    dsid = _import(client, "v\n1\n")
    resp = client.get(f"/api/v1/data/{dsid}/aggregate?field=v&agg=median")
    assert resp.status_code == 400


def test_aggregate_unknown_dataset(client):
    resp = client.get("/api/v1/data/nope/aggregate?field=v&agg=sum")
    assert resp.status_code == 404
