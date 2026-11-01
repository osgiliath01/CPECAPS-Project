"""Excel export of a project and CSV import."""
import io
from decimal import Decimal

from openpyxl import load_workbook

from tests.conftest import add_entry, logs

CSV_HEADER = "project_title,date,cv_no,payee,amount\n"


def import_csv(client, who, text, mode="preview"):
    return client.post(f"/disbursements/import?mode={mode}", headers=who.auth,
                       files={"file": ("entries.csv", io.BytesIO(text.encode("utf-8")), "text/csv")})


# ---------- Export ----------

def test_export_is_a_real_excel_file_with_the_entries(client, db, admin, staff):
    add_entry(client, staff, cv_no="CV-2", amount="200.00", date="2026-10-02")
    add_entry(client, staff, cv_no="CV-1", amount="100.50", date="2026-10-01")
    r = client.get("/projects/Bamban Plant/export", headers=staff.auth)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml")
    assert ".xlsx" in r.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(r.content))
    assert "Entries" in wb.sheetnames
    cells = [c for row in wb["Entries"].iter_rows(values_only=True) for c in row if c is not None]
    text = " ".join(map(str, cells))
    assert "CV-1" in text and "CV-2" in text
    assert text.index("CV-1") < text.index("CV-2")  # oldest first
    numbers = [Decimal(str(c)) for c in cells if isinstance(c, (int, float))]
    assert Decimal("100.5") in numbers and Decimal("200") in numbers
    assert len(logs(db, "export")) == 1


def test_export_leaves_out_archived_entries(client, admin, staff):
    add_entry(client, staff, cv_no="CV-KEEP")
    gone = add_entry(client, staff, cv_no="CV-GONE")
    client.delete(f"/disbursements/{gone['id']}", headers=admin.auth)
    wb = load_workbook(io.BytesIO(client.get("/projects/Bamban Plant/export", headers=staff.auth).content))
    text = str(list(wb["Entries"].iter_rows(values_only=True)))
    assert "CV-KEEP" in text and "CV-GONE" not in text


def test_export_unknown_project_is_404(client, staff):
    assert client.get("/projects/Nope/export", headers=staff.auth).status_code == 404


def test_export_needs_sign_in(client, staff):
    add_entry(client, staff)
    assert client.get("/projects/Bamban Plant/export").status_code == 401


def test_export_neutralises_spreadsheet_formulas(client, staff):
    """A payee typed as =HYPERLINK(...) must not become a live formula in Excel."""
    add_entry(client, staff, payee='=HYPERLINK("http://evil.example","click")')
    wb = load_workbook(io.BytesIO(client.get("/projects/Bamban Plant/export", headers=staff.auth).content))
    for row in wb["Entries"].iter_rows():
        for cell in row:
            assert cell.data_type != "f", f"formula in {cell.coordinate}: {cell.value}"


# ---------- Import ----------

def test_import_is_admin_only(client, staff):
    assert import_csv(client, staff, CSV_HEADER).status_code == 403


def test_import_preview_saves_nothing(client, admin):
    r = import_csv(client, admin, CSV_HEADER + "Bamban Plant,2026-10-01,CV-1,Acme,\"1,500.00\"\n")
    body = r.json()
    assert r.status_code == 200 and body["valid_rows"] == 1 and body["imported"] == 0
    assert body["new_projects"] == ["Bamban Plant"]
    assert client.get("/disbursements/", headers=admin.auth).json() == []


def test_import_commit_saves_valid_rows_and_skips_bad_ones(client, db, admin):
    text = CSV_HEADER + (
        "Bamban Plant,2026-10-01,CV-1,Acme,1500.00\n"
        "Bamban Plant,10/02/2026,CV-2,Beta,250\n"
        "Bamban Plant,not-a-date,CV-3,Gamma,10\n"
        "Bamban Plant,2026-10-03,CV-4,Delta,-5\n"
        ",2026-10-03,CV-5,Echo,5\n"
    )
    body = import_csv(client, admin, text, mode="commit").json()
    assert body["imported"] == 2 and body["error_rows"] == 3
    assert {e["line"] for e in body["errors"]} == {4, 5, 6}
    rows = client.get("/disbursements/", headers=admin.auth).json()
    assert sorted(r["cv_no"] for r in rows) == ["CV-1", "CV-2"]
    assert len(logs(db, "import")) == 1


def test_import_needs_the_right_columns(client, admin):
    r = import_csv(client, admin, "title,when,amount\nx,2026-01-01,5\n")
    assert r.status_code == 400 and "Missing column" in r.json()["detail"]


def test_import_rejects_empty_file(client, admin):
    assert import_csv(client, admin, "").status_code == 400
