import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Annotated, List, Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

import crud
import database
import models
import schemas
import security
import deletion_requests
import activity
import password_resets
import users_admin
import imports
import live

# Create database tables automatically, then add any new columns to existing tables
models.Base.metadata.create_all(bind=database.engine)
database.ensure_schema()

# Deletes anything archived more than 30 days ago. Runs at startup, then every hour.
PURGE_EVERY_SECONDS = 60 * 60


def purge_once() -> None:
    db = database.SessionLocal()
    try:
        removed = activity.purge_expired(db)
        if removed:
            print(f"[purge] permanently deleted {removed} archived record(s)")
    except Exception as e:  # another server may have purged the same rows first
        db.rollback()
        print(f"[purge] skipped: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def loop():
        while True:
            await run_in_threadpool(purge_once)
            await asyncio.sleep(PURGE_EVERY_SECONDS)

    task = asyncio.create_task(loop())
    watcher = asyncio.create_task(live.hub.run())  # live updates (see live.py)
    yield
    live.hub.close()
    watcher.cancel()
    task.cancel()


app = FastAPI(title="Calamba Allied Industrial Corporation", lifespan=lifespan)
app.include_router(deletion_requests.router)
app.include_router(activity.router)
app.include_router(password_resets.router)
app.include_router(users_admin.router)
app.include_router(imports.router)
app.include_router(live.router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins during development
    allow_credentials=True,
    allow_methods=["*"],  # Allows GET, POST, PUT, DELETE, OPTIONS, etc.
    allow_headers=["*"],  # Allows Authorization headers and tokens
)

# ==========================================
# AUTHENTICATION & USER ROUTES
# ==========================================


@app.post(
    "/auth/register",
    response_model=schemas.UserResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Authentication"],
)
def register_user(
    payload: schemas.UserCreate, db: Session = Depends(database.get_db)
):
    """Registers a new user account."""
    existing_user = crud.get_user_by_username(db, username=payload.username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is already taken",
        )
    user = crud.create_user(db=db, user_in=payload)
    activity.log(db, user.username, "register", f"Registered account '{user.username}' ({user.name})",
                 "user", user.id)
    db.commit()
    return user


@app.post(
    "/token",
    response_model=schemas.Token,
    tags=["Authentication"],
)
def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Session = Depends(database.get_db),
):
    """OAuth2 compatible token login, returns a JWT access token for Swagger UI and clients."""
    user = crud.authenticate_user(
        db, username=form_data.username, password=form_data.password
    )
    if not user:
        activity.log(db, form_data.username[:255] or "?", "login_failed",
                     f"Failed sign-in attempt for '{form_data.username[:100]}'", "user")
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        activity.log(db, user.username, "login_failed",
                     f"Sign-in blocked: '{user.username}' is inactive", "user", user.id)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user account",
        )

    access_token = security.create_access_token(
        data={
            "sub": user.username,
            "name": user.name,
            "is_superuser": user.is_superuser,
            "must_change_password": user.must_change_password,
        },
        expires_delta=timedelta(minutes=30),
    )
    activity.log(db, user.username, "login", f"'{user.username}' signed in", "user", user.id)
    db.commit()
    return {"access_token": access_token, "token_type": "bearer"}


@app.post(
    "/users/change-password",
    response_model=schemas.UserResponse,
    tags=["Users"],
)
def update_password(
    payload: schemas.PasswordChangeSchema,
    current_user: models.User = Depends(security.get_current_user_allow_temporary),
    db: Session = Depends(database.get_db),
):
    """Changes password for the currently authenticated user. Also how someone signed in
    with a temporary password (after a reset) sets their new one."""
    if not security.verify_password(
        payload.old_password, current_user.hashed_password
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect existing password",
        )

    was_temporary = current_user.must_change_password
    user = crud.change_password(
        db, username=current_user.username, new_password=payload.new_password
    )
    user.must_change_password = False
    activity.log(db, current_user.username, "password_change",
                 f"'{current_user.username}' " + ("replaced their temporary password" if was_temporary
                                                  else "changed their password"),
                 "user", current_user.id)
    db.commit()
    return user


# ==========================================
# PROJECT ROUTES (PROTECTED)
# ==========================================


