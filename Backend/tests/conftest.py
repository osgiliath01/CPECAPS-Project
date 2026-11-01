"""Shared set-up for the backend tests.

The tests run against a SEPARATE Postgres database whose name must end in "_test"
(caic_db_test by default). Every table in it is emptied before each test, so never point
TEST_DATABASE_URL at the real database. test.ps1 at the project root sets everything up.
"""
import os
import sys

# ---- Settings, before any app module is imported ----
TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@localhost:5432/caic_db_test",
)
if not TEST_DB_URL.rsplit("/", 1)[-1].split("?")[0].endswith("_test"):
    raise SystemExit("TEST_DATABASE_URL must point at a database whose name ends in _test "
                     "(the tests empty every table).")
os.environ["DATABASE_URL"] = TEST_DB_URL          # wins over Backend/.env (setdefault there)
os.environ["JWT_SECRET_KEY"] = "test-only-secret-key-that-is-long-enough-0123456789"
os.environ["SINGLE_SESSION"] = "true"
os.environ["SINGLE_SESSION_EXEMPT"] = ""
# Fixed values, so settings in Backend/.env can't change what the tests expect
os.environ.update({
    "ADMIN_INITIAL_PASSWORD": "not-used-in-tests",
    "CORS_ORIGINS": "http://localhost:5173",
    "DB_POOL_SIZE": "5",
    "DB_MAX_OVERFLOW": "5",
    "SESSION_IDLE_MINUTES": "30",
    "LOGIN_MAX_FAILURES": "5",
    "LOGIN_LOCK_MINUTES": "15",
    "REGISTER_PER_IP_PER_HOUR": "10",
    "REGISTER_TOTAL_PER_HOUR": "30",
    "MAX_WAITING_ACCOUNTS": "50",
    "RESET_PER_IP_PER_HOUR": "10",
    "RESET_TOTAL_PER_HOUR": "60",
    "OLLAMA_HOST": "http://127.0.0.1:9",  # nothing there: the tests replace the model
})

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _create_test_database() -> None:
    """Creates the _test database if it isn't there yet (needs a user allowed to create databases)."""
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    url = make_url(TEST_DB_URL)
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"),
                                  {"n": url.database}).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        admin.dispose()


_create_test_database()

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

import auth  # noqa: E402  (creates the tables)
import chatbot  # noqa: E402
import database  # noqa: E402
import models  # noqa: E402
import security  # noqa: E402

# Real password hashing is deliberately slow (bcrypt cost 12, about 0.25 s per hash), and the
# tests sign in hundreds of times. Use the lowest cost here only; the app itself is unchanged.
import bcrypt  # noqa: E402

_gensalt = bcrypt.gensalt
bcrypt.gensalt = lambda *args, **kwargs: _gensalt(rounds=4)

PASSWORD = "Correct-Horse-9"
TABLES = ", ".join(f'"{t.name}"' for t in models.Base.metadata.sorted_tables)


@pytest.fixture(autouse=True)
def _clean_database():
    """Every test starts with empty tables."""
    with database.engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    chatbot._NAMES_CACHE["at"] = 0.0
    yield


@pytest.fixture
def db():
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    # Not used as a context manager, so the hourly purge and the live-update watcher don't start
    return TestClient(auth.app)


def make_user(username: str, name: str = None, *, admin: bool = False, approved: bool = True,
              active: bool = True, password: str = PASSWORD) -> int:
    session = database.SessionLocal()
    try:
        user = models.User(
            username=username,
            name=name or username.title() + " Tester",
            hashed_password=security.get_password_hash(password),
            is_superuser=admin,
            is_approved=approved,
            is_active=active,
        )
        session.add(user)
        session.commit()
        return user.id
    finally:
        session.close()


def login(client, username: str, password: str = PASSWORD) -> dict:
    """Signs in and returns the Authorization header. Fails the test if sign-in isn't immediate."""
    r = client.post("/token", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class Person:
    def __init__(self, client, username, *, admin=False):
        self.username = username
        self.id = make_user(username, admin=admin)
        self.auth = login(client, username)
        self.name = username.title() + " Tester"


@pytest.fixture
def admin(client):
    return Person(client, "boss", admin=True)


@pytest.fixture
def admin2(client):
    return Person(client, "boss2", admin=True)


@pytest.fixture
def staff(client):
    return Person(client, "clerk")


@pytest.fixture
def staff2(client):
    return Person(client, "clerk2")


def add_entry(client, who, project="Bamban Plant", cv_no="CV-001", payee="Acme Supply",
              amount="1500.00", date="2026-10-01") -> dict:
    r = client.post("/disbursements/", headers=who.auth, json={
        "project_title": project, "cv_no": cv_no, "payee": payee, "date": date, "amount": amount,
    })
    assert r.status_code == 201, r.text
    return r.json()


def logs(db, action=None):
    db.expire_all()
    q = db.query(models.ActivityLog)
    if action:
        q = q.filter(models.ActivityLog.action == action)
    return q.order_by(models.ActivityLog.id).all()
