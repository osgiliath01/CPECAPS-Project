import { useCallback, useEffect, useRef, useState } from "react";
import { tokenExpiresAt } from "../api/api";

// Keeps a sign-in alive while the person is using the app, and lets it expire when they're not.
//
// - Activity = clicks, taps, typing, scrolling. Live updates arriving don't count, so a screen
//   left open doesn't stay signed in forever.
// - After activity, once the token is RENEW_AFTER old, it's swapped for a fresh one in the
//   background (POST /auth/refresh). So the session ends about 30 minutes after the last activity.
// - WARN_BEFORE the end with no activity, `warning` holds the seconds left, so the app can
//   offer "Stay signed in". At the end, onExpired() signs out.
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
const RENEW_AFTER = 5 * 60 * 1000;
const WARN_BEFORE = 2 * 60 * 1000;
const RETRY_AFTER = 30 * 1000; // after a failed renewal (e.g. offline), wait before trying again

export function useSessionKeepAlive({ token, api, enabled, onRenewed, onExpired }) {
  const lastActivity = useRef(Date.now());
  const issuedAt = useRef(Date.now()); // when the current token arrived, on this computer's clock
  const expiresAt = useRef(null);
  const renewing = useRef(false);
  const lastTry = useRef(0);
  const [warning, setWarning] = useState(null);

  // A new token: time it from now
  useEffect(() => {
    issuedAt.current = Date.now();
    expiresAt.current = tokenExpiresAt(token);
  }, [token]);

  const renew = useCallback(async () => {
    if (renewing.current || !api?.refreshToken || Date.now() - lastTry.current < RETRY_AFTER) return;
    renewing.current = true;
    lastTry.current = Date.now();
    try {
      const res = await api.refreshToken();
      if (res?.access_token) onRenewed(res.access_token);
    } catch {
      /* a 401 already signs out through the api's own handler; anything else: try again later */
    } finally {
      renewing.current = false;
    }
  }, [api, onRenewed]);

  // Note activity (cheap: just a timestamp)
  useEffect(() => {
    if (!enabled) return;
    const mark = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, mark, { capture: true }));
  }, [enabled]);

  // After a page reload the token's age isn't known here: renew once straight away
  useEffect(() => {
    if (enabled) renew();
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once a second: renew if active, warn if about to expire, sign out at the end
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const now = Date.now();
      const end = expiresAt.current;
      const activeSinceToken = lastActivity.current > issuedAt.current;
      // Renew every 5 minutes of use (sooner if sessions are set shorter than 15 minutes)
      const renewAfter = end ? Math.min(RENEW_AFTER, (end - issuedAt.current) / 3) : RENEW_AFTER;
      if (activeSinceToken && now - issuedAt.current > renewAfter) renew();
      if (!end) return;
      const left = end - now;
      if (left <= 0) {
        setWarning(null);
        onExpired();
      } else if (left <= WARN_BEFORE && !activeSinceToken) {
        setWarning(Math.ceil(left / 1000));
      } else {
        setWarning(null);
      }
    };
    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
  }, [enabled, renew, onExpired]);

  // "Stay signed in": counts as activity and renews right away
  const stay = useCallback(() => {
    lastActivity.current = Date.now();
    setWarning(null);
    renew();
  }, [renew]);

  return { warning, stay };
}
