import PropTypes from "prop-types";
import { cardLanguageIds, cardText } from "./card-sides.js";
import { languageTextProps } from "./languages.js";
import {
  GRAMMAR_DEFINITIONS,
  adjectiveGroups,
  grammarFieldLabelFor,
  grammarFieldsByKey,
  grammarValueFields,
  isGenderField,
  languageOfField,
} from "./grammar.js";

function structuredValue(entry, field) {
  if (entry[field] !== undefined) return entry[field];
  const match = String(field).match(/^grammar\.([^.]+)\.(.+)$/);
  if (!match) return undefined;
  const [, language, key] = match;
  const grammar = entry.grammar?.[language];
  if (key.startsWith("forms.")) return grammar?.forms?.[key.slice(6)];
  return grammar?.[key];
}

export default function ImportEntryDetails({ row, text }) {
  const { entry } = row;
  // Only the row's explicit language IDs select grammar definitions; a
  // common-only language never borrows enhanced fields by position.
  const languages = (row.source_language || row.target_language
    ? [row.source_language, row.target_language]
    : cardLanguageIds(entry)
  ).filter((code) => GRAMMAR_DEFINITIONS[code]);
  const grammar = (language) => {
    const definition = GRAMMAR_DEFINITIONS[language];
    const legacy =
      entry.word_type === "adjective"
        ? [
            definition.adjectiveGender,
            ...adjectiveGroups(entry, language).flat(),
            definition.forms[`${entry[definition.adjectiveGender]}_singular`],
          ]
        : [];
    const structured = grammarValueFields(entry.word_type, [language], [
      "example",
      "pronunciation",
    ]);
    return [...new Set([...legacy, ...structured])].filter((field) => {
      const value = structuredValue(entry, field);
      if (!field || !value) return false;
      // `common` is a valid Danish gender but never an Italian/Greek one.
      if (
        value === "common" &&
        !GRAMMAR_DEFINITIONS[language]?.genders?.includes("common")
      )
        return false;
      return !(field.endsWith("_singular") && value === cardText(row, language));
    });
  };
  const detailFields = (code, key) =>
    grammarFieldsByKey(entry.word_type, [code], key);
  const groups = [
    ...languages.map(grammar),
    ...languages.map((code) => detailFields(code, "pronunciation")),
    ...languages.map((code) => detailFields(code, "example")),
  ]
    .map((fields) => fields.filter((field) => structuredValue(entry, field)))
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
                <dt>{grammarFieldLabelFor(field, text)}</dt>
                <dd
                  {...languageTextProps(
                    field.includes("pronunciation") || isGenderField(field)
                      ? undefined
                      : languageOfField(field),
                  )}
                >
                  {isGenderField(field)
                    ? text[structuredValue(entry, field)] ||
                      structuredValue(entry, field)
                    : structuredValue(entry, field)}
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
