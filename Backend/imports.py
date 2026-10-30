"""CSV import of disbursements (admins only).

Columns: project_title, date, cv_no, payee, amount  (header row required, any order).
- preview: checks every row and reports problems; nothing is saved.
- commit:  saves all valid rows in one transaction; invalid rows are skipped.
New project titles are created automatically. One Activity Log entry records the import.
"""
import csv
import io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

import activity
import database
import models
import security

router = APIRouter(tags=["Import"])

REQUIRED = ["project_title", "date", "cv_no", "payee", "amount"]
MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 10000
MAX_AMOUNT = Decimal("99999999.99")  # disbursements.amount is NUMERIC(10, 2)
DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d-%b-%Y", "%b %d, %Y")


class RowError(BaseModel):
    line: int
    message: str


class ImportReport(BaseModel):
    mode: str
    file_name: str
    total_rows: int
    valid_rows: int
    error_rows: int
    errors: List[RowError]
    new_projects: List[str]
    existing_projects: int
    total_amount: Decimal
    first_date: Optional[date]
    last_date: Optional[date]
    imported: int = 0


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):  # Excel's "CSV" (not "CSV UTF-8") saves as cp1252
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Couldn't read the file. Save it as CSV (UTF-8) and try again.")


def _parse_date(text: str) -> date:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"date '{text}' isn't a valid date (use YYYY-MM-DD)")


def _parse_amount(text: str) -> Decimal:
    cleaned = text.replace("₱", "").replace("PHP", "").replace(",", "").replace(" ", "")
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        raise ValueError(f"amount '{text}' isn't a number")
    if value <= 0:
        raise ValueError("amount must be greater than zero")
    if value > MAX_AMOUNT:
        raise ValueError("amount is too large (max 99,999,999.99)")
    if value != value.quantize(Decimal("0.01")):
        raise ValueError(f"amount '{text}' has more than 2 decimal places")
    return value.quantize(Decimal("0.01"))


@router.post("/disbursements/import", response_model=ImportReport)
async def import_disbursements(
    file: UploadFile = File(...),
    mode: Literal["preview", "commit"] = Query("preview"),
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only. Upload with mode=preview first, then the same file with mode=commit."""
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is larger than 5 MB.")
    if not raw.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty.")

    reader = csv.DictReader(io.StringIO(_decode(raw)))
    headers = [(h or "").strip().lower() for h in (reader.fieldnames or [])]
    missing = [c for c in REQUIRED if c not in headers]
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Missing column(s): {', '.join(missing)}. The first row must be: {','.join(REQUIRED)}",
        )
    reader.fieldnames = headers

    # What already exists, matched case-insensitively like the app's project list
    projects = {p.title.strip().lower(): p for p in db.query(models.Project).all()}
    existing_cvs = {cv.strip().lower() for (cv,) in db.query(models.Disbursement.cv_no).all()}

    valid, errors, seen_cvs = [], [], {}
    for line, row in enumerate(reader, start=2):  # line 1 is the header
        if line - 1 > MAX_ROWS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Too many rows (max {MAX_ROWS}). Split the file.")
        values = {k: (row.get(k) or "").strip() for k in REQUIRED}
        if not any(values.values()):
            continue  # blank line

        problems = []
        for col in ("project_title", "cv_no", "payee"):
            if not values[col]:
                problems.append(f"{col} is empty")
        if len(values["project_title"]) > 255:
            problems.append("project_title is longer than 255 characters")

        parsed_date = parsed_amount = None
        try:
            parsed_date = _parse_date(values["date"]) if values["date"] else None
            if not parsed_date:
                problems.append("date is empty")
        except ValueError as e:
            problems.append(str(e))
        try:
            parsed_amount = _parse_amount(values["amount"]) if values["amount"] else None
            if parsed_amount is None:
                problems.append("amount is empty")
        except ValueError as e:
            problems.append(str(e))

        cv_key = values["cv_no"].lower()
        if cv_key:
            if cv_key in existing_cvs:
                problems.append(f"CV# {values['cv_no']} already exists in the system")
            elif cv_key in seen_cvs:
                problems.append(f"CV# {values['cv_no']} is repeated (also on line {seen_cvs[cv_key]})")
            else:
                seen_cvs[cv_key] = line

        project = projects.get(values["project_title"].lower())
        if project and project.is_archived:
            problems.append(f"project '{project.title}' is archived; restore it first")

        if problems:
            errors.append({"line": line, "message": "; ".join(problems)})
        else:
            valid.append({**values, "date": parsed_date, "amount": parsed_amount, "line": line})

    new_titles = []
    seen_new = set()
    for r in valid:
        key = r["project_title"].lower()
        if key not in projects and key not in seen_new:
            seen_new.add(key)
            new_titles.append(r["project_title"])
    existing_used = len({r["project_title"].lower() for r in valid} - seen_new)

    report = {
        "mode": mode,
        "file_name": file.filename or "upload.csv",
        "total_rows": len(valid) + len(errors),
        "valid_rows": len(valid),
        "error_rows": len(errors),
        "errors": errors[:200],
        "new_projects": new_titles,
        "existing_projects": existing_used,
        "total_amount": sum((r["amount"] for r in valid), Decimal("0")),
        "first_date": min((r["date"] for r in valid), default=None),
        "last_date": max((r["date"] for r in valid), default=None),
    }
    if mode == "preview":
        return report

    if not valid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "There are no valid rows to import.")

    for title in new_titles:
        p = models.Project(title=title)
        db.add(p)
        projects[title.lower()] = p
    db.flush()

    for r in valid:
        db.add(models.Disbursement(
            date=r["date"],
            payee=r["payee"],
            cv_no=r["cv_no"],
            amount=r["amount"],
            project_id=projects[r["project_title"].lower()].id,
            created_by=current_user.username,
            updated_by=current_user.username,
        ))

    activity.log(
        db, current_user.username, "import",
        f"Imported {len(valid)} entr{'y' if len(valid) == 1 else 'ies'} (PHP {report['total_amount']:,.2f}) "
        f"from '{report['file_name']}'" + (f", creating {len(new_titles)} project(s)" if new_titles else "")
        + (f"; skipped {len(errors)} invalid row(s)" if errors else ""),
        "disbursement", None,
        {"file": report["file_name"], "imported": len(valid), "skipped": len(errors),
         "total": activity.plain(report["total_amount"]), "new_projects": new_titles,
         "first_date": activity.plain(report["first_date"]), "last_date": activity.plain(report["last_date"]),
         "skipped_lines": [e["line"] for e in errors][:500]},
    )
    db.commit()
    report["imported"] = len(valid)
    return report
