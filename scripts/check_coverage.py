"""Enforce separate line AND branch thresholds; coverage.py's combined metric is insufficient."""

import json
from pathlib import Path

totals = json.loads(Path("coverage.json").read_text())["totals"]
for metric, covered, count in [
    ("lines", totals["covered_lines"], totals["num_statements"]),
    ("branches", totals["covered_branches"], totals["num_branches"]),
]:
    if count == 0:
        raise SystemExit(f"{metric}: no executable code measured")
    percentage = 100 * covered / count
    print(f"Backend {metric}: {percentage:.2f}%")
    if percentage < 90:
        raise SystemExit(f"{metric} coverage must be at least 90%")
