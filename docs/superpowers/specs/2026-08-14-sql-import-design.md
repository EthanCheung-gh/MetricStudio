# SQL 数据库连接设计规范

> 连接 SQLite（本地文件）查表导入；Postgres/MySQL 后续扩展
> 日期: 2026-08-14 · 状态: 已批准

## 1. 目标

从 SQL 数据库读表导入为数据集。首期支持 SQLite（Python 内置，零依赖）。

## 2. 后端（`backend/core/sql.py` + `backend/api/sql.py`）

| 端点 | 说明 |
|---|---|
| `POST /api/v1/sql/tables` `{engine, path}` | 列出表名 |
| `POST /api/v1/sql/import` `{engine, path, table, name?}` | 读表 → 注册 Dataset → 返回 meta |

- `engine='sqlite'`：`sqlite3.connect(path)` + `pd.read_sql`
- 后续 `postgres`/`mysql` 需 psycopg2/pymysql 驱动（可选依赖）

## 3. 前端

`DataExplorer` 加「SQL 导入」：SQLite 文件路径 + 表名（先列出表）。

## 4. 测试

临时 SQLite 文件建表 → 列表现/导入 → 断言数据正确。

## 5. 非目标

- 自定义 SQL 查询编辑器（后续）
- Postgres/MySQL 驱动自动安装
