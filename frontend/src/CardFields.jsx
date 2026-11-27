/** Shared, schema-driven card authoring fields.
 *
 * Every grammar control, label, option, maximum length and requirement comes
 * from the canonical definitions in `grammar.js`. Language-named storage
 * aliases are only keys into the value model; no component branches on a
 * particular language. The standard Vocabulary form and the Collection card
 * editor both render these components with their own endpoint adapters.
 */
import PropTypes from "prop-types";
import Choices from "./Choices.jsx";
import { useQuery } from "@tanstack/react-query";
import { request } from "./api.js";
import { languageTextProps } from "./languages.js";
import {
  grammarFieldLabel,
  grammarOptionLabel,
  grammarSchema,
  grammarValueKey,
  legacyLanguageName,
  requiredSchemaFields,
  schemaFields,
  wordTypeOptions,
} from "./grammar.js";

const defaultId = (storage) => `entry-${storage}`;
const valueKey = (field) => field.valueKey || field.storage;

function fieldProps(field, { values, change, invalid, idFor, errorId }) {
  const key = valueKey(field);
  const id = idFor(key);
  return {
    id,
    value: values[key] || "",
    onChange: (event) => change(key, event.target.value),
    "aria-invalid": invalid.includes(key),
    "aria-describedby": invalid.includes(key) ? errorId : undefined,
  };
}

