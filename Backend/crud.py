from typing import List, Optional
from sqlalchemy.orm import Session

import models
import schemas
import security

# ==========================================
# USER & AUTHENTICATION CRUD
# ==========================================


def get_user_by_username(db: Session, username: str) -> Optional[models.User]:
    """Retrieves a single user account by username."""
    return db.query(models.User).filter(models.User.username == username).first()


def create_user(db: Session, user_in: schemas.UserCreate) -> models.User:
    """Hashes the password and creates a new user in the database."""
    hashed_pw = security.get_password_hash(user_in.password)
    db_user = models.User(
        name=user_in.name,
        username=user_in.username,
        hashed_password=hashed_pw,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def authenticate_user(
    db: Session, username: str, password: str
) -> Optional[models.User]:
    """Verifies user credentials for login."""
    user = get_user_by_username(db, username=username)
    if not user:
        return None
    if not security.verify_password(password, user.hashed_password):
        return None
    return user


def change_password(db: Session, username: str, new_password: str) -> models.User:
    """Updates the hashed password for a given username."""
    user = get_user_by_username(db, username=username)
    if user:
        user.hashed_password = security.get_password_hash(new_password)
        db.commit()
        db.refresh(user)
    return user


# ==========================================
# PROJECT CRUD
# ==========================================


def get_all_projects(db: Session) -> List[models.Project]:
    """Fetches all projects that are not archived."""
    return db.query(models.Project).filter(models.Project.is_archived.is_(False)).all()


def get_project_by_title(db: Session, title: str) -> Optional[models.Project]:
    """Retrieves a single project record by its title."""
    return db.query(models.Project).filter(models.Project.title == title).first()


def create_project(db: Session, project_in: schemas.ProjectCreate) -> models.Project:
    """Creates a new standalone project record."""
    db_project = models.Project(title=project_in.title)
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


def get_project_summary(db: Session, project_title: str) -> Optional[dict]:
    """Retrieves project details with its active (not archived) entries."""
    project = get_project_by_title(db, title=project_title)
    if not project or project.is_archived:
        return None

    return {
        "project_title": project.title,
        "entries": project.active_disbursements,
        "total_amount": project.total_amount,
    }


# ==========================================
# DISBURSEMENT CRUD
# ==========================================


def create_disbursement(
    db: Session, payload: schemas.DisbursementCreate, current_user: models.User
) -> models.Disbursement:
    """
    Creates a disbursement entry.
    Automatically creates the parent project if it does not already exist.
    """
    project = get_project_by_title(db, title=payload.project_title)
    if not project:
        project = models.Project(title=payload.project_title)
        db.add(project)
        db.commit()
        db.refresh(project)

    db_disbursement = models.Disbursement(
        date=payload.date,
        payee=payload.payee,
        cv_no=payload.cv_no,
        amount=payload.amount,
        project_id=project.id,
        created_by=current_user.username,
        updated_by=current_user.username,
    )
    db.add(db_disbursement)
    db.commit()
    db.refresh(db_disbursement)
    return db_disbursement


def update_disbursement(
    db: Session,
    disbursement_id: int,
    payload: schemas.DisbursementUpdate,
    current_user: models.User,
) -> Optional[models.Disbursement]:
    """Updates provided fields of a disbursement log entry."""
    db_disbursement = (
        db.query(models.Disbursement)
        .filter(models.Disbursement.id == disbursement_id)
        .first()
    )
    if not db_disbursement:
        return None

    update_data = payload.model_dump(exclude_unset=True)
    
    # Extract editor_name if provided, otherwise default to current authenticated user
    editor_name = update_data.pop("editor_name", current_user.username)

    for field, value in update_data.items():
        setattr(db_disbursement, field, value)

    db_disbursement.updated_by = editor_name
    db.commit()
    db.refresh(db_disbursement)
    return db_disbursement


# Entries are never hard-deleted. See activity.archive_disbursement() and the
# DELETE /disbursements/{id} route, which archives instead.