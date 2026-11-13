"""Octree LOD builder (Potree-style grid subsampling), pure NumPy.

Every point is stored in exactly one node. A non-leaf node keeps one random point per cell of a
GRID^3 lattice over its cube, so its density is "spacing = cube / GRID". All other points go down
to the 8 children. A node with at most MAX_LEAF remaining points (or at MAX_DEPTH) keeps all of
them. Rendering the root plus a subset of descendants therefore gives a uniform-density preview
that refines as you zoom: classic LOD.

Precision: each node stores a float64 centre in hierarchy.json and its points as float32 offsets
from that centre (|offset| <= half the node size), so decoded coordinates are accurate to
~1e-5 m even at Tokyo-scale plane coordinates. See docs/ARCHITECTURE.md §Precision.

Node binary layout (little endian, n points, k extra float32 attributes):
    float32[3n] position offsets | float32[n] x k extras | uint32[n] source index |
    uint16[n] intensity | uint8[3n] rgb | uint8[n] classification
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.core.pointset import PointSet

FORMAT_VERSION = "spl-octree-1"


@dataclass(frozen=True)
class OctreeConfig:
    grid: int = 128
    max_leaf: int = 20_000
    max_depth: int = 12
    seed: int = 1
    shuffle: bool = True  # False = deterministic (first point per cell in input order); used for TS parity tests


def node_name(level: int, q: np.ndarray) -> str:
    qx, qy, qz = (int(v) for v in q)
    digits = []
    for lv in range(1, level + 1):
        shift = level - lv
        digits.append(str((((qx >> shift) & 1) << 2) | (((qy >> shift) & 1) << 1) | ((qz >> shift) & 1)))
    return "r" + "".join(digits)


def _layout(n: int, extras: list[str]) -> dict[str, int]:
    off = {"position": 0}
    cur = 12 * n
    for name in extras:
        off[f"extra:{name}"] = cur
        cur += 4 * n
    off["index"] = cur; cur += 4 * n
    off["intensity"] = cur; cur += 2 * n
    off["rgb"] = cur; cur += 3 * n
    off["classification"] = cur; cur += n
    off["_size"] = cur
    return off


def encode_node(ps: PointSet, idx: np.ndarray, center: np.ndarray, extras: list[str]) -> bytes:
    n = idx.size
    pos = (ps.xyz[idx] - center).astype("<f4")
    parts = [pos.tobytes()]
    for name in extras:
        parts.append(ps.extra[name][idx].astype("<f4").tobytes())
    parts.append(idx.astype("<u4").tobytes())
    parts.append((ps.intensity[idx] if ps.intensity is not None else np.zeros(n, np.uint16)).astype("<u2").tobytes())
    parts.append((ps.rgb[idx] if ps.rgb is not None else np.full((n, 3), 200, np.uint8)).astype(np.uint8).tobytes())
    parts.append((ps.classification[idx] if ps.classification is not None else np.zeros(n, np.uint8)).astype(np.uint8).tobytes())
    return b"".join(parts)


def decode_node(buf: bytes, n: int, center, extras: list[str]) -> dict[str, np.ndarray]:
    off = _layout(n, extras)
    out = {
        "xyz": np.frombuffer(buf, "<f4", 3 * n, off["position"]).reshape(n, 3).astype(np.float64) + np.asarray(center, np.float64),
        "index": np.frombuffer(buf, "<u4", n, off["index"]),
        "intensity": np.frombuffer(buf, "<u2", n, off["intensity"]),
        "rgb": np.frombuffer(buf, np.uint8, 3 * n, off["rgb"]).reshape(n, 3),
        "classification": np.frombuffer(buf, np.uint8, n, off["classification"]),
    }
    for name in extras:
        out[name] = np.frombuffer(buf, "<f4", n, off[f"extra:{name}"])
    return out


def build_octree(ps: PointSet, out_dir: Path, cfg: OctreeConfig = OctreeConfig()) -> dict:
    n_total = len(ps)
    if n_total == 0:
        raise ValueError("empty point cloud")
    out_dir = Path(out_dir)
    (out_dir / "nodes").mkdir(parents=True, exist_ok=True)
    extras = sorted(ps.extra)

    lo, hi = ps.bounds()
    size = float(np.max(hi - lo))
    size = size * (1 + 1e-9) + 1e-6  # strictly contain the max point
    rel = (ps.xyz - lo) / size  # in [0, 1)

    remaining = np.random.default_rng(cfg.seed).permutation(n_total) if cfg.shuffle else np.arange(n_total)
    nodes: list[dict] = []

    for level in range(cfg.max_depth + 1):
        if remaining.size == 0:
            break
        cells = 1 << level
        q = np.minimum((rel[remaining] * cells).astype(np.int64), cells - 1)
        key = (q[:, 0] << (2 * level)) | (q[:, 1] << level) | q[:, 2]
        order = np.argsort(key, kind="stable")  # stable keeps the random order inside a node
        key_sorted = key[order]
        rem_sorted = remaining[order]
        uniq, starts, counts = np.unique(key_sorted, return_index=True, return_counts=True)

        next_remaining = []
        g = cells * cfg.grid
        for k, s, c in zip(uniq, starts, counts):
            members = rem_sorted[s : s + c]
            qn = np.array([(k >> (2 * level)) & (cells - 1), (k >> level) & (cells - 1), k & (cells - 1)])
            if c <= cfg.max_leaf or level == cfg.max_depth:
                chosen = members
            else:
                gq = np.minimum((rel[members] * g).astype(np.int64), g - 1)
                bits = int(g - 1).bit_length()
                ckey = (gq[:, 0] << (2 * bits)) | (gq[:, 1] << bits) | gq[:, 2]
                _, first = np.unique(ckey, return_index=True)
                mask = np.zeros(c, bool)
                mask[first] = True
                chosen = members[mask]
                next_remaining.append(members[~mask])
            node_size = size / cells
            nmin = lo + qn * node_size
            center = nmin + node_size / 2
            name = node_name(level, qn)
            (out_dir / "nodes" / f"{name}.bin").write_bytes(encode_node(ps, chosen, center, extras))
            nodes.append({
                "name": name,
                "level": level,
                "count": int(chosen.size),
                "min": nmin.tolist(),
                "max": (nmin + node_size).tolist(),
                "center": center.tolist(),
                "spacing": node_size / cfg.grid,
                "leaf": bool(chosen.size == c),
            })
        remaining = np.concatenate(next_remaining) if next_remaining else np.empty(0, np.int64)

    names = {nd["name"] for nd in nodes}
    for nd in nodes:  # child presence mask lets the client skip 404s
        nd["children"] = [i for i in range(8) if f"{nd['name']}{i}" in names]

    tight_lo, tight_hi = lo, hi
    hierarchy = {
        "format": FORMAT_VERSION,
        "crs": ps.crs,
        "points": n_total,
        "cube": {"min": lo.tolist(), "size": size},
        "bounds": {"min": tight_lo.tolist(), "max": tight_hi.tolist()},
        "grid": cfg.grid,
        "attributes": {
            "position": "float32x3 offset from node center (float64 in hierarchy)",
            "extras": extras,
            "index": "uint32 source index",
            "intensity": "uint16",
            "rgb": "uint8x3",
            "classification": "uint8 (ASPRS)",
        },
        "stats": {
            "z_min": float(lo[2]), "z_max": float(hi[2]),
            "z_p01": float(np.percentile(ps.xyz[:, 2], 1)), "z_p99": float(np.percentile(ps.xyz[:, 2], 99)),
            "intensity_p02": float(np.percentile(ps.intensity, 2)) if ps.intensity is not None else 0.0,
            "intensity_p98": float(np.percentile(ps.intensity, 98)) if ps.intensity is not None else 65535.0,
            **{f"{e}_absmax": float(np.nanmax(np.abs(ps.extra[e]))) for e in extras},
        },
        "nodes": nodes,
    }
    (out_dir / "hierarchy.json").write_text(json.dumps(hierarchy), encoding="utf-8")
    return hierarchy
