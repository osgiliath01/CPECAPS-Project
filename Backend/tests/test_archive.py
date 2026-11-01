"""Archiving, restoring, permanent delete, bulk actions and the 30-day clean-up."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import activity
import models
from tests.conftest import add_entry, logs


def project_id(client, who, title="Bamban Plant"):
    return next(p["id"] for p in client.get("/projects", headers=who.auth).json() if p["title"] == title)


def test_archived_entry_leaves_lists_and_totals(client, admin, staff):
    e = add_entry(client, staff)
    add_entry(client, staff, cv_no="CV-2", amount="100.00")
    assert client.delete(f"/disbursements/{e['id']}?reason=dup", headers=admin.auth).status_code == 204
    assert [r["cv_no"] for r in client.get("/disbursements/", headers=staff.auth).json()] == ["CV-2"]
    assert Decimal(client.get("/projects", headers=staff.auth).json()[0]["total_amount"]) == Decimal("100.00")
    archived = client.get("/disbursements/archived", headers=admin.auth).json()
    assert [a["cv_no"] for a in archived] == ["CV-001"]


def test_archiving_twice_is_refused(client, admin, staff):
    e = add_entry(client, staff)
    client.delete(f"/disbursements/{e['id']}", headers=admin.auth)
    assert client.delete(f"/disbursements/{e['id']}", headers=admin.auth).status_code == 400


def test_archived_entry_cannot_be_edited(client, admin, staff):
    e = add_entry(client, staff)
    client.delete(f"/disbursements/{e['id']}", headers=admin.auth)
    r = client.patch(f"/disbursements/{e['id']}", headers=admin.auth, json={"payee": "x", "editor_name": "A"})
    assert r.status_code == 400


def test_restore_entry_brings_it_back(client, admin, staff):
    e = add_entry(client, staff)
    client.delete(f"/disbursements/{e['id']}", headers=admin.auth)
    assert client.post(f"/disbursements/{e['id']}/restore", headers=admin.auth).status_code == 204
    assert len(client.get("/disbursements/", headers=staff.auth).json()) == 1
    assert client.post(f"/disbursements/{e['id']}/restore", headers=admin.auth).status_code == 400


def test_archiving_project_archives_its_entries(client, admin, staff):
    add_entry(client, staff)
    add_entry(client, staff, cv_no="CV-2")
    pid = project_id(client, admin)
    assert client.delete(f"/projects/{pid}", headers=admin.auth).status_code == 204
    assert client.get("/projects", headers=staff.auth).json() == []
    assert client.get("/disbursements/", headers=staff.auth).json() == []
    assert client.get("/projects/Bamban Plant/summary", headers=staff.auth).status_code == 404
    # entries archived with their project are listed under the project, not on their own
    assert client.get("/disbursements/archived", headers=admin.auth).json() == []
    assert len(client.get("/projects/archived", headers=admin.auth).json()) == 1


def test_restoring_project_keeps_separately_archived_entries_archived(client, admin, staff):
    a = add_entry(client, staff)
    add_entry(client, staff, cv_no="CV-2")
    client.delete(f"/disbursements/{a['id']}", headers=admin.auth)  # archived on its own first
    pid = project_id(client, admin)
    client.delete(f"/projects/{pid}", headers=admin.auth)
    assert client.post(f"/projects/{pid}/restore", headers=admin.auth).status_code == 204
    assert [r["cv_no"] for r in client.get("/disbursements/", headers=staff.auth).json()] == ["CV-2"]


def test_entry_of_archived_project_cannot_be_restored_alone(client, admin, staff):
    e = add_entry(client, staff)
    client.delete(f"/projects/{project_id(client, admin)}", headers=admin.auth)
    assert client.post(f"/disbursements/{e['id']}/restore", headers=admin.auth).status_code == 400


# ---------- Bulk ----------

def test_bulk_archive_reports_done_and_skipped(client, admin, staff):
    a = add_entry(client, staff, cv_no="CV-1")
    b = add_entry(client, staff, cv_no="CV-2")
    client.delete(f"/disbursements/{b['id']}", headers=admin.auth)
    r = client.post("/disbursements/bulk-archive", headers=admin.auth,
                    json={"ids": [a["id"], b["id"], 999, a["id"]], "reason": "cleanup"})
    body = r.json()
    assert body["done"] == 1
    assert len(body["skipped"]) == 2  # already archived + not found (duplicate id counted once)


def test_bulk_archive_needs_ids(client, admin):
    assert client.post("/disbursements/bulk-archive", headers=admin.auth, json={"ids": []}).status_code == 422


def test_bulk_archive_request_by_staff(client, admin, staff):
    a = add_entry(client, staff, cv_no="CV-1")
    b = add_entry(client, staff, cv_no="CV-2")
    client.post(f"/disbursements/{b['id']}/deletion-request", headers=staff.auth, json={"reason": "dup"})
    r = client.post("/disbursements/bulk-archive-request", headers=staff.auth,
                    json={"ids": [a["id"], b["id"]], "reason": "duplicates"})
    assert r.json()["done"] == 1 and "pending" in r.json()["skipped"][0]
    assert len(client.get("/deletion-requests", headers=admin.auth).json()) == 2
    assert len(client.get("/disbursements/", headers=staff.auth).json()) == 2  # nothing archived yet


def test_bulk_archive_request_needs_reason(client, staff):
    a = add_entry(client, staff)
    r = client.post("/disbursements/bulk-archive-request", headers=staff.auth, json={"ids": [a["id"]]})
    assert r.status_code == 422


def test_bulk_archive_and_restore_projects(client, admin, staff):
    add_entry(client, staff, project="P1", cv_no="CV-1")
    add_entry(client, staff, project="P2", cv_no="CV-2")
    ids = [p["id"] for p in client.get("/projects", headers=admin.auth).json()]
    assert client.post("/projects/bulk-archive", headers=admin.auth, json={"ids": ids}).json()["done"] == 2
    assert client.get("/projects", headers=staff.auth).json() == []
    r = client.post("/archived/restore", headers=admin.auth, json={"projects": ids})
    assert r.json() == {"done": 2, "skipped": []}
    assert len(client.get("/disbursements/", headers=staff.auth).json()) == 2


# ---------- Permanent delete ----------

def test_permanent_delete_only_for_archived_items(client, db, admin, staff):
    a = add_entry(client, staff, cv_no="CV-1")
    b = add_entry(client, staff, cv_no="CV-2")
    client.delete(f"/disbursements/{a['id']}", headers=admin.auth)
    r = client.post("/archived/delete", headers=admin.auth, json={"entries": [a["id"], b["id"]]})
    assert r.json()["done"] == 1 and "isn't archived" in r.json()["skipped"][0]
    db.expire_all()
    assert db.get(models.Disbursement, a["id"]) is None
    assert db.get(models.Disbursement, b["id"]) is not None
    # the Activity Log keeps a copy of what was deleted
    deleted = logs(db, "permanent_delete")
    assert len(deleted) == 1 and "CV-1" in str(deleted[0].details)


def test_permanent_delete_of_project_removes_its_entries(client, db, admin, staff):
    add_entry(client, staff)
    pid = project_id(client, admin)
    client.delete(f"/projects/{pid}", headers=admin.auth)
    assert client.post("/archived/delete", headers=admin.auth, json={"projects": [pid]}).json()["done"] == 1
    db.expire_all()
    assert db.query(models.Disbursement).count() == 0
    assert db.get(models.Project, pid) is None


def test_purge_removes_only_items_archived_over_30_days_ago(client, db, admin, staff):
    old = add_entry(client, staff, cv_no="CV-OLD")
    new = add_entry(client, staff, cv_no="CV-NEW")
    client.delete(f"/disbursements/{old['id']}", headers=admin.auth)
    client.delete(f"/disbursements/{new['id']}", headers=admin.auth)
    long_ago = datetime.now(timezone.utc) - timedelta(days=activity.RETENTION_DAYS + 1)
    db.query(models.Disbursement).filter_by(id=old["id"]).update({"archived_at": long_ago})
    db.commit()
    assert activity.purge_expired(db) == 1
    db.commit()
    db.expire_all()
    assert db.get(models.Disbursement, old["id"]) is None
    assert db.get(models.Disbursement, new["id"]) is not None


def test_activity_log_is_admin_only_and_filterable(client, admin, staff):
    add_entry(client, staff)
    page = client.get("/activity-logs?actor=clerk&action=create", headers=admin.auth).json()
    assert page["total"] == 1 and page["items"][0]["actor"] == "clerk"
    assert client.get("/activity-logs?q=Acme", headers=admin.auth).json()["total"] >= 1
