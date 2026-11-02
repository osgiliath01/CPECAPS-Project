"""One signed-in device per account, the Allow/Block prompt, refresh and sign-out."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

import models
import sessions
from tests.conftest import PASSWORD, login, logs, make_user

PHONE = {"User-Agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36"}


def second_sign_in(client, username="clerk"):
    return client.post("/token", data={"username": username, "password": PASSWORD}, headers=PHONE)


def set_user(db, user_id, **values):
    db.query(models.User).filter_by(id=user_id).update(values)
    db.commit()


def set_challenge(db, challenge_id, **values):
    db.query(models.LoginChallenge).filter_by(id=challenge_id).update(values)
    db.commit()


def ago(seconds):
    return datetime.now(timezone.utc) - timedelta(seconds=seconds)


def poll(client, c):
    return client.post(f"/auth/login-challenges/{c['challenge_id']}/status", json={"secret": c["secret"]})


def test_second_device_has_to_wait(client, staff):
    r = second_sign_in(client)
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "waiting" and body["challenge_id"] and body["secret"]


def test_signed_in_device_sees_the_request_with_device_name(client, staff):
    second_sign_in(client)
    waiting = client.get("/me/login-challenges", headers=staff.auth).json()
    assert len(waiting) == 1
    assert waiting[0]["device"] == "Chrome on Android"


def test_allow_lets_new_device_in_and_signs_old_one_out(client, staff):
    c = second_sign_in(client).json()
    cid = c["challenge_id"]
    assert poll(client, c).json()["status"] == "waiting"
    assert client.post(f"/me/login-challenges/{cid}/allow", headers=staff.auth).status_code == 204
    r = poll(client, c).json()
    assert r["status"] == "approved" and r["access_token"]
    new = {"Authorization": f"Bearer {r['access_token']}"}
    assert client.get("/projects", headers=new).status_code == 200
    assert client.get("/projects", headers=staff.auth).status_code == 401  # the old device is out


def test_approved_token_is_handed_out_only_once(client, staff):
    c = second_sign_in(client).json()
    client.post(f"/me/login-challenges/{c['challenge_id']}/allow", headers=staff.auth)
    assert poll(client, c).json()["status"] == "approved"
    assert poll(client, c).json()["status"] == "expired"


def test_block_refuses_new_device_and_keeps_old_one(client, staff):
    c = second_sign_in(client).json()
    assert client.post(f"/me/login-challenges/{c['challenge_id']}/deny", headers=staff.auth).status_code == 204
    assert poll(client, c).json()["status"] == "denied"
    assert client.get("/projects", headers=staff.auth).status_code == 200


def test_wrong_secret_is_not_found(client, staff):
    c = second_sign_in(client).json()
    r = client.post(f"/auth/login-challenges/{c['challenge_id']}/status", json={"secret": "guess"})
    assert r.status_code == 404


def test_cannot_answer_someone_elses_challenge(client, staff, staff2):
    c = second_sign_in(client).json()
    assert client.post(f"/me/login-challenges/{c['challenge_id']}/allow", headers=staff2.auth).status_code == 404


def test_device_that_went_away_does_not_block_sign_in(client, db, staff):
    set_user(db, staff.id, session_seen_at=ago(sessions.SESSION_STALE_SECONDS + 5))
    r = second_sign_in(client)
    assert r.status_code == 200  # nobody left to ask


def test_device_goes_away_while_waiting(client, db, staff):
    c = second_sign_in(client).json()
    set_user(db, staff.id, session_seen_at=ago(sessions.SESSION_STALE_SECONDS + 5))
    assert poll(client, c).json()["status"] == "approved"


def test_unanswered_request_expires(client, db, staff):
    c = second_sign_in(client).json()
    set_challenge(db, c["challenge_id"], created_at=ago(sessions.CHALLENGE_SECONDS + 5))
    assert poll(client, c).json()["status"] == "expired"


def test_cancelled_request_disappears_without_a_log_entry(client, db, staff):
    c = second_sign_in(client).json()
    before = len(logs(db))
    r = client.post(f"/auth/login-challenges/{c['challenge_id']}/cancel", json={"secret": c["secret"]})
    assert r.status_code == 204
    assert client.get("/me/login-challenges", headers=staff.auth).json() == []
    assert len(logs(db)) == before
    assert client.post(f"/me/login-challenges/{c['challenge_id']}/allow", headers=staff.auth).status_code == 400


def test_abandoned_request_disappears(client, db, staff):
    """The new device's tab was closed without cancelling: it stops checking back."""
    c = second_sign_in(client).json()
    set_challenge(db, c["challenge_id"], polled_at=ago(sessions.ABANDONED_SECONDS + 3))
    assert client.get("/me/login-challenges", headers=staff.auth).json() == []


