"""Report generation: dataset summary + insights + charts + notes -> HTML."""

from __future__ import annotations

import html
import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.core.session import session

router = APIRouter(prefix="/api/v1/report", tags=["report"])

_PLOTLY_CDN = "https://cdn.plot.ly/plotly-latest.min.js"


@router.post("/generate")
async def generate_report(payload: dict):
    title = payload.get("title", "未命名报告")
    dataset_id = payload.get("dataset_id")
    charts = payload.get("charts", [])  # [{name, figure}]
    kpis = payload.get("kpis", [])  # [{label, value, detail}]
    text_cards = payload.get("text_cards", [])  # [{text}]
    notes = payload.get("notes", "")
    filter_descriptions = [str(f) for f in payload.get("filter_descriptions", []) if str(f).strip()]
    include_insights = bool(payload.get("include_insights", True))
    locale = "en" if payload.get("locale") == "en" else "zh"
    labels = {
        "zh": {"insights": "洞察", "kpis": "关键指标", "notes": "注释", "rows": "行", "cols": "列", "engine": "引擎",
               "chart": "图表", "filters": "筛选条件", "generatedAt": "生成时间"},
        "en": {"insights": "Insights", "kpis": "Key metrics", "notes": "Notes", "rows": "rows", "cols": "cols",
               "engine": "engine", "chart": "Chart", "filters": "Filters", "generatedAt": "Generated at"},
    }[locale]

    dataset_meta = None
    insights_html = ""
    if dataset_id:
        try:
            dataset = session.get(dataset_id)
            meta = dataset.to_meta()
            dataset_meta = {
                "name": meta.name,
                "rows": meta.rows,
                "cols": meta.cols,
                "engine": meta.engine,
            }
            if include_insights:
                from backend.core.insights import generate_insights

                insights = generate_insights(dataset.df, locale=locale)
                if insights:
                    items = "".join(
                        f"<li>{html.escape(i['text'])}</li>" for i in insights
                    )
                    insights_html = f"<section><h2>{labels['insights']}</h2><ul>{items}</ul></section>"
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    meta_html = ""
    if dataset_meta:
        meta_html = (
            f'<p class="meta">{html.escape(dataset_meta["name"])} '
            f"&middot; {dataset_meta['rows']} {labels['rows']} &times; {dataset_meta['cols']} {labels['cols']} "
            f"&middot; {labels['engine']}: {dataset_meta['engine']}</p>"
        )

    def script_json(value) -> str:
        return json.dumps(value).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")

    chart_divs = ""
    chart_scripts = ""
    for i, chart in enumerate(charts):
        name = html.escape(str(chart.get("name", f"{labels['chart']} {i + 1}")))
        figure = chart.get("figure", {})
        div_id = f"chart-{i}"
        chart_divs += (
            f'<section class="chart-block"><h2>{name}</h2>'
            f'<div id="{div_id}" class="chart"></div></section>'
        )
        chart_scripts += (
            f"Plotly.newPlot('{div_id}', {script_json(figure.get('data', []))}, "
            f"{script_json(figure.get('layout', {}))}, {{responsive: true, displaylogo: false}});"
        )

    kpi_html = ""
    if kpis:
        cards = "".join(
            '<div class="kpi">'
            f'<div class="kpi-value">{html.escape(str(kpi.get("value", "—")))}</div>'
            f'<div class="kpi-label">{html.escape(str(kpi.get("label", "KPI")))}</div>'
            f'<div class="kpi-detail">{html.escape(str(kpi.get("detail", "")))}</div>'
            "</div>"
            for kpi in kpis
        )
        kpi_html = f'<section><h2>{labels["kpis"]}</h2><div class="kpi-grid">{cards}</div></section>'

    text_html = "".join(
        f'<section class="text-card"><p>{html.escape(str(card.get("text", "")))}</p></section>'
        for card in text_cards
        if str(card.get("text", "")).strip()
    )
    notes_html = (
        f"<section><h2>{labels['notes']}</h2><p>{html.escape(notes)}</p></section>" if notes else ""
    )

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    filters_html = ""
    if filter_descriptions:
        items = "".join(f"<li>{html.escape(f)}</li>" for f in filter_descriptions)
        filters_html = f'<section><h2>{labels["filters"]}</h2><ul class="filters">{items}</ul></section>'

    document = f"""<!DOCTYPE html>
<html lang="{locale}">
<head>
<meta charset="utf-8">
<title>{html.escape(title)}</title>
<script src="{_PLOTLY_CDN}"></script>
<style>
  body {{ font-family: -apple-system, 'Segoe UI', sans-serif; background: #0f1115; color: #e5e7eb; margin: 0; padding: 32px; }}
  h1 {{ font-size: 22px; }}
  h2 {{ font-size: 15px; color: #9ca3af; margin-top: 28px; border-bottom: 1px solid #26292f; padding-bottom: 6px; }}
  p.meta {{ color: #6b7280; font-size: 12px; }}
  .chart {{ width: 100%; height: 420px; }}
  ul {{ font-size: 13px; line-height: 1.7; }}
  li {{ margin: 4px 0; }}
  section p {{ font-size: 13px; line-height: 1.7; white-space: pre-wrap; }}
  section.chart-block h2 {{ color: #e5e7eb; }}
  .kpi-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }}
  .kpi {{ border: 1px solid #26292f; border-radius: 8px; padding: 16px; }}
  .kpi-value {{ font-size: 28px; font-weight: 700; }}
  .kpi-label {{ margin-top: 5px; font-size: 12px; color: #9ca3af; }}
  .kpi-detail {{ margin-top: 3px; font-size: 11px; color: #6b7280; }}
  .text-card {{ border: 1px solid #26292f; border-radius: 8px; padding: 4px 16px; margin-top: 12px; }}
  ul.filters {{ font-size: 12px; color: #9ca3af; }}
</style>
</head>
<body>
<h1>{html.escape(title)}</h1>
<p class="meta">{labels['generatedAt']}: {generated_at}</p>
{meta_html}
{filters_html}
{insights_html}
{kpi_html}
{chart_divs}
{text_html}
{notes_html}
<script>
{chart_scripts}
</script>
</body>
</html>"""
    return {"html": document}