function SelectField({
  field,
  values,
  text,
  required,
  change,
  invalid,
  idFor,
  errorId,
}) {
  return (
    <label htmlFor={idFor(valueKey(field))}>
      {text.cardDetailLabels.gender}
      {required ? " *" : ""}
      <select
        {...fieldProps(field, { values, change, invalid, idFor, errorId })}
        required={required}
        aria-label={grammarFieldLabel(field, text)}
      >
        <option value="">{text.chooseGender}</option>
        {field.spec.options.map((option) => (
          <option key={option} value={option}>
            {grammarOptionLabel(option, text)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  field,
  values,
  text,
  change,
  invalid,
  idFor,
  errorId,
  displayLabel,
}) {
  const multiline = field.spec.type === "long_text" && field.key === "example";
  const pronunciation = field.key === "pronunciation";
  const Input = multiline ? "textarea" : "input";
  return (
    <label
      className={multiline ? "wide-field" : undefined}
      htmlFor={idFor(valueKey(field))}
    >
      {displayLabel || grammarFieldLabel(field, text)}
      <Input
        {...fieldProps(field, { values, change, invalid, idFor, errorId })}
        maxLength={field.spec.max_length || 500}
        rows={multiline ? 2 : undefined}
        {...languageTextProps(pronunciation ? undefined : field.language)}
        aria-label={
          displayLabel || pronunciation
            ? grammarFieldLabel(field, text)
            : undefined
        }
      />
    </label>
  );
}

/** Ordered adjective form rows, derived from the language's schema genders. */
function adjectiveGroups(language, values) {
  const schema = grammarSchema(language);
  const genderSpec = schema?.fields?.adjective_gender;
  if (!genderSpec?.storage || !schema?.fields?.forms) return [];
  const genderField = {
    key: "adjective_gender",
    spec: genderSpec,
    storage: genderSpec.storage,
    valueKey: genderSpec.storage,
  };
  const main = schema.genders.includes(values[valueKey(genderField)])
    ? values[valueKey(genderField)]
    : schema.genders[0];
  const forms = Object.entries(schema.fields.forms).map(
    ([name, spec]) => [
      name,
      {
        key: `forms.${name}`,
        form: name,
        spec,
        storage: spec.storage,
        valueKey: grammarValueKey(language, `forms.${name}`, spec),
        language,
      },
    ],
  );
  const byName = Object.fromEntries(forms);
  return [
    [byName[`${main}_plural`]].filter(Boolean),
    ...schema.genders
      .filter((gender) => gender !== main)
      .map((gender) =>
        [
          byName[`${gender}_singular`],
          byName[`${gender}_plural`],
        ].filter(Boolean),
      ),
  ].filter((group) => group.length);
}

/**
 * Renders one part of the grammar form. `section` selects where the fields
 * belong so parents keep ownership of layout and headings.
 */
export function GrammarFields({
  languages,
  language,
  values,
  wordType,
  text,
  invalid = [],
  change,
  idFor = defaultId,
  errorId = "entry-errors",
  section = "details",
}) {
  const targets = (language ? [language] : languages).map((id) =>
    typeof id === "string" ? id : id,
  );
  const rowsFor = (target, filter) =>
    schemaFields(target, wordType)
      .map((field) => ({ ...field, language: target }))
      .filter(filter);

  if (section === "required") {
    return targets.flatMap((target) =>
      requiredSchemaFields(target, wordType).map((field) => (
        <SelectField
          key={`${target}-${valueKey(field)}`}
          field={{ ...field, language: target }}
          values={values}
          text={text}
          required
          change={change}
          invalid={invalid}
          idFor={idFor}
          errorId={errorId}
        />
      )),
    );
  }

  if (section === "examples" || section === "pronunciations") {
    const key = section === "examples" ? "example" : "pronunciation";
    return (
      <div className={`entry-fields entry-common-row entry-${section}`}>
        {targets.flatMap((target) =>
          rowsFor(target, (field) => field.key === key).map((field) => (
            <TextField
              key={`${target}-${valueKey(field)}`}
              field={field}
              values={values}
              text={text}
              change={change}
              invalid={invalid}
              idFor={idFor}
              errorId={errorId}
            />
          )),
        )}
      </div>
    );
  }

  return (
    <div className="entry-language-details">
      {targets
        .filter((target) => schemaFields(target, wordType).length > 0)
        .map((target) => (
          <fieldset key={target} className="entry-language-group">
            <legend>
              {text[legacyLanguageName(target)] ||
                grammarSchema(target)?.legacy_name ||
                target}
            </legend>
            <div className="entry-fields">
              {rowsFor(target, (field) => field.key === "plural").map((field) => (
                <TextField
                  key={valueKey(field)}
                  field={field}
                  values={values}
                  text={text}
                  change={change}
                  invalid={invalid}
                  idFor={idFor}
                  errorId={errorId}
                />
              ))}
              {wordType === "adjective" &&
                values[schemaFields(target, wordType).find(
                  (field) => field.key === "adjective_gender",
                )?.valueKey] &&
                adjectiveGroups(target, values).map((group, index) => (
                  <div
                    className="entry-adjective-group wide-field"
                    key={valueKey(group[0])}
                  >
                    {index > 0 && (
                      <h3>{grammarOptionLabel(group[0].form.split("_")[0], text)}</h3>
                    )}
                    <div className="entry-adjective-pair">
                      {group.map((field) => {
                        const number = field.form.split("_")[1];
                        return (
                          <TextField
                            key={valueKey(field)}
                            field={field}
                            values={values}
                            text={text}
                            change={change}
                            invalid={invalid}
                            idFor={idFor}
                            errorId={errorId}
                            displayLabel={text.cardDetailLabels[number]}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </fieldset>
        ))}
    </div>
  );
}

GrammarFields.propTypes = {
  languages: PropTypes.arrayOf(PropTypes.string),
  language: PropTypes.string,
  values: PropTypes.object.isRequired,
  wordType: PropTypes.string,
  text: PropTypes.object.isRequired,
  invalid: PropTypes.arrayOf(PropTypes.string),
  change: PropTypes.func.isRequired,
  idFor: PropTypes.func,
  errorId: PropTypes.string,
  section: PropTypes.oneOf(["required", "details", "examples", "pronunciations"]),
};

export function WordTypeField({
  value,
  text,
  change,
  invalid = [],
  idFor = defaultId,
  errorId = "entry-errors",
}) {
  const field = { storage: "word_type" };
  return (
    <label htmlFor={idFor("word_type")}>
      {text.fields.word_type} *
      <select
        {...fieldProps(field, {
          values: { word_type: value },
          change,
          invalid,
          idFor,
          errorId,
        })}
        required
        aria-label={undefined}
      >
        <option value="">{text.chooseType}</option>
        {wordTypeOptions().map((option) => (
          <option key={option} value={option}>
            {grammarOptionLabel(option, text)}
          </option>
        ))}
      </select>
    </label>
  );
}

WordTypeField.propTypes = {
  value: PropTypes.string,
  text: PropTypes.object.isRequired,
  change: PropTypes.func.isRequired,
  invalid: PropTypes.arrayOf(PropTypes.string),
  idFor: PropTypes.func,
  errorId: PropTypes.string,
};

/** Notes and themes are common fields for every card, including universal ones. */
export function CommonFields({
  values,
  text,
  change,
  invalid = [],
  idFor = defaultId,
  errorId = "entry-errors",
}) {
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => request("/api/tags"),
  });
  return (
    <div className="entry-common-fields">
      <label className="wide-field" htmlFor={idFor("notes")}>
        {text.fields.notes}
        <textarea
          id={idFor("notes")}
          value={values.notes || ""}
          maxLength={10000}
          rows={3}
          aria-invalid={invalid.includes("notes")}
          aria-describedby={invalid.includes("notes") ? errorId : undefined}
          onChange={(event) => change("notes", event.target.value)}
        />
      </label>
      <Choices
        legend={text.assignTags}
        options={(tags.data || []).map((tag) => ({ id: tag.id, label: tag.name }))}
        selected={values.tag_ids || []}
        onChange={(ids) => change("tag_ids", ids)}
        disabled={tags.isPending || tags.isError}
      />
    </div>
  );
}

CommonFields.propTypes = {
  values: PropTypes.object.isRequired,
  text: PropTypes.object.isRequired,
  change: PropTypes.func.isRequired,
  invalid: PropTypes.arrayOf(PropTypes.string),
  idFor: PropTypes.func,
  errorId: PropTypes.string,
};
