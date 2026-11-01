import { useEffect, useState } from "react";
import { fmtStamp } from "../utils/format";
import { ACTION_LABEL } from "./ActivityLog";

const PAGE_SIZE = 20;

// Everyone: what you did in the app, and what admins did to your account, newest first.
export default function MyActivity({ api, version }) {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // First page: on open and whenever something changes live
  useEffect(() => {
    let cancelled = false;
    api.myActivity?.(1, PAGE_SIZE).then(
      (res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setPage(1);
      },
      (e) => !cancelled && setError(e.message)
    );
    return () => {
      cancelled = true;
    };
  }, [api, version]);

  async function more() {
    setBusy(true);
    try {
      const res = await api.myActivity(page + 1, PAGE_SIZE);
      setItems((list) => [...list, ...res.items.filter((r) => !list.some((x) => x.id === r.id))]);
      setTotal(res.total);
      setPage(page + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!api.myActivity) return <p className="muted">Not available in demo mode.</p>;
  if (error && !items) return <p className="error">{error}</p>;
  if (!items) return <p className="muted">Loading…</p>;
  if (!items.length) return <p className="muted">Nothing yet.</p>;

  return (
    <div className="log-body">
      <div className="review-scroll">
        <table className="review-table">
          <thead>
            <tr><th>When</th><th>Action</th><th>Details</th></tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td className="nowrap small">{fmtStamp(a.created_at)}</td>
                <td>
                  <span className={`log-badge act-${a.action}`}>{ACTION_LABEL[a.action] || a.action}</span>
                </td>
                <td className="reason">
                  {a.summary}
                  {!a.by_me && <span className="muted small"> · by {a.actor}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small my-activity-foot">
        Showing {items.length} of {total}.{" "}
        {items.length < total && (
          <button type="button" className="link" disabled={busy} onClick={more}>
            {busy ? "Loading…" : "Show more"}
          </button>
        )}
      </p>
    </div>
  );
}
