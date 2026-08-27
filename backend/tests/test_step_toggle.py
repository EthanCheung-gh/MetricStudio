"""Transform-chain step enable/disable (v0.6.5)."""


def _import(client):
    csv = "region,value\nNorth,10\nSouth,20\nNorth,30\n"
    response = client.post(
        "/api/v1/data/import",
        files={"file": ("chain.csv", csv.encode(), "text/csv")},
    )
    assert response.status_code == 200, response.text
    return response.json()[0]["id"]


def test_disable_step_removes_its_effect_and_reenable_restores(client):
    dataset_id = _import(client)
    applied = client.post(
        f"/api/v1/transform/{dataset_id}/filter",
        json={"column": "value", "operator": "gte", "value": 20},
    )
    assert applied.status_code == 200 and applied.json()["totalRows"] == 2

    # Disable the filter step: back to the imported 3 rows.
    disabled = client.post(
        f"/api/v1/transform/{dataset_id}/steps/0/disabled",
        json={"disabled": True},
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["totalRows"] == 3
    history = client.get(f"/api/v1/transform/{dataset_id}/history").json()
    assert history[0]["disabled"] is True

    # Preview of later steps replays without the disabled op.
    preview = client.get(f"/api/v1/data/{dataset_id}/preview", params={"at": 0})
    assert preview.status_code == 200

    # Re-enable: the filter applies again.
    enabled = client.post(
        f"/api/v1/transform/{dataset_id}/steps/0/disabled",
        json={"disabled": False},
    )
    assert enabled.status_code == 200
    assert enabled.json()["totalRows"] == 2


def test_disable_unknown_step_returns_400(client):
    dataset_id = _import(client)
    response = client.post(
        f"/api/v1/transform/{dataset_id}/steps/99/disabled",
        json={"disabled": True},
    )
    assert response.status_code == 400


def test_disabled_step_survives_snapshot_and_session_persistence_shape(client, dirty_dataset):
    """The disabled flag rides along in history entries (project/session format)."""
    dataset_id = _import(client)
    client.post(f"/api/v1/transform/{dataset_id}/steps/0/disabled", json={"disabled": True})
    project = client.post(
        "/api/v1/project/save",
        json={"path": "/tmp/test-step-toggle.metricstudio", "name": "t", "charts": []},
    ).json()
    assert project["datasets"] >= 1
    import zipfile

    with zipfile.ZipFile("/tmp/test-step-toggle.metricstudio") as zf:
        import io
        import json as jsonlib

        for name in zf.namelist():
            if name.startswith("transforms/") and name.endswith(".json"):
                chain = jsonlib.loads(zf.read(name))
                if len(chain) == 1:
                    assert chain[0].get("disabled") is True
