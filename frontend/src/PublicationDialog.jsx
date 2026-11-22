import { useEffect, useId, useRef } from "react";

export default function PublicationDialog({
  open,
  title,
  name,
  cardCount,
  cardsLabel,
  explanation,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
  children,
}) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    trigger.current = document.activeElement;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    element?.querySelector("[data-publication-confirm]")?.focus();
    return () => {
      if (element?.open) element.close();
      if (trigger.current?.isConnected) trigger.current.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="publication-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId} tabIndex={-1}>
        {title}
      </h2>
      <p className="publication-details">
        <strong>{name}</strong>
        <span>
          {cardCount} {cardsLabel}
        </span>
      </p>
      <p>{explanation}</p>
      {children}
      <div className="form-actions publication-actions">
        <button
          type="button"
          className="primary"
          data-publication-confirm
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
      </div>
    </dialog>
  );
}
