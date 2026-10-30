import { useEffect, useMemo, useRef, useState } from "react";
import { fmtStamp } from "../utils/format";

// Admin-only: every account, with controls for the selected one.
export default function UsersDialog({ api, user, onClose, onChanged }) {
  const ref = useRef(null);
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    api.listUsers().then(setUsers, (e) => setError(e.message));
  }, [api]);

  async function reload() {
    setUsers(await api.listUsers());
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!users || !needle) return users;
    return users.filter((u) => u.name.toLowerCase().includes(needle) || u.username.toLowerCase().includes(needle));
  }, [users, q]);

  const selected = users?.find((u) => u.id === selectedId) || null;

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2>Manage users</h2>
      <div className="log-body">
        <div className="log-filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or username" aria-label="Search users" />
        </div>
        {error && <p className="error">{error}</p>}
        {shown === null && !error ? (
          <p className="muted">Loading…</p>
        ) : shown?.length === 0 ? (
          <p className="muted">No users found.</p>
        ) : (
          shown && (
            <div className="review-scroll">
              <table className="review-table">
                <thead>
                  <tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <tr key={u.id} className={u.id === selectedId ? "row-selected" : undefined}>
                      <td>
                        <strong>{u.name}</strong>
                        {u.id === user.id ? " (you)" : ""}
                        <br />
                        <span className="small muted">@{u.username}</span>
                      </td>
                      <td>
                        <span className={`log-badge ${u.is_superuser ? "st-pending" : ""}`}>{u.is_superuser ? "Admin" : "User"}</span>
                      </td>
                      <td>
                        <span className={`log-badge ${u.is_active ? "st-approved" : "st-rejected"}`}>
                          {u.is_active ? "Active" : "Deactivated"}
                        </span>
                        {u.must_change_password && <><br /><span className="small muted">Temporary password</span></>}
                      </td>
                      <td className="nowrap small">{u.last_login ? fmtStamp(u.last_login) : <span className="muted">Never</span>}</td>
                      <td className="actions">
                        <button className="pill sm" onClick={() => setSelectedId(u.id === selectedId ? null : u.id)}>
                          {u.id === selectedId ? "Close" : "Manage"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {selected && (
          <UserPanel
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
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="pill" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}

function UserPanel({ api, target, isSelf, onDone }) {
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
      {isSelf && <p className="muted small">This is your account. Use Change password in your menu for your own password.</p>}
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
