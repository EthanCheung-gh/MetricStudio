# MetricStudio

基于 Plotly 的个人数据分析桌面工具，支持数据导入、清洗与变换、可视化图表构建、交互式 Dashboard、不可变数据快照与 AI 辅助分析。当前版本：**0.9.0**。

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
# 同时启动后端和前端（推荐，后端监听 127.0.0.1:8123）
pnpm dev

# 或者分两个终端启动
pnpm backend:dev
pnpm dev:frontend
```

`pnpm dev` 会自动查找根目录 `.venv`、`backend/.venv` 或系统 Python，并在后端进程退出时保留前端日志。若依赖缺失，请在 `backend` 目录重新执行 `uv venv` 和 `uv pip install -r requirements.txt`。

### 测试与静态检查

```bash
pnpm test                     # Vitest 前端单元测试
pnpm lint                     # oxlint
pnpm build                    # tsc -b + vite build
pnpm test:backend             # pytest backend/tests
cargo check --manifest-path src-tauri/Cargo.toml
```

### 构建 Tauri（需要 Rust）

```bash
pnpm tauri build
```

### CI 发布链本地检查

```bash
# 生成当前平台 sidecar（需要 .venv 和 PyInstaller）
python scripts/build-sidecar.py

# 检查 sidecar：健康检查 + 内置示例数据导入
python scripts/smoke-sidecar.py src-tauri/binaries/python-sidecar-$(rustc -vV | sed -n 's/^host: //p')

