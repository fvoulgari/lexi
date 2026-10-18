import PropTypes from "prop-types";
import { adjectiveGroups, grammarFieldsFor } from "./grammar.js";

export default function ImportEntryDetails({ row, text }) {
  const { entry } = row;
  const grammar = (language) => {
    const fields =
      entry.word_type === "adjective"
        ? [
            `${language}_adjective_gender`,
            ...adjectiveGroups(entry, language).flat(),
            `${language}_${entry[`${language}_adjective_gender`]}_singular`,
          ]
        : grammarFieldsFor(entry.word_type).filter((field) =>
            field.startsWith(language),
          );
    return fields.filter(
      (field) =>
        entry[field] &&
        entry[field] !== "common" &&
        !(field.endsWith("_singular") && entry[field] === row[language]),
    );
  };
  const groups = [
    grammar("italian"),
    grammar("greek"),
    ["pronunciation", "greek_pronunciation"],
    ["italian_example", "greek_example"],
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
                      : field.startsWith("italian")
                        ? "it"
                        : "el"
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
