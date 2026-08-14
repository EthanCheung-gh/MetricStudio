# 计算字段表达式编辑器设计规范

> compute 表达式输入增强：字段补全 + 只读实时预览
> 日期: 2026-08-14 · 状态: 已批准

## 1. 目标

提升 `compute`（计算列）体验：表达式输入带字段补全（点击列名插入），输入时只读预览结果前几行。

## 2. 后端

`POST /api/v1/transform/{id}/compute/preview` `{expression}` → `{values: [...]}`，只读 `df.eval`，不写入 history。

## 3. 前端

- `TransformPanel` Compute 区块：列名 chips（点击插入到表达式）+ 300ms 去抖实时预览结果前几行。

## 4. 非目标

- 语法高亮 / 完整 IDE 补全
