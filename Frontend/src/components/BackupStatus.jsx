import { useEffect, useState } from "react";
import { fmtStamp } from "../utils/format";

const STALE_AFTER = 26 * 60 * 60 * 1000; // a nightly backup plus some slack (e.g. the server was off)

// Admins: whether the nightly encrypted backup is running (see Backend/backup/backup.sh).
export default function BackupStatus({ api, version }) {
  const [s, setS] = useState(null);

  useEffect(() => {
    api.backupStatus?.().then(setS, () => setS(null));
  }, [api, version]);

  if (!s) return null;

  const okAt = s.last_ok_at ? new Date(s.last_ok_at).getTime() : 0;
  const failedAt = s.last_failed_at ? new Date(s.last_failed_at).getTime() : 0;
  const failedSince = failedAt > okAt;
  const stale = !okAt || Date.now() - okAt > STALE_AFTER;
  const state = failedSince ? "bad" : stale ? "warn" : "ok";

  let text;
  if (!okAt && !failedAt) text = "No backup yet. The first one runs shortly after the backup service starts.";
  else if (failedSince) text = `The last backup failed (${fmtStamp(s.last_failed_at)}). It will try again within an hour.`;
  else if (stale) text = `Last backup ${fmtStamp(s.last_ok_at)}: over a day ago. Is the server on and the backup service running?`;
  else text = `Last backup ${fmtStamp(s.last_ok_at)} (encrypted).`;

  return (
    <section className={`backup-status ${state}`} aria-label="Backups">
      <h3 className="security-title">Backups</h3>
      <p className="small">
        <span className="backup-dot" aria-hidden="true" />
        {text}
      </p>
      {failedSince && s.last_failed && <p className="small muted backup-detail">{s.last_failed}</p>}
    </section>
  );
}