@router.post("/story")
async def generate_story(payload: dict):
    """Assemble an analysis story HTML from collected building blocks.

    Sections follow the analysis narrative arc: data source -> cleaning steps
    -> charts -> insights -> conclusions. Frontend collects the material from
    live stores; the backend only composes and escapes.
    """
    title = payload.get("title", "分析故事")
    dataset_name = str(payload.get("dataset_name", "")).strip()
    dataset_meta = payload.get("dataset_meta") or {}
    source_path = str(payload.get("source_path", "")).strip()
    cleaning_steps = [str(s) for s in payload.get("cleaning_steps", []) if str(s).strip()]
    charts = payload.get("charts", [])  # [{name, figure}]
    insights = [str(i) for i in payload.get("insights", []) if str(i).strip()]
    conclusions = str(payload.get("conclusions", "")).strip()
    locale = "en" if payload.get("locale") == "en" else "zh"
    labels = {
        "zh": {"source": "数据来源", "cleaning": "清洗步骤", "charts": "图表", "insights": "洞察",
               "conclusions": "结论", "generatedAt": "生成时间", "chart": "图表", "none": "（无）",
               "rows": "行", "cols": "列"},
        "en": {"source": "Data source", "cleaning": "Cleaning steps", "charts": "Charts",
               "insights": "Insights", "conclusions": "Conclusions", "generatedAt": "Generated at",
               "chart": "Chart", "none": "(none)", "rows": "rows", "cols": "cols"},
    }[locale]

    def script_json(value) -> str:
        return json.dumps(value).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")

    meta_bits = []
    if dataset_name:
        meta_bits.append(html.escape(dataset_name))
    if dataset_meta:
        rows = dataset_meta.get("rows")
        cols = dataset_meta.get("cols")
        if rows is not None and cols is not None:
            meta_bits.append(f"{rows} {labels['rows']} × {cols} {labels['cols']}")
    if source_path:
        meta_bits.append(f"<code>{html.escape(source_path)}</code>")
    source_html = (
        f"<section><h2>{labels['source']}</h2><p>{' · '.join(meta_bits)}</p></section>"
        if meta_bits else ""
    )

    steps_html = ""
    if cleaning_steps:
        items = "".join(f"<li>{html.escape(s)}</li>" for s in cleaning_steps)
        steps_html = f'<section><h2>{labels["cleaning"]}</h2><ol class="steps">{items}</ol></section>'

    chart_divs = ""
    chart_scripts = ""
    for i, chart in enumerate(charts):
        name = html.escape(str(chart.get("name", f"{labels['chart']} {i + 1}")))
        figure = chart.get("figure", {})
        div_id = f"story-chart-{i}"
        chart_divs += (
            f'<section class="chart-block"><h2>{name}</h2>'
            f'<div id="{div_id}" class="chart"></div></section>'
        )
        chart_scripts += (
            f"Plotly.newPlot('{div_id}', {script_json(figure.get('data', []))}, "
            f"{script_json(figure.get('layout', {}))}, {{responsive: true, displaylogo: false}});"
        )
    charts_html = (
        f'<section><h2>{labels["charts"]}</h2></section>{chart_divs}'
        if charts else ""
    )

    insights_html = ""
    if insights:
        items = "".join(f"<li>{html.escape(i)}</li>" for i in insights)
        insights_html = f'<section><h2>{labels["insights"]}</h2><ul>{items}</ul></section>'

    conclusions_html = (
        f'<section><h2>{labels["conclusions"]}</h2><p class="conclusion">{html.escape(conclusions)}</p></section>'
        if conclusions else ""
    )
    if not (source_html or steps_html or charts_html or insights_html or conclusions_html):
        raise HTTPException(status_code=400, detail="故事内容为空：至少需要一个章节素材")

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    document = f"""<!DOCTYPE html>
<html lang="{locale}">
<head>
<meta charset="utf-8">
<title>{html.escape(title)}</title>
<script src="{_PLOTLY_CDN}"></script>
<style>
  body {{ font-family: -apple-system, 'Segoe UI', sans-serif; background: #0f1115; color: #e5e7eb; margin: 0 auto; max-width: 900px; padding: 32px; }}
  h1 {{ font-size: 24px; }}
  h2 {{ font-size: 15px; color: #9ca3af; margin-top: 28px; border-bottom: 1px solid #26292f; padding-bottom: 6px; }}
  p.meta {{ color: #6b7280; font-size: 12px; }}
  section p, .conclusion {{ font-size: 13px; line-height: 1.8; white-space: pre-wrap; }}
  ul, ol.steps {{ font-size: 13px; line-height: 1.7; }}
  li {{ margin: 4px 0; }}
  code {{ background: #1a1d23; padding: 2px 6px; border-radius: 4px; font-size: 12px; }}
  .chart {{ width: 100%; height: 400px; }}
  section.chart-block h2 {{ color: #e5e7eb; }}
</style>
</head>
<body>
<h1>{html.escape(title)}</h1>
<p class="meta">{labels['generatedAt']}: {generated_at}</p>
{source_html}
{steps_html}
{charts_html}
{insights_html}
{conclusions_html}
<script>
{chart_scripts}
</script>
</body>
</html>"""
    return {"html": document}
