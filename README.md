# MetricStudio (HarmonyOS)

MetricStudio 的个人数据分析工具的鸿蒙原生移植版（`harmonyos-port` 分支），对 `main` 分支（React/Tauri 桌面版）进行像素级 UI 对齐移植。

## 技术栈

- **框架**: HarmonyOS Stage 模型 + ArkTS / ArkUI 声明式开发
- **API Level**: 22 (HarmonyOS 6.0.2)
- **图表**: WebView + Plotly（`entry/src/main/resources/rawfile/plotly.html`，本地注入 figure JSON）
- **测试**: @ohos/hypium

## 开发

### 前置要求

- DevEco Studio / devecocli
- ohpm

### 构建

```bash
devecocli build
```

### 运行

```bash
devecocli run --skip-build
```

## 移植进度

以 `main`（Web 版）功能为基线的对照状态（2026-08-27）：

已完成：

- [x] 工程骨架（Stage 模型，可编译，`devecocli build` 通过）
- [x] 应用外壳：标题栏 / 活动栏 / 侧边栏 / 状态栏 / 主区域布局 / 可折叠与拖拽浮层
- [x] 数据视图：表格（排序 / 分页）/ CSV 文件导入 / 粘贴文本导入 / 示例数据 / 数据集列表
- [x] 变换引擎（本地）：筛选 / 排序 / 去缺失 / 重命名 / 计算列 / 透视 / 宽转长 / 删列 / 字符串清洗 / 分组聚合 / 抽样 / 撤销
- [x] 图表构建器：33 种类型选择、multi-Y 字段列表、聚合、颜色 / Z 通道；Plotly 渲染核心类型（line / bar / area / step / scatter / dot / waterfall / pie / funnel / histogram / box / violin / ecdf / heatmap / contour / radar），其余类型显示引导提示
- [x] 多 Y 轴：每系列 左/右 轴 + 归一化（无 / 按序列 / 全局）配置与渲染
- [x] Dashboard 卡片化：图表 / KPI（可配置数值列与聚合）/ 文本卡片，全局筛选作用于图表与 KPI，随项目持久化
- [x] AI 命令栏：LLM 优先（OpenAI 兼容接口）+ 本地确定性引擎兜底（中英文 NL→清洗操作、数据问答）
- [x] QA 会话：按数据集分会话记录问答，Markdown 导出
- [x] 图表注解与参考线：文本注解（顶部居中）、水平/垂直虚线参考线（值/颜色可编辑），随项目持久化
- [x] 命令面板与快捷键：Ctrl+K 命令面板（搜索过滤 13 个本地命令）、Ctrl+Z 撤销、Ctrl+S 保存项目
- [x] 报告/故事导出：本地生成自包含 HTML（数据源 + 清洗步骤 + 洞察 + 图表离线渲染 + 结论），经文件选择器保存
- [x] 洞察 / 列统计 / 快照（创建 / 恢复 / 摘要级 diff）
- [x] 设置：主题（深 / 浅 / 跟随系统）/ 语言 / LLM 连接配置（持久化）
- [x] 项目保存 / 加载（Preferences 内嵌 JSON：图表 + Dashboard + 偏好）

未移植（已评估，结论与方案见 `docs/superpowers/plans/2026-08-27-harmonyos-port-roadmap.md` 暂缓项评估）：

- [x] SQL 工作台（relationalStore 内存 SQLite，与 web 同方言；SQLite 文件导入为二期可选）
- [ ] 数据血缘（建议做线性链子集，顺带修复 undo 快照缺陷）
- [ ] Excel 导入（建议做：SheetJS + WebView 桥）；Parquet（拒绝/远期）

## 相关文档

- 移植计划与设计见 `docs/superpowers/plans/` 与 `docs/superpowers/specs/`
