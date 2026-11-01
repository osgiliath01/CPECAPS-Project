from datetime import datetime, timezone
from sqlalchemy import JSON, Boolean, Column, Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, text
from sqlalchemy.orm import relationship
from database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, unique=True, index=True, nullable=False)

    # Archived projects (and their entries) are hidden, and deleted for good after 30 days
    is_archived = Column(Boolean, default=False, server_default=text("false"), nullable=False, index=True)
    archived_by = Column(String, nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)

    disbursements = relationship("Disbursement", back_populates="project")

    @property
    def active_disbursements(self) -> list:
        """Entries that are not archived."""
        return [d for d in self.disbursements if not d.is_archived]

    @property
    def entry_count(self) -> int:
        """All entries, archived ones included. Only projects with none can be deleted."""
        return len(self.disbursements)

    @property
    def total_amount(self) -> float:
        # Archived entries don't count toward totals
        return sum(float(d.amount) for d in self.active_disbursements)


class Disbursement(Base):
    __tablename__ = "disbursements"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    payee = Column(String, nullable=False)
    cv_no = Column(String, nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    created_by = Column(String, nullable=False)
    updated_by = Column(String, nullable=False)
    created_at = Column(
    DateTime(timezone=True), 
    default=lambda: datetime.now(timezone.utc), 
    nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Archiving hides an entry. It can be restored for 30 days, then it is deleted for good.
    is_archived = Column(Boolean, default=False, server_default=text("false"), nullable=False, index=True)
    archived_by = Column(String, nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    # True when archived as part of its project, so restoring the project brings it back
    archived_with_project = Column(Boolean, default=False, server_default=text("false"), nullable=False)

    project = relationship("Project", back_populates="disbursements")



# Class for storing users in the database
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    username = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)

    # Security and authorization flags
    is_active = Column(Boolean, default=True, nullable=False)
    is_superuser = Column(Boolean, default=False, nullable=False)
    # Set after an admin-approved reset: the user must pick a new password at next sign-in
    must_change_password = Column(Boolean, default=False, server_default=text("false"), nullable=False)
    # Accounts made through Create account start unapproved and can't sign in until an admin
    # approves them. Accounts made any other way (the first admin) are approved.
    is_approved = Column(Boolean, default=True, server_default=text("true"), nullable=False, index=True)
    # Goes up by one on "Sign out on all devices": every token made before then stops working
    token_version = Column(Integer, default=0, server_default=text("0"), nullable=False)
    # One signed-in device at a time (sessions.py): the current session's id, and when that
    # device was last seen through its live connection
    session_id = Column(String(64), nullable=True)
    session_seen_at = Column(DateTime(timezone=True), nullable=True)

    # Audit fields
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )





class DeletionRequest(Base):
    __tablename__ = "deletion_requests"

    id = Column(Integer, primary_key=True, index=True)
    disbursement_id = Column(
        Integer,
        ForeignKey("disbursements.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Copy of the entry, so the record still makes sense after it's deleted
    project_title = Column(String, nullable=False)
    cv_no = Column(String, nullable=False)
    payee = Column(String, nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)

    request_type = Column(String(20), default="archive", server_default=text("'archive'"), nullable=False, index=True)  # archive | edit
    changes = Column(JSON, nullable=True)  # edit requests: {"fields": {field: [old, new]}, "editor_name": ...}

    reason = Column(String(500), nullable=False)
    status = Column(String(20), default="pending", nullable=False, index=True)  # pending | approved | rejected
    requested_by = Column(String, nullable=False)
    reviewed_by = Column(String, nullable=True)
    review_note = Column(String(500), nullable=True)
    # False once an admin answers, until the requester opens My requests (drives their badge)
    requester_seen = Column(Boolean, default=False, server_default=text("false"), nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    reviewed_at = Column(DateTime(timezone=True), nullable=True)


class ActivityLog(Base):
    """One row per action: who did what, when, and what changed."""
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    actor = Column(String(255), nullable=False, index=True)     # username, or "system"
    action = Column(String(40), nullable=False, index=True)     # e.g. update, archive, restore, login
    entity_type = Column(String(30), nullable=True, index=True)  # disbursement, project, user, deletion_request
    entity_id = Column(Integer, nullable=True)
    summary = Column(String(500), nullable=False)
    details = Column(JSON, nullable=True)                         # before/after values, reasons, etc.


class RateEvent(Base):
    """One sign-up or forgot-password request, kept for a day to limit how often they can happen
    (security.rate_limited)."""
    __tablename__ = "rate_events"

    id = Column(Integer, primary_key=True)
    kind = Column(String(30), nullable=False, index=True)
    ip = Column(String(64), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)


class LoginChallenge(Base):
    """A sign-in from a new device while the account is open on another one. The other
    device is asked to allow or block it; the new device waits with `secret` to collect
    its token."""
    __tablename__ = "login_challenges"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    secret = Column(String(64), nullable=False)
    device = Column(String(120), nullable=True)   # e.g. "Chrome on Android"
    status = Column(String(20), default="pending", nullable=False, index=True)
    # pending | allowed | denied | expired | cancelled | used
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    # Last time the new device checked back; if it stops (tab closed), the attempt has ended
    polled_at = Column(DateTime(timezone=True), nullable=True)


class UserAvatar(Base):
    """A user's profile picture (small square JPEG/PNG/WebP), kept apart from users so the
    picture isn't loaded every time an account is read."""
    __tablename__ = "user_avatars"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    content = Column(LargeBinary, nullable=False)
    content_type = Column(String(30), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class NameChangeRequest(Base):
    """A staff member asking for their full name to be changed; an admin approves or rejects."""
    __tablename__ = "name_change_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    username = Column(String(255), nullable=False)
    current_name = Column(String(255), nullable=False)
    new_name = Column(String(255), nullable=False)
    status = Column(String(20), default="pending", nullable=False, index=True)  # pending | approved | rejected
    reviewed_by = Column(String(255), nullable=True)
    review_note = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)


class PasswordResetRequest(Base):
    """A forgotten-password request from the login page, approved or rejected by an admin."""
    __tablename__ = "password_reset_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    username = Column(String(255), nullable=False)
    message = Column(String(300), nullable=True)
    status = Column(String(20), default="pending", nullable=False, index=True)  # pending | approved | rejected
    requested_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_note = Column(String(500), nullable=True)

    user = relationship("User")
