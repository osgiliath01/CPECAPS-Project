import { useEffect, useState } from "react";
import { money } from "../utils/format";

const FIELD_LABEL = { date: "Date", cv_no: "CV no.", payee: "Payee", amount: "Amount" };
const fmtValue = (field, v) =>
  v === null || v === undefined || v === "" ? "—" : field === "amount" ? money(v) : String(v);

// "Archive" or "Edit" pill
export function TypeBadge({ type }) {
  return (
    <span className={`log-badge act-${type === "edit" ? "update" : "archive"}`}>
      {type === "edit" ? "Edit" : "Archive"}
    </span>
  );
}

// The entry a request is about
export function EntryCell({ request }) {
  return (
    <>
      <strong>{request.project_title}</strong>
      <br />
      <span className="small">
        CV# {request.cv_no} · {request.payee} · {money(request.amount)}
      </span>
    </>
  );
}

// What was asked for: the proposed changes (edits) and the reason
export function RequestDetails({ request }) {
  const fields = request.changes?.fields;
  return (
    <>
      {request.request_type === "edit" && fields && (
        <ul className="log-changes">
          {Object.entries(fields).map(([f, [before, after]]) => (
            <li key={f}>
              <strong>{FIELD_LABEL[f] || f}</strong>: {fmtValue(f, before)} → {fmtValue(f, after)}
            </li>
          ))}
        </ul>
      )}
      {request.reason ? (
        <p className="muted small log-reason">Reason: {request.reason}</p>
      ) : (
        request.request_type === "edit" && <p className="muted small log-reason">No reason given</p>
      )}
    </>
  );
}

// "Requests" tab of the Activity Log window (admins only)
export default function DeletionRequests({ api, user, version, onChanged }) {
  const [items, setItems] = useState(null);
  const [notes, setNotes] = useState({});
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      setItems(await api.listRequests("pending"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    api.listRequests("pending").then(setItems, (e) => setError(e.message));
  }, [api, version]);

  async function act(req, approve) {
    setBusyId(req.id);
    try {
      const note = notes[req.id]?.trim();
      await (approve ? api.approveRequest(req.id, note) : api.rejectRequest(req.id, note));
      await load();
      const done =
        req.request_type === "edit"
          ? approve ? "Edit approved and applied." : "Edit request rejected."
          : approve ? "Request approved. Entry archived." : "Archive request rejected.";
      onChanged?.(done);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (items === null && !error) return <p className="muted">Loading…</p>;

  return (
    <>
      {error && <p className="error">{error}</p>}
      {items?.length === 0 && <p className="muted">No pending requests.</p>}
      {items?.length > 0 && (
        <div className="review-scroll">
          <table className="review-table">
            <thead>
              <tr><th>Type</th><th>Entry</th><th>Request</th><th>By</th><th>Note to requester</th><th /></tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const mine = r.requested_by === user.username;
                return (
                  <tr key={r.id}>
                    <td><TypeBadge type={r.request_type} /></td>
                    <td><EntryCell request={r} /></td>
                    <td className="reason"><RequestDetails request={r} /></td>
                    <td>{r.requested_by}</td>
                    <td>
                      {!mine && (
                        <input
                          className="note"
                          value={notes[r.id] ?? ""}
                          onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                          placeholder="Optional"
                          maxLength={500}
                          aria-label={`Note for ${r.requested_by}`}
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
      )}
    </>
  );
}
