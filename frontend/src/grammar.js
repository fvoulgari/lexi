/** Optional grammar definitions keyed by language ID.
 *
 * The JSON file shared with the backend is the only definition of grammar
 * fields. Italian and Greek keep their historical language-named columns as
 * storage aliases; other registry languages have no definition and use common
 * fields only. Adding one needs configuration, not a new column or component.
 */
import grammarDefinitions from "../../backend/app/grammar_definitions.json";

export const GRAMMAR_DATA = grammarDefinitions;

function adapt(definition) {
  const fields = definition.fields;
  return {
    legacyName: definition.legacy_name,
    genders: definition.genders,
    schema: fields,
    nounGender: fields.gender?.storage,
    nounPlural: fields.plural?.storage,
    adjectiveGender: fields.adjective_gender?.storage,
    example: fields.example?.storage,
    pronunciation: fields.pronunciation?.storage,
    forms: Object.fromEntries(
      Object.entries(fields.forms || {})
        .filter(([, spec]) => spec?.storage)
        .map(([name, spec]) => [name, spec.storage]),
    ),
  };
}

export const GRAMMAR_DEFINITIONS = Object.fromEntries(
  Object.entries(grammarDefinitions.languages).map(([language, definition]) => [
    language,
    adapt(definition),
  ]),
);

const LEGACY_LANGUAGES = { italian: "it", greek: "el" };

export function configuredLanguages() {
  return Object.keys(GRAMMAR_DEFINITIONS);
}

export function registerGrammarDefinition(language, definition) {
  GRAMMAR_DEFINITIONS[language] = adapt(definition);
}

export function unregisterGrammarDefinition(language) {
  delete GRAMMAR_DEFINITIONS[language];
}

export function resolveLanguage(language) {
  return LEGACY_LANGUAGES[language] || language;
}

export function legacyLanguageName(language) {
  return GRAMMAR_DEFINITIONS[language]?.legacyName || language;
}

export function grammarDefinition(language) {
  return GRAMMAR_DEFINITIONS[resolveLanguage(language)] || null;
}

export function grammarLanguages(card) {
  // A draft has no explicit IDs yet, so it uses the historical el/it slots.
  const ids = [
    card?.source_language || "it",
    card?.target_language || "el",
  ].map(resolveLanguage);
  return configuredLanguages().filter((language) => ids.includes(language));
}

export function definitionFields(definition, wordType) {
  if (!definition) return [];
  const fields =
    wordType === "noun"
      ? [definition.nounGender, definition.nounPlural]
      : wordType === "adjective"
        ? [definition.adjectiveGender, ...Object.values(definition.forms)]
        : [];
  // Structured-only fields have no historical column, so they never appear in
  // the flat legacy value model used by the Vocabulary form and CSV previews.
  return fields.filter(Boolean);
}

function definitionsFor(languages) {
  const ids = (languages || configuredLanguages()).map(resolveLanguage);
  return configuredLanguages()
    .filter((language) => ids.includes(language))
    .map((language) => GRAMMAR_DEFINITIONS[language]);
}

export const nounFields = [
  ...configuredLanguages().map(
    (language) => GRAMMAR_DEFINITIONS[language].nounGender,
  ),
  ...configuredLanguages().map(
    (language) => GRAMMAR_DEFINITIONS[language].nounPlural,
  ),
].filter(Boolean);
export const adjectiveFormFields = configuredLanguages().flatMap((language) =>
  Object.values(GRAMMAR_DEFINITIONS[language].forms),
);
export const adjectiveGenderFields = configuredLanguages()
  .map((language) => GRAMMAR_DEFINITIONS[language].adjectiveGender)
  .filter(Boolean);
export const adjectiveFields = [...adjectiveFormFields, ...adjectiveGenderFields];
export const grammarFields = [...nounFields, ...adjectiveFields];

export function adjectiveGroups(entry, language) {
  const definition = grammarDefinition(language);
  if (!definition) return [];
  // Legacy cards may have no main-gender metadata. Order them without inferring
  // or changing their stored text or gender.
  if (!definition.adjectiveGender) return [];
  const main = definition.genders.includes(entry[definition.adjectiveGender])
    ? entry[definition.adjectiveGender]
    : "masculine";
  return [
    [definition.forms[`${main}_plural`]],
    ...definition.genders
      .filter((gender) => gender !== main)
      .map((gender) => [
        definition.forms[`${gender}_singular`],
        definition.forms[`${gender}_plural`],
      ]),
  ];
}

