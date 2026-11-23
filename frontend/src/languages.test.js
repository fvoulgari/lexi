import { expect, test } from "vitest";
import {
  directionKey,
  directionLanguages,
  directionLabel,
  isLegacyDirection,
  isLegacyPair,
  LANGUAGES,
  pairDirections,
  samePair,
} from "./languages.js";

test("every supported pair has two distinct directed keys", () => {
  const keys = new Set();
  for (const first of LANGUAGES) {
    for (const second of LANGUAGES) {
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
  expect(keys.size).toBe(LANGUAGES.length * (LANGUAGES.length - 1));
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

test("labels come from ordered language IDs, not legacy key names", () => {
  const label = (code) => ({ en: "English", da: "Danish" })[code];
  expect(directionLabel("en_to_da", label)).toBe("English → Danish");
  expect(directionLabel("da_to_en", label)).toBe("Danish → English");
  expect(directionLabel("italian_to_greek", (code) => code)).toBe("it → el");
});
