"""Object storage abstraction: local disk now, S3 in AWS (same keys).

Key layout (identical on disk and in S3):
    datasets/<dataset_id>/arrays/{xyz,intensity,rgb,classification,<extra>}.npy   full resolution
    datasets/<dataset_id>/octree/hierarchy.json
    datasets/<dataset_id>/octree/nodes/<name>.bin                                 immutable tiles
    photos/<photo_id>.jpg
In AWS the octree prefix lives in the tiles bucket behind CloudFront (immutable caching), and
the arrays are read by Fargate workers. See infra/ and docs/ARCHITECTURE.md.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

import numpy as np

from app.core.pointset import PointSet

_SAFE = re.compile(r"^[A-Za-z0-9_\-]+$")


class LocalStorage:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def dataset_dir(self, dataset_id: str) -> Path:
        if not _SAFE.match(dataset_id):
            raise ValueError("invalid dataset id")
        return self.root / "datasets" / dataset_id

    def octree_dir(self, dataset_id: str) -> Path:
        return self.dataset_dir(dataset_id) / "octree"

    def node_path(self, dataset_id: str, node: str) -> Path:
        if not re.fullmatch(r"r[0-7]*", node):
            raise ValueError("invalid node name")
        return self.octree_dir(dataset_id) / "nodes" / f"{node}.bin"

    def photo_path(self, photo_id: str) -> Path:
        if not _SAFE.match(photo_id):
            raise ValueError("invalid photo id")
        (self.root / "photos").mkdir(parents=True, exist_ok=True)
        return self.root / "photos" / f"{photo_id}.jpg"

    def save_arrays(self, dataset_id: str, ps: PointSet) -> None:
        d = self.dataset_dir(dataset_id) / "arrays"
        d.mkdir(parents=True, exist_ok=True)
        np.save(d / "xyz.npy", ps.xyz)
        for name in ("intensity", "rgb", "classification"):
            arr = getattr(ps, name)
            if arr is not None:
                np.save(d / f"{name}.npy", arr)
        for name, arr in ps.extra.items():
            np.save(d / f"extra_{name}.npy", arr)

    def load_arrays(self, dataset_id: str, mmap: bool = True) -> PointSet:
        d = self.dataset_dir(dataset_id) / "arrays"
        mode = "r" if mmap else None

        def opt(name):
            p = d / f"{name}.npy"
            return np.load(p, mmap_mode=mode) if p.exists() else None

        extra = {p.stem[6:]: np.load(p, mmap_mode=mode) for p in d.glob("extra_*.npy")}
        return PointSet(
            xyz=np.load(d / "xyz.npy", mmap_mode=mode), intensity=opt("intensity"), rgb=opt("rgb"),
            classification=opt("classification"), extra=extra,
        )

    def delete_dataset(self, dataset_id: str) -> None:
        shutil.rmtree(self.dataset_dir(dataset_id), ignore_errors=True)
