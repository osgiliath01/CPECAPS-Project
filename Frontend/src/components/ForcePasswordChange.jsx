import { useState } from "react";
import logo from "../assets/logo.webp";

// Shown after signing in with a temporary password: the user must choose a new one first.
export default function ForcePasswordChange({ api, user, onDone, onLogout }) {
  const [form, setForm] = useState({ old_password: "", new_password: "", confirm_password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (form.new_password.length < 8) return setError("Use at least 8 characters for the new password.");
    if (form.new_password !== form.confirm_password) return setError("The new passwords don't match.");
    if (form.new_password === form.old_password)
      return setError("Choose a password different from the temporary one.");
    setBusy(true);
    try {
      await api.changePassword(form);
      await onDone(form.new_password); // signs in again with the new password
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <header className="login-brand">
        <img src={logo} alt="Calamba Allied Industrial Corporation" className="login-logo" />
      </header>
      <form className="login-sheet" onSubmit={submit}>
        <div className="login-fields">
          <h1>Set a new password</h1>
          <p className="muted small">
            Hi {user.name}. You signed in with a temporary password from an admin. Choose your own password to
            continue.
          </p>
          <label>
            Temporary password
            <input
              type="password"
              autoComplete="current-password"
              value={form.old_password}
              onChange={set("old_password")}
              required
              autoFocus
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={form.new_password}
              onChange={set("new_password")}
              minLength={8}
              maxLength={128}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={form.confirm_password}
              onChange={set("confirm_password")}
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="pill primary" disabled={busy}>
            {busy ? "Saving…" : "Save and continue"}
          </button>
          <p className="switch">
            <button type="button" className="link" onClick={onLogout}>
              Sign out
            </button>
          </p>
        </div>
      </form>
    </main>
  );
}
