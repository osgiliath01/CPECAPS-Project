"""Password resets from the login page, approved by an admin.

1. A user who forgot their password asks for a reset (no sign-in needed).
2. An admin approves it and gets a one-time temporary password to hand over in person.
3. The user signs in with it and must set a new password before using the app.
"""
import secrets
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import activity
import database
import models
import security

router = APIRouter(tags=["Password Resets"])

# No look-alike characters (0/O, 1/l/I), so it's easy to read out or copy by hand
_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def make_temporary_password(length: int = 10) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


class ResetRequestCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    message: Optional[str] = Field(None, max_length=300)


class ReviewNote(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class ResetRequestResponse(BaseModel):
    id: int
    username: str
    name: Optional[str]
    message: Optional[str]
    status: str
    requested_at: datetime
    reviewed_by: Optional[str]
    reviewed_at: Optional[datetime]
    review_note: Optional[str]


class ApprovedReset(BaseModel):
    username: str
    temporary_password: str


def _to_response(req: models.PasswordResetRequest) -> dict:
    return {
        "id": req.id,
        "username": req.username,
        "name": req.user.name if req.user else None,
        "message": req.message,
        "status": req.status,
        "requested_at": req.requested_at,
        "reviewed_by": req.reviewed_by,
        "reviewed_at": req.reviewed_at,
        "review_note": req.review_note,
    }


def _get_pending(db: Session, request_id: int, admin: models.User) -> models.PasswordResetRequest:
    req = db.get(models.PasswordResetRequest, request_id, with_for_update=True)
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reset request not found")
    if req.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"This request was already {req.status}.")
    if req.username == admin.username:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Another admin has to reset your password.")
    return req


def _note(payload: Optional[ReviewNote]) -> Optional[str]:
    return ((payload.note or "").strip() or None) if payload else None


@router.post("/auth/reset-request", status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(payload: ResetRequestCreate, db: Session = Depends(database.get_db)):
    """No sign-in needed. Always gives the same answer, so it can't be used to find out
    which usernames exist."""
    username = payload.username.strip()
    message = (payload.message or "").strip() or None
    user = db.query(models.User).filter(models.User.username == username).first()

    if user and user.is_active:
        pending = (
            db.query(models.PasswordResetRequest)
            .filter_by(user_id=user.id, status="pending")
            .first()
        )
        if not pending:
            db.add(models.PasswordResetRequest(user_id=user.id, username=user.username, message=message))
            activity.log(db, user.username, "reset_requested",
                         f"'{user.username}' asked for a password reset", "user", user.id,
                         {"message": message} if message else None)
            db.commit()
    else:
        activity.log(db, username[:255] or "?", "reset_requested",
                     f"Password reset asked for unknown or inactive username '{username[:100]}'", "user")
        db.commit()

    return {"detail": "If that account exists, an admin will review your request and give you a temporary password."}


@router.get("/password-resets", response_model=List[ResetRequestResponse])
def list_password_resets(
    status_filter: Literal["pending", "approved", "rejected"] = Query("pending", alias="status"),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: password reset requests, pending ones by default."""
    rows = (
        db.query(models.PasswordResetRequest)
        .filter_by(status=status_filter)
        .order_by(models.PasswordResetRequest.requested_at.desc())
        .all()
    )
    return [_to_response(r) for r in rows]


@router.post("/password-resets/{request_id}/approve", response_model=ApprovedReset)
def approve_password_reset(
    request_id: int,
    payload: Optional[ReviewNote] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: sets a temporary password and returns it ONCE. It is never stored
    in plain text or logged. The user must change it at their next sign-in."""
    req = _get_pending(db, request_id, current_user)
    user = req.user
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That account no longer exists. Reject this request.")

    temporary = make_temporary_password()
    user.hashed_password = security.get_password_hash(temporary)
    user.must_change_password = True

    req.status = "approved"
    req.reviewed_by = current_user.username
    req.reviewed_at = datetime.now(timezone.utc)
    req.review_note = _note(payload)
    activity.log(db, current_user.username, "reset_approved",
                 f"Reset {user.username}'s password; they must set a new one at next sign-in",
                 "user", user.id, {"request_id": req.id, "note": req.review_note})
    db.commit()
    return {"username": user.username, "temporary_password": temporary}


@router.post("/password-resets/{request_id}/reject", response_model=ResetRequestResponse)
def reject_password_reset(
    request_id: int,
    payload: Optional[ReviewNote] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: rejects the request. The password stays as it is."""
    req = _get_pending(db, request_id, current_user)
    req.status = "rejected"
    req.reviewed_by = current_user.username
    req.reviewed_at = datetime.now(timezone.utc)
    req.review_note = _note(payload)
    activity.log(db, current_user.username, "reset_rejected",
                 f"Rejected {req.username}'s password reset request", "user", req.user_id,
                 {"request_id": req.id, "note": req.review_note})
    db.commit()
    db.refresh(req)
    return _to_response(req)
