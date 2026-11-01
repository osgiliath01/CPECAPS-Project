import { useCallback, useEffect, useRef, useState } from "react";
import { fmtDate, fmtStamp, money } from "../utils/format";
import DeletionRequests from "./DeletionRequests";
import PasswordResets from "./PasswordResets";
import { CountBadge } from "./AdminMenu";
import Pagination from "./Pagination";
import ConfirmDialog from "./ConfirmDialog";
import { SelectAll, SelectOne, SelectionBar } from "./Selection";
import { bulkMessage, plural, useSelection } from "../hooks/useSelection";

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
  ["import", "Imported file"],
  ["export", "Exported to Excel"],
  ["backup", "Backup saved"],
  ["backup_failed", "Backup FAILED"],
  ["restore", "Database restored"],
  ["project_create", "Created project"],
  ["project_archive", "Archived project"],
  ["project_restore", "Restored project"],
  ["purge", "Deleted permanently"],
  ["permanent_delete", "Deleted permanently (by admin)"],
  ["project_delete", "Deleted project"],
  ["register", "Registered"],
  ["account_approved", "Account approved"],
  ["account_rejected", "Account rejected"],
  ["name_requested", "Name change requested"],
  ["name_approved", "Name change approved"],
  ["name_rejected", "Name change rejected"],
  ["name_request_cancelled", "Name request withdrawn"],
  ["name_change", "Changed name"],
  ["avatar_change", "Changed photo"],
  ["signed_out_everywhere", "Signed out everywhere"],
  ["logout", "Signed out"],
  ["login_challenge", "Sign-in from another device"],
  ["login_challenge_allowed", "Other device allowed"],
  ["login_challenge_denied", "Other device blocked"],
  ["login_challenge_cancelled", "Other device cancelled"],
  ["login", "Signed in"],
  ["login_failed", "Failed sign-in"],
  ["password_change", "Changed password"],
  ["reset_requested", "Reset requested"],
  ["reset_approved", "Reset approved"],
  ["reset_rejected", "Reset rejected"],
  ["admin_reset", "Password reset by admin"],
  ["user_update", "Updated account"],
  ["user_delete", "Deleted account"],
  ["chat", "Asked the assistant"],
  ["promote_admin", "Made admin"],
];
export const ACTION_LABEL = Object.fromEntries(ACTIONS);

// Record types are logged separately, so each can be viewed on its own
const RECORD_TYPES = [
  ["", "All records"],
  ["disbursement", "Entries"],
  ["project", "Projects"],
  ["user", "Accounts"],
  ["backup", "Backups"],
];
//const PAGE = 50;

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

function ActivityTab({ api, version }) {
  const [filters, setFilters] = useState({ entity_type: "", action: "", actor: "", q: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.listActivity({ ...filters, limit: pageSize, offset: (page - 1) * pageSize }).then(
        (d) => live && (setData(d), setError("")),
        (e) => live && setError(e.message)
      );
    }, 250); // wait for typing to pause
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, filters, page, pageSize, version]);

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  const total = data?.total ?? 0;
  //const from = total ? page * PAGE + 1 : 0;
  //const to = Math.min((page + 1) * PAGE, total);

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
          <table className="review-table feed">
            <thead>
              <tr><th>When</th><th>User</th><th>Action</th><th>Details</th></tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap small feed-when">{fmtStamp(a.created_at)}</td>
                  <td className="feed-user">{a.actor}</td>
                  <td className="feed-action">
                    <span className={`log-badge act-${a.action}`}>{ACTION_LABEL[a.action] || a.action}</span>
                  </td>
                  <td className="reason feed-details">
                    {a.summary}
                    <Changes details={a.details} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pageCount={Math.max(1, Math.ceil(total / pageSize))}
        pageSize={pageSize}
        total={total}
        onPage={setPage}
        onPageSize={(n) => { setPageSize(n); setPage(1); }}
        sizes={[10, 25, 50, 100]}
      />
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

