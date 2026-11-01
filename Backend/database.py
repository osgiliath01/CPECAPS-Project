import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker


def _load_env_file() -> None:
    """Reads Backend/.env (KEY=value lines) when the backend is run by hand on a laptop.
    Real environment variables win. In Docker the values come from docker-compose.yml instead,
    and .env is never copied into the image."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            if value:
                os.environ.setdefault(key.strip(), value)


_load_env_file()

# The database address and password are never written in the code: they come from
# Backend/.env (see .env.example) or, in Docker, from docker-compose.yml.
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Put it in Backend/.env (see Backend/.env.example), e.g. "
        "DATABASE_URL=postgresql+psycopg://postgres:<password>@database.nyala-ordinal.ts.net:5432/caic_db_test"
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
    # Connections per backend process (set in docker-compose.yml). Default up to 40: matches the
    # 40 requests a process works on at once. Processes x pool must stay under PostgreSQL's
    # max_connections (200 in docker-compose.yml).
    pool_size=int(os.getenv("DB_POOL_SIZE", "20")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
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
        # Existing requests count as already seen; new answers start unseen
        "ALTER TABLE deletion_requests ADD COLUMN IF NOT EXISTS requester_seen BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE deletion_requests ALTER COLUMN requester_seen SET DEFAULT FALSE",
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
                    hashed_password=get_password_hash(INITIAL_ADMIN_PASSWORD),
                    is_active=True,
                    is_superuser=True,
                    must_change_password=True,  # the first sign-in has to pick a new password
                )
                db.add(admin_user)
                db.flush()
                db.add(models.ActivityLog(
                    actor="system", action="promote_admin", entity_type="user",
                    entity_id=admin_user.id, summary="Created default superadmin 'admin'",
                ))
                db.commit()
                print("--> Default superadmin 'admin' created; it must change its password at first sign-in")
    except Exception as e:
        db.rollback()
        print(f"Error seeding default superadmin: {e}")
    finally:
        db.close()


# Password for the first admin account. Set ADMIN_INITIAL_PASSWORD in Backend/.env to use
# your own; either way the account has to change it at its first sign-in.
INITIAL_ADMIN_PASSWORD = os.getenv("ADMIN_INITIAL_PASSWORD", "").strip() or "admin123"
_KNOWN_PASSWORDS = ("admin123", "admin", "password", "12345678", "caic123")


def flag_default_passwords() -> None:
    """At startup: any admin account (or account named 'admin') still using a well-known
    password, such as the original admin123, must change it at its next sign-in. Only these
    few accounts are checked, because checking a password is deliberately slow."""
    import models
    from security import verify_password

    db = SessionLocal()
    try:
        users = (
            db.query(models.User)
            .filter(
                models.User.is_active.is_(True),
                models.User.must_change_password.is_(False),
                (models.User.is_superuser.is_(True)) | (models.User.username == "admin"),
            )
            .all()
        )
        for user in users:
            if any(verify_password(p, user.hashed_password) for p in _KNOWN_PASSWORDS):
                user.must_change_password = True
                print(f"--> '{user.username}' uses a well-known password; it must be changed at next sign-in")
        db.commit()
    except Exception as e:  # never stop the server over this check
        db.rollback()
        print(f"[startup] default-password check skipped: {e!r}")
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()