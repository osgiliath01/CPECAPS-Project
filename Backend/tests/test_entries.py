"""Projects and entries: adding, listing, totals, admin edits and their safety checks."""
from decimal import Decimal

import pytest

from tests.conftest import add_entry, logs


def entry_payload(**overrides):
    body = {"project_title": "Bamban Plant", "cv_no": "CV-001", "payee": "Acme Supply",
            "date": "2026-10-01", "amount": "1500.00"}
    body.update(overrides)
    return body


# ---------- Projects ----------

def test_create_project_and_list_it(client, staff):
    r = client.post("/projects", headers=staff.auth, json={"title": "Calamba Warehouse"})
    assert r.status_code == 201
    listed = client.get("/projects", headers=staff.auth).json()
    assert [(p["title"], Decimal(p["total_amount"]), p["entry_count"]) for p in listed] == \
        [("Calamba Warehouse", Decimal("0"), 0)]


def test_duplicate_project_title_is_refused(client, staff):
    client.post("/projects", headers=staff.auth, json={"title": "Calamba Warehouse"})
    assert client.post("/projects", headers=staff.auth, json={"title": "Calamba Warehouse"}).status_code == 400


def test_empty_project_title_is_refused(client, staff):
    assert client.post("/projects", headers=staff.auth, json={"title": ""}).status_code == 422


def test_project_totals_add_up(client, staff):
    add_entry(client, staff, cv_no="CV-1", amount="1000.10")
    add_entry(client, staff, cv_no="CV-2", amount="250.25")
    add_entry(client, staff, project="Other", cv_no="CV-3", amount="5.00")
    totals = {p["title"]: Decimal(p["total_amount"]) for p in client.get("/projects", headers=staff.auth).json()}
    assert totals == {"Bamban Plant": Decimal("1250.35"), "Other": Decimal("5.00")}
    summary = client.get("/projects/Bamban Plant/summary", headers=staff.auth).json()
    assert Decimal(summary["total_amount"]) == Decimal("1250.35")
    assert len(summary["entries"]) == 2


def test_summary_of_unknown_project_is_404(client, staff):
    assert client.get("/projects/Nope/summary", headers=staff.auth).status_code == 404


# ---------- Adding entries ----------

def test_anyone_can_add_an_entry_and_it_is_logged(client, db, staff):
    e = add_entry(client, staff)
    assert e["created_by"] == "clerk" and e["updated_by"] == "clerk"
    assert e["created_by_name"] == "Clerk Tester"
    assert [l.action for l in logs(db)][-2:] == ["project_create", "create"]


def test_adding_to_existing_project_does_not_create_another(client, db, staff):
    add_entry(client, staff, cv_no="CV-1")
    add_entry(client, staff, cv_no="CV-2")
    assert len(client.get("/projects", headers=staff.auth).json()) == 1
    assert len(logs(db, "project_create")) == 1


def test_entry_list_has_project_title_newest_first(client, staff):
    add_entry(client, staff, cv_no="CV-1")
    add_entry(client, staff, project="Second", cv_no="CV-2")
    rows = client.get("/disbursements/", headers=staff.auth).json()
    assert [(r["cv_no"], r["project_title"]) for r in rows] == [("CV-2", "Second"), ("CV-1", "Bamban Plant")]


def test_amounts_keep_centavos_exactly(client, staff):
    e = add_entry(client, staff, amount="0.10")
    add_entry(client, staff, cv_no="CV-2", amount="0.20")
    assert Decimal(e["amount"]) == Decimal("0.10")
    total = client.get("/projects/Bamban Plant/summary", headers=staff.auth).json()["total_amount"]
    assert Decimal(total) == Decimal("0.30")  # not 0.30000000000000004


@pytest.mark.parametrize("field,value", [
    ("amount", "0"),
    ("amount", "-50.00"),
    ("amount", "100000000.00"),   # bigger than the column holds
    ("amount", "12.345"),         # more than 2 decimal places
    ("amount", "abc"),
    ("payee", ""),
    ("payee", "   "),
    ("cv_no", ""),
    ("project_title", ""),
    ("date", "2026-13-40"),
])
def test_invalid_entries_are_refused(client, staff, field, value):
    r = client.post("/disbursements/", headers=staff.auth, json=entry_payload(**{field: value}))
    assert r.status_code == 422, r.text


def test_cannot_add_to_archived_project(client, admin, staff):
    add_entry(client, staff)
    pid = client.get("/projects", headers=admin.auth).json()[0]["id"]
    client.delete(f"/projects/{pid}", headers=admin.auth)
    r = client.post("/disbursements/", headers=staff.auth, json=entry_payload(cv_no="CV-9"))
    assert r.status_code == 400 and "archived" in r.json()["detail"]
    assert client.post("/projects", headers=staff.auth, json={"title": "Bamban Plant"}).status_code == 400


# ---------- Admin edits ----------

def test_staff_cannot_edit_directly(client, staff):
    e = add_entry(client, staff)
    r = client.patch(f"/disbursements/{e['id']}", headers=staff.auth, json={"payee": "X", "editor_name": "x"})
    assert r.status_code == 403


def test_admin_edit_changes_entry_and_logs_the_difference(client, db, admin, staff):
    e = add_entry(client, staff)
    r = client.patch(f"/disbursements/{e['id']}", headers=admin.auth,
                     json={"amount": "2000.00", "editor_name": admin.name})
    assert r.status_code == 200
    assert Decimal(r.json()["amount"]) == Decimal("2000.00")
    assert r.json()["created_by"] == "clerk"  # who created it never changes
    upd = logs(db, "update")
    assert len(upd) == 1 and "amount" in upd[0].details["changes"]


def test_edit_without_changes_is_not_logged(client, db, admin, staff):
    e = add_entry(client, staff)
    client.patch(f"/disbursements/{e['id']}", headers=admin.auth,
                 json={"payee": "Acme Supply", "editor_name": admin.name})
    assert logs(db, "update") == []


def test_edit_based_on_outdated_screen_is_refused(client, admin, admin2, staff):
    """Two admins open the same entry; the second save must not silently undo the first."""
    e = add_entry(client, staff)
    seen = {"amount": "1500.00"}
    first = client.patch(f"/disbursements/{e['id']}", headers=admin.auth,
                         json={"amount": "1600.00", "editor_name": "A", "original": seen})
    assert first.status_code == 200
    second = client.patch(f"/disbursements/{e['id']}", headers=admin2.auth,
                          json={"amount": "1700.00", "editor_name": "B", "original": seen})
    assert second.status_code == 409


def test_edit_unknown_entry_is_404(client, admin):
    assert client.patch("/disbursements/999", headers=admin.auth, json={"editor_name": "x"}).status_code == 404


def test_invalid_edit_values_are_refused(client, admin, staff):
    e = add_entry(client, staff)
    r = client.patch(f"/disbursements/{e['id']}", headers=admin.auth,
                     json={"amount": "-5", "editor_name": admin.name})
    assert r.status_code == 422


def test_spaces_around_text_are_removed(client, staff):
    e = add_entry(client, staff, cv_no="  CV-77 ", payee=" Acme  ")
    assert (e["cv_no"], e["payee"]) == ("CV-77", "Acme")


def test_blank_project_title_is_refused(client, staff):
    assert client.post("/projects", headers=staff.auth, json={"title": "   "}).status_code == 422
