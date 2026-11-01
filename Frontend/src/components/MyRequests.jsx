import { useEffect, useMemo, useRef, useState } from "react";
import { fmtStamp } from "../utils/format";
import { usePagination } from "../hooks/usePagination";
import Pagination from "./Pagination";
import { EntryCell, RequestDetails, TypeBadge } from "./DeletionRequests";

const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
const STATUS_FILTERS = [
  ["all", "All"],
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
];

export function MyRequestsContent({ api, version }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");

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

  const counts = useMemo(() => {
    const c = { all: items?.length ?? 0, pending: 0, approved: 0, rejected: 0 };
    for (const r of items ?? []) if (c[r.status] !== undefined) c[r.status] += 1;
    return c;
  }, [items]);

  // The list after the status filter. Hooks must run on every render,
  // so this is computed before the loading/empty checks below.
  const shown = useMemo(() => {
    if (!items) return [];
    return status === "all" ? items : items.filter((r) => r.status === status);
  }, [items, status]);

  const pg = usePagination(shown, 10, status); // back to page 1 when the status filter changes

  let body;
  if (error) {
    body = <p className="error">{error}</p>;
  } else if (items === null) {
    body = <p className="muted">Loading…</p>;
  } else if (items.length === 0) {
    body = <p className="muted">You haven't sent any requests yet.</p>;
  } else {
    body = (
      <>
        <div className="seg" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="seg-btn"
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
            >
              {label} <span className="seg-count">{counts[key]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="muted">No {status} requests.</p>
        ) : (
          <>
            <div className="review-scroll">
              <table className="review-table">
                <thead>
                  <tr>
                    <th>Sent</th>
                    <th>Type</th>
                    <th>Entry</th>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Admin's response</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((r) => (
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
                      <td>
                        <span className={`log-badge st-${r.status}`}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                      </td>
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
            <Pagination
              page={pg.page}
              pageCount={pg.pageCount}
              pageSize={pg.pageSize}
              total={pg.total}
              onPage={pg.setPage}
              onPageSize={pg.setPageSize}
            />
          </>
        )}
      </>
    );
  }

  return <div className="log-body">{body}</div>;
}

export default function MyRequests({ api, version, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2>My Requests</h2>
      <MyRequestsContent api={api} version={version} />
      <div className="dialog-actions">
        <button type="button" className="pill" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}