"""Sign-up, approval, sign-in, lockout, passwords and who may call what."""
import jwt
import pytest

import models
import security
from tests.conftest import PASSWORD, login, logs, make_user


def register(client, username="newbie", name="New Person", password="Long-enough-1", ip="203.0.113.5"):
    return client.post("/auth/register", headers={"X-Forwarded-For": ip},
                       json={"username": username, "name": name, "password": password})


# ---------- Registering ----------

def test_register_creates_unapproved_account(client, db):
    r = register(client)
    assert r.status_code == 201
    assert r.json()["is_approved"] is False
    assert [l.action for l in logs(db)] == ["register"]


def test_unapproved_account_cannot_sign_in(client):
    register(client)
    r = client.post("/token", data={"username": "newbie", "password": "Long-enough-1"})
    assert r.status_code == 403
    assert "approval" in r.json()["detail"]


def test_unapproved_message_needs_the_right_password(client):
    register(client)
    r = client.post("/token", data={"username": "newbie", "password": "wrong-password"})
    assert r.status_code == 401  # doesn't reveal that the account exists


def test_admin_approves_then_user_signs_in(client, admin):
    uid = register(client).json()["id"]
    pending = client.get("/users/pending", headers=admin.auth).json()
    assert [p["username"] for p in pending] == ["newbie"]
    assert client.post(f"/users/{uid}/approve", headers=admin.auth).status_code == 204
    assert client.get("/users/pending", headers=admin.auth).json() == []
    login(client, "newbie", "Long-enough-1")


def test_approving_twice_is_refused(client, admin):
    uid = register(client).json()["id"]
    client.post(f"/users/{uid}/approve", headers=admin.auth)
    assert client.post(f"/users/{uid}/approve", headers=admin.auth).status_code == 400


def test_rejecting_removes_account_and_frees_username(client, admin, db):
    uid = register(client).json()["id"]
    assert client.post(f"/users/{uid}/reject", headers=admin.auth).status_code == 204
    assert db.get(models.User, uid) is None
    assert register(client).status_code == 201


@pytest.mark.parametrize("username", ["ab", "has space", "-dash-first", "x" * 51, "semi;colon", "émile"])
def test_register_rejects_bad_usernames(client, username):
    assert register(client, username=username).status_code in (400, 422)


@pytest.mark.parametrize("username", ["admin", "Admin", "SYSTEM", "root", "support"])
def test_register_rejects_reserved_usernames(client, username):
    r = register(client, username=username)
    assert r.status_code == 400
    assert "taken" in r.json()["detail"]


def test_usernames_are_unique_ignoring_capitals(client):
    assert register(client, username="Maria").status_code == 201
    assert register(client, username="maria").status_code == 400
    assert register(client, username="MARIA").status_code == 400


def test_register_requires_8_character_password(client):
    assert register(client, password="short").status_code == 422


def test_register_tidies_spaces_in_name(client):
    assert register(client, name="  Juan    dela   Cruz ").json()["name"] == "Juan dela Cruz"


def test_register_is_rate_limited_per_address(client, monkeypatch):
    monkeypatch.setattr("auth.REGISTER_PER_IP", 3)
    for i in range(3):
        assert register(client, username=f"user{i}").status_code == 201
    assert register(client, username="user9").status_code == 429
    assert register(client, username="user9", ip="198.51.100.7").status_code == 201  # another address


def test_register_has_an_overall_cap_whatever_the_address(client, monkeypatch):
    monkeypatch.setattr("auth.REGISTER_TOTAL", 3)
    for i in range(3):
        assert register(client, username=f"user{i}", ip=f"198.51.100.{i + 1}").status_code == 201
    assert register(client, username="user9", ip="198.51.100.99").status_code == 429


def test_register_stops_when_too_many_are_waiting(client, monkeypatch):
    monkeypatch.setattr("auth.MAX_WAITING_ACCOUNTS", 2)
    register(client, username="wait1")
    register(client, username="wait2")
    assert register(client, username="wait3").status_code == 429


# ---------- Signing in ----------

def test_sign_in_returns_token_and_logs_it(client, db):
    make_user("ana")
    headers = login(client, "ana")
    token = headers["Authorization"].split()[1]
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["sub"] == "ana" and claims["is_superuser"] is False and "sid" in claims
    assert [l.action for l in logs(db)] == ["login"]


