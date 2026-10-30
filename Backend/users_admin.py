"""User management for admins: list accounts, rename, change role, deactivate,
reset passwords and delete. Every change is written to the Activity Log."""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

import activity
import database
import models
import password_resets
import security

router = APIRouter(prefix="/users", tags=["User Management"])


class ManagedUser(BaseModel):
    id: int
    name: str
    username: str
    is_active: bool
    is_superuser: bool
    must_change_password: bool
    created_at: datetime
    last_login: Optional[datetime]


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=3, max_length=50)
    is_active: Optional[bool] = None
    is_superuser: Optional[bool] = None


class TemporaryPassword(BaseModel):
    username: str
    temporary_password: str


def _get_user(db: Session, user_id: int) -> models.User:
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


def _other_active_admins(db: Session, user: models.User) -> int:
    return (
        db.query(models.User)
        .filter(models.User.is_superuser.is_(True), models.User.is_active.is_(True), models.User.id != user.id)
        .count()
    )


def _guard_last_admin(db: Session, user: models.User, action: str) -> None:
    if user.is_superuser and user.is_active and _other_active_admins(db, user) == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Can't {action} the last active admin. Make someone else an admin first.",
        )


@router.get("", response_model=List[ManagedUser])
def list_users(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: every account, with its last sign-in."""
    last_logins = dict(
        db.query(models.ActivityLog.actor, func.max(models.ActivityLog.created_at))
        .filter(models.ActivityLog.action == "login")
        .group_by(models.ActivityLog.actor)
        .all()
    )
    users = db.query(models.User).order_by(models.User.name).all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "username": u.username,
            "is_active": u.is_active,
            "is_superuser": u.is_superuser,
            "must_change_password": u.must_change_password,
            "created_at": u.created_at,
            "last_login": last_logins.get(u.username),
        }
        for u in users
    ]


@router.patch("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: rename, change role, or deactivate/reactivate an account."""
    user = _get_user(db, user_id)
    is_self = user.id == current_user.id
    changes = {}

    if payload.name is not None and payload.name.strip() != user.name:
        changes["name"] = [user.name, payload.name.strip()]
        user.name = payload.name.strip()

    if payload.is_superuser is not None and payload.is_superuser != user.is_superuser:
        if not payload.is_superuser:
            if is_self:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't remove your own admin role.")
            _guard_last_admin(db, user, "remove admin from")
        changes["admin"] = [user.is_superuser, payload.is_superuser]
        user.is_superuser = payload.is_superuser

    if payload.is_active is not None and payload.is_active != user.is_active:
        if not payload.is_active:
            if is_self:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't deactivate your own account.")
            _guard_last_admin(db, user, "deactivate")
        changes["active"] = [user.is_active, payload.is_active]
        user.is_active = payload.is_active

    if not changes:
        return None

    what = []
    if "admin" in changes:
        what.append("made admin" if user.is_superuser else "removed admin role")
    if "active" in changes:
        what.append("reactivated" if user.is_active else "deactivated")
    if "name" in changes:
        what.append("renamed")
    activity.log(db, current_user.username, "user_update",
                 f"Updated account '{user.username}': {', '.join(what)}", "user", user.id,
                 {"changes": changes})
    db.commit()
    return None


@router.post("/{user_id}/reset-password", response_model=TemporaryPassword)
def admin_reset_password(
    user_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: gives the account a temporary password (returned ONCE, never stored
    in plain text). The user must choose a new one at next sign-in."""
    user = _get_user(db, user_id)
    if user.id == current_user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Use Change password for your own account.")

    temporary = password_resets.make_temporary_password()
    user.hashed_password = security.get_password_hash(temporary)
    user.must_change_password = True

    # Any pending forgot-password request for this account is now handled
    for req in db.query(models.PasswordResetRequest).filter_by(user_id=user.id, status="pending").all():
        req.status = "approved"
        req.reviewed_by = current_user.username
        req.reviewed_at = datetime.now(timezone.utc)
        req.review_note = "Reset directly from Manage users."

    activity.log(db, current_user.username, "admin_reset",
                 f"Reset {user.username}'s password from Manage users; they must set a new one at next sign-in",
                 "user", user.id)
    db.commit()
    return {"username": user.username, "temporary_password": temporary}


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: deletes the account permanently. Entries, requests and the Activity Log
    keep the username they were recorded with."""
    user = _get_user(db, user_id)
    if user.id == current_user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't delete your own account.")
    _guard_last_admin(db, user, "delete")

    snapshot = {"name": user.name, "username": user.username, "admin": user.is_superuser,
                "active": user.is_active}
    db.delete(user)
    activity.log(db, current_user.username, "user_delete",
                 f"Deleted account '{snapshot['username']}' ({snapshot['name']})", "user", user_id, snapshot)
    db.commit()
    return None
