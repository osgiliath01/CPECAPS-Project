import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { createApi, DEMO } from "./api/api";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import ForcePasswordChange from "./components/ForcePasswordChange";
import UpdateBanner from "./components/UpdateBanner";
import { useSessionKeepAlive } from "./hooks/useSessionKeepAlive";

const IDLE_SIGN_OUT = "You were signed out after 30 minutes without activity. Sign in again to continue.";

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("token") || (DEMO ? "demo" : null));
  const [user, setUser] = useState(null);
  const [signedOutReason, setSignedOutReason] = useState(""); // shown on the sign-in page
  // The api reads the newest token through this, so renewing the token in the background
  // doesn't rebuild the api (which would reload every screen)
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const signedIn = !!token;

  // The session ended (expired, signed in elsewhere, deactivated...). Shows why, if known.
  const logout = useCallback((reason) => {
    sessionStorage.removeItem("token");
    setToken(null);
    setUser(null);
    const text = typeof reason === "string" ? reason : "";
    // "Could not validate credentials" = the sign-in ran out (e.g. the computer was asleep)
    setSignedOutReason(
      !text ? "" : /could not validate/i.test(text) ? "Your session ended. Please sign in again." : text
    );
  }, []);

  const api = useMemo(() => createApi(() => tokenRef.current, logout), [signedIn, logout]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api
      .me()
      .then((u) => live && setUser(u))
      .catch(() => live && logout());
    return () => {
      live = false;
    };
  }, [signedIn, api, logout]);

  // Renew the sign-in while the person is active; sign out after 30 idle minutes
  const renewed = useCallback((fresh) => {
    sessionStorage.setItem("token", fresh);
    tokenRef.current = fresh;
    setToken(fresh);
  }, []);
  const expired = useCallback(() => logout(IDLE_SIGN_OUT), [logout]);
  const { warning: idleWarning, stay } = useSessionKeepAlive({
    token,
    api,
    enabled: signedIn && !DEMO,
    onRenewed: renewed,
    onExpired: expired,
  });

  // Signing out on purpose: end the session on the server too, so this account can be
  // signed in elsewhere straight away
  const signOut = useCallback(async () => {
    await api.endSession?.();
    logout();
  }, [api, logout]);

  function acceptToken(accessToken) {
    sessionStorage.setItem("token", accessToken);
    setSignedOutReason("");
    setToken(accessToken);
  }

  // Returns the waiting info if the account is open on another device (Login handles it)
  async function handleLogin(username, password) {
    const res = await createApi(null, null).login(username, password);
    if (res?.access_token) acceptToken(res.access_token);
    else return res;
  }

  // New accounts wait for an admin's approval, so there's no automatic sign-in
  async function handleRegister(form) {
    await createApi(null, null).register(form);
  }

  let screen;
  if (!token)
    screen = (
      <Login
        onLogin={handleLogin}
        onToken={acceptToken}
        signedOutReason={signedOutReason}
        onRegister={handleRegister}
        onResetRequest={(username, message) => createApi(null, null).requestPasswordReset(username, message)}
      />
    );
  else if (!user) screen = <p className="boot">Loading your workspace…</p>;
  else if (user.must_change_password)
    screen = (
      <ForcePasswordChange
        api={api}
        user={user}
        onDone={async (newPassword) => {
          await api.endSession?.(); // this device's own session, so signing in again doesn't ask
          return handleLogin(user.username, newPassword);
        }}
        onLogout={signOut}
      />
    );
  else screen = <Dashboard api={api} user={user} onLogout={signOut} onSessionEnded={logout} />;

  return (
    <>
      {screen}
      {idleWarning != null && (
        <div className="idle-warning" role="alertdialog" aria-live="assertive">
          <span>
            You'll be signed out in {Math.floor(idleWarning / 60)}:{String(idleWarning % 60).padStart(2, "0")} because
            there's been no activity.
          </span>
          <button type="button" className="pill sm primary" onClick={stay}>
            Stay signed in
          </button>
        </div>
      )}
      <UpdateBanner />
    </>
  );
}