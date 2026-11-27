import { expect, test } from "vitest";
import {
  directionKey,
  directionLanguages,
  directionLabel,
  hydrateLanguages,
  isLegacyDirection,
  isLegacyPair,
  languageDirection,
  languageIds,
  languageScript,
  languageTextProps,
  pairDirections,
  pairKey,
  pairLabel,
  resetLanguages,
  samePair,
  supportedPairs,
} from "./languages.js";
import { REGISTRY_PAYLOAD } from "./language-fixtures.js";

test("every catalogued pair has two distinct directed keys", () => {
  const ids = languageIds();
  const keys = new Set();
  for (const first of ids) {
    for (const second of ids) {
      if (first === second) continue;
      const directions = pairDirections(first, second);
      expect(directions).toHaveLength(2);
      expect(new Set(directions).size).toBe(2);
      directions.forEach((key) => {
        expect(directionLanguages(key)).toHaveLength(2);
        keys.add(key);
      });
    }
  }
  expect(keys.size).toBe(ids.length * (ids.length - 1));
});

test("legacy direction keys keep their original language order", () => {
  expect(directionLanguages("greek_to_italian")).toEqual(["el", "it"]);
  expect(directionLanguages("italian_to_greek")).toEqual(["it", "el"]);
  expect(directionKey("el", "it")).toBe("greek_to_italian");
  expect(directionKey("it", "el")).toBe("italian_to_greek");
  expect(directionKey("en", "da")).toBe("en_to_da");
  expect(isLegacyDirection("italian_to_greek")).toBe(true);
  expect(isLegacyDirection("en_to_it")).toBe(false);
});

test("pairs are unordered and legacy identity is explicit", () => {
  expect(samePair("en", "da", "da", "en")).toBe(true);
  expect(samePair("en", "el", "el", "da")).toBe(false);
  expect(samePair("en", "da", "en", "en")).toBe(false);
  expect(samePair("en", "da", "en", "zz")).toBe(false);
  expect(isLegacyPair("it", "el")).toBe(true);
  expect(isLegacyPair("el", "da")).toBe(false);
  expect(pairDirections("en", "en")).toEqual([]);
});

test("labels and direction metadata come from the registry response", () => {
  const payload = {
    languages: [
      {
        id: "zz",
        label: "Synthetic",
        script: "Arab",
        text_direction: "rtl",
        enhanced: false,
      },
      {
        id: "en",
        label: "English",
        script: "Latn",
        text_direction: "ltr",
        enhanced: false,
      },
    ],
    directions: [
      {
        key: "zz_to_en",
        prompt_language: "zz",
        answer_language: "en",
        legacy: false,
      },
      {
        key: "en_to_zz",
        prompt_language: "en",
        answer_language: "zz",
        legacy: false,
      },
    ],
  };
  hydrateLanguages(payload);
  expect(languageIds()).toEqual(["zz", "en"]);
  expect(directionLanguages("zz_to_en")).toEqual(["zz", "en"]);
  expect(directionLabel("zz_to_en")).toBe("Synthetic → English");
  expect(samePair("zz", "en", "en", "zz")).toBe(true);
  expect(isLegacyPair("zz", "en")).toBe(false);
  expect(pairDirections("el", "it")).toEqual([]);
  expect(languageDirection("zz")).toBe("rtl");
  expect(languageScript("zz")).toBe("Arab");
  expect(languageTextProps("zz")).toEqual({
    lang: "zz",
    dir: "rtl",
    "data-script": "Arab",
  });
  expect(languageTextProps("en")).toEqual({
    lang: "en",
    dir: "ltr",
    "data-script": "Latn",
  });
  expect(languageTextProps(undefined)).toEqual({});
  resetLanguages();
  expect(() => languageIds()).toThrow("not been loaded");
  expect(languageTextProps("zz")).toEqual({ lang: "zz", dir: undefined, "data-script": undefined });
  hydrateLanguages(REGISTRY_PAYLOAD);
});

test("supported pairs cover the registry once each with registry labels", () => {
  const pairs = supportedPairs(["el", "en", "it", "da"]);
  expect(pairs.map((option) => option.key)).toEqual([
    "el-en",
    "en-it",
    "da-en",
    "el-it",
    "da-el",
    "da-it",
  ]);
  expect(pairs.map((option) => pairLabel(option.languages))).toEqual([
    "English ↔ Greek",
    "English ↔ Italian",
    "English ↔ Danish",
    "Greek ↔ Italian",
    "Greek ↔ Danish",
    "Italian ↔ Danish",
  ]);
  expect(pairKey("it", "el")).toBe("el-it");
  expect(supportedPairs()).toEqual([
    { key: "el-it", languages: ["el", "it"] },
  ]);
});
