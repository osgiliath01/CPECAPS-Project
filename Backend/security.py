import math
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func
from sqlalchemy.orm import Session

import database
import models

# The key that signs sign-in tokens. Anyone who knows it can make a token for any account,
# including an admin, so it is never written in the code: it comes from Backend/.env
# (JWT_SECRET_KEY), which is not committed. Changing it signs everyone out once.
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "").strip()
if len(SECRET_KEY) < 32:
    # Only for running the backend by hand on a developer's laptop (uvicorn ... --reload).
    # Docker Compose refuses to start without a real key, so the server never uses this.
    print("WARNING: JWT_SECRET_KEY is not set (or too short); using an insecure development key.")
    SECRET_KEY = "development-only-key-not-for-the-server-0000"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Sign-in protection: after this many wrong passwords for one username, that username can't
# sign in for LOGIN_LOCK_MINUTES (counted from the oldest of those wrong tries). A successful
# sign-in starts the count again. Uses the login_failed rows already in the Activity Log, so it
# works the same across all backend processes.
LOGIN_MAX_FAILURES = int(os.getenv("LOGIN_MAX_FAILURES", "5"))
LOGIN_LOCK_MINUTES = int(os.getenv("LOGIN_LOCK_MINUTES", "15"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


# ==========================================
# Password Utilities (Native Bcrypt)
# ==========================================


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies plain password against stored hash with 72-byte truncation safety."""
    password_bytes = plain_password.encode("utf-8")[:72]
    hashed_bytes = hashed_password.encode("utf-8")
    return bcrypt.checkpw(password_bytes, hashed_bytes)


def login_locked_minutes(db: Session, username: str) -> int:
    """Minutes until this username may try again after too many wrong passwords, else 0."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=LOGIN_LOCK_MINUTES)
    last_ok = (
        db.query(func.max(models.ActivityLog.created_at))
        .filter(models.ActivityLog.actor == username, models.ActivityLog.action == "login")
        .scalar()
    )
    if last_ok is not None:
        if last_ok.tzinfo is None:
            last_ok = last_ok.replace(tzinfo=timezone.utc)
        since = max(since, last_ok)
    recent = (
        db.query(models.ActivityLog.created_at)
        .filter(
            models.ActivityLog.actor == username,
            models.ActivityLog.action == "login_failed",
            models.ActivityLog.created_at > since,
        )
        .order_by(models.ActivityLog.created_at.desc())
        .limit(LOGIN_MAX_FAILURES)
        .all()
    )
    if len(recent) < LOGIN_MAX_FAILURES:
        return 0
    oldest = recent[-1][0]
    if oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=timezone.utc)
    seconds = (oldest + timedelta(minutes=LOGIN_LOCK_MINUTES) - now).total_seconds()
    return max(1, math.ceil(seconds / 60)) if seconds > 0 else 0


def get_password_hash(password: str) -> str:
    """Hashes password using native bcrypt."""
    password_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password_bytes, salt).decode("utf-8")


# ==========================================
# JWT Utilities & Current User Dependency
# ==========================================


def create_access_token(
    data: dict, expires_delta: Optional[timedelta] = None
) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user_allow_temporary(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(database.get_db),
) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: Optional[str] = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    user = (
        db.query(models.User).filter(models.User.username == username).first()
    )
    if user is None:
        raise credentials_exception
    if not user.is_active or not user.is_approved:
        # 401 so the app signs a deactivated user out straight away
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has been deactivated.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    _check_token_version(payload, user)
    return user


def _check_token_version(payload: dict, user: models.User) -> None:
    """Refuses tokens made before the user chose "Sign out on all devices"."""
    if int(payload.get("tv", 0) or 0) != (user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="You were signed out on all devices. Sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

def get_current_user(
    user: models.User = Depends(get_current_user_allow_temporary),
) -> models.User:
    """The signed-in user. Someone still on a temporary password (after an admin-approved
    reset) can only change their password until they set a new one."""
    if user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Set a new password first. You're still using a temporary one.",
        )
    return user


def user_from_token(token: str) -> models.User:
    """Checks a sign-in token using a short database session that is closed straight away.

    For streaming routes (/live, /chat). With Depends(get_current_user), FastAPI keeps the
    database session, and its connection, open until the response ends: for a live-updates
    stream that's as long as the browser tab is open, so ~30 open tabs used up every database
    connection and the whole app stalled. Same checks as get_current_user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: Optional[str] = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    db = database.SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.username == username).first()
        if user is None:
            raise credentials_exception
        if not user.is_active or not user.is_approved:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="This account has been deactivated.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        _check_token_version(payload, user)
        if user.must_change_password:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Set a new password first. You're still using a temporary one.",
            )
        db.expunge(user)  # keep using its loaded fields after the session is closed
        return user
    finally:
        db.close()


def get_current_superuser(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """Lets the request through only if the logged-in user is a superuser."""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can do this.",
        )
    return current_user