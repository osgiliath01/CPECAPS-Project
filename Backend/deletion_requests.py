"""Change requests: normal users ask, admins approve or reject.

Two kinds share one table (deletion_requests):
- "archive": hide an entry from its project and totals (it can be restored later)
- "edit":    change an entry's date, CV no., payee or amount

Admins archive and edit directly; everything is recorded in the Activity Log.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

import activity
import database
import models
import schemas
import security

router = APIRouter(tags=["Requests"])


# ---------- Schemas ----------

class DeletionRequestCreate(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class EditRequestCreate(schemas.DisbursementUpdate):
    editor_name: Optional[str] = None
    reason: Optional[str] = Field(None, max_length=500)


class ReviewNote(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class RequestResponse(BaseModel):
    id: int
    disbursement_id: Optional[int]
    request_type: str
    project_title: str
    cv_no: str
    payee: str
    amount: Decimal
    reason: str
    changes: Optional[dict]
    status: str
    requested_by: str
    reviewed_by: Optional[str]
    review_note: Optional[str]
    created_at: datetime
    reviewed_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


# ---------- Helpers ----------

def _get_entry(db: Session, disbursement_id: int) -> models.Disbursement:
    d = db.get(models.Disbursement, disbursement_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Disbursement log not found")
    if d.is_archived:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This entry is archived.")
    pending = (
        db.query(models.DeletionRequest)
        .filter_by(disbursement_id=disbursement_id, status="pending")
        .first()
    )
    if pending:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This entry already has a pending {pending.request_type} request. Wait for an admin to review it.",
        )
    return d


def _new_request(d: models.Disbursement, user: models.User, request_type: str, reason: str,
                 changes: Optional[dict] = None) -> models.DeletionRequest:
    return models.DeletionRequest(
        disbursement_id=d.id,
        request_type=request_type,
        project_title=d.project.title,
        cv_no=d.cv_no,
        payee=d.payee,
        amount=d.amount,
        reason=reason,
        changes=changes,
        requested_by=user.username,
    )


def _get_pending(db: Session, request_id: int) -> models.DeletionRequest:
    req = db.get(models.DeletionRequest, request_id)
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    if req.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"This request was already {req.status}.")
    return req


def _block_self_review(req: models.DeletionRequest, user: models.User):
    if req.requested_by == user.username:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You can't review your own request. Another admin has to do it.",
        )


def _mark_reviewed(req: models.DeletionRequest, user: models.User, new_status: str,
                   payload: Optional[ReviewNote]) -> None:
    req.status = new_status
    req.reviewed_by = user.username
    req.reviewed_at = datetime.now(timezone.utc)
    note = (payload.note or "").strip() if payload else ""
    req.review_note = note or None


def _review_details(req: models.DeletionRequest, extra: Optional[dict] = None) -> dict:
    details = {"request_id": req.id, "requested_by": req.requested_by,
               "reason": req.reason or None, "note": req.review_note}
    if extra:
        details.update(extra)
    return details


# ---------- Requests (any logged-in user) ----------

@router.post(
    "/disbursements/{disbursement_id}/deletion-request",
    response_model=RequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def request_archive(
    disbursement_id: int,
    payload: DeletionRequestCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Ask an admin to archive an entry. A reason is required."""
    d = _get_entry(db, disbursement_id)
    req = _new_request(d, current_user, "archive", payload.reason.strip())
    db.add(req)
    db.flush()
    activity.log(db, current_user.username, "archive_requested",
                 f"Asked to archive {activity.describe(d)}",
                 "disbursement", d.id, {"request_id": req.id, "reason": req.reason})
    db.commit()
    db.refresh(req)
    return req


