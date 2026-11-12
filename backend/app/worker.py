"""AWS ingest worker: SQS message -> raw object in S3 -> octree -> tiles bucket.

Runs as the ECS Fargate (Spot) "worker" service (infra/lib/stack.ts) and scales to zero when the
queue is empty. Messages come from the upload-notifier Lambda:
    {"bucket": "<raw bucket>", "key": "uploads/<dataset_id>/<file name>", "format": "laz"}
Tiles are written under tiles/<dataset_id>/ with immutable cache headers for CloudFront.
A failure leaves the message on the queue; after 3 receives SQS moves it to the DLQ.

    python -m app.worker        (needs boto3 and SPL_QUEUE_URL / SPL_TILES_BUCKET)
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path, PurePosixPath

from app.core import pcio
from app.core.octree import OctreeConfig, build_octree

log = logging.getLogger("spl.worker")
IMMUTABLE = "public, max-age=31536000, immutable"


def dataset_id_from_key(key: str) -> str:
    parts = PurePosixPath(key).parts
    if len(parts) < 3 or parts[0] != "uploads":
        raise ValueError(f"unexpected key layout: {key!r} (expected uploads/<dataset_id>/<file>)")
    return parts[1]


def process_message(body: dict, s3, tiles_bucket: str, workdir: Path, cfg: OctreeConfig = OctreeConfig()) -> dict:
    """Download, build the octree, upload tiles. `s3` is a boto3 S3 client (or a test double)."""
    dataset_id = dataset_id_from_key(body["key"])
    raw_path = workdir / PurePosixPath(body["key"]).name
    s3.download_file(body["bucket"], body["key"], str(raw_path))
    ps = pcio.read_points(raw_path)
    out = workdir / "octree"
    h = build_octree(ps, out, cfg)
    prefix = f"tiles/{dataset_id}"
    s3.upload_file(str(out / "hierarchy.json"), tiles_bucket, f"{prefix}/hierarchy.json",
                   ExtraArgs={"ContentType": "application/json", "CacheControl": IMMUTABLE})
    for node in sorted((out / "nodes").glob("*.bin")):
        s3.upload_file(str(node), tiles_bucket, f"{prefix}/nodes/{node.name}",
                       ExtraArgs={"ContentType": "application/octet-stream", "CacheControl": IMMUTABLE})
    return {"dataset_id": dataset_id, "points": h["points"], "nodes": len(h["nodes"])}


def main() -> None:  # pragma: no cover - needs AWS
    import boto3

    logging.basicConfig(level=logging.INFO)
    queue_url = os.environ["SPL_QUEUE_URL"]
    tiles_bucket = os.environ["SPL_TILES_BUCKET"]
    sqs, s3 = boto3.client("sqs"), boto3.client("s3")
    while True:
        resp = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1, WaitTimeSeconds=20)
        for msg in resp.get("Messages", []):
            try:
                with tempfile.TemporaryDirectory() as d:
                    result = process_message(json.loads(msg["Body"]), s3, tiles_bucket, Path(d))
                log.info("done %s", result)
                sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=msg["ReceiptHandle"])
            except Exception:  # noqa: BLE001  (keep the message; SQS retries, then the DLQ)
                log.exception("failed: %s", msg.get("Body"))


if __name__ == "__main__":  # pragma: no cover
    main()
