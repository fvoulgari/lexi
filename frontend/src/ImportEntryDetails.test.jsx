import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import ImportEntryDetails from "./ImportEntryDetails.jsx";
import { copy } from "./copy.js";

test("shows structured-only Danish grammar from an import preview row", () => {
  render(
    <ImportEntryDetails
      row={{
        source_language: "en",
        target_language: "da",
        italian: "house",
        greek: "hus",
        entry: {
          word_type: "noun",
          grammar: {
            da: { gender: "common", plural: "huse", example: "Huset er stort." },
          },
        },
        tags: [],
      }}
      text={copy.en}
    />,
  );

  expect(screen.getByText("Common")).toBeInTheDocument();
  expect(screen.getByText("huse")).toBeInTheDocument();
  expect(screen.getByText("Huset er stort.")).toBeInTheDocument();
});
