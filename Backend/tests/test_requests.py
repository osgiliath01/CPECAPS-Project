"""Staff ask, admins decide: archive and edit requests."""
from decimal import Decimal

import models
from tests.conftest import add_entry, logs


def ask_archive(client, who, entry_id, reason="Duplicate entry"):
    return client.post(f"/disbursements/{entry_id}/deletion-request", headers=who.auth, json={"reason": reason})


def ask_edit(client, who, entry_id, **changes):
    return client.post(f"/disbursements/{entry_id}/edit-request", headers=who.auth,
                       json={**changes, "reason": "typo"})


def pending(client, admin):
    return client.get("/deletion-requests", headers=admin.auth).json()


# ---------- Archive requests ----------

def test_archive_request_needs_a_reason(client, staff):
    e = add_entry(client, staff)
    assert ask_archive(client, staff, e["id"], reason="").status_code == 422
    assert ask_archive(client, staff, e["id"], reason="ab").status_code == 422


def test_archive_request_changes_nothing_until_approved(client, admin, staff):
    e = add_entry(client, staff)
    assert ask_archive(client, staff, e["id"]).status_code == 201
    assert len(client.get("/disbursements/", headers=staff.auth).json()) == 1
    assert [r["request_type"] for r in pending(client, admin)] == ["archive"]


def test_only_one_pending_request_per_entry(client, staff, staff2):
    e = add_entry(client, staff)
    ask_archive(client, staff, e["id"])
    assert ask_archive(client, staff2, e["id"]).status_code == 409
    assert ask_edit(client, staff2, e["id"], payee="Other").status_code == 409


def test_approving_archive_request_archives_entry(client, admin, staff):
    e = add_entry(client, staff)
    rid = ask_archive(client, staff, e["id"]).json()["id"]
    r = client.post(f"/deletion-requests/{rid}/approve", headers=admin.auth, json={"note": "ok"})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert client.get("/disbursements/", headers=staff.auth).json() == []
    total = client.get("/projects", headers=staff.auth).json()[0]["total_amount"]
    assert Decimal(total) == 0


def test_rejecting_keeps_entry_and_tells_requester(client, admin, staff):
    e = add_entry(client, staff)
    rid = ask_archive(client, staff, e["id"]).json()["id"]
    r = client.post(f"/deletion-requests/{rid}/reject", headers=admin.auth, json={"note": "still needed"})
    assert r.json()["status"] == "rejected"
    mine = client.get("/my-requests", headers=staff.auth).json()
    assert mine[0]["review_note"] == "still needed" and mine[0]["requester_seen"] is False
    assert len(client.get("/disbursements/", headers=staff.auth).json()) == 1


def test_seen_clears_requester_badge(client, admin, staff):
    e = add_entry(client, staff)
    rid = ask_archive(client, staff, e["id"]).json()["id"]
    client.post(f"/deletion-requests/{rid}/reject", headers=admin.auth)
    assert client.post("/my-requests/seen", headers=staff.auth).json() == {"updated": 1}
    assert client.get("/my-requests", headers=staff.auth).json()[0]["requester_seen"] is True
    assert client.post("/my-requests/seen", headers=staff.auth).json() == {"updated": 0}


def test_request_cannot_be_decided_twice(client, admin, staff):
    e = add_entry(client, staff)
    rid = ask_archive(client, staff, e["id"]).json()["id"]
    client.post(f"/deletion-requests/{rid}/approve", headers=admin.auth)
    assert client.post(f"/deletion-requests/{rid}/reject", headers=admin.auth).status_code == 400


def test_admin_cannot_review_own_request(client, admin, admin2, staff):
    e = add_entry(client, staff)
    rid = ask_archive(client, admin, e["id"]).json()["id"]
    assert client.post(f"/deletion-requests/{rid}/approve", headers=admin.auth).status_code == 403
    assert client.post(f"/deletion-requests/{rid}/approve", headers=admin2.auth).status_code == 200


def test_staff_sees_only_own_requests(client, staff, staff2):
    a = add_entry(client, staff, cv_no="CV-1")
    b = add_entry(client, staff, cv_no="CV-2")
    ask_archive(client, staff, a["id"])
    ask_archive(client, staff2, b["id"])
    assert [r["cv_no"] for r in client.get("/my-requests", headers=staff.auth).json()] == ["CV-1"]


