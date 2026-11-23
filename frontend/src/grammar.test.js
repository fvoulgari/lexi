import { expect, test } from "vitest";
import {
  GRAMMAR_DATA,
  GRAMMAR_DEFINITIONS,
  adjectiveFields,
  adjectiveFormFields,
  adjectiveGroups,
  cleanGrammar,
  grammarFieldsFor,
  grammarLanguages,
  languageOfField,
  nounFields,
  registerGrammarDefinition,
  requiredGenderFields,
  unregisterGrammarDefinition,
} from "./grammar.js";

test("grammar definitions are keyed by language ID and cover it and el only", () => {
  expect(Object.keys(GRAMMAR_DEFINITIONS)).toEqual(["it", "el"]);
  expect(GRAMMAR_DEFINITIONS.it.genders).toEqual(["masculine", "feminine"]);
  expect(GRAMMAR_DEFINITIONS.el.genders).toEqual([
    "masculine",
    "feminine",
    "neuter",
  ]);
  expect(nounFields).toEqual([
    "italian_gender",
    "greek_gender",
    "italian_plural",
    "greek_plural",
  ]);
  expect(adjectiveFormFields).toContain("greek_neuter_plural");
  expect(adjectiveFields).toContain("italian_adjective_gender");
  expect(languageOfField("greek_feminine_singular")).toBe("el");
});

test("frontend definitions come from the shared backend configuration", () => {
  expect(GRAMMAR_DATA.languages.it.fields.example.storage).toBe("italian_example");
  expect(GRAMMAR_DATA.languages.el.fields.pronunciation.storage).toBe(
    "greek_pronunciation",
  );
  expect(GRAMMAR_DEFINITIONS.it.example).toBe("italian_example");
  expect(GRAMMAR_DEFINITIONS.it.pronunciation).toBe("pronunciation");
  expect(GRAMMAR_DEFINITIONS.el.example).toBe("greek_example");
  expect(GRAMMAR_DEFINITIONS.it.schema.gender.type).toBe("enum");
  expect(GRAMMAR_DEFINITIONS.it.schema.gender.options).toEqual([
    "masculine",
    "feminine",
  ]);
});

test("card language IDs select the applicable grammar definitions", () => {
  expect(grammarLanguages({ source_language: "en", target_language: "da" })).toEqual(
    [],
  );
  expect(grammarLanguages({ source_language: "da", target_language: "it" })).toEqual(
    ["it"],
  );
  expect(grammarLanguages({ source_language: "el", target_language: "it" })).toEqual(
    ["it", "el"],
  );
  expect(grammarLanguages()).toEqual(["it", "el"]);
  expect(grammarFieldsFor("noun", ["en", "da"])).toEqual([]);
  expect(requiredGenderFields("noun", ["en", "da"])).toEqual([]);
  expect(requiredGenderFields("noun", ["en", "it"])).toEqual([
    "italian_gender",
  ]);
});

test("legacy grammar values stay readable and editable through definitions", () => {
  const values = {
    word_type: "adjective",
    italian_adjective_gender: "masculine",
    greek_adjective_gender: "neuter",
    italian_masculine_singular: "alto",
    greek_neuter_plural: "ψηλά",
    notes: "unchanged",
  };
  expect(cleanGrammar(values, ["it", "el"])).toEqual(values);
  expect(cleanGrammar(values, ["en", "da"])).toEqual({
    ...values,
    italian_adjective_gender: null,
    greek_adjective_gender: null,
    italian_masculine_singular: null,
    greek_neuter_plural: null,
  });
  expect(adjectiveGroups(values, "it")[0]).toEqual([
    "italian_masculine_plural",
  ]);
  expect(adjectiveGroups(values, "el")[0]).toEqual(["greek_neuter_plural"]);
  expect(adjectiveGroups(values, "da")).toEqual([]);
});

test("a test-only definition adds rendering fields without a new component", () => {
  registerGrammarDefinition("zz", {
    legacy_name: "synthetic",
    genders: ["animate"],
    fields: {
      gender: {
        type: "enum",
        options: ["animate"],
        storage: "synthetic_gender",
        word_types: ["noun"],
        required_for: ["noun"],
      },
      plural: {
        type: "text",
        storage: "synthetic_plural",
        word_types: ["noun"],
      },
      adjective_gender: {
        type: "enum",
        options: ["animate"],
        storage: "synthetic_adjective_gender",
        word_types: ["adjective"],
        required_for: ["adjective"],
      },
      forms: {
        animate_plural: {
          type: "text",
          storage: "synthetic_animate_plural",
          word_types: ["adjective"],
        },
      },
      example: {
        type: "long_text",
        storage: "synthetic_example",
        word_types: ["noun"],
      },
      pronunciation: {
        type: "long_text",
        storage: "synthetic_pronunciation",
        word_types: ["noun"],
      },
    },
  });
  try {
    expect(grammarLanguages({ source_language: "zz", target_language: "en" })).toEqual([
      "zz",
    ]);
    expect(grammarFieldsFor("noun", ["zz", "en"])).toEqual([
      "synthetic_gender",
      "synthetic_plural",
    ]);
    expect(grammarFieldsFor("adjective", ["zz", "en"])).toEqual([
      "synthetic_adjective_gender",
      "synthetic_animate_plural",
    ]);
    expect(requiredGenderFields("noun", ["zz", "en"])).toEqual([
      "synthetic_gender",
    ]);
    expect(languageOfField("synthetic_example")).toBe("zz");
  } finally {
    unregisterGrammarDefinition("zz");
  }
  expect(grammarLanguages({ source_language: "zz", target_language: "en" })).toEqual(
    [],
  );
});
