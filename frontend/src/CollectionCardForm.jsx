import { useState } from "react";
import PropTypes from "prop-types";
import CardPreview from "./CardPreview.jsx";
import { CommonFields, GrammarFields, WordTypeField } from "./CardFields.jsx";
import { cardLanguages } from "./card-sides.js";
import { languageLabel, languageTextProps } from "./languages.js";
import {
  fromStructuredGrammar,
  grammarFields,
  grammarStorageFields,
  missingGrammarFields,
  toStructuredGrammar,
} from "./grammar.js";

const idFor = (storage) => `card-${storage}`;

function flatGrammar(card) {
  const values = {};
  for (const field of grammarStorageFields()) {
    if (card?.[field] !== undefined && card?.[field] !== null)
      values[field] = card[field];
  }
  return values;
}

/** Schema-driven create/edit form shared by every Collection language pair. */
export default function CollectionCardForm({
  card,
  pair,
  collection,
  text,
  t,
  busy,
  onSubmit,
  onCancel,
}) {
  const sourceLanguage = card?.source_language || cardLanguages(pair)[0];
  const targetLanguage = card?.target_language || cardLanguages(pair)[1];
  const languages = cardLanguages([sourceLanguage, targetLanguage]);
  const [values, setValues] = useState(() => ({
    source_text: card?.source_text || "",
    target_text: card?.target_text || "",
    word_type: card?.word_type || "expression",
    notes: card?.notes || "",
    tag_ids: (card?.tags || []).map((tag) => tag.id),
    ...fromStructuredGrammar(card),
    ...flatGrammar(card),
  }));
  const [confirmExposure, setConfirmExposure] = useState(false);
  const [invalid, setInvalid] = useState([]);
  const needsExposure = !card?.id && collection?.visibility === "published";

  function change(field, value) {
    setConfirmExposure(false);
    setValues((current) => ({ ...current, [field]: value }));
    setInvalid((current) =>
      current.filter(
        (item) =>
          item !== field &&
          (field !== "word_type" || !grammarFields.includes(item)),
      ),
    );
  }

  const grammarProps = {
    languages,
    values,
    wordType: values.word_type,
    text,
    invalid,
    change,
    idFor,
    errorId: "card-errors",
  };

  function submit(event) {
    event.preventDefault();
    const missing = ["source_text", "target_text", "word_type"].filter(
      (field) => !String(values[field] || "").trim(),
    );
    missing.push(...missingGrammarFields(values, languages, values.word_type));
    setInvalid(missing);
    if (missing.length) {
      document.getElementById(idFor(missing[0]))?.focus();
      return;
    }
    if (needsExposure && !confirmExposure) return;
    onSubmit({
      source_text: values.source_text.trim(),
      target_text: values.target_text.trim(),
      source_language: sourceLanguage,
      target_language: targetLanguage,
      word_type: values.word_type,
      notes: values.notes?.trim() || null,
      tag_ids: values.tag_ids,
      grammar: toStructuredGrammar(values, languages, values.word_type),
      confirm_exposure: confirmExposure,
    });
  }

  function mainInput(side, language) {
    const field = `${side}_text`;
    return (
      <label key={side} htmlFor={idFor(field)}>
        {languageLabel(language)}
        <input
          id={idFor(field)}
          required
          maxLength={500}
          {...languageTextProps(language)}
          value={values[field]}
          aria-invalid={invalid.includes(field)}
          aria-describedby={invalid.includes(field) ? "card-errors" : undefined}
          onChange={(event) => change(field, event.target.value)}
        />
      </label>
    );
  }

  return (
    <form
      className="collection-form collection-card-form"
      aria-labelledby="collection-card-form-heading"
      noValidate
      onSubmit={submit}
    >
      <h3 id="collection-card-form-heading">
        {card?.id ? t.edit : t.createCard}
      </h3>
      <div className="entry-fields entry-required-fields">
        <WordTypeField
          value={values.word_type}
          text={text}
          change={change}
          invalid={invalid}
          idFor={idFor}
          errorId="card-errors"
        />
        {[
          ["source", sourceLanguage],
          ["target", targetLanguage],
        ].map(([side, language]) => (
          <div key={side} className="entry-main-language">
            {mainInput(side, language)}
            <GrammarFields
              section="required"
              language={language}
              {...grammarProps}
            />
          </div>
        ))}
      </div>
      <details className="entry-optional-details">
        <summary>{text.cardOptionalDetails}</summary>
        <GrammarFields section="details" {...grammarProps} />
        <GrammarFields section="examples" {...grammarProps} />
        <GrammarFields section="pronunciations" {...grammarProps} />
        <CommonFields
          values={values}
          text={text}
          change={change}
          invalid={invalid}
          idFor={idFor}
          errorId="card-errors"
        />
      </details>
      {needsExposure && (
        <section className="publication-preview" aria-label={t.exposure}>
          <p>
            {collection.name} · {pair.map(languageLabel).join(" – ")} ·{" "}
            {collection.card_count + 1} {t.cards}
          </p>
          <p>{t.exposure}</p>
          <label>
            <input
              type="checkbox"
              required
              checked={confirmExposure}
              onChange={(event) => setConfirmExposure(event.target.checked)}
            />
            {t.exposureNew}
          </label>
        </section>
      )}
      {invalid.length > 0 && (
        <p className="error" role="alert" id="card-errors">
          {text.checkFields}{" "}
          {invalid
            .map((field) => text.fields[field] || field)
            .join(", ")}
          . {text.fieldHint}
        </p>
      )}
      <CardPreview
        text={text}
        pair={[sourceLanguage, targetLanguage]}
        entry={{
          source_language: sourceLanguage,
          target_language: targetLanguage,
          source_text: values.source_text,
          target_text: values.target_text,
          word_type: values.word_type,
          ...values,
        }}
      />
      <div className="collection-actions">
        <button className="primary" disabled={busy}>
          {t.save}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}

CollectionCardForm.propTypes = {
  card: PropTypes.object,
  pair: PropTypes.arrayOf(PropTypes.string).isRequired,
  collection: PropTypes.object,
  text: PropTypes.object.isRequired,
  t: PropTypes.object.isRequired,
  busy: PropTypes.bool,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
