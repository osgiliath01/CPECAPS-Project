import { useEffect, useMemo, useState } from "react";
import { OnlineSummary, Presence, PresenceAvatar } from "./UsersDialog";

const REFRESH_MS = 30 * 1000; // re-checked this often while the list is open

// Everyone: who on the team has the app open right now. Admins see the same thing,
// with more details, in Manage Users.
export default function OnlineUsers({ api, user, version }) {
  const [people, setPeople] = useState(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listOnline().then(setPeople, (e) => setError(e.message));
  }, [api, version]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") api.listOnline().then(setPeople, () => {});
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [api]);

  const counts = useMemo(() => {
    const c = { active: 0, idle: 0 };
    (people || []).forEach((p) => {
      if (p.presence in c) c[p.presence] += 1;
    });
    return c;
  }, [people]);

  const shown = people && (onlineOnly ? people.filter((p) => p.presence !== "offline") : people);

  if (error) return <p className="error">{error}</p>;
  if (!people) return <p className="muted">Loading…</p>;

  return (
    <>
      <OnlineSummary counts={counts} total={people.length} />
      <div className="log-filters">
        <label className="feed-toggle online-toggle">
          <input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} />
          Online now only
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="muted">Nobody has the app open right now.</p>
      ) : (
        <div className="review-scroll">
          <table className="review-table">
            <thead>
              <tr><th>Person</th><th>Role</th><th>Online</th></tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="who">
                      <PresenceAvatar api={api} u={p} />
                      <div>
                        <strong>{p.name}</strong>
                        {p.id === user.id ? " (you)" : ""}
                        <br />
                        <span className="small muted">@{p.username}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`log-badge ${p.is_superuser ? "st-pending" : ""}`}>{p.is_superuser ? "Admin" : "Staff"}</span>
                  </td>
                  <td className="small">
                    <Presence u={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Updates every 30 seconds. Idle means the app is open but hasn't been used for a few minutes.</p>
    </>
  );
}
