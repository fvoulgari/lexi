import { expect, test } from "vitest";
import {
  GRAMMAR_DEFINITIONS,
  adjectiveFields,
  adjectiveFormFields,
  adjectiveGroups,
  cleanGrammar,
  grammarFieldsFor,
  grammarLanguages,
  languageOfField,
  nounFields,
  requiredGenderFields,
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
