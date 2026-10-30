import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:caic123@database.nyala-ordinal.ts.net:5432/caic_db"
)


def ensure_database_exists(db_url: str):
    """Connects to the default 'postgres' database to ensure target database exists."""
    base_url, db_name = db_url.rsplit("/", 1)
    db_name = db_name.split("?")[0]  # Strip any query parameters if present

    if db_name == "postgres":
        return

    # Connect to system 'postgres' DB with AUTOCOMMIT (required for CREATE DATABASE)
    admin_url = f"{base_url}/postgres"
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")

    with admin_engine.connect() as conn:
        result = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :dbname"),
            {"dbname": db_name}
        )
        if not result.scalar():
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
            print(f"Database '{db_name}' created successfully on remote server.")


# 1. Ensure target DB exists before creating the main connection pool
ensure_database_exists(DATABASE_URL)

# 2. Main Database Engine
engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 5}
)

SessionLocal = sessionmaker(autoflush=False, autocommit=False, bind=engine)
Base = declarative_base()


def ensure_schema():
    """Adds columns that create_all() can't add to tables that already exist.

    Safe to run every startup: each statement does nothing if the column is already there.
    Older copies of the backend keep working, since they simply ignore the new columns.
    """
    if engine.dialect.name != "postgresql":
        return
    statements = [
        "ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS archived_by VARCHAR",
        "ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE",
        "CREATE INDEX IF NOT EXISTS ix_disbursements_is_archived ON disbursements (is_archived)",
        "ALTER TABLE deletion_requests ADD COLUMN IF NOT EXISTS request_type VARCHAR(20) NOT NULL DEFAULT 'archive'",
        "ALTER TABLE deletion_requests ADD COLUMN IF NOT EXISTS changes JSON",
        "CREATE INDEX IF NOT EXISTS ix_deletion_requests_request_type ON deletion_requests (request_type)",
        "ALTER TABLE disbursements ADD COLUMN IF NOT EXISTS archived_with_project BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_by VARCHAR",
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE",
        "CREATE INDEX IF NOT EXISTS ix_projects_is_archived ON projects (is_archived)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
    ]
    with engine.begin() as conn:
        for sql in statements:
            conn.execute(text(sql))


def init_db():
    """Call this during startup to auto-create all tables and seed default superadmin."""
    Base.metadata.create_all(bind=engine)
    ensure_schema()

    import models
    from security import get_password_hash 

    db = SessionLocal()
    try:
        # Check if a superadmin account already exists
        superadmin = db.query(models.User).filter(models.User.is_superuser == True).first()
        
        if not superadmin:
            existing = db.query(models.User).filter(models.User.username == "admin").first()
            if existing:
                existing.is_superuser = True
                existing.is_active = True
                db.add(models.ActivityLog(
                    actor="system", action="promote_admin", entity_type="user",
                    entity_id=existing.id, summary="Promoted existing 'admin' account to superadmin",
                ))
                db.commit()
                print("--> Existing 'admin' account promoted to superadmin")
            else:
                admin_user = models.User(
                    username="admin",
                    name="System Superadmin",
                    hashed_password=get_password_hash("admin123"),
                    is_active=True,
                    is_superuser=True,
                )
                db.add(admin_user)
                db.flush()
                db.add(models.ActivityLog(
                    actor="system", action="promote_admin", entity_type="user",
                    entity_id=admin_user.id, summary="Created default superadmin 'admin'",
                ))
                db.commit()
                print("--> Default Superadmin account seeded: admin / admin123")
    except Exception as e:
        db.rollback()
        print(f"Error seeding default superadmin: {e}")
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()