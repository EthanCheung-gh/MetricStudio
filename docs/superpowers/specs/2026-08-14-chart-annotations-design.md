# 图表批注设计规范

> 图表叠加文本注释与标注线，保存在 chart.layout 随项目持久化
> 日期: 2026-08-14 · 状态: 已批准

## 1. 目标

在图表上叠加注释：文本注释 + 横/竖标注线，保存在 `chart.layout.annotations` / `chart.layout.shapes`，复用 Plotly annotations/shapes 渲染。

## 2. 数据模型

- `layout.annotations: [{ text, xref:'paper', yref:'paper', x, y, showarrow:false, font }]`
- `layout.shapes: [{ type:'line', xref, yref, x0,x1,y0,y1, line:{color,width,dash} }]`

## 3. 前端

`PropertyEditor` 新增「Annotations」区块：添加文本/横线/竖线、编辑文本与颜色、删除。全部走 `updateLayout`。

## 4. 非目标

- 箭头标注（后续）
- 快照保存（独立功能）
- 拖拽定位（用 paper/数据坐标输入）
