import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function CsvDialog({
  title,
  cancelLabel,
  children,
  onClose,
  busy,
}) {
  const dialog = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      trigger?.focus();
    };
  }, []);

  // Keep the modal out of the page's form containers so their broad label and
  // input rules cannot override the dialog's own layout.
  return createPortal(
    <dialog
      ref={dialog}
      className="csv-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="csv-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="csv-close"
          aria-label={cancelLabel}
          disabled={busy}
          onClick={onClose}
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}
