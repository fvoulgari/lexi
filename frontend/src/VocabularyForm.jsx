import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import PropTypes from "prop-types";
import UnitPicker from "./UnitPicker.jsx";
import CardPreview from "./CardPreview.jsx";
import OrganizationForm from "./OrganizationForm.jsx";
import { request } from "./api.js";
import {
  adjectiveFormFields,
  adjectiveGenderFields,
  adjectiveGroups,
  isRelevantField,
  cleanGrammar,
  requiredGenderFields,
} from "./grammar.js";

const wordTypes = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "expression",
  "other",
];
const textFields = [
  "italian",
  "greek",
  ...adjectiveFormFields,
  "italian_plural",
  "greek_plural",
  "italian_example",
  "greek_example",
  "pronunciation",
  "greek_pronunciation",
];

const optionalFields = textFields.filter(
  (field) => !["italian", "greek"].includes(field),
);

export default function VocabularyForm({
  entry,
  text,
  csrf,
  onSaved,
  onSavingChange,
  onCancel,
  onLocked,
}) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      [
        ...textFields,
        ...adjectiveGenderFields,
        "word_type",
        "italian_gender",
        "greek_gender",
      ].map((field) => [
        field,
        (field === "italian_gender" && entry?.[field] === "neuter") ||
        (field.endsWith("_gender") && entry?.[field] === "common")
          ? ""
          : entry?.[field] || "",
      ]),
    ),
  );
  const units = useQuery({
    queryKey: ["units"],
    queryFn: () => request("/api/units"),
  });
  const [creatingUnit, setCreatingUnit] = useState(false);
  const [unitId, setUnitId] = useState(entry?.unit?.id || "");
  useEffect(() => {
    if (units.error?.status === 401) onLocked();
  }, [units.error, onLocked]);
  const [optionalOpen, setOptionalOpen] = useState(() =>
    Boolean(
      entry &&
      optionalFields.some(
        (field) => isRelevantField(field, entry.word_type) && entry[field],
      ),
    ),
  );
  const [invalid, setInvalid] = useState([]);
  const [focusRequest, setFocusRequest] = useState(null);
  const firstInput = useRef(null);
  useEffect(() => {
    firstInput.current?.focus();
  }, []);
  useEffect(() => {
    if (focusRequest)
      document.getElementById(`entry-${focusRequest.field}`)?.focus();
  }, [focusRequest]);
  const save = useMutation({
    mutationFn: () =>
      request(entry ? `/api/vocabulary/${entry.id}` : "/api/vocabulary", {
        method: entry ? "PATCH" : "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({
          ...Object.fromEntries(
            Object.entries(cleanGrammar(values)).map(([key, value]) => [
              key,
              value?.trim() || null,
            ]),
          ),
          unit_id: unitId || null,
          tag_ids: (entry?.tags || []).map((tag) => tag.id),
        }),
      }),
    onMutate: () => onSavingChange(true),
    onSuccess: onSaved,
    onSettled: () => onSavingChange(false),
    onError: (error) => {
      setInvalid(error.fields || []);
      if (error.fields?.some((field) => optionalFields.includes(field)))
        setOptionalOpen(true);
      if (error.fields?.length) setFocusRequest({ field: error.fields[0] });
      if (error.status === 401) onLocked();
    },
  });
  function change(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setInvalid((current) =>
      current.filter(
        (item) =>
          item !== field &&
          (field !== "word_type" || isRelevantField(item, value)),
      ),
    );
    save.reset();
  }
  function textField(field, displayLabel) {
    const required = field === "italian" || field === "greek";
    const pronunciation =
      field === "pronunciation" || field === "greek_pronunciation";
    const multiline = field === "italian_example" || field === "greek_example";
    const Input = multiline ? "textarea" : "input";
    return (
      <label
        key={field}
        className={multiline ? "wide-field" : undefined}
        htmlFor={`entry-${field}`}
      >
        {displayLabel || text.fields[field]}
        {required ? " *" : ""}
        <Input
          id={`entry-${field}`}
          ref={field === "italian" ? firstInput : undefined}
          value={values[field]}
          required={required}
          aria-label={
            displayLabel || pronunciation ? text.fields[field] : undefined
          }
          maxLength={multiline || pronunciation ? 10000 : 500}
          rows={multiline ? 2 : undefined}
          lang={
            field === "pronunciation" || field === "greek_pronunciation"
              ? undefined
              : field.startsWith("italian")
                ? "it"
                : field.startsWith("greek")
                  ? "el"
                  : undefined
          }
          onChange={(event) => change(field, event.target.value)}
          aria-invalid={invalid.includes(field)}
          aria-describedby={
            invalid.includes(field) ? "entry-errors" : undefined
          }
        />
      </label>
    );
  }
  function selectField(field) {
    const isWordType = field === "word_type";
    const required =
      isWordType || requiredGenderFields(values.word_type).includes(field);
    return (
      <label key={field} htmlFor={`entry-${field}`}>
        {isWordType ? text.fields[field] : text.cardDetailLabels.gender}
        {required ? " *" : ""}
        <select
          id={`entry-${field}`}
          value={values[field]}
          required={required}
          aria-label={isWordType ? undefined : text.fields[field]}
          onChange={(event) => change(field, event.target.value)}
          aria-invalid={invalid.includes(field)}
          aria-describedby={
            invalid.includes(field) ? "entry-errors" : undefined
          }
        >
          <option value="">
            {isWordType ? text.chooseType : text.chooseGender}
          </option>
          {(isWordType
            ? wordTypes
            : field.startsWith("italian_")
              ? ["masculine", "feminine"]
              : ["masculine", "feminine", "neuter"]
          ).map((value) => (
            <option key={value} value={value}>
              {text[value]}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <>
      <form
        className="vocabulary-form vocabulary-card-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const missing = ["italian", "greek", "word_type"].filter(
            (field) => !values[field].trim(),
          );
          missing.push(
            ...requiredGenderFields(values.word_type).filter(
              (field) => !values[field],
            ),
          );
          if (!unitId) missing.push("unit_id");
          setInvalid(missing);
          if (missing.length) {
            setFocusRequest({ field: missing[0] });
            return;
          }
          save.mutate();
        }}
      >
        <h2>{entry ? text.editEntry : text.addEntry}</h2>
        <p id="meaning-hint">{entry ? text.cardEditHint : text.meaningHint}</p>
        <p id="card-required-hint" className="card-required-hint">
          {text.cardRequiredHint}
        </p>
        <fieldset
          disabled={save.isPending || creatingUnit}
          aria-describedby="meaning-hint card-required-hint"
        >
          <div className="entry-fields entry-required-fields">
            {selectField("word_type")}
            <UnitPicker
              id="entry-unit_id"
              text={text}
              units={units.data || []}
              value={unitId}
              disabled={save.isPending || units.isPending || creatingUnit}
              invalid={invalid.includes("unit_id")}
              onChange={(value) => {
                setUnitId(value);
                setInvalid((current) =>
                  current.filter((field) => field !== "unit_id"),
                );
                save.reset();
              }}
              onCreate={() => setCreatingUnit(true)}
            />
            {["italian", "greek"].map((language) => (
              <div key={language} className="entry-main-language">
                {textField(language)}
                {requiredGenderFields(values.word_type)
                  .filter((field) => field.startsWith(`${language}_`))
                  .map(selectField)}
              </div>
            ))}
          </div>
          {units.isError && (
            <div>
              <p role="alert" className="error">
                {text.errors.request_failed}
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  units.refetch();
                }}
              >
                {text.retry}
              </button>
            </div>
          )}
          <details
            className="entry-optional-details"
            open={optionalOpen}
            onToggle={(event) => setOptionalOpen(event.currentTarget.open)}
          >
            <summary>{text.cardOptionalDetails}</summary>
            <div className="entry-language-details">
              {["italian", "greek"].map((language) => (
                <fieldset key={language} className="entry-language-group">
                  <legend>{text[language]}</legend>
                  <div className="entry-fields">
                    {values.word_type === "noun" && (
                      <>{textField(`${language}_plural`)}</>
                    )}
                    {values.word_type === "adjective" && (
                      <>
                        {values[`${language}_adjective_gender`] &&
                          adjectiveGroups(values, language).map(
                            (fields, index) => (
                              <div
                                className="entry-adjective-group wide-field"
                                key={fields[0]}
                              >
                                {index > 0 && (
                                  <h3>{text[fields[0].split("_")[1]]}</h3>
                                )}
                                <div className="entry-adjective-pair">
                                  {fields.map((field) =>
                                    textField(
                                      field,
                                      field.endsWith("_singular")
                                        ? text.cardDetailLabels.singular
                                        : text.cardDetailLabels.plural,
                                    ),
                                  )}
                                </div>
                              </div>
                            ),
                          )}
                      </>
                    )}
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="entry-fields entry-common-row entry-examples">
              {textField("italian_example")}
              {textField("greek_example")}
            </div>
            <div className="entry-fields entry-common-row entry-pronunciations">
              {textField("pronunciation")}
              {textField("greek_pronunciation")}
            </div>
          </details>
          {(invalid.length > 0 || save.isError) && (
            <p className="error" role="alert" id="entry-errors">
              {invalid.length
                ? `${text.checkFields} ${invalid.map((field) => (field === "pronunciation" ? text.cardPronunciation : text.fields[field] || field)).join(", ")}. ${text.fieldHint}`
                : text.errors[save.error?.code] || text.errors.request_failed}
            </p>
          )}
          <CardPreview
            text={text}
            entry={{
              ...values,
              unit: (units.data || []).find((unit) => unit.id === unitId),
            }}
          />
          <div className="form-actions">
            <button
              type="submit"
              className="primary"
              disabled={units.isPending || units.isError}
            >
              {save.isPending ? text.saving : text.saveEntry}
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              {text.cancel}
            </button>
          </div>
        </fieldset>
      </form>
      {creatingUnit && (
        <OrganizationForm
          kind="units"
          text={text}
          csrf={csrf}
          onLocked={onLocked}
          onClose={() => {
            setCreatingUnit(false);
            requestAnimationFrame(() =>
              document.getElementById("entry-unit_id")?.focus(),
            );
          }}
          onCreated={(unit) => setUnitId(unit.id)}
        />
      )}
    </>
  );
}
VocabularyForm.propTypes = {
  entry: PropTypes.object,
  text: PropTypes.object.isRequired,
  csrf: PropTypes.string.isRequired,
  onSaved: PropTypes.func.isRequired,
  onSavingChange: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  onLocked: PropTypes.func.isRequired,
};
