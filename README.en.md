# MetricStudio

English | [简体中文](README.md)

A Plotly-based personal data analysis desktop app. Import data, then clean and transform it, build visual charts, compose interactive dashboards, and use AI for data Q&A, insight narratives and statistical explanations — your data never leaves the machine.

Current version: **1.2.0**

## Screenshots

| Data sheet & quality center | Charts |
|---|---|
| ![Data sheet & quality center](png/01-metricstudio-datasheet.png) | ![Charts](png/02-metricstudio-plot.png) |
| **Drag-and-drop chart config** | **Dashboard composition** |
| ![Drag-and-drop chart config](png/03-metricstudio-config-properties-panel.png) | ![Dashboard composition](png/04-metricstudio-dashboard.png) |
| **Command palette** | **SQL workbench** |
| ![Command palette](png/05-metricstudio-command-panel.png) | ![SQL workbench](png/06-metricstudio-sql-stat.png) |

## Features

### Data management
- Multi-format import: CSV / Excel (merge or split sheets) / Parquet / JSON (incl. NDJSON) / SQLite tables / pasted text
- Immutable data snapshots: materialize any transform step, diff snapshots, restore as new datasets
- Transform chains: 16 operation types (filter / sort / pivot / join / computed columns / string cleanup, etc.) with per-step preview, step-level enable/disable, global undo & redo
- Source auto-refresh: watches source files, replays the transform chain, keeps the last good version on failure, versioned datasets
- SQL workbench: read-only SELECT across datasets, `EXPLAIN QUERY PLAN`, in-session history, save results as new datasets

### Visualization & dashboards
- 20+ chart types (line / bar / pie / histogram / box / violin / heatmap / treemap / sankey / parallel coordinates, etc.) with drag-and-drop encoding
- Dashboards: multi-page composition, KPI cards, text cards, cross-card selection linking, dashboard-level filters (server-side search & pagination for high-cardinality fields)
- Editing: edit/view modes, card locking, dashboard duplication, alignment & even-spacing layout tools, dashboard-level undo/redo, sidebar width memory
- Export: self-contained interactive HTML (records filters and generation time)

### AI assistance (OpenAI-compatible endpoints; works with local Ollama)
- Natural-language cleaning: describe what you want → a validated operation chain, applied only after confirmation
- Multi-turn data Q&A: bound to snapshots and dashboard filters, deterministic tool calling (11 tools incl. group-by aggregates, filtered stats, time aggregation) with a 3-round iterative loop, and inline [n] citations back to computed facts
- Follow-up suggestions and clarification prompts when a question is ambiguous
- Insights / narratives / chart explanations; answers can become dashboard text cards or report paragraphs in one click
- Data privacy: sensitive-column detection with redaction / exclusion, local vs. cloud model choice

### Statistics & quality
- Time-series workbench: monthly aggregation, YoY / MoM, moving averages, anomaly detection, trend extrapolation
- Statistics toolbox: correlation heatmap, linear regression (R² / p-value / interpretation), Welch t / paired t / Mann-Whitney U tests, confidence intervals
- Data quality center: missing / duplicate / outlier / format detection, sample rows, per-column summaries, safe fix previews (1.5×IQR clipping, median imputation, etc.)

### Desktop & reliability
- Tauri 2 desktop app with a Python FastAPI sidecar (auto start/stop); sessions auto-recover after crashes (raw data + transform chain replay)
- Project packaging: a single `.metricstudio` file carrying data, transform chains, charts, dashboards, Q&A conversations and snapshots; autosave
- Bilingual UI (简体中文 / English), customizable shortcuts, command palette, dark & light themes

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2.x (Rust): sidecar lifecycle, random port, health recovery |
| Frontend | React 19 + TypeScript + Vite, Zustand, HeroUI, react-grid-layout, @tanstack/react-table + virtual |
| Visualization | Plotly.js (figures built server-side, rendered in the frontend) |
| Backend | Python FastAPI + pandas / polars dual engine, numpy / scipy statistics, built-in sqlite3 (SQL workbench) |
| AI | OpenAI-compatible chat completions (Ollama or cloud endpoints) |
| i18n | i18next (简体中文 / English) |

## Getting started

### Requirements

- Node.js 22+ and pnpm (corepack)
- Python 3.10+
- Rust / Cargo (only for building the Tauri desktop shell)

### Development mode (Web)

```bash
pnpm install
cd backend && uv venv && uv pip install -r requirements.txt && cd ..

pnpm dev        # starts Vite (5173) and the backend (8123) together
```

Open http://localhost:5173 . For LAN access:

```bash
METRICSTUDIO_BACKEND_HOST=0.0.0.0 pnpm dev
# Other devices: http://<your-ip>:5173 — the frontend resolves the API on the same host at port 8123
```

### Desktop app

```bash
pnpm tauri dev     # development
pnpm tauri build   # package installers (same flow as CI)
```

In production the Rust shell starts the Python sidecar on a random port; the frontend obtains the port via IPC.

## Tests & quality

```bash
pnpm test              # frontend Vitest
pnpm lint              # oxlint
pnpm build             # tsc + vite production build
pnpm test:backend      # backend pytest (220+ cases)
```

## Code map

Module dependencies, core call chains and hub symbols: [docs/CODEMAP.md](docs/CODEMAP.md). The repo ships with a [CodeGraph](https://codegraph.dev) index (`.codegraph/`) for code navigation and impact analysis:

```bash
codegraph sync                 # refresh the index after code changes
codegraph explore "nl_ask"     # explore a symbol / region and its call paths
codegraph callers session      # who calls a symbol
codegraph impact Dataset       # what a change to a symbol affects
```

## Project layout

```
├── backend/            # FastAPI backend (api routes / core domain logic / models / tests)
├── src/                # React frontend (api / components / stores / utils / i18n)
├── src-tauri/          # Tauri desktop shell (Rust sidecar management)
├── scripts/            # dev & packaging scripts (dev / sidecar / smoke checks)
└── docs/CODEMAP.md     # code map (module graph + call chains)
```

## Versions

See [package.json](package.json) for the current version (kept in sync with `src-tauri` and backend manifests). Roadmap and completion:

- **v0.3.x – v0.4.x**: Q&A timeline, session management, context reproduction, answers to analysis artifacts
- **v0.5.x**: data privacy controls, large-data filtering (server-side search / pagination / caching)
- **v0.6.x**: data quality center, dashboard editing enhancements, export enhancements, source refresh, transform chain enhancements
- **v0.7.0**: autosave & project reliability
- **v0.8.x**: time-series workbench, statistics toolbox
- **v0.9.0**: SQL query workbench
- **v1.0.0**: analysis story mode (P0–P2 complete)
- **v1.1.x**: editing experience & robustness polish
- **v1.2.0**: smarter data Q&A — iterative tool calling (3 rounds × 11 deterministic tools), inline [n] citations, adaptive context, follow-up suggestions & clarification

Next up (P3): discovery-oriented home page, plugin system, lightweight sharing.

## License

This project is licensed under the [Apache License 2.0](LICENSE).

```
Copyright 2026 The MetricStudio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

Issues and pull requests are welcome. Unless otherwise stated, contributions are licensed under Apache 2.0 when merged into this project.