def test_wrong_password_is_401_and_logged(client, db):
    make_user("ana")
    r = client.post("/token", data={"username": "ana", "password": "nope"})
    assert r.status_code == 401
    assert [l.action for l in logs(db)] == ["login_failed"]


def test_unknown_user_is_401(client):
    assert client.post("/token", data={"username": "ghost", "password": "x"}).status_code == 401


def test_inactive_user_cannot_sign_in(client):
    make_user("gone", active=False)
    r = client.post("/token", data={"username": "gone", "password": PASSWORD})
    assert r.status_code == 400


def test_five_wrong_passwords_lock_the_account(client):
    make_user("ana")
    for _ in range(5):
        assert client.post("/token", data={"username": "ana", "password": "bad"}).status_code == 401
    r = client.post("/token", data={"username": "ana", "password": PASSWORD})
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_lock_is_per_account(client):
    make_user("ana")
    make_user("ben")
    for _ in range(5):
        client.post("/token", data={"username": "ana", "password": "bad"})
    login(client, "ben")


def test_successful_sign_in_resets_failure_count(client):
    make_user("ana")
    for _ in range(4):
        client.post("/token", data={"username": "ana", "password": "bad"})
    headers = login(client, "ana")
    client.post("/auth/logout", headers=headers)
    for _ in range(4):
        client.post("/token", data={"username": "ana", "password": "bad"})
    login(client, "ana")  # 4 + 4 failures, but never 5 in a row since the last sign-in


def test_locked_attempts_are_not_logged(client, db):
    make_user("ana")
    for _ in range(5):
        client.post("/token", data={"username": "ana", "password": "bad"})
    for _ in range(10):
        client.post("/token", data={"username": "ana", "password": "bad"})
    assert len(logs(db, "login_failed")) == 5


# ---------- Tokens ----------

def test_no_token_is_401(client):
    assert client.get("/projects").status_code == 401


def test_garbage_token_is_401(client):
    assert client.get("/projects", headers={"Authorization": "Bearer abc.def.ghi"}).status_code == 401


