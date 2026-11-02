"""The User Panel (profile, picture, name changes, activity, stats) and Manage users."""
import io

import models
from tests.conftest import add_entry, login, logs

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def upload(client, who, data, name="me.png", ctype="image/png"):
    return client.put("/me/avatar", headers=who.auth, files={"file": (name, io.BytesIO(data), ctype)})


# ---------- Picture ----------

def test_upload_and_fetch_picture(client, staff, staff2):
    assert client.get("/me/profile", headers=staff.auth).json()["avatar_version"] is None
    assert upload(client, staff, PNG).status_code == 204
    assert client.get("/me/profile", headers=staff.auth).json()["avatar_version"]
    r = client.get(f"/avatars/{staff.id}", headers=staff2.auth)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == PNG


def test_picture_type_is_checked_from_its_bytes(client, staff):
    assert upload(client, staff, b"<svg onload=alert(1)>", name="x.png", ctype="image/png").status_code in (400, 415)
    assert upload(client, staff, b"MZ\x90\x00 not an image", name="x.jpg", ctype="image/jpeg").status_code in (400, 415)
    assert upload(client, staff, JPEG, name="looks.txt", ctype="text/plain").status_code == 204


def test_picture_over_1mb_is_refused(client, staff):
    assert upload(client, staff, PNG + b"\x00" * (1024 * 1024)).status_code == 413


def test_remove_picture(client, staff):
    upload(client, staff, PNG)
    assert client.delete("/me/avatar", headers=staff.auth).status_code == 204
    assert client.get(f"/avatars/{staff.id}", headers=staff.auth).status_code == 404


def test_pictures_need_sign_in(client, staff):
    upload(client, staff, PNG)
    assert client.get(f"/avatars/{staff.id}").status_code == 401


# ---------- Name changes ----------

def test_admin_name_change_applies_right_away(client, admin):
    r = client.post("/me/name", headers=admin.auth, json={"new_name": "Maria  Santos"})
    assert r.json()["applied"] is True
    assert client.get("/me/profile", headers=admin.auth).json()["name"] == "Maria Santos"


def test_staff_name_change_waits_for_approval(client, admin, staff):
    r = client.post("/me/name", headers=staff.auth, json={"new_name": "Juan Dela Cruz"})
    assert r.json()["applied"] is False
    profile = client.get("/me/profile", headers=staff.auth).json()
    assert profile["name"] == staff.name and profile["name_request"]["status"] == "pending"
    rid = client.get("/name-requests", headers=admin.auth).json()[0]["id"]
    assert client.post(f"/name-requests/{rid}/approve", headers=admin.auth).status_code == 204
    assert client.get("/me/profile", headers=staff.auth).json()["name"] == "Juan Dela Cruz"


def test_new_name_request_replaces_waiting_one(client, admin, staff):
    client.post("/me/name", headers=staff.auth, json={"new_name": "First Try"})
    client.post("/me/name", headers=staff.auth, json={"new_name": "Second Try"})
    waiting = client.get("/name-requests", headers=admin.auth).json()
    assert [w["new_name"] for w in waiting] == ["Second Try"]


def test_rejected_name_stays_the_same(client, admin, staff):
    client.post("/me/name", headers=staff.auth, json={"new_name": "Nope Name"})
    rid = client.get("/name-requests", headers=admin.auth).json()[0]["id"]
    client.post(f"/name-requests/{rid}/reject", headers=admin.auth, json={"note": "use your legal name"})
    profile = client.get("/me/profile", headers=staff.auth).json()
    assert profile["name"] == staff.name
    assert profile["name_request"]["status"] == "rejected"
    assert profile["name_request"]["review_note"] == "use your legal name"


def test_withdraw_name_request(client, admin, staff):
    client.post("/me/name", headers=staff.auth, json={"new_name": "Changed Mind"})
    assert client.delete("/me/name", headers=staff.auth).status_code == 204
    assert client.get("/name-requests", headers=admin.auth).json() == []


def test_name_change_rules(client, staff):
    assert client.post("/me/name", headers=staff.auth, json={"new_name": "ab"}).status_code == 422
    assert client.post("/me/name", headers=staff.auth, json={"new_name": "  ab    "}).status_code == 400
    assert client.post("/me/name", headers=staff.auth, json={"new_name": staff.name}).status_code == 400


