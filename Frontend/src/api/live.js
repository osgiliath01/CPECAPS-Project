// Live updates from the backend (Server-Sent Events over fetch, so the sign-in token
// can go in a header instead of the URL). Reconnects by itself with a growing delay.
//
// handlers.onEvent(type, data)  type: "hello" | "message" | "resync" | "bye"
// handlers.onStatus(status)     status: "connecting" | "live" | "reconnecting"
// handlers.onUnauthorized()     the token expired or the account was deactivated
export function connectLive(url, token, handlers) {
  let stopped = false;
  let controller = null;
  let delay = 1000;

  function dispatch(block) {
    let type = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) return; // comment / keep-alive / retry hint
    let parsed;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    handlers.onEvent?.(type, parsed);
  }

  async function run() {
    while (!stopped) {
      controller = new AbortController();
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.status === 401) {
          handlers.onUnauthorized?.();
          return;
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        handlers.onStatus?.("live");
        delay = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value.replace(/\r\n/g, "\n");
          let cut;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            dispatch(buffer.slice(0, cut));
            buffer = buffer.slice(cut + 2);
          }
        }
      } catch {
        if (stopped) return;
      }
      if (stopped) return;
      handlers.onStatus?.("reconnecting");
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30000);
    }
  }

  handlers.onStatus?.("connecting");
  run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
