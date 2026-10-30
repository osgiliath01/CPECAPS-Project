from datetime import datetime, timezone
from sqlalchemy import JSON, Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, text
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
