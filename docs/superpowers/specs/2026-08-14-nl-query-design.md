# NL 查询设计规范

> 自然语言 → 变换链（LLM 生成 + 严格校验 + 预览后应用）
> 日期: 2026-08-14 · 状态: 已批准

## 1. 目标

用户用自然语言描述数据清洗需求，LLM 生成操作链（JSON），经 pydantic 严格校验后**预览确认再应用**。

## 2. LLM Provider（`backend/core/llm.py`）

- 统一 OpenAI 兼容 chat completions（Ollama 也支持 `/v1/chat/completions`）
- 配置 `~/.metricstudio/llm-config.json`：`{ base_url, model, api_key }`
- `chat(messages) -> str`；不可用抛异常（不静默回退）

## 3. NL 端点（`backend/api/nl.py`）

`POST /api/v1/nl/transform` `{dataset_id, query}` → `{operations, raw}`

流程：组装 prompt（列 schema + 算子说明 + JSON 格式）→ LLM → 解析 JSON → 校验（type 合法 + params 字典）。

## 4. 前端

- NL 输入 + 生成 → 显示操作链预览 → 应用（复用 batch 端点）
- LLM 设置面板（base_url / model / api_key）

## 5. 测试（golden set + mock）

- mock LLM 验证 prompt/解析/校验
- 校验拒绝非法操作链
- LLM 不可用返回 502
- 操作链可执行性（生成 → batch 应用）

## 6. 非目标

- 流式输出
- 多轮对话（AI 问答面板后续）
