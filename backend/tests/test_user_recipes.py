"""Tests for user-defined cleaning recipes."""

import pandas as pd

from backend.core import user_recipes
from backend.core.recipes import recipe_steps_for_issue


def _cleanup(recipe_ids):
    for rid in recipe_ids:
        user_recipes.delete_user_recipe(rid)


def test_save_list_delete_roundtrip():
    recipe = user_recipes.save_user_recipe("My filter", [{"type": "dedupe", "params": {}}])
    try:
        assert recipe["id"]
        listed = [r["id"] for r in user_recipes.list_user_recipes()]
        assert recipe["id"] in listed
    finally:
        _cleanup([recipe["id"]])

    assert user_recipes.get_user_recipe(recipe["id"]) is None


def test_user_recipe_steps_apply_directly():
    recipe = user_recipes.save_user_recipe(
        "Filter value", [{"type": "filter", "params": {"column": "value", "operator": "gt", "value": 130}}]
    )
    try:
        df = pd.DataFrame({"value": [100, 150, 200]})
        steps = recipe_steps_for_issue(df, recipe["id"])
        assert steps == [{"type": "filter", "params": {"column": "value", "operator": "gt", "value": 130}}]
    finally:
        _cleanup([recipe["id"]])


def test_preset_still_resolves():
    df = pd.DataFrame({"a": [1, 2, 3]})
    assert recipe_steps_for_issue(df, "dedupe") == [{"type": "dedupe", "params": {}}]


def test_unknown_recipe_raises():
    import pytest

    with pytest.raises(ValueError):
        recipe_steps_for_issue(pd.DataFrame({"a": [1]}), "no-such-recipe")


def test_recipes_api_roundtrip(client):
    resp = client.post("/api/v1/recipes", json={"name": "API recipe", "steps": [{"type": "dropna", "params": {}}]})
    assert resp.status_code == 200, resp.text
    rid = resp.json()["id"]
    try:
        body = client.get("/api/v1/recipes").json()
        assert "presets" in body and "custom" in body
        assert any(r["id"] == rid for r in body["custom"])

        csv = "a,b\n1,\n2,x\n"
        r = client.post("/api/v1/data/import", files={"file": ("t.csv", csv.encode(), "text/csv")})
        dsid = r.json()[0]["id"]
        r = client.post(f"/api/v1/transform/{dsid}/recipe/{rid}")
        assert r.status_code == 200 and r.json()["totalRows"] == 1
    finally:
        client.delete(f"/api/v1/recipes/{rid}")

    assert client.get("/api/v1/recipes").status_code == 200