# 检查 Linux 安装包是否含主程序和 sidecar
python scripts/check-bundle.py src-tauri/target/release/bundle/deb/MetricStudio_0.4.2_amd64.deb
```

推送 `v0.4.2` 等版本标签会触发 `.github/workflows/release.yml`，在 Linux、Windows、macOS runner 上构建并上传 Release 产物。

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
- CSV / Excel / Parquet / JSON 导入，支持拖拽、文件选择、剪贴板粘贴与绝对路径动态导入
- SQLite 数据库导入（服务端目录浏览器选择文件 + 选择表）
- 动态数据源变更检测：定时检查文件 / SQLite 变化，手动确认后安全刷新并重放变换链
- 大数据量虚拟滚动表格、服务端分页、全局搜索 / 排序 / 筛选、完整 CSV / Parquet 导出
- 完整变换算子：筛选 / 排序 / 删除缺失 / 重命名 / 计算列 / 透视 / 逆透视 / 连接 / 删除列 / 字符串清理 / 分组聚合 / 随机抽样
- 计算字段列名补全与只读实时预览、自定义清洗配方、数据质量修复预览与批量应用
- 全局撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z），操作链步骤预览与版本对比
- 不可变命名快照：物化保存、预览、与当前数据比较、恢复为新数据集、随项目文件迁移
- 数据血缘 DAG、数据集对比（Diff）与时间序列环比分析

### 图表
- 33 种图表类型：折线、柱状、面积、散点、饼图、直方图、箱线、小提琴、热力图、等高线、散点矩阵、树图、旭日图、桑基图、平行坐标、雷达、瀑布、漏斗、甘特、K 线、三维曲面、时间轴等
- Chart Builder 拖拽字段与编码通道配置，多 Y 轴、左右轴分配与归一化
- 精细属性编辑：坐标轴范围 / 刻度 / 网格、图例位置、字体、标题字号、全局色板、单系列颜色
- 文本批注、横向 / 纵向参考线与自动洞察标注
- Plotly 实时渲染，浅色 / 深色主题自适应
- HTML / PNG / JSON 导出，图表模板保存与复用，预览与导出样式一致

### Dashboard
- 多 Dashboard，支持重命名 / 删除和拖拽布局（缩放 / 移动）
- 图表、KPI、文本卡片混排，演示模式与 HTML 完整导出
- 布局模板保存、应用与删除
- 按数据集分组的全局筛选器，图表 / KPI 数值保持一致
- 图表间 brush 联动（cross-filter）

### AI 与分析
- 自然语言数据清洗与问答（悬浮胶囊输入框）
- AI 报告叙述生成（按数据集缓存）
- 自动洞察（趋势 / 集中度 / 偏态 / 相关性 / 缺失值）与图表推荐
- HTML 报告生成（可含洞察）

### 工作流
- 内置示例数据与首次分析向导
- 命令面板（Ctrl/Cmd+K）、快捷键面板（?）
- `.metricstudio` 项目保存 / 加载、最近项目，项目包可携带数据、变换链、图表、Dashboard 与快照
- 中英文界面切换（状态栏按钮或命令面板）
- Tauri sidecar 后端自动启停、随机端口、断线恢复和自定义窗口管理
- PyInstaller sidecar 构建脚本与 Tauri 安装包构建链路

## 路线图

- [x] 剪贴板 / JSON 数据导入
- [x] 数据快照与版本对比
- [x] Tauri 本地打包与 sidecar 集成
- [x] CI 多平台打包、sidecar 健康冒烟、安装包内容检查与 Release 产物上传
- [ ] 分类筛选值服务端搜索 / 分页与大数据量性能基准
- [ ] 多轮 AI 数据问答、答案证据引用与敏感列脱敏

## 实现 Checklist（大方向）

### 近期版本分配

- [x] **v0.4.2 问答上下文复现**：绑定数据快照和当前 Dashboard 筛选条件，并在证据与导出中保留上下文。
- [x] **v0.4.3 问答转化为分析产物**：将回答一键添加为 Dashboard 文本卡片或报告段落。
- [x] **v0.5.0 数据隐私控制**：敏感列识别与脱敏、可控字段范围、本地 / 云端模型选择。
- [x] **v0.5.1 大数据筛选能力**：高基数字段服务端搜索、分页、缓存和性能基准。
- [x] **v0.6.0 数据质量中心**：缺失值、重复值、异常值与格式问题的诊断和修复预览。
- [x] **v0.6.1 Dashboard 编辑增强（一）**：编辑 / 查看模式、卡片锁定、Dashboard 复制。
- [x] **v0.6.2 Dashboard 编辑增强（二）**：批量布局操作（对齐 / 等距）与 Dashboard 撤销重做。
- [x] **v0.6.3 Dashboard 导出增强**：导出 HTML 记录筛选条件与生成时间。
- [x] **v0.6.4 数据源刷新增强**：自动刷新已变更源、失败恢复提示与数据版本标记。
- [x] **v0.6.5 变换链增强**：中间步骤预览（已有）+ 步骤启用 / 禁用并保留在链中。
- [x] **v0.7.0 项目可靠性**：自动保存、静默失败处理、项目 saved_at 版本标记。
- [x] **v0.8.0 时间序列工作台**：同比 / 环比、移动平均、异常检测与基础预测。
- [x] **v0.8.1 统计工具箱（一）**：相关性矩阵、线性回归与结果解释。
- [x] **v0.8.2 统计工具箱（二）**：差异检验（Welch / 配对 t / Mann-Whitney U）、置信区间与结果解释。
- [x] **v0.9.0 SQL 查询工作台**：跨数据集只读 SELECT、执行计划、查询历史与结果快照。
- [ ] **v1.0.0 分析故事模式**：将数据来源、清洗步骤、图表、洞察与结论编排成报告。

### P0：核心分析闭环

- [x] 多轮 AI 问答：上下文追问、答案证据引用、数据不足时明确提示
- [x] AI 数据隐私：敏感列识别、脱敏、可控字段范围与本地 / 云端模型选择
- [x] 高基数字段筛选：服务端搜索、分页、缓存与大数据量性能基准
- [x] 数据质量中心：缺失值、重复值、异常值、格式问题与修复前后预览

### P1：Dashboard 与可复现分析

- [x] Dashboard 编辑增强：编辑 / 查看模式、卡片锁定、Dashboard 复制（v0.6.1）
- [x] Dashboard 编辑增强：批量布局操作（对齐 / 等距）与 Dashboard 撤销重做（v0.6.2）
- [x] Dashboard 导出：自包含交互式 HTML 与筛选条件记录（v0.6.3）；PDF / 图片导出待做
- [x] 数据源刷新：自动刷新、失败恢复提示与数据版本标记（v0.6.4）
- [x] 变换链增强：中间步骤预览、启用 / 禁用步骤并保留在链中（v0.6.5）；配方复用已有、SQL 导出待做
- [x] 项目可靠性：自动保存与静默失败处理、项目 saved_at 版本标记（v0.7.0）

### P2：专业分析能力

- [x] 时间序列工作台：同比 / 环比、移动平均、异常检测与基础预测（v0.8.0）
- [x] 统计工具箱（一）：相关性矩阵、线性回归与结果解释（v0.8.1）
- [x] 统计工具箱（二）：差异检验（Welch / 配对 t / Mann-Whitney U）、置信区间与结果解释（v0.8.2）
- [x] SQL 查询工作台：跨数据集只读 SELECT 编辑器、执行计划（EXPLAIN QUERY PLAN）、会话内历史与结果快照导入（v0.9.0）；自动补全待做
- [ ] 分析故事模式：将数据来源、清洗步骤、图表、洞察与结论编排成报告

### P3：生态与差异化

- [ ] 发现式分析首页：导入数据后自动生成质量概览、关键指标、异常与图表建议
- [ ] 插件系统：自定义图表、变换、质量规则、报告模板与 AI Prompt
- [ ] 轻量分享：只读报告、项目模板、批注与结果快照分享

## 分阶段实现进度

### 阶段一：问答时间线与统一会话（v0.3.3）

- [x] AskPanel 聊天时间线
- [x] 问答证据折叠、复制回答与清空会话
- [x] AskPanel 与 AICommandBar 共享当前问答上下文
- [x] 切换数据集时隔离问答历史

### 阶段二：会话管理与快捷操作（v0.3.4）

- [x] 新建、切换、重命名、删除和搜索会话
- [x] 删除单轮问答与重新生成回答
- [x] 快捷追问建议
- [x] 会话按数据集隔离并恢复

### 阶段三：可复现问答与导出（v0.4.0 - v0.4.3）

- [x] 将问答会话保存到 `.metricstudio` 项目
- [x] 问答绑定数据快照和当前 Dashboard 筛选条件，并在证据与导出中保留上下文
- [x] 保存模型信息、生成时间和问答元数据
- [x] 回答证据生成稳定引用 ID，并记录数据集 / 字段 / 行来源
- [x] 问答历史导出为 Markdown / HTML
- [x] 将回答转为 Dashboard 文本卡片或报告内容
- [x] 长会话上下文压缩（保留最近 8 轮，压缩早期上下文）
