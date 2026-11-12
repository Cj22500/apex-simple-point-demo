"""Download the GSI geoid grids (CC-BY 4.0, converted by the PROJ project) into data/proj.

- jp_gsi_jpgeo2024.tif  : JPGEO2024 ("ジオイド2024日本とその周辺"), Japan's official geoid since 2025-04-01
- jp_gsi_gsigeo2011.tif : GSIGEO2011 (legacy, kept for comparison / old deliverables)

Source: https://cdn.proj.org (see jp_gsi_README.txt there). Usage: python scripts/fetch_grids.py
"""
from __future__ import annotations

import pathlib
import urllib.request

GRIDS = ["jp_gsi_jpgeo2024.tif", "jp_gsi_gsigeo2011.tif"]
DEST = pathlib.Path(__file__).resolve().parents[1] / "data" / "proj"


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    for name in GRIDS:
        target = DEST / name
        if target.exists() and target.stat().st_size > 0:
            print(f"ok   {name} ({target.stat().st_size:,} bytes, cached)")
            continue
        urllib.request.urlretrieve(f"https://cdn.proj.org/{name}", target)
        print(f"got  {name} ({target.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
