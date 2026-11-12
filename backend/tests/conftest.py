from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

GOLDEN = REPO / "shared" / "golden"
METRICS_FILE = REPO / "data" / "verification" / "pytest_metrics.json"
_METRICS: list[dict] = []


@pytest.fixture(scope="session")
def metric():
    """Record a measured error for VERIFICATION_REPORT.md: metric(group, name, value, tolerance, unit)."""

    def record(group: str, name: str, value: float, tolerance: float, unit: str = "mm") -> None:
        _METRICS.append(
            {"group": group, "name": name, "value": float(value), "tolerance": float(tolerance),
             "unit": unit, "pass": bool(abs(value) <= tolerance)}
        )

    return record


def pytest_sessionfinish(session, exitstatus):  # noqa: ARG001
    if _METRICS:
        METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
        METRICS_FILE.write_text(json.dumps(_METRICS, indent=2), encoding="utf-8")


def load_golden(name: str) -> dict:
    return json.loads((GOLDEN / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def golden_measurements() -> dict:
    return load_golden("measurements.json")


@pytest.fixture(scope="session")
def golden_crs() -> dict:
    return load_golden("crs.json")


@pytest.fixture(scope="session")
def golden_volumes() -> dict:
    return load_golden("volumes.json")
