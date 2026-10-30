import { useEffect, useRef, useState } from "react";
import { fmtDate, money } from "../utils/format";

const TEMPLATE =
  "project_title,date,cv_no,payee,amount\n" +
  "Plant 1 Roof Replacement,2026-10-01,CV-26-0001,Calamba Concrete Products Inc.,125000.00\n";

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "disbursements_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// Admin-only: upload a CSV, check it, then import the valid rows.
export default function ImportDialog({ api, onClose, onImported }) {
  const ref = useRef(null);
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function choose(e) {
    const f = e.target.files?.[0];
    setFile(f || null);
    setReport(null);
    setError("");
    if (!f) return;
    setBusy("Checking the file…");
    try {
      setReport(await api.importDisbursements(f, "preview"));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function commit() {
    setBusy("Importing…");
    setError("");
    try {
      const res = await api.importDisbursements(file, "commit");
      onImported(res);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  const r = report;

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <h2>Import file</h2>
      <div className="log-body">
        <p className="muted small">
          Upload a CSV with the columns <code>project_title, date, cv_no, payee, amount</code>. Dates as YYYY-MM-DD
          (MM/DD/YYYY also works); amounts as plain numbers. New project titles are created automatically.{" "}
          <button type="button" className="link" onClick={downloadTemplate}>Download a template</button>
        </p>

        <label className="import-pick">
          CSV file
          <input type="file" accept=".csv,text/csv" onChange={choose} disabled={!!busy} />
        </label>

        {busy && <p className="muted" role="status">{busy}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        {r && !busy && (
          <>
            <div className="import-stats">
              <div><strong>{r.total_rows}</strong><span>rows found</span></div>
              <div className="ok"><strong>{r.valid_rows}</strong><span>ready to import</span></div>
              <div className={r.error_rows ? "bad" : ""}><strong>{r.error_rows}</strong><span>with problems</span></div>
              <div><strong>{money(r.total_amount)}</strong><span>total amount</span></div>
            </div>
            <p className="small">
              {r.new_projects.length > 0 && (
                <>
                  <strong>{r.new_projects.length}</strong> new project{r.new_projects.length === 1 ? "" : "s"} will be
                  created.{" "}
                </>
              )}
              {r.existing_projects > 0 && (
                <>
                  <strong>{r.existing_projects}</strong> existing project{r.existing_projects === 1 ? "" : "s"} will get
                  new entries.{" "}
                </>
              )}
              {r.first_date && (
                <>
                  Dates from {fmtDate(r.first_date)} to {fmtDate(r.last_date)}.
                </>
              )}
            </p>

            {r.new_projects.length > 0 && (
              <details className="import-details">
                <summary>New projects ({r.new_projects.length})</summary>
                <ul>{r.new_projects.map((t) => <li key={t}>{t}</li>)}</ul>
              </details>
            )}

            {r.error_rows > 0 && (
              <>
                <h3 className="log-section">Rows that will be skipped</h3>
                <div className="review-scroll">
                  <table className="review-table">
                    <thead><tr><th>Line</th><th>Problem</th></tr></thead>
                    <tbody>
                      {r.errors.map((e) => (
                        <tr key={e.line}><td>{e.line}</td><td className="reason">{e.message}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {r.error_rows > r.errors.length && (
                  <p className="muted small">Showing the first {r.errors.length} of {r.error_rows}.</p>
                )}
                <p className="muted small">Fix these in the file and choose it again, or import only the valid rows.</p>
              </>
            )}
          </>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="pill" onClick={onClose} disabled={busy === "Importing…"}>Cancel</button>
        <button
          type="button"
          className="pill primary"
          disabled={!r || r.valid_rows === 0 || !!busy}
          onClick={commit}
        >
          {busy === "Importing…"
            ? "Importing…"
            : r?.error_rows
              ? `Import ${r?.valid_rows ?? 0} valid rows`
              : `Import ${r?.valid_rows ?? ""} rows`}
        </button>
      </div>
    </dialog>
  );
}
