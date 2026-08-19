#!/usr/bin/env python3
"""Regenerate the bundled sample dataset (deterministic, no external deps).

Covers the surfaces exercised during manual verification:
- dates across a full year (time series, MoM, trend insights)
- multiple categorical dimensions (filter, pivot, group-by, charts)
- sales/cost/profit/quantity/discount numerics (multi-Y charts, computed columns)
- deliberate missing values (quality scan, drop-missing)
- outlier rows (skew/outlier insights)
- a region dimension table for join testing

Run: python3 scripts/generate-sample-data.py
"""

from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
random.seed(42)

REGIONS = ["North", "South", "East", "West"]
CATEGORIES = ["A", "B", "C"]
CHANNELS = ["online", "offline"]

# Per-category base price/cost so profit and ratios are plausible.
BASE = {
    "A": {"price": 120.0, "cost": 70.0, "trend": 0.35},
    "B": {"price": 90.0, "cost": 55.0, "trend": 0.15},
    "C": {"price": 160.0, "cost": 95.0, "trend": 0.25},
}

rows = []
start = date(2024, 1, 1)
# Weekly cadence across the year -> ~53 points per series for clear MoM/trend.
for week in range(53):
    day = start + timedelta(weeks=week)
    seasonal = 1.0 + 0.25 * ((week % 13) / 13.0)  # gentle quarterly seasonality
    for region in REGIONS:
        for category in CATEGORIES:
            cfg = BASE[category]
            qty = max(1, int(5 + week * cfg["trend"] * seasonal + random.uniform(-2, 3)))
            sales = round(qty * cfg["price"] * seasonal + random.uniform(-20, 20), 2)
            cost = round(qty * cfg["cost"] * seasonal + random.uniform(-15, 15), 2)
            profit = round(sales - cost, 2)
            discount = round(random.uniform(0.0, 0.2), 3)
            channel = CHANNELS[0] if (week + len(region)) % 2 == 0 else CHANNELS[1]
            rows.append(
                {
                    "date": day.isoformat(),
                    "region": region,
                    "category": category,
                    "channel": channel,
                    "sales": sales,
                    "cost": cost,
                    "profit": profit,
                    "quantity": qty,
                    "discount": discount,
                }
            )

# Deliberate quality-test rows: missing discount + one extreme outlier.
for idx in (5, 17, 42, 88, 133, 200, 311, 402):
    if idx < len(rows):
        rows[idx]["discount"] = ""
rows[120]["sales"] = 9850.0  # strong positive outlier for skew/insight checks

with (ROOT / "sample_data.csv").open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)

region_table = [
    {"region": "North", "manager": "Alice", "target": 15000},
    {"region": "South", "manager": "Bob", "target": 12000},
    {"region": "East", "manager": "Carol", "target": 13500},
    {"region": "West", "manager": "David", "target": 11000},
]
with (ROOT / "sample_regions.csv").open("w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["region", "manager", "target"])
    writer.writeheader()
    writer.writerows(region_table)

print(f"sample_data.csv: {len(rows)} rows")
print(f"sample_regions.csv: {len(region_table)} rows (join lookup table)")
