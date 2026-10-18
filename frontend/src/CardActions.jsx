import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import PropTypes from "prop-types";
import CardPreview from "./CardPreview.jsx";

export default function CardActions({
  entry,
  text,
  open,
  onOpenChange,
  editDisabled,
  deleteDisabled,
  onEdit,
  onDelete,
}) {
  const trigger = useRef(null);
  const menu = useRef(null);
  const lastFirst = useRef(false);
  const previewDialog = useRef(null);
  const [previewing, setPreviewing] = useState(false);
  const id = useId();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (previewing) {
      previewDialog.current.showModal();
      previewDialog.current.querySelector("button")?.focus();
    }
  }, [previewing]);
  function dismiss(restore = true) {
    onOpenChange(false);
    if (restore && trigger.current?.isConnected) trigger.current.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const button = trigger.current;
    const panel = menu.current;
    function place() {
      const rect = button.getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const navigation = document.querySelector(".mobile-navigation");
      const bottom = navigation?.getClientRects().length
        ? Math.min(top + height, navigation.getBoundingClientRect().top)
        : top + height;
      setPosition({
        left: Math.max(
          left + 8,
          Math.min(rect.right - bounds.width, left + width - bounds.width - 8),
        ),
        top: Math.max(
          top + 8,
          Math.min(
            rect.bottom + 6 + bounds.height <= bottom - 8
              ? rect.bottom + 6
              : rect.top - bounds.height - 6,
            bottom - bounds.height - 8,
          ),
        ),
        maxHeight: Math.max(44, bottom - top - 16),
      });
    }
    function outside(event) {
      if (!panel.contains(event.target) && !button.contains(event.target)) {
        // Keep focus on the trigger when dismissing against noninteractive content.
        if (
          !event.target.closest("button, a, input, select, textarea, summary")
        )
          event.preventDefault();
        onOpenChange(false);
        button.focus();
      }
    }
    function focusOutside(event) {
      if (!panel.contains(event.target) && !button.contains(event.target))
        onOpenChange(false);
    }
    place();
    const items = panel.querySelectorAll("button:not(:disabled)");
    items[lastFirst.current ? items.length - 1 : 0]?.focus();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focusOutside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", focusOutside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, onOpenChange]);

  function navigate(event) {
    const items = [...menu.current.querySelectorAll("button:not(:disabled)")];
    const index = items.indexOf(document.activeElement);
    let next;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key === "Tab") {
      dismiss();
      return;
    }
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      next = items.findIndex(
        (item, i) =>
          i > index &&
          item.textContent
            .toLocaleLowerCase()
            .startsWith(event.key.toLocaleLowerCase()),
      );
      if (next < 0)
        next = items.findIndex((item) =>
          item.textContent
            .toLocaleLowerCase()
            .startsWith(event.key.toLocaleLowerCase()),
        );
    }
    if (next !== undefined && next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  }
  return (
    <>
      <button
        type="button"
        className="card-actions-trigger"
        ref={trigger}
        aria-label={`${text.cardActions}: ${entry.italian}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={editDisabled && deleteDisabled}
        onClick={() => {
          lastFirst.current = false;
          onOpenChange(!open);
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            lastFirst.current = event.key === "ArrowUp";
            onOpenChange(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            dismiss();
          }
        }}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={menu}
            role="menu"
            aria-label={`${text.cardActions}: ${entry.italian}`}
            className="card-actions-menu"
            style={position}
            onKeyDown={navigate}
          >
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={`${text.editEntry}: ${entry.italian}`}
              disabled={editDisabled}
              onClick={() => {
                dismiss(false);
                onEdit();
              }}
            >
              {text.editEntry}
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={`${text.cardPreview}: ${entry.italian}`}
              disabled={editDisabled}
              onClick={() => {
                dismiss(false);
                setPreviewing(true);
              }}
            >
              {text.cardPreview}
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="card-action-delete"
              aria-label={`${text.deleteEntry}: ${entry.italian}`}
              disabled={deleteDisabled}
              onClick={() => {
                dismiss(false);
                onDelete(trigger.current);
              }}
            >
              {text.deleteEntry}
            </button>
          </div>,
          document.body,
        )}
      {previewing &&
        createPortal(
          <dialog
            ref={previewDialog}
            className="card-preview-dialog"
            aria-label={`${text.cardPreview}: ${entry.italian}`}
            onCancel={(event) => {
              event.preventDefault();
              previewDialog.current.close();
            }}
            onClose={() => {
              setPreviewing(false);
              trigger.current?.focus();
            }}
          >
            <CardPreview
              entry={entry}
              text={text}
              initiallyOpen
              draft={false}
              onClose={() => previewDialog.current.close()}
            />
          </dialog>,
          document.body,
        )}
    </>
  );
}
CardActions.propTypes = {
  entry: PropTypes.object.isRequired,
  text: PropTypes.object.isRequired,
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  editDisabled: PropTypes.bool.isRequired,
  deleteDisabled: PropTypes.bool.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};
