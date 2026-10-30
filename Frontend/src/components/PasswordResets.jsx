import { useEffect, useState } from "react";
import { fmtStamp } from "../utils/format";

// "Password resets" tab of the Activity Log window (admins only)
export default function PasswordResets({ api, user, onChanged }) {
  const [items, setItems] = useState(null);
  const [notes, setNotes] = useState({});
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [issued, setIssued] = useState(null); // { username, temporary_password }
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.listResetRequests().then(setItems, (e) => setError(e.message));
  }, [api]);

  async function act(req, approve) {
    setBusyId(req.id);
    try {
      const note = notes[req.id]?.trim();
      if (approve) {
        const res = await api.approveReset(req.id, note);
        setIssued(res);
        setCopied(false);
      } else {
        await api.rejectReset(req.id, note);
      }
      setItems(await api.listResetRequests());
      setError("");
      onChanged?.(approve ? `Password reset for ${req.username}.` : "Reset request rejected.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.temporary_password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      {issued && (
        <div className="temp-pass" role="status">
          <p>
            Temporary password for <strong>{issued.username}</strong>:
          </p>
          <div className="temp-pass-row">
            <code>{issued.temporary_password}</code>
            <button type="button" className="pill sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            <button type="button" className="pill sm" onClick={() => setIssued(null)}>Done</button>
          </div>
          <p className="muted small">
            Give it to them in person or by a private message. It won't be shown again. They'll have to choose a
            new password when they sign in.
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {items === null && !error ? (
        <p className="muted">Loading…</p>
      ) : items?.length === 0 ? (
        <p className="muted">No pending password resets.</p>
      ) : (
        items && (
          <div className="review-scroll">
            <table className="review-table">
              <thead>
                <tr><th>Account</th><th>Message</th><th>Requested</th><th>Note</th><th /></tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const mine = r.username === user.username;
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.username}</strong>
                        {r.name && <><br /><span className="small muted">{r.name}</span></>}
                      </td>
                      <td className="reason">{r.message || <span className="muted">—</span>}</td>
                      <td className="nowrap small">{fmtStamp(r.requested_at)}</td>
                      <td>
                        {!mine && (
                          <input
                            className="note"
                            value={notes[r.id] ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                            placeholder="Optional"
                            maxLength={500}
                            aria-label={`Note about ${r.username}'s reset`}
                          />
                        )}
                      </td>
                      <td className="actions">
                        {mine ? (
                          <span className="muted small">Yours</span>
                        ) : (
                          <>
                            <button className="pill sm danger" disabled={busyId === r.id} onClick={() => act(r, true)}>Approve</button>
                            <button className="pill sm" disabled={busyId === r.id} onClick={() => act(r, false)}>Reject</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
