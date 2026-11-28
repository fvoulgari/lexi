import { useRef } from "react";

const TAP_SLOP = 8;
const EDGE_GUTTER = 24;
const DOMINANCE = 1.35;

function dragRating(x, y) {
  if (Math.abs(x) > Math.abs(y) * DOMINANCE) return x > 0 ? "easy" : "hard";
  if (-y > Math.abs(x) * DOMINANCE) return "again";
  return null;
}

export default function usePracticeGesture({ revealed, disabled, onRate }) {
  const cardRef = useRef(null);
  const gesture = useRef(null);
  const allowClick = useRef(false);

  function release() {
    const active = gesture.current;
    gesture.current = null;
    if (active?.surface.hasPointerCapture?.(active.id))
      active.surface.releasePointerCapture(active.id);
  }

  function reset() {
    release();
    const card = cardRef.current;
    if (!card) return;
    delete card.dataset.dragging;
    delete card.dataset.dragRating;
    for (const property of [
      "--drag-x",
      "--drag-y",
      "--drag-turn",
      "--drag-feedback",
    ])
      card.style.removeProperty(property);
  }

  const surfaceProps = {
    "data-gesture-surface": revealed ? "rate" : "reveal",
    onPointerDown(event) {
      if (!revealed) allowClick.current = false;
      if (
        disabled ||
        gesture.current ||
        event.button !== 0 ||
        event.isPrimary === false
      )
        return;
      const viewport = window.innerWidth;
      if (
        event.pointerType === "touch" &&
        (event.clientX < EDGE_GUTTER || event.clientX > viewport - EDGE_GUTTER)
      )
        return;
      const surface = event.currentTarget;
      gesture.current = {
        id: event.pointerId,
        surface,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        horizontal: Math.max(
          48,
          Math.min(110, cardRef.current.offsetWidth * 0.23),
        ),
        vertical: Math.max(48, Math.min(100, window.innerHeight * 0.12)),
      };
      if (revealed) surface.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event) {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId) return;
      const x = event.clientX - active.x;
      const y = event.clientY - active.y;
      active.moved ||= Math.hypot(x, y) > TAP_SLOP;
      if (!revealed || disabled || !active.moved) return;
      const rating = dragRating(x, y);
      const card = cardRef.current;
      card.dataset.dragging = "";
      card.dataset.dragRating = rating || "";
      card.style.setProperty("--drag-x", `${x}px`);
      card.style.setProperty("--drag-y", `${y}px`);
      card.style.setProperty(
        "--drag-turn",
        `${rating === "again" ? 0 : Math.max(-9, Math.min(9, x / 20))}deg`,
      );
      card.style.setProperty(
        "--drag-feedback",
        Math.min(
          1,
          rating === "again"
            ? -y / active.vertical
            : Math.abs(x) / active.horizontal,
        ),
      );
    },
    onPointerUp(event) {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId) return;
      const x = event.clientX - active.x;
      const y = event.clientY - active.y;
      release();
      if (disabled) return;
      if (!revealed) {
        allowClick.current = !active.moved && Math.hypot(x, y) <= TAP_SLOP;
        return;
      }
      const rating = dragRating(x, y);
      const crossed =
        rating === "again"
          ? -y >= active.vertical
          : Math.abs(x) >= active.horizontal;
      if (rating && crossed) onRate(rating, true);
      else reset();
    },
    onPointerCancel(event) {
      if (gesture.current?.id === event.pointerId) reset();
    },
    onLostPointerCapture(event) {
      if (gesture.current?.id === event.pointerId) reset();
    },
    onPointerLeave(event) {
      if (!revealed && gesture.current?.id === event.pointerId) reset();
    },
  };

  function canReveal(event) {
    const allowed = event.detail === 0 || allowClick.current;
    allowClick.current = false;
    return allowed;
  }

  async function exit(rating) {
    const card = cardRef.current;
    if (
      !card?.animate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const transform = {
      easy: "translateX(105vw) rotate(10deg)",
      hard: "translateX(-105vw) rotate(-10deg)",
      again: "translateY(-65vh)",
    }[rating];
    const animation = card.animate(
      [
        { transform: getComputedStyle(card).transform },
        { transform, opacity: 0 },
      ],
      { duration: 240, easing: "cubic-bezier(.3,.65,.55,1)", fill: "forwards" },
    );
    await animation.finished.catch(() => {});
  }

  return { cardRef, surfaceProps, canReveal, exit, reset };
}
