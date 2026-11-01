// On phones, tables are shown as stacked cards (see "Phones" in App.css). Each cell needs
// its column's name as a label, so this copies the header text onto every body cell
// (data-label="..."), and keeps doing so as tables appear or change.
const SELECTOR = "table.vtable, table.review-table";

function headerNames(table) {
  const row = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!row) return [];
  const names = [];
  for (const th of row.cells) {
    const text = (th.textContent || "").replace(/[↑↓]/g, "").trim();
    for (let i = 0; i < (th.colSpan || 1); i += 1) names.push(text);
  }
  return names;
}

function labelTable(table) {
  const names = headerNames(table);
  if (!names.length) return;
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      let col = 0;
      for (const cell of row.cells) {
        if ((cell.colSpan || 1) > 1) cell.classList.add("cell-full"); // e.g. an expanded detail row
        else if (cell.getAttribute("data-label") !== names[col]) cell.setAttribute("data-label", names[col] || "");
        col += cell.colSpan || 1;
      }
    }
  }
}

export function startTableLabels(root = document.body) {
  let queued = false;
  const run = () => {
    queued = false;
    root.querySelectorAll(SELECTOR).forEach(labelTable);
  };
  const observer = new MutationObserver(() => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(run);
    }
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  run();
  return () => observer.disconnect();
}
