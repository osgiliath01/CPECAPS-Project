from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

import database
import models

SECRET_KEY = "super_caic1234"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


# ==========================================
# Password Utilities (Native Bcrypt)
# ==========================================


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies plain password against stored hash with 72-byte truncation safety."""
    password_bytes = plain_password.encode("utf-8")[:72]
    hashed_bytes = hashed_password.encode("utf-8")
    return bcrypt.checkpw(password_bytes, hashed_bytes)


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
    if not user.is_active:
        # 401 so the app signs a deactivated user out straight away
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has been deactivated.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

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