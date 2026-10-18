import { useId, useState } from "react";
import PropTypes from "prop-types";
import { X } from "lucide-react";
import PracticeCardView from "./PracticeCardView.jsx";

export default function CardPreview({
  entry,
  text,
  initiallyOpen = false,
  onClose,
  draft = true,
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [direction, setDirection] = useState("greek_to_italian");
  const [revealed, setRevealed] = useState(false);
  const id = useId();
  return (
    <div className="card-preview">
      {open && onClose ? (
        <div className="card-preview-heading">
          <h2>{text.cardPreview}</h2>
          <button
            type="button"
            className="card-preview-close"
            aria-label={text.cardHidePreview}
            title={text.cardHidePreview}
            onClick={onClose}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          aria-controls={id}
          onClick={() =>
            open && onClose ? onClose() : setOpen((value) => !value)
          }
        >
          {open ? text.cardHidePreview : text.cardPreview}
        </button>
      )}
      {open && (
        <section id={id} aria-label={text.cardPreview}>
          {draft && <p>{text.cardPreviewHint}</p>}
          <label htmlFor={`${id}-direction`}>{text.direction}</label>
          <select
            id={`${id}-direction`}
            value={direction}
            onChange={(event) => {
              setDirection(event.target.value);
              setRevealed(false);
            }}
          >
            <option value="greek_to_italian">
              {text.greek} → {text.italian}
            </option>
            <option value="italian_to_greek">
              {text.italian} → {text.greek}
            </option>
          </select>
          <PracticeCardView
            entry={entry}
            text={text}
            direction={direction}
            revealed={revealed}
          >
            <button
              type="button"
              className="primary"
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? text.cardHideAnswer : text.revealAnswer}
            </button>
          </PracticeCardView>
        </section>
      )}
    </div>
  );
}
CardPreview.propTypes = {
  entry: PropTypes.object.isRequired,
  text: PropTypes.object.isRequired,
  initiallyOpen: PropTypes.bool,
  onClose: PropTypes.func,
  draft: PropTypes.bool,
};