export function grammarFieldsFor(wordType, languages) {
  return definitionsFor(languages).flatMap((definition) =>
    definitionFields(definition, wordType),
  );
}

/** Local value keys for a word type, including structured-only fields.
 *
 * `omitKeys` filters by the definition's semantic key, so legacy storage
 * aliases are excluded just like namespaced structured-only keys.
 */
export function grammarValueFields(wordType, languages, omitKeys = []) {
  return (languages || configuredLanguages())
    .map(resolveLanguage)
    .flatMap((language) =>
      schemaFields(language, wordType)
        .filter((field) => !omitKeys.includes(field.key))
        .map((field) => field.valueKey),
    );
}

/** Value keys for one semantic field, across the given languages. */
export function grammarFieldsByKey(wordType, languages, key) {
  return (languages || configuredLanguages())
    .map(resolveLanguage)
    .flatMap((language) =>
      schemaFields(language, wordType)
        .filter((field) => field.key === key)
        .map((field) => field.valueKey),
    );
}

export function isRelevantField(field, wordType, languages) {
  return (
    !grammarFields.includes(field) ||
    grammarFieldsFor(wordType, languages).includes(field)
  );
}

export function cleanGrammar(values, languages) {
  return Object.fromEntries(
    Object.entries(values).map(([field, value]) => [
      field,
      isRelevantField(field, values.word_type, languages) ? value : null,
    ]),
  );
}

export function requiredGenderFields(wordType, languages) {
  return definitionsFor(languages).flatMap((definition) => {
    if (wordType === "noun") return [definition.nounGender].filter(Boolean);
    if (wordType === "adjective")
      return [definition.adjectiveGender].filter(Boolean);
    return [];
  });
}

export function languageOfField(field) {
  const structured = String(field).match(/^grammar\.([^.]+)\./);
  if (structured) return structured[1];
  return (
    configuredLanguages().find((language) => {
      const definition = GRAMMAR_DEFINITIONS[language];
      const values = [
        ...Object.values(definition).filter(
          (value) => typeof value === "string",
        ),
        ...Object.values(definition.forms || {}).filter(Boolean),
      ];
      return values.includes(field);
    }) || null
  );
}

/** The raw definition for one language, including definitions registered in tests. */
export function grammarSchema(language) {
  const id = resolveLanguage(language);
  const registered = GRAMMAR_DEFINITIONS[id];
  if (registered) {
    return {
      legacy_name: registered.legacyName,
      genders: registered.genders,
      fields: registered.schema,
    };
  }
  return GRAMMAR_DATA.languages[id] || null;
}

/** Every historical storage alias, including examples and pronunciations. */
export function grammarStorageFields() {
  const storages = new Set();
  for (const definition of Object.values(GRAMMAR_DEFINITIONS)) {
    for (const spec of Object.values(definition.schema || {})) {
      if (spec?.storage) storages.add(spec.storage);
      if (spec && typeof spec === "object") {
        for (const nested of Object.values(spec)) {
          if (nested?.storage) storages.add(nested.storage);
        }
      }
    }
  }
  return [...storages];
}

/** Word types come from the shared definition, never from a local list. */
export function wordTypeOptions() {
  return [...(GRAMMAR_DATA.word_types || [])];
}

/** Local form key for one schema field.
 *
 * Legacy definitions use their historical column alias. Definitions without a
 * compatibility column use a namespaced local key: the value still travels only
 * through the structured `grammar` payload, never through a new card column.
 */
export function grammarValueKey(language, key, spec) {
  if (spec?.storage) return spec.storage;
  return `grammar.${resolveLanguage(language)}.${key}`;
}

/** Flatten a language's fields into rows for a word type.
 *
 * `key` is the structured grammar key (`gender`, `forms.feminine_singular`);
 * `storage` is the optional legacy column alias; `valueKey` is the local form
 * key, which is the alias where one exists and a namespaced key otherwise.
 */
