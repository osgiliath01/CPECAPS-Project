import { Fragment, useEffect, useState } from "react";
import { ACTION_LABEL } from "./ActivityLog";

const PAGE_SIZE = 20;

const time = (iso) => new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

// "Today", "Yesterday", or e.g. "Fri, Oct 30, 2026"
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

// Everyone: what you did in the app, and what admins did to your account, newest first,
// grouped by day. Routine sign-ins are hidden unless asked for.
export default function MyActivity({ api, version }) {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [signins, setSignins] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // First page: on open, whenever something changes live, and when the filter changes
  useEffect(() => {
    let cancelled = false;
    api.myActivity?.(1, PAGE_SIZE, signins).then(
      (res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setPage(1);
        setError("");
      },
      (e) => !cancelled && setError(e.message)
    );
    return () => {
      cancelled = true;
    };
  }, [api, version, signins]);

  async function more() {
    setBusy(true);
    try {
      const res = await api.myActivity(page + 1, PAGE_SIZE, signins);
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

  const toggle = (
    <label className="feed-toggle">
      <input type="checkbox" checked={signins} onChange={(e) => setSignins(e.target.checked)} />
      Show sign-ins
    </label>
  );
  if (error && !items) return <p className="error">{error}</p>;
  if (!items) return <p className="muted">Loading…</p>;

  let lastDay = null;
  return (
    <div className="log-body">
      {toggle}
      {!items.length ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <div className="review-scroll">
          <table className="review-table feed">
            <thead>
              <tr><th>Time</th><th>Action</th><th>Details</th></tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const day = dayLabel(a.created_at);
                const header = day !== lastDay;
                lastDay = day;
                return (
                  <Fragment key={a.id}>
                    {header && (
                      <tr className="feed-day">
                        <td colSpan={3}>{day}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="nowrap small feed-when">{time(a.created_at)}</td>
                      <td className="feed-action">
                        <span className={`log-badge act-${a.action}`}>{ACTION_LABEL[a.action] || a.action}</span>
                      </td>
                      <td className="reason feed-details">
                        {a.summary}
                        {!a.by_me && <span className="muted small"> · by {a.actor}</span>}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {items.length > 0 && (
        <p className="muted small my-activity-foot">
          Showing {items.length} of {total}.{" "}
          {items.length < total && (
            <button type="button" className="link" disabled={busy} onClick={more}>
              {busy ? "Loading…" : "Show more"}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