def test_cannot_request_on_archived_or_missing_entry(client, admin, staff):
    e = add_entry(client, staff)
    client.delete(f"/disbursements/{e['id']}", headers=admin.auth)
    assert ask_archive(client, staff, e["id"]).status_code == 400
    assert ask_archive(client, staff, 999).status_code == 404


# ---------- Edit requests ----------

def test_edit_request_records_before_and_after(client, admin, staff):
    e = add_entry(client, staff)
    r = ask_edit(client, staff, e["id"], amount="1750.00")
    assert r.status_code == 201
    fields = r.json()["changes"]["fields"]
    assert list(fields) == ["amount"]
    assert Decimal(str(fields["amount"][0])) == Decimal("1500.00")
    assert Decimal(str(fields["amount"][1])) == Decimal("1750.00")
    # nothing changes yet
    assert Decimal(client.get("/disbursements/", headers=staff.auth).json()[0]["amount"]) == Decimal("1500.00")


def test_edit_request_with_no_change_is_refused(client, staff):
    e = add_entry(client, staff)
    assert ask_edit(client, staff, e["id"], payee="Acme Supply").status_code == 400


def test_invalid_edit_request_is_refused(client, staff):
    e = add_entry(client, staff)
    assert ask_edit(client, staff, e["id"], amount="-1").status_code == 422
    assert ask_edit(client, staff, e["id"], payee="   ").status_code == 422


def test_approving_edit_request_applies_it(client, db, admin, staff):
    e = add_entry(client, staff)
    rid = ask_edit(client, staff, e["id"], payee="Acme Supply Inc.", amount="1750.00").json()["id"]
    assert client.post(f"/deletion-requests/{rid}/approve", headers=admin.auth).status_code == 200
    row = client.get("/disbursements/", headers=staff.auth).json()[0]
    assert row["payee"] == "Acme Supply Inc." and Decimal(row["amount"]) == Decimal("1750.00")
    assert row["updated_by"] == staff.name  # the requester's edit, applied by the admin
    assert len(logs(db, "edit_approved")) == 1


def test_stale_edit_request_is_refused(client, admin, staff, staff2):
    """An admin edited the entry after the request was made: approving must not undo that."""
    e = add_entry(client, staff)
    rid = ask_edit(client, staff2, e["id"], amount="1750.00").json()["id"]
    client.patch(f"/disbursements/{e['id']}", headers=admin.auth, json={"amount": "1600.00", "editor_name": "A"})
    assert client.post(f"/deletion-requests/{rid}/approve", headers=admin.auth).status_code == 409
    assert Decimal(client.get("/disbursements/", headers=staff.auth).json()[0]["amount"]) == Decimal("1600.00")


def test_edit_request_on_outdated_screen_is_refused(client, admin, staff):
    e = add_entry(client, staff)
    client.patch(f"/disbursements/{e['id']}", headers=admin.auth, json={"payee": "New", "editor_name": "A"})
    r = client.post(f"/disbursements/{e['id']}/edit-request", headers=staff.auth,
                    json={"payee": "Mine", "original": {"payee": "Acme Supply"}})
    assert r.status_code == 409


def test_archiving_entry_auto_rejects_its_pending_request(client, db, admin, staff):
    e = add_entry(client, staff)
    rid = ask_edit(client, staff, e["id"], payee="X").json()["id"]
    r = client.post("/disbursements/bulk-archive", headers=admin.auth, json={"ids": [e["id"]]})
    assert r.json()["done"] == 1
    db.expire_all()
    assert db.get(models.DeletionRequest, rid).status == "rejected"


def test_pending_list_filters_by_status(client, admin, staff):
    a = add_entry(client, staff, cv_no="CV-1")
    b = add_entry(client, staff, cv_no="CV-2")
    r1 = ask_archive(client, staff, a["id"]).json()["id"]
    ask_archive(client, staff, b["id"])
    client.post(f"/deletion-requests/{r1}/approve", headers=admin.auth)
    assert len(pending(client, admin)) == 1
    approved = client.get("/deletion-requests?status=approved", headers=admin.auth).json()
    assert [r["cv_no"] for r in approved] == ["CV-1"]
    assert client.get("/deletion-requests?status=bogus", headers=admin.auth).status_code == 422
