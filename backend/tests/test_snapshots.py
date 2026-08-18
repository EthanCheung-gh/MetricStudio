import json
import zipfile
from pathlib import Path

from backend.core.session import session


def _import_with_history(client):
    resp = client.post(
        "/api/v1/data/import",
        files={"file": ("snap.csv", b"name,value\na,10\nb,20\nc,30\n", "text/csv")},
    )
    dataset_id = resp.json()[0]["id"]
    client.post(
        f"/api/v1/transform/{dataset_id}/filter",
        json={"column": "value", "operator": "gt", "value": 10},
    )
    return dataset_id


def test_snapshot_create_list_preview_and_delete(client):
    dataset_id = _import_with_history(client)
    resp = client.post(
        f"/api/v1/data/{dataset_id}/snapshots",
        json={"name": "Filtered", "description": "value > 10", "step": 0},
    )
    assert resp.status_code == 200, resp.text
    snapshot = resp.json()
    assert snapshot["rows"] == 2 and snapshot["step"] == 0
    assert "path" not in snapshot

    listed = client.get(f"/api/v1/data/{dataset_id}/snapshots").json()
    assert [item["id"] for item in listed] == [snapshot["id"]]
    preview = client.get(f"/api/v1/snapshots/{snapshot['id']}/preview").json()
    assert preview["totalRows"] == 2

    path = Path(session.get_snapshot(snapshot["id"])["path"])
    assert path.is_file()
    assert client.delete(f"/api/v1/snapshots/{snapshot['id']}").status_code == 200
    assert not path.exists()


def test_snapshot_is_immutable_after_source_changes(client):
    dataset_id = _import_with_history(client)
    snapshot = client.post(
        f"/api/v1/data/{dataset_id}/snapshots", json={"name": "Frozen"}
    ).json()
    client.post(
        f"/api/v1/transform/{dataset_id}/filter",
        json={"column": "value", "operator": "gt", "value": 20},
    )
    preview = client.get(f"/api/v1/snapshots/{snapshot['id']}/preview").json()
    assert preview["totalRows"] == 2


def test_snapshot_diff_and_restore_as_new_dataset(client):
    dataset_id = _import_with_history(client)
    snapshot = client.post(
        f"/api/v1/data/{dataset_id}/snapshots", json={"name": "Filtered"}
    ).json()
    client.post(
        f"/api/v1/transform/{dataset_id}/filter",
        json={"column": "value", "operator": "gt", "value": 20},
    )
    diff = client.post(
        f"/api/v1/snapshots/{snapshot['id']}/diff",
        json={"dataset_id": dataset_id},
    )
    assert diff.status_code == 200 and diff.json()["left_rows"] == 2 and diff.json()["right_rows"] == 1

    restored = client.post(
        f"/api/v1/snapshots/{snapshot['id']}/restore", json={"name": "Recovered"}
    )
    assert restored.status_code == 200, restored.text
    restored_id = restored.json()["id"]
    assert restored_id != dataset_id
    assert restored.json()["name"] == "Recovered"
    assert restored.json()["rows"] == 2
    assert session.get(dataset_id).meta.rows == 1


def test_delete_dataset_cascades_snapshot_file(client):
    dataset_id = _import_with_history(client)
    snapshot = client.post(
        f"/api/v1/data/{dataset_id}/snapshots", json={"name": "Before delete"}
    ).json()
    path = Path(session.get_snapshot(snapshot["id"])["path"])

    client.delete(f"/api/v1/data/{dataset_id}")
    assert snapshot["id"] not in session.snapshots
    assert not path.exists()


def test_project_load_rejects_snapshot_path_traversal(client, tmp_path):
    archive = tmp_path / "malicious.metricstudio"
    manifest = {
        "name": "malicious",
        "data_sources": [],
        "charts": [],
        "dashboards": [],
        "snapshots": [{
            "id": "../escape",
            "dataset_id": "missing",
            "dataset_name": "x",
            "name": "x",
            "description": "",
            "step": -1,
            "rows": 0,
            "cols": 0,
            "created_at": "2026-01-01T00:00:00",
        }],
    }
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("snapshots/../escape.parquet", b"not parquet")

    resp = client.post("/api/v1/project/load", json={"path": str(archive)})
    assert resp.status_code == 400


def test_snapshot_rejects_invalid_step_and_empty_name(client):
    dataset_id = _import_with_history(client)
    assert client.post(f"/api/v1/data/{dataset_id}/snapshots", json={"name": ""}).status_code == 400
    assert client.post(
        f"/api/v1/data/{dataset_id}/snapshots", json={"name": "Bad", "step": 99}
    ).status_code == 400
