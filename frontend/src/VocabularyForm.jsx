import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import PropTypes from "prop-types";
import UnitPicker from "./UnitPicker.jsx";
import OrganizationForm from "./OrganizationForm.jsx";
import { request } from "./api.js";

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
  "italian_plural",
  "greek_plural",
  "italian_example",
  "greek_example",
  "notes",
  "pronunciation",
];

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
      [...textFields, "word_type", "italian_gender", "greek_gender"].map(
        (field) => [field, entry?.[field] || ""],
      ),
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
            Object.entries(values).map(([key, value]) => [
              key,
              value.trim() || null,
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
      if (error.fields?.length) setFocusRequest({ field: error.fields[0] });
      if (error.status === 401) onLocked();
    },
  });
  function change(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setInvalid((current) => current.filter((item) => item !== field));
    save.reset();
  }
  return (
    <>
      <form
        className="vocabulary-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const missing = ["italian", "greek", "word_type"].filter(
            (field) => !values[field].trim(),
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
        <p id="meaning-hint">{text.meaningHint}</p>
        <fieldset disabled={save.isPending || creatingUnit} aria-describedby="meaning-hint">
          <div className="entry-fields">
            {textFields.map((field) => {
              const required = field === "italian" || field === "greek";
              const multiline = [
                "italian_example",
                "greek_example",
                "notes",
                "pronunciation",
              ].includes(field);
              const Input = multiline ? "textarea" : "input";
              return (
                <label
                  key={field}
                  className={multiline ? "wide-field" : undefined}
                  htmlFor={`entry-${field}`}
                >
                  {text.fields[field]}
                  {required ? " *" : ""}
                  <Input
                    id={`entry-${field}`}
                    ref={field === "italian" ? firstInput : undefined}
                    value={values[field]}
                    required={required}
                    maxLength={multiline ? 10000 : 500}
                    lang={
                      field.startsWith("italian")
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
            })}
            {["word_type", "italian_gender", "greek_gender"].map((field) => (
              <label key={field} htmlFor={`entry-${field}`}>
                {text.fields[field]}
                {field === "word_type" ? " *" : ""}
                <select
                  id={`entry-${field}`}
                  value={values[field]}
                  required={field === "word_type"}
                  onChange={(event) => change(field, event.target.value)}
                  aria-invalid={invalid.includes(field)}
                  aria-describedby={
                    invalid.includes(field) ? "entry-errors" : undefined
                  }
                >
                  <option value="">
                    {field === "word_type" ? text.chooseType : text.unspecified}
                  </option>
                  {(field === "word_type"
                    ? wordTypes
                    : ["masculine", "feminine", "neuter"]
                  ).map((value) => (
                    <option key={value} value={value}>
                      {text[value]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
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
          {(invalid.length > 0 || save.isError) && (
            <p className="error" role="alert" id="entry-errors">
              {invalid.length
                ? `${text.checkFields} ${invalid.map((field) => text.fields[field] || field).join(", ")}. ${text.fieldHint}`
                : text.errors[save.error?.code] || text.errors.request_failed}
            </p>
          )}
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
            requestAnimationFrame(() => document.getElementById("entry-unit_id")?.focus());
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
