import { useEffect, useState } from "react";
import { fmtStamp } from "../utils/format";
import Avatar from "./Avatar";

// Admins: staff asking to change their full name. Shown above the user list in Manage Users.
export default function NameRequests({ api, version, onChanged }) {
  const [items, setItems] = useState(null);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listNameRequests?.().then(setItems, (e) => setError(e.message));
  }, [api, version]);

  async function decide(r, approve) {
    setBusyId(r.id);
    setError("");
    try {
      const note = (notes[r.id] || "").trim();
      await (approve ? api.approveNameRequest(r.id, note) : api.rejectNameRequest(r.id, note));
      setItems((list) => list.filter((x) => x.id !== r.id));
      onChanged?.(approve ? `${r.username} is now ${r.new_name}.` : `Name change for ${r.username} rejected.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (!items?.length && !error) return null;

  return (
    <section className="name-requests" aria-label="Name change requests">
      <h3 className="log-section">Name change requests</h3>
      {error && <p className="error">{error}</p>}
      <div className="review-scroll">
        <table className="review-table">
          <thead>
            <tr><th>Sent</th><th>User</th><th>Change</th><th>Note (optional)</th><th /></tr>
          </thead>
          <tbody>
            {items?.map((r) => (
              <tr key={r.id}>
                <td className="nowrap small">{fmtStamp(r.created_at)}</td>
                <td>
                  <div className="who">
                    <Avatar api={api} userId={r.user_id} version={r.avatar_version} className="list-avatar" />
                    <span>@{r.username}</span>
                  </div>
                </td>
                <td>
                  <span className="muted">{r.current_name}</span> → <strong>{r.new_name}</strong>
                </td>
                <td>
                  <input
                    className="note"
                    value={notes[r.id] || ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    maxLength={500}
                    aria-label={`Note for ${r.username}`}
                  />
                </td>
                <td className="actions nowrap">
                  <button className="pill sm primary" disabled={busyId === r.id} onClick={() => decide(r, true)}>
                    Approve
                  </button>{" "}
                  <button className="pill sm danger" disabled={busyId === r.id} onClick={() => decide(r, false)}>
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
