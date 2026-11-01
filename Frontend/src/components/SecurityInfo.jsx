import { useEffect, useState } from "react";
import { fmtStamp } from "../utils/format";

const PASSWORD_HOW = {
  password_change: "by you",
  reset_approved: "reset by an admin (your request)",
  admin_reset: "reset by an admin",
};

// Everyone: recent sign-in security for your own account, and "sign out on all devices".
export default function SecurityInfo({ api, version, onLogout }) {
  const [info, setInfo] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.mySecurity?.().then(setInfo, (e) => setError(e.message));
  }, [api, version]);

  async function signOutEverywhere() {
    setBusy(true);
    setError("");
    try {
      await api.signOutEverywhere();
      onLogout(); // this device too
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!api.mySecurity) return null; // demo mode

  const warn = info && (info.failed_since_previous > 0 || info.locked_minutes > 0);

  return (
    <section className="security" aria-label="Sign-in security">
      <h3 className="security-title">Sign-in security</h3>
      {error && <p className="error small">{error}</p>}
      {info && (
        <dl className="profile">
          <div>
            <dt>Previous sign-in</dt>
            <dd>{info.previous_sign_in ? fmtStamp(info.previous_sign_in) : "This is your first"}</dd>
          </div>
          <div className={warn ? "security-warn" : undefined}>
            <dt>Wrong passwords since then</dt>
            <dd>
              {info.failed_since_previous}
              {info.locked_minutes > 0 && ` · sign-in locked for ${info.locked_minutes} more min`}
            </dd>
          </div>
          <div>
            <dt>Wrong passwords (30 days)</dt>
            <dd>
              {info.failed_last_30_days}
              {info.last_failed_at && <span className="muted small"> · last {fmtStamp(info.last_failed_at)}</span>}
            </dd>
          </div>
          <div>
            <dt>Password changed</dt>
            <dd>
              {info.password_changed_at
                ? `${fmtStamp(info.password_changed_at)} (${PASSWORD_HOW[info.password_change_kind] || "changed"})`
                : "Not since the account was made"}
            </dd>
          </div>
        </dl>
      )}
      {warn && (
        <p className="security-hint small">
          If those wrong passwords weren't you, change your password and sign out on all devices.
        </p>
      )}
      {confirming ? (
        <div className="security-confirm">
          <p className="small">This signs you out everywhere, including here. Continue?</p>
          <div className="name-edit-actions">
            <button className="pill sm danger" disabled={busy} onClick={signOutEverywhere}>
              {busy ? "Signing out…" : "Sign out everywhere"}
            </button>
            <button className="pill sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="link small" onClick={() => setConfirming(true)}>
          Sign out on all devices
        </button>
      )}
    </section>
  );
}
