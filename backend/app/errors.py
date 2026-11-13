"""Structured API error codes alongside FastAPI HTTPException detail strings."""
from __future__ import annotations

from fastapi import HTTPException

ERR_AUTH_INVALID_TOKEN = "AUTH_INVALID_TOKEN"
ERR_PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
ERR_ROLE_REQUIRED = "ROLE_REQUIRED"
ERR_DATASET_NOT_FOUND = "DATASET_NOT_FOUND"
ERR_JOB_NOT_FOUND = "JOB_NOT_FOUND"
ERR_HIERARCHY_NOT_FOUND = "HIERARCHY_NOT_FOUND"
ERR_NODE_NOT_FOUND = "NODE_NOT_FOUND"
ERR_POINT_CLOUD_TOO_SMALL = "POINT_CLOUD_TOO_SMALL"
ERR_UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
ERR_UPLOAD_INVALID_CLOUD = "UPLOAD_INVALID_CLOUD"
ERR_DATASET_NOT_READY = "DATASET_NOT_READY"
ERR_CANNOT_DELETE_BASE_DATASET = "CANNOT_DELETE_BASE_DATASET"
ERR_POINT_EXCEEDS_MAX = "POINT_EXCEEDS_MAX"
ERR_TOO_FEW_POINTS_IN_POLYGON = "TOO_FEW_POINTS_IN_POLYGON"
ERR_DATASETS_DIFFERENT_PROJECTS = "DATASETS_DIFFERENT_PROJECTS"
ERR_NO_DESIGN_SURFACE = "NO_DESIGN_SURFACE"
ERR_INVALID_DESIGN_DXF = "INVALID_DESIGN_DXF"
ERR_MISSING_DESIGN_SURFACE = "MISSING_DESIGN_SURFACE"
ERR_SIMA_NO_RECORDS = "SIMA_NO_RECORDS"
ERR_PHOTO_NO_GPS = "PHOTO_NO_GPS"
ERR_PHOTO_NOT_FOUND = "PHOTO_NOT_FOUND"
ERR_INVALID_VALUE = "INVALID_VALUE"
ERR_CRS_OUTSIDE_GEOID = "CRS_OUTSIDE_GEOID"


class CodedHTTPException(HTTPException):
    """HTTPException carrying a stable machine-readable error code and template params."""

    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        params: dict | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
        self.params = params or {}
