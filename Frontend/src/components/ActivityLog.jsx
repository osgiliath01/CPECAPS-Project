import { useEffect, useRef, useState } from "react";
import { fmtDate, fmtStamp, money } from "../utils/format";
import DeletionRequests from "./DeletionRequests";
import PasswordResets from "./PasswordResets";

const TABS = [
  { key: "activity", label: "Activity" },
  { key: "archived", label: "Archived" },
  { key: "requests", label: "Requests" },
  { key: "resets", label: "Password resets" },
];

const ACTIONS = [
  ["", "All actions"],
  ["create", "Added entry"],
  ["update", "Edited entry"],
  ["archive", "Archived"],
  ["restore", "Restored"],
  ["archive_requested", "Archive requested"],
  ["archive_approved", "Archive approved"],
  ["archive_rejected", "Archive rejected"],
  ["edit_requested", "Edit requested"],
  ["edit_approved", "Edit approved"],
  ["edit_rejected", "Edit rejected"],
  ["project_create", "Created project"],
  ["project_archive", "Archived project"],
  ["project_restore", "Restored project"],
  ["purge", "Deleted permanently"],
  ["project_delete", "Deleted project"],
  ["register", "Registered"],
  ["login", "Signed in"],
  ["login_failed", "Failed sign-in"],
  ["password_change", "Changed password"],
  ["reset_requested", "Reset requested"],
  ["reset_approved", "Reset approved"],
  ["reset_rejected", "Reset rejected"],
  ["admin_reset", "Password reset by admin"],
  ["user_update", "Updated account"],
  ["user_delete", "Deleted account"],
  ["promote_admin", "Made admin"],
];
const ACTION_LABEL = Object.fromEntries(ACTIONS);

// Record types are logged separately, so each can be viewed on its own
const RECORD_TYPES = [
  ["", "All records"],
  ["disbursement", "Entries"],
  ["project", "Projects"],
  ["user", "Accounts"],
];
const PAGE = 50;

const show = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

