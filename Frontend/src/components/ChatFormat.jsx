// Turns an assistant answer into paragraphs and real tables. Tables are written by the model
// as Markdown-style lines with "|" between columns. In normal text: **bold**, headings
// ("### Title" shows as a bold line, without the #), dividers ("---") and "* " bullets.
const isTableLine = (line) => (line.match(/\|/g) || []).length >= 1 && line.trim().length > 1;
const isSeparator = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
const splitCells = (line) => {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
};
const isNumber = (s) => /^[-(]?\s*(₱|PHP)?\s*[\d,]+(\.\d+)?\)?$/.test(s.trim());

function Inline({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : p
  );
}

function Table({ lines }) {
  const rows = lines.map(splitCells).filter((cells) => !isSeparator(cells));
  const [head, ...body] = rows;
  const width = Math.max(...rows.map((r) => r.length));
  const numeric = Array.from({ length: width }, (_, col) =>
    body.length > 0 && body.every((r) => !r[col] || isNumber(r[col]))
  );
  const cell = (r, col) => r[col] ?? "";
  return (
    <div className="chat-table-wrap">
      <table className="chat-table">
        <thead>
          <tr>
            {Array.from({ length: width }, (_, col) => (
              <th key={col} className={numeric[col] ? "num" : undefined}>
                <Inline text={cell(head, col)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {Array.from({ length: width }, (_, col) => (
                <td key={col} className={numeric[col] ? "num" : undefined}>
                  <Inline text={cell(r, col)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

// A text block line by line: headings and dividers get their own elements, the rest stays as
// written (line breaks kept)
function TextBlock({ text }) {
  const out = [];
  let plain = [];
  const flush = () => {
    const chunk = plain.join("\n").replace(/^\n+|\n+$/g, "");
    if (chunk) out.push(<span key={out.length} className="chat-text"><Inline text={chunk} /></span>);
    plain = [];
  };
  for (const line of text.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      out.push(<strong key={out.length} className="chat-heading"><Inline text={heading[1].replace(/\*\*/g, "")} /></strong>);
    } else if (RULE.test(line)) {
      flush();
      out.push(<hr key={out.length} className="chat-rule" />);
    } else {
      plain.push(line.replace(/^(\s*)[*+]\s+/, "$1• ").replace(/^(\s*)-\s+/, "$1• "));
    }
  }
  flush();
  return out;
}

export function FormattedAnswer({ text }) {
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableLine(lines[i]) && i + 1 < lines.length && isTableLine(lines[i + 1])) {
      const start = i;
      while (i < lines.length && isTableLine(lines[i])) i++;
      blocks.push({ type: "table", lines: lines.slice(start, i) });
    } else {
      const start = i;
      while (i < lines.length && !(isTableLine(lines[i]) && i + 1 < lines.length && isTableLine(lines[i + 1]))) i++;
      const chunk = lines.slice(start, i).join("\n").trim();
      if (chunk) blocks.push({ type: "text", text: chunk });
    }
  }
  return blocks.map((b, k) =>
    b.type === "table" ? (
      <Table key={k} lines={b.lines} />
    ) : (
      <TextBlock key={k} text={b.text} />
    )
  );
}
