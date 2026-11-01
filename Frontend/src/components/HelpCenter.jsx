import { Fragment, useEffect, useMemo, useState } from "react";
import { CATEGORIES, GUIDES } from "../help/guides";

// "**Edit**" in a step -> <strong>Edit</strong>; "*text*" -> <em>text</em>
function Rich({ text }) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("*") && part.length > 2 ? (
      <em key={i}>{part.slice(1, -1)}</em>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

// Guides marked done, remembered in this browser (per user). Never required: if the browser
// won't store it, the page simply forgets after a reload.
function useDone(username) {
  const key = `caic.help.done.${username}`;
  const [done, setDone] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      return new Set();
    }
  });
  const save = (next) => {
    setDone(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      /* private window etc.: fine */
    }
  };
  const toggle = (id) => {
    const next = new Set(done);
    next.has(id) ? next.delete(id) : next.add(id);
    save(next);
  };
  const reset = () => save(new Set());
  return { done, toggle, reset };
}

const forRole = (g, isAdmin) => g.roles === "all" || g.roles === (isAdmin ? "admin" : "staff");

// One guide, opened: one step at a time (Back / Next), or all steps at once
function Walkthrough({ guide, isDone, onDone, onGo }) {
  const [step, setStep] = useState(0);
  const [all, setAll] = useState(false);
  const last = guide.steps.length - 1;

  return (
    <div className="help-walk">
      {all ? (
        <ol className="help-steps">
          {guide.steps.map((s, i) => (
            <li key={i}><Rich text={s} /></li>
          ))}
        </ol>
      ) : (
        <>
          <div className="help-progress" aria-hidden="true">
            {guide.steps.map((_, i) => (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                className={`help-dot ${i === step ? "on" : i < step ? "past" : ""}`}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <p className="help-step-count">
            Step {step + 1} of {guide.steps.length}
          </p>
          <p className="help-step" aria-live="polite">
            <Rich text={guide.steps[step]} />
          </p>
          <div className="help-nav">
            <button type="button" className="pill sm" disabled={step === 0} onClick={() => setStep(step - 1)}>
              ← Back
            </button>
            {step < last ? (
              <button type="button" className="pill sm primary" onClick={() => setStep(step + 1)}>
                Next →
              </button>
            ) : (
              <button type="button" className={`pill sm ${isDone ? "" : "primary"}`} onClick={onDone}>
                {isDone ? "✓ Done (undo)" : "Mark as done ✓"}
              </button>
            )}
          </div>
        </>
      )}

      {guide.tips?.length > 0 && (
        <div className="help-tips">
          {guide.tips.map((t, i) => (
            <p key={i} className="small">
              💡 <Rich text={t} />
            </p>
          ))}
        </div>
      )}

      <div className="help-extra">
        <button type="button" className="link small" onClick={() => setAll(!all)}>
          {all ? "One step at a time" : "Show all steps"}
        </button>
        {guide.go && (
          <button type="button" className="pill sm view" onClick={() => onGo(guide.go)}>
            Take me there →
          </button>
        )}
      </div>
    </div>
  );
}

// User Guides: step-by-step guides for what the signed-in person can do.
export default function HelpCenter({ user, onGo }) {
  const isAdmin = !!user.is_superuser;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState(null);
  const { done, toggle, reset } = useDone(user.username);

  const mine = useMemo(() => GUIDES.filter((g) => forRole(g, isAdmin)), [isAdmin]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return mine.filter(
      (g) =>
        (!cat || g.cat === cat) &&
        (!needle || [g.title, g.summary, ...g.steps, ...(g.tips || [])].join(" ").toLowerCase().includes(needle))
    );
  }, [mine, q, cat]);
  const doneCount = mine.filter((g) => done.has(g.id)).length;

  // Searching: open the guide straight away when only one matches
  useEffect(() => {
    if (q.trim() && shown.length === 1) setOpen(shown[0].id);
  }, [q, shown]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User Guides</h1>
          <p className="project-name">
            Step-by-step guides for {isAdmin ? "admins" : "staff"}. Open one and follow it with Next, or jump straight
            to the screen with <strong>Take me there</strong>.
          </p>
        </div>
      </div>

      <section className="panel help">
        <div className="help-top">
          <input
            className="help-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the guides, e.g. archive, password, export"
            aria-label="Search the guides"
          />
          <div className="help-meter" title="Guides you've marked as done">
            <span>
              {doneCount} of {mine.length} done
            </span>
            <span className="help-bar" aria-hidden="true">
              <span style={{ width: `${(doneCount / Math.max(1, mine.length)) * 100}%` }} />
            </span>
            {doneCount > 0 && (
              <button type="button" className="link small" onClick={reset}>
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="help-cats" role="group" aria-label="Topics">
          <button type="button" className="help-cat" aria-pressed={!cat} onClick={() => setCat("")}>
            All <span className="seg-count">{mine.length}</span>
          </button>
          {CATEGORIES.map((c) => {
            const n = mine.filter((g) => g.cat === c.key).length;
            return n ? (
              <button key={c.key} type="button" className="help-cat" aria-pressed={cat === c.key} onClick={() => setCat(c.key)}>
                {c.label} <span className="seg-count">{n}</span>
              </button>
            ) : null;
          })}
        </div>

        {shown.length === 0 ? (
          <p className="muted">
            No guide matches “{q}”. Try another word, or ask the assistant (chat button, bottom right).
          </p>
        ) : (
          <ul className="help-list">
            {shown.map((g) => {
              const isOpen = open === g.id;
              const cat = CATEGORIES.find((c) => c.key === g.cat)?.label;
              return (
                <li key={g.id} className={`help-card ${isOpen ? "open" : ""} ${done.has(g.id) ? "done" : ""}`}>
                  <button
                    type="button"
                    className="help-card-head"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : g.id)}
                  >
                    <span className="help-check" aria-label={done.has(g.id) ? "Done" : "Not done yet"}>
                      {done.has(g.id) ? "✓" : ""}
                    </span>
                    <span className="help-card-text">
                      <span className="help-card-title">
                        {g.title}
                        {g.roles === "admin" && <span className="log-badge st-pending help-role">Admins</span>}
                      </span>
                      <span className="help-card-sub">
                        {g.summary} <span className="muted">· {cat} · {g.steps.length} steps</span>
                      </span>
                    </span>
                    <span className="help-chevron" aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
                  </button>
                  {isOpen && (
                    <Walkthrough key={g.id} guide={g} isDone={done.has(g.id)} onDone={() => toggle(g.id)} onGo={onGo} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
