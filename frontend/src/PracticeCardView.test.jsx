import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import PracticeCardView from "./PracticeCardView.jsx";
import { copy } from "./copy.js";

const entry = {
  italian: "casa",
  greek: "σπίτι",
  word_type: "noun",
  italian_gender: "feminine",
  greek_gender: "neuter",
  italian_plural: "case",
  greek_plural: "σπίτια",
  italian_example: "La casa è grande.",
  greek_example: "Το σπίτι είναι μεγάλο.",
  pronunciation: "KA-za",
  notes: "Shared note",
};

for (const direction of ["greek_to_italian", "italian_to_greek"]) {
  test(`revealed cards show only destination-language details in ${direction}`, () => {
    const target = direction === "greek_to_italian" ? "italian" : "greek";
    const source = target === "italian" ? "greek" : "italian";
    const { rerender } = render(
      <PracticeCardView
        entry={entry}
        text={copy.en}
        direction={direction}
        revealed={false}
      />,
    );
    for (const field of ["gender", "plural", "example"]) {
      expect(
        screen.queryByText(copy.en.cardDetailLabels[field]),
      ).not.toBeInTheDocument();
    }
    rerender(
      <PracticeCardView
        entry={entry}
        text={copy.en}
        direction={direction}
        revealed
      />,
    );
    expect(screen.getByRole("heading", { name: entry[target] })).toBeVisible();
    for (const field of ["gender", "plural", "example"]) {
      expect(screen.getByText(copy.en.cardDetailLabels[field])).toBeVisible();
      expect(
        screen.queryByText(copy.en.fields[`${source}_${field}`]),
      ).not.toBeInTheDocument();
    }
    expect(screen.queryByText("Shared note")).not.toBeInTheDocument();
    if (target === "italian") expect(screen.getByText("KA-za")).toBeVisible();
    else expect(screen.queryByText("KA-za")).not.toBeInTheDocument();
    rerender(
      <PracticeCardView
        entry={entry}
        text={copy.en}
        direction={
          direction === "greek_to_italian"
            ? "italian_to_greek"
            : "greek_to_italian"
        }
        revealed
      />,
    );
    expect(screen.getByText(entry[`${source}_example`])).toBeVisible();
    expect(
      screen.queryByText(entry[`${target}_example`]),
    ).not.toBeInTheDocument();
  });
}

for (const language of ["el", "en", "it"]) {
  test(`card details use short labels in ${language}`, () => {
    const text = copy[language];
    render(
      <PracticeCardView
        entry={entry}
        text={text}
        direction="greek_to_italian"
        revealed
      />,
    );
    for (const field of ["gender", "plural", "example"]) {
      expect(screen.getByText(text.cardDetailLabels[field])).toBeVisible();
      expect(
        screen.queryByText(text.fields[`italian_${field}`]),
      ).not.toBeInTheDocument();
    }
    expect(screen.getByText(text.cardPronunciation)).toBeVisible();
  });
}

for (const category of ["verb", "adverb", "expression", "other", "adjective"]) {
  test(`${category} hides legacy noun grammar and omits empty details`, () => {
    const { rerender, container } = render(
      <PracticeCardView
        entry={{
          ...entry,
          word_type: category,
          italian_feminine_singular: "italiana",
          italian_masculine_plural: "italiani",
          italian_feminine_plural: "italiane",
        }}
        text={copy.en}
        direction="greek_to_italian"
        revealed
      />,
    );
    expect(screen.queryByText("case")).not.toBeInTheDocument();
    if (category !== "adjective")
      expect(screen.queryByText(copy.en.feminine)).not.toBeInTheDocument();
    for (const value of ["italiana", "italiani", "italiane"]) {
      if (category === "adjective")
        expect(screen.getByText(value)).toBeVisible();
      else expect(screen.queryByText(value)).not.toBeInTheDocument();
    }
    rerender(
      <PracticeCardView
        entry={{ italian: "blu", greek: "μπλε", word_type: category }}
        text={copy.en}
        direction="greek_to_italian"
        revealed
      />,
    );
    expect(container.querySelector("dl")).toBeNull();
  });
}

test("Greek adjective answer hides Italian adjective forms", () => {
  render(
    <PracticeCardView
      entry={{
        ...entry,
        word_type: "adjective",
        italian_feminine_singular: "italiana",
      }}
      text={copy.en}
      direction="italian_to_greek"
      revealed
    />,
  );
  expect(screen.queryByText("italiana")).not.toBeInTheDocument();
  expect(screen.queryByText("σπίτια")).not.toBeInTheDocument();
});

