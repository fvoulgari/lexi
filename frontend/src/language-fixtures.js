/** Test fixture mirroring the curated /api/languages response. */
const LANGUAGES = [
  ['ar', "Arabic", "العربية", ["عربي"], 'Arab', 'rtl', false],
  ['bn', "Bengali", "বাংলা", ["Bangla"], 'Beng', 'ltr', false],
  ['bg', "Bulgarian", "Български", [], 'Cyrl', 'ltr', false],
  ['ca', "Catalan", "Català", [], 'Latn', 'ltr', false],
  ['cs', "Czech", "Čeština", [], 'Latn', 'ltr', false],
  ['da', "Danish", "Dansk", [], 'Latn', 'ltr', true],
  ['de', "German", "Deutsch", [], 'Latn', 'ltr', false],
  ['el', "Greek", "Ελληνικά", [], 'Grek', 'ltr', true],
  ['en', "English", "English", [], 'Latn', 'ltr', false],
  ['es', "Spanish", "Español", [], 'Latn', 'ltr', false],
  ['fa', "Persian", "فارسی", ["Farsi"], 'Arab', 'rtl', false],
  ['fi', "Finnish", "Suomi", [], 'Latn', 'ltr', false],
  ['fr', "French", "Français", [], 'Latn', 'ltr', false],
  ['he', "Hebrew", "עברית", [], 'Hebr', 'rtl', false],
  ['hi', "Hindi", "हिन्दी", [], 'Deva', 'ltr', false],
  ['hu', "Hungarian", "Magyar", [], 'Latn', 'ltr', false],
  ['id', "Indonesian", "Bahasa Indonesia", ["Indonesian"], 'Latn', 'ltr', false],
  ['it', "Italian", "Italiano", [], 'Latn', 'ltr', true],
  ['ja', "Japanese", "日本語", [], 'Jpan', 'ltr', false],
  ['ko', "Korean", "한국어", [], 'Hang', 'ltr', false],
  ['nl', "Dutch", "Nederlands", [], 'Latn', 'ltr', false],
  ['no', "Norwegian", "Norsk", [], 'Latn', 'ltr', false],
  ['pl', "Polish", "Polski", [], 'Latn', 'ltr', false],
  ['pt', "Portuguese", "Português", [], 'Latn', 'ltr', false],
  ['ro', "Romanian", "Română", [], 'Latn', 'ltr', false],
  ['ru', "Russian", "Русский", [], 'Cyrl', 'ltr', false],
  ['sk', "Slovak", "Slovenčina", [], 'Latn', 'ltr', false],
  ['sv', "Swedish", "Svenska", [], 'Latn', 'ltr', false],
  ['sw', "Swahili", "Kiswahili", [], 'Latn', 'ltr', false],
  ['th', "Thai", "ไทย", [], 'Thai', 'ltr', false],
  ['tr', "Turkish", "Türkçe", [], 'Latn', 'ltr', false],
  ['uk', "Ukrainian", "Українська", [], 'Cyrl', 'ltr', false],
  ['ur', "Urdu", "اردو", [], 'Arab', 'rtl', false],
  ['vi', "Vietnamese", "Tiếng Việt", [], 'Latn', 'ltr', false],
  ['zh', "Chinese", "中文", ["Mandarin"], 'Hans', 'ltr', false],
];

const LEGACY = [
  ["greek_to_italian", "el", "it", true],
  ["italian_to_greek", "it", "el", true],
];

export const REGISTRY_PAYLOAD = {
  languages: LANGUAGES.map(
    ([id, label, native_name, aliases, script, text_direction, enhanced]) => ({
      id, label, native_name, aliases, script, text_direction, enhanced,
    }),
  ),
  directions: [
    ...LEGACY,
    ...LANGUAGES.flatMap(([from]) =>
      LANGUAGES.filter(([to]) => to !== from && !(from === "el" && to === "it") &&
        !(from === "it" && to === "el")).map(([to]) => [
        `${from}_to_${to}`,
        from,
        to,
        false,
      ]),
    ),
  ].map(([key, prompt_language, answer_language, legacy]) => ({
    key, prompt_language, answer_language, legacy,
  })),
};