function Changes({ details }) {
  const changes = details?.changes;
  return (
    <>
      {changes && Object.keys(changes).length > 0 && (
        <ul className="log-changes">
          {Object.entries(changes).map(([field, [before, after]]) => (
            <li key={field}>
              <strong>{field}</strong>: {show(before)} → {show(after)}
            </li>
          ))}
        </ul>
      )}
      {details?.reason && <p className="muted small log-reason">Reason: {details.reason}</p>}
      {details?.note && <p className="muted small log-reason">Admin's note: {details.note}</p>}
    </>
  );
}

function ActivityTab({ api }) {
  const [filters, setFilters] = useState({ entity_type: "", action: "", actor: "", q: "" });
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.listActivity({ ...filters, limit: PAGE, offset: page * PAGE }).then(
        (d) => live && (setData(d), setError("")),
        (e) => live && setError(e.message)
      );
    }, 250); // wait for typing to pause
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, filters, page]);

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(0);
  };

  const total = data?.total ?? 0;
  const from = total ? page * PAGE + 1 : 0;
  const to = Math.min((page + 1) * PAGE, total);

  return (
    <>
      <div className="log-filters">
        <select value={filters.entity_type} onChange={setFilter("entity_type")} aria-label="Record type">
          {RECORD_TYPES.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <select value={filters.action} onChange={setFilter("action")} aria-label="Action">
          {ACTIONS.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <input value={filters.actor} onChange={setFilter("actor")} placeholder="User" aria-label="User" />
        <input value={filters.q} onChange={setFilter("q")} placeholder="Search details" aria-label="Search details" />
      </div>

      {error && <p className="error">{error}</p>}
      {data === null ? (
        <p className="muted">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="muted">No activity found.</p>
      ) : (
        <div className="review-scroll">
          <table className="review-table">
            <thead>
              <tr><th>When</th><th>User</th><th>Action</th><th>Details</th></tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap small">{fmtStamp(a.created_at)}</td>
                  <td>{a.actor}</td>
                  <td>
                    <span className={`log-badge act-${a.action}`}>{ACTION_LABEL[a.action] || a.action}</span>
                  </td>
                  <td className="reason">
                    {a.summary}
                    <Changes details={a.details} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE && (
        <div className="log-pager">
          <span className="muted small">{from}–{to} of {total}</span>
          <button className="pill sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</button>
          <button className="pill sm" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>Older</button>
        </div>
      )}
    </>
  );
}

// Adds how long each archived item has left before it's deleted permanently
const DAY = 24 * 60 * 60 * 1000;
function withTimeLeft(rows) {
  const now = Date.now();
  return rows.map((r) => ({ ...r, days_left: (new Date(r.deletes_at) - now) / DAY }));
}

function TimeLeft({ item }) {
  const d = item.days_left;
  const label = d < 1 ? "Less than a day" : `${Math.floor(d)} day${Math.floor(d) === 1 ? "" : "s"} left`;
  return (
    <span className={`log-badge ${d <= 7 ? "act-archive" : ""}`} title={`Deletes permanently on ${fmtStamp(item.deletes_at)}`}>
      {label}
    </span>
  );
}

function ArchivedTab({ api, onChanged }) {
  const [projects, setProjects] = useState(null);
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);

  function fetchAll() {
    return Promise.all([api.listArchivedProjects(), api.listArchived()]).then(([p, e]) => {
      setProjects(withTimeLeft(p));
      setEntries(withTimeLeft(e));
      setError("");
    });
  }

  useEffect(() => {
    Promise.all([api.listArchivedProjects(), api.listArchived()]).then(
      ([p, e]) => {
        setProjects(withTimeLeft(p));
        setEntries(withTimeLeft(e));
      },
      (e) => setError(e.message)
    );
  }, [api]);

  async function restore(kind, item) {
    setBusy(`${kind}-${item.id}`);
    try {
      if (kind === "project") await api.restoreProject(item.id);
      else await api.restoreDisbursement(item.id);
      await fetchAll();
      onChanged?.(kind === "project" ? "Project restored with its entries." : "Entry restored.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (projects === null && !error) return <p className="muted">Loading…</p>;

  return (
    <>
      <p className="muted small archive-note">
        Archived items can be restored for 30 days. After that they're deleted permanently, and only their
        record in the Activity tab remains.
      </p>
      {error && <p className="error">{error}</p>}

      <h3 className="log-section">Projects</h3>
      {projects?.length === 0 ? (
        <p className="muted">No archived projects.</p>
      ) : (
        projects && (
          <div className="review-scroll">
            <table className="review-table">
              <thead>
                <tr><th>Project</th><th>Entries</th><th>Total</th><th>Archived</th><th>Deletes in</th><th /></tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.title}</strong></td>
                    <td>{p.entry_count}</td>
                    <td className="amount">{money(p.total_amount)}</td>
                    <td className="small">
                      {p.archived_by}
                      <br />
                      {p.archived_at && fmtStamp(p.archived_at)}
                    </td>
                    <td><TimeLeft item={p} /></td>
                    <td className="actions">
                      <button className="pill sm" disabled={busy === `project-${p.id}`} onClick={() => restore("project", p)}>
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <h3 className="log-section">Entries</h3>
      {entries?.length === 0 ? (
        <p className="muted">No archived entries.</p>
      ) : (
        entries && (
          <div className="review-scroll">
            <table className="review-table">
              <thead>
                <tr><th>Project</th><th>Date</th><th>CV#</th><th>Payee</th><th>Amount</th><th>Archived</th><th>Deletes in</th><th /></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.project_title}</td>
                    <td className="nowrap">{fmtDate(e.date)}</td>
                    <td>{e.cv_no}</td>
                    <td>{e.payee}</td>
                    <td className="amount">{money(e.amount)}</td>
                    <td className="small">
                      {e.archived_by}
                      <br />
                      {e.archived_at && fmtStamp(e.archived_at)}
                    </td>
                    <td><TimeLeft item={e} /></td>
                    <td className="actions">
                      <button className="pill sm" disabled={busy === `entry-${e.id}`} onClick={() => restore("entry", e)}>
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}

// Admin-only window: Activity, Archived entries and pending Archive requests.
export default function ActivityLog({ api, user, onClose, onChanged }) {
  const ref = useRef(null);
  const [tab, setTab] = useState("activity");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2>Activity Log</h2>
      <div className="log-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            className="log-tab"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="log-body">
        {tab === "activity" && <ActivityTab api={api} />}
        {tab === "archived" && <ArchivedTab api={api} onChanged={onChanged} />}
        {tab === "requests" && <DeletionRequests api={api} user={user} onChanged={onChanged} />}
        {tab === "resets" && <PasswordResets api={api} user={user} onChanged={onChanged} />}
      </div>

      <div className="dialog-actions">
        <button type="button" className="pill" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
