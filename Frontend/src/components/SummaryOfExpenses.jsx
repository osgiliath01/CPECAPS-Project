import { useMemo, useState } from "react";
import { cents, fmtDate, fmtStamp, money } from "../utils/format";
import ConfirmDialog from "./ConfirmDialog";
import { usePagination } from "../hooks/usePagination";
import Pagination from "./Pagination";

export default function SummaryOfExpenses({ summary, q, isAdmin, onBack, onNew, onEdit, onDelete, onRequestDelete }) {
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const [toDelete, setToDelete] = useState(null);
  const [reason, setReason] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = summary.entries.filter(
      (e) =>
        !needle || e.payee.toLowerCase().includes(needle) || e.cv_no.toLowerCase().includes(needle)
    );
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort.key === "amount") return (cents(a.amount) - cents(b.amount)) * mul;
      return (a.date.localeCompare(b.date) || a.id - b.id) * mul;
    });
  }, [summary, q, sort]);

  const shownTotal = rows.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const filtered = rows.length !== summary.entries.length;

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  const ariaSort = (key) =>
    sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "");

  const pg = usePagination(rows, 10, q);

  return (
    <>
      <div className="page-head">
        <div>
          <button className="backlink" onClick={onBack}>
            ← Back
          </button>
          <h1>Summary of Expenses</h1>
          <p className="project-name">{summary.project_title}</p>
        </div>
        <div className="head-actions">
          <button className="pill" disabled title="Export is not available yet"
          >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M12 15V3m0 0L8 7m4-4 4 4M4 17v3h16v-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
            Export CSV
          </button>
          <button className="pill create" onClick={onNew}>
            <span className="plus" aria-hidden="true">
              +
            </span>
            Add new record
          </button>
        </div>
      </div>

      <section className="panel" aria-label="Summary of expenses">
        <table className="vtable">
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort("date")}>
                <button className="th-btn" onClick={() => toggleSort("date")}>
                  DATE{arrow("date")}
                </button>
              </th>
              <th scope="col">
                <span className="th-label">CV#</span>
              </th>
              <th scope="col">
                <span className="th-label">PAYEE / PARTICULARS</span>
              </th>
              <th scope="col" aria-sort={ariaSort("amount")}>
                <button className="th-btn" onClick={() => toggleSort("amount")}>
                  AMOUNT{arrow("amount")}
                </button>
              </th>
              <th scope="col">
                <span className="th-label">CREATED BY</span>
              </th>
              <th scope="col">
                <span className="th-label">LAST EDITED</span>
              </th>
              <th scope="col" className="col-actions">
                <span className="th-label">ACTIONS</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pg.pageItems.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.date)}</td>
                <td>{e.cv_no}</td>
                <td>{e.payee}</td>
                <td className="amount">{money(e.amount)}</td>
                <td className="small">
                  {e.created_by.split(" | ").pop()}
                  <br />
                  {fmtStamp(e.created_at)}
                </td>
                <td className="small">
                  {e.updated_by}
                  <br />
                  {fmtStamp(e.updated_at)}
                </td>
                <td className="actions">
                  <button className="pill sm view" onClick={() => onEdit(e)}>
                    {isAdmin ? "Edit" : "Request edit"}
                  </button>
                  <button className="pill sm danger" onClick={() => { setReason(""); setToDelete(e); }}>
                    {isAdmin ? "Archive" : "Request archive"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                {filtered ? `Total of ${rows.length} shown` : "Total"}
              </th>
              <td className="amount">{money(shownTotal)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
        <Pagination
          page={pg.page}
          pageCount={pg.pageCount}
          pageSize={pg.pageSize}
          total={pg.total}
          onPage={pg.setPage}
          onPageSize={pg.setPageSize}
        />
        {summary.entries.length === 0 && <p className="panel-msg">This project has no entries.</p>}
        {summary.entries.length > 0 && rows.length === 0 && (
          <p className="panel-msg">No entries match “{q}”.</p>
        )}
      </section>
      {toDelete && (isAdmin ? (
        <ConfirmDialog
          title="Archive entry?"
          confirmLabel="Archive"
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            onDelete(toDelete);
            setToDelete(null);
          }}
        >
          <p>
            Archive CV# <strong>{toDelete.cv_no}</strong> ({toDelete.payee})? It will be removed from
            this project and its totals. An admin can restore it from Activity Log → Archived within 30 days;
            after that it's deleted permanently.
          </p>
        </ConfirmDialog>
      ) : (
        <ConfirmDialog
          title="Request archive?"
          confirmLabel="Send request"
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            if (reason.trim().length < 3) return;
            onRequestDelete(toDelete, reason.trim());
            setToDelete(null);
          }}
        >
          <p>
            An admin will review your request to archive CV# <strong>{toDelete.cv_no}</strong> ({toDelete.payee}).
          </p>
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Duplicate entry"
              autoFocus
            />
          </label>
        </ConfirmDialog>
      ))}
    </>
  );
}