import { useEffect, useState } from "react";
import { APP_VERSION, isDevBuild } from "../version";

const CHECK_EVERY_MS = 60 * 1000;

// Shows a bar when a newer version of the app has been deployed, so people refresh.
// Only in deployed builds (not with npm run dev).
export default function UpdateBanner() {
  const [newer, setNewer] = useState(false);

  useEffect(() => {
    if (isDevBuild) return;
    let stopped = false;

    async function check() {
      try {
        const res = await fetch("/version.json", { cache: "no-store" });
        if (!res.ok) return;
        const info = await res.json();
        if (!stopped && info.commit && info.commit !== APP_VERSION.commit) setNewer(true);
      } catch {
        /* server briefly unreachable, e.g. during a deploy: try again later */
      }
    }

    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!newer) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of the app is available.</span>
      <button className="pill sm primary" onClick={() => window.location.reload()}>
        Refresh
      </button>
    </div>
  );
}
