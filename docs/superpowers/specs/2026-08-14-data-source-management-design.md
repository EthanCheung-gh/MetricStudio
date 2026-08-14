# 数据源管理设计规范

> 导入时持久化源文件，支持一键刷新（重新读文件 + 重放变换链）
> 日期: 2026-08-14 · 状态: 已批准

## 1. 目标

把"一次性导入"升级为"活数据源"：记录数据集来源文件，数据更新后一键刷新整个分析链（原始数据重建 + history 重放），变换与图表随之更新。

## 2. 数据模型

- 源文件持久化到 `~/.metricstudio/sources/{source_id}{ext}`（同一文件的所有 Excel sheet 共享一个 source_id）
- 每个数据集记录 source 元数据：`{ path, original_name, ext, sheet_name? }`

## 3. 后端

| 端点 | 说明 |
|---|---|
| `POST /api/v1/data/{id}/refresh` | 重读源文件 → 重建 raw_df → 重放 history → 返回新 meta |

- source 元数据随 session 持久化（restore 后可继续刷新）
- 源文件缺失时返回 400

## 4. 前端

- `DatasetList` 每项加刷新按钮（源文件路径 tooltip）
- 刷新后自动刷新 preview/describe/columns + 基于该数据集的图表

## 5. 测试

`backend/tests/test_data_source.py`：导入持久化源文件、刷新重建 + 重放、源文件缺失报错。

## 6. 非目标

- 定时刷新 / 文件监听
- 多文件版本历史
