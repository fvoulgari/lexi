import { useId, useState } from "react";
import PropTypes from "prop-types";
import PracticeCardView from "./PracticeCardView.jsx";

export default function CardPreview({ entry, text }) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState("greek_to_italian");
  const [revealed, setRevealed] = useState(false);
  const id = useId();
  return (
    <div className="card-preview">
      <button
        type="button"
        className="secondary"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? text.cardHidePreview : text.cardPreview}
      </button>
      {open && (
        <section id={id} aria-label={text.cardPreview}>
          <p>{text.cardPreviewHint}</p>
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
};
