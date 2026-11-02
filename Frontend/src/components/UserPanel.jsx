import { useRef, useState } from "react";
import { fmtStamp } from "../utils/format";
import Avatar, { squarePhoto } from "./Avatar";
import NameRequests from "./NameRequests";
import MyActivity from "./MyActivity";
import SecurityInfo from "./SecurityInfo";
import MyStats from "./MyStats";
import BackupStatus from "./BackupStatus";
import { ActivityLogContent } from "./ActivityLog";
import { MyRequestsContent } from "./MyRequests";
import { UsersContent } from "./UsersDialog";
import OnlineUsers from "./OnlineUsers";
import { CountBadge } from "./AdminMenu";

export default function UserPanel({
  api,
  user,
  version,
  pending,
  profile,
  onProfileChanged,
  onSeen,
  initialSection,
  onPassword,
  onLogout,
  onChanged,
}) {
  const isAdmin = !!user.is_superuser;
  const waitingAccounts = (pending?.accounts || 0) + (pending?.names || 0);
  // After changing the picture or name: reload the profile and say what happened
  const profileChanged = async (msg) => {
    await onProfileChanged?.();
    if (msg) onChanged?.(msg);
  };

  // Admins: open on whatever needs them. Activity Log if requests/resets are waiting,
  // otherwise Manage Users if an account is waiting, otherwise Activity Log.
  // Staff open on My Requests.
  const [section, setSection] = useState(() =>
    initialSection ||
    (!isAdmin
      ? "requests"
      : !(pending?.requests || pending?.resets) && (pending?.accounts || pending?.names)
        ? "users"
        : "activity")
  );

  const tabs = isAdmin
    ? [
        { key: "activity", label: "Activity Log", count: (pending?.requests || 0) + (pending?.resets || 0) },
        { key: "users", label: "Manage Users", count: waitingAccounts },
        { key: "mine", label: "My Activity", count: 0 },
      ]
    : [
        { key: "requests", label: "My Requests", count: pending?.responses || 0 },
        { key: "mine", label: "My Activity", count: 0 },
        { key: "online", label: "Active Status", count: 0 },
      ];
  const title = tabs.find((t) => t.key === section)?.label || "";

  return (
    <>
      <div className="page-head">
        <h1>User Panel</h1>
      </div>

      <div className="userpanel">
        {/* Left: who you are. Same for every role. */}
        <aside className="profile-card" aria-label="Account details">
          <Avatar api={api} userId={profile?.id} version={profile?.avatar_version} className="profile-avatar" />
          <PhotoControls api={api} profile={profile} onChanged={profileChanged} />
          <NameEditor api={api} user={user} profile={profile} isAdmin={isAdmin} onChanged={profileChanged} />
          <p className="profile-username muted">@{user.username}</p>
          <span className={`role-badge ${isAdmin ? "admin" : "staff"}`}>
            {isAdmin ? "Administrator" : "Staff"}
          </span>

          <dl className="profile">
            {user.is_active !== undefined && (
              <div>
                <dt>Status</dt>
                <dd>{user.is_active ? "Active" : "Inactive"}</dd>
              </div>
            )}
            {user.created_at && (
              <div>
                <dt>Member since</dt>
                <dd>{fmtStamp(user.created_at)}</dd>
              </div>
            )}
          </dl>

          <SecurityInfo api={api} version={version} onLogout={onLogout} />
          {isAdmin && <BackupStatus api={api} version={version} />}

          <div className="profile-actions">
            <button className="pill create" onClick={onPassword}>
              Change password
            </button>
            <button className="pill" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </aside>

        {/* Right: the working area. Depends on the role. */}
        <div className="userpanel-right">
          <MyStats api={api} user={user} version={version} />

          <div className="folder-tabs" role="tablist" aria-label="User Panel sections">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={section === t.key}
                className="folder-tab"
                onClick={() => setSection(t.key)}
              >
                {t.label}
                <CountBadge count={t.count} label="waiting" />
              </button>
            ))}
          </div>

          <section className="panel userpanel-main folder-body" aria-label={title}>
            <h2 className="panel-title">{title}</h2>
            {section === "mine" ? (
              <MyActivity api={api} version={version} />
            ) : section === "online" ? (
              <OnlineUsers api={api} user={user} version={version} />
            ) : section === "requests" ? (
              <MyRequestsContent api={api} version={version} onSeen={onSeen} />
            ) : section === "users" ? (
              <>
                <NameRequests api={api} version={version} onChanged={onChanged} />
                <UsersContent api={api} user={user} version={version} onChanged={onChanged} />
              </>
            ) : (
              <ActivityLogContent api={api} user={user} version={version} pending={pending} onChanged={onChanged} />
            )}
          </section>
        </div>
      </div>
    </>
  );
}

// Add, change or remove your own profile picture
function PhotoControls({ api, profile, onChanged }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file again still works
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await api.uploadAvatar(await squarePhoto(file));
      await onChanged("Profile picture updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api.removeAvatar();
      await onChanged("Profile picture removed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!profile || !api.uploadAvatar) return null; // demo mode
  return (
    <>
      <div className="photo-actions">
        <button type="button" className="link" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Saving…" : profile.avatar_version ? "Change photo" : "Add photo"}
        </button>
        {profile.avatar_version && (
          <button type="button" className="link" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={pick}
      />
      {error && <p className="error small">{error}</p>}
    </>
  );
}

const RECENT_DAYS = 14; // how long a rejected name change stays mentioned

// Your full name. Admins change it directly; staff send a request an admin approves.
function NameEditor({ api, user, profile, isAdmin, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const name = profile?.name || user.name;
  const req = profile?.name_request;
  const waiting = req?.status === "pending";
  const recentlyRejected =
    req?.status === "rejected" &&
    req.reviewed_at &&
    Date.now() - new Date(req.reviewed_at).getTime() < RECENT_DAYS * 86400000;

  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await api.changeName(value.trim());
      await onChanged(res?.detail);
    });
  };

  const canEdit = !!profile && !!api.changeName;

  return (
    <>
      {editing ? (
        <form className="name-edit" onSubmit={save}>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            minLength={3}
            maxLength={50}
            autoFocus
            aria-label="Full name"
          />
          <div className="name-edit-actions">
            <button className="pill sm primary" disabled={busy || value.trim().length < 3 || value.trim() === name}>
              {isAdmin ? "Save" : "Request change"}
            </button>
            <button type="button" className="pill sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          {!isAdmin && <p className="muted small">An admin has to approve your new name.</p>}
        </form>
      ) : (
        <h2 className="profile-name">
          {name}
          {canEdit && (
            <button
              type="button"
              className="link small name-edit-btn"
              onClick={() => {
                setValue(waiting ? req.new_name : name);
                setError("");
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </h2>
      )}

      {!editing && waiting && (
        <p className="name-status waiting">
          Waiting for approval: <strong>{req.new_name}</strong>{" "}
          <button type="button" className="link small" disabled={busy} onClick={() => run(async () => {
            await api.cancelNameRequest();
            await onChanged("Name change request withdrawn.");
          })}>
            Withdraw
          </button>
        </p>
      )}
      {!editing && recentlyRejected && (
        <p className="name-status rejected">
          Your change to <strong>{req.new_name}</strong> was not approved
          {req.review_note ? `: ${req.review_note}` : "."}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </>
  );
}