def test_new_name_shows_on_entries(client, admin, staff):
    e = add_entry(client, staff)
    client.post("/me/name", headers=staff.auth, json={"new_name": "Juan Dela Cruz"})
    rid = client.get("/name-requests", headers=admin.auth).json()[0]["id"]
    client.post(f"/name-requests/{rid}/approve", headers=admin.auth)
    row = client.get("/disbursements/", headers=admin.auth).json()[0]
    assert row["id"] == e["id"] and row["created_by_name"] == "Juan Dela Cruz"


# ---------- My Activity, security, stats ----------

def test_my_activity_shows_only_my_things(client, staff, staff2):
    add_entry(client, staff, cv_no="CV-1")
    add_entry(client, staff2, cv_no="CV-2")
    page = client.get("/me/activity", headers=staff.auth).json()
    text = str(page)
    assert "CV-1" in text and "CV-2" not in text


def test_my_activity_can_hide_sign_ins(client, staff):
    page = client.get("/me/activity?signins=false", headers=staff.auth).json()
    assert "login" not in str([i.get("action") for i in page["items"]])


def test_my_security_counts_failed_sign_ins(client, staff):
    client.post("/token", data={"username": "clerk", "password": "wrong"})
    info = client.get("/me/security", headers=staff.auth).json()
    assert info["failed_last_30_days"] == 1
    assert info["locked_minutes"] == 0


def test_my_stats(client, admin, staff):
    add_entry(client, staff, cv_no="CV-1", amount="100.00", date="2026-01-05")
    add_entry(client, staff, project="Other", cv_no="CV-2", amount="50.50")
    e = add_entry(client, staff, cv_no="CV-3", amount="10.00")
    client.post(f"/disbursements/{e['id']}/deletion-request", headers=staff.auth, json={"reason": "dup"})
    stats = client.get("/me/stats", headers=staff.auth).json()
    assert stats["entries_total"] == 3
    assert float(stats["amount_total"]) == 160.50
    assert stats["projects_total"] == 2
    assert stats["requests_pending"] == 1
    assert stats["reviews_this_month"] is None  # staff don't review
    assert client.get("/me/stats", headers=admin.auth).json()["reviews_this_month"] == 0


# ---------- Manage users ----------

def test_user_list_has_last_sign_in(client, admin, staff):
    users = {u["username"]: u for u in client.get("/users", headers=admin.auth).json()}
    assert set(users) == {"boss", "clerk"}
    assert users["clerk"]["last_login"] is not None


def test_make_admin_and_back(client, admin, staff):
    assert client.patch(f"/users/{staff.id}", headers=admin.auth, json={"is_superuser": True}).status_code == 204
    assert client.get("/users", headers=staff.auth).status_code == 200
    assert client.patch(f"/users/{staff.id}", headers=admin.auth, json={"is_superuser": False}).status_code == 204
    assert client.get("/users", headers=staff.auth).status_code == 403


def test_admin_cannot_demote_deactivate_or_delete_self(client, admin, admin2):
    assert client.patch(f"/users/{admin.id}", headers=admin.auth, json={"is_superuser": False}).status_code == 400
    assert client.patch(f"/users/{admin.id}", headers=admin.auth, json={"is_active": False}).status_code == 400
    assert client.delete(f"/users/{admin.id}", headers=admin.auth).status_code == 400


def test_admin_can_demote_another_admin(client, admin, admin2):
    assert client.patch(f"/users/{admin2.id}", headers=admin.auth, json={"is_superuser": False}).status_code == 204
    assert client.get("/users", headers=admin2.auth).status_code == 403


def test_last_active_admin_guard(db, admin):
    """The API can't reach this today (you can't change yourself, and anyone else doing it is an
    admin too), but the guard stays as a safety net."""
    import pytest
    from fastapi import HTTPException
    import users_admin
    lone = db.get(models.User, admin.id)
    with pytest.raises(HTTPException) as e:
        users_admin._guard_last_admin(db, lone, "delete")
    assert e.value.status_code == 400


def test_delete_user_keeps_their_entries(client, db, admin, staff):
    add_entry(client, staff)
    assert client.delete(f"/users/{staff.id}", headers=admin.auth).status_code == 204
    rows = client.get("/disbursements/", headers=admin.auth).json()
    assert rows[0]["created_by"] == "clerk"
    assert len(logs(db, "user_delete")) == 1


def test_rename_user(client, admin, staff):
    client.patch(f"/users/{staff.id}", headers=admin.auth, json={"name": "Renamed Person"})
    assert client.get("/me/profile", headers=staff.auth).json()["name"] == "Renamed Person"
