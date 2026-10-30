import { useState } from "react";
import { useModal } from "../hooks/useModal";
import { cents, fmtStamp, todayISO } from "../utils/format";

export default function EntryDialog({ mode, entry, defaultProject, user, onSave, onClose }) {
  const [ref, dialogProps] = useModal(onClose);
  const [form, setForm] = useState(() =>
    mode === "edit"
      ? {
          project_title: entry.project_title ?? defaultProject ?? "",
          date: entry.date,
          cv_no: entry.cv_no,
          payee: entry.payee,
          amount: String(entry.amount),
        }
      : { project_title: defaultProject ?? "", date: todayISO(), cv_no: "", payee: "", amount: "" }
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  // Normal users can't edit directly: their changes go to an admin for approval
  const asRequest = mode === "edit" && !user.is_superuser;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    const amount = Number(form.amount);
    if (!(amount > 0)) return setError("Enter an amount greater than zero.");

    setBusy(true);
    try {
      if (mode === "create") {
        await onSave({
          project_title: defaultProject,
          date: form.date,
          cv_no: form.cv_no.trim(),
          payee: form.payee.trim(),
          amount: amount.toFixed(2),
        });
      } else {
        const next = {
          date: form.date,
          cv_no: form.cv_no.trim(),
          payee: form.payee.trim(),
          amount: amount.toFixed(2),
        };
        const changes = {};
        for (const k of Object.keys(next)) {
          const same = k === "amount" ? cents(entry.amount) === cents(next.amount) : entry[k] === next[k];
          if (!same) changes[k] = next[k];
        }
        if (Object.keys(changes).length === 0) {
          ref.current.close();
          return;
        }
        const why = reason.trim();
        await onSave({ ...changes, editor_name: user.name, ...(asRequest && why ? { reason: why } : {}) });
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <dialog className="dialog" aria-labelledby="entry-title" {...dialogProps}>
      <form onSubmit={submit}>
        <h2 id="entry-title">
          {asRequest ? "Request changes" : mode === "edit" ? "Edit record" : "Add record"}
        </h2>
        <div className="row">
          <label>
            Date
            <input type="date" value={form.date} onChange={set("date")} required />
          </label>
          <label>
            CV no.
            <input value={form.cv_no} onChange={set("cv_no")} required />
          </label>
        </div>
        <label>
          Payee / Particulars
          <input value={form.payee} onChange={set("payee")} required />
        </label>
        <label>
          Amount (PHP)
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            value={form.amount}
            onChange={set("amount")}
            required
          />
        </label>

        {asRequest && (
          <label>
            Reason (optional)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. Wrong amount encoded"
            />
          </label>
        )}

        <p className="hint">
          {mode === "create"
            ? `Encoded by ${user.name}.`
            : asRequest
              ? `Added by ${entry.created_by} on ${fmtStamp(entry.created_at)}. An admin will review your changes before they're applied.`
              : `Added by ${entry.created_by} on ${fmtStamp(entry.created_at)}. Your name will be recorded as the editor.`}
        </p>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="pill" onClick={() => ref.current.close()}>
            Cancel
          </button>
          <button className="pill primary" disabled={busy}>
            {busy
              ? asRequest ? "Sending…" : "Saving…"
              : mode === "create" ? "Add record" : asRequest ? "Send request" : "Save changes"}
          </button>
        </div>
      </form>
    </dialog>
  );
}