# MetricStudio 侧边栏交互 + 图表标签页设计规范

> VS Code 式侧边栏图标交互 + 中心区域多图表标签页
> 日期: 2026-07-19
> 状态: 已审批

---

## 1. 目标

1. 折叠侧边栏的图标变成可点击的功能按钮（VS Code 活动栏模式）
2. 点击图标展开侧边栏并切换到对应 section；再点同一图标收起
3. 中心区域支持多图表标签页，每个 chart 一个 Tab
4. 非活跃标签页不渲染 Plotly SVG，性能零增寸

## 2. 非目标

- 图表模板/复制功能
- 图表拖拽重新排序
- 多窗口/多实例
- 导出报告（多图表合并导出）

---

## 3. 侧边栏交互设计

### 3.1 核心逻辑

| 状态 | 点击行为 | 结果 |
|------|---------|------|
| 折叠态 | 点击图标（非展开按钮） | 展开侧边栏 + 切到对应 section |
| 展开态 | 点击当前活动 section 图标 | 收起侧边栏 |
| 展开态 | 点击不同 section 图标 | 切到对应 section |
| 展开态 | 点击展开按钮（✕） | 收起侧边栏 |

### 3.2 左侧侧边栏（3 功能图标 + 1 展开按钮）

| 图标 | Section 名称 | 展开态内容 |
|------|-------------|-----------|
| `ListTree` | charts | 已创建的 charts 列表，点击切换当前图表 |
| `Database` | datasets | 数据集列表，点击选取 |
| `Upload` | import | 直接打开 Import Modal，不需要展开侧边栏 |
| `ChevronRight` | expand | 展开侧边栏（已有行为） |

### 3.3 右侧侧边栏（2 功能图标 + 1 展开按钮）

| 图标 | Section 名称 | 展开态内容 |
|------|-------------|-----------|
| `BarChart3` | chartType | 图表类型选择（line/bar/scatter/pie/histogram/box） |
| `Settings` | properties | 迷你属性面板（标题 + 背景色，简化版 PropertyEditor） |
| `ChevronLeft` | expand | 展开侧边栏（已有行为） |

### 3.4 展开态 section 显示

左侧栏展开时：
- 顶部显示当前 section 的标题
- 内容区显示对应 section 内容
- 如果用户点击了不同 section 图标，切换到新 section

右侧栏展开时：
- 顶部显示当前 section 的标题
- 内容区显示对应 section 内容

### 3.5 store 状态

```typescript
interface WorkspaceState {
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftActiveSection: 'charts' | 'datasets' | null;
  rightActiveSection: 'chartType' | 'properties' | null;

  // 核心交互: 折叠/展开/切 section
  setPanelSection(panel: 'left' | 'right', section: string | null): void;
  togglePanel(panel: 'left' | 'right'): void;
  activatePanelSection(panel: 'left' | 'right', section: string): void;
}
```

`activatePanelSection(panel, section)` 逻辑：
- 如果侧边栏折叠 → 展开 + 设 section
- 如果侧边栏展开 + 同一 section → 收起
- 如果侧边栏展开 + 不同 section → 切到新 section

---

## 4. 图表标签页设计

### 4.1 标签页布局

中心区域顶部显示动态图表标签页：

```
┌──────────────────────────────────────────────┐
│ [Data] [Chart 1 ✕] [Chart 2 ✕] [+ New]      │
├──────────────────────────────────────────────┤
│   Active Tab Content                        │
│   (Chart 1 的 Plotly SVG)                   │
└──────────────────────────────────────────────┘
```

- **Data Tab** — 固定第一个，表示数据集视图（现有 Data tab）
- **Chart Tabs** — 每个 chart 一个，显示 chart 名称，可关闭
- **+ New** — 创建新 chart

### 4.2 标签页交互

| 操作 | 行为 |
|------|------|
| 点击 Tab | 切到该 chart 的渲染 |
| 点击 ✕ | 关闭该 Tab（不删除 chart 数据，保留在 chartStore） |
| 点击 Data Tab | 切到数据集视图 |
| 点击 + New | 创建新 chart 并切到该 tab |

### 4.3 性能策略

- **只渲染活跃 Tab 的 Plotly SVG**
- 非活跃 Tab 仅存储 `{ data, layout }` JSON（~5-50KB）
- 切换 Tab 时用 `Plotly.react()` 重新渲染（缓存 figure，无需重新请求后端）
- 渲染延迟 ≈ 100-500ms，可接受

### 4.4 store 状态

```typescript
interface WorkspaceState {
  // ... 现有字段 ...
  openChartTabs: string[];         // 当前打开的 chart ID 列表
  activeChartTabIdx: number;       // 当前活跃标签页索引

  openChartTab(chartId: string): void;
  closeChartTab(chartId: string): void;
  setActiveChartTab(idx: number): void;
}
```

新建 chart 时自动 `openChartTab(chart.id)` 并 `setActiveChartTab()` 切到该 tab。

---

## 5. 文件变更

### 新建

| 文件 | 说明 |
|------|------|
| `components/layout/CollapsedIconBar.tsx` | 可复用的折叠侧边栏图标按钮组件 |

### 修改

| 文件 | 改动 |
|------|------|
| `stores/workspaceStore.ts` | 新增 section 管理 + Tab 管理字段和 actions |
| `layout/LeftPanel.tsx` | 重写折叠态（图标栏）+ 展开态（section 切换） |
| `layout/RightPanel.tsx` | 重写折叠态（图标栏）+ 展开态（section 切换） |
| `layout/WorkspaceLayout.tsx` | 适配新侧边栏结构 |
| `layout/CenterArea.tsx` | 替换固定 Tab → 动态 Chart 标签页 |
| `chart/ChartCanvas.tsx` | 按 activeChartTabIdx 渲染，不显示不活跃 chart |
| `chart/ChartBuilder.tsx` | 移除 FieldList（已在右栏折叠态移除） |
| `layout/TitleBar.tsx` | 移除顶部 New Chart 按钮（移入标签页） |

---

## 6. 数据流示例

```
用户点击左侧折叠态 📋 图标
  → activatePanelSection('left', 'charts')
  → workspaceStore: leftActiveSection = 'charts', leftPanelCollapsed = false
  → LeftPanel 展开, 显示 charts 列表
  → 点击 chart-2
  → chartStore.setActiveChart('chart-2')
  → workspaceStore.openChartTab('chart-2')
  → workspaceStore.setActiveChartTab(idx_of_chart_2)
  → CenterArea 切到 chart-2 标签页, 渲染 Plotly

用户点击同一 📋 图标
  → activatePanelSection('left', 'charts')
  → workspaceStore: leftActiveSection = null, leftPanelCollapsed = true
  → LeftPanel 收起
```

---

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 现有 chartStore.persist 与新 tab 状态冲突 | tab 状态不入 persist，每次会话重建 |
| 切换 tab 时 Plotly 闪屏 | Plotly.react() 增量渲染，不平滑但可接受 |
| 标签页太多挤压布局 | 标签页横向滚动，不强制收缩 |

---

## 8. 决策摘要

- VS Code 活动栏模式：点击图标展开/切换/收起侧边栏
- 左侧 3 功能图标 + 展开按钮，右侧 2 功能图标 + 展开按钮
- 中心区域动态 chart 标签页，只渲染活跃 tab，非活跃存 JSON
- 简化版 PropertyEditor 只保留标题和背景色
- chartStore 数据不变，标签页仅控制显示层
