import { useEffect, useRef, useState } from "react";
import { fmtStamp } from "../utils/format";
import { EntryCell, RequestDetails, TypeBadge } from "./DeletionRequests";

const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

// Normal users: their own archive and edit requests, and what the admin decided.
export default function MyRequests({ api, version, onClose }) {
  const ref = useRef(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    api.listMyRequests().then(setItems, (e) => setError(e.message));
  }, [api, version]);

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2>My requests</h2>
      <div className="log-body">
        {error && <p className="error">{error}</p>}
        {items === null && !error ? (
          <p className="muted">Loading…</p>
        ) : items?.length === 0 ? (
          <p className="muted">You haven't sent any requests yet.</p>
        ) : (
          items && (
            <div className="review-scroll">
              <table className="review-table">
                <thead>
                  <tr><th>Sent</th><th>Type</th><th>Entry</th><th>Request</th><th>Status</th><th>Admin's response</th></tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap small">{fmtStamp(r.created_at)}</td>
                      <td><TypeBadge type={r.request_type} /></td>
                      <td><EntryCell request={r} /></td>
                      <td className="reason"><RequestDetails request={r} /></td>
                      <td><span className={`log-badge st-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                      <td className="reason">
                        {r.status === "pending" ? (
                          <span className="muted small">Waiting for an admin</span>
                        ) : (
                          <>
                            {r.review_note ? r.review_note : <span className="muted">No note</span>}
                            <br />
                            <span className="muted small">
                              {r.reviewed_by} · {r.reviewed_at && fmtStamp(r.reviewed_at)}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="pill" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
