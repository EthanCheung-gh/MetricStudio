from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from backend.core import recipes
from backend.core import user_recipes

router = APIRouter(prefix="/api/v1/recipes", tags=["recipes"])


@router.get("")
async def list_recipes():
    return {"presets": recipes.list_recipes(), "custom": user_recipes.list_user_recipes()}


@router.post("")
async def save_recipe(payload: dict[str, Any]):
    name = (payload.get("name") or "").strip()
    steps = payload.get("steps") or []
    if not name:
        raise HTTPException(status_code=400, detail="Recipe name is required")
    if not steps:
        raise HTTPException(status_code=400, detail="Recipe steps are required")
    return user_recipes.save_user_recipe(name, steps)


@router.delete("/{recipe_id}")
async def delete_recipe(recipe_id: str):
    if not user_recipes.delete_user_recipe(recipe_id):
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"deleted": True}
