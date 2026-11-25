import { useEffect, useId, useState } from "react";
import PropTypes from "prop-types";
import { X } from "lucide-react";
import PracticeCardView from "./PracticeCardView.jsx";
import {
  directionLabel,
  isLegacyPair,
  languageLabel,
  LEGACY_PAIR,
  pairDirections,
} from "./languages.js";
import { cardLanguageIds } from "./card-sides.js";

export default function CardPreview({
  entry,
  text,
  initiallyOpen = false,
  onClose,
  draft = true,
  pair,
}) {
  const ids = pair || cardLanguageIds(entry);
  // Historical el/it drafts keep the original Greek-first preview order.
  const languages = isLegacyPair(...ids) ? LEGACY_PAIR : ids;
  const directions = pairDirections(...languages);
  const firstDirection = directions[0];
  const [open, setOpen] = useState(initiallyOpen);
  const [direction, setDirection] = useState(firstDirection);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setDirection(firstDirection);
    setRevealed(false);
  }, [firstDirection]);
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
            {directions.map((key) => (
              <option key={key} value={key}>
                {directionLabel(key, languageLabel)}
              </option>
            ))}
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
  pair: PropTypes.arrayOf(PropTypes.string),
};
