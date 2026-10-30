"""Activity Log, archiving (soft delete) and the 30-day purge.

- Archiving hides an entry or a whole project (with its entries) from lists and totals.
- Archived items can be restored for RETENTION_DAYS days, then they are deleted permanently.
- Every action, including the purge, is written to the Activity Log, which is kept.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

import database
import models
import security

router = APIRouter(tags=["Activity Log"])

RETENTION_DAYS = 30


# ==========================================
# HELPERS (used by the other route files)
# ==========================================

DISBURSEMENT_FIELDS = ("date", "cv_no", "payee", "amount")


def plain(value: Any) -> Any:
    """Makes a value JSON-friendly so it can be stored in the log."""
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def snapshot(d: models.Disbursement) -> dict:
    """The fields of an entry worth recording, as plain values."""
    data = {f: plain(getattr(d, f)) for f in DISBURSEMENT_FIELDS}
    data["project_title"] = d.project.title if d.project else None
    return data


def diff(before: dict, after: dict) -> dict:
    """Only the fields that changed, as {field: [old, new]}."""
    return {k: [before.get(k), after.get(k)] for k in after if before.get(k) != after.get(k)}


def describe(d: models.Disbursement) -> str:
    project = d.project.title if d.project else "?"
    return f"CV# {d.cv_no} ({d.payee}, PHP {d.amount:,.2f}) in {project}"


def deletes_at(archived_at: Optional[datetime]) -> Optional[datetime]:
    """When an archived item will be deleted permanently."""
    return archived_at + timedelta(days=RETENTION_DAYS) if archived_at else None


def log(
    db: Session,
    actor: str,
    action: str,
    summary: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    details: Optional[dict] = None,
) -> None:
    """Adds one Activity Log row. The caller commits it together with its own changes."""
    db.add(
        models.ActivityLog(
            actor=actor,
            action=action,
            summary=summary[:500],
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
        )
    )


def archive_disbursement(d: models.Disbursement, user: models.User, with_project: bool = False) -> None:
    """Hides an entry from projects and totals. Restorable until it is purged."""
    d.is_archived = True
    d.archived_by = user.username
    d.archived_at = datetime.now(timezone.utc)
    d.archived_with_project = with_project


def _unarchive(item) -> None:
    item.is_archived = False
    item.archived_by = None
    item.archived_at = None


def archive_project(db: Session, project: models.Project, user: models.User) -> None:
    """Archives a project and all its active entries together. Pending requests on those
    entries are rejected automatically, since there is nothing left to approve."""
    active = project.active_disbursements
    total = sum((d.amount for d in active), Decimal("0"))
    for d in active:
        archive_disbursement(d, user, with_project=True)
    project.is_archived = True
    project.archived_by = user.username
    project.archived_at = datetime.now(timezone.utc)

    ids = [d.id for d in project.disbursements]
    if ids:
        pending = (
            db.query(models.DeletionRequest)
            .filter(models.DeletionRequest.disbursement_id.in_(ids),
                    models.DeletionRequest.status == "pending")
            .all()
        )
        for req in pending:
            req.status = "rejected"
            req.reviewed_by = user.username
            req.reviewed_at = datetime.now(timezone.utc)
            req.review_note = "The whole project was archived."
            log(db, user.username, f"{req.request_type}_rejected",
                f"Auto-rejected {req.requested_by}'s {req.request_type} request for CV# {req.cv_no}: project archived",
                "disbursement", req.disbursement_id,
                {"request_id": req.id, "requested_by": req.requested_by, "note": req.review_note})

    log(db, user.username, "project_archive",
        f"Archived project '{project.title}' with {len(active)} entr{'y' if len(active) == 1 else 'ies'} (PHP {total:,.2f})",
        "project", project.id,
        {"title": project.title, "entries": len(active), "total": plain(total)})


def purge_expired(db: Session) -> int:
    """Permanently deletes everything archived more than RETENTION_DAYS ago.
    Each deletion is logged with a copy of what was removed. Returns how many rows went."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    removed = 0

    projects = (
        db.query(models.Project)
        .filter(models.Project.is_archived.is_(True), models.Project.archived_at < cutoff)
        .all()
    )
    for p in projects:
        entries = list(p.disbursements)
        log(db, "system", "purge",
            f"Permanently deleted project '{p.title}' and its {len(entries)} entr{'y' if len(entries) == 1 else 'ies'} "
            f"({RETENTION_DAYS} days after archiving)",
            "project", p.id,
            {"title": p.title, "archived_by": p.archived_by, "archived_at": plain(p.archived_at),
             "entries": [snapshot(d) for d in entries]})
        for d in entries:
            db.delete(d)
        db.delete(p)
        removed += 1 + len(entries)
    db.flush()

    entries = (
        db.query(models.Disbursement)
        .filter(models.Disbursement.is_archived.is_(True), models.Disbursement.archived_at < cutoff)
        .all()
    )
    for d in entries:
        log(db, "system", "purge",
            f"Permanently deleted {describe(d)} ({RETENTION_DAYS} days after archiving)",
            "disbursement", d.id,
            {"entry": snapshot(d), "archived_by": d.archived_by, "archived_at": plain(d.archived_at)})
        db.delete(d)
        removed += 1

    db.commit()
    return removed


