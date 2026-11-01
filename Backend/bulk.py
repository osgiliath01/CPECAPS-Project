"""Working on several items at once, and deleting archived items before the 30 days are up.

- Archive several entries (admins), or ask for several to be archived (anyone, with a reason).
- Archive several projects with their entries (admins).
- In Activity Log > Archived: restore or permanently delete several items at once (admins).

Each item is checked and logged on its own, exactly as when done one by one. Items that can't be
done (already archived, not found...) are skipped and listed in the answer; the rest go ahead."""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import activity
import database
import deletion_requests
import models
import security

router = APIRouter(tags=["Bulk actions"])

MAX_ITEMS = 500


class IdList(BaseModel):
    ids: List[int] = Field(..., min_length=1, max_length=MAX_ITEMS)


class BulkArchive(IdList):
    reason: Optional[str] = Field(None, max_length=500)


class BulkArchiveRequest(IdList):
    reason: str = Field(..., min_length=3, max_length=500)


class ArchivedSelection(BaseModel):
    entries: List[int] = Field(default_factory=list, max_length=MAX_ITEMS)
    projects: List[int] = Field(default_factory=list, max_length=MAX_ITEMS)


class BulkResult(BaseModel):
    done: int
    skipped: List[str]


def _unique(ids: List[int]) -> List[int]:
    return list(dict.fromkeys(ids))


def _entries(db: Session, ids: List[int]) -> tuple:
    """The entries with these ids (locked while we work on them), and the ids not found."""
    ids = _unique(ids)
    rows = (
        db.query(models.Disbursement)
        .filter(models.Disbursement.id.in_(ids))
        .order_by(models.Disbursement.id)
        .with_for_update()
        .all()
    )
    found = {d.id for d in rows}
    return rows, [f"Entry #{i} not found (maybe already deleted)" for i in ids if i not in found]


def _projects(db: Session, ids: List[int]) -> tuple:
    ids = _unique(ids)
    rows = (
        db.query(models.Project)
        .filter(models.Project.id.in_(ids))
        .order_by(models.Project.id)
        .with_for_update()
        .all()
    )
    found = {p.id for p in rows}
    return rows, [f"Project #{i} not found (maybe already deleted)" for i in ids if i not in found]


def _close_pending_requests(db: Session, d: models.Disbursement, admin: models.User, why: str) -> None:
    """Pending archive/edit requests on an entry that's being archived: nothing left to approve."""
    pending = db.query(models.DeletionRequest).filter_by(disbursement_id=d.id, status="pending").all()
    for req in pending:
        req.status = "rejected"
        req.reviewed_by = admin.username
        req.reviewed_at = datetime.now(timezone.utc)
        req.review_note = why
        req.requester_seen = False
        activity.log(db, admin.username, f"{req.request_type}_rejected",
                     f"Auto-rejected {req.requested_by}'s {req.request_type} request for CV# {req.cv_no}: {why}",
                     "disbursement", d.id,
                     {"request_id": req.id, "requested_by": req.requested_by, "note": why})


@router.post("/disbursements/bulk-archive", response_model=BulkResult)
def bulk_archive_entries(
    payload: BulkArchive,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins: archives several entries. Each can be restored for 30 days, as usual."""
    rows, skipped = _entries(db, payload.ids)
    reason = (payload.reason or "").strip() or None
    done = 0
    for d in rows:
        if d.is_archived:
            skipped.append(f"CV# {d.cv_no} is already archived")
            continue
        activity.archive_disbursement(d, current_user)
        _close_pending_requests(db, d, current_user, "the entry was archived")
        activity.log(db, current_user.username, "archive", f"Archived {activity.describe(d)}",
                     "disbursement", d.id,
                     {"entry": activity.snapshot(d), "reason": reason, "selected_together": len(payload.ids)})
        done += 1
    db.commit()
    return {"done": done, "skipped": skipped}


@router.post("/disbursements/bulk-archive-request", response_model=BulkResult)
def bulk_request_archive(
    payload: BulkArchiveRequest,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Anyone: asks an admin to archive several entries (one request per entry, same reason)."""
    rows, skipped = _entries(db, payload.ids)
    reason = payload.reason.strip()
    done = 0
    for d in rows:
        if d.is_archived:
            skipped.append(f"CV# {d.cv_no} is already archived")
            continue
        pending = db.query(models.DeletionRequest).filter_by(disbursement_id=d.id, status="pending").first()
        if pending:
            skipped.append(f"CV# {d.cv_no} already has a pending {pending.request_type} request")
            continue
        req = deletion_requests._new_request(d, current_user, "archive", reason)
        db.add(req)
        db.flush()
        activity.log(db, current_user.username, "archive_requested", f"Asked to archive {activity.describe(d)}",
                     "disbursement", d.id, {"request_id": req.id, "reason": reason})
        done += 1
    db.commit()
    return {"done": done, "skipped": skipped}


@router.post("/projects/bulk-archive", response_model=BulkResult)
def bulk_archive_projects(
    payload: IdList,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins: archives several projects, each with all its entries."""
    rows, skipped = _projects(db, payload.ids)
    done = 0
    for p in rows:
        if p.is_archived:
            skipped.append(f"Project '{p.title}' is already archived")
            continue
        activity.archive_project(db, p, current_user)
        done += 1
    db.commit()
    return {"done": done, "skipped": skipped}


@router.post("/archived/restore", response_model=BulkResult)
def restore_selected(
    payload: ArchivedSelection,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins: restores the selected archived projects (with their entries) and entries."""
    projects, skipped = _projects(db, payload.projects)
    entries, missing = _entries(db, payload.entries)
    skipped += missing
    done = 0
    for p in projects:
        try:
            activity.restore_project_items(db, p, current_user)
            done += 1
        except ValueError as e:
            skipped.append(str(e))
    db.flush()
    for d in entries:
        try:
            activity.restore_entry(db, d, current_user)
            done += 1
        except ValueError as e:
            skipped.append(str(e))
    db.commit()
    return {"done": done, "skipped": skipped}


@router.post("/archived/delete", response_model=BulkResult)
def delete_selected(
    payload: ArchivedSelection,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins: permanently deletes the selected archived projects (with all their entries) and
    entries, without waiting for the 30 days. Can't be undone; the Activity Log keeps a copy
    of what was deleted. Only archived items can be deleted."""
    projects, skipped = _projects(db, payload.projects)
    entries, missing = _entries(db, payload.entries)
    skipped += missing
    done = 0
    for p in projects:
        if not p.is_archived:
            skipped.append(f"Project '{p.title}' isn't archived; archive it first")
            continue
        activity.delete_project_permanently(db, p, current_user.username, "permanent_delete", "deleted by an admin")
        done += 1
    db.flush()
    for d in entries:
        if not d.is_archived:
            skipped.append(f"CV# {d.cv_no} isn't archived; archive it first")
            continue
        activity.delete_entry_permanently(db, d, current_user.username, "permanent_delete", "deleted by an admin")
        done += 1
    db.commit()
    return {"done": done, "skipped": skipped}
