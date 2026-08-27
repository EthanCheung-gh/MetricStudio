"""Analysis story generation (v1.0.0)."""


def _make_chart(client, dataset_id):
    return client.post(
        "/api/v1/chart/preview",
        json={
            "dataset_id": dataset_id,
            "encoding": {"chartType": "bar", "x": {"field": "region"}, "yFields": [{"field": "value"}]},
        },
    ).json()


def test_story_renders_all_sections_in_order(client):
    meta = client.post(
        "/api/v1/data/import",
        files={"file": ("sales.csv", b"region,value\nN,1\nS,2\n", "text/csv")},
    ).json()[0]
    figure = _make_chart(client, meta["id"])
    response = client.post(
        "/api/v1/report/story",
        json={
            "title": "季度分析故事",
            "dataset_name": meta["name"],
            "dataset_meta": {"rows": meta["rows"], "cols": meta["cols"]},
            "source_path": "/data/sales.csv",
            "cleaning_steps": ["1. filter value>0"],
            "charts": [{"name": "Value by region", "figure": figure}],
            "insights": ["N 与 S 的均值差异明显"],
            "conclusions": "建议关注南区供给。",
        },
    )
    assert response.status_code == 200, response.text
    doc = response.json()["html"]
    assert "<title>季度分析故事</title>" in doc
    for token in ("数据来源", "清洗步骤", "图表", "洞察", "结论", "生成时间", "sales.csv", "Plotly.newPlot('story-chart-0'"):
        assert token in doc, token
    assert doc.index("数据来源") < doc.index("清洗步骤") < doc.index("图表") < doc.index("洞察") < doc.index("结论")


def test_story_escapes_user_content(client):
    attack = "<script>alert(1)</script>"
    response = client.post(
        "/api/v1/report/story",
        json={"conclusions": attack, "cleaning_steps": [attack], "insights": [attack]},
    )
    assert response.status_code == 200
    doc = response.json()["html"]
    assert attack not in doc
    assert "&lt;script&gt;" in doc


def test_story_rejects_empty_payload(client):
    response = client.post("/api/v1/report/story", json={})
    assert response.status_code == 400


def test_story_localized_labels(client):
    response = client.post(
        "/api/v1/report/story",
        json={"locale": "en", "dataset_name": "d", "insights": ["i"], "conclusions": "done"},
    )
    doc = response.json()["html"]
    assert "Data source" in doc and "Insights" in doc and "Conclusions" in doc
