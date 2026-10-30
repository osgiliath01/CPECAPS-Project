import datetime as dt
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator


# ==========================================
# PROJECT SCHEMAS
# ==========================================


class ProjectCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)


class ProjectResponse(BaseModel):
    id: int
    title: str
    total_amount: Decimal
    entry_count: int = 0  # includes archived entries

    model_config = ConfigDict(from_attributes=True)


# ==========================================
# DISBURSEMENT SCHEMAS
# ==========================================


class DisbursementCreate(BaseModel):
    project_title: str
    cv_no: str
    payee: str
    date: date
    amount: Decimal


class DisbursementUpdate(BaseModel):
    date: Optional[dt.date] = None
    cv_no: Optional[str] = None
    payee: Optional[str] = None
    amount: Optional[Decimal] = None
    editor_name: str


class DisbursementItemResponse(BaseModel):
    id: int
    date: date
    payee: str
    cv_no: str
    amount: Decimal
    created_at: datetime
    updated_at: datetime
    created_by: str
    updated_by: str

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at", "updated_at")
    def serialize_ph_time(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        try:
            ph_tz = ZoneInfo("Asia/Manila")
        except ZoneInfoNotFoundError:
            ph_tz = timezone(timedelta(hours=8))

        # Converts UTC DB timestamp to Manila timezone preserving +08:00 offset
        ph_dt = dt.astimezone(ph_tz)
        return ph_dt.isoformat(timespec="seconds")


class ProjectSummaryResponse(BaseModel):
    project_title: str
    entries: List[DisbursementItemResponse]
    total_amount: Decimal

    model_config = ConfigDict(from_attributes=True)


# ==========================================
# USER & AUTH SCHEMAS
# ==========================================


class UserCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=50)
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: int
    name: str
    username: str
    is_active: bool
    is_superuser: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PasswordChangeSchema(BaseModel):
    old_password: str = Field(..., min_length=1, description="Current active password")
    new_password: str = Field(
        ..., min_length=8, max_length=128, description="New password (min 8 chars)"
    )
    confirm_password: str = Field(
        ..., min_length=8, max_length=128, description="Must match new_password exactly"
    )

    @model_validator(mode="after")
    def validate_password_change(self) -> "PasswordChangeSchema":
        if self.new_password != self.confirm_password:
            raise ValueError("New password and confirmation password do not match.")
        if self.old_password == self.new_password:
            raise ValueError("New password must be different from the current password.")
        return self


# ==========================================
# JWT TOKEN SCHEMAS
# ==========================================


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: Optional[str] = None