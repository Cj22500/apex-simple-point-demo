"""Run every test suite and write VERIFICATION_REPORT.md with measured errors.

Usage (from repo root):  backend/.venv/Scripts/python scripts/verify.py   (or scripts/verify.ps1)
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VER = REPO / "data" / "verification"
NPX = "npx.cmd" if os.name == "nt" else "npx"


def run(name: str, cmd: list[str], cwd: Path) -> dict:
    print(f"\n=== {name}: {' '.join(cmd)}")
    t0 = dt.datetime.now()
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    print(out[-3000:])
    return {"name": name, "ok": p.returncode == 0, "seconds": (dt.datetime.now() - t0).total_seconds(), "summary": summarize(out)}


def summarize(out: str) -> str:
    for pat in (r"(\d+ passed[^\n]*)", r"(Tests\s+\d+[^\n]*)", r"(\d+ failed[^\n]*)"):
        m = re.findall(pat, out)
        if m:
            return re.sub(r"\x1b\[[0-9;]*m", "", m[-1]).strip()
    return out.strip().splitlines()[-1] if out.strip() else ""


def load_metrics() -> list[dict]:
    metrics: list[dict] = []
    f = VER / "pytest_metrics.json"
    if f.exists():
        metrics += json.loads(f.read_text(encoding="utf-8"))
    vdir = VER / "vitest"
    if vdir.exists():
        for g in sorted(vdir.glob("*.json")):
            metrics += json.loads(g.read_text(encoding="utf-8"))
    return metrics


def status(m: dict) -> str:
    name = m["name"]
    if "expected FAIL" in name:
        return "fails as designed" if not m["pass"] else "**UNEXPECTED PASS**"
    if "informational" in name:
        return "info"
    return "pass" if m["pass"] else "**FAIL**"


def main() -> int:
    if VER.exists():
        shutil.rmtree(VER)
    py = sys.executable
    suites = [run("Backend (pytest)", [py, "-m", "pytest"], REPO / "backend")]
    suites.append(run("Frontend (vitest)", [NPX, "vitest", "run"], REPO / "frontend"))
    suites.append(run("Frontend (tsc)", [NPX, "tsc", "--noEmit"], REPO / "frontend"))
    if (REPO / "infra" / "package.json").exists():
        suites.append(run("Infra (CDK snapshot)", [NPX, "vitest", "run"], REPO / "infra"))

    metrics = load_metrics()
    lines = [
        "# Verification report",
        "",
        f"Generated {dt.datetime.now().strftime('%Y-%m-%d %H:%M')} by `scripts/verify.py`. "
        "Ground truth is independent of the code under test: analytic geometry, 50-digit decimal arithmetic, "
        "or GSI (国土地理院) official calculators. Tolerances come from `docs/specs/`.",
        "",
        "## Test suites",
        "",
        "| Suite | Result | Summary | Time |",
        "|---|---|---|---|",
    ]
    for s in suites:
        summary = s["summary"] or ("no type errors" if s["ok"] else "")
        lines.append(f"| {s['name']} | {'pass' if s['ok'] else '**FAIL**'} | {summary} | {s['seconds']:.1f} s |")
    lines += ["", "## Measured accuracy", ""]
    groups: dict[str, list[dict]] = {}
    for m in metrics:
        groups.setdefault(m["group"], []).append(m)
    for g, ms in groups.items():
        lines += [f"### {g}", "", "| Check | Measured | Tolerance | Status |", "|---|---|---|---|"]
        for m in ms:
            name = m["name"].replace("|", "\\|")
            lines.append(f"| {name} | {m['value']:.6g} {m['unit']} | {m['tolerance']:g} {m['unit']} | {status(m)} |")
        lines.append("")
    (REPO / "VERIFICATION_REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    ok = all(s["ok"] for s in suites) and all(status(m) in ("pass", "info", "fails as designed") for m in metrics)
    print(f"\nVERIFICATION_REPORT.md written. Overall: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
