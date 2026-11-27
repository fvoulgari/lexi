import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import PracticeCardView from "./PracticeCardView.jsx";
import { copy } from "./copy.js";

const text = copy.en;

test("common-only languages render no grammar and use their own lang attributes", () => {
  const { container } = render(
    <PracticeCardView
      entry={{
        source_language: "en",
        target_language: "da",
        source_text: "house",
        target_text: "hus",
        word_type: "noun",
        italian_gender: "feminine",
        greek_gender: "neuter",
        italian_plural: "case",
        greek_plural: "σπίτια",
      }}
      text={text}
      direction="en_to_da"
      revealed
    />,
  );
  expect(screen.getByRole("heading", { name: "hus" })).toHaveAttribute(
    "lang",
    "da",
  );
  expect(container.querySelector(".card-prompt")).toHaveAttribute("lang", "en");
  expect(screen.queryByText(text.cardDetailLabels.gender)).not.toBeInTheDocument();
  expect(screen.queryByText(text.cardDetailLabels.plural)).not.toBeInTheDocument();
});

test("a mixed pair renders grammar from the defined language only", () => {
  render(
    <PracticeCardView
      entry={{
        source_language: "en",
        target_language: "it",
        source_text: "ticket",
        target_text: "biglietto",
        word_type: "noun",
        italian_gender: "masculine",
        italian_plural: "biglietti",
        greek_plural: "εισιτήρια",
        greek_gender: "neuter",
      }}
      text={text}
      direction="en_to_it"
      revealed
    />,
  );
  expect(screen.getByRole("heading", { name: "biglietto" })).toHaveAttribute(
    "lang",
    "it",
  );
  expect(screen.getByText(text.cardDetailLabels.gender)).toBeVisible();
  expect(screen.getByText(text.masculine)).toBeVisible();
  expect(screen.getByText("biglietti")).toBeVisible();
  expect(screen.queryByText("εισιτήρια")).not.toBeInTheDocument();
});

test("structured grammar from a new snapshot is rendered for generic languages", () => {
  render(
    <PracticeCardView
      entry={{
        source_language: "en",
        target_language: "da",
        source_text: "house",
        target_text: "hus",
        word_type: "noun",
        grammar: { da: { gender: "common", plural: "huse" } },
      }}
      text={text}
      direction="en_to_da"
      revealed
    />,
  );
  expect(screen.getByText("Danish gender")).toBeVisible();
  expect(screen.getByText(text.common)).toBeVisible();
  expect(screen.getByText("Danish plural")).toBeVisible();
  expect(screen.getByText("huse")).toBeVisible();
});
