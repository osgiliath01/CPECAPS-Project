import { useState } from "react";
import logo from "../assets/logo.webp";
import LoginSlideshow from "./LoginSlideshow";

const EMPTY = { name: "", username: "", password: "", confirm: "", message: "" };

export default function Login({ onLogin, onRegister, onResetRequest }) {
  const [mode, setMode] = useState("login"); // "login" | "register" | "reset"
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState("");
  const isRegister = mode === "register";
  const isReset = mode === "reset";
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function goTo(next) {
    setMode(next);
    // keep the username when moving between sign in and reset
    setForm((f) => ({ ...EMPTY, username: next === "register" ? "" : f.username }));
    setError("");
    setResetSent("");
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    const name = form.name.trim();
    const username = form.username.trim();

    if (isRegister) {
      // same limits as the backend's UserCreate schema
      if (name.length < 3) return setError("Full name must be at least 3 characters.");
      if (username.length < 3) return setError("Username must be at least 3 characters.");
      if (form.password.length < 8) return setError("Password must be at least 8 characters.");
      if (form.password !== form.confirm) return setError("The passwords don't match.");
    }

    setBusy(true);
    try {
      if (isReset) {
        const res = await onResetRequest(username, form.message.trim());
        setResetSent(res?.detail || "Request sent. An admin will give you a temporary password.");
        setBusy(false);
      } else if (isRegister) await onRegister({ name, username, password: form.password });
      else await onLogin(username, form.password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const title = isReset ? "Reset password" : isRegister ? "Create account" : "Sign in";
  const busyLabel = isReset ? "Sending…" : isRegister ? "Creating account…" : "Signing in…";
  const submitLabel = isReset ? "Send request" : isRegister ? "Create account" : "Sign in";

  return (
    <main className="login">
      <LoginSlideshow />
      <header className="login-brand">
        <img src={logo} alt="Calamba Allied Industrial Corporation" className="login-logo" />
      </header>

      <form className="login-sheet" onSubmit={submit}>
        <div key={mode} className="login-fields">
          <h1>{title}</h1>

          {isReset && resetSent ? (
            <>
              <p role="status" className="reset-sent">{resetSent}</p>
              <p className="muted small">
                Once you have it, sign in with the temporary password. You'll be asked to choose a new one.
              </p>
              <button type="button" className="pill primary" onClick={() => goTo("login")}>
                Back to sign in
              </button>
            </>
          ) : (
            <>
              {isReset && (
                <p className="muted small">
                  Enter your username. An admin will review your request and give you a temporary password.
                </p>
              )}
              {isRegister && (
                <label>
                  Full name
                  <input
                    value={form.name}
                    onChange={set("name")}
                    autoComplete="name"
                    minLength={3}
                    maxLength={50}
                    autoFocus
                    required
                  />
                </label>
              )}
              <label>
                Username
                <input
                  value={form.username}
                  onChange={set("username")}
                  autoComplete="username"
                  minLength={isRegister ? 3 : undefined}
                  maxLength={50}
                  autoFocus={!isRegister}
                  required
                />
              </label>
              {isReset ? (
                <label>
                  Message for the admin (optional)
                  <textarea
                    value={form.message}
                    onChange={set("message")}
                    rows={2}
                    maxLength={300}
                    placeholder="e.g. Forgot my password after the long weekend"
                  />
                </label>
              ) : (
                <label>
                  Password
                  <input
                    type="password"
                    value={form.password}
                    onChange={set("password")}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    minLength={isRegister ? 8 : undefined}
                    maxLength={128}
                    required
                  />
                </label>
              )}
              {mode === "login" && (
                <p className="forgot">
                  <button type="button" className="link" onClick={() => goTo("reset")}>
                    Forgot password?
                  </button>
                </p>
              )}
              {isRegister && (
                <label>
                  Confirm password
                  <input
                    type="password"
                    value={form.confirm}
                    onChange={set("confirm")}
                    autoComplete="new-password"
                    required
                  />
                </label>
              )}

              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="pill primary" disabled={busy}>
                {busy ? busyLabel : submitLabel}
              </button>

              <p className="switch">
                {isReset ? (
                  <>
                    Remembered it?{" "}
                    <button type="button" className="link" onClick={() => goTo("login")}>
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
                    <button type="button" className="link" onClick={() => goTo(isRegister ? "login" : "register")}>
                      {isRegister ? "Sign in" : "Create one"}
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </form>
    </main>
  );
}