function ArchivedTab({ api, version, onChanged }) {
  const [projects, setProjects] = useState(null);
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("projects"); // "projects" | "entries"
  // Ticked items, per list; and the permanent-delete confirmation ({ projects, entries } ids)
  const pickedProjects = useSelection();
  const pickedEntries = useSelection();
  const [toErase, setToErase] = useState(null);
  const [typed, setTyped] = useState("");

  const fetchAll = useCallback(
    () =>
      Promise.all([api.listArchivedProjects(), api.listArchived()]).then(([p, e]) => {
        setProjects(withTimeLeft(p));
        setEntries(withTimeLeft(e));
        pickedProjects.keepOnly(p.map((x) => x.id));
        pickedEntries.keepOnly(e.map((x) => x.id));
        setError("");
      }),
    [api] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    fetchAll().catch((e) => setError(e.message));
  }, [fetchAll, version]);

  const selection = kind === "projects" ? pickedProjects : pickedEntries;
  const list = kind === "projects" ? projects : entries;
  const noun = kind === "projects" ? "project" : "entry";
  const asPayload = (ids) => (kind === "projects" ? { projects: ids, entries: [] } : { projects: [], entries: ids });

  async function run(action, ids, verb) {
    setBusy(true);
    setError("");
    try {
      const res = await action(asPayload(ids));
      selection.clear();
      await fetchAll();
      onChanged?.(bulkMessage(res, noun, verb));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const restore = (ids) => run(api.restoreArchived, ids, kind === "projects" ? "restored with their entries" : "restored");
  const askErase = (ids) => {
    setTyped("");
    setToErase(ids);
  };
  async function erase() {
    const ids = toErase;
    setToErase(null);
    await run(api.deleteArchived, ids, "deleted permanently");
  }

  const erasing = toErase && list ? list.filter((x) => toErase.includes(x.id)) : [];
  const erasingEntries =
    kind === "projects" ? erasing.reduce((n, p) => n + (p.entry_count || 0), 0) : erasing.length;

  if (projects === null && !error) return <p className="muted">Loading…</p>;

  return (
    <>
      <p className="muted small archive-note">
        Archived items can be restored for 30 days, then they're deleted permanently. You can also delete them
        permanently now. Either way, a copy stays in the Activity tab's record of the deletion.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="seg" role="group" aria-label="Archived items">
        {[
          ["projects", "Projects", projects],
          ["entries", "Entries", entries],
        ].map(([key, label, items]) => (
          <button
            key={key}
            type="button"
            className="seg-btn"
            aria-pressed={kind === key}
            onClick={() => setKind(key)}
          >
            {label} <span className="seg-count">{items?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <SelectionBar selection={selection} noun={noun}>
        <button type="button" className="pill sm" disabled={busy} onClick={() => restore(selection.list())}>
          Restore selected
        </button>
        <button type="button" className="pill sm danger" disabled={busy} onClick={() => askErase(selection.list())}>
          Delete permanently
        </button>
      </SelectionBar>

      {kind === "projects" ? (
        projects?.length === 0 ? (
          <p className="muted">No archived projects.</p>
        ) : (
          projects && (
            <div className="review-scroll">
              <table className="review-table">
                <thead>
                  <tr>
                    <th className="col-select">
                      <SelectAll pageIds={projects.map((p) => p.id)} selection={pickedProjects} label="Select all archived projects" />
                    </th>
                    <th>Project</th><th>Entries</th><th>Total</th><th>Archived</th><th>Deletes in</th><th />
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id} className={pickedProjects.has(p.id) ? "row-ticked" : undefined}>
                      <td className="select-cell">
                        <SelectOne id={p.id} selection={pickedProjects} label={`Select ${p.title}`} />
                      </td>
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
                        <button className="pill sm" disabled={busy} onClick={() => restore([p.id])}>
                          Restore
                        </button>
                        <button className="pill sm danger" disabled={busy} onClick={() => askErase([p.id])}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )
      ) : entries?.length === 0 ? (
        <p className="muted">No archived entries.</p>
      ) : (
        entries && (
          <div className="review-scroll">
            <table className="review-table">
              <thead>
                <tr>
                  <th className="col-select">
                    <SelectAll pageIds={entries.map((e) => e.id)} selection={pickedEntries} label="Select all archived entries" />
                  </th>
                  <th>Project</th><th>Date</th><th>CV#</th><th>Payee</th><th>Amount</th><th>Archived</th><th>Deletes in</th><th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className={pickedEntries.has(e.id) ? "row-ticked" : undefined}>
                    <td className="select-cell">
                      <SelectOne id={e.id} selection={pickedEntries} label={`Select CV# ${e.cv_no}`} />
                    </td>
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
                      <button className="pill sm" disabled={busy} onClick={() => restore([e.id])}>
                        Restore
                      </button>
                      <button className="pill sm danger" disabled={busy} onClick={() => askErase([e.id])}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {toErase && (
        <ConfirmDialog
          title={`Delete ${plural(toErase.length, noun)} permanently?`}
          confirmLabel="Delete permanently"
          confirmDisabled={typed.trim().toUpperCase() !== "DELETE"}
          onCancel={() => setToErase(null)}
          onConfirm={erase}
        >
          <p>
            <strong>This can't be undone.</strong>{" "}
            {kind === "projects"
              ? `The ${plural(toErase.length, "project")} and all ${plural(erasingEntries, "entry")} in them will be erased now instead of after 30 days.`
              : `The ${plural(toErase.length, "entry")} will be erased now instead of after 30 days.`}{" "}
            A copy of what's deleted stays in the Activity Log.
          </p>
          <ul className="bulk-list">
            {erasing.slice(0, 8).map((x) => (
              <li key={x.id}>{kind === "projects" ? x.title : `CV# ${x.cv_no} · ${x.payee} · ${money(x.amount)}`}</li>
            ))}
            {erasing.length > 8 && <li className="muted">and {erasing.length - 8} more</li>}
          </ul>
          <label>
            Type <strong>DELETE</strong> to confirm
            <input value={typed} onChange={(ev) => setTyped(ev.target.value)} autoComplete="off" autoFocus />
          </label>
        </ConfirmDialog>
      )}
    </>
  );
}

// For User Panel
export function ActivityLogContent({ api, user, version, pending, onChanged }) {
  // Open on whatever is waiting for the admin, otherwise on the activity list
  const [tab, setTab] = useState(() =>
    pending?.requests ? "requests" : pending?.resets ? "resets" : "activity"
  );
  const counts = { requests: pending?.requests, resets: pending?.resets };

  return (
    <>
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
            {counts[t.key] > 0 && <CountBadge count={counts[t.key]} />}
          </button>
        ))}
      </div>

      <div className="log-body">
        {tab === "activity" && <ActivityTab api={api} version={version} />}
        {tab === "archived" && <ArchivedTab api={api} version={version} onChanged={onChanged} />}
        {tab === "requests" && <DeletionRequests api={api} user={user} version={version} onChanged={onChanged} />}
        {tab === "resets" && <PasswordResets api={api} user={user} version={version} onChanged={onChanged} />}
      </div>
    </>
  );
}

// Optional pop-up version: the same content in a window.
export default function ActivityLog({ api, user, version, pending, onClose, onChanged }) {
  const ref = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2>Activity Log</h2>
      <ActivityLogContent api={api} user={user} version={version} pending={pending} onChanged={onChanged} />
      <div className="dialog-actions">
        <button type="button" className="pill" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
