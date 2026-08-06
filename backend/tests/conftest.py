"""Shared fixtures for the MetricStudio test suite."""

import io

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.main import app

# Fixed dirty dataset exercising every quality detector:
# - score: 3 missing values
# - one fully duplicated row
# - value=500 / score=999: IQR outliers
# - num_str: thousands-separator strings (numeric-looking, object dtype)
DIRTY_CSV = """id,value,score,category,num_str,note
1,100,90,A,"1,000",hello
2,150,,A,"2,000",world
3,200,95,B,"3,000",spaced  
1,100,90,A,"1,000",hello
4,500,999,B,"4,000",oops
5,110,,C,"5,000",foo
6,90,88,C,"6,000",bar
7,120,92,D,"7,000",baz
8,105,,D,"8,000",qux
9,115,91,E,"9,000",quux
"""


@pytest.fixture
def dirty_df() -> pd.DataFrame:
    return pd.read_csv(io.StringIO(DIRTY_CSV))


@pytest.fixture
def clean_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "id": [1, 2, 3, 4],
            "value": [10.0, 20.0, 30.0, 40.0],
            "category": ["A", "B", "A", "B"],
        }
    )


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_session():
    """Reset the module-level SessionManager between tests.

    The session is a module singleton, so both datasets and the global
    undo/redo stacks leak across tests otherwise.
    """
    from backend.core.session import session

    session.datasets.clear()
    session.global_history.clear()
    session.global_redo.clear()
    yield
    for ds_id in list(session.datasets.keys()):
        session.delete_dataset(ds_id)
    session.datasets.clear()
    session.global_history.clear()
    session.global_redo.clear()


@pytest.fixture
def dirty_dataset(client):
    """Import DIRTY_CSV and return its DataFrameMeta."""
    resp = client.post(
        "/api/v1/data/import",
        files={"file": ("dirty.csv", DIRTY_CSV.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()[0]
