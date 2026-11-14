"""Declarative custom charts: validation, storage, transforms and rendering.

These tests are deliberately module-level (no HTTP). The JSON manifests in
``examples/charts/`` are real fixtures: every example must validate *and*
render through the same public API the API layer will use.
"""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from backend.core import custom_charts as cc

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / "examples" / "charts"


# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------

BASE_MANIFEST = {
    "schemaVersion": 1,
    "id": "dumbbell",
    "label": {"zh": "哑铃图", "en": "Dumbbell"},
    "description": {
        "zh": "比较两个时点的差距",
        "en": "Compare two points per category",
    },
    "channels": {
        "x": {"required": True, "types": ["nominal", "temporal"]},
        "yFields": {"mode": "range"},
        "color": {"required": False, "types": ["nominal"]},
    },
    "transforms": [
        {"op": "dropna", "slots": ["x", "y0", "y1"]},
        {"op": "sort", "by": "y1", "descending": True},
        {"op": "limit", "count": 20},
    ],
    "traces": [
        {
            "type": "scatter",
            "mode": "lines",
            "x": "$x",
            "y": "$y0",
            "showlegend": False,
            "line": {"color": "$opt.connector", "width": "$opt.width"},
        },
        {
            "type": "scatter",
            "mode": "markers",
            "x": "$x",
            "y": "$y1",
            "name": "$y1.label",
            "marker": {"size": 10},
        },
    ],
    "layout": {
        "showlegend": True,
        "margin": {"l": 70, "r": 20, "t": 30, "b": 50},
    },
    "options": [
        {
            "key": "connector",
            "type": "text",
            "default": "#cbd5e1",
            "label": {"zh": "连线颜色", "en": "Connector color"},
        },
        {
            "key": "width",
            "type": "number",
            "default": 2,
            "label": {"zh": "线宽", "en": "Line width"},
        },
    ],
    "keywords": ["哑铃图", "dumbbell chart"],
}


@pytest.fixture(autouse=True)
def charts_dir(tmp_path, monkeypatch):
    """Isolate every test in a fresh CHART_DIR and clear the mtime cache."""
    directory = tmp_path / "charts"
    monkeypatch.setattr(cc, "CHART_DIR", directory)
    cc._invalidate_cache()
    yield directory
    cc._invalidate_cache()


def payload() -> dict:
    return copy.deepcopy(BASE_MANIFEST)


def errors_of(data: dict) -> str:
    with pytest.raises(ValueError) as exc:
        cc.validate_payload(data)
    return str(exc.value)


def minimal_manifest(
    *,
    chart_id: str = "transformdemo",
    transforms: list | None = None,
    traces: list | None = None,
    channels: dict | None = None,
    options: list | None = None,
    layout: dict | None = None,
    keywords: list | None = None,
) -> dict:
    data = {
        "schemaVersion": 1,
        "id": chart_id,
        "label": {"zh": "变换演示", "en": "Transform demo"},
        "channels": channels
        if channels is not None
        else {
            "x": {"required": True, "types": ["nominal"]},
            "yFields": {"mode": "one"},
        },
        "transforms": list(transforms or []),
        "traces": traces
        if traces is not None
        else [{"type": "bar", "x": "$x", "y": "$y0"}],
        "keywords": list(keywords or []),
    }
    if options is not None:
        data["options"] = options
    if layout is not None:
        data["layout"] = layout
    return data


def example(name: str) -> dict:
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


def channel(field: str, type_: str = "quantitative"):
    return SimpleNamespace(field=field, type=type_)


def y_channel(field: str, type_: str = "quantitative", label: str | None = None):
    return SimpleNamespace(field=field, type=type_, label=label)


def encoding(
    *,
    x=None,
    y=(),
    color=None,
    size=None,
    z=None,
    error=None,
    facet=None,
    source=None,
    target=None,
    options=None,
    chart_type="custom",
):
    return SimpleNamespace(
        x=x,
        y_fields=list(y),
        color=color,
        size=size,
        z=z,
        error=error,
        facet=facet,
        source=source,
        target=target,
        options=options,
        chart_type=chart_type,
    )


def toy_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "city": ["A", "B", "C"],
            "start": [10.0, 20.0, 30.0],
            "end": [18.0, 17.0, 45.0],
        }
    )


def dumbbell_encoding(*, options=None, x=None):
    return encoding(
        x=x if x is not None else channel("city", "nominal"),
        y=[
            y_channel("start", label="Start"),
            y_channel("end", label="End"),
        ],
        options=options,
        chart_type="dumbbell",
    )


def segment_manifest(*, horizontal=None, chart_id="segmentsdemo") -> dict:
    segments = {"x": "$x", "from": "$y0", "to": "$y1"}
    if horizontal is not None:
        segments["horizontal"] = horizontal
    return minimal_manifest(
        chart_id=chart_id,
        channels={
            "x": {"required": True, "types": ["nominal"]},
            "yFields": {"mode": "range"},
        },
        traces=[{"type": "scatter", "mode": "lines", "segments": segments}],
    )


def segment_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "low": [1.0, 2.0, 3.0],
            "high": [4.0, 5.0, 6.0],
        }
    )


def segment_encoding(*, options=None):
    return encoding(
        x=channel("cat", "nominal"),
        y=[y_channel("low", label="Low"), y_channel("high", label="High")],
        options=options,
    )


def split_facet_manifest(*, showlegend=None) -> dict:
    trace = {
        "type": "scatter",
        "mode": "markers",
        "x": "$x",
        "y": "$y0",
        "splitBy": "$color",
    }
    if showlegend is not None:
        trace["showlegend"] = showlegend
    return minimal_manifest(
        chart_id="facet-split",
        channels={
            "x": {"required": True, "types": ["nominal"]},
            "yFields": {"mode": "one"},
            "color": {"required": True, "types": ["nominal"]},
            "facet": {"required": True, "types": ["nominal"]},
        },
        traces=[trace],
    )


def typed_option_manifest() -> dict:
    def label(zh: str, en: str) -> dict:
        return {"zh": zh, "en": en}

    return minimal_manifest(
        chart_id="typedoptions",
        channels={
            "x": {"required": True, "types": ["nominal"]},
            "yFields": {"mode": "one"},
        },
        traces=[
            {
                "type": "bar",
                "x": "$x",
                "y": "$y0",
                "showlegend": "$opt.show",
                "width": "$opt.width",
                "marker": {"color": "$opt.color"},
            }
        ],
        layout={"hovermode": "$opt.mode"},
        options=[
            {
                "key": "show",
                "type": "boolean",
                "default": True,
                "label": label("显示图例", "Show legend"),
            },
            {
                "key": "width",
                "type": "number",
                "default": 0.5,
                "label": label("柱宽", "Bar width"),
            },
            {
                "key": "color",
                "type": "text",
                "default": "#111111",
                "label": label("颜色", "Color"),
            },
            {
                "key": "mode",
                "type": "select",
                "default": "x",
                "choices": ["x", "y"],
                "label": label("悬停模式", "Hover mode"),
            },
        ],
    )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_validate_happy_path():
    manifest = cc.validate_payload(payload())
    assert manifest.schema_version == 1
    assert manifest.id == "dumbbell"
    assert manifest.label.zh == "哑铃图"
    assert manifest.label.en == "Dumbbell"
    assert manifest.description is not None
    assert manifest.channels.x is not None
    assert manifest.channels.x.required is True
    assert manifest.channels.x.types == ["nominal", "temporal"]
    assert manifest.channels.y_fields is not None
    assert manifest.channels.y_fields.mode == "range"
    assert manifest.channels.color is not None
    assert manifest.channels.color.required is False
    assert manifest.model_dump(by_alias=True)["schemaVersion"] == 1
    assert manifest.model_dump(by_alias=True)["channels"]["yFields"] == {
        "mode": "range"
    }


@pytest.mark.parametrize("value", [2, "1", 1.0, None])
def test_unknown_schema_version(value):
    bad = payload()
    bad["schemaVersion"] = value
    assert "schemaVersion: must be 1" in errors_of(bad)


def test_missing_schema_version():
    bad = payload()
    bad.pop("schemaVersion")
    assert "schemaVersion" in errors_of(bad)


@pytest.mark.parametrize(
    "bad_id",
    ["Dumbbell", "a", "../evil", "a/b", "a.b", "has space", "x" * 41, ""],
)
def test_bad_id(bad_id):
    bad = payload()
    bad["id"] = bad_id
    assert "id: must match" in errors_of(bad)


def test_builtin_id_collision():
    bad = payload()
    bad["id"] = "bar"
    assert "collides with a built-in chart type" in errors_of(bad)


@pytest.mark.parametrize(
    "reserved",
    ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"],
)
def test_windows_reserved_id(reserved):
    bad = payload()
    bad["id"] = reserved
    assert (
        f"id: {reserved!r} is a reserved name on Windows"
        in errors_of(bad)
    )


def test_label_and_description_lengths():
    bad = payload()
    bad["label"].pop("en")
    assert "label.en" in errors_of(bad)

    bad = payload()
    bad["label"]["zh"] = "长" * 61
    assert "label.zh: must be 1-60 characters" in errors_of(bad)

    bad = payload()
    bad["description"] = {"zh": "只有中文"}
    assert "description.en" in errors_of(bad)

    bad = payload()
    bad["description"]["en"] = "x" * 201
    assert "description.en: must be 1-200 characters" in errors_of(bad)

    bad = payload()
    bad["label"]["fr"] = "Etiquette"
    assert "unsupported language" in errors_of(bad)


def test_unknown_channel_key():
    bad = payload()
    bad["channels"]["theta"] = {"required": True}
    assert "unknown channel" in errors_of(bad)


def test_channel_declares_something_usable():
    bad = payload()
    bad["channels"] = {}
    assert "declare at least one channel" in errors_of(bad)

    bad = payload()
    bad["channels"] = {"yFields": {"mode": "none"}}
    assert "declare at least one channel" in errors_of(bad)


def test_channel_types_and_required():
    bad = payload()
    bad["channels"]["x"]["types"] = ["ordinal"]
    assert "must be one of" in errors_of(bad)

    bad = payload()
    bad["channels"]["x"]["required"] = "yes"
    assert "channels.x.required" in errors_of(bad)

    bad = payload()
    bad["channels"]["yFields"]["mode"] = "many"
    assert "channels.yFields.mode" in errors_of(bad)


def test_unknown_transform_op():
    bad = payload()
    bad["transforms"] = [{"op": "explode", "field": "x"}]
    assert "unsupported transform op 'explode'" in errors_of(bad)


def test_transform_details_are_validated():
    bad = payload()
    bad["transforms"] = [{"op": "dropna", "slots": []}]
    assert "must list 1-6 slots" in errors_of(bad)

    bad = payload()
    bad["transforms"] = [{"op": "dropna", "slots": ["$x"]}]
    assert "use bare slot names in transforms" in errors_of(bad)

    bad = payload()
    bad["transforms"] = [{"op": "sort", "by": "nope"}]
    assert "unknown slot 'nope'" in errors_of(bad)

    bad = payload()
    bad["transforms"] = [{"op": "limit", "count": 0}]
    assert "between 1 and 5000" in errors_of(bad)

    bad = payload()
    bad["transforms"] = [
        {"op": "group_agg", "groupBy": "x", "field": "y0", "agg": "total", "as": "v"}
    ]
    assert "must be one of sum, mean, count, min, max" in errors_of(bad)

    bad = payload()
    bad["transforms"] = [
        {"op": "group_agg", "groupBy": "x", "field": "y0", "agg": "sum", "as": "x"}
    ]
    assert "shadows an existing slot" in errors_of(bad)

    bad = payload()
    bad["transforms"] = [{"op": "cumulate", "field": "y0", "as": "Bad Name"}]
    assert "^[a-z][a-z0-9_]{0,23}$" in errors_of(bad)

    bad = payload()
    bad["transforms"] = [{"op": "limit", "count": 1}] * 9
    assert "at most 8 allowed" in errors_of(bad)


def test_unknown_trace_type():
    bad = payload()
    bad["traces"][0]["type"] = "mesh3d"
    assert "unsupported trace type 'mesh3d'" in errors_of(bad)


def test_trace_count():
    bad = payload()
    bad["traces"] = []
    assert "must contain 1-8 traces" in errors_of(bad)


def test_style_key_not_allowed():
    bad = payload()
    bad["traces"][0]["bogus"] = 1
    assert "unsupported key" in errors_of(bad)

    bad = payload()
    bad["traces"][0]["line"]["bogus"] = 1
    assert "unsupported style key for line" in errors_of(bad)

    bad = payload()
    bad["traces"][0]["marker"] = 5
    assert "must be an object" in errors_of(bad)


def test_unresolvable_slots():
    bad = payload()
    bad["traces"][0]["y"] = "$y2"
    assert "yFields.mode 'range'" in errors_of(bad)

    bad = payload()
    bad["traces"][0]["x"] = "$nope"
    assert "unknown data slot" in errors_of(bad)

    bad = payload()
    bad["channels"].pop("yFields")
    bad["traces"][0]["y"] = "$y0"
    assert "requires channels.yFields.mode" in errors_of(bad)

    bad = payload()
    bad["channels"].pop("x")
    assert "requires an 'x' channel" in errors_of(bad)


def test_slot_positions():
    bad = payload()
    bad["traces"][0]["line"]["color"] = "$y0"
    assert "only allowed on x, y, z, labels, values" in errors_of(bad)

    bad = payload()
    bad["traces"][0]["y"] = "$x.label"
    assert "only allowed in name or text" in errors_of(bad)

    bad = payload()
    bad["traces"][0]["y"] = "$opt.width"
    assert "only allowed in style or layout positions" in errors_of(bad)

    bad = payload()
    bad["traces"][0]["line"]["color"] = "$opt.missing"
    assert "unknown option 'missing'" in errors_of(bad)

    bad = payload()
    bad["traces"][0]["name"] = "$y0"
    assert "only allowed on x, y, z, labels, values" in errors_of(bad)


def test_keyword_validation():
    bad = payload()
    bad["keywords"] = ["哑铃图", "哑铃图"]
    assert "duplicate keyword" in errors_of(bad)

    bad = payload()
    bad["keywords"] = ["bar chart"]
    assert "already used by built-in chart type 'bar'" in errors_of(bad)

    bad = payload()
    bad["keywords"] = ["a"]
    assert "2-24 characters" in errors_of(bad)

    bad = payload()
    bad["keywords"] = ["one", "two", "three", "four", "five", "six"]
    assert "at most 5 allowed" in errors_of(bad)


def test_keyword_collision_with_custom_manifest():
    other = payload()
    other["id"] = "otherchart"
    other["label"] = {"zh": "另一张图", "en": "Other chart"}
    other["keywords"] = ["Trend Line"]
    cc.save_manifest(other)

    bad = payload()
    bad["keywords"] = ["trend line"]
    message = errors_of(bad)
    assert "already used by custom chart 'otherchart'" in message


def test_layout_validation():
    bad = payload()
    bad["layout"]["template"] = "plotly_white"
    assert "not an allowed layout key" in errors_of(bad)

    bad = payload()
    bad["layout"]["showlegend"] = "$x"
    assert "layout values may only use $opt.<key> slots" in errors_of(bad)

    bad = payload()
    bad["layout"]["showlegend"] = "$opt.missing"
    assert "unknown option 'missing'" in errors_of(bad)


