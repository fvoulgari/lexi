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
