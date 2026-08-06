# MetricStudio

基于 Plotly 的个人数据分析桌面工具。

## 技术栈

- **桌面壳**: Tauri 2.x (Rust)
- **前端**: React 18 + TypeScript + Vite + HeroUI + Tailwind CSS
- **后端**: Python FastAPI + uvicorn (Sidecar)
- **数据处理**: Pandas + Polars
- **图表**: Plotly.js

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
# 1. 启动后端
pnpm backend:dev

# 2. 启动前端（新终端）
pnpm dev
```

### 构建 Tauri（需要 Rust）

```bash
pnpm tauri build
```

## 项目结构

```
metricstudio/
├── src/                  # React 前端源码
├── src-tauri/            # Tauri Rust 源码
├── backend/              # Python FastAPI 后端
└── docs/                 # 设计文档
```

## MVP 功能

- [x] IDE 三面板布局
- [x] CSV / Excel / Parquet 数据导入
- [x] 数据预览表格与列统计
- [x] 基础清洗：过滤 / 排序 / 去空 / 重命名
- [x] Chart Builder 拖拽字段
- [x] 6 种图表类型：line / bar / scatter / pie / histogram / box
- [x] Plotly 实时渲染与属性面板
- [x] HTML / PNG 导出
- [ ] Tauri sidecar 自动启动（待 Rust 环境就绪）
