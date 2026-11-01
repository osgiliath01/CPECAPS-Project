"""One signed-in device per account.

Signing in while the account is open on another device doesn't kick that device out
straight away. Instead:

1. The new device gets {"status": "waiting", challenge_id, secret} from /token, and checks
   back every couple of seconds (POST /auth/login-challenges/{id}/status).
2. The device that's signed in is told through its live connection and asked to Allow or
   Block. Allow signs it out and lets the new device in; Block refuses the new device.
3. If the signed-in device is no longer there (tab closed, computer asleep or offline: no
   sign of life from its live connection for SESSION_STALE_SECONDS), the new device gets in
   without asking. If it's there but nobody answers, the new device keeps waiting; after
   CHALLENGE_SECONDS the attempt ends and it can try again.

Signing out ends the session, so signing in elsewhere afterwards needs no approval.
Usernames in SINGLE_SESSION_EXEMPT (e.g. load-test accounts) can be signed in many times."""
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

import activity
import database
import models
import security

router = APIRouter(tags=["Authentication"])

SESSION_STALE_SECONDS = 75   # no sign of life for this long: the device counts as gone
TOUCH_SECONDS = 30           # how often an open live connection reports that the device is there
CHALLENGE_SECONDS = 180      # how long a new device waits for an answer
CHALLENGE_LIMIT = 3         # at most this many sign-in attempts from other devices...
CHALLENGE_LIMIT_MINUTES = 5  # ...per account in this many minutes
ABANDONED_SECONDS = 12       # the new device checks every 2 s; silent this long = it gave up (tab closed)
# A sign-in lasts this long without activity. While the person is using the app, the app
# renews it in the background (POST /auth/refresh), so only idle sessions expire.
TOKEN_MINUTES = int(os.getenv("SESSION_IDLE_MINUTES", "30"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(moment: Optional[datetime]) -> Optional[datetime]:
    if moment is not None and moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def session_is_live(user: models.User) -> bool:
    """True if another device is signed in and was seen recently."""
    seen = _aware(user.session_seen_at)
    return bool(user.session_id and seen and (_now() - seen).total_seconds() < SESSION_STALE_SECONDS)


def start_session(user: models.User) -> Optional[str]:
    """Makes this sign-in the account's only session. None if the rule doesn't apply."""
    if not security.single_session_applies(user):
        return None
    user.session_id = secrets.token_urlsafe(16)
    user.session_seen_at = _now()
    return user.session_id


def issue_token(user: models.User, sid: Optional[str]) -> str:
    data = {
        "sub": user.username,
        "name": user.name,
        "is_superuser": user.is_superuser,
        "must_change_password": user.must_change_password,
        "tv": user.token_version or 0,  # see "Sign out on all devices"
        "iat": int(time.time()),        # issued at: lets the app time the session on its own clock
    }
    if sid:
        data["sid"] = sid
    return security.create_access_token(data=data, expires_delta=timedelta(minutes=TOKEN_MINUTES))


def touch(db: Session, user_id: int, sid: Optional[str]) -> None:
    """Notes that the device with this session is still there (called by the live connection)."""
    if not sid:
        return
    db.query(models.User).filter(models.User.id == user_id, models.User.session_id == sid).update(
        {models.User.session_seen_at: _now()}, synchronize_session=False
    )


def describe_device(user_agent: str) -> str:
    """A short, readable device name from the browser's User-Agent, e.g. "Chrome on Windows"."""
    ua = user_agent or ""
    browser = next((name for pattern, name in [
        (r"Edg/", "Edge"), (r"OPR/|Opera", "Opera"), (r"Firefox/", "Firefox"),
        (r"Chrome/", "Chrome"), (r"Safari/", "Safari"),
    ] if re.search(pattern, ua)), "A browser")
    system = next((name for pattern, name in [
        (r"Android", "Android"), (r"iPhone|iPad|iPod", "iPhone/iPad"), (r"Windows", "Windows"),
        (r"Mac OS X|Macintosh", "Mac"), (r"CrOS", "Chromebook"), (r"Linux", "Linux"),
    ] if re.search(pattern, ua)), "an unknown device")
    return f"{browser} on {system}"


def too_many_challenges(db: Session, user: models.User) -> bool:
    """True if this account had CHALLENGE_LIMIT sign-in attempts from other devices lately, so
    nobody can flood the signed-in person with prompts (or the Activity Log with entries)."""
    since = _now() - timedelta(minutes=CHALLENGE_LIMIT_MINUTES)
    recent = (
        db.query(models.LoginChallenge.id)
        .filter(models.LoginChallenge.user_id == user.id, models.LoginChallenge.created_at > since)
        .count()
    )
    return recent >= CHALLENGE_LIMIT


def create_challenge(db: Session, user: models.User, user_agent: str) -> models.LoginChallenge:
    challenge = models.LoginChallenge(user_id=user.id, secret=secrets.token_urlsafe(24),
                                      device=describe_device(user_agent)[:120], polled_at=_now())
    db.add(challenge)
    db.flush()
    activity.log(db, user.username, "login_challenge",
                 f"Sign-in to '{user.username}' from another device ({challenge.device}) is waiting for approval",
                 "user", user.id, {"challenge_id": challenge.id, "device": challenge.device})
    return challenge


def _expired(challenge: models.LoginChallenge) -> bool:
    """Over: waited too long, or the new device stopped checking back (e.g. its tab was closed)."""
    if (_now() - _aware(challenge.created_at)).total_seconds() > CHALLENGE_SECONDS:
        return True
    polled = _aware(challenge.polled_at) or _aware(challenge.created_at)
    return (_now() - polled).total_seconds() > ABANDONED_SECONDS


# ---------- The new device ----------

class ChallengeSecret(BaseModel):
    secret: str


def _get_challenge(db: Session, challenge_id: int, secret: str) -> models.LoginChallenge:
    challenge = db.get(models.LoginChallenge, challenge_id, with_for_update=True)
    if not challenge or not secrets.compare_digest(challenge.secret, secret or ""):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This sign-in attempt wasn't found. Sign in again.")
    return challenge


@router.post("/auth/login-challenges/{challenge_id}/status")
def challenge_status(challenge_id: int, payload: ChallengeSecret, db: Session = Depends(database.get_db)):
    """The waiting device checks back. Returns {"status": "waiting" | "denied" | "expired"},
    or {"status": "approved", "access_token": ...} once it may sign in."""
    challenge = _get_challenge(db, challenge_id, payload.secret)
    user = db.get(models.User, challenge.user_id, with_for_update=True)
    if not user or not user.is_active or not user.is_approved:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account can't sign in.")

    if challenge.status == "pending":
        challenge.polled_at = _now()  # the new device is still waiting
        if not session_is_live(user):
            challenge.status = "allowed"  # the other device has gone: no one left to ask
            challenge.decided_at = _now()
        elif (_now() - _aware(challenge.created_at)).total_seconds() > CHALLENGE_SECONDS:
            challenge.status = "expired"
            db.commit()
            return {"status": "expired"}
        else:
            db.commit()
            left = CHALLENGE_SECONDS - (_now() - _aware(challenge.created_at)).total_seconds()
            return {"status": "waiting", "expires_in": max(0, int(left))}

    if challenge.status == "allowed":
        challenge.status = "used"
        token = issue_token(user, start_session(user))
        activity.log(db, user.username, "login", f"'{user.username}' signed in ({challenge.device})",
                     "user", user.id)
        db.commit()
        return {"status": "approved", "access_token": token, "token_type": "bearer"}

    db.commit()
    return {"status": "denied" if challenge.status == "denied" else "expired"}


@router.post("/auth/login-challenges/{challenge_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
def cancel_challenge(challenge_id: int, payload: ChallengeSecret, db: Session = Depends(database.get_db)):
    """The waiting device gives up."""
    challenge = _get_challenge(db, challenge_id, payload.secret)
    if challenge.status == "pending":
        challenge.status = "cancelled"
        challenge.decided_at = _now()
        # Not written to the Activity Log (repeated tries would flood it); the signed-in
        # device's prompt rechecks every few seconds and closes by itself
        db.commit()
    return None


# ---------- The signed-in device ----------

class PendingChallenge(BaseModel):
    id: int
    device: Optional[str]
    created_at: datetime
    expires_in: int


@router.get("/me/login-challenges", response_model=List[PendingChallenge])
def my_login_challenges(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user_allow_temporary),
):
    """Sign-ins from other devices waiting for this device's answer."""
    rows = (
        db.query(models.LoginChallenge)
        .filter_by(user_id=current_user.id, status="pending")
        .order_by(models.LoginChallenge.created_at)
        .all()
    )
    out = []
    for c in rows:
        if _expired(c):  # waited too long, or the new device gave up without cancelling
            c.status = "expired"
            continue
        left = CHALLENGE_SECONDS - (_now() - _aware(c.created_at)).total_seconds()
        out.append({"id": c.id, "device": c.device, "created_at": c.created_at, "expires_in": int(left)})
    db.commit()
    return out


def _decide(db: Session, challenge_id: int, user: models.User, allow: bool) -> None:
    challenge = db.get(models.LoginChallenge, challenge_id, with_for_update=True)
    if not challenge or challenge.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    if challenge.status != "pending" or _expired(challenge):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That sign-in attempt has already ended.")
    challenge.status = "allowed" if allow else "denied"
    challenge.decided_at = _now()
    if allow:
        user.session_id = None  # this device signs out; the new one starts its own session
    activity.log(db, user.username, "login_challenge_allowed" if allow else "login_challenge_denied",
                 f"'{user.username}' {'allowed' if allow else 'blocked'} a sign-in from {challenge.device}",
                 "user", user.id, {"challenge_id": challenge.id, "device": challenge.device})
    db.commit()


@router.post("/me/login-challenges/{challenge_id}/allow", status_code=status.HTTP_204_NO_CONTENT)
def allow_login(
    challenge_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user_allow_temporary),
):
    """Lets the other device in. This device is signed out."""
    _decide(db, challenge_id, current_user, allow=True)
    return None


@router.post("/me/login-challenges/{challenge_id}/deny", status_code=status.HTTP_204_NO_CONTENT)
def deny_login(
    challenge_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user_allow_temporary),
):
    """Blocks the other device. This device stays signed in."""
    _decide(db, challenge_id, current_user, allow=False)
    return None


@router.post("/auth/refresh")
def refresh_token(
    token: str = Depends(security.oauth2_scheme),
    current_user: models.User = Depends(security.get_current_user_allow_temporary),
):
    """Swaps a sign-in that's still valid for a fresh one (same device session), so someone
    who keeps using the app isn't signed out. The app calls it only after real activity
    (clicks, typing, scrolling); an idle session is left to expire. An expired, replaced
    or signed-out token is refused (401) like everywhere else."""
    claims = security.token_claims(token)
    return {"access_token": issue_token(current_user, claims.get("sid")), "token_type": "bearer"}


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    token: str = Depends(security.oauth2_scheme),
    db: Session = Depends(database.get_db),
):
    """Ends this device's session, so the account can be signed in elsewhere without asking.
    Does nothing if the session had already ended."""
    claims = security.token_claims(token)
    sid, username = claims.get("sid"), claims.get("sub")
    if sid and username:
        user = db.query(models.User).filter(models.User.username == username).first()
        if user and user.session_id == sid:
            user.session_id = None
            activity.log(db, user.username, "logout", f"'{user.username}' signed out", "user", user.id)
            db.commit()
    return None
