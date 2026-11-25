import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import PropTypes from "prop-types";
import CardPreview from "./CardPreview.jsx";
import { request } from "./api.js";
import { GrammarFields, WordTypeField } from "./CardFields.jsx";
import { isLegacyPair, languageTextProps } from "./languages.js";
import {
  adjectiveFormFields,
  adjectiveGenderFields,
  cleanGrammar,
  grammarLanguages,
  isRelevantField,
  legacyLanguageName,
  requiredGenderFields,
} from "./grammar.js";

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
  initialCollectionId = "",
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
  const [collectionId, setCollectionId] = useState(initialCollectionId);
  const [confirmExposure, setConfirmExposure] = useState(false);
  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: () => request("/api/collections"),
    enabled: !entry?.id,
  });
  const selectedCollection = collections.data?.find(
    (c) => c.id === collectionId,
  );
  const needsExposure = selectedCollection?.visibility === "published";
  useEffect(() => {
    if (collections.error?.status === 401) onLocked();
  }, [collections.error, onLocked]);
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

  // Both workspaces render the same grammar components. This legacy adapter
  // keeps the historical flat payload and the el/it text slots.
  const languages = grammarLanguages(entry);
  function change(field, value) {
    setConfirmExposure(false);
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
  const grammarProps = {
    languages,
    values,
    wordType: values.word_type,
    text,
    invalid,
    change,
  };

  const save = useMutation({
    mutationFn: () =>
      request(entry?.id ? `/api/vocabulary/${entry.id}` : "/api/vocabulary", {
        method: entry?.id ? "PATCH" : "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({
          ...Object.fromEntries(
            Object.entries(cleanGrammar(values, languages)).map(
              ([key, value]) => [key, value?.trim() || null],
            ),
          ),
          ...(!entry?.id
            ? {
                collection_id: collectionId || null,
                confirm_collection_exposure: confirmExposure,
              }
            : {}),
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

  function textField(language) {
    const legacy = legacyLanguageName(language);
    return (
      <label key={legacy} htmlFor={`entry-${legacy}`}>
        {text[legacy]} *
        <input
          id={`entry-${legacy}`}
          ref={language === "it" ? firstInput : undefined}
          value={values[legacy]}
          required
          maxLength={500}
          {...languageTextProps(language)}
          onChange={(event) => change(legacy, event.target.value)}
          aria-invalid={invalid.includes(legacy)}
          aria-describedby={
            invalid.includes(legacy) ? "entry-errors" : undefined
          }
        />
      </label>
    );
  }

  return (
    <>
      <form
        className="vocabulary-form vocabulary-card-form"
        aria-labelledby="vocabulary-card-form-heading"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const missing = ["italian", "greek", "word_type"].filter(
            (field) => !values[field].trim(),
          );
          missing.push(
            ...requiredGenderFields(values.word_type, languages).filter(
              (field) => !values[field],
            ),
          );
          if (!entry?.id && !collectionId) missing.push("collection_id");
          setInvalid(missing);
          if (missing.length) {
            setFocusRequest({ field: missing[0] });
            return;
          }
          if (!entry?.id && needsExposure && !confirmExposure) return;
          save.mutate();
        }}
      >
        <h2 id="vocabulary-card-form-heading">
          {entry ? text.editEntry : text.addEntry}
        </h2>
        <p id="meaning-hint">{entry ? text.cardEditHint : text.meaningHint}</p>
        <p id="card-required-hint" className="card-required-hint">
          {text.cardRequiredHint}
        </p>
        <fieldset
          disabled={save.isPending}
          aria-describedby="meaning-hint card-required-hint"
        >
          {!entry?.id && (
            <div className="card-collection-choice">
              <label>
                {text.cardCollection}
                <select
                  id="entry-collection_id"
                  required
                  value={collectionId}
                  disabled={collections.isPending || collections.isError}
                  onChange={(event) => {
                    setCollectionId(event.target.value);
                    setConfirmExposure(false);
                  }}
                >
                  <option value="">{text.noCollection}</option>
                  {collections.data
                    ?.filter(
                      (c) =>
                        c.can_edit &&
                        isLegacyPair(c.source_language, c.target_language),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              {collections.isError && (
                <p role="alert">
                  {text.actionFailed}{" "}
                  <button type="button" onClick={() => collections.refetch()}>
                    {text.retry}
                  </button>
                </p>
              )}
              {needsExposure && (
                <section
                  className="publication-preview"
                  aria-label={text.collectionExposure}
                >
                  <p>
                    {selectedCollection.name} · {text.collectionPair} ·{" "}
                    {selectedCollection.card_count + 1}
                  </p>
                  <p>{text.collectionExposure}</p>
                  <p>
                    <span {...languageTextProps(languages[0])}>
                      {values.italian || "—"}
                    </span>{" "}
                    —{" "}
                    <span {...languageTextProps(languages[1])}>
                      {values.greek || "—"}
                    </span>
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      required
                      checked={confirmExposure}
                      onChange={(event) =>
                        setConfirmExposure(event.target.checked)
                      }
                    />
                    {text.confirmCollectionExposure}
                  </label>
                </section>
              )}
            </div>
          )}
          <div className="entry-fields entry-required-fields">
            <WordTypeField
              value={values.word_type}
              text={text}
              change={change}
              invalid={invalid}
            />
            {languages.map((language) => (
              <div key={language} className="entry-main-language">
                {textField(language)}
                <GrammarFields section="required" language={language} {...grammarProps} />
              </div>
            ))}
          </div>
          <details
            className="entry-optional-details"
            open={optionalOpen}
            onToggle={(event) => setOptionalOpen(event.currentTarget.open)}
          >
            <summary>{text.cardOptionalDetails}</summary>
            <GrammarFields section="details" {...grammarProps} />
            <GrammarFields section="examples" {...grammarProps} />
            <GrammarFields section="pronunciations" {...grammarProps} />
          </details>
          {(invalid.length > 0 || save.isError) && (
            <p className="error" role="alert" id="entry-errors">
              {invalid.length
                ? `${text.checkFields} ${invalid.map((field) => (field === "pronunciation" ? text.cardPronunciation : field === "collection_id" ? text.cardCollection : text.fields[field] || field)).join(", ")}. ${text.fieldHint}`
                : text.errors[save.error?.code] || text.errors.request_failed}
            </p>
          )}
          <CardPreview text={text} entry={{ ...values }} />
          <div className="form-actions">
            <button
              type="submit"
              className="primary"
              disabled={
                (!entry?.id &&
                  (collections.isPending || collections.isError)) ||
                (!entry?.id && needsExposure && !confirmExposure)
              }
            >
              {save.isPending ? text.saving : text.saveEntry}
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              {text.cancel}
            </button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
VocabularyForm.propTypes = {
  entry: PropTypes.object,
  initialCollectionId: PropTypes.string,
  text: PropTypes.object.isRequired,
  csrf: PropTypes.string.isRequired,
  onSaved: PropTypes.func.isRequired,
  onSavingChange: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  onLocked: PropTypes.func.isRequired,
};
