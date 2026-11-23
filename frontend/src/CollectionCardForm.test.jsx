import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import CollectionCardForm from "./CollectionCardForm.jsx";
import { collectionCopy } from "./collection-copy.js";
import { copy } from "./copy.js";
import {
  registerGrammarDefinition,
  unregisterGrammarDefinition,
} from "./grammar.js";
import { hydrateLanguages } from "./languages.js";
import { REGISTRY_PAYLOAD } from "./language-fixtures.js";

const server = setupServer(
  http.get("*/api/tags", () =>
    HttpResponse.json([
      { id: "t1", name: "Daily", can_edit: true },
      { id: "t2", name: "Travel", can_edit: true },
    ]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

function open({ pair, card = {}, collection = {}, onSubmit = vi.fn() }) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CollectionCardForm
        card={card}
        pair={pair}
        collection={collection}
        text={copy.en}
        t={collectionCopy.en}
        busy={false}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />
    </QueryClientProvider>,
  );
  return onSubmit;
}

test("a universal pair exposes only common fields and no grammar section", async () => {
  open({ pair: ["en", "da"] });
  expect(
    screen.getByRole("textbox", { name: "English", exact: true }),
  ).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "Danish", exact: true }),
  ).toBeVisible();
  expect(screen.getByLabelText("Word type *")).toBeVisible();
  const details = screen.getByText(copy.en.cardOptionalDetails).closest("details");
  await userEvent.setup().click(screen.getByText(copy.en.cardOptionalDetails));
  expect(details).toHaveAttribute("open");
  expect(within(details).getByLabelText(copy.en.fields.notes)).toBeVisible();
  expect(within(details).getByRole("group", { name: copy.en.assignTags })).toBeVisible();
  expect(screen.queryByLabelText(copy.en.fields.italian_gender)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(copy.en.fields.greek_gender)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(copy.en.fields.italian_example)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(copy.en.fields.greek_pronunciation)).not.toBeInTheDocument();
});

