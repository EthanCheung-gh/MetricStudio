# MetricStudio

基于 Plotly 的个人数据分析桌面工具，支持数据导入/清洗/变换、可视化图表构建、交互式 Dashboard 与 AI 辅助分析。

## 技术栈

- **桌面壳**: Tauri 2.x (Rust)，Python FastAPI sidecar 随应用自动启停
- **前端**: React 19 + TypeScript + Vite + HeroUI + Tailwind CSS 4
- **状态管理**: Zustand（persist 持久化）
- **后端**: Python FastAPI + uvicorn
- **数据处理**: Pandas + Polars
- **图表**: Plotly.js（33 种图表类型）
- **国际化**: i18next + react-i18next（简体中文 / English）

## 开发

### 前置要求

- Node.js 22+
- pnpm
- Python 3.10+
- Rust / Cargo（构建 Tauri 桌面壳时需要）

### 安装依赖

```bash
# 前端依赖
pnpm install

# 后端依赖（使用 uv 或 venv）
cd backend
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

### 启动开发

```bash
# 1. 启动后端（0.0.0.0:8123）
pnpm backend:dev

# 2. 启动前端（新终端）
pnpm dev
```

### 测试与静态检查

```bash
pnpm lint                     # oxlint
pnpm build                    # tsc -b + vite build
pnpm test:backend             # pytest backend/tests
```

### 构建 Tauri（需要 Rust）

```bash
pnpm tauri build
```

## 项目结构

```
metricstudio/
├── src/                      # React 前端源码
│   ├── api/                  # 后端 API 客户端
│   ├── components/           # 布局 / 数据 / 图表 / Dashboard / AI 组件
│   ├── commands/             # 命令面板命令注册
│   ├── i18n/                 # 中英文文案（zh / en）
│   ├── stores/               # Zustand 状态（data / chart / dashboard / workspace / ui）
│   └── utils/                # 图表类型、编码、全局历史等
├── src-tauri/                # Tauri Rust 源码（含 sidecar 管理）
├── backend/                  # Python FastAPI 后端
│   ├── api/                  # 路由：data / transform / chart / nl / sql / report …
│   ├── core/                 # 会话、数据集、洞察、时间序列、SQL 等
│   └── tests/                # pytest 测试
└── docs/                     # 设计文档
```

## 功能

### 数据
- CSV / Excel / Parquet 导入（拖拽或文件选择）
- SQLite 数据库导入（服务端目录浏览器选择文件 + 选择表）
- 大数据量虚拟滚动表格、列统计、数据血缘 DAG
- 完整变换算子：筛选 / 排序 / 删除缺失 / 重命名 / 计算列 / 透视 / 逆透视 / 连接 / 删除列 / 字符串清理 / 分组聚合 / 随机抽样
- 全局撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z）
- 数据集对比（Diff）与时间序列环比分析

### 图表
- 33 种图表类型：折线、柱状、面积、散点、饼图、直方图、箱线、小提琴、热力图、等高线、散点矩阵、树图、旭日图、桑基图、平行坐标、雷达、瀑布、漏斗、甘特、K 线、三维曲面、时间轴等
- Chart Builder 拖拽字段与编码通道配置、属性面板、批注 / 参考线
- Plotly 实时渲染，浅色 / 深色主题自适应
- HTML / PNG / JSON 导出，图表模板保存与复用

### Dashboard
- 多 Dashboard，拖拽布局（缩放 / 移动）
- 布局模板保存与套用
- 全局筛选器与图表间 brush 联动（cross-filter）

### AI 与分析
- 自然语言数据清洗与问答（悬浮胶囊输入框）
- AI 报告叙述生成（按数据集缓存）
- 自动洞察（趋势 / 集中度 / 偏态 / 相关性 / 缺失值）与图表推荐
- HTML 报告生成（可含洞察）

### 工作流
- 命令面板（Ctrl/Cmd+K）、快捷键面板（?）
- 项目保存 / 加载、最近项目
- 中英文界面切换（状态栏按钮或命令面板）
- Tauri sidecar 后端自动启停与断线恢复

## 路线图

- [ ] 剪贴板 / JSON 数据导入
- [ ] 数据快照与版本对比
- [ ] Tauri 打包与发布
