import { useEffect, useRef } from "react";

export default function ConfirmDialog({
  title = "Delete record?",
  children,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
  confirmDisabled = false,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault(); // Esc key
        onCancel();
      }}
    >
      <h2>{title}</h2>
      <div>{children}</div>
      <div className="dialog-actions">
        <button type="button" className="pill" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="pill danger" onClick={onConfirm} disabled={confirmDisabled}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}