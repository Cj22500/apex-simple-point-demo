"""In-memory point cloud representation used by every pipeline stage.

Coordinates are float64 [E, N, H] in metres (JGD2011 Zone IX + orthometric height unless the
dataset says otherwise). Attributes are optional; readers fill what the format provides.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class PointSet:
    xyz: np.ndarray  # (n, 3) float64
    intensity: np.ndarray | None = None  # (n,) uint16
    rgb: np.ndarray | None = None  # (n, 3) uint8
    classification: np.ndarray | None = None  # (n,) uint8 (ASPRS classes)
    extra: dict[str, np.ndarray] = field(default_factory=dict)  # e.g. {"dz": float32}
    crs: str = "EPSG:6677+EPSG:6695"

    def __post_init__(self) -> None:
        self.xyz = np.ascontiguousarray(self.xyz, dtype=np.float64)
        if self.xyz.ndim != 2 or self.xyz.shape[1] != 3:
            raise ValueError("xyz must have shape (n, 3)")
        n = len(self.xyz)
        if self.intensity is not None:
            self.intensity = np.ascontiguousarray(self.intensity, dtype=np.uint16)
        if self.rgb is not None:
            self.rgb = np.ascontiguousarray(self.rgb, dtype=np.uint8)
        if self.classification is not None:
            self.classification = np.ascontiguousarray(self.classification, dtype=np.uint8)
        for name, arr in (("intensity", self.intensity), ("rgb", self.rgb), ("classification", self.classification), *self.extra.items()):
            if arr is not None and len(arr) != n:
                raise ValueError(f"attribute {name} has {len(arr)} values for {n} points")

    def __len__(self) -> int:
        return len(self.xyz)

    def subset(self, mask_or_index) -> "PointSet":
        return PointSet(
            xyz=self.xyz[mask_or_index],
            intensity=None if self.intensity is None else self.intensity[mask_or_index],
            rgb=None if self.rgb is None else self.rgb[mask_or_index],
            classification=None if self.classification is None else self.classification[mask_or_index],
            extra={k: v[mask_or_index] for k, v in self.extra.items()},
            crs=self.crs,
        )

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        return self.xyz.min(axis=0), self.xyz.max(axis=0)