@app.get(
    "/projects",
    response_model=List[schemas.ProjectResponse],
    tags=["Projects"],
)
def read_all_projects(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Returns a list of all existing projects with calculated totals upon login."""
    return crud.get_all_projects(db)


@app.post(
    "/projects",
    response_model=schemas.ProjectResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Projects"],
)
def create_project(
    payload: schemas.ProjectCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Allows creating a new project directly without needing an initial disbursement record."""
    existing_project = crud.get_project_by_title(db, title=payload.title)
    if existing_project and existing_project.is_archived:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A project with this title is archived. An admin can restore it from Activity Log \u2192 Archived.")
    if existing_project:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project with this title already exists",
        )
    project = crud.create_project(db, project_in=payload)
    activity.log(db, current_user.username, "project_create", f"Created project '{project.title}'",
                 "project", project.id)
    db.commit()
    return project


@app.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Projects"],
)
def archive_project(
    project_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: archives a project together with all its entries. It can be restored
    from the Activity Log for 30 days, then it is deleted permanently."""
    project = db.get(models.Project, project_id, with_for_update=True)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.is_archived:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This project is already archived.")

    activity.archive_project(db, project, current_user)
    db.commit()
    return None


# ==========================================
# DISBURSEMENT RELATED ROUTES (PROTECTED)
# ==========================================


@app.post(
    "/disbursements/",
    response_model=schemas.DisbursementItemResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Disbursements"],
)
def record_disbursement(
    payload: schemas.DisbursementCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Appends a new disbursement record to the given project title."""
    existing_project = crud.get_project_by_title(db, title=payload.project_title)
    if existing_project and existing_project.is_archived:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A project with this title is archived. An admin can restore it from Activity Log \u2192 Archived.")
    project_existed = existing_project is not None
    d = crud.create_disbursement(db, payload, current_user)
    if not project_existed:
        activity.log(db, current_user.username, "project_create",
                     f"Created project '{d.project.title}' (with its first entry)", "project", d.project_id)
    activity.log(db, current_user.username, "create", f"Added {activity.describe(d)}",
                 "disbursement", d.id, {"entry": activity.snapshot(d)})
    db.commit()
    db.refresh(d)
    return d


@app.patch(
    "/disbursements/{disbursement_id}",
    response_model=schemas.DisbursementItemResponse,
    tags=["Disbursements"],
)
def update_disbursement_log(
    disbursement_id: int,
    payload: schemas.DisbursementUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Admins only: edits an entry directly. Other users send an edit request instead
    (POST /disbursements/{id}/edit-request), which an admin approves or rejects."""
    existing = db.get(models.Disbursement, disbursement_id, with_for_update=True)  # one edit at a time
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Disbursement log not found",
        )
    if existing.is_archived:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This entry is archived. An admin has to restore it before it can be edited.",
        )

    activity.check_unchanged(existing, payload.original)

    before = activity.snapshot(existing)
    updated_item = crud.update_disbursement(
        db, disbursement_id, payload, current_user
    )
    changes = activity.diff(before, activity.snapshot(updated_item))
    if changes:
        activity.log(db, current_user.username, "update", f"Edited {activity.describe(updated_item)}",
                     "disbursement", updated_item.id, {"changes": changes})
        db.commit()
        db.refresh(updated_item)
    return updated_item


@app.delete(
    "/disbursements/{disbursement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Disbursements"],
)
def delete_disbursement_log(
    disbursement_id: int,
    reason: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_superuser),
):
    """Archives an entry (admins only). It disappears from projects and totals but is
    never erased, and can be restored from the Activity Log."""
    d = db.get(models.Disbursement, disbursement_id, with_for_update=True)
    if not d:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Disbursement log not found",
        )
    if d.is_archived:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This entry is already archived.",
        )

    activity.archive_disbursement(d, current_user)
    activity.log(db, current_user.username, "archive", f"Archived {activity.describe(d)}",
                 "disbursement", d.id, {"entry": activity.snapshot(d), "reason": reason})
    db.commit()
    return None


@app.get(
    "/projects/{project_title}/summary",
    response_model=schemas.ProjectSummaryResponse,
    tags=["Disbursements"],
)
def read_project_summary(
    project_title: str,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """Returns project summary with totals and encoder logs."""
    summary = crud.get_project_summary(db, project_title)
    if not summary:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    return summary