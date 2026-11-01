import { useState } from "react";
import avatar from "../assets/default_user.jpg";
import { fmtStamp } from "../utils/format";
import { ActivityLogContent } from "./ActivityLog";
import { MyRequestsContent } from "./MyRequests";
import { UsersContent } from "./UsersDialog";
import { CountBadge } from "./AdminMenu";

export default function UserPanel({ api, user, version, pending, onPassword, onLogout, onChanged }) {
  const isAdmin = !!user.is_superuser;

  // Admins: open on whatever needs them. Activity Log if requests/resets are waiting,
  // otherwise Manage users if an account is waiting, otherwise Activity Log.
  const [section, setSection] = useState(() =>
    !(pending?.requests || pending?.resets) && pending?.accounts ? "users" : "activity"
  );

  const title = !isAdmin ? "My requests" : section === "users" ? "Manage users" : "Activity Log";

  return (
    <>
      <div className="page-head">
        <h1>User Panel</h1>
      </div>

      <div className="userpanel">
        {/* Left: who you are. Same for every role. */}
        <aside className="profile-card" aria-label="Account details">
          <img src={avatar} alt="" className="profile-avatar" />
          <h2 className="profile-name">{user.name}</h2>
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
          {isAdmin && (
            <div className="folder-tabs" role="tablist" aria-label="Administration sections">
              <button
                type="button"
                role="tab"
                aria-selected={section === "activity"}
                className="folder-tab"
                onClick={() => setSection("activity")}
              >
                Activity Log
                <CountBadge count={(pending?.requests || 0) + (pending?.resets || 0)} label="pending" />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "users"}
                className="folder-tab"
                onClick={() => setSection("users")}
              >
                Manage users
                <CountBadge count={pending?.accounts || 0} label="new accounts waiting for approval" />
              </button>
            </div>
          )}

          <section
            className={`panel userpanel-main ${isAdmin ? "folder-body" : ""}`}
            aria-label={title}
          >
            <h2 className="panel-title">{title}</h2>
            {!isAdmin ? (
              <MyRequestsContent api={api} version={version} />
            ) : section === "users" ? (
              <UsersContent api={api} user={user} version={version} onChanged={onChanged} />
            ) : (
              <ActivityLogContent api={api} user={user} version={version} pending={pending} onChanged={onChanged} />
            )}
          </section>
        </div>
      </div>
    </>
  );
}