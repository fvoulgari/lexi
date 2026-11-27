import PropTypes from "prop-types";
import { directionLanguages, practiceSides } from "./card-sides.js";
import { languageTextProps } from "./languages.js";
import {
  adjectiveGroups,
  fromStructuredGrammar,
  grammarDefinition,
  grammarFieldLabelFor,
  grammarFieldsByKey,
  grammarValueFields,
  isGenderField,
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
  const values = { ...entry, ...fromStructuredGrammar(entry) };
  const answerGrammar = grammarDefinition(answerLanguage);
  const answerName = answerGrammar?.legacyName || answerLanguage;
  const populated = (fields) =>
    fields.filter((field) => {
      const value = values[field];
      return (
        value &&
        !(
          value === "common" &&
          !answerGrammar?.genders?.includes("common") &&
          isGenderField(field)
        )
      );
    });
  const adjective = entry.word_type === "adjective" && answerGrammar;
  const adjectiveForms = adjective ? adjectiveGroups(entry, answerLanguage) : [];
  const mainGender =
    adjective &&
    answerGrammar.genders.includes(values[answerGrammar.adjectiveGender])
      ? values[answerGrammar.adjectiveGender]
      : null;
  const mainPlural = adjective ? values[adjectiveForms[0]?.[0]] : null;
  const remaining = adjectiveForms
    .slice(1)
    .map(([singular, plural]) => ({
      gender: singular.split("_")[1],
      singular: values[singular],
      plural: values[plural],
    }))
    .filter((row) => row.singular || row.plural);
  const hasAdjectiveMetadata = mainGender || mainPlural || remaining.length > 0;
  const details = (key) =>
    grammarFieldsByKey(entry.word_type, [answerLanguage], key);
  const grammar =
    entry.word_type === "noun" && answerGrammar
      ? [
          grammarValueFields("noun", [answerLanguage], [
            "example",
            "pronunciation",
          ]),
        ]
      : [];
  const groups = [
    ...grammar.map(populated),
    populated([
      ...new Set([
        ...(answerGrammar?.example ? [answerGrammar.example] : []),
        ...details("example"),
      ]),
    ]),
    populated([
      ...new Set([
        ...(answerGrammar?.pronunciation ? [answerGrammar.pronunciation] : []),
        ...details("pronunciation"),
      ]),
    ]),
  ].filter((fields) => fields.length);
  function label(field) {
    if (
      field === "pronunciation" ||
      field === "greek_pronunciation" ||
      field.endsWith(".pronunciation")
    )
      return text.cardPronunciation;
    return grammarFieldLabelFor(field, text);
  }
  function fieldLanguage(field) {
    if (
      field === "pronunciation" ||
      field === "greek_pronunciation" ||
      field.endsWith(".pronunciation") ||
      field === "notes"
    )
      return undefined;
    return languageOfField(field) || answerLanguage;
  }
  return (
    <div className="flashcard">
      <div className="card-metadata">
        {entry.word_type && <span>{text[entry.word_type]}</span>}
      </div>
      <p {...languageTextProps(promptLanguage)} className="card-prompt">
        {sides.prompt}
      </p>
      {children}
      {revealed && (
        <div className="card-answer" ref={answerRef} tabIndex={-1}>
          <h2 {...languageTextProps(answerLanguage)}>{sides.answer}</h2>
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
                          <dd {...languageTextProps(answerLanguage)}>
                            {mainPlural}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {remaining.map((row) => (
                    <dl key={row.gender} className="adjective-gender-line">
                      <div>
                        <dt>{text[row.gender]}</dt>
                        <dd {...languageTextProps(answerLanguage)}>
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
                      <dd {...languageTextProps(fieldLanguage(field))}>
                        {isGenderField(field)
                          ? text[values[field]] || values[field]
                          : values[field]}
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