def test_at_most_three_attempts_in_five_minutes(client, staff):
    for _ in range(sessions.CHALLENGE_LIMIT):
        assert second_sign_in(client).status_code == 202
    assert second_sign_in(client).status_code == 429


def test_attempt_limit_resets_after_a_successful_sign_in(client, db, staff):
    for _ in range(sessions.CHALLENGE_LIMIT):
        second_sign_in(client)
    assert second_sign_in(client).status_code == 429
    client.post("/auth/logout", headers=staff.auth)
    new = login(client, "clerk")  # a real sign-in
    assert second_sign_in(client).status_code == 202
    assert new


def test_attempts_are_hidden_from_default_activity_log(client, admin, staff):
    second_sign_in(client)
    default = client.get("/activity-logs", headers=admin.auth).json()["items"]
    assert "login_challenge" not in {i["action"] for i in default}
    picked = client.get("/activity-logs?action=login_challenge", headers=admin.auth).json()["items"]
    assert len(picked) == 1


def test_logout_ends_session_so_next_sign_in_is_immediate(client, staff):
    assert client.post("/auth/logout", headers=staff.auth).status_code == 204
    assert client.get("/projects", headers=staff.auth).status_code == 401
    assert second_sign_in(client).status_code == 200


def test_sign_out_everywhere_invalidates_every_token(client, staff):
    assert client.post("/me/sign-out-everywhere", headers=staff.auth).status_code == 204
    assert client.get("/projects", headers=staff.auth).status_code == 401
    assert client.post("/auth/refresh", headers=staff.auth).status_code == 401
    login(client, "clerk")


def test_refresh_gives_working_token_for_same_session(client, staff):
    r = client.post("/auth/refresh", headers=staff.auth)
    assert r.status_code == 200
    fresh = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/projects", headers=fresh).status_code == 200
    assert client.get("/projects", headers=staff.auth).status_code == 200  # same session, still fine


def test_refresh_refused_after_session_was_replaced(client, staff):
    c = second_sign_in(client).json()
    client.post(f"/me/login-challenges/{c['challenge_id']}/allow", headers=staff.auth)
    assert client.post("/auth/refresh", headers=staff.auth).status_code == 401


def test_exempt_accounts_can_sign_in_many_times(client, monkeypatch):
    monkeypatch.setattr("security.SINGLE_SESSION_EXEMPT", {"loadtest"})
    make_user("loadtest")
    a, b = login(client, "loadtest"), login(client, "loadtest")
    assert client.get("/projects", headers=a).status_code == 200
    assert client.get("/projects", headers=b).status_code == 200


def test_describe_device():
    assert sessions.describe_device("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537 Edg/130") == "Edge on Windows"
    assert sessions.describe_device("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604") == "Safari on iPhone/iPad"
    assert sessions.describe_device("") == "A browser on an unknown device"


# ---------- Online status (Manage users) ----------

def status_of(client, admin, username):
    return next(u for u in client.get("/users", headers=admin.auth).json() if u["username"] == username)


def test_signed_in_user_shows_as_active(client, admin, staff):
    u = status_of(client, admin, "clerk")
    assert u["presence"] == "active" and u["last_seen"] and u["last_active"]


def test_never_signed_in_user_is_offline(client, admin):
    make_user("newcomer")
    u = status_of(client, admin, "newcomer")
    assert u["presence"] == "offline" and u["last_seen"] is None


