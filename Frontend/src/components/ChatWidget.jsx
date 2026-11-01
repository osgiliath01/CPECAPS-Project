import { useEffect, useRef, useState } from "react";
import { FormattedAnswer } from "./ChatFormat";

const greeting = (user) => ({
  from: "bot",
  text:
    `Hi ${user?.name || "there"}! Ask me about projects, payees and vouchers, for example ` +
    `"Which projects spent the most this year?" or "Show the latest payments to Laguna Steel."`,
});

export default function ChatWidget({ api, user }) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [messages, setMessages] = useState(() => [greeting(user)]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const endRef = useRef(null);
  const abortRef = useRef(null);

  // keep the newest message in view
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open, status]);

  // Escape closes the panel
  useEffect(() => {
    if (!open) return;
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);

  // stop an answer in progress if the page goes away
  useEffect(() => {
    const ref = abortRef;
    return () => ref.current?.abort();
  }, []);

  // adds text to the answer being written (the last message)
  const appendToAnswer = (piece) =>
    setMessages((m) => {
      const last = m[m.length - 1];
      return [...m.slice(0, -1), { ...last, text: last.text + piece }];
    });

  async function send(e) {
    e.preventDefault();
    const msg = text.trim();
    if (!msg || busy) return;
    if (!api?.chat) {
      setMessages((m) => [...m, { from: "user", text: msg }, { from: "bot", text: "The assistant isn't available in demo mode." }]);
      setText("");
      return;
    }

    // conversation so far, without the greeting and without failed answers
    const history = messages
      .slice(1)
      .filter((m) => !m.error && m.text)
      .map((m) => ({ role: m.from === "user" ? "user" : "assistant", content: m.text }));
    history.push({ role: "user", content: msg });

    setText("");
    setMessages((m) => [...m, { from: "user", text: msg }, { from: "bot", text: "" }]);
    setBusy(true);
    setStatus("Thinking…");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await api.chat(
        history,
        (ev) => {
          if (ev.type === "status") setStatus(ev.text);
          else if (ev.type === "delta") {
            setStatus("");
            appendToAnswer(ev.text);
          } else if (ev.type === "replace") {
            setMessages((m) => [...m.slice(0, -1), { ...m[m.length - 1], text: ev.text }]);
          } else if (ev.type === "error") {
            setMessages((m) => {
              const last = m[m.length - 1];
              const text = last.text ? `${last.text}\n\n${ev.text}` : ev.text;
              return [...m.slice(0, -1), { ...last, text, error: !last.text }];
            });
          }
        },
        controller.signal
      );
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages((m) => [
          ...m.slice(0, -1),
          { from: "bot", text: err.message || "Sorry, something went wrong. Please try again.", error: true },
        ]);
      }
    } finally {
      // an answer that never arrived (stopped early) is dropped
      setMessages((m) => (m[m.length - 1]?.from === "bot" && !m[m.length - 1].text ? m.slice(0, -1) : m));
      abortRef.current = null;
      setBusy(false);
      setStatus("");
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clear() {
    stop();
    setMessages([greeting(user)]);
  }

  return (
    <>
      {open && (
        <section className={`chat-panel${wide ? " wide" : ""}`} aria-label="Assistant">
          <header className="chat-head">
            <strong>Assistant</strong>
            <span className="chat-head-actions">
              <button className="chat-clear" onClick={clear} disabled={messages.length < 2} title="Start a new conversation">
                New chat
              </button>
              <button
                className="chat-clear"
                onClick={() => setWide((w) => !w)}
                aria-pressed={wide}
                title={wide ? "Make the chat smaller" : "Make the chat wider, e.g. for tables"}
              >
                {wide ? "Smaller" : "Expand"}
              </button>
              <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">
                ×
              </button>
            </span>
          </header>

          <div className="chat-body" aria-live="polite">
            {messages.map((m, i) =>
              m.text ? (
                <div key={i} className={`chat-msg ${m.from}${m.error ? " error-msg" : ""}`}>
                  {m.from === "bot" ? <FormattedAnswer text={m.text} /> : m.text}
                </div>
              ) : null
            )}
            {busy && status && <p className="chat-msg bot muted">{status}</p>}
            <div ref={endRef} />
          </div>

          <form className="chat-form" onSubmit={send}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ask about projects, payees, vouchers…"
              aria-label="Message"
              maxLength={1000}
              autoFocus
            />
            {busy ? (
              <button type="button" className="pill sm" onClick={stop}>
                Stop
              </button>
            ) : (
              <button className="pill create sm" disabled={!text.trim()}>
                Send
              </button>
            )}
          </form>
          <p className="chat-note">Answers come from your records but can be wrong. Check important figures.</p>
        </section>
      )}

      <button
        className="chat-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : "Open chat"}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <path
            d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </>
  );
}
