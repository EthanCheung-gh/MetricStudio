#!/bin/bash
# MetricStudio E2E Test Script
set -e

echo "=== MetricStudio E2E Tests ==="

# Start backend
cd "$(dirname "$0")"
source .venv/bin/activate
python backend/main.py &
BACKEND_PID=$!
sleep 3

cleanup() {
    kill $BACKEND_PID 2>/dev/null || true
    exit $1
}
trap 'cleanup $?' EXIT INT TERM

BASE="http://127.0.0.1:8123"

# Test 1: Health check
echo -n "1. Health check... "
curl -sf "$BASE/health" > /dev/null && echo "PASS" || { echo "FAIL"; cleanup 1; }

# Test 2: Import data
echo -n "2. Import CSV... "
ID=$(curl -sf -F "file=@sample_data.csv" "$BASE/api/v1/data/import" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
[ -n "$ID" ] && echo "PASS (ID: $ID)" || { echo "FAIL"; cleanup 1; }

# Test 3: List datasets
echo -n "3. List datasets... "
COUNT=$(curl -sf "$BASE/api/v1/data/list" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[ "$COUNT" = "1" ] && echo "PASS" || { echo "FAIL (count=$COUNT)"; cleanup 1; }

# Test 4: Preview
echo -n "4. Preview data... "
curl -sf "$BASE/api/v1/data/$ID/preview?limit=5" > /dev/null && echo "PASS" || { echo "FAIL"; cleanup 1; }

# Test 5: Describe
echo -n "5. Describe stats... "
curl -sf "$BASE/api/v1/data/$ID/describe" > /dev/null && echo "PASS" || { echo "FAIL"; cleanup 1; }

# Test 6: Filter
echo -n "6. Filter... "
curl -sf -X POST "$BASE/api/v1/transform/$ID/filter" -H "Content-Type: application/json" -d '{"column":"value","operator":"gt","value":130}' > /dev/null && echo "PASS" || { echo "FAIL"; cleanup 1; }

# Test 7: Sort
echo -n "7. Sort... "
curl -sf -X POST "$BASE/api/v1/transform/$ID/sort" -H "Content-Type: application/json" -d '{"column":"value","ascending":false}' > /dev/null && echo "PASS" || { echo "FAIL"; cleanup 1; }

# Test 8: History
echo -n "8. History... "
HIST_COUNT=$(curl -sf "$BASE/api/v1/transform/$ID/history" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[ "$HIST_COUNT" = "2" ] && echo "PASS" || { echo "FAIL (count=$HIST_COUNT)"; cleanup 1; }

# Test 9: Chart preview
echo -n "9. Chart preview... "
curl -sf -X POST "$BASE/api/v1/chart/preview" -H "Content-Type: application/json" -d "{\"dataset_id\":\"$ID\",\"encoding\":{\"chart_type\":\"bar\",\"x\":{\"field\":\"date\",\"type\":\"temporal\"},\"y\":{\"field\":\"value\",\"type\":\"quantitative\",\"aggregate\":\"sum\"},\"color\":{\"field\":\"category\",\"type\":\"nominal\"}}}" > /dev/null && echo "PASS" || { echo "FAIL"; cleanup 1; }

# Test 10: Delete dataset
echo -n "10. Delete dataset... "
curl -sf -X DELETE "$BASE/api/v1/data/$ID" > /dev/null && echo "PASS" || { echo "FAIL"; cleanup 1; }

echo "=== All tests passed ==="
cleanup 0
