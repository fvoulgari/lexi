/** Test fixture mirroring the curated /api/languages response. */
const CURATED = [
  ["da", "Danish", "Latn", "ltr", false],
  ["el", "Greek", "Grek", "ltr", true],
  ["en", "English", "Latn", "ltr", false],
  ["it", "Italian", "Latn", "ltr", true],
];

const LEGACY = [
  ["greek_to_italian", "el", "it", true],
  ["italian_to_greek", "it", "el", true],
];

export const REGISTRY_PAYLOAD = {
  languages: CURATED.map(([id, label, script, text_direction, enhanced]) => ({
    id,
    label,
    script,
    text_direction,
    enhanced,
  })),
  directions: [
    ...LEGACY,
    ...CURATED.flatMap(([from]) =>
      CURATED.filter(([to]) => to !== from && !(from === "el" && to === "it") &&
        !(from === "it" && to === "el")).map(([to]) => [
        `${from}_to_${to}`,
        from,
        to,
        false,
      ]),
    ),
  ].map(([key, prompt_language, answer_language, legacy]) => ({
    key,
    prompt_language,
    answer_language,
    legacy,
  })),
};
