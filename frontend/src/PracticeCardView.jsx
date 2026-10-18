import PropTypes from "prop-types";

export default function PracticeCardView({
  entry,
  text,
  direction,
  revealed,
  answerRef,
  children,
}) {
  const front = direction === "greek_to_italian" ? "greek" : "italian";
  const back = front === "greek" ? "italian" : "greek";
  return (
    <div className="flashcard">
      <div className="card-metadata">
        <span>
          {entry.unit
            ? `${entry.unit.code} · ${entry.unit.title}`
            : text.noUnit}
        </span>
        {entry.word_type && <span>{text[entry.word_type]}</span>}
      </div>
      <p lang={front === "greek" ? "el" : "it"} className="card-prompt">
        {entry[front]}
      </p>
      {children}
      {revealed && (
        <div className="card-answer" ref={answerRef} tabIndex={-1}>
          <h2 lang={back === "greek" ? "el" : "it"}>{entry[back]}</h2>
          <dl>
            {[
              "italian_gender",
              "greek_gender",
              "italian_plural",
              "greek_plural",
              "italian_example",
              "greek_example",
              "pronunciation",
              "notes",
            ]
              .filter((field) => entry[field])
              .map((field) => (
                <div key={field}>
                  <dt>{text.fields[field]}</dt>
                  <dd>
                    {field.endsWith("_gender")
                      ? text[entry[field]]
                      : entry[field]}
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      )}
    </div>
  );
}

PracticeCardView.propTypes = {
  entry: PropTypes.object.isRequired,
  text: PropTypes.object.isRequired,
  direction: PropTypes.string.isRequired,
  revealed: PropTypes.bool.isRequired,
  answerRef: PropTypes.object,
  children: PropTypes.node,
};
