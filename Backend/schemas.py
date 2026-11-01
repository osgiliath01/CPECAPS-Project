import datetime as dt
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_serializer, model_validator


# The amount column is NUMERIC(10, 2): at most 99,999,999.99, with centavos.
Amount = Annotated[Decimal, Field(gt=0, le=Decimal("99999999.99"), decimal_places=2)]
# Text that can't be empty or only spaces (surrounding spaces are removed)
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


# ==========================================
# PROJECT SCHEMAS
# ==========================================


class ProjectCreate(BaseModel):
    title: Text


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
    project_title: Text
    cv_no: Text
    payee: Text
    date: date
    amount: Amount


class DisbursementUpdate(BaseModel):
    date: Optional[dt.date] = None
    cv_no: Optional[Text] = None
    payee: Optional[Text] = None
    amount: Optional[Amount] = None
    editor_name: str
    # The values the editor saw for the fields being changed. If they no longer match,
    # someone else changed the entry first and the edit is refused (409).
    original: Optional[dict] = None


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
    # Full names for the screens (created_by / updated_by keep the stored username)
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None
    created_by_user_id: Optional[int] = None   # with created_by_avatar: the creator's picture
    created_by_avatar: Optional[str] = None

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


class DisbursementListItem(DisbursementItemResponse):
    """An entry with its project, for the Voucher Control list (GET /disbursements/)."""
    project_title: str


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
    is_approved: bool = True
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