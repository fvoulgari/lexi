import PropTypes from "prop-types";
import { directionLanguages, practiceSides } from "./card-sides.js";
import {
  adjectiveGroups,
  grammarDefinition,
  languageOfField,
} from "./grammar.js";

export default function PracticeCardView({
  entry,
  text,
  direction,
  revealed,
  answerRef,
  children,
}) {
  const sides = practiceSides(entry, direction);
  const [promptLanguage, answerLanguage] = directionLanguages(direction);
  const answerGrammar = grammarDefinition(answerLanguage);
  const answerName = answerGrammar?.legacyName || answerLanguage;
  const populated = (fields) =>
    fields.filter(
      (field) =>
        entry[field] &&
        !(field.endsWith("_gender") && entry[field] === "common"),
    );
  const adjective = entry.word_type === "adjective" && answerGrammar;
  const adjectiveForms = adjective ? adjectiveGroups(entry, answerLanguage) : [];
  const mainGender =
    adjective &&
    answerGrammar.genders.includes(entry[answerGrammar.adjectiveGender])
      ? entry[answerGrammar.adjectiveGender]
      : null;
  const mainPlural = adjective ? entry[adjectiveForms[0][0]] : null;
  const remaining = adjectiveForms
    .slice(1)
    .map(([singular, plural]) => ({
      gender: singular.split("_")[1],
      singular: entry[singular],
      plural: entry[plural],
    }))
    .filter((row) => row.singular || row.plural);
  const hasAdjectiveMetadata = mainGender || mainPlural || remaining.length > 0;
  const grammar =
    entry.word_type === "noun" && answerGrammar
      ? [[answerGrammar.nounGender, answerGrammar.nounPlural]]
      : [];
  const groups = [
    ...grammar.map(populated),
    populated(answerGrammar ? [answerGrammar.example] : []),
    populated(answerGrammar ? [answerGrammar.pronunciation] : []),
  ].filter((fields) => fields.length);
  function label(field) {
    if (field === "pronunciation" || field === "greek_pronunciation")
      return text.cardPronunciation;
    return (
      text.cardDetailLabels[field.replace(/^(italian|greek)_/, "")] ||
      text.fields[field]
    );
  }
  return (
    <div className="flashcard">
      <div className="card-metadata">
        {entry.word_type && <span>{text[entry.word_type]}</span>}
      </div>
      <p lang={promptLanguage} className="card-prompt">
        {sides.prompt}
      </p>
      {children}
      {revealed && (
        <div className="card-answer" ref={answerRef} tabIndex={-1}>
          <h2 lang={answerLanguage}>{sides.answer}</h2>
          {(groups.length > 0 || hasAdjectiveMetadata) && (
            <div className="card-detail-groups" aria-label={text[answerName]}>
              {hasAdjectiveMetadata && (
                <div className="adjective-metadata">
                  {(mainGender || mainPlural) && (
                    <dl className="adjective-main-line">
                      {mainGender && (
                        <div>
                          <dt>{text.cardDetailLabels.gender}</dt>
                          <dd>{text[mainGender]}</dd>
                        </div>
                      )}
                      {mainPlural && (
                        <div>
                          <dt>{text.cardDetailLabels.plural}</dt>
                          <dd lang={answerLanguage}>{mainPlural}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {remaining.map((row) => (
                    <dl key={row.gender} className="adjective-gender-line">
                      <div>
                        <dt>{text[row.gender]}</dt>
                        <dd lang={answerLanguage}>
                          {row.singular && row.plural ? (
                            <>
                              <span>{row.singular}</span>
                              {" / "}
                              <span>{row.plural}</span>
                            </>
                          ) : (
                            <>
                              <span className="adjective-form-kind">
                                {row.singular
                                  ? text.cardDetailLabels.singular
                                  : text.cardDetailLabels.plural}
                                :{" "}
                              </span>
                              <span>{row.singular || row.plural}</span>
                            </>
                          )}
                        </dd>
                      </div>
                    </dl>
                  ))}
                </div>
              )}
              {groups.map((fields) => (
                <dl key={fields[0]}>
                  {fields.map((field) => (
                    <div key={field}>
                      <dt>{label(field)}</dt>
                      <dd
                        lang={
                          field === "pronunciation" ||
                          field === "greek_pronunciation" ||
                          field === "notes"
                            ? undefined
                            : languageOfField(field) || answerLanguage
                        }
                      >
                        {field.endsWith("_gender")
                          ? text[entry[field]]
                          : entry[field]}
                      </dd>
                    </div>
                  ))}
                </dl>
              ))}
            </div>
          )}
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
