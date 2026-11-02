"""The signed-in user's own profile: profile picture and full name.

- Anyone can upload or remove their own picture. Pictures are only served to signed-in users.
- Staff ask for a name change and an admin approves or rejects it (with an optional note).
  Admins change their own name directly. Every change is written to the Activity Log."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

import activity
import database
import models
import security

router = APIRouter(tags=["Profile"])

MAX_AVATAR_BYTES = 1024 * 1024  # the app shrinks pictures to about 30 KB before uploading
_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


# ---------- Schemas ----------

class NameRequestOut(BaseModel):
    id: int
    current_name: str
    new_name: str
    status: str
    reviewed_by: Optional[str]
    review_note: Optional[str]
    created_at: datetime
    reviewed_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


class ProfileOut(BaseModel):
    id: int
    username: str
    name: str
    is_superuser: bool
    is_active: bool
    created_at: datetime
    avatar_version: Optional[str]          # changes whenever the picture changes; None = no picture
    name_request: Optional[NameRequestOut]  # the latest name-change request, if any


class NameChange(BaseModel):
    new_name: str = Field(..., min_length=3, max_length=50)


class NameChangeResult(BaseModel):
    applied: bool
    detail: str


class PendingNameRequest(BaseModel):
    id: int
    user_id: int
    username: str
    current_name: str
    new_name: str
    created_at: datetime
    avatar_version: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ReviewNote(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


# ---------- Helpers ----------

def _image_type(data: bytes) -> Optional[str]:
    """The real type from the file's first bytes (the name or browser's label can lie)."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _clean_name(value: str) -> str:
    return " ".join((value or "").split())


def _latest_name_request(db: Session, user_id: int) -> Optional[models.NameChangeRequest]:
    return (
        db.query(models.NameChangeRequest)
        .filter(models.NameChangeRequest.user_id == user_id)
        .order_by(models.NameChangeRequest.created_at.desc(), models.NameChangeRequest.id.desc())
        .first()
    )


# ---------- Own profile ----------

