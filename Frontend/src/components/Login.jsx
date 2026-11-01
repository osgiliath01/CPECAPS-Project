import { useEffect, useRef, useState } from "react";
import { createApi } from "../api/api";
import logo from "../assets/logo.webp";
import LoginSlideshow from "./LoginSlideshow";
import { versionLabel } from "../version";

const EMPTY = { name: "", username: "", password: "", confirm: "", message: "" };

export default function Login({ onLogin, onToken, signedOutReason, onRegister, onResetRequest }) {
  const [mode, setMode] = useState("login"); // "login" | "register" | "reset"
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(signedOutReason || ""); // e.g. "account created, waiting for approval"
  // Signing in while the account is open on another device: { challenge_id, secret, expires_in }
  const [waiting, setWaiting] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const loginApi = useRef(null);
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
    setNotice("");
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    const name = form.name.trim();
    const username = form.username.trim();

    if (isRegister) {
      // same limits as the backend's UserCreate schema
      if (name.length < 3) return setError("Full name must be at least 3 characters.");
      // Same rule as the backend (auth.py, USERNAME_RULE)
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,49}$/.test(username))
        return setError("Usernames are 3 to 50 letters, numbers, dots, dashes or underscores, with no spaces.");
      if (form.password.length < 8) return setError("Password must be at least 8 characters.");
      if (form.password !== form.confirm) return setError("The passwords don't match.");
    }

    setBusy(true);
    try {
      if (isReset) {
        const res = await onResetRequest(username, form.message.trim());
        setResetSent(res?.detail || "Request sent. An admin will give you a temporary password.");
        setBusy(false);
      } else if (isRegister) {
        await onRegister({ name, username, password: form.password });
        goTo("login"); // keeps the username filled in
        setNotice("Account created. An admin has to approve it before you can sign in.");
        setBusy(false);
      } else {
        const res = await onLogin(username, form.password);
        if (res?.status === "waiting") {
          setWaiting(res);
          setSecondsLeft(res.expires_in || 180);
          setBusy(false);
        }
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // While waiting: ask the server every 2 seconds whether the other device answered
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const check = async () => {
      try {
        loginApi.current = loginApi.current || createApi(null, null);
        const res = await loginApi.current.loginChallengeStatus(waiting.challenge_id, waiting.secret);
        if (stopped) return;
        if (res.status === "approved") {
          setWaiting(null);
          onToken(res.access_token);
        } else if (res.status === "denied") {
          setWaiting(null);
          setError("The device that's signed in to this account blocked this sign-in.");
        } else if (res.status === "expired") {
          setWaiting(null);
          setError("No answer from the other device. Try again, or sign out there first.");
        } else if (typeof res.expires_in === "number") {
          setSecondsLeft(res.expires_in);
        }
      } catch (err) {
        if (!stopped) {
          setWaiting(null);
          setError(err.message);
        }
      }
    };
    const timer = setInterval(check, 2000);
    check();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waiting, onToken]);

  async function cancelWaiting() {
    const w = waiting;
    setWaiting(null);
    if (w && loginApi.current) await loginApi.current.cancelLoginChallenge(w.challenge_id, w.secret);
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

          {waiting ? (
            <div className="login-waiting" role="status">
              <p>
                <strong>This account is signed in on another device.</strong>
              </p>
              <p className="muted small">
                We've asked that device to let you in. Ask whoever is using it to click <strong>Allow</strong>, or
                sign out there. If it's closed or offline, you'll get in within about a minute.
              </p>
              <p className="login-waiting-timer">
                <span className="spinner" aria-hidden="true" /> Waiting… {Math.floor(secondsLeft / 60)}:
                {String(secondsLeft % 60).padStart(2, "0")}
              </p>
              <button type="button" className="pill" onClick={cancelWaiting}>
                Cancel
              </button>
            </div>
          ) : isReset && resetSent ? (
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
              {notice && mode === "login" && (
                <p role="status" className="reset-sent">{notice}</p>
              )}
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
              {isRegister && (
                <p className="muted small field-hint">Letters, numbers, dots, dashes or underscores; no spaces.</p>
              )}
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
        <p className="version-line">{versionLabel()}</p>
      </form>
    </main>
  );
}
