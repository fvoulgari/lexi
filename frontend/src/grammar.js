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
    nounGender: fields.gender.storage,
    nounPlural: fields.plural.storage,
    adjectiveGender: fields.adjective_gender.storage,
    example: fields.example.storage,
    pronunciation: fields.pronunciation.storage,
    forms: Object.fromEntries(
      Object.entries(fields.forms).map(([name, spec]) => [name, spec.storage]),
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
  const languages = configuredLanguages();
  if (!card) return languages;
  const ids = [
    card.source_language || "it",
    card.target_language || "el",
  ].map(resolveLanguage);
  return languages.filter((language) => ids.includes(language));
}

export function definitionFields(definition, wordType) {
  if (!definition) return [];
  if (wordType === "noun")
    return [definition.nounGender, definition.nounPlural];
  if (wordType === "adjective")
    return [definition.adjectiveGender, ...Object.values(definition.forms)];
  return [];
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
];
export const adjectiveFormFields = configuredLanguages().flatMap((language) =>
  Object.values(GRAMMAR_DEFINITIONS[language].forms),
);
export const adjectiveGenderFields = configuredLanguages().map(
  (language) => GRAMMAR_DEFINITIONS[language].adjectiveGender,
);
export const adjectiveFields = [...adjectiveFormFields, ...adjectiveGenderFields];
export const grammarFields = [...nounFields, ...adjectiveFields];

export function adjectiveGroups(entry, language) {
  const definition = grammarDefinition(language);
  if (!definition) return [];
  // Legacy cards may have no main-gender metadata. Order them without inferring
  // or changing their stored text or gender.
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
    if (wordType === "noun") return [definition.nounGender];
    if (wordType === "adjective") return [definition.adjectiveGender];
    return [];
  });
}

export function languageOfField(field) {
  return (
    configuredLanguages().find((language) => {
      const definition = GRAMMAR_DEFINITIONS[language];
      const values = [
        ...Object.values(definition).filter(
          (value) => typeof value === "string",
        ),
        ...Object.values(definition.forms),
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

/** Flatten a language's fields into `{key, spec, storage}` rows for a word type.
 *
 * `key` is the structured grammar key (`gender`, `forms.feminine_singular`);
 * `storage` is the historical language-named column alias used by legacy
 * clients and by the shared form's value model.
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
        rows.push({
          key: `forms.${form}`,
          form,
          spec: formSpec,
          storage: formSpec.storage,
        });
      }
      continue;
    }
    if (!applies(spec)) continue;
    rows.push({ key, spec, storage: spec.storage });
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
      const value = values[field.storage];
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
      if (value !== undefined && value !== null) values[field.storage] = value;
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
        .filter((field) => !values[field.storage])
        .map((field) => field.storage),
    );
}

/** Human-readable label for a schema field, using legacy copy where available. */
export function grammarFieldLabel(field, text) {
  const legacy = text?.fields?.[field.storage];
  if (legacy) return legacy;
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

/** Option label from the shared copy, with a safe data-driven fallback. */
export function grammarOptionLabel(option, text) {
  return text?.[option] || option;
}
