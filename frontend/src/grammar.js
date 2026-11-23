/** Optional grammar definitions keyed by language ID.
 *
 * Italian and Greek keep their historical language-named columns as storage
 * aliases. Other registry languages have no definition and use common fields
 * only; adding one never requires a new text column or a pair-specific branch.
 */
export const GRAMMAR_DEFINITIONS = {
  it: {
    legacyName: "italian",
    genders: ["masculine", "feminine"],
    nounGender: "italian_gender",
    nounPlural: "italian_plural",
    adjectiveGender: "italian_adjective_gender",
    example: "italian_example",
    pronunciation: "pronunciation",
    forms: {
      feminine_singular: "italian_feminine_singular",
      masculine_plural: "italian_masculine_plural",
      feminine_plural: "italian_feminine_plural",
      masculine_singular: "italian_masculine_singular",
    },
  },
  el: {
    legacyName: "greek",
    genders: ["masculine", "feminine", "neuter"],
    nounGender: "greek_gender",
    nounPlural: "greek_plural",
    adjectiveGender: "greek_adjective_gender",
    example: "greek_example",
    pronunciation: "greek_pronunciation",
    forms: {
      masculine_singular: "greek_masculine_singular",
      masculine_plural: "greek_masculine_plural",
      feminine_singular: "greek_feminine_singular",
      feminine_plural: "greek_feminine_plural",
      neuter_singular: "greek_neuter_singular",
      neuter_plural: "greek_neuter_plural",
    },
  },
};

const LEGACY_LANGUAGES = { italian: "it", greek: "el" };
const DEFAULT_LANGUAGES = ["it", "el"];

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
  if (!card) return DEFAULT_LANGUAGES;
  const ids = [
    card.source_language || "it",
    card.target_language || "el",
  ].map(resolveLanguage);
  return DEFAULT_LANGUAGES.filter((language) => ids.includes(language));
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
  const ids = (languages || DEFAULT_LANGUAGES).map(resolveLanguage);
  return DEFAULT_LANGUAGES.filter((language) => ids.includes(language)).map(
    (language) => GRAMMAR_DEFINITIONS[language],
  );
}

export const nounFields = [
  ...DEFAULT_LANGUAGES.map(
    (language) => GRAMMAR_DEFINITIONS[language].nounGender,
  ),
  ...DEFAULT_LANGUAGES.map(
    (language) => GRAMMAR_DEFINITIONS[language].nounPlural,
  ),
];
export const adjectiveFormFields = DEFAULT_LANGUAGES.flatMap((language) =>
  Object.values(GRAMMAR_DEFINITIONS[language].forms),
);
export const adjectiveGenderFields = DEFAULT_LANGUAGES.map(
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
    DEFAULT_LANGUAGES.find((language) => {
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
