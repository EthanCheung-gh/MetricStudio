"""Tests for dataset diff."""


def test_diff(client):
    csv1 = "a,b\n1,10\n2,20\n"
    csv2 = "a,c\n1,30\n2,40\n3,50\n"
    r1 = client.post("/api/v1/data/import", files={"file": ("x.csv", csv1.encode(), "text/csv")})
    r2 = client.post("/api/v1/data/import", files={"file": ("y.csv", csv2.encode(), "text/csv")})
    id1 = r1.json()[0]["id"]
    id2 = r2.json()[0]["id"]

    resp = client.post("/api/v1/data/diff", json={"left_id": id1, "right_id": id2})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["left_rows"] == 2
    assert body["right_rows"] == 3
    assert body["only_left"] == ["b"]
    assert body["only_right"] == ["c"]
    # common numeric column a: left mean 1.5 vs right mean 2.0
    assert body["numeric_diff"][0]["column"] == "a"
    assert body["numeric_diff"][0]["left_mean"] == 1.5
    assert body["numeric_diff"][0]["right_mean"] == 2.0


def test_diff_missing_dataset(client):
    resp = client.post("/api/v1/data/diff", json={"left_id": "nope", "right_id": "nope2"})
    assert resp.status_code == 404
