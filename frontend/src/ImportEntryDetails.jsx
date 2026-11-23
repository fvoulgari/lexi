import PropTypes from "prop-types";
import { cardLanguageIds, cardText } from "./card-sides.js";
import {
  GRAMMAR_DEFINITIONS,
  adjectiveGroups,
  grammarFieldsFor,
  languageOfField,
} from "./grammar.js";

export default function ImportEntryDetails({ row, text }) {
  const { entry } = row;
  // Only the card's own language IDs select grammar definitions; common-only
  // languages never borrow Italian/Greek fields by position.
  const languages = cardLanguageIds(entry).filter(
    (code) => GRAMMAR_DEFINITIONS[code],
  );
  const grammar = (language) => {
    const definition = GRAMMAR_DEFINITIONS[language];
    const fields =
      entry.word_type === "adjective"
        ? [
            definition.adjectiveGender,
            ...adjectiveGroups(entry, language).flat(),
            definition.forms[`${entry[definition.adjectiveGender]}_singular`],
          ]
        : grammarFieldsFor(entry.word_type, [language]);
    return fields.filter(
      (field) =>
        field &&
        entry[field] &&
        entry[field] !== "common" &&
        !(field.endsWith("_singular") && entry[field] === cardText(row, language)),
    );
  };
  const groups = [
    ...languages.map(grammar),
    languages.map((code) => GRAMMAR_DEFINITIONS[code].pronunciation),
    languages.map((code) => GRAMMAR_DEFINITIONS[code].example),
  ]
    .map((fields) => fields.filter((field) => entry[field]))
    .filter((fields) => fields.length);
  if (!groups.length && !row.tags?.length) return null;
  return (
    <details className="csv-entry-details">
      <summary>{text.csvDetails}</summary>
      <div className="card-detail-groups">
        {groups.map((fields) => (
          <dl key={fields[0]}>
            {fields.map((field) => (
              <div key={field}>
                <dt>{text.fields[field]}</dt>
                <dd
                  lang={
                    field.includes("pronunciation") || field.endsWith("_gender")
                      ? undefined
                      : languageOfField(field)
                  }
                >
                  {field.endsWith("_gender") ? text[entry[field]] : entry[field]}
                </dd>
              </div>
            ))}
          </dl>
        ))}
        {row.tags?.length > 0 && (
          <dl>
            <div>
              <dt>{text.tags}</dt>
              <dd>{row.tags.join(", ")}</dd>
            </div>
          </dl>
        )}
      </div>
    </details>
  );
}
ImportEntryDetails.propTypes = {
  row: PropTypes.object.isRequired,
  text: PropTypes.object.isRequired,
};
