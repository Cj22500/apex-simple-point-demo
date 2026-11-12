"""AWS worker logic with an in-memory S3 double (no AWS needed)."""
import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from app.core import pcio
from app.core.pointset import PointSet
from app.worker import dataset_id_from_key, process_message


class FakeS3:
    def __init__(self, root: Path):
        self.root = root
        self.uploads: dict[tuple[str, str], dict] = {}

    def download_file(self, bucket, key, dest):
        shutil.copy(self.root / bucket / key, dest)

    def upload_file(self, src, bucket, key, ExtraArgs=None):  # noqa: N803 (boto3 signature)
        target = self.root / bucket / key
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, target)
        self.uploads[(bucket, key)] = ExtraArgs or {}


def test_process_message_writes_immutable_tiles(tmp_path):
    rng = np.random.default_rng(2)
    ps = PointSet(np.column_stack([-4300 + rng.uniform(0, 30, 5000), -39000 + rng.uniform(0, 30, 5000), rng.uniform(0, 3, 5000)]))
    raw = tmp_path / "s3" / "raw-bucket" / "uploads" / "ds123" / "scan.laz"
    raw.parent.mkdir(parents=True)
    pcio.write_points(ps, raw)
    s3 = FakeS3(tmp_path / "s3")
    work = tmp_path / "work"
    work.mkdir()
    r = process_message({"bucket": "raw-bucket", "key": "uploads/ds123/scan.laz", "format": "laz"}, s3, "tiles-bucket", work)
    assert r["dataset_id"] == "ds123" and r["points"] == 5000
    h = json.loads((tmp_path / "s3" / "tiles-bucket" / "tiles" / "ds123" / "hierarchy.json").read_text())
    assert len(h["nodes"]) == r["nodes"]
    assert all(v["CacheControl"].endswith("immutable") for v in s3.uploads.values())
    assert len(s3.uploads) == r["nodes"] + 1


@pytest.mark.parametrize("key", ["scan.laz", "other/ds/scan.laz", "uploads/scan.laz"])
def test_rejects_unexpected_keys(key):
    with pytest.raises(ValueError):
        dataset_id_from_key(key)
