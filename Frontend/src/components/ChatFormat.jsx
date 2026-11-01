// Turns an assistant answer into paragraphs and real tables. Tables are written by the model
// as Markdown-style lines with "|" between columns; **bold** is supported in normal text.
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
      <span key={k} className="chat-text">
        <Inline text={b.text} />
      </span>
    )
  );
}
