"""Report generation: dataset summary + insights + charts + notes -> HTML."""

from __future__ import annotations

import html
import json

from fastapi import APIRouter, HTTPException

from backend.core.session import session

router = APIRouter(prefix="/api/v1/report", tags=["report"])

_PLOTLY_CDN = "https://cdn.plot.ly/plotly-latest.min.js"


@router.post("/generate")
async def generate_report(payload: dict):
    title = payload.get("title", "未命名报告")
    dataset_id = payload.get("dataset_id")
    charts = payload.get("charts", [])  # [{name, figure}]
    notes = payload.get("notes", "")
    include_insights = bool(payload.get("include_insights", True))

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

                insights = generate_insights(dataset.df)
                if insights:
                    items = "".join(
                        f"<li>{html.escape(i['text'])}</li>" for i in insights
                    )
                    insights_html = f"<section><h2>洞察</h2><ul>{items}</ul></section>"
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    meta_html = ""
    if dataset_meta:
        meta_html = (
            f'<p class="meta">{html.escape(dataset_meta["name"])} '
            f"&middot; {dataset_meta['rows']} rows &times; {dataset_meta['cols']} cols "
            f"&middot; engine: {dataset_meta['engine']}</p>"
        )

    chart_divs = ""
    chart_scripts = ""
    for i, chart in enumerate(charts):
        name = html.escape(str(chart.get("name", f"Chart {i + 1}")))
        figure = chart.get("figure", {})
        div_id = f"chart-{i}"
        chart_divs += (
            f'<section class="chart-block"><h2>{name}</h2>'
            f'<div id="{div_id}" class="chart"></div></section>'
        )
        chart_scripts += (
            f"Plotly.newPlot('{div_id}', {json.dumps(figure.get('data', []))}, "
            f"{json.dumps(figure.get('layout', {}))}, {{responsive: true, displaylogo: false}});"
        )

    notes_html = (
        f"<section><h2>注释</h2><p>{html.escape(notes)}</p></section>" if notes else ""
    )

    document = f"""<!DOCTYPE html>
<html lang="en">
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
</style>
</head>
<body>
<h1>{html.escape(title)}</h1>
{meta_html}
{insights_html}
{chart_divs}
{notes_html}
<script>
{chart_scripts}
</script>
</body>
</html>"""
    return {"html": document}