def test_options_validation():
    bad = payload()
    bad["options"][0]["key"] = "1bad"
    assert "options[0].key" in errors_of(bad)

    bad = payload()
    bad["options"][1]["key"] = "connector"
    assert "duplicate option key" in errors_of(bad)

    bad = payload()
    bad["options"][0]["type"] = "colour"
    assert "options[0].type" in errors_of(bad)

    bad = payload()
    bad["options"].append(
        {
            "key": "choice",
            "type": "select",
            "default": "a",
            "label": {"zh": "选择", "en": "Choice"},
        }
    )
    assert "select options need 1-20 choices" in errors_of(bad)

    bad = payload()
    bad["options"].append(
        {
            "key": "choice",
            "type": "select",
            "default": "c",
            "choices": ["a", "b"],
            "label": {"zh": "选择", "en": "Choice"},
        }
    )
    assert "must be one of the choices" in errors_of(bad)

    bad = payload()
    bad["options"][0]["choices"] = ["a", "b"]
    assert "only allowed for select options" in errors_of(bad)

    bad = payload()
    bad["options"][0]["type"] = "boolean"
    bad["options"][0]["default"] = "yes"
    assert "must be true or false" in errors_of(bad)

    bad = payload()
    bad["options"][1]["default"] = "not-a-number"
    assert "must be a finite number" in errors_of(bad)

    bad = payload()
    bad["options"][0].pop("default")
    assert "options[0].default: is required" in errors_of(bad)

    bad = payload()
    bad["options"][0]["label"].pop("en")
    assert "options[0].label.en" in errors_of(bad)


@pytest.mark.parametrize(
    "reserved",
    ["barmode", "boxPoints", "box_points", "marginalX", "gaugeMin", "cumulative"],
)
def test_option_key_cannot_shadow_chart_options(reserved):
    bad = payload()
    bad["options"][0]["key"] = reserved
    bad["traces"][0]["line"]["color"] = f"$opt.{reserved}"
    message = errors_of(bad)
    assert (
        f"options[0].key: {reserved!r} is reserved by the built-in option set"
        in message
    )
    assert "refers to unknown option" not in message


def test_reserved_option_keys_cover_chart_options_model():
    from backend.models.chart import ChartOptions

    model_keys = set(ChartOptions.model_fields)
    model_keys |= {
        field.alias
        for field in ChartOptions.model_fields.values()
        if field.alias
    }
    assert model_keys <= cc._RESERVED_OPTION_KEYS


def test_unknown_top_level_key():
    bad = payload()
    bad["unexpected"] = True
    assert "unknown top-level key" in errors_of(bad)


def test_validation_collects_every_error():
    bad = payload()
    bad["schemaVersion"] = 9
    bad["id"] = "Not Valid"
    bad["traces"][0]["type"] = "mesh3d"
    message = errors_of(bad)
    assert "schemaVersion" in message
    assert "id: must match" in message
    assert "unsupported trace type" in message
    assert message.count(";") >= 2


def test_path_traversal_ids_are_rejected_everywhere():
    for bad_id in ("../evil", "/etc/passwd", "..", "a/b"):
        assert cc.load_manifest(bad_id) is None
        assert cc.is_custom_id(bad_id) is False
        assert cc.delete_manifest(bad_id) is False
    bad = payload()
    bad["id"] = "../evil"
    with pytest.raises(ValueError):
        cc.save_manifest(bad)
    assert not (cc.CHART_DIR.parent / "evil.json").exists()


def test_file_stem_must_match_manifest_id(charts_dir):
    charts_dir.mkdir()
    data = payload()
    data["id"] = "rightid"
    (charts_dir / "wrongname.json").write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8"
    )
    valid, invalid = cc.list_manifests()
    assert valid == []
    assert invalid[0]["file"] == "wrongname.json"
    assert any("does not match the file name" in e for e in invalid[0]["errors"])


# ---------------------------------------------------------------------------
# splitBy / array style slots: validation
# ---------------------------------------------------------------------------

def test_split_by_only_accepts_color():
    data = payload()
    data["traces"][0] = {
        "type": "scatter",
        "mode": "lines+markers",
        "splitBy": "$size",
        "x": "$x",
        "y": "$y0",
    }
    assert "traces[0].splitBy: only '$color' is supported" in errors_of(data)


def test_split_by_requires_a_color_channel():
    data = payload()
    data["channels"].pop("color")
    data["traces"][0] = {
        "type": "scatter",
        "mode": "lines+markers",
        "splitBy": "$color",
        "x": "$x",
        "y": "$y0",
    }
    assert "traces[0].splitBy: requires a 'color' channel" in errors_of(data)


def test_split_by_rejects_unsupported_trace_type():
    data = payload()
    data["traces"][0] = {
        "type": "waterfall",
        "splitBy": "$color",
        "x": "$x",
        "y": "$y0",
    }
    assert (
        "traces[0].splitBy: not supported on trace type 'waterfall'"
        in errors_of(data)
    )


def test_split_by_cannot_also_plot_the_color_slot():
    data = payload()
    data["traces"][0] = {
        "type": "scatter",
        "mode": "lines+markers",
        "splitBy": "$color",
        "x": "$color",
        "y": "$y0",
    }
    assert (
        "traces[0]: a split trace cannot also plot the 'color' slot"
        in errors_of(data)
    )

    data = payload()
    data["traces"][0] = {
        "type": "scatter",
        "mode": "lines+markers",
        "splitBy": "$color",
        "x": "$x",
        "y": "$y0",
        "marker": {"color": "$color.values"},
    }
    assert (
        "traces[0]: a split trace cannot also plot the 'color' slot"
        in errors_of(data)
    )

    data = payload()
    data["traces"][0] = {
        "type": "scatter",
        "mode": "lines",
        "splitBy": "$color",
        "segments": {"x": "$color", "from": "$y0", "to": "$y1"},
    }
    assert (
        "traces[0]: a split trace cannot also plot the 'color' slot"
        in errors_of(data)
    )


def test_split_by_color_must_survive_group_agg():
    data = payload()
    data["transforms"] = [
        {
            "op": "group_agg",
            "groupBy": "x",
            "field": "y0",
            "agg": "sum",
            "as": "total",
        },
    ]
    data["traces"] = [
        {
            "type": "scatter",
            "mode": "markers",
            "splitBy": "$color",
            "x": "$x",
            "y": "$total",
        }
    ]
    message = errors_of(data)
    assert (
        "traces[0].splitBy: the 'color' slot is not available after the "
        "preceding transforms (group_agg drops ungrouped columns)"
        in message
    )


def test_split_by_color_survives_group_agg_grouped_by_color():
    data = payload()
    data["channels"]["yFields"] = {"mode": "one"}
    data["transforms"] = [
        {
            "op": "group_agg",
            "groupBy": "color",
            "field": "y0",
            "agg": "sum",
            "as": "total",
        },
    ]
    data["traces"] = [
        {
            "type": "bar",
            "y": "$total",
            "splitBy": "$color",
        }
    ]
    manifest = cc.validate_payload(data)
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "A"],
            "val": [1.0, 2.0, 3.0],
            "grp": ["g1", "g2", "g1"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == 2
    assert [
        trace["name"] for trace in figure["data"]
    ] == ["g1", "g2"]
    assert [trace["y"] for trace in figure["data"]] == [[4.0], [2.0]]


def test_split_by_with_segments_is_allowed_when_color_is_not_plotted():
    data = payload()
    data["traces"][0] = {
        "type": "scatter",
        "mode": "lines",
        "splitBy": "$color",
        "segments": {"x": "$x", "from": "$y0", "to": "$y1"},
    }
    cc.validate_payload(data)


@pytest.mark.parametrize(
    "style",
    [
        {"marker": {"color": "$x.values"}},
        {"marker": {"size": "$y0.values"}},
        {"marker": {"opacity": "$size.values"}},
        {"error_x": {"type": "data", "array": "$error.values"}},
        {"error_x": {"type": "data", "arrayminus": "$x.values"}},
        {"error_y": {"type": "data", "array": "$error.values"}},
        {"error_y": {"type": "data", "arrayminus": "$y0.values"}},
    ],
)
def test_array_style_slots_are_allowed_at_the_exact_paths(style):
    data = payload()
    data["channels"]["size"] = {
        "required": False,
        "types": ["quantitative"],
    }
    data["channels"]["error"] = {
        "required": False,
        "types": ["quantitative"],
    }
    data["traces"][0] = {
        "type": "scatter",
        "mode": "markers",
        "x": "$x",
        "y": "$y0",
        **style,
    }
    cc.validate_payload(data)


def test_array_style_slot_disallowed_path_message():
    data = payload()
    data["traces"][0] = {
        "type": "scatter",
        "mode": "lines",
        "x": "$x",
        "y": "$y0",
        "line": {"color": "$x.values"},
    }
    expected = (
        "traces[0].line.color: '$x.values' is only allowed at "
        "marker.color, marker.size, marker.opacity, error_x.array, "
        "error_x.arrayminus, error_y.array, error_y.arrayminus"
    )
    assert expected in errors_of(data)


def test_array_style_slot_accepts_transform_output():
    data = payload()
    data["transforms"] = [
        {"op": "cumulate", "field": "y0", "as": "running"},
    ]
    data["traces"] = [
        {
            "type": "scatter",
            "mode": "markers",
            "x": "$x",
            "y": "$running",
            "marker": {"color": "$running.values"},
        },
    ]
    cc.validate_payload(data)


def test_error_style_objects_reject_unknown_keys():
    data = payload()
    data["traces"][0] = {
        "type": "scatter",
        "mode": "markers",
        "x": "$x",
        "y": "$y0",
        "error_y": {"type": "data", "array": "$x.values", "bogus": 1},
    }
    assert "unsupported style key for error_y" in errors_of(data)


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def test_save_load_roundtrip(charts_dir):
    manifest, replaced = cc.save_manifest(payload())
    assert replaced is False
    path = charts_dir / "dumbbell.json"
    assert path.exists()

    text = path.read_text(encoding="utf-8")
    assert text.startswith("{\n  \"schemaVersion\": 1")
    assert "哑铃图" in text  # ensure_ascii=False

    loaded = cc.load_manifest("dumbbell")
    assert loaded is not None
    assert loaded.id == "dumbbell"
    assert loaded.label.en == "Dumbbell"
    assert loaded.channels.y_fields.mode == "range"
    assert cc.is_custom_id("dumbbell") is True
    assert manifest.model_dump(by_alias=True) == loaded.model_dump(by_alias=True)


def test_save_overwrite_sets_replaced(charts_dir):
    assert cc.save_manifest(payload())[1] is False
    changed = payload()
    changed["label"]["en"] = "Dumbbell 2"
    manifest, replaced = cc.save_manifest(changed)
    assert replaced is True
    assert manifest.label.en == "Dumbbell 2"
    loaded = cc.load_manifest("dumbbell")
    assert loaded is not None
    assert loaded.label.en == "Dumbbell 2"


def test_delete_manifest(charts_dir):
    cc.save_manifest(payload())
    assert (charts_dir / "dumbbell.json").exists()
    assert cc.delete_manifest("dumbbell") is True
    assert not (charts_dir / "dumbbell.json").exists()
    assert cc.load_manifest("dumbbell") is None
    assert cc.delete_manifest("dumbbell") is False
    assert cc.is_custom_id("dumbbell") is False


def test_corrupt_json_lands_in_invalid_without_raising(charts_dir):
    cc.save_manifest(payload())
    (charts_dir / "broken.json").write_text("{not json", encoding="utf-8")

    valid, invalid = cc.list_manifests()
    assert [manifest.id for manifest in valid] == ["dumbbell"]
    assert len(invalid) == 1
    entry = invalid[0]
    assert entry["id"] == "broken"
    assert entry["file"] == "broken.json"
    assert entry["errors"]
    assert "invalid JSON" in entry["errors"][0]
    assert set(cc.manifest_map()) == {"dumbbell"}


def test_non_object_json_is_invalid(charts_dir):
    charts_dir.mkdir()
    (charts_dir / "array.json").write_text("[]", encoding="utf-8")
    _, invalid = cc.list_manifests()
    assert invalid[0]["file"] == "array.json"
    assert "JSON object" in " ".join(invalid[0]["errors"])


def test_oversized_manifest_is_invalid(charts_dir):
    charts_dir.mkdir()
    huge = "{" + '"x": "' + "a" * cc.MAX_MANIFEST_BYTES + '"' + "}"
    (charts_dir / "big.json").write_text(huge, encoding="utf-8")
    _, invalid = cc.list_manifests()
    assert invalid[0]["file"] == "big.json"
    assert any("larger than 256 KB" in e for e in invalid[0]["errors"])


def test_deeply_nested_manifest_is_invalid_not_recursion_error(charts_dir):
    cc.save_manifest(payload())

    # Build the JSON text by hand: json.dumps() would itself recurse too deeply.
    nested = "[" * 1500 + "]" * 1500
    deep_text = (
        '{"schemaVersion":1,"id":"deepchart",'
        '"label":{"zh":"深图","en":"Deep"},'
        '"channels":{"x":{"required":true,"types":["nominal"]},'
        '"yFields":{"mode":"one"}},'
        '"traces":[{"type":"bar","x":"$x","y":"$y0","hovertemplate":'
        + nested
        + "}]}"
    )
    (charts_dir / "deepchart.json").write_text(deep_text, encoding="utf-8")

    valid, invalid = cc.list_manifests()
    assert [manifest.id for manifest in valid] == ["dumbbell"]
    entry = next(item for item in invalid if item["file"] == "deepchart.json")
    assert any(
        "manifest is nested too deeply" in error for error in entry["errors"]
    )
    assert set(cc.manifest_map()) == {"dumbbell"}

    # The Python-object path must also raise ValueError, never RecursionError.
    deep_value: list = []
    cursor = deep_value
    for _ in range(1500):
        child: list = []
        cursor.append(child)
        cursor = child
    data = payload()
    data["traces"][0]["hovertemplate"] = deep_value
    with pytest.raises(ValueError) as exc:
        cc.validate_payload(data)
    assert "nested too deeply" in str(exc.value)


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="FIFOs are unavailable")
def test_fifo_manifest_is_invalid_without_blocking(charts_dir):
    charts_dir.mkdir()
    try:
        os.mkfifo(charts_dir / "pipe.json")
    except OSError:
        pytest.skip("FIFOs are unavailable")
    # save_manifest scans the directory first; a FIFO must not block it.
    cc.save_manifest(payload())

    valid, invalid = cc.list_manifests()
    assert [manifest.id for manifest in valid] == ["dumbbell"]
    entry = next(item for item in invalid if item["file"] == "pipe.json")
    assert "not a regular file" in entry["errors"]


def test_symlink_outside_chart_dir_is_not_a_regular_file(charts_dir, tmp_path):
    charts_dir.mkdir()
    outside = tmp_path / "outside.json"
    outside.write_text(
        json.dumps(payload(), ensure_ascii=False), encoding="utf-8"
    )
    try:
        os.symlink(outside, charts_dir / "link.json")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are unavailable")

    cc.save_manifest(payload())
    valid, invalid = cc.list_manifests()
    assert [manifest.id for manifest in valid] == ["dumbbell"]
    entry = next(item for item in invalid if item["file"] == "link.json")
    assert "not a regular file" in entry["errors"]


def test_save_manifest_maps_directory_target_to_value_error(charts_dir):
    charts_dir.mkdir()
    (charts_dir / "dumbbell.json").mkdir()
    with pytest.raises(ValueError, match="cannot write manifest:"):
        cc.save_manifest(payload())
    assert not list(charts_dir.glob("dumbbell.*.tmp"))


