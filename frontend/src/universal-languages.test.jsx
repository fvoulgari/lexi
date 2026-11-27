import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import CardPreview from "./CardPreview.jsx";
import CollectionCardForm from "./CollectionCardForm.jsx";
import { collectionCopy } from "./collection-copy.js";
import { copy } from "./copy.js";
import LanguagePicker from "./LanguagePicker.jsx";
import {
  directionKey,
  hydrateLanguages,
  languageDirection,
  languageIds,
  languageOptions,
  languageScript,
  pairDirections,
  resetLanguages,
} from "./languages.js";
import { REGISTRY_PAYLOAD } from "./language-fixtures.js";
import PracticeCardView from "./PracticeCardView.jsx";

const server = setupServer(
  http.get("*/api/tags", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

/** Extend the curated API payload with rows only; no component knows the codes. */
function withLanguages(rows) {
  const added = new Set(rows.map((row) => row.id));
  const languages = [
    ...REGISTRY_PAYLOAD.languages.filter((row) => !added.has(row.id)),
    ...rows,
  ];
  const ids = languages.map((row) => row.id);
  const payload = {
    languages,
    directions: [
      ...REGISTRY_PAYLOAD.directions,
      ...ids.flatMap((from) =>
        ids
          .filter((to) => to !== from && !(from === "el" && to === "it") && !(from === "it" && to === "el"))
          .map((to) => ({
            key: `${from}_to_${to}`,
            prompt_language: from,
            answer_language: to,
            legacy: false,
          })),
      ),
    ],
  };
  hydrateLanguages(payload);
  return payload;
}

const JAPANESE = {
  id: "ja",
  label: "Japanese",
  script: "Jpan",
  text_direction: "ltr",
  enhanced: false,
};
const ARABIC = {
  id: "ar",
  label: "Arabic",
  script: "Arab",
  text_direction: "rtl",
  enhanced: false,
};

function wrap(children) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

afterEach(() => resetLanguages());

test("curated Japanese and Arabic come only from registry metadata", () => {
  withLanguages([JAPANESE, ARABIC]);
  expect(new Set(languageIds())).toEqual(
    new Set(REGISTRY_PAYLOAD.languages.map((row) => row.id)),
  );
  expect(languageOptions().map((option) => option.id)).toEqual(
    expect.arrayContaining(["ja", "ar"]),
  );
  expect(languageDirection("ar")).toBe("rtl");
  expect(languageScript("ar")).toBe("Arab");
  expect(languageScript("ja")).toBe("Jpan");
  expect(languageDirection("ja")).toBe("ltr");
  for (const [from, to] of [
    ["ja", "en"],
    ["ar", "en"],
    ["ja", "ar"],
  ]) {
    expect(directionKey(from, to)).toBe(`${from}_to_${to}`);
    expect(pairDirections(from, to)).toEqual([
      `${from}_to_${to}`,
      `${to}_to_${from}`,
    ]);
  }
  expect(pairDirections("el", "it")).toEqual([
    "greek_to_italian",
    "italian_to_greek",
  ]);
});

test("universal authoring renders common fields only and preserves Unicode", async () => {
  withLanguages([JAPANESE, ARABIC]);
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  const { container } = render(
    wrap(
      <CollectionCardForm
        pair={["ja", "ar"]}
        collection={{}}
        text={copy.en}
        t={collectionCopy.en}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    ),
  );
  expect(container.querySelectorAll(".entry-language-group")).toHaveLength(0);
  const japanese = screen.getByRole("textbox", { name: "Japanese", exact: true });
  const arabic = screen.getByRole("textbox", { name: "Arabic", exact: true });
  expect(japanese).toHaveAttribute("lang", "ja");
  expect(japanese).toHaveAttribute("dir", "ltr");
  expect(arabic).toHaveAttribute("lang", "ar");
  expect(arabic).toHaveAttribute("dir", "rtl");
  await user.type(japanese, "日本語");
  await user.type(arabic, "العربية");
  await user.selectOptions(screen.getByLabelText("Word type *"), "expression");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    source_text: "العربية",
    target_text: "日本語",
    source_language: "ar",
    target_language: "ja",
  });
});

test("legacy Italian/Greek authoring still offers grammar fields", () => {
  withLanguages([JAPANESE, ARABIC]);
  const { container } = render(
    wrap(
      <CollectionCardForm
        pair={["el", "it"]}
        collection={{}}
        text={copy.en}
        t={collectionCopy.en}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    ),
  );
  expect(container.querySelectorAll(".entry-language-group").length).toBeGreaterThan(0);
});

test("preview and practice follow each side of a mixed universal pair", async () => {
  withLanguages([JAPANESE, ARABIC]);
  const user = userEvent.setup();
  const entry = {
    source_language: "ja",
    target_language: "ar",
    source_text: "本",
    target_text: "كتاب",
    word_type: "expression",
  };
  const { container, unmount } = render(
    wrap(
      <CardPreview
        pair={["ja", "ar"]}
        entry={entry}
        text={copy.en}
        initiallyOpen
      />,
    ),
  );
  expect(container.querySelector(".card-prompt")).toHaveAttribute("dir", "ltr");
  await user.click(screen.getByRole("button", { name: copy.en.revealAnswer }));
  expect(screen.getByRole("heading", { name: "كتاب" })).toHaveAttribute(
    "dir",
    "rtl",
  );
  unmount();

  const practice = render(
    <PracticeCardView
      entry={entry}
      text={copy.en}
      direction="ar_to_ja"
      revealed
    />,
  );
  expect(practice.container.querySelector(".card-prompt")).toHaveAttribute(
    "dir",
    "rtl",
  );
  expect(screen.getByRole("heading", { name: "本" })).toHaveAttribute("dir", "ltr");
});

test("a synthetic registry row alone drives picker and authoring", async () => {
  withLanguages([
    {
      id: "zz",
      label: "Synthetic",
      script: "Arab",
      text_direction: "rtl",
      enhanced: false,
    },
  ]);
  const user = userEvent.setup();
  render(<LanguagePicker value="" onChange={() => {}} label="Language" />);
  await user.click(screen.getByRole("combobox", { name: "Language" }));
  const option = screen.getByRole("option", { name: /Synthetic/ });
  expect(option.querySelector("span")).toHaveAttribute("lang", "zz");
  expect(option.querySelector("span")).toHaveAttribute("dir", "rtl");

  const { container } = render(
    wrap(
      <CollectionCardForm
        pair={["en", "zz"]}
        collection={{}}
        text={copy.en}
        t={collectionCopy.en}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    ),
  );
  expect(container.querySelectorAll(".entry-language-group")).toHaveLength(0);
  expect(screen.getByRole("textbox", { name: "Synthetic", exact: true })).toHaveAttribute(
    "dir",
    "rtl",
  );
});