export function schemaFields(language, wordType) {
  const schema = grammarSchema(language);
  if (!schema) return [];
  // An empty word type (a new draft) shows every field; selecting one narrows
  // the view to the fields that apply to that word type.
  const applies = (spec) =>
    !wordType || (spec.word_types || []).includes(wordType);
  const rows = [];
  for (const [key, spec] of Object.entries(schema.fields || {})) {
    if (key === "forms") {
      for (const [form, formSpec] of Object.entries(spec)) {
        if (!applies(formSpec)) continue;
        const structuredKey = `forms.${form}`;
        rows.push({
          key: structuredKey,
          form,
          spec: formSpec,
          storage: formSpec.storage,
          valueKey: grammarValueKey(language, structuredKey, formSpec),
        });
      }
      continue;
    }
    if (!applies(spec)) continue;
    rows.push({
      key,
      spec,
      storage: spec.storage,
      valueKey: grammarValueKey(language, key, spec),
    });
  }
  return rows;
}

/** Fields the definition marks as required for this word type. */
export function requiredSchemaFields(language, wordType) {
  return schemaFields(language, wordType).filter((field) =>
    field.spec.required_for?.includes(wordType),
  );
}

/** Structured grammar payload built from the shared flat value model. */
export function toStructuredGrammar(values, languages, wordType) {
  const grammar = {};
  for (const language of languages.map(resolveLanguage)) {
    const entry = {};
    for (const field of schemaFields(language, wordType)) {
      const value = values[field.valueKey];
      if (value === undefined || value === null || value === "") continue;
      if (field.key.startsWith("forms.")) {
        entry.forms = { ...(entry.forms || {}), [field.form]: value };
      } else {
        entry[field.key] = value;
      }
    }
    if (Object.keys(entry).length) grammar[language] = entry;
  }
  return Object.keys(grammar).length ? grammar : null;
}

/** Flat value model restored from a card's structured grammar column. */
export function fromStructuredGrammar(card) {
  const values = {};
  for (const [language, entry] of Object.entries(card?.grammar || {})) {
    for (const field of schemaFields(language, card.word_type)) {
      const value = field.key.startsWith("forms.")
        ? entry.forms?.[field.form]
        : entry[field.key];
      if (value !== undefined && value !== null) values[field.valueKey] = value;
    }
  }
  return values;
}

/** Required grammar storage aliases still missing from a draft. */
export function missingGrammarFields(values, languages, wordType) {
  return languages
    .map(resolveLanguage)
    .flatMap((language) =>
      requiredSchemaFields(language, wordType)
        .filter((field) => !values[field.valueKey])
        .map((field) => field.valueKey),
    );
}

/** Human-readable label for a schema field, using legacy copy where available. */
export function grammarFieldLabel(field, text) {
  const legacy = field.storage && text?.fields?.[field.storage];
  if (legacy) return legacy;
  if (field.spec?.label) return field.spec.label;
  const detail = text?.cardDetailLabels || {};
  const humanize = (word) =>
    text?.[word] || detail[word] || word.charAt(0).toUpperCase() + word.slice(1);
  if (field.form) {
    const [gender, number] = field.form.split("_");
    return [humanize(gender), humanize(number)].filter(Boolean).join(" ");
  }
  if (field.key === "gender" || field.key === "adjective_gender")
    return detail.gender || humanize(field.key);
  return detail[field.key] || humanize(field.key);
}

/** True for both legacy gender columns and structured-only gender keys. */
export function isGenderField(field) {
  const structured = String(field).match(/^grammar\.[^.]+\.(.+)$/);
  const key = structured?.[1] || field;
  return key === "gender" || key === "adjective_gender" || key.endsWith("_gender");
}

/** Label for any local value key, including synthetic structured-only keys. */
export function grammarFieldLabelFor(field, text) {
  if (!String(field).startsWith("grammar.")) {
    const short = String(field).replace(/^(italian|greek)_/, "");
    return text?.cardDetailLabels?.[short] || text?.fields?.[field] || field;
  }
  for (const language of configuredLanguages()) {
    const match = schemaFields(language).find((row) => row.valueKey === field);
    if (match) return grammarFieldLabel(match, text);
  }
  return text?.fields?.[field] || field;
}

/** Option label from the shared copy, with a safe data-driven fallback. */
export function grammarOptionLabel(option, text) {
  return text?.[option] || option;
}