def test_open_but_unused_shows_as_idle(client, db, admin, staff):
    set_user(db, staff.id, last_active_at=ago(sessions.IDLE_AFTER_SECONDS + 60))
    assert status_of(client, admin, "clerk")["presence"] == "idle"


def test_using_the_app_makes_idle_user_active_again(client, db, admin, staff):
    set_user(db, staff.id, last_active_at=ago(sessions.IDLE_AFTER_SECONDS + 60))
    client.post("/auth/refresh", headers=staff.auth)  # the app renews only after real activity
    assert status_of(client, admin, "clerk")["presence"] == "active"


def test_closed_app_shows_as_offline_with_last_seen(client, db, admin, staff):
    set_user(db, staff.id, session_seen_at=ago(sessions.SESSION_STALE_SECONDS + 5))
    u = status_of(client, admin, "clerk")
    assert u["presence"] == "offline" and u["last_seen"]


def test_signed_out_user_is_offline(client, admin, staff):
    client.post("/auth/logout", headers=staff.auth)
    assert status_of(client, admin, "clerk")["presence"] == "offline"


def test_staff_cannot_see_who_is_online(client, staff):
    assert client.get("/users", headers=staff.auth).status_code == 403


def test_staff_can_see_who_is_online(client, db, admin, staff):
    make_user("away")
    make_user("waiting", approved=False)
    make_user("former", active=False)
    set_user(db, admin.id, last_active_at=ago(sessions.IDLE_AFTER_SECONDS + 60))
    rows = client.get("/users/online", headers=staff.auth).json()
    assert [(r["username"], r["presence"]) for r in rows] == [("clerk", "active"), ("boss", "idle"), ("away", "offline")]
    # names, pictures and status only
    assert set(rows[0]) == {"id", "name", "username", "is_superuser", "avatar_version", "presence", "last_seen"}


def test_who_is_online_needs_sign_in(client):
    assert client.get("/users/online").status_code == 401


def test_exempt_account_shows_online_while_its_app_is_open(client, db, monkeypatch, admin):
    """Load-test accounts have no single session, but an open app still counts as online."""
    import live
    monkeypatch.setattr("security.SINGLE_SESSION_EXEMPT", {"loadtest"})
    uid = make_user("loadtest")
    login(client, "loadtest")
    assert status_of(client, admin, "loadtest")["presence"] == "offline"  # app not open yet
    assert live._still_allowed(uid, 0, None)  # what the live connection does every 30 s
    assert status_of(client, admin, "loadtest")["presence"] == "active"
    set_user(db, uid, session_seen_at=ago(sessions.SESSION_STALE_SECONDS + 5))
    assert status_of(client, admin, "loadtest")["presence"] == "offline"


def test_device_seen_is_written_at_most_every_15_seconds(client, db, staff):
    """Each open app reports every 30 s; many at once for one account mustn't pile up writes."""
    db.expire_all()
    first = db.get(models.User, staff.id).session_seen_at
    sessions.touch(db, staff.id, None)  # straight after sign-in: too soon, nothing written
    db.commit()
    db.expire_all()
    assert db.get(models.User, staff.id).session_seen_at == first
    set_user(db, staff.id, session_seen_at=ago(20))
    sessions.touch(db, staff.id, None)
    db.commit()
    db.expire_all()
    assert (datetime.now(timezone.utc) - db.get(models.User, staff.id).session_seen_at).total_seconds() < 5


def test_touch_skips_a_locked_row_instead_of_waiting(client, db, staff):
    import database
    set_user(db, staff.id, session_seen_at=ago(60))
    holder = database.SessionLocal()
    try:
        holder.query(models.User).filter_by(id=staff.id).with_for_update().one()  # row locked elsewhere
        other = database.SessionLocal()
        try:
            other.execute(text("SET lock_timeout = '2s'"))
            sessions.touch(other, staff.id, None)  # would raise after 2 s if it waited
            other.commit()
        finally:
            other.close()
    finally:
        holder.rollback()
        holder.close()
