import { useEffect, useRef, useState } from "react";

// The device that's signed in: someone is signing in to this account on another device.
// Allow signs this device out and lets them in; Block keeps this device signed in.
export default function LoginRequestDialog({ api, request, onAllowed, onBlocked, onGone, onRefresh }) {
  const ref = useRef(null);
  const [left, setLeft] = useState(request.expires_in);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    setLeft(request.expires_in);
    const timer = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [request]);

  useEffect(() => {
    if (left <= 0) onGone(request.id); // the other device stopped waiting
  }, [left, request.id, onGone]);

  // Check every few seconds that the other device is still waiting, so the prompt closes
  // even if the live update about a cancel was missed or its tab was simply closed
  useEffect(() => {
    if (!onRefresh) return;
    const timer = setInterval(onRefresh, 5000);
    return () => clearInterval(timer);
  }, [onRefresh]);

  async function answer(allow) {
    setBusy(true);
    setError("");
    try {
      await (allow ? api.allowLogin(request.id) : api.denyLogin(request.id));
      allow ? onAllowed() : onBlocked(request.id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const time = new Date(request.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <dialog ref={ref} className="dialog login-request" onCancel={(e) => e.preventDefault()}>
      <h2>Sign-in from another device</h2>
      <p>
        Someone is signing in to your account on <strong>{request.device || "another device"}</strong> (at {time}).
        Only one device can be signed in at a time.
      </p>
      <ul className="muted small">
        <li><strong>Allow</strong>: they get in and you're signed out here. Save your work first.</li>
        <li><strong>Block</strong>: you stay signed in and they're refused. If it wasn't you, change your password.</li>
      </ul>
      {error && <p className="error">{error}</p>}
      <p className="muted small">They'll stop waiting in {Math.max(0, Math.floor(left / 60))}:{String(Math.max(0, left % 60)).padStart(2, "0")}.</p>
      <div className="dialog-actions">
        <button type="button" className="pill danger" disabled={busy} onClick={() => answer(false)}>
          Block
        </button>
        <button type="button" className="pill primary" disabled={busy} onClick={() => answer(true)}>
          Allow and sign me out
        </button>
      </div>
    </dialog>
  );
}
