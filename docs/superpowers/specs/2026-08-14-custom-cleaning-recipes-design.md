# 自定义清洗配方设计规范

> 用户把当前变换链保存为命名配方，跨数据集一键复用
> 日期: 2026-08-14 · 状态: 已批准

## 1. 目标

开放预置清洗配方机制：用户可将当前数据集的 `history`（操作链）保存为**自定义配方**，之后一键应用到其他数据集。

## 2. 数据模型

```python
UserRecipe = { id: str, name: str, steps: [{type, params}], created_at: str }
```

- `steps` 复用现有 `Dataset.history` 的操作格式（`{type, params}`），语义完全对齐 13 种算子
- 持久化到 `~/.metricstudio/recipes/{id}.json`（与 templates/session 同模式）
- **固定参数**语义：保存具体列名/值；应用到列名不同的数据集时按列跳过（容错）

## 3. 后端

| 端点 | 说明 |
|---|---|
| `GET /api/v1/recipes` | 返回 `{ presets: [...], custom: [...] }` |
| `POST /api/v1/recipes` | `{name, steps}` 保存自定义配方 |
| `DELETE /api/v1/recipes/{id}` | 删除自定义配方 |

应用复用 `POST /api/v1/transform/{id}/recipe/{recipeId}`，解析顺序**先自定义 → 再预置**。

## 4. 前端

- `CleaningPanel` 加「保存为配方」：把当前 history 打包为 `{name, steps}` 提交
- 配方列表分 Preset / Custom 两区，自定义配方可删除
- 应用自定义配方复用现有按钮路径

## 5. 测试

`backend/tests/test_user_recipes.py`：保存/列出/删除、应用自定义配方、列不匹配跳过。

## 6. 非目标

- 参数化配方（应用时填列名）—— 后续增强
- 配方编辑器（可视化勾选算子）—— 后续增强
