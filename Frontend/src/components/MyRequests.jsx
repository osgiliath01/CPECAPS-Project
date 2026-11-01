import { useEffect, useRef, useState } from "react";
import { fmtStamp } from "../utils/format";
import { EntryCell, RequestDetails, TypeBadge } from "./DeletionRequests";

const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

// Normal users: their own archive and edit requests, and what the admin decided.
export default function MyRequests({ api, version, onSeen, onClose }) {
  const ref = useRef(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.listMyRequests().then(
      (rows) => {
        if (cancelled) return;
        setItems(rows);
        // Opening this window counts as reading the answers: clear the badge
        if (rows.some((r) => r.status !== "pending" && r.requester_seen === false)) {
          api.markRequestsSeen?.().then(() => onSeen?.(), () => {});
        }
      },
      (e) => !cancelled && setError(e.message)
    );
    return () => {
      cancelled = true;
    };
  }, [api, version]); // eslint-disable-line react-hooks/exhaustive-deps

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
                    <tr
                      key={r.id}
                      className={r.status !== "pending" && r.requester_seen === false ? "row-new" : undefined}
                    >
                      <td className="nowrap small">
                        {fmtStamp(r.created_at)}
                        {r.status !== "pending" && r.requester_seen === false && (
                          <span className="new-tag">New</span>
                        )}
                      </td>
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
