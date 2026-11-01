import { useEffect, useState } from "react";
import { money } from "../utils/format";

// Everyone: a row of small cards about your own work, at the top of the User Panel.
export default function MyStats({ api, user, version }) {
  const [s, setS] = useState(null);

  useEffect(() => {
    api.myStats?.().then(setS, () => {}); // the cards are extra; never show an error for them
  }, [api, version]);

  if (!s) return null;

  const cards = [
    {
      label: `Entries added in ${s.month_label}`,
      value: s.entries_this_month.toLocaleString(),
      sub: money(s.amount_this_month),
    },
    {
      label: "All your entries",
      value: s.entries_total.toLocaleString(),
      sub: `${money(s.amount_total)} · ${s.projects_total} project${s.projects_total === 1 ? "" : "s"}`,
    },
    {
      label: user.is_superuser ? "Edits this month" : "Edit requests this month",
      value: s.edits_this_month.toLocaleString(),
    },
    {
      label: "Your requests",
      value: s.requests_pending.toLocaleString(),
      sub: `pending · ${s.requests_approved} approved · ${s.requests_rejected} rejected`,
    },
  ];
  if (user.is_superuser && s.reviews_this_month != null) {
    cards.push({ label: "Requests you reviewed this month", value: s.reviews_this_month.toLocaleString() });
  }

  return (
    <section className="stat-cards" aria-label="Your numbers">
      {cards.map((c) => (
        <div key={c.label} className="stat-card">
          <span className="stat-label">{c.label}</span>
          <strong className="stat-value">{c.value}</strong>
          {c.sub && <span className="stat-sub">{c.sub}</span>}
        </div>
      ))}
    </section>
  );
}
