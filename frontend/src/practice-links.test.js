import { expect, test } from "vitest";
import {
  firstDirectionForLanguages,
  practicePairForDirection,
  practiceUrl,
  practiceUrlForCollection,
  practiceUrlForDirection,
} from "./practice-links.js";

test("practice links encode canonical unordered pairs and explicit directions", () => {
  expect(practicePairForDirection("italian_to_greek")).toBe("el-it");
  expect(practicePairForDirection("en_to_da")).toBe("da-en");
  expect(firstDirectionForLanguages("da", "en")).toBe("da_to_en");
  expect(practiceUrl({ mode: "difficult", direction: "en_to_da" })).toBe(
    "/practice?mode=difficult&pair=da-en&direction=en_to_da",
  );
  expect(
    practiceUrlForDirection("en_to_da", { collection: "c1,c2" }),
  ).toBe("/practice?pair=da-en&direction=en_to_da&collection=c1%2Cc2");
});

test("collection links preserve declared Base→Learning order without inference", () => {
  expect(
    practiceUrlForCollection({
      id: "c",
      source_language: "en",
      target_language: "da",
    }),
  ).toBe("/practice?pair=da-en&direction=en_to_da&collection=c");
  expect(
    practiceUrlForCollection({
      id: "c",
      source_language: "da",
      target_language: "en",
    }),
  ).toBe("/practice?pair=da-en&direction=da_to_en&collection=c");
  expect(
    practiceUrlForCollection(
      { id: "c", source_language: "da", target_language: "en" },
      { direction: "en_to_da" },
    ),
  ).toBe("/practice?pair=da-en&direction=en_to_da&collection=c");
});

test("legacy collections without pair metadata use the original course pair", () => {
  expect(practiceUrlForCollection({ id: "legacy" })).toBe(
    "/practice?pair=el-it&direction=greek_to_italian&collection=legacy",
  );
});