test("legacy common gender is omitted from old card snapshots", () => {
  render(
    <PracticeCardView
      entry={{ ...entry, italian_gender: "common" }}
      text={copy.en}
      direction="greek_to_italian"
      revealed
    />,
  );
  expect(
    screen.queryByText(copy.en.cardDetailLabels.gender),
  ).not.toBeInTheDocument();
  expect(screen.getByText("case")).toBeVisible();
});

for (const [language, genders] of [
  ["italian", ["masculine", "feminine"]],
  ["greek", ["masculine", "feminine", "neuter"]],
]) {
  for (const gender of genders) {
    test(`${language} ${gender} answer shows ordered adjective forms and only its pronunciation`, () => {
      const forms = Object.fromEntries(
        genders.flatMap((g) =>
          ["singular", "plural"].map((number) => [
            `${language}_${g}_${number}`,
            `${g}-${number}`,
          ]),
        ),
      );
      const target = {
        ...entry,
        ...forms,
        word_type: "adjective",
        [`${language}_adjective_gender`]: gender,
        pronunciation: "ιταλική φωνητική",
        greek_pronunciation: "Greek notation",
      };
      const { container } = render(
        <PracticeCardView
          entry={target}
          text={copy.en}
          direction={
            language === "italian" ? "greek_to_italian" : "italian_to_greek"
          }
          revealed
        />,
      );
      const lines = [...container.querySelectorAll(".adjective-metadata dl")];
      expect(
        [...lines[0].querySelectorAll("dt")].map((el) => el.textContent),
      ).toEqual(["Gender", "Plural"]);
      expect(
        [...lines[0].querySelectorAll("dd")].map((el) => el.textContent),
      ).toEqual([copy.en[gender], `${gender}-plural`]);
      const others = genders.filter((g) => g !== gender);
      expect(
        lines.slice(1).map((line) => line.querySelector("dt").textContent),
      ).toEqual(others.map((g) => copy.en[g]));
      expect(
        lines.slice(1).map((line) => line.querySelector("dd").textContent),
      ).toEqual(others.map((g) => `${g}-singular / ${g}-plural`));
      expect(container.querySelector("table")).toBeNull();
      expect(screen.queryByText(`${gender}-singular`)).not.toBeInTheDocument();
      expect(
        screen.getByText(
          language === "italian" ? "ιταλική φωνητική" : "Greek notation",
        ),
      ).toBeVisible();
      expect(
        screen.queryByText(
          language === "italian" ? "Greek notation" : "ιταλική φωνητική",
        ),
      ).not.toBeInTheDocument();
      expect(
        container.querySelectorAll(".card-detail-groups dl").length,
      ).toBeGreaterThan(1);
    });
  }
}

for (const number of ["singular", "plural"]) {
  test(`a partially filled adjective gender explicitly labels ${number} without a slash`, () => {
    const { container } = render(
      <PracticeCardView
        entry={{
          italian: "inglese",
          greek: "αγγλικός",
          word_type: "adjective",
          italian_adjective_gender: "masculine",
          [`italian_feminine_${number}`]:
            number === "singular" ? "inglese" : "inglesi",
        }}
        text={copy.en}
        direction="greek_to_italian"
        revealed
      />,
    );
    const line = container.querySelector(".adjective-gender-line");
    expect(line).toHaveTextContent("Feminine");
    expect(line.querySelector("dd")).toHaveTextContent(
      `${copy.en.cardDetailLabels[number]}: ${number === "singular" ? "inglese" : "inglesi"}`,
    );
    expect(line.textContent).not.toContain("/");
    expect(container.querySelectorAll(".adjective-gender-line")).toHaveLength(
      1,
    );
  });
}

test("adjective details stay hidden before reveal, including the selected gender", () => {
  const { container } = render(
    <PracticeCardView
      entry={{
        italian: "alta",
        greek: "ψηλή",
        word_type: "adjective",
        italian_adjective_gender: "feminine",
        italian_feminine_plural: "alte",
        italian_masculine_singular: "alto",
        italian_masculine_plural: "alti",
      }}
      text={copy.en}
      direction="greek_to_italian"
      revealed={false}
    />,
  );
  expect(container.querySelector(".adjective-metadata")).toBeNull();
  expect(screen.queryByText("alte")).not.toBeInTheDocument();
});