@router.get("/me/profile", response_model=ProfileOut)
def my_profile(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """The signed-in user's profile, including their latest name-change request."""
    changed = (
        db.query(models.UserAvatar.updated_at)
        .filter(models.UserAvatar.user_id == current_user.id)
        .scalar()
    )
    return {
        "id": current_user.id,
        "username": current_user.username,
        "name": current_user.name,
        "is_superuser": current_user.is_superuser,
        "is_active": current_user.is_active,
        "created_at": current_user.created_at,
        "avatar_version": changed.isoformat() if changed else None,
        "name_request": _latest_name_request(db, current_user.id),
    }


@router.put("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Sets the signed-in user's profile picture (JPEG, PNG or WebP, up to 1 MB)."""
    data = file.file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The picture is too large (1 MB at most).")
    kind = _image_type(data)
    if kind not in _IMAGE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Use a JPEG, PNG or WebP picture.")

    row = db.get(models.UserAvatar, current_user.id)
    if row is None:
        row = models.UserAvatar(user_id=current_user.id)
        db.add(row)
    row.content, row.content_type = data, kind
    row.updated_at = datetime.now(timezone.utc)
    activity.log(db, current_user.username, "avatar_change", f"'{current_user.username}' changed their profile picture",
                 "user", current_user.id)
    db.commit()
    return None


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
def remove_avatar(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    row = db.get(models.UserAvatar, current_user.id)
    if row is not None:
        db.delete(row)
        activity.log(db, current_user.username, "avatar_change",
                     f"'{current_user.username}' removed their profile picture", "user", current_user.id)
        db.commit()
    return None


@router.get("/avatars/{user_id}")
def get_avatar(
    user_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """A user's profile picture. Signed-in users only; the app asks with ?v=<avatar_version>,
    so the browser may keep it for a day."""
    row = db.get(models.UserAvatar, user_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No picture")
    return Response(row.content, media_type=row.content_type,
                    headers={"Cache-Control": "private, max-age=86400"})


@router.post("/me/name", response_model=NameChangeResult)
def change_my_name(
    payload: NameChange,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Admins: changes their name right away. Staff: sends a request for an admin to approve
    (replacing any request of theirs still waiting)."""
    new_name = _clean_name(payload.new_name)
    if len(new_name) < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The name must be at least 3 characters.")
    if new_name == current_user.name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That's already your name.")

    if current_user.is_superuser:
        old = current_user.name
        current_user.name = new_name
        activity.log(db, current_user.username, "name_change", f"Changed own name from '{old}' to '{new_name}'",
                     "user", current_user.id, {"name": [old, new_name]})
        db.commit()
        return {"applied": True, "detail": "Name changed."}

    pending = (
        db.query(models.NameChangeRequest)
        .filter_by(user_id=current_user.id, status="pending")
        .with_for_update()
        .first()
    )
    if pending:
        pending.new_name = new_name
        pending.created_at = datetime.now(timezone.utc)
    else:
        db.add(models.NameChangeRequest(user_id=current_user.id, username=current_user.username,
                                        current_name=current_user.name, new_name=new_name))
    activity.log(db, current_user.username, "name_requested",
                 f"'{current_user.username}' asked to change their name from '{current_user.name}' to '{new_name}'",
                 "user", current_user.id, {"name": [current_user.name, new_name]})
    db.commit()
    return {"applied": False, "detail": "Request sent. Your name changes once an admin approves it."}


@router.delete("/me/name", status_code=status.HTTP_204_NO_CONTENT)
def cancel_my_name_request(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Withdraws the signed-in user's name-change request that's still waiting."""
    pending = db.query(models.NameChangeRequest).filter_by(user_id=current_user.id, status="pending").first()
    if pending:
        db.delete(pending)
        activity.log(db, current_user.username, "name_request_cancelled",
                     f"'{current_user.username}' withdrew their name-change request", "user", current_user.id)
        db.commit()
    return None


# ---------- My Activity and sign-in security ----------

class ActivityItem(BaseModel):
    id: int
    created_at: datetime
    actor: str
    action: str
    summary: str
    by_me: bool


class ActivityPage(BaseModel):
    total: int
    items: List[ActivityItem]


@router.get("/me/activity", response_model=ActivityPage)
def my_activity(
    page: int = 1,
    size: int = 20,
    signins: bool = True,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """What the signed-in user did, plus what admins did to their account (password reset,
    name approved...), newest first. Questions to the assistant aren't included."""
    size = max(1, min(size, 50))
    page = max(1, page)
    log = models.ActivityLog
    q = db.query(log).filter(
        or_(log.actor == current_user.username, and_(log.entity_type == "user", log.entity_id == current_user.id)),
        log.action != "chat",
    )
    if not signins:  # routine sign-ins and sign-outs hidden (wrong passwords still show)
        q = q.filter(log.action.notin_(("login", "logout", "login_challenge", "login_challenge_cancelled")))
    total = q.count()
    rows = q.order_by(log.created_at.desc(), log.id.desc()).offset((page - 1) * size).limit(size).all()
    return {
        "total": total,
        "items": [
            {"id": r.id, "created_at": r.created_at, "actor": r.actor, "action": r.action,
             "summary": r.summary, "by_me": r.actor == current_user.username}
            for r in rows
        ],
    }


class SecurityInfo(BaseModel):
    previous_sign_in: Optional[datetime]   # the sign-in before this one
    failed_since_previous: int             # wrong passwords for this username since then
    failed_last_30_days: int
    last_failed_at: Optional[datetime]
    password_changed_at: Optional[datetime]
    password_change_kind: Optional[str]    # password_change | reset_approved | admin_reset
    locked_minutes: int                    # > 0 while sign-in is locked after wrong passwords


@router.get("/me/security", response_model=SecurityInfo)
def my_security(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Sign-in history for the signed-in user, from the Activity Log."""
    log = models.ActivityLog
    logins = (
        db.query(log.created_at)
        .filter(log.actor == current_user.username, log.action == "login")
        .order_by(log.created_at.desc())
        .limit(2)
        .all()
    )
    previous = logins[1][0] if len(logins) > 1 else None
    failed = db.query(log.created_at).filter(log.actor == current_user.username, log.action == "login_failed")
    month_ago = datetime.now(timezone.utc) - timedelta(days=30)
    password = (
        db.query(log.created_at, log.action)
        .filter(log.entity_type == "user", log.entity_id == current_user.id,
                log.action.in_(("password_change", "reset_approved", "admin_reset")))
        .order_by(log.created_at.desc())
        .first()
    )
    return {
        "previous_sign_in": previous,
        "failed_since_previous": failed.filter(log.created_at > previous).count() if previous else 0,
        "failed_last_30_days": failed.filter(log.created_at > month_ago).count(),
        "last_failed_at": db.query(func.max(log.created_at))
        .filter(log.actor == current_user.username, log.action == "login_failed").scalar(),
        "password_changed_at": password[0] if password else None,
        "password_change_kind": password[1] if password else None,
        "locked_minutes": security.login_locked_minutes(db, current_user.username),
    }


@router.post("/me/sign-out-everywhere", status_code=status.HTTP_204_NO_CONTENT)
def sign_out_everywhere(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Ends every session of this account, on every device (this one too)."""
    current_user.token_version = (current_user.token_version or 0) + 1
    current_user.session_id = None  # so signing in again doesn't wait for an answer
    activity.log(db, current_user.username, "signed_out_everywhere",
                 f"'{current_user.username}' signed out on all devices", "user", current_user.id)
    db.commit()
    return None


# ---------- My stats ----------

MANILA = timezone(timedelta(hours=8))


class MyStats(BaseModel):
    month_label: str                  # e.g. "November 2026"
    entries_this_month: int
    amount_this_month: Decimal
    entries_total: int
    amount_total: Decimal
    projects_total: int               # projects with at least one of your entries
    edits_this_month: int             # entries you edited (admins) or asked to edit (staff)
    requests_pending: int
    requests_approved: int
    requests_rejected: int
    reviews_this_month: Optional[int] = None   # admins: requests you approved or rejected


@router.get("/me/stats", response_model=MyStats)
def my_stats(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Numbers for the signed-in user's own work. Entries count while they're active (not
    archived); "this month" follows Philippine time."""
    now = datetime.now(MANILA)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    username = current_user.username
    d = models.Disbursement
    mine = [
        or_(d.created_by == username, d.created_by.like(f"{username} | %")),  # older data: "username | Name"
        d.is_archived.is_(False),
    ]

    def count_and_total(*extra):
        n, total = (
            db.query(func.count(d.id), func.coalesce(func.sum(d.amount), 0))
            .join(models.Project, models.Project.id == d.project_id)
            .filter(*mine, models.Project.is_archived.is_(False), *extra)
            .one()
        )
        return n, total

    month_n, month_total = count_and_total(d.created_at >= month_start)
    all_n, all_total = count_and_total()
    projects = (
        db.query(func.count(func.distinct(d.project_id)))
        .join(models.Project, models.Project.id == d.project_id)
        .filter(*mine, models.Project.is_archived.is_(False))
        .scalar()
    ) or 0

    log = models.ActivityLog
    edits = (
        db.query(func.count(log.id))
        .filter(log.actor == username, log.action.in_(("update", "edit_requested")), log.created_at >= month_start)
        .scalar()
    )
    req = models.DeletionRequest
    by_status = dict(
        db.query(req.status, func.count(req.id)).filter(req.requested_by == username).group_by(req.status).all()
    )
    reviews = None
    if current_user.is_superuser:
        reviews = (
            db.query(func.count(req.id))
            .filter(req.reviewed_by == username, req.reviewed_at >= month_start)
            .scalar()
        )
    return {
        "month_label": now.strftime("%B %Y"),
        "entries_this_month": month_n,
        "amount_this_month": month_total,
        "entries_total": all_n,
        "amount_total": all_total,
        "projects_total": projects,
        "edits_this_month": edits or 0,
        "requests_pending": by_status.get("pending", 0),
        "requests_approved": by_status.get("approved", 0),
        "requests_rejected": by_status.get("rejected", 0),
        "reviews_this_month": reviews,
    }


# ---------- Review (admins only) ----------

@router.get("/name-requests", response_model=List[PendingNameRequest])
def list_name_requests(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: name changes waiting for approval, oldest first."""
    rows = (
        db.query(models.NameChangeRequest, models.UserAvatar.updated_at)
        .outerjoin(models.UserAvatar, models.UserAvatar.user_id == models.NameChangeRequest.user_id)
        .filter(models.NameChangeRequest.status == "pending")
        .order_by(models.NameChangeRequest.created_at)
        .all()
    )
    return [
        {**{f: getattr(r, f) for f in ("id", "user_id", "username", "current_name", "new_name", "created_at")},
         "avatar_version": pic.isoformat() if pic else None}
        for r, pic in rows
    ]


def _get_pending(db: Session, request_id: int, admin: models.User) -> models.NameChangeRequest:
    req = db.get(models.NameChangeRequest, request_id, with_for_update=True)  # two admins can't both decide
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    if req.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"This request was already {req.status}.")
    if req.user_id == admin.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't review your own request.")
    return req


def _decide(req: models.NameChangeRequest, admin: models.User, new_status: str, payload: Optional[ReviewNote]):
    req.status = new_status
    req.reviewed_by = admin.username
    req.reviewed_at = datetime.now(timezone.utc)
    note = (payload.note or "").strip() if payload else ""
    req.review_note = note or None


@router.post("/name-requests/{request_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
def approve_name_request(
    request_id: int,
    payload: Optional[ReviewNote] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    req = _get_pending(db, request_id, current_user)
    user = db.get(models.User, req.user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That account no longer exists.")
    old = user.name
    user.name = req.new_name
    _decide(req, current_user, "approved", payload)
    activity.log(db, current_user.username, "name_approved",
                 f"Approved name change for '{user.username}': '{old}' to '{req.new_name}'",
                 "user", user.id, {"name": [old, req.new_name], "note": req.review_note})
    db.commit()
    return None


@router.post("/name-requests/{request_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
def reject_name_request(
    request_id: int,
    payload: Optional[ReviewNote] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    req = _get_pending(db, request_id, current_user)
    _decide(req, current_user, "rejected", payload)
    activity.log(db, current_user.username, "name_rejected",
                 f"Rejected name change for '{req.username}' to '{req.new_name}'",
                 "user", req.user_id, {"note": req.review_note})
    db.commit()
    return None