def test_save_manifest_maps_non_directory_chart_dir_to_value_error(charts_dir):
    charts_dir.write_text("not a directory", encoding="utf-8")
    with pytest.raises(ValueError, match="cannot write manifest:"):
        cc.save_manifest(payload())


def test_manifest_map_is_mtime_cached_and_invalidates(charts_dir):
    cc.save_manifest(payload())
    first = cc.manifest_map()["dumbbell"]
    assert cc.manifest_map()["dumbbell"] == first  # cache hit, equal value
    assert cc.manifest_map()["dumbbell"] is not first  # but a protective copy

    changed = payload()
    changed["label"]["en"] = "Dumbbell cache bump"
    (charts_dir / "dumbbell.json").write_text(
        json.dumps(changed, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    second = cc.manifest_map()["dumbbell"]
    assert second.label.en == "Dumbbell cache bump"
    assert second is not first


def test_manifest_map_and_load_manifest_return_deep_copies(charts_dir):
    cc.save_manifest(payload())

    first = cc.manifest_map()["dumbbell"]
    first.label.en = "Hacked"
    first.traces[0]["type"] = "mesh3d"
    first.traces[0]["line"]["color"] = "red"

    second = cc.manifest_map()["dumbbell"]
    assert second.label.en == "Dumbbell"
    assert second.traces[0]["type"] == "scatter"
    assert second.traces[0]["line"]["color"] == "$opt.connector"

    loaded = cc.load_manifest("dumbbell")
    assert loaded is not None
    loaded.label.en = "Hacked again"
    loaded.traces[1]["type"] = "mesh3d"

    again = cc.load_manifest("dumbbell")
    assert again is not None
    assert again.label.en == "Dumbbell"
    assert again.traces[1]["type"] == "scatter"


def test_manifest_map_skips_invalid(charts_dir):
    cc.save_manifest(payload())
    (charts_dir / "broken.json").write_text("nope", encoding="utf-8")
    (charts_dir / "invalid.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "id": "invalid",
                "label": {"zh": "无效", "en": "Invalid"},
                "channels": {"x": {"required": True}},
                "traces": [{"type": "mesh3d", "x": "$x"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    assert set(cc.manifest_map()) == {"dumbbell"}


def test_keywords_lowercased_and_excludes_invalid(charts_dir):
    good = payload()
    good["keywords"] = ["Trend Line"]
    cc.save_manifest(good)

    bad = payload()
    bad["id"] = "brokenchart"
    bad["label"] = {"zh": "坏图", "en": "Broken chart"}
    bad["keywords"] = ["Broken KW"]
    bad["traces"][0]["type"] = "mesh3d"
    (charts_dir / "brokenchart.json").write_text(
        json.dumps(bad, ensure_ascii=False), encoding="utf-8"
    )

    pairs = cc.keywords()
    assert ("trend line", "dumbbell") in pairs
    assert ("broken kw", "brokenchart") not in pairs
    assert all(keyword == keyword.lower() for keyword, _ in pairs)


def test_is_custom_id_distinguishes_unknown_and_builtin():
    assert cc.is_custom_id("bar") is False
    assert cc.is_custom_id("doesnotexist") is False
    assert cc.is_custom_id("Dumbbell") is False
    cc.save_manifest(payload())
    assert cc.is_custom_id("dumbbell") is True


# ---------------------------------------------------------------------------
# Transforms
# ---------------------------------------------------------------------------

def test_group_agg_sum_produces_as_column():
    manifest = cc.validate_payload(
        minimal_manifest(
            transforms=[
                {
                    "op": "group_agg",
                    "groupBy": "x",
                    "field": "y0",
                    "agg": "sum",
                    "as": "total",
                }
            ],
            traces=[{"type": "bar", "x": "$x", "y": "$total"}],
        )
    )
    df = pd.DataFrame({"cat": ["A", "A", "B"], "val": [1.0, 2.0, 5.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    assert len(figure["data"]) == 1
    assert figure["data"][0]["x"] == ["A", "B"]
    assert figure["data"][0]["y"] == [3.0, 5.0]


def test_group_agg_count():
    manifest = cc.validate_payload(
        minimal_manifest(
            transforms=[
                {
                    "op": "group_agg",
                    "groupBy": "x",
                    "field": "y0",
                    "agg": "count",
                    "as": "n",
                }
            ],
            traces=[{"type": "bar", "x": "$x", "y": "$n"}],
        )
    )
    df = pd.DataFrame({"cat": ["A", "A", "B"], "val": [1.0, np.nan, 5.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["y"] == [1, 1]


def test_cumulate_is_monotonic_after_sorting_by_x():
    manifest = cc.validate_payload(
        minimal_manifest(
            transforms=[{"op": "cumulate", "field": "y0", "as": "running"}],
            traces=[
                {"type": "scatter", "mode": "lines", "x": "$x", "y": "$running"}
            ],
        )
    )
    df = pd.DataFrame({"cat": ["C", "A", "B"], "val": [30.0, 10.0, 20.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    trace = figure["data"][0]
    assert trace["x"] == ["A", "B", "C"]
    assert trace["y"] == [10.0, 30.0, 60.0]
    assert trace["y"] == sorted(trace["y"])


def test_sort_and_limit_ordering():
    manifest = cc.validate_payload(
        minimal_manifest(
            transforms=[
                {"op": "sort", "by": "y0", "descending": True},
                {"op": "limit", "count": 2},
            ]
        )
    )
    df = pd.DataFrame({"cat": ["A", "B", "C"], "val": [1.0, 5.0, 3.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["x"] == ["B", "C"]
    assert figure["data"][0]["y"] == [5.0, 3.0]


def test_dropna_drops_rows():
    manifest = cc.validate_payload(
        minimal_manifest(transforms=[{"op": "dropna", "slots": ["x", "y0"]}])
    )
    df = pd.DataFrame({"cat": ["A", "B", "C"], "val": [1.0, np.nan, 3.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["x"] == ["A", "C"]
    assert figure["data"][0]["y"] == [1.0, 3.0]


def test_limit_bottom_keeps_last_rows():
    manifest = cc.validate_payload(
        minimal_manifest(
            transforms=[{"op": "limit", "count": 2, "from": "bottom"}]
        )
    )
    df = pd.DataFrame({"cat": ["A", "B", "C"], "val": [1.0, 2.0, 3.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["x"] == ["B", "C"]


# ---------------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------------

def test_dumbbell_example_renders_markers_and_shapes():
    manifest = cc.validate_payload(example("dumbbell"))
    base_layout = {"template": "plotly_white", "margin": {"t": 1}}
    figure = cc.render(
        toy_df(), manifest, dumbbell_encoding(), base_layout
    )

    # The connector is a layout shape, not a data trace.
    assert len(figure["data"]) == 2
    allowed = set(cc.STYLE_KEYS) | set(cc.DATA_KEYS) | {"type"}
    for trace in figure["data"]:
        assert trace["type"] in cc.TRACE_TYPES
        assert set(trace) <= allowed

    first_marker, second_marker = figure["data"]
    assert first_marker["x"] == [0, 1, 2]
    assert second_marker["x"] == [0, 1, 2]
    assert first_marker["name"] == "Start"
    assert first_marker["y"] == [30.0, 10.0, 20.0]
    assert second_marker["name"] == "End"
    assert second_marker["y"] == [45.0, 18.0, 17.0]

    shapes = figure["layout"]["shapes"]
    assert len(shapes) == 3
    assert [shape["x0"] for shape in shapes] == [0, 1, 2]
    assert [shape["x1"] for shape in shapes] == [0, 1, 2]
    assert [(shape["y0"], shape["y1"]) for shape in shapes] == [
        (30.0, 45.0),
        (10.0, 18.0),
        (20.0, 17.0),
    ]
    for shape in shapes:
        assert shape == {
            "type": "line",
            "x0": shape["x0"],
            "x1": shape["x1"],
            "y0": shape["y0"],
            "y1": shape["y1"],
            "xref": "x",
            "yref": "y",
            "line": {"color": "#cbd5e1", "width": 2},
            "layer": "below",
        }

    assert figure["layout"]["xaxis"]["tickmode"] == "array"
    assert figure["layout"]["xaxis"]["tickvals"] == [0, 1, 2]
    assert figure["layout"]["xaxis"]["ticktext"] == ["C", "A", "B"]
    assert figure["layout"]["xaxis"]["type"] == "linear"

    # Shallow merge, base layout untouched.
    assert figure["layout"] is not base_layout
    assert base_layout["margin"] == {"t": 1}
    assert figure["layout"]["template"] == "plotly_white"
    assert figure["layout"]["margin"] == {"l": 70, "r": 20, "t": 30, "b": 50}


@pytest.mark.parametrize(
    "options, expected_width",
    [
        (None, 2),
        ({"width": 6}, 6),
        (SimpleNamespace(width=5), 5),
    ],
)
def test_opt_width_default_and_override(options, expected_width):
    manifest = cc.validate_payload(example("dumbbell"))
    figure = cc.render(
        toy_df(),
        manifest,
        dumbbell_encoding(options=options),
        {},
    )
    assert figure["layout"]["shapes"][0]["line"]["width"] == expected_width


def test_render_accepts_real_chart_encoding_models():
    from backend.models.chart import ChartEncoding, EncodingChannel, YFieldConfig

    manifest = cc.validate_payload(example("dumbbell"))
    encoding_model = ChartEncoding(
        x=EncodingChannel(field="city", type="nominal"),
        y_fields=[
            YFieldConfig(field="start", type="quantitative", label="Start"),
            YFieldConfig(field="end", type="quantitative", label="End"),
        ],
        chart_type="scatter",
    )
    figure = cc.render(toy_df(), manifest, encoding_model, {})
    assert len(figure["data"]) == 2
    assert len(figure["layout"]["shapes"]) == 3
    assert figure["data"][0]["name"] == "Start"
    assert figure["data"][1]["name"] == "End"


def test_opt_text_override():
    manifest = cc.validate_payload(example("dumbbell"))
    figure = cc.render(
        toy_df(),
        manifest,
        dumbbell_encoding(options={"connector": "#000000"}),
        {},
    )
    assert figure["layout"]["shapes"][0]["line"]["color"] == "#000000"


def test_opt_reads_pydantic_model_extra():
    """ChartOptions will allow extra keys; model_extra must win over defaults."""
    manifest = cc.validate_payload(example("dumbbell"))
    options = SimpleNamespace(model_extra={"width": 7, "connector": "#123456"})
    figure = cc.render(
        toy_df(),
        manifest,
        dumbbell_encoding(options=options),
        {},
    )
    assert figure["layout"]["shapes"][0]["line"] == {
        "width": 7,
        "color": "#123456",
    }


def test_dumbbell_connector_uses_both_option_overrides():
    manifest = cc.validate_payload(example("dumbbell"))
    figure = cc.render(
        toy_df(),
        manifest,
        dumbbell_encoding(
            options={"connector": "#abcdef", "width": 4}
        ),
        {},
    )
    assert figure["layout"]["shapes"][0]["line"] == {
        "color": "#abcdef",
        "width": 4,
    }


def test_opt_dumbbell_invalid_overrides_use_defaults():
    manifest = cc.validate_payload(example("dumbbell"))
    figure = cc.render(
        toy_df(),
        manifest,
        dumbbell_encoding(
            options={
                "width": "abc",
                "connector": {"nested": [1, 2]},
            }
        ),
        {},
    )
    assert figure["layout"]["shapes"][0]["line"] == {
        "color": "#cbd5e1",
        "width": 2,
    }


def test_opt_number_accepts_numeric_strings():
    manifest = cc.validate_payload(example("dumbbell"))
    figure = cc.render(
        toy_df(),
        manifest,
        dumbbell_encoding(options={"width": "5.5"}),
        {},
    )
    assert figure["layout"]["shapes"][0]["line"]["width"] == 5.5


def test_opt_type_coercion_defaults_and_valid_overrides():
    manifest = cc.validate_payload(typed_option_manifest())
    df = pd.DataFrame({"cat": ["A"], "val": [1.0]})

    defaults = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    trace = defaults["data"][0]
    assert trace["showlegend"] is True
    assert trace["width"] == 0.5
    assert trace["marker"]["color"] == "#111111"
    assert defaults["layout"]["hovermode"] == "x"

    overridden = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            options={
                "show": False,
                "width": "0.75",
                "color": "#222222",
                "mode": "y",
            },
        ),
        {},
    )
    trace = overridden["data"][0]
    assert trace["showlegend"] is False
    assert trace["width"] == 0.75
    assert trace["marker"]["color"] == "#222222"
    assert overridden["layout"]["hovermode"] == "y"


def test_opt_type_coercion_falls_back_on_wrong_types():
    manifest = cc.validate_payload(typed_option_manifest())
    df = pd.DataFrame({"cat": ["A"], "val": [1.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            options={
                "show": "yes",
                "width": "abc",
                "color": 123,
                "mode": "z",
            },
        ),
        {},
    )
    trace = figure["data"][0]
    assert trace["showlegend"] is True
    assert trace["width"] == 0.5
    assert trace["marker"]["color"] == "#111111"
    assert figure["layout"]["hovermode"] == "x"


def test_opt_number_rejects_non_finite_values():
    manifest = cc.validate_payload(typed_option_manifest())
    df = pd.DataFrame({"cat": ["A"], "val": [1.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            options={"width": float("inf")},
        ),
        {},
    )
    assert figure["data"][0]["width"] == 0.5


def test_missing_required_channel_returns_empty_configuration():
    manifest = cc.validate_payload(example("dumbbell"))
    base_layout = {"template": "plotly_white"}
    figure = cc.render(
        toy_df(),
        manifest,
        encoding(
            x=None,
            y=[
                y_channel("start", label="Start"),
                y_channel("end", label="End"),
            ],
        ),
        base_layout,
    )
    assert figure["data"] == []
    assert figure["layout"]["template"] == "plotly_white"
    assert figure["layout"]["margin"] == {"l": 70, "r": 20, "t": 30, "b": 50}
    assert base_layout == {"template": "plotly_white"}


def test_channel_type_mismatch_returns_empty_configuration():
    manifest = cc.validate_payload(example("dumbbell"))
    figure = cc.render(
        toy_df(),
        manifest,
        dumbbell_encoding(x=channel("city", "quantitative")),
        {},
    )
    assert figure["data"] == []


def test_range_mode_needs_two_y_fields():
    manifest = cc.validate_payload(example("dumbbell"))
    figure = cc.render(
        toy_df(),
        manifest,
        encoding(x=channel("city", "nominal"), y=[y_channel("start")]),
        {},
    )
    assert figure["data"] == []


def test_nan_becomes_none_in_data_slots():
    manifest = cc.validate_payload(
        minimal_manifest(traces=[{"type": "bar", "x": "$x", "y": "$y0"}])
    )
    df = pd.DataFrame({"cat": ["A", "B"], "val": [1.0, np.nan]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["y"] == [1.0, None]


def test_temporal_values_are_iso_strings():
    manifest = cc.validate_payload(
        minimal_manifest(
            channels={
                "x": {"required": True, "types": ["temporal"]},
                "yFields": {"mode": "one"},
            },
            traces=[{"type": "scatter", "x": "$x", "y": "$y0"}],
        )
    )
    df = pd.DataFrame(
        {
            "when": pd.to_datetime(["2024-01-02", "2024-01-01"]),
            "val": [2.0, 1.0],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("when", "temporal"), y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["x"] == [
        "2024-01-02T00:00:00",
        "2024-01-01T00:00:00",
    ]


def test_count_and_index_slots():
    manifest = cc.validate_payload(
        minimal_manifest(
            traces=[{"type": "scatter", "x": "$index", "y": "$count"}],
        )
    )
    df = pd.DataFrame({"cat": ["A", "B", "C"], "val": [1.0, 2.0, 3.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["x"] == [0, 1, 2]
    assert figure["data"][0]["y"] == [1, 1, 1]


def test_label_slot_falls_back_to_field_name():
    manifest = cc.validate_payload(
        minimal_manifest(
            traces=[
                {
                    "type": "bar",
                    "x": "$x",
                    "y": "$y0",
                    "name": "$y0.label",
                }
            ]
        )
    )
    df = pd.DataFrame({"cat": ["A"], "val": [1.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["name"] == "val"


def test_layout_option_default_and_override():
    data = minimal_manifest(
        layout={"showlegend": "$opt.legend"},
        options=[
            {
                "key": "legend",
                "type": "boolean",
                "default": True,
                "label": {"zh": "图例", "en": "Legend"},
            }
        ],
    )
    manifest = cc.validate_payload(data)
    df = pd.DataFrame({"cat": ["A"], "val": [1.0]})
    base = encoding(x=channel("cat", "nominal"), y=[y_channel("val")])

    default_figure = cc.render(df, manifest, base, {})
    assert default_figure["layout"]["showlegend"] is True

    override = encoding(
        x=channel("cat", "nominal"),
        y=[y_channel("val")],
        options={"legend": False},
    )
    override_figure = cc.render(df, manifest, override, {})
    assert override_figure["layout"]["showlegend"] is False


def test_manual_manifest_never_emits_unknown_type_or_style():
    manifest = cc.validate_payload(example("dumbbell"))
    manifest.traces = [
        {"type": "mesh3d", "x": "$x", "y": "$y0"},
        {
            "type": "bar",
            "x": "$x",
            "y": "$y0",
            "bogus": 1,
            "line": {"bogus": 2},
        },
    ]
    figure = cc.render(toy_df(), manifest, dumbbell_encoding(), {})
    assert len(figure["data"]) == 1
    trace = figure["data"][0]
    assert trace["type"] == "bar"
    assert "bogus" not in trace
    assert trace["line"] == {}


def test_unusable_transform_returns_empty_without_raising():
    manifest = cc.validate_payload(
        minimal_manifest(
            transforms=[{"op": "cumulate", "field": "y0", "as": "running"}],
            traces=[{"type": "scatter", "x": "$x", "y": "$running"}],
        )
    )
    df = pd.DataFrame({"cat": ["A", "B"], "val": ["not", "numeric"]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val", "nominal")]),
        {},
    )
    assert figure["data"] == []


# ---------------------------------------------------------------------------
# Segments (row -> two-point line)
# ---------------------------------------------------------------------------

def test_segments_render_layout_shapes_for_three_rows():
    manifest = cc.validate_payload(segment_manifest())
    figure = cc.render(segment_df(), manifest, segment_encoding(), {})
    assert figure["data"] == []
    shapes = figure["layout"]["shapes"]
    assert len(shapes) == 3
    assert [shape["x0"] for shape in shapes] == [0, 1, 2]
    assert [shape["x1"] for shape in shapes] == [0, 1, 2]
    assert [(shape["y0"], shape["y1"]) for shape in shapes] == [
        (1.0, 4.0),
        (2.0, 5.0),
        (3.0, 6.0),
    ]
    for index, shape in enumerate(shapes):
        assert shape == {
            "type": "line",
            "x0": index,
            "x1": index,
            "y0": shape["y0"],
            "y1": shape["y1"],
            "xref": "x",
            "yref": "y",
            "line": {},
            "layer": "below",
        }
    assert figure["layout"]["xaxis"]["ticktext"] == ["A", "B", "C"]


def test_segments_horizontal_swaps_axes():
    manifest = cc.validate_payload(segment_manifest(horizontal=True))
    figure = cc.render(segment_df(), manifest, segment_encoding(), {})
    assert figure["data"] == []
    shapes = figure["layout"]["shapes"]
    assert [shape["y0"] for shape in shapes] == [0, 1, 2]
    assert [shape["y1"] for shape in shapes] == [0, 1, 2]
    assert [(shape["x0"], shape["x1"]) for shape in shapes] == [
        (1.0, 4.0),
        (2.0, 5.0),
        (3.0, 6.0),
    ]
    assert figure["layout"]["yaxis"]["tickvals"] == [0, 1, 2]
    assert figure["layout"]["yaxis"]["ticktext"] == ["A", "B", "C"]
    assert figure["layout"]["yaxis"]["type"] == "linear"
    assert "tickvals" not in figure["layout"].get("xaxis", {})


@pytest.mark.parametrize("endpoint", ["low", "high"])
def test_segments_drop_rows_with_nan_endpoint(endpoint):
    df = segment_df()
    df.loc[1, endpoint] = np.nan
    manifest = cc.validate_payload(segment_manifest())
    figure = cc.render(df, manifest, segment_encoding(), {})
    shapes = figure["layout"]["shapes"]
    assert len(shapes) == 2
    assert [shape["x0"] for shape in shapes] == [0, 2]
    assert [(shape["y0"], shape["y1"]) for shape in shapes] == [
        (1.0, 4.0),
        (3.0, 6.0),
    ]
    assert figure["layout"]["xaxis"]["ticktext"] == ["A", "B", "C"]


def test_segments_append_to_base_layout_shapes_without_mutating_it():
    manifest = cc.validate_payload(segment_manifest())
    base_shape = {
        "type": "rect",
        "x0": 0,
        "x1": 1,
        "y0": 0,
        "y1": 1,
        "xref": "paper",
        "yref": "paper",
    }
    base_layout = {"shapes": [base_shape]}
    figure = cc.render(segment_df(), manifest, segment_encoding(), base_layout)
    shapes = figure["layout"]["shapes"]
    assert shapes[0] == base_shape
    assert len(shapes) == 4
    assert base_layout["shapes"] == [base_shape]
    assert figure["layout"]["shapes"] is not base_layout["shapes"]


def test_segments_and_x_are_mutually_exclusive():
    data = segment_manifest()
    data["traces"][0]["x"] = "$x"
    message = errors_of(data)
    assert "'segments' and 'x' are mutually exclusive" in message


def test_segments_and_y_are_mutually_exclusive():
    data = segment_manifest()
    data["traces"][0]["y"] = "$y0"
    message = errors_of(data)
    assert "'segments' and 'y' are mutually exclusive" in message


def test_segments_only_on_scatter():
    data = segment_manifest()
    data["traces"][0]["type"] = "bar"
    message = errors_of(data)
    assert "traces[0].segments: only allowed on type 'scatter'" in message


@pytest.mark.parametrize("mode", [None, "markers", "text+markers"])
def test_segments_mode_is_accepted_and_ignored(mode):
    data = segment_manifest()
    if mode is None:
        data["traces"][0].pop("mode")
    else:
        data["traces"][0]["mode"] = mode
    manifest = cc.validate_payload(data)
    figure = cc.render(segment_df(), manifest, segment_encoding(), {})
    assert len(figure["layout"]["shapes"]) == 3


def test_segments_accepts_lines_plus_markers():
    data = segment_manifest()
    data["traces"][0]["mode"] = "lines+markers"
    manifest = cc.validate_payload(data)
    assert manifest.traces[0]["segments"]["x"] == "$x"


def test_segments_object_keys_and_values():
    data = segment_manifest()
    data["traces"][0]["segments"] = "$x"
    assert (
        "traces[0].segments: must be an object with 'x', 'from' and 'to'"
        in errors_of(data)
    )

    data = segment_manifest()
    data["traces"][0]["segments"]["colour"] = "#fff"
    assert (
        "traces[0].segments.colour: not allowed on segments"
        in errors_of(data)
    )

    data = segment_manifest()
    data["traces"][0]["segments"].pop("to")
    assert "traces[0].segments.to: is required" in errors_of(data)

    data = segment_manifest()
    data["traces"][0]["segments"]["horizontal"] = "yes"
    assert (
        "traces[0].segments.horizontal: must be true or false"
        in errors_of(data)
    )

    data = segment_manifest()
    data["traces"][0]["segments"]["from"] = 0
    assert (
        "traces[0].segments.from: must be a data slot such as '$x'"
        in errors_of(data)
    )

    data = segment_manifest()
    data["traces"][0]["segments"]["from"] = "$opt.width"
    assert (
        "traces[0].segments.from: must be a data slot, not an option slot"
        in errors_of(data)
    )

    data = segment_manifest()
    data["traces"][0]["segments"]["from"] = "$x.label"
    assert (
        "traces[0].segments.from: must be a data slot, not a label slot"
        in errors_of(data)
    )

    data = segment_manifest()
    data["traces"][0]["segments"]["to"] = "$y2"
    assert "yFields.mode 'range'" in errors_of(data)


# ---------------------------------------------------------------------------
# splitBy / array style slots: rendering
# ---------------------------------------------------------------------------

def test_split_by_renders_one_trace_per_color_value():
    manifest = cc.validate_payload(example("series-line"))
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "A", "C"],
            "val": [1.0, 2.0, 3.0, 4.0],
            "grp": ["beta", "alpha", "beta", "alpha"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == 2
    beta, alpha = figure["data"]
    assert beta["name"] == "beta"
    assert beta["legendgroup"] == "beta"
    assert beta["showlegend"] is True
    assert beta["x"] == ["A", "A"]
    assert beta["y"] == [1.0, 3.0]
    assert beta["marker"] == {"size": 6, "color": "#3b82f6"}
    assert beta["line"] == {"color": "#3b82f6"}
    assert alpha["name"] == "alpha"
    assert alpha["legendgroup"] == "alpha"
    assert alpha["x"] == ["B", "C"]
    assert alpha["y"] == [2.0, 4.0]
    assert alpha["marker"] == {"size": 6, "color": "#ef4444"}
    assert alpha["line"] == {"color": "#ef4444"}
    assert "splitBy" not in beta
    assert "splitBy" not in alpha


def test_split_by_joins_resolved_template_name():
    data = example("series-line")
    data["traces"][0]["name"] = "$y0.label"
    manifest = cc.validate_payload(data)
    df = pd.DataFrame(
        {
            "cat": ["A", "B"],
            "val": [1.0, 2.0],
            "grp": ["a", "b"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val", label="Sales")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert [trace["name"] for trace in figure["data"]] == [
        "Sales · a",
        "Sales · b",
    ]
    assert [
        trace["legendgroup"] for trace in figure["data"]
    ] == ["a", "b"]


def test_split_by_uses_literal_template_name():
    data = example("series-line")
    data["traces"][0]["name"] = "Series"
    manifest = cc.validate_payload(data)
    df = pd.DataFrame(
        {
            "cat": ["A", "B"],
            "val": [1.0, 2.0],
            "grp": ["a", "b"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert [trace["name"] for trace in figure["data"]] == [
        "Series · a",
        "Series · b",
    ]


def test_split_by_keeps_explicit_showlegend_false():
    data = example("series-line")
    data["traces"][0]["showlegend"] = False
    manifest = cc.validate_payload(data)
    df = pd.DataFrame(
        {
            "cat": ["A", "B"],
            "val": [1.0, 2.0],
            "grp": ["a", "b"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert all(
        trace["showlegend"] is False for trace in figure["data"]
    )


def test_split_by_preserves_first_appearance_order():
    manifest = cc.validate_payload(example("series-line"))
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "grp": ["z", "a", "z"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert [trace["name"] for trace in figure["data"]] == ["z", "a"]


def test_split_by_with_array_style_slot_uses_each_series_rows():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="splitsize",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "color": {"required": True, "types": ["nominal"]},
                "size": {"required": True, "types": ["quantitative"]},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "splitBy": "$color",
                    "x": "$x",
                    "y": "$y0",
                    "marker": {"size": "$size.values"},
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "grp": ["g1", "g2", "g1"],
            "sz": [10.0, 20.0, 30.0],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
            size=channel("sz", "quantitative"),
        ),
        {},
    )
    assert len(figure["data"]) == 2
    g1, g2 = figure["data"]
    assert g1["marker"]["size"] == [10.0, 30.0]
    assert len(g1["marker"]["size"]) == len(g1["x"])
    assert g2["marker"]["size"] == [20.0]
    assert len(g2["marker"]["size"]) == len(g2["x"])


def test_bubble_example_resolves_array_style_slots():
    manifest = cc.validate_payload(example("bubble"))
    df = pd.DataFrame(
        {
            "xv": [1.0, 2.0, 3.0],
            "yv": [10.0, 20.0, 30.0],
            "grp": ["A", "B", "A"],
            "sz": [5.0, 10.0, 15.0],
            "err": [0.5, 1.0, 1.5],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("xv", "quantitative"),
            y=[y_channel("yv")],
            color=channel("grp", "nominal"),
            size=channel("sz", "quantitative"),
            error=channel("err", "quantitative"),
        ),
        {},
    )
    assert len(figure["data"]) == 1
    trace = figure["data"][0]
    assert trace["marker"]["size"] == [5.0, 10.0, 15.0]
    assert trace["marker"]["color"] == ["A", "B", "A"]
    assert trace["error_y"] == {
        "type": "data",
        "array": [0.5, 1.0, 1.5],
        "visible": True,
    }


def test_array_paths_still_accept_literals_and_opt_scalars():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="arrayliterals",
            channels={
                "x": {"required": True, "types": ["quantitative"]},
                "yFields": {"mode": "one"},
                "color": {"required": True, "types": ["nominal"]},
                "size": {"required": True, "types": ["quantitative"]},
                "error": {"required": True, "types": ["quantitative"]},
            },
            options=[
                {
                    "key": "dotColor",
                    "type": "text",
                    "default": "#123456",
                    "label": {"zh": "点颜色", "en": "Dot color"},
                }
            ],
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    "marker": {"size": 6, "color": "$opt.dotColor"},
                    "error_y": {
                        "type": "data",
                        "array": [0.5, 0.6, 0.7],
                        "visible": True,
                    },
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "xv": [1.0, 2.0, 3.0],
            "yv": [10.0, 20.0, 30.0],
            "grp": ["A", "B", "A"],
            "sz": [5.0, 10.0, 15.0],
            "err": [0.5, 1.0, 1.5],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("xv", "quantitative"),
            y=[y_channel("yv")],
            color=channel("grp", "nominal"),
            size=channel("sz", "quantitative"),
            error=channel("err", "quantitative"),
        ),
        {},
    )
    trace = figure["data"][0]
    assert trace["marker"]["size"] == 6
    assert trace["marker"]["color"] == "#123456"
    assert trace["error_y"]["array"] == [0.5, 0.6, 0.7]


def test_x_values_array_slot_in_marker_color():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="arrayxcolor",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    "marker": {"color": "$x.values"},
                }
            ],
        )
    )
    df = pd.DataFrame({"cat": ["A", "B"], "val": [1.0, 2.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
        ),
        {},
    )
    assert figure["data"][0]["marker"]["color"] == ["A", "B"]


def test_split_by_nan_color_series_is_labelled_none():
    manifest = cc.validate_payload(example("series-line"))
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "grp": ["a", np.nan, "a"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert [trace["name"] for trace in figure["data"]] == ["a", "None"]
    assert [
        trace["legendgroup"] for trace in figure["data"]
    ] == ["a", "None"]
    assert figure["data"][1]["showlegend"] is True
    assert figure["data"][1]["marker"]["color"] == "#ef4444"


def test_split_by_palette_override_is_honoured():
    manifest = cc.validate_payload(example("series-line"))
    df = pd.DataFrame(
        {
            "cat": ["A", "B"],
            "val": [1.0, 2.0],
            "grp": ["a", "b"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
        palette=["#000"],
    )
    assert len(figure["data"]) == 2
    assert all(
        trace["marker"]["color"] == "#000" for trace in figure["data"]
    )
    assert all(
        trace["line"]["color"] == "#000" for trace in figure["data"]
    )


def test_split_palette_wins_over_scalar_template_colors():
    data = example("series-line")
    data["traces"][0]["marker"] = {"size": 6, "color": "#ffffff"}
    data["traces"][0]["line"] = {"color": "#000000", "width": 2}
    manifest = cc.validate_payload(data)
    df = pd.DataFrame(
        {
            "cat": ["A", "B"],
            "val": [1.0, 2.0],
            "grp": ["a", "b"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert [
        trace["marker"]["color"] for trace in figure["data"]
    ] == ["#3b82f6", "#ef4444"]
    assert [
        trace["line"]["color"] for trace in figure["data"]
    ] == ["#3b82f6", "#ef4444"]
    assert all(trace["line"]["width"] == 2 for trace in figure["data"])


def test_split_palette_preserves_array_marker_color():
    data = example("series-line")
    data["traces"][0]["marker"] = {"color": "$x.values"}
    manifest = cc.validate_payload(data)
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "grp": ["g1", "g2", "g1"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert figure["data"][0]["marker"]["color"] == ["A", "C"]
    assert figure["data"][1]["marker"]["color"] == ["B"]
    assert figure["data"][0]["line"]["color"] == "#3b82f6"


def test_split_by_with_unconfigured_optional_color_returns_empty():
    data = example("series-line")
    data["channels"]["color"]["required"] = False
    manifest = cc.validate_payload(data)
    df = pd.DataFrame({"cat": ["A"], "val": [1.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
        ),
        {"template": "plotly_white"},
    )
    assert figure["data"] == []
    assert figure["layout"]["template"] == "plotly_white"


def test_array_style_slot_renders_transform_output():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="arraytransform",
            transforms=[
                {"op": "cumulate", "field": "y0", "as": "running"},
            ],
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$running",
                    "marker": {"size": "$running.values"},
                }
            ],
        )
    )
    df = pd.DataFrame({"cat": ["A", "B"], "val": [1.0, 2.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
        ),
        {},
    )
    assert figure["data"][0]["y"] == [1.0, 3.0]
    assert figure["data"][0]["marker"]["size"] == [1.0, 3.0]


def test_numeric_array_style_slot_preserves_nan_as_none():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="arraynan",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "size": {"required": True, "types": ["quantitative"]},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    "marker": {"size": "$size.values"},
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B"],
            "val": [1.0, 2.0],
            "sz": [1.5, np.nan],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            size=channel("sz", "quantitative"),
        ),
        {},
    )
    assert figure["data"][0]["marker"]["size"] == [1.5, None]


def test_marker_color_array_keeps_numbers():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="numericcolor",
            channels={
                "x": {"required": True, "types": ["quantitative"]},
                "yFields": {"mode": "one"},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    "marker": {"color": "$x.values"},
                }
            ],
        )
    )
    df = pd.DataFrame({"xv": [1.0, 2.5], "val": [1.0, 2.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("xv", "quantitative"),
            y=[y_channel("val")],
        ),
        {},
    )
    assert figure["data"][0]["marker"]["color"] == [1.0, 2.5]


def test_numeric_array_slot_coerces_numeric_strings():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="arraycoerce",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "size": {"required": True, "types": ["quantitative"]},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    "marker": {"size": "$size.values"},
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "sz": ["1.5", "2", "abc"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            size=channel("sz", "quantitative"),
        ),
        {},
    )
    assert figure["data"][0]["marker"]["size"] == [1.5, 2.0, None]


def test_error_array_slot_coerces_numeric_strings():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="errorcoerce",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "error": {"required": True, "types": ["quantitative"]},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    "error_y": {
                        "type": "data",
                        "array": "$error.values",
                        "visible": True,
                    },
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B"],
            "val": [1.0, 2.0],
            "err": ["1", "abc"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            error=channel("err", "quantitative"),
        ),
        {},
    )
    assert figure["data"][0]["error_y"]["array"] == [1.0, None]


@pytest.mark.parametrize(
    "column, values",
    [
        ("when", pd.to_datetime(["2024-01-01", "2024-01-02"])),
        ("delta", pd.to_timedelta(["1 days", "2 days"])),
    ],
    ids=["datetime", "timedelta"],
)
def test_numeric_array_slot_rejects_datetime_and_timedelta(column, values):
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="arraydates",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "size": {"required": True, "types": ["quantitative"]},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    "marker": {"size": "$size.values"},
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B"],
            "val": [1.0, 2.0],
            column: values,
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            size=channel(column, "quantitative"),
        ),
        {},
    )
    assert figure["data"][0]["marker"]["size"] == [None, None]


def test_split_by_with_segments_renders_shapes_per_series():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="splitseg",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "range"},
                "color": {"required": True, "types": ["nominal"]},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "lines",
                    "splitBy": "$color",
                    "segments": {
                        "x": "$x",
                        "from": "$y0",
                        "to": "$y1",
                    },
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C", "D"],
            "low": [1.0, 2.0, 3.0, 4.0],
            "high": [5.0, 6.0, 7.0, 8.0],
            "grp": ["g1", "g2", "g1", "g2"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("low"), y_channel("high")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert figure["data"] == []
    shapes = figure["layout"]["shapes"]
    assert len(shapes) == 4
    assert [(shape["x0"], shape["y0"], shape["y1"]) for shape in shapes] == [
        (0, 1.0, 5.0),
        (2, 3.0, 7.0),
        (1, 2.0, 6.0),
        (3, 4.0, 8.0),
    ]
    assert all(shape["line"] == {} for shape in shapes)
    assert figure["layout"]["xaxis"]["ticktext"] == ["A", "B", "C", "D"]


@pytest.mark.parametrize(
    "style",
    [
        {"marker": {"size": "$size.values"}},
        {
            "error_y": {
                "type": "data",
                "array": "$error.values",
                "visible": True,
            }
        },
    ],
)
def test_unconfigured_array_channel_returns_empty(style):
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="arrayunconfigured",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "size": {
                    "required": False,
                    "types": ["quantitative"],
                },
                "error": {
                    "required": False,
                    "types": ["quantitative"],
                },
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    **style,
                }
            ],
        )
    )
    df = pd.DataFrame({"cat": ["A"], "val": [1.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
        ),
        {"template": "plotly_white"},
    )
    assert figure["data"] == []
    assert figure["layout"]["template"] == "plotly_white"


# ---------------------------------------------------------------------------
# Facet grid
# ---------------------------------------------------------------------------

def test_facet_channel_builds_grid_axes_and_cell_subsets():
    manifest = cc.validate_payload(example("facet-grid"))
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C", "D", "E"],
            "val": [1.0, 2.0, 3.0, 4.0, 5.0],
            "region": ["North", "South", "North", "East", "South"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("region", "nominal"),
        ),
        {},
    )
    assert figure["layout"]["grid"] == {
        "rows": 1,
        "columns": 3,
        "pattern": "independent",
        "xgap": 0.08,
        "ygap": 0.12,
    }
    assert len(figure["data"]) == 3
    expected = [
        ("North", ["A", "C"], [1.0, 3.0]),
        ("South", ["B", "E"], [2.0, 5.0]),
        ("East", ["D"], [4.0]),
    ]
    for index, (trace, (label, xs, ys)) in enumerate(
        zip(figure["data"], expected)
    ):
        suffix = "" if index == 0 else str(index + 1)
        assert trace["xaxis"] == f"x{suffix}"
        assert trace["yaxis"] == f"y{suffix}"
        assert trace["x"] == xs
        assert trace["y"] == ys
        assert figure["layout"][f"xaxis{suffix}"]["title"] == label
        assert f"yaxis{suffix}" in figure["layout"]
    assert "facet" not in figure["data"][0]
    assert "facetBy" not in figure["data"][0]


def test_facet_cell_order_is_first_appearance():
    manifest = cc.validate_payload(example("facet-grid"))
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C", "D"],
            "val": [1.0, 2.0, 3.0, 4.0],
            "region": ["z", "a", "z", "b"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("region", "nominal"),
        ),
        {},
    )
    assert [
        figure["layout"][f"xaxis{suffix}"]["title"]
        for suffix in ("", "2", "3")
    ] == ["z", "a", "b"]
    assert [trace["xaxis"] for trace in figure["data"]] == [
        "x",
        "x2",
        "x3",
    ]


def test_facet_grid_wraps_after_three_columns():
    manifest = cc.validate_payload(example("facet-grid"))
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C", "D"],
            "val": [1.0, 2.0, 3.0, 4.0],
            "region": ["R1", "R2", "R3", "R4"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("region", "nominal"),
        ),
        {},
    )
    assert figure["layout"]["grid"] == {
        "rows": 2,
        "columns": 3,
        "pattern": "independent",
        "xgap": 0.08,
        "ygap": 0.12,
    }
    assert len(figure["data"]) == 4
    assert [trace["xaxis"] for trace in figure["data"]] == [
        "x",
        "x2",
        "x3",
        "x4",
    ]
    assert figure["layout"]["xaxis4"]["title"] == "R4"


def test_facet_none_cell_is_labelled_none():
    manifest = cc.validate_payload(example("facet-grid"))
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "region": ["a", np.nan, "a"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("region", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == 2
    assert figure["layout"]["xaxis"]["title"] == "a"
    assert figure["layout"]["xaxis2"]["title"] == "None"
    assert figure["data"][1]["x"] == ["B"]


def test_facet_by_color_builds_one_cell_per_color():
    manifest = cc.validate_payload(example("colors-grid"))
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C", "A", "B"],
            "val": [1.0, 2.0, 3.0, 4.0, 5.0],
            "grp": ["red", "blue", "green", "red", "blue"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert figure["layout"]["grid"] == {
        "rows": 1,
        "columns": 3,
        "pattern": "independent",
        "xgap": 0.08,
        "ygap": 0.12,
    }
    assert len(figure["data"]) == 3
    expected = {
        "red": (["A", "A"], [1.0, 4.0]),
        "blue": (["B", "B"], [2.0, 5.0]),
        "green": (["C"], [3.0]),
    }
    for index, (trace, color) in enumerate(
        zip(figure["data"], ["red", "blue", "green"])
    ):
        suffix = "" if index == 0 else str(index + 1)
        xs, ys = expected[color]
        assert trace["xaxis"] == f"x{suffix}"
        assert trace["yaxis"] == f"y{suffix}"
        assert trace["x"] == xs
        assert trace["y"] == ys
        assert trace["marker"]["color"] == [color] * len(xs)
        assert figure["layout"][f"xaxis{suffix}"]["title"] == color


def test_split_by_inside_facet_shows_legend_only_in_first_cell():
    manifest = cc.validate_payload(split_facet_manifest())
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "A", "B"],
            "val": [1.0, 2.0, 3.0, 4.0],
            "grp": ["red", "blue", "red", "blue"],
            "panel": ["F1", "F1", "F2", "F2"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == 4
    assert [
        trace["showlegend"] for trace in figure["data"]
    ] == [True, True, False, False]
    assert [trace["xaxis"] for trace in figure["data"]] == [
        "x",
        "x",
        "x2",
        "x2",
    ]
    assert [trace["name"] for trace in figure["data"]] == [
        "red",
        "blue",
        "red",
        "blue",
    ]
    assert [trace["legendgroup"] for trace in figure["data"]] == [
        "red",
        "blue",
        "red",
        "blue",
    ]
    assert [trace["y"] for trace in figure["data"]] == [
        [1.0],
        [2.0],
        [3.0],
        [4.0],
    ]
    assert figure["layout"]["grid"]["columns"] == 2
    assert figure["layout"]["xaxis"]["title"] == "F1"
    assert figure["layout"]["xaxis2"]["title"] == "F2"


@pytest.mark.parametrize("showlegend", [False, True])
def test_split_by_inside_facet_respects_explicit_showlegend(showlegend):
    manifest = cc.validate_payload(
        split_facet_manifest(showlegend=showlegend)
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "A", "B"],
            "val": [1.0, 2.0, 3.0, 4.0],
            "grp": ["red", "blue", "red", "blue"],
            "panel": ["F1", "F1", "F2", "F2"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert all(
        trace["showlegend"] is showlegend for trace in figure["data"]
    )


def test_split_by_and_facet_by_color_is_rejected():
    data = example("colors-grid")
    data["traces"][0]["splitBy"] = "$color"
    data["traces"][0]["marker"] = {"size": 8}
    assert (
        "traces[0].splitBy: not allowed when the manifest facets by '$color'"
        in errors_of(data)
    )


def test_array_style_slots_inside_facet_use_cell_rows():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="facet-array",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "size": {"required": True, "types": ["quantitative"]},
                "facet": {"required": True, "types": ["nominal"]},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    "marker": {"size": "$size.values"},
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C", "D", "E"],
            "val": [1.0, 2.0, 3.0, 4.0, 5.0],
            "sz": [10.0, 20.0, 30.0, 40.0, 50.0],
            "panel": ["F1", "F1", "F1", "F2", "F2"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            size=channel("sz", "quantitative"),
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == 2
    assert figure["data"][0]["marker"]["size"] == [10.0, 20.0, 30.0]
    assert len(figure["data"][0]["marker"]["size"]) == len(
        figure["data"][0]["y"]
    )
    assert figure["data"][1]["marker"]["size"] == [40.0, 50.0]
    assert len(figure["data"][1]["marker"]["size"]) == len(
        figure["data"][1]["y"]
    )


def test_facet_channel_declared_but_unbound_is_empty():
    manifest = cc.validate_payload(example("facet-grid"))
    df = pd.DataFrame({"cat": ["A"], "val": [1.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
        ),
        {"template": "plotly_white"},
    )
    assert figure["data"] == []
    assert figure["layout"]["template"] == "plotly_white"
    assert figure["layout"]["showlegend"] is False


def test_facet_with_segments_renders_shapes_per_cell():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="facet-segments",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "range"},
                "facet": {"required": True, "types": ["nominal"]},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "lines",
                    "segments": {
                        "x": "$x",
                        "from": "$y0",
                        "to": "$y1",
                    },
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "low": [1.0, 2.0, 3.0],
            "high": [4.0, 5.0, 6.0],
            "panel": ["F1", "F1", "F2"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("low"), y_channel("high")],
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert figure["data"] == []
    shapes = figure["layout"]["shapes"]
    assert len(shapes) == 3
    assert [
        (shape["xref"], shape["yref"], shape["x0"], shape["y0"], shape["y1"])
        for shape in shapes
    ] == [
        ("x", "y", 0, 1.0, 4.0),
        ("x", "y", 1, 2.0, 5.0),
        ("x2", "y2", 0, 3.0, 6.0),
    ]
    assert figure["layout"]["grid"]["columns"] == 2
    assert figure["layout"]["xaxis"]["title"] == "F1"
    assert figure["layout"]["xaxis2"]["title"] == "F2"
    assert figure["layout"]["xaxis"]["tickvals"] == [0, 1]
    assert figure["layout"]["xaxis"]["ticktext"] == ["A", "B"]
    assert figure["layout"]["xaxis"]["type"] == "linear"
    assert figure["layout"]["xaxis2"]["tickvals"] == [0]
    assert figure["layout"]["xaxis2"]["ticktext"] == ["C"]
    assert figure["layout"]["xaxis2"]["type"] == "linear"


def test_facet_inherits_manifest_and_base_layout_styling():
    data = example("facet-grid")
    data["layout"] = {
        "showlegend": True,
        "xaxis": {"gridcolor": "#123456", "tickangle": -20},
        "yaxis": {"zeroline": False},
        "margin": {"l": 40, "r": 10, "t": 20, "b": 30},
    }
    manifest = cc.validate_payload(data)
    base_layout = {
        "template": "plotly_white",
        "showlegend": False,
        "xaxis": {"title": "base x", "gridcolor": "#e5e5e5"},
        "yaxis": {"title": "base y", "gridcolor": "#e5e5e5"},
        "margin": {"l": 60, "r": 60, "t": 60, "b": 60},
    }
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "panel": ["F1", "F1", "F2"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("panel", "nominal"),
        ),
        base_layout,
    )
    layout = figure["layout"]
    assert layout["grid"] == {
        "rows": 1,
        "columns": 2,
        "pattern": "independent",
        "xgap": 0.08,
        "ygap": 0.12,
    }
    assert layout["showlegend"] is True
    assert layout["template"] == "plotly_white"
    assert layout["margin"] == {"l": 40, "r": 10, "t": 20, "b": 30}
    assert layout["xaxis"]["gridcolor"] == "#123456"
    assert layout["xaxis"]["tickangle"] == -20
    assert layout["xaxis"]["title"] == "F1"
    assert layout["xaxis2"]["gridcolor"] == "#123456"
    assert layout["xaxis2"]["tickangle"] == -20
    assert layout["xaxis2"]["title"] == "F2"
    assert layout["yaxis"]["zeroline"] is False
    assert layout["yaxis2"]["zeroline"] is False
    assert base_layout["xaxis"]["title"] == "base x"
    assert base_layout["yaxis"]["title"] == "base y"
    assert base_layout["margin"] == {"l": 60, "r": 60, "t": 60, "b": 60}

    bad = example("facet-grid")
    bad["layout"]["grid"] = {"rows": 0}
    assert "layout.grid" in errors_of(bad)


def test_facet_inherits_base_axis_styling_per_cell():
    manifest = cc.validate_payload(example("facet-grid"))
    base_layout = {
        "template": "plotly_white",
        "xaxis": {
            "title": "base x",
            "gridcolor": "#abcdef",
            "tickangle": 15,
        },
        "yaxis": {
            "title": "base y",
            "zeroline": True,
            "gridcolor": "#fedcba",
        },
        "margin": {"l": 60, "r": 60, "t": 60, "b": 60},
    }
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "panel": ["F1", "F1", "F2"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("panel", "nominal"),
        ),
        base_layout,
    )
    layout = figure["layout"]
    for suffix, title in (("", "F1"), ("2", "F2")):
        assert layout[f"xaxis{suffix}"]["gridcolor"] == "#abcdef"
        assert layout[f"xaxis{suffix}"]["tickangle"] == 15
        assert layout[f"xaxis{suffix}"]["title"] == title
        assert layout[f"yaxis{suffix}"]["gridcolor"] == "#fedcba"
        assert layout[f"yaxis{suffix}"]["zeroline"] is True
        assert layout[f"yaxis{suffix}"]["title"] == "base y"
    assert base_layout["xaxis"]["title"] == "base x"
    assert base_layout["yaxis"]["title"] == "base y"


def test_facet_by_validation_messages():
    bad = example("colors-grid")
    bad["facetBy"] = "$x"
    assert "manifest: 'facetBy' is only '$color'" in errors_of(bad)

    bad = example("colors-grid")
    bad["facetBy"] = 5
    assert "manifest: 'facetBy' is only '$color'" in errors_of(bad)

    bad = example("colors-grid")
    bad["channels"].pop("color")
    assert (
        "manifest: 'facetBy' requires a 'color' channel"
        in errors_of(bad)
    )

    bad = example("colors-grid")
    bad["channels"]["facet"] = {
        "required": True,
        "types": ["nominal"],
    }
    assert (
        "manifest: 'facetBy' and a 'facet' channel are mutually exclusive"
        in errors_of(bad)
    )

    bad = example("colors-grid")
    bad["facet_by"] = "$color"
    assert "unknown top-level key" in errors_of(bad)


def test_facet_strips_grid_owned_axis_keys_and_keeps_styling():
    data = example("facet-grid")
    data["layout"] = {
        "xaxis": {
            "domain": [0, 0.35],
            "overlaying": "x",
            "matches": "x",
            "gridcolor": "#abcdef",
            "showgrid": False,
            "title": {"font": {"size": 14, "color": "#112233"}},
        },
        "yaxis": {
            "domain": [0, 0.5],
            "anchor": "x",
            "position": 0.1,
            "scaleanchor": "x",
            "constrain": "domain",
            "gridcolor": "#fedcba",
            "zeroline": True,
        },
    }
    manifest = cc.validate_payload(data)
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "panel": ["F1", "F1", "F2"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    layout = figure["layout"]
    assert layout["grid"]["rows"] == 1
    assert layout["grid"]["columns"] == 2
    for suffix, label in (("", "F1"), ("2", "F2")):
        xaxis = layout[f"xaxis{suffix}"]
        yaxis = layout[f"yaxis{suffix}"]
        assert "domain" not in xaxis
        assert "overlaying" not in xaxis
        assert "matches" not in xaxis
        assert xaxis["gridcolor"] == "#abcdef"
        assert xaxis["showgrid"] is False
        assert xaxis["title"]["text"] == label
        assert xaxis["title"]["font"] == {
            "size": 14,
            "color": "#112233",
        }
        assert "domain" not in yaxis
        assert "anchor" not in yaxis
        assert "position" not in yaxis
        assert "scaleanchor" not in yaxis
        assert "constrain" not in yaxis
        assert yaxis["gridcolor"] == "#fedcba"
        assert yaxis["zeroline"] is True


def test_facet_caps_cells_and_adds_one_annotation():
    manifest = cc.validate_payload(example("facet-grid"))
    n = 137
    df = pd.DataFrame(
        {
            "cat": [f"A{i}" for i in range(n)],
            "val": [float(i) for i in range(n)],
            "panel": [f"V{i}" for i in range(n)],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == cc.MAX_FACET_CELLS
    assert figure["layout"]["grid"]["columns"] == 3
    assert figure["layout"]["grid"]["rows"] == 8
    assert [trace["xaxis"] for trace in figure["data"]] == [
        "x",
        *[f"x{i}" for i in range(2, cc.MAX_FACET_CELLS + 1)],
    ]
    assert f"xaxis{cc.MAX_FACET_CELLS + 1}" not in figure["layout"]
    assert figure["layout"]["annotations"] == [
        {
            "text": "Showing 24 of 137 facet values",
            "showarrow": False,
            "xref": "paper",
            "yref": "paper",
            "x": 0,
            "y": 1.08,
            "xanchor": "left",
            "font": {"size": 11},
        }
    ]


def test_facet_at_the_cell_cap_has_no_annotation():
    manifest = cc.validate_payload(example("facet-grid"))
    n = cc.MAX_FACET_CELLS
    df = pd.DataFrame(
        {
            "cat": [f"A{i}" for i in range(n)],
            "val": [float(i) for i in range(n)],
            "panel": [f"V{i}" for i in range(n)],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == n
    assert figure["layout"]["grid"]["columns"] == 3
    assert figure["layout"]["grid"]["rows"] == 8
    assert "annotations" not in figure["layout"]


@pytest.mark.parametrize("source", ["facet-grid", "colors-grid"])
def test_group_agg_cannot_be_combined_with_a_facet(source):
    data = example(source)
    data["channels"]["yFields"] = {"mode": "one"}
    data["transforms"] = [
        {
            "op": "group_agg",
            "groupBy": "x",
            "field": "y0",
            "agg": "sum",
            "as": "total",
        },
    ]
    data["traces"] = [{"type": "bar", "x": "$x", "y": "$total"}]
    message = errors_of(data)
    assert (
        "transforms[0]: group_agg cannot be combined with a facet "
        "('facet'/'facetBy' drop the faceted column)"
        in message
    )


def test_facet_cumulate_is_global_across_cells():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="facet-cumulate",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "facet": {"required": True, "types": ["nominal"]},
            },
            transforms=[
                {"op": "cumulate", "field": "y0", "as": "running"},
            ],
            traces=[
                {"type": "bar", "x": "$x", "y": "$running"},
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C", "D", "E", "F"],
            "val": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
            "panel": ["F1", "F2", "F3", "F1", "F2", "F3"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == 3
    # Global cumulate order A..F -> [1, 3, 6, 10, 15, 21].
    assert [trace["y"] for trace in figure["data"]] == [
        [1.0, 10.0],
        [3.0, 15.0],
        [6.0, 21.0],
    ]


def test_facet_labels_format_temporal_values_as_isoformat():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="facet-dates",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "facet": {"required": True, "types": ["temporal"]},
            },
            traces=[{"type": "bar", "x": "$x", "y": "$y0"}],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "when": pd.to_datetime(
                ["2024-01-01", "2024-01-02", "2024-01-01"]
            ),
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("when", "temporal"),
        ),
        {},
    )
    assert figure["layout"]["xaxis"]["title"] == "2024-01-01T00:00:00"
    assert figure["layout"]["xaxis2"]["title"] == "2024-01-02T00:00:00"


def test_split_labels_format_temporal_values_as_isoformat():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="split-dates",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "color": {"required": True, "types": ["temporal"]},
            },
            traces=[
                {
                    "type": "scatter",
                    "mode": "markers",
                    "x": "$x",
                    "y": "$y0",
                    "splitBy": "$color",
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, 2.0, 3.0],
            "when": pd.to_datetime(
                ["2024-01-01", "2024-01-02", "2024-01-01"]
            ),
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("when", "temporal"),
        ),
        {},
    )
    assert [trace["name"] for trace in figure["data"]] == [
        "2024-01-01T00:00:00",
        "2024-01-02T00:00:00",
    ]
    assert [trace["legendgroup"] for trace in figure["data"]] == [
        "2024-01-01T00:00:00",
        "2024-01-02T00:00:00",
    ]


def test_facet_by_null_is_treated_as_absent():
    data = example("series-line")
    data["facetBy"] = None
    manifest = cc.validate_payload(data)
    assert manifest.facet_by is None

    df = pd.DataFrame(
        {
            "cat": ["A"],
            "val": [1.0],
            "grp": ["a"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            color=channel("grp", "nominal"),
        ),
        {},
    )
    assert "grid" not in figure["layout"]

    with_facet_channel = example("facet-grid")
    with_facet_channel["facetBy"] = None
    assert cc.validate_payload(with_facet_channel).facet_by is None

    with_group_agg = payload()
    with_group_agg["facetBy"] = None
    with_group_agg["transforms"] = [
        {
            "op": "group_agg",
            "groupBy": "x",
            "field": "y0",
            "agg": "sum",
            "as": "total",
        },
    ]
    with_group_agg["traces"] = [
        {"type": "bar", "x": "$x", "y": "$total"}
    ]
    cc.validate_payload(with_group_agg)


@pytest.mark.parametrize(
    "n, expected_rows, expected_columns",
    [
        (1, 1, 1),
        (2, 1, 2),
        (3, 1, 3),
        (4, 2, 3),
        (5, 2, 3),
        (7, 3, 3),
        (12, 4, 3),
    ],
)
def test_facet_grid_shape_and_axis_suffixes(
    n, expected_rows, expected_columns
):
    manifest = cc.validate_payload(example("facet-grid"))
    df = pd.DataFrame(
        {
            "cat": [f"A{i}" for i in range(n)],
            "val": [float(i) for i in range(n)],
            "panel": [f"V{i}" for i in range(n)],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert figure["layout"]["grid"]["rows"] == expected_rows
    assert figure["layout"]["grid"]["columns"] == expected_columns
    assert expected_rows * expected_columns >= n
    assert len(figure["data"]) == n
    suffixes = [""] + [str(i) for i in range(2, n + 1)]
    assert [trace["xaxis"] for trace in figure["data"]] == [
        "x" if suffix == "" else f"x{suffix}"
        for suffix in suffixes
    ]
    for suffix in suffixes:
        x_key = "xaxis" if suffix == "" else f"xaxis{suffix}"
        y_key = "yaxis" if suffix == "" else f"yaxis{suffix}"
        assert x_key in figure["layout"]
        assert y_key in figure["layout"]
    assert "xaxis1" not in figure["layout"]


def test_facet_with_limit_can_drop_cells():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="facet-limit",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "facet": {"required": True, "types": ["nominal"]},
            },
            transforms=[{"op": "limit", "count": 3}],
            traces=[{"type": "bar", "x": "$x", "y": "$y0"}],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C", "D", "E"],
            "val": [1.0, 2.0, 3.0, 4.0, 5.0],
            "panel": ["F1", "F2", "F1", "F3", "F3"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == 2
    assert figure["layout"]["xaxis"]["title"] == "F1"
    assert figure["layout"]["xaxis2"]["title"] == "F2"
    assert "xaxis3" not in figure["layout"]


def test_facet_with_dropna_can_drop_cells():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="facet-dropna",
            channels={
                "x": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
                "facet": {"required": True, "types": ["nominal"]},
            },
            transforms=[{"op": "dropna", "slots": ["x", "y0"]}],
            traces=[{"type": "bar", "x": "$x", "y": "$y0"}],
        )
    )
    df = pd.DataFrame(
        {
            "cat": ["A", "B", "C"],
            "val": [1.0, np.nan, 3.0],
            "panel": ["F1", "F2", "F1"],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
            facet=channel("panel", "nominal"),
        ),
        {},
    )
    assert len(figure["data"]) == 1
    assert figure["layout"]["xaxis"]["title"] == "F1"
    assert "xaxis2" not in figure["layout"]
    assert figure["data"][0]["y"] == [1.0, 3.0]


# ---------------------------------------------------------------------------
# reduce / indicator / sankey
# ---------------------------------------------------------------------------

def test_reduce_collapses_frame_and_drops_other_slots():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="reduce-render",
            channels={"yFields": {"mode": "one"}},
            transforms=[
                {"op": "reduce", "field": "y0", "agg": "sum", "as": "total"}
            ],
            traces=[{"type": "bar", "x": "$index", "y": "$total"}],
        )
    )
    df = pd.DataFrame({"val": [1.0, 2.0, 3.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(y=[y_channel("val")]),
        {},
    )
    assert len(figure["data"]) == 1
    assert figure["data"][0]["x"] == [0]
    assert figure["data"][0]["y"] == [6.0]

    bad = minimal_manifest(
        chart_id="reduce-drop",
        transforms=[
            {"op": "reduce", "field": "y0", "agg": "sum", "as": "total"},
            {"op": "sort", "by": "y0"},
        ],
        traces=[{"type": "bar", "x": "$index", "y": "$total"}],
    )
    message = errors_of(bad)
    assert "unknown slot 'y0'" in message


def test_reduce_requires_field_agg_and_as():
    bad = minimal_manifest(
        chart_id="reduce-missing",
        transforms=[{"op": "reduce", "field": "y0"}],
    )
    assert (
        "transforms[0]: 'reduce' requires 'field', 'agg' and 'as'"
        in errors_of(bad)
    )


def test_multi_key_group_agg_keeps_grouped_slots():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="group-two",
            channels={
                "source": {"required": True, "types": ["nominal"]},
                "target": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
            },
            transforms=[
                {
                    "op": "group_agg",
                    "groupBy": ["source", "target"],
                    "field": "y0",
                    "agg": "sum",
                    "as": "total",
                }
            ],
            traces=[
                {
                    "type": "bar",
                    "x": "$source",
                    "y": "$total",
                    "labels": "$target",
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "src": ["A", "A", "B"],
            "dst": ["X", "Y", "X"],
            "val": [1.0, 2.0, 3.0],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            source=channel("src", "nominal"),
            target=channel("dst", "nominal"),
            y=[y_channel("val")],
        ),
        {},
    )
    trace = figure["data"][0]
    assert trace["x"] == ["A", "A", "B"]
    assert trace["y"] == [1.0, 2.0, 3.0]
    assert trace["labels"] == ["X", "Y", "X"]


def test_three_key_group_by_array_is_rejected():
    bad = minimal_manifest(
        chart_id="group-three",
        channels={
            "source": {"required": True, "types": ["nominal"]},
            "target": {"required": True, "types": ["nominal"]},
            "yFields": {"mode": "one"},
        },
        transforms=[
            {
                "op": "group_agg",
                "groupBy": ["source", "target", "y0"],
                "field": "y0",
                "agg": "sum",
                "as": "total",
            }
        ],
        traces=[{"type": "bar", "y": "$total"}],
    )
    assert (
        "transforms[0].groupBy: accepts a slot or an array of 1-2 slots"
        in errors_of(bad)
    )


def test_indicator_renders_scalar_and_gauge_options():
    manifest = cc.validate_payload(example("kpi-gauge"))
    df = pd.DataFrame({"val": [10.0, 20.0, 30.0]})

    default_figure = cc.render(
        df,
        manifest,
        encoding(y=[y_channel("val")]),
        {},
    )
    trace = default_figure["data"][0]
    assert trace["type"] == "indicator"
    assert trace["mode"] == "gauge+number"
    assert trace["value"] == 60.0
    assert trace["gauge"]["axis"]["range"] == [0, 100]
    assert trace["gauge"]["bar"]["color"] == "#2563eb"
    assert trace["gauge"]["steps"] == [
        {"range": [0, 40], "color": "#fee2e2"},
        {"range": [40, 70], "color": "#fef3c7"},
        {"range": [70, 100], "color": "#dcfce7"},
    ]
    assert "x" not in trace
    assert "y" not in trace

    overridden = cc.render(
        df,
        manifest,
        encoding(
            y=[y_channel("val")],
            options={"min": -10, "max": 200, "color": "#ff0000"},
        ),
        {},
    )
    overridden_trace = overridden["data"][0]
    assert overridden_trace["value"] == 60.0
    assert overridden_trace["gauge"]["axis"]["range"] == [-10, 200]
    assert overridden_trace["gauge"]["bar"]["color"] == "#ff0000"


def test_indicator_option_pairs_work_inside_steps():
    data = example("kpi-gauge")
    data["traces"][0]["gauge"]["steps"] = [
        {"range": ["$opt.min", "$opt.max"], "color": "$opt.color"}
    ]
    manifest = cc.validate_payload(data)
    df = pd.DataFrame({"val": [10.0, 20.0]})

    default_figure = cc.render(
        df,
        manifest,
        encoding(y=[y_channel("val")]),
        {},
    )
    assert default_figure["data"][0]["gauge"]["steps"] == [
        {"range": [0, 100], "color": "#2563eb"}
    ]

    overridden = cc.render(
        df,
        manifest,
        encoding(
            y=[y_channel("val")],
            options={"min": -5, "max": 50, "color": "#ff0000"},
        ),
        {},
    )
    assert overridden["data"][0]["gauge"]["steps"] == [
        {"range": [-5, 50], "color": "#ff0000"}
    ]


def test_indicator_extra_style_objects_render():
    data = example("kpi-gauge")
    data["traces"][0]["title"] = {
        "text": "Total",
        "font": {"size": 14, "color": "#111111"},
    }
    data["traces"][0]["number"] = {
        "prefix": "$",
        "suffix": " req",
        "valueformat": ".1f",
        "font": {"size": 18},
    }
    data["traces"][0]["delta"] = {
        "reference": "$opt.min",
        "increasing": {"color": "#16a34a"},
        "decreasing": {"color": "#dc2626"},
    }
    manifest = cc.validate_payload(data)
    figure = cc.render(
        pd.DataFrame({"val": [4.0, 6.0]}),
        manifest,
        encoding(y=[y_channel("val")]),
        {},
    )
    trace = figure["data"][0]
    assert trace["title"] == {
        "text": "Total",
        "font": {"size": 14, "color": "#111111"},
    }
    assert trace["number"] == {
        "prefix": "$",
        "suffix": " req",
        "valueformat": ".1f",
        "font": {"size": 18},
    }
    assert trace["delta"]["reference"] == 0
    assert trace["delta"]["increasing"] == {"color": "#16a34a"}


def test_indicator_value_needs_exactly_one_row():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="indicator-arity",
            channels={"yFields": {"mode": "one"}},
            traces=[
                {"type": "indicator", "mode": "number", "value": "$y0"}
            ],
        )
    )
    df = pd.DataFrame({"val": [1.0, 2.0, 3.0, 4.0, 5.0]})
    with pytest.raises(ValueError) as exc:
        cc.render(
            df,
            manifest,
            encoding(y=[y_channel("val")]),
            {},
        )
    assert (
        "traces[0].value: needs exactly one row after transforms (got 5); "
        "add a 'reduce' transform"
        in str(exc.value)
    )


@pytest.mark.parametrize("trace_type", ["bar", "scatter"])
@pytest.mark.parametrize("key", ["title", "number", "gauge", "delta"])
def test_indicator_only_style_keys_are_rejected_elsewhere(trace_type, key):
    value = {"text": "x"} if key == "title" else {}
    data = minimal_manifest(
        traces=[
            {"type": trace_type, "x": "$x", "y": "$y0", key: value}
        ],
    )
    assert (
        f"traces[0].{key}: only allowed on the 'indicator' trace type"
        in errors_of(data)
    )


def test_indicator_value_key_is_rejected_elsewhere():
    data = minimal_manifest(
        traces=[{"type": "bar", "x": "$x", "y": "$y0", "value": "$y0"}],
    )
    assert (
        "traces[0].value: only allowed on the 'indicator' trace type"
        in errors_of(data)
    )


def test_indicator_styles_reject_data_and_label_slots():
    data = example("kpi-gauge")
    data["traces"][0]["gauge"]["axis"]["range"] = ["$x", "$opt.max"]
    message = errors_of(data)
    assert "$x" in message
    assert "only allowed on x, y, z, labels, values" in message

    data = example("kpi-gauge")
    data["traces"][0]["title"] = {"text": "$x.label"}
    assert "only allowed in name or text" in errors_of(data)


def test_indicator_steps_are_capped_at_ten():
    data = example("kpi-gauge")
    data["traces"][0]["gauge"]["steps"] = [
        {"range": [i, i + 1], "color": "#fff"} for i in range(11)
    ]
    assert "at most 10 steps are allowed" in errors_of(data)


def test_sankey_node_labels_and_links():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="sankey-raw",
            channels={
                "source": {"required": True, "types": ["nominal"]},
                "target": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
            },
            traces=[
                {
                    "type": "sankey",
                    "source": "$source",
                    "target": "$target",
                    "values": "$y0",
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "src": ["A", "B", "A"],
            "dst": ["X", "X", "Y"],
            "val": [1.0, 2.0, 3.0],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            source=channel("src", "nominal"),
            target=channel("dst", "nominal"),
            y=[y_channel("val")],
        ),
        {},
    )
    trace = figure["data"][0]
    assert trace["type"] == "sankey"
    assert trace["node"]["label"] == ["A", "B", "X", "Y"]
    assert trace["link"]["source"] == [0, 1, 0]
    assert trace["link"]["target"] == [2, 2, 3]
    assert trace["link"]["value"] == [1.0, 2.0, 3.0]
    assert "source" not in trace
    assert "target" not in trace
    assert "values" not in trace


def test_sankey_does_not_aggregate_duplicate_links():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="sankey-dupes",
            channels={
                "source": {"required": True, "types": ["nominal"]},
                "target": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
            },
            traces=[
                {
                    "type": "sankey",
                    "source": "$source",
                    "target": "$target",
                    "values": "$y0",
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "src": ["A", "A"],
            "dst": ["X", "X"],
            "val": [1.0, 2.0],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            source=channel("src", "nominal"),
            target=channel("dst", "nominal"),
            y=[y_channel("val")],
        ),
        {},
    )
    trace = figure["data"][0]
    assert trace["node"]["label"] == ["A", "X"]
    assert trace["link"]["source"] == [0, 0]
    assert trace["link"]["target"] == [1, 1]
    assert trace["link"]["value"] == [1.0, 2.0]


def test_sankey_equal_length_validation_message():
    data = minimal_manifest(
        chart_id="sankey-len",
        channels={
            "source": {"required": True, "types": ["nominal"]},
            "target": {"required": True, "types": ["nominal"]},
        },
        traces=[
            {
                "type": "sankey",
                "source": ["A"],
                "target": ["X", "Y"],
                "values": [1.0],
            }
        ],
    )
    assert (
        "traces[0]: sankey needs source, target and values of equal length"
        in errors_of(data)
    )


def test_sankey_equal_length_render_message():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="sankey-render-len",
            channels={
                "source": {"required": True, "types": ["nominal"]},
                "target": {"required": True, "types": ["nominal"]},
            },
            traces=[
                {
                    "type": "sankey",
                    "source": "$source",
                    "target": "$target",
                    "values": [1.0],
                }
            ],
        )
    )
    df = pd.DataFrame({"src": ["A", "B"], "dst": ["X", "Y"]})
    with pytest.raises(ValueError) as exc:
        cc.render(
            df,
            manifest,
            encoding(
                source=channel("src", "nominal"),
                target=channel("dst", "nominal"),
            ),
            {},
        )
    assert (
        "traces[0]: sankey needs source, target and values of equal length"
        in str(exc.value)
    )


def test_source_and_target_keys_are_rejected_outside_sankey():
    data = minimal_manifest(
        traces=[
            {
                "type": "scatter",
                "x": "$x",
                "y": "$y0",
                "source": "$x",
                "target": "$x",
            }
        ],
    )
    message = errors_of(data)
    assert (
        "traces[0].source: only allowed on the 'sankey' trace type"
        in message
    )
    assert (
        "traces[0].target: only allowed on the 'sankey' trace type"
        in message
    )


def test_sankey_unbound_source_and_target_is_empty():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="sankey-unbound",
            channels={
                "source": {"required": False, "types": ["nominal"]},
                "target": {"required": False, "types": ["nominal"]},
            },
            traces=[
                {
                    "type": "sankey",
                    "source": "$source",
                    "target": "$target",
                    "values": [1.0],
                }
            ],
        )
    )
    df = pd.DataFrame({"src": ["A"], "dst": ["X"]})
    figure = cc.render(df, manifest, encoding(), {"template": "plotly_white"})
    assert figure["data"] == []
    assert figure["layout"]["template"] == "plotly_white"


@pytest.mark.parametrize("key", ["node", "link", "arrangement"])
def test_sankey_style_keys_rejected_outside_sankey(key):
    value = "snap" if key == "arrangement" else {"pad": 1}
    data = minimal_manifest(
        traces=[{"type": "bar", "x": "$x", "y": "$y0", key: value}],
    )
    assert (
        f"traces[0].{key}: only allowed on the 'sankey' trace type"
        in errors_of(data)
    )


def test_sankey_style_keys_are_skipped_at_render_outside_sankey():
    manifest = cc.validate_payload(
        minimal_manifest(
            traces=[{"type": "bar", "x": "$x", "y": "$y0"}],
        )
    )
    manifest.traces[0]["node"] = {"pad": 1}
    manifest.traces[0]["link"] = {"color": "#fff"}
    manifest.traces[0]["arrangement"] = "snap"
    figure = cc.render(
        pd.DataFrame({"cat": ["A"], "val": [1.0]}),
        manifest,
        encoding(
            x=channel("cat", "nominal"),
            y=[y_channel("val")],
        ),
        {},
    )
    trace = figure["data"][0]
    assert "node" not in trace
    assert "link" not in trace
    assert "arrangement" not in trace


def test_reduce_unavailable_slot_messages_are_accurate():
    data = minimal_manifest(
        chart_id="reduce-slots",
        channels={
            "x": {"required": True, "types": ["nominal"]},
            "yFields": {"mode": "one"},
        },
        transforms=[
            {"op": "reduce", "field": "y0", "agg": "sum", "as": "total"}
        ],
        traces=[{"type": "bar", "x": "$x", "y": "$y0"}],
    )
    message = errors_of(data)
    assert (
        "traces[0].x: data slot '$x' is not available after the preceding "
        "'reduce' transform (only its 'as' output, $index and $count remain)"
        in message
    )
    assert (
        "traces[0].y: data slot '$y0' is not available after the preceding "
        "'reduce' transform (only its 'as' output, $index and $count remain)"
        in message
    )


@pytest.mark.parametrize("source", ["facet-grid", "colors-grid"])
def test_reduce_cannot_be_combined_with_a_facet(source):
    data = example(source)
    data["channels"]["yFields"] = {"mode": "one"}
    data["transforms"] = [
        {"op": "reduce", "field": "y0", "agg": "sum", "as": "total"}
    ]
    data["traces"] = [
        {"type": "indicator", "mode": "number", "value": "$total"}
    ]
    assert (
        "transforms[0]: reduce cannot be combined with a facet "
        "('facet'/'facetBy' drop the faceted column)"
        in errors_of(data)
    )


def test_indicator_render_enforces_nested_schema():
    manifest = cc.validate_payload(example("kpi-gauge"))
    raw = manifest.traces[0]
    raw["title"] = {
        "text": "Total",
        "foo": 1,
        "font": {"size": [12], "color": "#ffffff"},
    }
    raw["gauge"]["axis"]["domain"] = [0, 1]
    raw["gauge"]["axis"]["range"] = [1, 2, 3]
    raw["gauge"]["steps"] = [
        {"range": [i, i + 1], "color": "#fff"} for i in range(11)
    ]
    raw["delta"] = {
        "reference": [1, 2],
        "increasing": {"color": "#16a34a"},
    }
    raw["number"] = {
        "valueformat": ["a"],
        "suffix": " req",
    }
    figure = cc.render(
        pd.DataFrame({"val": [1.0, 2.0]}),
        manifest,
        encoding(y=[y_channel("val")]),
        {},
    )
    trace = figure["data"][0]
    assert "foo" not in trace["title"]
    assert trace["title"]["text"] == "Total"
    assert trace["title"]["font"] == {"color": "#ffffff"}
    assert "domain" not in trace["gauge"]["axis"]
    assert "range" not in trace["gauge"]["axis"]
    assert len(trace["gauge"]["steps"]) == 10
    assert "reference" not in trace["delta"]
    assert trace["delta"]["increasing"] == {"color": "#16a34a"}
    assert "valueformat" not in trace["number"]
    assert trace["number"]["suffix"] == " req"


def test_indicator_value_on_empty_frame_has_specific_message():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="indicator-empty",
            channels={"yFields": {"mode": "one"}},
            traces=[
                {"type": "indicator", "mode": "number", "value": "$y0"}
            ],
        )
    )
    df = pd.DataFrame({"val": pd.Series([], dtype=float)})
    with pytest.raises(ValueError) as exc:
        cc.render(
            df,
            manifest,
            encoding(y=[y_channel("val")]),
            {},
        )
    assert (
        "traces[0].value: no rows after transforms"
        in str(exc.value)
    )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["traces"][0].__setitem__(
            "delta", {"reference": [1, 2]}
        ),
        lambda d: d["traces"][0].__setitem__(
            "number", {"valueformat": ["a"]}
        ),
        lambda d: d["traces"][0].__setitem__(
            "title", {"text": ["x"]}
        ),
        lambda d: d["traces"][0].__setitem__(
            "gauge", {"shape": ["arc"]}
        ),
        lambda d: d["traces"][0].__setitem__(
            "title", {"font": {"size": [12]}}
        ),
    ],
)
def test_indicator_scalar_leaves_reject_lists(mutate):
    data = example("kpi-gauge")
    mutate(data)
    assert "must be a scalar" in errors_of(data)


def test_indicator_step_color_may_stay_a_list():
    data = example("kpi-gauge")
    data["traces"][0]["gauge"]["steps"] = [
        {"range": [0, 100], "color": ["#ffffff", "#000000"]}
    ]
    manifest = cc.validate_payload(data)
    figure = cc.render(
        pd.DataFrame({"val": [1.0, 2.0]}),
        manifest,
        encoding(y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["gauge"]["steps"] == [
        {"range": [0, 100], "color": ["#ffffff", "#000000"]}
    ]


@pytest.mark.parametrize("key", ["values", "labels", "z"])
def test_indicator_rejects_other_data_keys(key):
    data = minimal_manifest(
        channels={"yFields": {"mode": "one"}},
        traces=[
            {
                "type": "indicator",
                "mode": "number",
                "value": "$y0",
                key: "$y0",
            }
        ],
    )
    assert (
        f"traces[0].{key}: not allowed on the 'indicator' trace type"
        in errors_of(data)
    )


def test_sankey_link_values_must_be_numeric():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="sankey-text-values",
            channels={
                "source": {"required": True, "types": ["nominal"]},
                "target": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
            },
            traces=[
                {
                    "type": "sankey",
                    "source": "$source",
                    "target": "$target",
                    "values": "$y0",
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "src": ["A"],
            "dst": ["X"],
            "val": ["twelve"],
        }
    )
    with pytest.raises(ValueError) as exc:
        cc.render(
            df,
            manifest,
            encoding(
                source=channel("src", "nominal"),
                target=channel("dst", "nominal"),
                y=[y_channel("val", "nominal")],
            ),
            {},
        )
    assert (
        "traces[0].values: sankey link values must be numeric"
        in str(exc.value)
    )


def test_sankey_link_values_preserve_nan_as_null():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="sankey-nan-values",
            channels={
                "source": {"required": True, "types": ["nominal"]},
                "target": {"required": True, "types": ["nominal"]},
                "yFields": {"mode": "one"},
            },
            traces=[
                {
                    "type": "sankey",
                    "source": "$source",
                    "target": "$target",
                    "values": "$y0",
                }
            ],
        )
    )
    df = pd.DataFrame(
        {
            "src": ["A", "A"],
            "dst": ["X", "Y"],
            "val": [1.0, np.nan],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            source=channel("src", "nominal"),
            target=channel("dst", "nominal"),
            y=[y_channel("val")],
        ),
        {},
    )
    assert figure["data"][0]["link"]["value"] == [1.0, None]


def test_reduce_numeric_aggregates_reject_text_columns():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="reduce-text",
            channels={"yFields": {"mode": "one"}},
            transforms=[
                {"op": "reduce", "field": "y0", "agg": "sum", "as": "total"}
            ],
            traces=[{"type": "bar", "y": "$total"}],
        )
    )
    df = pd.DataFrame({"val": ["a", "b"]})
    with pytest.raises(ValueError) as exc:
        cc.render(
            df,
            manifest,
            encoding(y=[y_channel("val", "nominal")]),
            {},
        )
    assert (
        "transforms[0]: aggregate 'sum' needs a numeric column"
        in str(exc.value)
    )


def test_reduce_count_works_on_text_columns():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="reduce-count",
            channels={"yFields": {"mode": "one"}},
            transforms=[
                {"op": "reduce", "field": "y0", "agg": "count", "as": "total"}
            ],
            traces=[{"type": "bar", "y": "$total"}],
        )
    )
    df = pd.DataFrame({"val": ["a", "b"]})
    figure = cc.render(
        df,
        manifest,
        encoding(y=[y_channel("val", "nominal")]),
        {},
    )
    assert figure["data"][0]["y"] == [2]


def test_kpi_gauge_example_renders():
    manifest = cc.validate_payload(example("kpi-gauge"))
    figure = cc.render(
        pd.DataFrame({"val": [10.0, 20.0, 30.0]}),
        manifest,
        encoding(y=[y_channel("val")]),
        {},
    )
    assert figure["data"]
    assert figure["data"][0]["value"] == 60.0
    assert cc.is_samplable(manifest) is False


def test_indicator_trace_alone_is_not_samplable():
    manifest = cc.validate_payload(
        minimal_manifest(
            chart_id="indicator-sampling",
            channels={"yFields": {"mode": "one"}},
            traces=[
                {"type": "indicator", "mode": "number", "value": "$y0"}
            ],
        )
    )
    assert cc.is_samplable(manifest) is False


def test_flow_sankey_example_aggregates_duplicate_pairs():
    manifest = cc.validate_payload(example("flow-sankey"))
    df = pd.DataFrame(
        {
            "src": ["A", "A", "B", "A"],
            "dst": ["X", "X", "X", "Y"],
            "val": [1.0, 2.0, 3.0, 4.0],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            source=channel("src", "nominal"),
            target=channel("dst", "nominal"),
            y=[y_channel("val")],
        ),
        {},
    )
    assert figure["data"]
    trace = figure["data"][0]
    assert trace["arrangement"] == "snap"
    assert trace["node"]["label"] == ["A", "B", "X", "Y"]
    assert trace["node"]["pad"] == 16
    assert trace["node"]["thickness"] == 16
    assert trace["node"]["color"] == "#3b82f6"
    assert trace["node"]["line"] == {"color": "#ffffff", "width": 1}
    assert trace["link"]["source"] == [0, 1, 0]
    assert trace["link"]["target"] == [2, 2, 3]
    assert trace["link"]["value"] == [3.0, 3.0, 4.0]
    assert trace["link"]["color"] == "#cbd5e1"
    assert trace["link"]["line"] == {"color": "#e2e8f0", "width": 0}


# ---------------------------------------------------------------------------
# Examples, introspection and sampling
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "name, expected_traces",
    [("dumbbell", 2), ("lollipop", 2), ("bullet", 2)],
)
def test_examples_validate_and_render(name, expected_traces):
    data = example(name)
    assert data["id"] == name
    manifest = cc.validate_payload(data)

    figure = cc.render(
        toy_df(),
        manifest,
        encoding(
            x=channel("city", "nominal"),
            y=[
                y_channel("start", label="Start"),
                y_channel("end", label="End"),
            ],
        ),
        {"template": "plotly_white"},
    )
    assert figure["data"], f"{name} rendered no traces"
    assert len(figure["data"]) == expected_traces
    for trace in figure["data"]:
        assert trace["type"] in cc.TRACE_TYPES
    assert figure["layout"]["template"] == "plotly_white"


def test_bullet_uses_target_marker_over_bar():
    manifest = cc.validate_payload(example("bullet"))
    figure = cc.render(toy_df(), manifest, dumbbell_encoding(), {})
    assert [trace["type"] for trace in figure["data"]] == ["bar", "scatter"]

    bar, target = figure["data"]
    assert bar["width"] == 0.55
    assert bar["x"] == [10.0, 20.0, 30.0]
    assert target["mode"] == "markers"
    assert target["name"] == "End"
    assert target["x"] == [18.0, 17.0, 45.0]
    assert target["y"] == ["A", "B", "C"]
    assert target["marker"] == {
        "symbol": "line-ns",
        "size": 18,
        "color": "#1e293b",
        "line": {"width": 2},
    }


def test_bullet_target_options_override():
    manifest = cc.validate_payload(example("bullet"))
    figure = cc.render(
        toy_df(),
        manifest,
        dumbbell_encoding(
            options={
                "barWidth": 0.4,
                "targetColor": "#ff0000",
                "targetSize": 24,
            }
        ),
        {},
    )
    bar, target = figure["data"]
    assert bar["width"] == 0.4
    assert target["marker"] == {
        "symbol": "line-ns",
        "size": 24,
        "color": "#ff0000",
        "line": {"width": 2},
    }


def test_default_palette_matches_builtin_builder():
    from backend.api.chart import DEFAULT_COLORS

    assert tuple(cc._DEFAULT_PALETTE) == tuple(DEFAULT_COLORS)


def _docs_json_blocks(text: str | None = None) -> list[dict]:
    if text is None:
        docs = ROOT / "docs" / "custom-charts.md"
        text = docs.read_text(encoding="utf-8")
    blocks: list[dict] = []
    marker = "```json"
    cursor = 0
    while True:
        start = text.find(marker, cursor)
        if start == -1:
            break
        end = text.find("```", start + len(marker))
        if end == -1:
            break
        raw = text[start + len(marker):end].strip()
        cursor = end + 3
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            blocks.append(parsed)
    return blocks


@pytest.mark.parametrize(
    "example_path",
    sorted(EXAMPLES.glob("*.json")),
    ids=lambda path: path.stem,
)
def test_docs_embed_each_example_manifest(example_path):
    expected = json.loads(example_path.read_text(encoding="utf-8"))
    docs = ROOT / "docs" / "custom-charts.md"
    text = docs.read_text(encoding="utf-8")
    blocks = _docs_json_blocks(text)
    assert expected in blocks, (
        f"{example_path.name} is not embedded as a ```json block in "
        f"docs/custom-charts.md"
    )


def test_channel_requirements_shape():
    manifest = cc.validate_payload(example("dumbbell"))
    requirements = cc.channel_requirements(manifest)
    assert requirements["x"] == {
        "required": True,
        "types": ["nominal", "temporal"],
    }
    assert requirements["color"] == {
        "required": False,
        "types": ["nominal"],
    }
    assert requirements["yFields"] == "range"


def test_channel_requirements_without_yfields():
    data = minimal_manifest(
        channels={"x": {"required": True, "types": ["nominal"]}},
        traces=[{"type": "bar", "x": "$x"}],
    )
    manifest = cc.validate_payload(data)
    requirements = cc.channel_requirements(manifest)
    assert requirements["yFields"] == "none"
    assert requirements["x"] == {
        "required": True,
        "types": ["nominal"],
    }


@pytest.mark.parametrize(
    "op, expected",
    [
        (None, True),
        ("dropna", True),
        ("sort", True),
        ("limit", False),
        ("group_agg", False),
        ("cumulate", False),
        ("reduce", False),
    ],
)
def test_is_samplable_per_transform(op, expected):
    manifest = cc.validate_payload(payload())
    manifest.transforms = [] if op is None else [{"op": op}]
    assert cc.is_samplable(manifest) is expected


def test_dropna_and_sort_remain_samplable_together():
    manifest = cc.validate_payload(payload())
    manifest.transforms = [
        {"op": "dropna", "slots": ["x"]},
        {"op": "sort", "by": "y0"},
    ]
    assert cc.is_samplable(manifest) is True


# ---------------------------------------------------------------------------
# Categorical segments: remap axis positions for Plotly
# ---------------------------------------------------------------------------

def test_dumbbell_segments_remap_categorical_axis_for_flat_markers():
    manifest = cc.validate_payload(example("dumbbell"))
    df = pd.DataFrame(
        {
            "city": ["A", "B", "C", "D", "E", "F"],
            "start": [12.0, 18.0, 22.0, 14.0, 30.0, 9.0],
            # The example sorts by y1 descending; descending ends keep the
            # A..F order so the expected ticktext is easy to read.
            "end": [60.0, 50.0, 40.0, 30.0, 20.0, 10.0],
        }
    )
    figure = cc.render(df, manifest, dumbbell_encoding(), {})

    assert len(figure["data"]) == 2
    first_marker, second_marker = figure["data"]
    assert first_marker["x"] == [0, 1, 2, 3, 4, 5]
    assert second_marker["x"] == [0, 1, 2, 3, 4, 5]

    shapes = figure["layout"]["shapes"]
    assert len(shapes) == 6
    assert [shape["x0"] for shape in shapes] == [0, 1, 2, 3, 4, 5]
    assert [shape["x1"] for shape in shapes] == [0, 1, 2, 3, 4, 5]
    assert [(shape["y0"], shape["y1"]) for shape in shapes] == [
        (12.0, 60.0),
        (18.0, 50.0),
        (22.0, 40.0),
        (14.0, 30.0),
        (30.0, 20.0),
        (9.0, 10.0),
    ]
    for shape in shapes:
        assert shape["type"] == "line"
        assert shape["xref"] == "x"
        assert shape["yref"] == "y"
        assert shape["line"] == {"color": "#cbd5e1", "width": 2}
        assert shape["layer"] == "below"

    xaxis = figure["layout"]["xaxis"]
    assert xaxis["tickmode"] == "array"
    assert xaxis["tickvals"] == [0, 1, 2, 3, 4, 5]
    assert xaxis["ticktext"] == ["A", "B", "C", "D", "E", "F"]
    assert xaxis["type"] == "linear"

    def walk(value):
        if isinstance(value, dict):
            for item in value.values():
                yield from walk(item)
        elif isinstance(value, list):
            for item in value:
                yield from walk(item)
        else:
            yield value

    assert "multicategory" not in set(walk(figure))


def test_segments_numeric_axis_keeps_original_values():
    data = segment_manifest()
    data["channels"] = {
        "x": {"required": True, "types": ["quantitative"]},
        "yFields": {"mode": "range"},
    }
    manifest = cc.validate_payload(data)
    df = pd.DataFrame(
        {
            "n": [10, 20, 30],
            "low": [1.0, 2.0, 3.0],
            "high": [4.0, 5.0, 6.0],
        }
    )
    figure = cc.render(
        df,
        manifest,
        encoding(
            x=channel("n", "quantitative"),
            y=[y_channel("low"), y_channel("high")],
        ),
        {},
    )
    assert figure["data"] == []
    shapes = figure["layout"]["shapes"]
    assert [shape["x0"] for shape in shapes] == [10, 20, 30]
    assert [shape["x1"] for shape in shapes] == [10, 20, 30]
    xaxis = figure["layout"].get("xaxis", {})
    assert "tickvals" not in xaxis
    assert "ticktext" not in xaxis


def test_plain_categorical_scatter_does_not_remap_axis():
    manifest = cc.validate_payload(
        minimal_manifest(
            traces=[{"type": "scatter", "mode": "markers", "x": "$x", "y": "$y0"}]
        )
    )
    df = pd.DataFrame({"cat": ["A", "B"], "val": [1.0, 2.0]})
    figure = cc.render(
        df,
        manifest,
        encoding(x=channel("cat", "nominal"), y=[y_channel("val")]),
        {},
    )
    assert figure["data"][0]["x"] == ["A", "B"]
    xaxis = figure["layout"].get("xaxis", {})
    assert "tickvals" not in xaxis
    assert "ticktext" not in xaxis
    assert xaxis.get("type") != "multicategory"