test("notes, word type and themes are editable and saved for universal cards", async () => {
  const user = userEvent.setup();
  const onSubmit = open({ pair: ["en", "da"] });
  await user.type(screen.getByRole("textbox", { name: "English", exact: true }), "house");
  await user.type(screen.getByRole("textbox", { name: "Danish", exact: true }), "hus");
  await user.selectOptions(screen.getByLabelText("Word type *"), "verb");
  await user.type(screen.getByLabelText(copy.en.fields.notes), "Remember this one");
  await user.click(screen.getByRole("checkbox", { name: "Daily" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  const payload = onSubmit.mock.calls[0][0];
  expect(payload).toMatchObject({
    word_type: "verb",
    notes: "Remember this one",
    tag_ids: ["t1"],
    grammar: null,
  });
  expect(payload).not.toHaveProperty("italian_gender");
});

test("a mixed en/el pair renders only Greek grammar from the schema", async () => {
  const user = userEvent.setup();
  const onSubmit = open({ pair: ["en", "el"] });
  await user.type(screen.getByRole("textbox", { name: "English", exact: true }), "house");
  await user.type(screen.getByRole("textbox", { name: "Greek", exact: true }), "σπίτι");
  await user.selectOptions(screen.getByLabelText("Word type *"), "noun");
  const greek = screen.getByLabelText(copy.en.fields.greek_gender);
  expect([...greek.options].map((option) => option.value)).toEqual([
    "",
    "masculine",
    "feminine",
    "neuter",
  ]);
  expect(screen.queryByLabelText(copy.en.fields.italian_gender)).not.toBeInTheDocument();
  await user.selectOptions(greek, "neuter");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSubmit.mock.calls[0][0].grammar).toEqual({ el: { gender: "neuter" } });
});

test("legacy el/it editing keeps Greek and Italian grammar in structured storage", async () => {
  const user = userEvent.setup();
  const onSubmit = open({
    pair: ["el", "it"],
    card: {
      id: "c1",
      source_language: "el",
      target_language: "it",
      source_text: "σπίτι",
      target_text: "casa",
      word_type: "noun",
      italian_gender: "feminine",
      greek_gender: "neuter",
      italian_example: "La casa è grande.",
      pronunciation: "ˈkaza",
      tags: [{ id: "t2", name: "Travel" }],
    },
  });
  expect(screen.getByLabelText(copy.en.fields.italian_gender)).toHaveValue("feminine");
  expect(screen.getByLabelText(copy.en.fields.greek_gender)).toHaveValue("neuter");
  await user.click(screen.getByText(copy.en.cardOptionalDetails));
  expect(screen.getByLabelText(copy.en.fields.italian_example)).toHaveValue(
    "La casa è grande.",
  );
  expect(screen.getByLabelText(copy.en.fields.pronunciation)).toHaveValue("ˈkaza");
  expect(screen.getByRole("checkbox", { name: "Travel" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Save" }));
  const payload = onSubmit.mock.calls[0][0];
  expect(payload.source_language).toBe("el");
  expect(payload.target_language).toBe("it");
  expect(payload.tag_ids).toEqual(["t2"]);
  expect(payload.grammar).toEqual({
    it: { gender: "feminine", example: "La casa è grande.", pronunciation: "ˈkaza" },
    el: { gender: "neuter" },
  });
});

test("a data-only grammar definition renders without a new component or column", async () => {
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
      example: { type: "long_text", storage: "synthetic_example", word_types: ["noun"] },
      pronunciation: {
        type: "long_text",
        storage: "synthetic_pronunciation",
        word_types: ["noun"],
      },
    },
  });
  hydrateLanguages({
    ...REGISTRY_PAYLOAD,
    languages: [
      ...REGISTRY_PAYLOAD.languages,
      { id: "zz", label: "Synthetic", script: "Latn", text_direction: "ltr", enhanced: true },
    ],
    directions: [
      ...REGISTRY_PAYLOAD.directions,
      { key: "zz_to_en", prompt_language: "zz", answer_language: "en" },
      { key: "en_to_zz", prompt_language: "en", answer_language: "zz" },
    ],
  });
  try {
    const user = userEvent.setup();
    open({ pair: ["zz", "en"] });
    expect(screen.getByRole("textbox", { name: "Synthetic", exact: true })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "English", exact: true })).toBeVisible();
    expect(screen.getByLabelText("Word type *")).toBeVisible();
    expect(screen.queryByLabelText(copy.en.fields.italian_gender)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Word type *"), "noun");
    // The requirement is rendered from the definition as a select with its option.
    const gender = screen.getByLabelText("Gender");
    expect([...gender.options].map((option) => option.value)).toEqual(["", "animate"]);
    expect(gender).toBeRequired();
  } finally {
    unregisterGrammarDefinition("zz");
    hydrateLanguages(REGISTRY_PAYLOAD);
  }
});

test("preview directions follow the card pair instead of the legacy default", async () => {
  const user = userEvent.setup();
  open({ pair: ["en", "da"] });
  await user.click(screen.getByRole("button", { name: "Preview card" }));
  const select = screen.getByLabelText("Learning direction");
  expect([...select.options].map((option) => option.textContent)).toEqual([
    "Danish → English",
    "English → Danish",
  ]);
});

test("preview uses explicit card identities when the pair is reversed", async () => {
  const user = userEvent.setup();
  open({
    pair: ["el", "it"],
    card: {
      id: "c1",
      source_language: "it",
      target_language: "el",
      source_text: "casa",
      target_text: "σπίτι",
      word_type: "expression",
    },
  });
  await user.click(screen.getByRole("button", { name: "Preview card" }));
  const select = screen.getByLabelText("Learning direction");
  expect([...select.options].map((option) => option.textContent)).toEqual([
    "Greek → Italian",
    "Italian → Greek",
  ]);
});

test("editing never offers language identity controls, even for reversed pairs", () => {
  open({
    pair: ["el", "it"],
    card: {
      id: "c1",
      source_language: "it",
      target_language: "el",
      source_text: "casa",
      target_text: "σπίτι",
      word_type: "expression",
    },
  });
  expect(screen.queryByRole("combobox", { name: /Language/ })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Italian", exact: true })).toHaveValue("casa");
  expect(screen.getByRole("textbox", { name: "Greek", exact: true })).toHaveValue("σπίτι");
});
