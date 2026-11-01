// Checkboxes and the bar shown while items are ticked (see hooks/useSelection.js).
import { plural } from "../hooks/useSelection";

export function SelectAll({ pageIds, selection, label = "Select all on this page" }) {
  const ticked = pageIds.filter((id) => selection.has(id)).length;
  const all = pageIds.length > 0 && ticked === pageIds.length;
  return (
    <input
      type="checkbox"
      className="select-box"
      aria-label={label}
      title={label}
      checked={all}
      ref={(el) => el && (el.indeterminate = ticked > 0 && !all)}
      disabled={pageIds.length === 0}
      onChange={() => selection.togglePage(pageIds)}
    />
  );
}

export function SelectOne({ id, selection, label }) {
  return (
    <input
      type="checkbox"
      className="select-box"
      aria-label={label}
      checked={selection.has(id)}
      onChange={() => selection.toggle(id)}
    />
  );
}

export function SelectionBar({ selection, noun = "item", children }) {
  if (!selection.count) return null;
  const n = selection.count;
  return (
    <div className="selection-bar" role="region" aria-label="Selected items">
      <strong>
        {plural(n, noun)} selected
      </strong>
      <div className="selection-actions">
        {children}
        <button type="button" className="pill sm" onClick={selection.clear}>
          Clear
        </button>
      </div>
    </div>
  );
}
