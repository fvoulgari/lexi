export const nounFields = [
  "italian_gender",
  "greek_gender",
  "italian_plural",
  "greek_plural",
];
export const adjectiveFormFields = [
  "italian_feminine_singular",
  "italian_masculine_plural",
  "italian_feminine_plural",
  "italian_masculine_singular",
  "greek_masculine_singular",
  "greek_masculine_plural",
  "greek_feminine_singular",
  "greek_feminine_plural",
  "greek_neuter_singular",
  "greek_neuter_plural",
];
export const adjectiveGenderFields = [
  "italian_adjective_gender",
  "greek_adjective_gender",
];
export const adjectiveFields = [
  ...adjectiveFormFields,
  ...adjectiveGenderFields,
];
export const grammarFields = [...nounFields, ...adjectiveFields];

export function adjectiveGroups(entry, language) {
  const genders =
    language === "italian"
      ? ["masculine", "feminine"]
      : ["masculine", "feminine", "neuter"];
  // Legacy cards may have no main-gender metadata. Order them without inferring
  // or changing their stored text or gender.
  const main = genders.includes(entry[`${language}_adjective_gender`])
    ? entry[`${language}_adjective_gender`]
    : "masculine";
  return [
    [`${language}_${main}_plural`],
    ...genders
      .filter((gender) => gender !== main)
      .map((gender) => [
        `${language}_${gender}_singular`,
        `${language}_${gender}_plural`,
      ]),
  ];
}

export function grammarFieldsFor(wordType) {
  return wordType === "noun"
    ? nounFields
    : wordType === "adjective"
      ? adjectiveFields
      : [];
}
export function isRelevantField(field, wordType) {
  return (
    !grammarFields.includes(field) || grammarFieldsFor(wordType).includes(field)
  );
}
export function cleanGrammar(values) {
  return Object.fromEntries(
    Object.entries(values).map(([field, value]) => [
      field,
      isRelevantField(field, values.word_type) ? value : null,
    ]),
  );
}

export function requiredGenderFields(wordType) {
  return wordType === "noun"
    ? ["italian_gender", "greek_gender"]
    : wordType === "adjective"
      ? adjectiveGenderFields
      : [];
}