# ==========================================
# SCHEMAS
# ==========================================

class ActivityLogItem(BaseModel):
    id: int
    created_at: datetime
    actor: str
    action: str
    entity_type: Optional[str]
    entity_id: Optional[int]
    summary: str
    details: Optional[dict]

    model_config = ConfigDict(from_attributes=True)


class ActivityLogPage(BaseModel):
    total: int
    items: List[ActivityLogItem]


class ArchivedEntry(BaseModel):
    id: int
    project_title: str
    date: date
    cv_no: str
    payee: str
    amount: Decimal
    created_by: str
    archived_by: Optional[str]
    archived_at: Optional[datetime]
    deletes_at: Optional[datetime]


class ArchivedProject(BaseModel):
    id: int
    title: str
    entry_count: int
    total_amount: Decimal
    archived_by: Optional[str]
    archived_at: Optional[datetime]
    deletes_at: Optional[datetime]


# ==========================================
# ROUTES (admins only)
# ==========================================

@router.get("/activity-logs", response_model=ActivityLogPage)
def list_activity(
    action: Optional[str] = None,
    actor: Optional[str] = None,
    entity_type: Optional[str] = None,
    q: Optional[str] = Query(None, description="Search the summary text"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Newest first. Filter by action, user, record type or text."""
    query = db.query(models.ActivityLog)
    if action:
        query = query.filter(models.ActivityLog.action == action)
    if actor:
        query = query.filter(models.ActivityLog.actor.ilike(f"%{actor}%"))
    if entity_type:
        query = query.filter(models.ActivityLog.entity_type == entity_type)
    if q:
        query = query.filter(models.ActivityLog.summary.ilike(f"%{q}%"))

    total = query.count()
    items = (
        query.order_by(models.ActivityLog.created_at.desc(), models.ActivityLog.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {"total": total, "items": items}


@router.get("/disbursements/archived", response_model=List[ArchivedEntry])
def list_archived(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Entries archived on their own. Entries archived with their project are listed
    under that project and come back when it is restored."""
    rows = (
        db.query(models.Disbursement)
        .join(models.Project)
        .filter(models.Disbursement.is_archived.is_(True), models.Project.is_archived.is_(False))
        .order_by(models.Disbursement.archived_at.desc())
        .all()
    )
    return [
        {
            "id": d.id,
            "project_title": d.project.title,
            "date": d.date,
            "cv_no": d.cv_no,
            "payee": d.payee,
            "amount": d.amount,
            "created_by": d.created_by,
            "archived_by": d.archived_by,
            "archived_at": d.archived_at,
            "deletes_at": deletes_at(d.archived_at),
        }
        for d in rows
    ]


@router.post("/disbursements/{disbursement_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore_disbursement(
    disbursement_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Brings an archived entry back into its project and totals."""
    d = db.get(models.Disbursement, disbursement_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Disbursement log not found")
    if not d.is_archived:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This entry isn't archived.")
    if d.project.is_archived:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Its project '{d.project.title}' is archived. Restore the project instead.")

    _unarchive(d)
    d.archived_with_project = False
    log(db, current_user.username, "restore", f"Restored {describe(d)}",
        "disbursement", d.id, {"entry": snapshot(d)})
    db.commit()
    return None


@router.get("/projects/archived", response_model=List[ArchivedProject])
def list_archived_projects(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Archived projects, most recently archived first."""
    rows = (
        db.query(models.Project)
        .filter(models.Project.is_archived.is_(True))
        .order_by(models.Project.archived_at.desc())
        .all()
    )
    result = []
    for p in rows:
        with_it = [d for d in p.disbursements if d.archived_with_project]
        result.append({
            "id": p.id,
            "title": p.title,
            "entry_count": len(with_it),
            "total_amount": sum((d.amount for d in with_it), Decimal("0")),
            "archived_by": p.archived_by,
            "archived_at": p.archived_at,
            "deletes_at": deletes_at(p.archived_at),
        })
    return result


@router.post("/projects/{project_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore_project(
    project_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Restores a project with the entries that were archived together with it.
    Entries archived on their own before that stay archived."""
    p = db.get(models.Project, project_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if not p.is_archived:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This project isn't archived.")

    restored = 0
    for d in p.disbursements:
        if d.is_archived and d.archived_with_project:
            _unarchive(d)
            d.archived_with_project = False
            restored += 1
    _unarchive(p)
    log(db, current_user.username, "project_restore",
        f"Restored project '{p.title}' with {restored} entr{'y' if restored == 1 else 'ies'}",
        "project", p.id, {"title": p.title, "entries": restored})
    db.commit()
    return None
