import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { fmtStamp, timeAgo } from "../utils/format";
import Avatar from "./Avatar";

// Admin-only: every account, with controls for the selected one.
// The content on its own, so it can sit inside a tab of the User Panel.
const REFRESH_MS = 30 * 1000; // online status is re-checked this often while the list is open

export function UsersContent({ api, user, version, onChanged }) {
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listUsers().then(setUsers, (e) => setError(e.message));
  }, [api, version]);

  // Keep the online status current while the tab is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") api.listUsers().then(setUsers, () => {});
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [api]);

  async function reload() {
    setUsers(await api.listUsers());
  }

  const counts = useMemo(() => {
    const c = { active: 0, idle: 0 };
    (users || []).forEach((u) => {
      if (u.presence in c) c[u.presence] += 1;
    });
    return c;
  }, [users]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = users;
    if (list && onlineOnly) list = list.filter((u) => u.presence !== "offline");
    if (!list || !needle) return list;
    return list.filter((u) => u.name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle));
  }, [users, q, onlineOnly]);

  const selected = users?.find((u) => u.id === selectedId) || null;

  const COLUMNS = 5; // number of <th> cells in the header

  const detailPanel = selected && (
    selected.is_approved ? (
      <UserDetails
        key={selected.id}
        api={api}
        target={selected}
        isSelf={selected.id === user.id}
        onDone={async (msg, deleted) => {
          if (deleted) setSelectedId(null);
          await reload();
          onChanged?.(msg);
        }}
      />
    ) : (
      <ApprovalPanel
        key={selected.id}
        api={api}
        target={selected}
        onDone={async (msg) => {
          setSelectedId(null);
          await reload();
          onChanged?.(msg);
        }}
      />
    )
  );

  return (
    <>
      {users && <OnlineSummary counts={counts} total={users.length} />}
      <div className="log-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or username" aria-label="Search users" />
        <label className="feed-toggle online-toggle">
          <input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} />
          Online now only
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {shown === null && !error ? (
        <p className="muted">Loading…</p>
      ) : shown?.length === 0 ? (
        <p className="muted">{onlineOnly && !q.trim() ? "Nobody has the app open right now." : "No users found."}</p>
      ) : (
        shown && (
          <div className="review-scroll">
            <table className="review-table">
              <thead>
                <tr><th>User</th><th>Role</th><th>Status</th><th>Online</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <Fragment key={u.id}>
                    <tr key={u.id} className={u.id === selectedId ? "row-selected" : undefined}>
                      <td>
                        <div className="who">
                          <PresenceAvatar api={api} u={u} />
                          <div>
                            <strong>{u.name}</strong>
                            {u.id === user.id ? " (you)" : ""}
                            <br />
                            <span className="small muted">@{u.username}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`log-badge ${u.is_superuser ? "st-pending" : ""}`}>{u.is_superuser ? "Admin" : "User"}</span>
                      </td>
                      <td>
                        {!u.is_approved ? (
                          <span className="log-badge st-pending">Waiting for approval</span>
                        ) : (
                          <span className={`log-badge ${u.is_active ? "st-approved" : "st-rejected"}`}>
                            {u.is_active ? "Active" : "Deactivated"}
                          </span>
                        )}
                        {u.must_change_password && <><br /><span className="small muted">Temporary password</span></>}
                      </td>
                      <td className="small">
                        <Presence u={u} />
                      </td>
                      <td className="actions">
                        <button
                          className={`pill sm ${!u.is_approved && u.id !== selectedId ? "primary" : ""}`}
                          onClick={() => setSelectedId(u.id === selectedId ? null : u.id)}
                        >
                          {u.id === selectedId ? "Close" : u.is_approved ? "Manage" : "Review"}
                        </button>
                      </td>
                    </tr>
                    {u.id === selectedId && (
                      <tr className="row-detail">
                        <td colSpan={COLUMNS}>{detailPanel}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}

// Optional pop-up version: the same content in a window.
export default function UsersDialog({ api, user, version, onClose, onChanged }) {
  const ref = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <button type="button" className="dialog-x" onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      <h2>Manage Users</h2>
      <div className="log-body">
        <UsersContent api={api} user={user} version={version} onChanged={onChanged} />
      </div>
    </dialog>
  );
}

// A new account made through Create account: let it in, or remove it (which frees the username)
function ApprovalPanel({ api, target, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(action, message) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onDone(message);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <section className="user-panel" aria-label={`Review ${target.name}`}>
      <h3 className="log-section">
        {target.name} <span className="muted small">@{target.username}</span>
      </h3>
      <p className="muted small">
        {target.name} created this account on {fmtStamp(target.created_at)}. It can't sign in until it's approved. Approve it only if you
        know who this is. Rejecting removes the account, so the username can be used again.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="user-actions">
        <button
          className="pill sm primary"
          disabled={busy}
          onClick={() => decide(() => api.approveUser(target.id), `${target.username} can now sign in.`)}
        >
          Approve
        </button>
        <button
          className="pill sm danger"
          disabled={busy}
          onClick={() => decide(() => api.rejectUser(target.id), `New account ${target.username} was rejected.`)}
        >
          Reject
        </button>
      </div>
    </section>
  );
}

// Controls for one approved account (renamed from UserPanel, to avoid confusion with the page)
function UserDetails({ api, target, isSelf, onDone }) {
  const [name, setName] = useState(target.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [temp, setTemp] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");

  async function run(action, message, deleted = false) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      await onDone(message, deleted);
      return result;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const update = (body, message) => run(() => api.updateUser(target.id, body), message);

  async function resetPassword() {
    const res = await run(() => api.resetUserPassword(target.id), `Password reset for ${target.username}.`);
    if (res) {
      setTemp(res.temporary_password);
      setCopied(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(temp);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const nameChanged = name.trim() !== target.name && name.trim().length >= 3;

  return (
    <section className="user-panel" aria-label={`Manage ${target.name}`}>
      <h3 className="log-section">
        {target.name} <span className="muted small">@{target.username}</span>
      </h3>
      {isSelf && <p className="muted small">This is your account. Use Change password on your User Panel for your own password.</p>}
      {error && <p className="error">{error}</p>}

      <div className="user-row">
        <label className="user-name">
          Full name
          <input value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={50} />
        </label>
        <button className="pill sm" disabled={busy || !nameChanged} onClick={() => update({ name: name.trim() }, "Name updated.")}>
          Save name
        </button>
      </div>

      <div className="user-actions">
        <button
          className="pill sm"
          disabled={busy || (isSelf && target.is_superuser)}
          onClick={() =>
            update(
              { is_superuser: !target.is_superuser },
              target.is_superuser ? `${target.username} is no longer an admin.` : `${target.username} is now an admin.`
            )
          }
        >
          {target.is_superuser ? "Remove admin" : "Make admin"}
        </button>
        <button
          className={`pill sm ${target.is_active ? "danger" : ""}`}
          disabled={busy || isSelf}
          onClick={() =>
            update(
              { is_active: !target.is_active },
              target.is_active ? `${target.username} was deactivated.` : `${target.username} was reactivated.`
            )
          }
        >
          {target.is_active ? "Deactivate" : "Reactivate"}
        </button>
        <button className="pill sm" disabled={busy || isSelf} onClick={resetPassword}>
          Reset password
        </button>
      </div>
      <p className="muted small">
        Deactivated users can't sign in, but their account and history stay. Admin changes take effect right away;
        the user sees their new role after signing in again.
      </p>

      {temp && (
        <div className="temp-pass" role="status">
          <p>
            Temporary password for <strong>{target.username}</strong>:
          </p>
          <div className="temp-pass-row">
            <code>{temp}</code>
            <button type="button" className="pill sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            <button type="button" className="pill sm" onClick={() => setTemp(null)}>Done</button>
          </div>
          <p className="muted small">Give it to them privately. It won't be shown again. They'll set a new password at sign-in.</p>
        </div>
      )}

      {!isSelf && (
        <div className="danger-zone">
          <p>
            <strong>Delete account.</strong> This can't be undone. Entries and logs keep the username they were
            recorded with. To keep the history tidy, consider deactivating instead.
          </p>
          <div className="user-row">
            <label className="user-name">
              Type <strong>{target.username}</strong> to confirm
              <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} autoComplete="off" />
            </label>
            <button
              className="pill sm danger"
              disabled={busy || confirmDelete !== target.username}
              onClick={() => run(() => api.deleteUser(target.id), `Account ${target.username} deleted.`, true)}
            >
              Delete account
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// "● 3 active  ● 1 idle  12 offline"
export function OnlineSummary({ counts, total }) {
  return (
    <div className="online-summary">
      <span className="online-count">
        <span className="presence-dot active" aria-hidden="true" /> <strong>{counts.active}</strong> active
      </span>
      <span className="online-count">
        <span className="presence-dot idle" aria-hidden="true" /> <strong>{counts.idle}</strong> idle
      </span>
      <span className="online-count muted">{total - counts.active - counts.idle} offline</span>
    </div>
  );
}

// A profile picture with a green (active) or yellow (idle) dot
export function PresenceAvatar({ api, u }) {
  return (
    <span className="avatar-wrap">
      <Avatar api={api} userId={u.id} version={u.avatar_version} className="list-avatar" />
      {u.presence !== "offline" && (
        <span className={`presence-dot ${u.presence} on-avatar`} title={u.presence === "active" ? "Active now" : "Idle"} />
      )}
    </span>
  );
}

// Online status of one account: Active now / Idle / Last seen, plus the last sign-in (admins)
export function Presence({ u }) {
  const seen = u.last_seen || u.last_login;
  let main;
  if (u.presence === "active") {
    main = <span className="presence-text active">Active now</span>;
  } else if (u.presence === "idle") {
    main = (
      <span className="presence-text idle" title={u.last_active ? `Last used ${fmtStamp(u.last_active)}` : undefined}>
        Idle{u.last_active ? ` · used ${timeAgo(u.last_active)}` : ""}
      </span>
    );
  } else if (seen) {
    main = <span title={fmtStamp(seen)}>Last seen {timeAgo(seen)}</span>;
  } else {
    // Admins get the last sign-in, so they can tell "never"; staff only see that it's offline
    main = <span className="muted">{"last_login" in u ? "Never signed in" : "Offline"}</span>;
  }
  return (
    <>
      {main}
      {u.last_login && (
        <>
          <br />
          <span className="muted nowrap">Signed in {fmtStamp(u.last_login)}</span>
        </>
      )}
    </>
  );
}
