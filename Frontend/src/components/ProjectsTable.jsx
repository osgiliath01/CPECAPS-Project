import { useEffect, useMemo, useState } from "react";
import { cents, money } from "../utils/format";
import ConfirmDialog from "./ConfirmDialog";
import { usePagination } from "../hooks/usePagination";
import Pagination from "./Pagination";
import { plural, useSelection } from "../hooks/useSelection";
import { SelectAll, SelectOne, SelectionBar } from "./Selection";

const COLUMNS = [
  { key: "project_title", label: "PROJECT TITLE" },
  { key: "total", label: "TOTAL DISBURSEMENT AMOUNT" },
];


function groupByProject(entries, projects = []) {
  const map = new Map();

  // every project from the backend, so empty ones still show up
  for (const p of projects) {
    map.set(p.title.trim().toLowerCase(), {
      id: p.id,
      entry_count: p.entry_count ?? 0,
      project_title: p.title,
      total: 0,
      payees: [],
      cvs: [],
    });
  }

  for (const e of entries) {
    const key = e.project_title.trim().toLowerCase();
    let p = map.get(key);
    if (!p) {
      p = { project_title: e.project_title, total: 0, payees: [], cvs: [] };
      map.set(key, p);
    }
    p.total += cents(e.amount);
    p.payees.push(String(e.payee).toLowerCase());
    p.cvs.push(String(e.cv_no).toLowerCase());
  }
  return [...map.values()];
}

export default function VoucherControl({
  entries,
  projects,
  loading,
  q,
  fields,
  isAdmin,
  onNew,
  onView,
  onArchiveProject,
  onBulkArchiveProjects,
  onImport,
}) {
  const [sort, setSort] = useState({ key: "project_title", dir: "asc" });
  const [toDelete, setToDelete] = useState(null);
  // Admins: ticked projects, to archive several at once (by project id)
  const selection = useSelection();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const grouped = useMemo(() => groupByProject(entries, projects), [entries, projects]);
  useEffect(() => {
    selection.keepOnly(grouped.filter((p) => p.id != null).map((p) => p.id));
  }, [grouped]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = grouped.filter((p) => p.id != null && selection.has(p.id));

  async function runBulk() {
    setBulkBusy(true);
    const ok = await onBulkArchiveProjects(selection.list());
    setBulkBusy(false);
    setBulkOpen(false);
    if (ok) selection.clear();
  }

    const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const keys = fields.length ? fields : ["project_title", "payee", "cv_no"];
    const list = needle
      ? grouped.filter(
          (p) =>
            (keys.includes("project_title") && p.project_title.toLowerCase().includes(needle)) ||
            (keys.includes("payee") && p.payees.some((x) => x.includes(needle))) ||
            (keys.includes("cv_no") && p.cvs.some((x) => x.includes(needle)))
        )
      : grouped;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) =>
      sort.key === "project_title"
        ? a.project_title.localeCompare(b.project_title, undefined, { numeric: true }) * mul
        : (a.total - b.total) * mul
    );
  }, [grouped, q, fields, sort]);

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "project_title" ? "asc" : "desc" }
    );
  const ariaSort = (key) =>
    sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const arrow = (key) => (sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "");

  const pg = usePagination(rows, 10, `${q}|${fields.join()}`);

  return (
    <>
      <div className="page-head">
        <h1>Voucher Control</h1>
        <div className="head-actions">
          <button
            className="pill"
            disabled={!isAdmin}
            title={isAdmin ? "Import entries from a CSV file" : "Only admins can import files"}
            onClick={onImport}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Import File
          </button>
          <button className="pill create" onClick={onNew}>
            <span className="plus" aria-hidden="true">
              +
            </span>
            Create new project
          </button>
        </div>
      </div>

      <section className="panel" aria-label="Projects">
        {isAdmin && (
          <SelectionBar selection={selection} noun="project">
            <button type="button" className="pill sm danger" onClick={() => setBulkOpen(true)}>
              Archive selected
            </button>
          </SelectionBar>
        )}
        <table className="vtable">
          <thead>
            <tr>
              {isAdmin && (
                <th scope="col" className="col-select">
                  <SelectAll
                    pageIds={pg.pageItems.filter((p) => p.id != null).map((p) => p.id)}
                    selection={selection}
                  />
                </th>
              )}
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={ariaSort(c.key)} className={`col-${c.key}`}>
                  <button className="th-btn" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {arrow(c.key)}
                  </button>
                </th>
              ))}
              <th scope="col" className="col-actions">
                <span className="th-label">ACTIONS</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pg.pageItems.map((p) => (
              <tr key={p.project_title} className={p.id != null && selection.has(p.id) ? "row-ticked" : undefined}>
                {isAdmin && (
                  <td className="select-cell">
                    {p.id != null && (
                      <SelectOne id={p.id} selection={selection} label={`Select ${p.project_title}`} />
                    )}
                  </td>
                )}
                <td>{p.project_title}</td>
                <td className="amount">{money(p.total / 100)}</td>
                <td className="actions">
                  <button className="pill sm view" onClick={() => onView(p)}>
                    View
                  </button>
                  {isAdmin && p.id != null && (
                    <button className="pill sm danger" onClick={() => setToDelete(p)}>
                      Archive
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          page={pg.page}
          pageCount={pg.pageCount}
          pageSize={pg.pageSize}
          total={pg.total}
          onPage={pg.setPage}
          onPageSize={pg.setPageSize}
        />
        {loading && <p className="panel-msg">Loading projects…</p>}
        {!loading && grouped.length === 0 && (
          <p className="panel-msg">No projects yet. Use Create new record or Import File.</p>
        )}
        {!loading && grouped.length > 0 && rows.length === 0 && (
          <p className="panel-msg">No projects match “{q}”.</p>
        )}
      </section>
      {bulkOpen && (
        <ConfirmDialog
          title={`Archive ${plural(selection.count, "project")}?`}
          confirmLabel={bulkBusy ? "Working…" : "Archive"}
          confirmDisabled={bulkBusy}
          onCancel={() => setBulkOpen(false)}
          onConfirm={runBulk}
        >
          <p>
            Each project is archived together with all its entries (
            {chosen.reduce((n, p) => n + (p.entry_count || 0), 0)} in total). Pending requests on those entries are
            closed. They can be restored from Activity Log → Archived within 30 days; after that they're deleted
            permanently.
          </p>
          <ul className="bulk-list">
            {chosen.slice(0, 8).map((p) => (
              <li key={p.id}>{p.project_title}</li>
            ))}
            {chosen.length > 8 && <li className="muted">and {chosen.length - 8} more</li>}
          </ul>
        </ConfirmDialog>
      )}
      {toDelete && (
        <ConfirmDialog
          title="Archive project?"
          confirmLabel="Archive"
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            onArchiveProject(toDelete);
            setToDelete(null);
          }}
        >
          <p>
            Archive <strong>{toDelete.project_title}</strong>
            {toDelete.payees.length > 0 &&
              ` and its ${toDelete.payees.length} entr${toDelete.payees.length === 1 ? "y" : "ies"} (${money(toDelete.total / 100)})`}
            ? It will be hidden from Voucher Control and totals.
          </p>
          <p>
            An admin can restore it from Activity Log → Archived within <strong>30 days</strong>. After that it's
            deleted permanently.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}