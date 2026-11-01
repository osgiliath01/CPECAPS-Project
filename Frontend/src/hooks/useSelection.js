import { useCallback, useMemo, useState } from "react";

// Ticked items in a list (by id). The selection survives paging, so items on several pages
// can be picked; "all on this page" ticks or unticks just the page shown.
export function useSelection() {
  const [ids, setIds] = useState(() => new Set());

  const toggle = useCallback((id) => {
    setIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const togglePage = useCallback((pageIds) => {
    setIds((prev) => {
      const next = new Set(prev);
      const all = pageIds.length > 0 && pageIds.every((id) => next.has(id));
      pageIds.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });
  }, []);

  const clear = useCallback(() => setIds(new Set()), []);
  // Drop ids that are no longer in the list (e.g. archived by someone else meanwhile)
  const keepOnly = useCallback((validIds) => {
    setIds((prev) => {
      const valid = new Set(validIds);
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  return useMemo(
    () => ({ ids, count: ids.size, has: (id) => ids.has(id), toggle, togglePage, clear, keepOnly, list: () => [...ids] }),
    [ids, toggle, togglePage, clear, keepOnly]
  );
}

const PLURAL = { entry: "entries", project: "projects", item: "items", request: "requests" };
export const plural = (n, noun) => `${n} ${n === 1 ? noun : PLURAL[noun] || noun + "s"}`;

// "3 entries archived. 1 skipped: CV# A1 is already archived."
export function bulkMessage(res, noun, verb) {
  let msg = `${plural(res?.done ?? 0, noun)} ${verb}.`;
  const skipped = res?.skipped || [];
  if (skipped.length) {
    msg += ` ${skipped.length} skipped: ${skipped.slice(0, 2).join("; ")}${skipped.length > 2 ? "; ..." : ""}.`;
  }
  return msg;
}
