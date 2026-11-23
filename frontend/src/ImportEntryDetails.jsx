import PropTypes from "prop-types";
import {
  GRAMMAR_DEFINITIONS,
  adjectiveGroups,
  grammarFieldsFor,
  languageOfField,
  legacyLanguageName,
} from "./grammar.js";

export default function ImportEntryDetails({ row, text }) {
  const { entry } = row;
  const grammar = (language) => {
    const definition = GRAMMAR_DEFINITIONS[language];
    if (!definition) return [];
    const legacy = legacyLanguageName(language);
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
        !(field.endsWith("_singular") && entry[field] === row[legacy]),
    );
  };
  const groups = [
    ...Object.keys(GRAMMAR_DEFINITIONS).map(grammar),
    Object.values(GRAMMAR_DEFINITIONS).map(
      (definition) => definition.pronunciation,
    ),
    Object.values(GRAMMAR_DEFINITIONS).map((definition) => definition.example),
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
