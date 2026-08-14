"""User-defined cleaning recipes persisted under ~/.metricstudio/recipes/."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

RECIPES_DIR = Path.home() / ".metricstudio" / "recipes"


def _ensure_dir() -> None:
    RECIPES_DIR.mkdir(parents=True, exist_ok=True)


def _read(recipe_id: str) -> dict[str, Any] | None:
    path = RECIPES_DIR / f"{recipe_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def list_user_recipes() -> list[dict[str, Any]]:
    """Return user recipes sorted by newest first."""
    _ensure_dir()
    recipes: list[dict[str, Any]] = []
    for path in sorted(RECIPES_DIR.glob("*.json")):
        recipe = _read(path.stem)
        if recipe is not None:
            recipes.append(recipe)
    recipes.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return recipes


def get_user_recipe(recipe_id: str) -> dict[str, Any] | None:
    return _read(recipe_id)


def save_user_recipe(name: str, steps: list[dict[str, Any]]) -> dict[str, Any]:
    """Persist a new user recipe and return it."""
    _ensure_dir()
    recipe: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": name,
        "steps": steps,
        "created_at": datetime.utcnow().isoformat(),
    }
    (RECIPES_DIR / f"{recipe['id']}.json").write_text(
        json.dumps(recipe, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return recipe


def delete_user_recipe(recipe_id: str) -> bool:
    """Delete a user recipe by id; return True if it existed."""
    path = RECIPES_DIR / f"{recipe_id}.json"
    if not path.exists():
        return False
    path.unlink(missing_ok=True)
    return True
