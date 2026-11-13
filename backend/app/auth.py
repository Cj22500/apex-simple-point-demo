"""Minimal signed-token auth (stand-in for Amazon Cognito JWTs in the AWS deployment).

Token = "<user_id>.<hmac_sha256(user_id)>". Good enough to make tenancy and roles real in the
demo; production would verify Cognito-issued JWTs (JWKS) in the same dependency.
"""
from __future__ import annotations

import hashlib
import hmac
import os

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.db import ROLES, Project, ProjectMember, User
from app.errors import (
    ERR_AUTH_INVALID_TOKEN,
    ERR_PROJECT_NOT_FOUND,
    ERR_ROLE_REQUIRED,
    CodedHTTPException,
)

SECRET = os.environ.get("SPL_AUTH_SECRET", "dev-only-secret-change-me").encode()


def issue_token(user_id: str) -> str:
    sig = hmac.new(SECRET, user_id.encode(), hashlib.sha256).hexdigest()
    return f"{user_id}.{sig}"


def verify_token(token: str) -> str | None:
    user_id, _, sig = token.partition(".")
    expected = hmac.new(SECRET, user_id.encode(), hashlib.sha256).hexdigest()
    return user_id if sig and hmac.compare_digest(sig, expected) else None


def get_db(request: Request):
    session: Session = request.app.state.sessions()
    try:
        yield session
    finally:
        session.close()


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    header = request.headers.get("authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else request.query_params.get("token", "")
    user_id = verify_token(token) if token else None
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise CodedHTTPException(401, ERR_AUTH_INVALID_TOKEN, "invalid or missing token")
    return user


def project_for(db: Session, user: User, project_id: str, min_role: str = "viewer") -> Project:
    """Return the project if it belongs to the user's tenant and the user has at least min_role.
    Projects of other tenants are reported as 404 (don't reveal that they exist)."""
    project = db.get(Project, project_id)
    if project is None or project.tenant_id != user.tenant_id:
        raise CodedHTTPException(404, ERR_PROJECT_NOT_FOUND, "project not found")
    member = db.query(ProjectMember).filter_by(project_id=project_id, user_id=user.id).one_or_none()
    if member is None or ROLES[member.role] < ROLES[min_role]:
        raise CodedHTTPException(403, ERR_ROLE_REQUIRED, f"requires {min_role} role", {"role": min_role})
    return project