@router.post(
    "/disbursements/{disbursement_id}/edit-request",
    response_model=RequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def request_edit(
    disbursement_id: int,
    payload: EditRequestCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Ask an admin to change an entry. Nothing changes until it's approved."""
    d = _get_entry(db, disbursement_id)

    proposed = payload.model_dump(exclude_unset=True, exclude={"editor_name", "reason"})
    proposed = {k: activity.plain(v) for k, v in proposed.items() if v is not None}
    before = activity.snapshot(d)
    fields = activity.diff(before, {**before, **proposed})
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing was changed.")

    reason = (payload.reason or "").strip()
    changes = {"fields": fields, "editor_name": payload.editor_name or current_user.name}
    req = _new_request(d, current_user, "edit", reason, changes)
    db.add(req)
    db.flush()
    activity.log(db, current_user.username, "edit_requested",
                 f"Asked to edit {activity.describe(d)}",
                 "disbursement", d.id, {"request_id": req.id, "changes": fields, "reason": reason or None})
    db.commit()
    db.refresh(req)
    return req


@router.get("/my-requests", response_model=List[RequestResponse])
def list_my_requests(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """The signed-in user's own requests and their outcome, newest first."""
    return (
        db.query(models.DeletionRequest)
        .filter_by(requested_by=current_user.username)
        .order_by(models.DeletionRequest.created_at.desc())
        .limit(200)
        .all()
    )


# ---------- Review (admins only) ----------

@router.get("/deletion-requests", response_model=List[RequestResponse])
def list_requests(
    status_filter: Literal["pending", "approved", "rejected"] = Query("pending", alias="status"),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: archive and edit requests, pending ones by default."""
    return (
        db.query(models.DeletionRequest)
        .filter_by(status=status_filter)
        .order_by(models.DeletionRequest.created_at.desc())
        .all()
    )


@router.post("/deletion-requests/{request_id}/approve", response_model=RequestResponse)
def approve_request(
    request_id: int,
    payload: Optional[ReviewNote] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: approve and apply the request, with an optional note to the requester."""
    req = _get_pending(db, request_id)
    _block_self_review(req, current_user)
    d = db.get(models.Disbursement, req.disbursement_id) if req.disbursement_id else None

    if req.request_type == "edit":
        if not d:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The entry no longer exists. Reject this request instead.")
        if d.is_archived:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "The entry is archived. Restore it first, or reject this request.")
        fields = (req.changes or {}).get("fields", {})
        editor = (req.changes or {}).get("editor_name") or req.requested_by
        new_values = schemas.DisbursementUpdate(
            **{k: v[1] for k, v in fields.items()}, editor_name=editor
        ).model_dump(exclude_unset=True, exclude={"editor_name"})

        before = activity.snapshot(d)
        for field, value in new_values.items():
            setattr(d, field, value)
        d.updated_by = editor
        _mark_reviewed(req, current_user, "approved", payload)
        activity.log(db, current_user.username, "edit_approved",
                     f"Approved {req.requested_by}'s edit to {activity.describe(d)}",
                     "disbursement", d.id,
                     _review_details(req, {"changes": activity.diff(before, activity.snapshot(d))}))
    else:
        if d and not d.is_archived:
            activity.archive_disbursement(d, current_user)
        _mark_reviewed(req, current_user, "approved", payload)
        activity.log(db, current_user.username, "archive_approved",
                     f"Approved {req.requested_by}'s request and archived CV# {req.cv_no} ({req.payee}) in {req.project_title}",
                     "disbursement", req.disbursement_id, _review_details(req))

    db.commit()
    db.refresh(req)
    return req


@router.post("/deletion-requests/{request_id}/reject", response_model=RequestResponse)
def reject_request(
    request_id: int,
    payload: Optional[ReviewNote] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: reject the request, with an optional note to the requester. The entry stays as it is."""
    req = _get_pending(db, request_id)
    _block_self_review(req, current_user)
    _mark_reviewed(req, current_user, "rejected", payload)

    extra = {"changes": (req.changes or {}).get("fields")} if req.request_type == "edit" else None
    activity.log(db, current_user.username, f"{req.request_type}_rejected",
                 f"Rejected {req.requested_by}'s {req.request_type} request for CV# {req.cv_no} ({req.payee}) in {req.project_title}",
                 "disbursement", req.disbursement_id, _review_details(req, extra))
    db.commit()
    db.refresh(req)
    return req
