import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { createApi, DEMO } from "./api/api";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import ForcePasswordChange from "./components/ForcePasswordChange";

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("token") || (DEMO ? "demo" : null));
  const [user, setUser] = useState(null);

  const logout = useCallback(() => {
    sessionStorage.removeItem("token");
    setToken(null);
    setUser(null);
  }, []);

  const api = useMemo(() => createApi(token, logout), [token, logout]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    api
      .me()
      .then((u) => live && setUser(u))
      .catch(() => live && logout());
    return () => {
      live = false;
    };
  }, [token, api, logout]);

  async function handleLogin(username, password) {
    const res = await createApi(null, null).login(username, password);
    sessionStorage.setItem("token", res.access_token);
    setToken(res.access_token);
  }

  async function handleRegister(form) {
    await createApi(null, null).register(form);
    try {
      await handleLogin(form.username, form.password);
    } catch (e) {
      throw new Error(`Account created, but automatic sign-in failed: ${e.message}`);
    }
  }

  if (!token)
    return (
      <Login
        onLogin={handleLogin}
        onRegister={handleRegister}
        onResetRequest={(username, message) => createApi(null, null).requestPasswordReset(username, message)}
      />
    );
  if (!user) return <p className="boot">Loading your workspace…</p>;
  if (user.must_change_password)
    return (
      <ForcePasswordChange
        api={api}
        user={user}
        onDone={(newPassword) => handleLogin(user.username, newPassword)}
        onLogout={logout}
      />
    );
  return <Dashboard api={api} user={user} onLogout={logout} />;
}