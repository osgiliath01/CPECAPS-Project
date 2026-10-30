import { useCallback, useEffect, useRef, useState } from "react";
import AdminMenu from "./AdminMenu";
import VoucherControl from "./ProjectsTable";
import SummaryOfExpenses from "./SummaryOfExpenses";
import EntryDialog from "./EntryDialog";
import PasswordDialog from "./PasswordDialog";
import CreateProjectDialog from "./ProjectDialog";
import ChatWidget from "./ChatWidget";
import ActivityLog from "./ActivityLog";
import MyRequests from "./MyRequests";
import UsersDialog from "./UsersDialog";
import ImportDialog from "./ImportDialog";
import logo from "../assets/logo.webp";

const FILTERS = [
  { key: "project_title", label: "Project Title" },
  { key: "payee", label: "Payee / Particulars" },
];

export default function Dashboard({ api, user, onLogout }) {
  const [projects, setProjects] = useState([]);
  const [creatingProject, setCreatingProject] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null); // null = voucher list, string = project title
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [fields, setFields] = useState(["project_title", "payee"]);
  const [dialog, setDialog] = useState(null); // { mode: "create" | "edit", entry? }
  const [pwOpen, setPwOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [myRequestsOpen, setMyRequestsOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [liveStatus, setLiveStatus] = useState("connecting");
  const [liveVersion, setLiveVersion] = useState(0); // bumps on every change, so open windows reload
  const reqId = useRef(0);

  const loadEntries = useCallback(async () => {
    try {
      const [rows, projectList] = await Promise.all([
        api.listDisbursements(),
        api.listProjects(),
      ]);
      setEntries(rows);
      setProjects(projectList);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const fetchSummary = useCallback(
    async (title) => {
      const id = ++reqId.current;
      if (!title) {
        setSummary(null);
        setSummaryLoading(false);
        return;
      }
      setSummaryLoading(true);
      try {
        const s = await api.getSummary(title);
        if (id === reqId.current) {
          setSummary(s);
          setError("");
        }
      } catch (e) {
        if (id === reqId.current) {
          setSummary(null);
          setError(e.message);
        }
      } finally {
        if (id === reqId.current) setSummaryLoading(false);
      }
    },
    [api]
  );

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    setSummary(null);
    fetchSummary(view);
  }, [view, fetchSummary]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = () => Promise.all([loadEntries(), fetchSummary(view)]);

  // Live updates: when anyone changes something, reload what's on screen
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    if (!api.connectLive) return; // demo mode
    let timer = null;
    let batch = [];
    let resync = false;
    let connectedBefore = false;

    const flush = () => {
      timer = null;
      const events = batch;
      const dataChanged = resync || events.some((e) => e.entity_type !== "user");
      batch = [];
      resync = false;
      if (dataChanged) refreshRef.current();
      setLiveVersion((v) => v + 1);
      const others = [
        ...new Set(
          events
            .filter((e) => e.actor !== user.username && e.actor !== "system" && e.entity_type !== "user")
            .map((e) => e.actor)
        ),
      ];
      if (others.length) setToast(`Updated by ${others.join(", ")}.`);
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(flush, 400); // group bursts, e.g. an import
    };

    const stop = api.connectLive({
      onStatus: setLiveStatus,
      onUnauthorized: onLogout,
      onEvent: (type, data) => {
        if (type === "hello") {
          if (connectedBefore) {
            resync = true; // reconnected: catch up on anything missed
            schedule();
          }
          connectedBefore = true;
        } else if (type === "resync") {
          resync = true;
          schedule();
        } else if (type === "bye") {
          onLogout();
        } else {
          batch.push(data);
          schedule();
        }
      },
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [api, user.username, onLogout]);


  const toggleField = (key) =>
    setFields((f) => (f.includes(key) ? f.filter((k) => k !== key) : [...f, key]));

  async function handleCreateProject(title) {
    await api.createProject(title);
    await loadEntries();
    setCreatingProject(false);
    setToast("Project created.");
  }

  async function handleSave(payload) {
    if (dialog.mode === "create") {
      await api.createDisbursement(payload);
      setToast("Entry added.");
    } else {
      try {
        if (!user.is_superuser) {
          // Normal users' edits wait for an admin's approval
          await api.requestEdit(dialog.entry.id, payload);
          setToast("Edit request sent to an admin.");
          setDialog(null);
          return;
        }
        await api.updateDisbursement(dialog.entry.id, payload);
        setToast("Entry updated.");
      } catch (e) {
        if (e.status === 409) refresh(); // someone else changed it: show the latest behind the dialog
        throw e;
      }
    }
    await refresh();
    setDialog(null);
  }

  async function handleDelete(entry) {
    try {
      await api.deleteDisbursement(entry.id);
      await refresh();
      setToast("Entry archived.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleArchiveProject(project) {
    try {
      await api.archiveProject(project.id);
      await loadEntries();
      setToast("Project archived.");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRequestDelete(entry, reason) {
    try {
      await api.requestDeletion(entry.id, reason);
      setToast("Archive request sent to an admin.");
    } catch (e) {
      setError(e.message);
    }
  }

  const initial = (user.name || user.username || "?").trim()[0].toUpperCase();

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <img src={logo} alt="Calamba Allied Industrial Corporation" />
        </div>

        <div className="searchblock">
          <label className="searchbox">
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
              <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
              <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span className="sr">Search</span>
            <input
              type="search"
              placeholder="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="filters" role="group" aria-label="Filter by">
            <span>Filter by:</span>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="chip"
                aria-pressed={fields.includes(f.key)}
                onClick={() => toggleField(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="topright">
          <span
            className={`live-dot ${liveStatus}`}
            title={
              liveStatus === "live"
                ? "Live: changes by others appear automatically"
                : "Reconnecting… changes by others will appear once connected"
            }
          >
            {liveStatus === "live" ? "Live" : "Reconnecting…"}
          </span>
          {user.is_superuser ? (
            <button className="pill sm" onClick={() => setReviewOpen(true)}>
              Activity Log
            </button>
          ) : (
            <button className="pill sm" onClick={() => setMyRequestsOpen(true)}>
              My requests
            </button>
          )}
          <AdminMenu
            user={user}
            initial={initial}
            onPassword={() => setPwOpen(true)}
            onUsers={() => setUsersOpen(true)}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="main">
        {error && (
          <div role="alert" className="banner">
            <span>{error}</span>
            <button className="link" onClick={refresh}>
              Try again
            </button>
          </div>
        )}

        {view === null ? (
          <VoucherControl
            entries={entries}
            projects={projects}
            loading={loading}
            q={q}
            fields={fields}
            isAdmin={user.is_superuser}
            onNew={() => setCreatingProject(true)}
            onView={(e) => setView(e.project_title)}
            onArchiveProject={handleArchiveProject}
            onImport={() => setImportOpen(true)}
          />
        ) : summary ? (
          <SummaryOfExpenses
            key={summary.project_title}
            summary={summary}
            q={q}
            onBack={() => setView(null)}
            onNew={() => setDialog({ mode: "create" })}
            onEdit={(entry) =>
              setDialog({ mode: "edit", entry: { ...entry, project_title: summary.project_title } })
            }
            isAdmin={user.is_superuser}
            onDelete={handleDelete}
            onRequestDelete={handleRequestDelete}
          />
        ) : (
          <>
            <button className="pill" onClick={() => setView(null)}>
              Back to Voucher Control
            </button>
            {summaryLoading && <p className="muted pad">Loading entries…</p>}
          </>
        )}
      </main>

      {dialog && (
        <EntryDialog
          key={dialog.entry?.id ?? "new"}
          mode={dialog.mode}
          entry={dialog.entry}
          defaultProject={view ?? ""}
          projectTitles={projects.map((p) => p.title)}
          user={user}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}

      {creatingProject && (
        <CreateProjectDialog
          onSave={handleCreateProject}
          onClose={() => setCreatingProject(false)}
        />
      )}
      {pwOpen && (
        <PasswordDialog
          onSave={async (body) => {
            await api.changePassword(body);
            setPwOpen(false);
            setToast("Password changed.");
          }}
          onClose={() => setPwOpen(false)}
        />
      )}
      {myRequestsOpen && (
        <MyRequests api={api} version={liveVersion} onClose={() => setMyRequestsOpen(false)} />
      )}
      {importOpen && (
        <ImportDialog
          api={api}
          onClose={() => setImportOpen(false)}
          onImported={async (res) => {
            setImportOpen(false);
            await loadEntries();
            setToast(
              `Imported ${res.imported} entr${res.imported === 1 ? "y" : "ies"}` +
                (res.new_projects.length ? ` and ${res.new_projects.length} new project(s)` : "") +
                (res.error_rows ? `; skipped ${res.error_rows} row(s)` : "") +
                "."
            );
          }}
        />
      )}
      {usersOpen && (
        <UsersDialog
          api={api}
          user={user}
          version={liveVersion}
          onClose={() => setUsersOpen(false)}
          onChanged={setToast}
        />
      )}
      {reviewOpen && (
        <ActivityLog
          version={liveVersion}
          api={api}
          user={user}
          onClose={() => setReviewOpen(false)}
          onChanged={(msg) => { setToast(msg); refresh(); }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <ChatWidget />
    </div>
  );
}