def test_token_signed_with_another_key_is_401(client, staff):
    claims = jwt.decode(staff.auth["Authorization"].split()[1], options={"verify_signature": False})
    claims["is_superuser"] = True
    forged = jwt.encode(claims, "some-other-secret-key-that-is-long-enough!!", algorithm="HS256")
    r = client.get("/users", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401


def test_admin_claim_in_token_is_not_trusted(client, staff):
    """Even a correctly signed token saying is_superuser=True doesn't make staff an admin:
    the role comes from the database."""
    claims = jwt.decode(staff.auth["Authorization"].split()[1], options={"verify_signature": False})
    claims["is_superuser"] = True
    forged = jwt.encode(claims, security.SECRET_KEY, algorithm=security.ALGORITHM)
    assert client.get("/users", headers={"Authorization": f"Bearer {forged}"}).status_code == 403


def test_expired_token_is_401(client, staff):
    claims = jwt.decode(staff.auth["Authorization"].split()[1], options={"verify_signature": False})
    claims["exp"] = 1_000_000_000
    old = jwt.encode(claims, security.SECRET_KEY, algorithm=security.ALGORITHM)
    assert client.get("/projects", headers={"Authorization": f"Bearer {old}"}).status_code == 401


def test_deactivated_user_token_stops_working(client, admin, staff):
    assert client.patch(f"/users/{staff.id}", headers=admin.auth, json={"is_active": False}).status_code == 204
    assert client.get("/projects", headers=staff.auth).status_code in (400, 401, 403)


# ---------- Admin-only routes ----------

ADMIN_ONLY = [
    ("get", "/users"),
    ("get", "/users/pending"),
    ("get", "/activity-logs"),
    ("get", "/backup-status"),
    ("get", "/deletion-requests"),
    ("get", "/password-resets"),
    ("get", "/name-requests"),
    ("get", "/disbursements/archived"),
    ("get", "/projects/archived"),
    ("patch", "/disbursements/1"),
    ("delete", "/disbursements/1"),
    ("delete", "/projects/1"),
    ("post", "/disbursements/bulk-archive"),
    ("post", "/projects/bulk-archive"),
    ("post", "/archived/restore"),
    ("post", "/archived/delete"),
    ("post", "/disbursements/1/restore"),
    ("post", "/projects/1/restore"),
    ("post", "/users/1/approve"),
    ("post", "/users/1/reset-password"),
    ("delete", "/users/1"),
]


@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_staff_cannot_use_admin_routes(client, staff, method, path):
    kwargs = {"json": {"ids": [1], "editor_name": "x"}} if method in ("post", "patch") else {}
    r = getattr(client, method)(path, headers=staff.auth, **kwargs)
    assert r.status_code == 403, (path, r.status_code, r.text)


@pytest.mark.parametrize("method,path", ADMIN_ONLY + [("get", "/me/profile"), ("get", "/disbursements/")])
def test_signed_out_cannot_use_protected_routes(client, method, path):
    kwargs = {"json": {}} if method in ("post", "patch") else {}
    assert getattr(client, method)(path, **kwargs).status_code == 401


# ---------- Passwords ----------

def change(client, who_auth, old, new, confirm=None):
    return client.post("/users/change-password", headers=who_auth,
                       json={"old_password": old, "new_password": new, "confirm_password": confirm or new})


def test_change_password(client, staff):
    assert change(client, staff.auth, PASSWORD, "Brand-new-pass-1").status_code == 200
    client.post("/auth/logout", headers=staff.auth)
    assert client.post("/token", data={"username": "clerk", "password": PASSWORD}).status_code == 401
    login(client, "clerk", "Brand-new-pass-1")


def test_change_password_needs_correct_old_one(client, staff):
    assert change(client, staff.auth, "wrong", "Brand-new-pass-1").status_code == 400


def test_change_password_confirmation_must_match(client, staff):
    assert change(client, staff.auth, PASSWORD, "Brand-new-pass-1", "Different-pass-1").status_code == 422


def test_change_password_must_differ(client, staff):
    assert change(client, staff.auth, PASSWORD, PASSWORD).status_code == 422


def test_admin_reset_gives_temporary_password_that_must_be_changed(client, admin, staff):
    r = client.post(f"/users/{staff.id}/reset-password", headers=admin.auth)
    assert r.status_code == 200
    temp = r.json()["temporary_password"]
    # the old password no longer works; the temporary one does
    assert client.post("/token", data={"username": "clerk", "password": PASSWORD}).status_code == 401
    client.post("/auth/logout", headers=staff.auth)
    headers = login(client, "clerk", temp)
    # until a new password is chosen, the app's data is off limits
    assert client.get("/projects", headers=headers).status_code in (401, 403)
    assert change(client, headers, temp, "My-own-pass-22").status_code == 200


def test_admin_cannot_reset_own_password(client, admin):
    assert client.post(f"/users/{admin.id}/reset-password", headers=admin.auth).status_code == 400


# ---------- Forgot password ----------

def test_reset_request_same_answer_for_unknown_user(client, staff):
    a = client.post("/auth/reset-request", json={"username": "clerk"})
    b = client.post("/auth/reset-request", json={"username": "nobody"})
    assert a.status_code == b.status_code == 202
    assert a.json() == b.json()


def test_reset_request_flow(client, admin, staff):
    client.post("/auth/reset-request", json={"username": "clerk", "message": "forgot it"})
    client.post("/auth/reset-request", json={"username": "clerk"})  # duplicate: still one request
    pending = client.get("/password-resets", headers=admin.auth).json()
    assert len(pending) == 1 and pending[0]["username"] == "clerk"
    r = client.post(f"/password-resets/{pending[0]['id']}/approve", headers=admin.auth)
    assert r.status_code == 200 and r.json()["temporary_password"]
    assert client.post(f"/password-resets/{pending[0]['id']}/approve", headers=admin.auth).status_code == 400


def test_admin_cannot_approve_own_reset(client, admin):
    client.post("/auth/reset-request", json={"username": "boss"})
    rid = client.get("/password-resets", headers=admin.auth).json()[0]["id"]
    assert client.post(f"/password-resets/{rid}/approve", headers=admin.auth).status_code == 403


def test_reset_request_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr("password_resets.RESET_PER_IP", 2)
    ip = {"X-Forwarded-For": "203.0.113.9"}
    for _ in range(2):
        assert client.post("/auth/reset-request", headers=ip, json={"username": "x"}).status_code == 202
    assert client.post("/auth/reset-request", headers=ip, json={"username": "x"}).status_code == 429


def test_unknown_reset_requests_are_logged_once_an_hour(client, db):
    for _ in range(5):
        client.post("/auth/reset-request", json={"username": "ghost"})
    assert len(logs(db, "reset_requested")) == 1
