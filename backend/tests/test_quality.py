"""Unit tests for the rule-based data quality detector."""

from backend.core.quality import detect_quality


def test_detects_missing(dirty_df):
    report = detect_quality(dirty_df)
    missing = [i for i in report["issues"] if i["id"] == "missing"]
    assert missing, "expected a missing-values issue"
    assert "score" in missing[0]["columns"]
    assert report["summary"]["missing_cells"] == 3


def test_detects_duplicates(dirty_df):
    report = detect_quality(dirty_df)
    dup = [i for i in report["issues"] if i["id"] == "duplicates"]
    assert dup and dup[0]["detail"].startswith("1 fully duplicate")
    assert report["summary"]["duplicate_rows"] == 1


def test_detects_outliers(dirty_df):
    report = detect_quality(dirty_df)
    outliers = [i for i in report["issues"] if i["id"] == "outliers"]
    assert len(outliers) == 2  # value (500) and score (999)
    cols = {o["columns"][0] for o in outliers}
    assert cols == {"value", "score"}


def test_detects_numeric_string_with_thousands_separator(dirty_df):
    """StringDtype columns like '1,000' must be flagged as coercible."""
    report = detect_quality(dirty_df)
    type_issues = [i for i in report["issues"] if i["id"] == "type"]
    assert type_issues and "num_str" in type_issues[0]["columns"]
    assert type_issues[0]["suggestions"] == ["coerce-numeric"]


def test_clean_data_has_no_issues(clean_df):
    report = detect_quality(clean_df)
    assert report["issues"] == []


def test_issue_suggestions_reference_known_recipes(dirty_df):
    from backend.core.recipes import RECIPE_IDS

    report = detect_quality(dirty_df)
    for issue in report["issues"]:
        for suggestion in issue["suggestions"]:
            assert suggestion in RECIPE_IDS, suggestion
