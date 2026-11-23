import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { AccountContext } from "./AccountContext.jsx";
import SharedCollections from "./SharedCollections.jsx";
import { collectionCopy } from "./collection-copy.js";

async function chooseLanguage(user, input, query, label) {
  await user.click(input);
  await user.type(input, query);
  await user.click(
    within(input.closest(".language-combobox")).getByRole("option", {
      name: label,
    }),
  );
}

const own = {
  id: "one",
  name: "Greetings",
  source_language: "el",
  target_language: "it",
  visibility: "private",
  can_edit: true,
  card_count: 1,
  entry_ids: ["ciao"],
};
const card = {
  id: "ciao",
  source_text: "γεια",
  target_text: "ciao",
  source_language: "el",
  target_language: "it",
  visibility: "private",
  can_edit: true,
};
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  window.history.pushState({}, "", "/");
});
afterAll(() => server.close());
function open(language = "en", collection = own, entry = card) {
  server.use(
    http.get("*/api/collections", () => HttpResponse.json([collection])),
    http.get("*/api/collections/one/entries", () => HttpResponse.json([entry])),
    http.get("*/api/collections/one/search", () => HttpResponse.json([])),
    http.get("*/api/collections/one/progress", () =>
      HttpResponse.json({ card_count: 1, practised: 0, difficult: 0 }),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AccountContext.Provider value={{ id: "me", profile_id: "profile" }}>
        <MemoryRouter>
          <SharedCollections csrf="csrf" language={language} />
        </MemoryRouter>
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
}
test("publication summarizes sharing without listing cards and sends the preview token and IDs", async () => {
  const user = userEvent.setup();
  let confirmation;
  server.use(
    http.get("*/api/collections/one/publish-preview", () =>
      HttpResponse.json({
        ...own,
        private_cards: [card],
        preview_token: "revision",
      }),
    ),
    http.post("*/api/collections/one/publish", async ({ request }) => {
      confirmation = await request.json();
      return HttpResponse.json({ ...own, visibility: "published" });
    }),
  );
  open();
  await user.click(
    await screen.findByRole("button", { name: "Details", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Publish collection",
      exact: true,
    }),
  );
  expect(confirmation).toBeUndefined();
  const preview = await screen.findByRole("dialog", {
    name: collectionCopy.en.publicationTitle,
  });
  expect(preview).toHaveTextContent("Greetings");
  expect(preview).toHaveTextContent("1 cards");
  expect(preview).toHaveTextContent(collectionCopy.en.publicationExplanation);
  expect(preview).not.toHaveTextContent("γεια — ciao");
  expect(
    within(preview).getByRole("button", {
      name: collectionCopy.en.publishAction,
      exact: true,
    }),
  ).toBeInTheDocument();
  expect(
    within(preview).getByRole("button", {
      name: collectionCopy.en.cancel,
      exact: true,
    }),
  ).toBeInTheDocument();
  await user.click(
    within(preview).getByRole("button", {
      name: collectionCopy.en.publishAction,
      exact: true,
    }),
  );
  await waitFor(() =>
    expect(confirmation).toEqual({
      preview_token: "revision",
      confirm_private_ids: ["ciao"],
    }),
  );
});
test("a reader can discover and practise without collection or card editing actions", async () => {
  const user = userEvent.setup();
  let submitted;
  server.use(
    http.get("*/api/collections/one/entries", () =>
      HttpResponse.json([
        { ...card, can_edit: false, visibility: "published" },
      ]),
    ),
    http.post("*/api/sessions", async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({ id: "session", cards: [] });
    }),
  );
  open(
    "en",
    { ...own, can_edit: false, visibility: "published" },
    { ...card, can_edit: false, visibility: "published" },
  );
  await user.click(
    screen.getByRole("button", { name: "Shared library", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Details", exact: true }),
  );
  expect(
    screen.queryByRole("button", { name: "Publish collection", exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Remove reference", exact: true }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Edit card", exact: true }),
    ).not.toBeInTheDocument(),
  );
  await user.click(screen.getByLabelText("Select for practice: Greetings"));
  await user.click(
    screen.getByRole("button", {
      name: "Practise selected collections",
      exact: true,
    }),
  );
  await waitFor(() =>
    expect(submitted).toMatchObject({
      profile_id: "profile",
      collection_ids: ["one"],
      direction: "greek_to_italian",
    }),
  );
});
test.each(["el", "it"])(
  "collection create and confirmation controls are localized in %s",
  async (language) => {
    open(language);
    const t = collectionCopy[language];
    expect(
      screen.getByRole("heading", { name: t.title, exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t.create, exact: true }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: t.open, exact: true }),
    ).toBeInTheDocument();
  },
);
test("Open stays an addressable link to the collection-scoped Vocabulary view", async () => {
  open();
  const link = await screen.findByRole("link", { name: "Open", exact: true });
  expect(link).toHaveAttribute("href", "/vocabulary?collection_id=one");
  expect(link).toHaveAttribute("aria-disabled", "false");
});

test("a failed publication remains visible and can be retried without closing the preview", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/collections/one/publish-preview", () =>
      HttpResponse.json({
        ...own,
        private_cards: [card],
        preview_token: "stale",
      }),
    ),
    http.post("*/api/collections/one/publish", () =>
      HttpResponse.json({ error: { code: "request_failed" } }, { status: 409 }),
    ),
  );
  open();
  await user.click(
    await screen.findByRole("button", { name: "Details", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Publish collection",
      exact: true,
    }),
  );
  const preview = await screen.findByRole("dialog", {
    name: collectionCopy.en.publicationTitle,
  });
  await user.click(
    within(preview).getByRole("button", {
      name: collectionCopy.en.publishAction,
      exact: true,
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    collectionCopy.en.error,
  );
  expect(
    screen.getByRole("dialog", { name: collectionCopy.en.publicationTitle }),
  ).toBeInTheDocument();
});

for (const reverse of [false, true]) {
  test(`collection practice maps normalized Italian–Greek storage in ${reverse ? "Italian → Greek" : "Greek → Italian"}`, async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/sessions", () =>
        HttpResponse.json({
          id: "s",
          cards: [
            {
              position: 0,
              snapshot: {
                italian: "ciao",
                greek: "γεια",
                source_language: "it",
                target_language: "el",
              },
            },
          ],
        }),
      ),
      http.post("*/api/sessions/s/cards/0/reveal", () =>
        HttpResponse.json({ revealed: true }),
      ),
    );
    open();
    await user.click(
      await screen.findByLabelText("Select for practice: Greetings"),
    );
    if (reverse)
      await user.selectOptions(
        screen.getByRole("combobox", { name: /^Practice direction/ }),
        "italian_to_greek",
      );
    await user.click(
      screen.getByRole("button", {
        name: "Practise selected collections",
        exact: true,
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: reverse ? "ciao" : "γεια",
        exact: true,
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Show answer", exact: true }),
    );
    expect(
      await screen.findByText(reverse ? "γεια" : "ciao", {
        selector: ".collection-answer",
      }),
    ).toBeInTheDocument();
  });
}

test("creating an Italian–Greek card sends the language IDs matching the form labels", async () => {
  const user = userEvent.setup();
  let submitted;
  server.use(
    http.post("*/api/collections/one/cards", async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json(card);
    }),
  );
  open();
  await user.click(
    await screen.findByRole("button", { name: "Details", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Create card", exact: true }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Italian", exact: true }),
    "ciao",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Greek", exact: true }),
    "γεια",
  );
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() =>
    expect(submitted).toMatchObject({
      source_language: "it",
      target_language: "el",
      source_text: "ciao",
      target_text: "γεια",
    }),
  );
});

test("unpublish preview distinguishes lost access from another valid owner publication", async () => {
  const user = userEvent.setup();
  let unpublished = false;
  server.use(
    http.get("*/api/collections/one/unpublish-preview", () =>
      HttpResponse.json({
        ...own,
        visibility: "published",
        private_cards: [card],
        still_shared_cards: [
          { ...card, id: "another", source_text: "casa", target_text: "σπίτι" },
        ],
      }),
    ),
    http.post("*/api/collections/one/unpublish", () => {
      unpublished = true;
      return HttpResponse.json({ ...own, visibility: "private" });
    }),
  );
  open("en", { ...own, visibility: "published" });
  await user.click(
    await screen.findByRole("button", { name: "Details", exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "Unpublish collection", exact: true }),
  );
  const preview = await screen.findByRole("dialog", {
    name: "Confirm unpublishing",
  });
  expect(preview).toHaveTextContent("will be hidden from other learners");
  expect(preview).not.toHaveTextContent(
    "remain accessible through another published collection",
  );
  expect(unpublished).toBe(false);
  await user.click(
    within(preview).getByRole("button", {
      name: "Confirm unpublishing",
      exact: true,
    }),
  );
  await waitFor(() => expect(unpublished).toBe(true));
});

test("create defaults private and edit visibility requires publication confirmation", async () => {
  const user = userEvent.setup();
  let published = false;
  server.use(
    http.get("*/api/collections/one/publish-preview", () =>
      HttpResponse.json({
        ...own,
        private_cards: [card],
        preview_token: "review",
      }),
    ),
    http.post("*/api/collections/one/publish", () => {
      published = true;
      return HttpResponse.json({ ...own, visibility: "published" });
    }),
  );
  open();
  expect(
    screen.getByRole("switch", { name: "Collection visibility" }),
  ).not.toBeChecked();
  await user.click(
    await screen.findByRole("button", { name: "Details", exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "Edit collection", exact: true }),
  );
  const switches = screen.getAllByRole("switch", {
    name: "Collection visibility",
  });
  expect(switches).toHaveLength(2);
  await user.click(switches[1]);
  const preview = await screen.findByRole("dialog", {
    name: collectionCopy.en.publicationTitle,
  });
  expect(preview).not.toHaveTextContent("γεια");
  expect(published).toBe(false);
  await user.click(
    within(preview).getByRole("button", {
      name: collectionCopy.en.publishAction,
      exact: true,
    }),
  );
  await waitFor(() => expect(published).toBe(true));
});

test("nonowners have no collection edit or visibility action", async () => {
  const user = userEvent.setup();
  open("en", { ...own, can_edit: false, visibility: "published" });
  await user.click(
    screen.getByRole("button", { name: "Shared library", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Details", exact: true }),
  );
  expect(
    screen.queryByRole("button", { name: "Edit collection", exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.getAllByRole("switch", { name: "Collection visibility" }),
  ).toHaveLength(1);
});

test("requesting Public during creation still creates private and previews before publishing", async () => {
  const user = userEvent.setup();
  let createdBody;
  let published = false;
  server.use(
    http.post("*/api/collections", async ({ request }) => {
      createdBody = await request.json();
      return HttpResponse.json(own);
    }),
    http.get("*/api/collections/one/publish-preview", () =>
      HttpResponse.json({
        ...own,
        private_cards: [card],
        preview_token: "created-preview",
      }),
    ),
    http.post("*/api/collections/one/publish", () => {
      published = true;
      return HttpResponse.json({ ...own, visibility: "published" });
    }),
  );
  open();
  await user.type(
    screen.getByRole("textbox", { name: "Collection name", exact: true }),
    "New collection",
  );
  await user.click(
    screen.getByRole("switch", { name: "Collection visibility" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Create collection", exact: true }),
  );
  const preview = await screen.findByRole("dialog", {
    name: collectionCopy.en.publicationTitle,
  });
  expect(preview).not.toHaveTextContent("γεια");
  expect(createdBody).not.toHaveProperty("visibility");
  expect(published).toBe(false);
  await user.click(
    within(preview).getByRole("button", {
      name: collectionCopy.en.publishAction,
      exact: true,
    }),
  );
  await waitFor(() => expect(published).toBe(true));
});

test("saving and removing a public Collection updates My collections without owner controls", async () => {
  const user = userEvent.setup();
  const shared = {
    ...own,
    can_edit: false,
    visibility: "published",
    owner_name: "Alba",
  };
  let saved = false;
  const methods = [];
  open("en", shared, { ...card, can_edit: false });
  server.use(
    http.get("*/api/collections", () =>
      HttpResponse.json([{ ...shared, saved }]),
    ),
    http.put("*/api/collections/one/saved", ({ request }) => {
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      methods.push("PUT");
      saved = true;
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("*/api/collections/one/saved", () => {
      methods.push("DELETE");
      saved = false;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await user.click(screen.getByRole("button", { name: "Shared library" }));
  await user.click(
    await screen.findByRole("button", { name: "Add to my collections" }),
  );
  await screen.findByRole("button", { name: "Remove from my collections" });
  await user.click(screen.getByRole("button", { name: "My collections" }));
  expect(screen.getByText("By Alba")).toBeInTheDocument();
  expect(screen.getByText("Saved")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Details", exact: true }));
  expect(screen.queryByRole("button", { name: "Edit collection" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Delete collection" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Remove from my collections" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Greetings" })).toBeNull(),
  );
  expect(methods).toEqual(["PUT", "DELETE"]);
});

test("a non-legacy Collection exposes CSV v2 import with language-keyed preview rows", async () => {
  const user = userEvent.setup();
  let previewParams;
  const nonLegacy = {
    ...own,
    name: "Greetings",
    source_language: "en",
    target_language: "da",
    can_import: true,
  };
  const v2 =
    "csv_format,card_source_language,card_target_language,text_en,text_da,word_type\n" +
    'italian-notebook-v2,en,da,"\'=1+1","hej — καλημέρα",expression\n';
  server.use(
    http.post("*/api/imports/preview", ({ request }) => {
      previewParams = Object.fromEntries(new URL(request.url).searchParams);
      return HttpResponse.json({
        counts: { valid: 1, error: 0 },
        rows: [
          {
            row: 2,
            italian: "'=1+1",
            greek: "hej — καλημέρα",
            source_language: "en",
            target_language: "da",
            status: "valid",
          },
        ],
      });
    }),
  );
  open("en", nonLegacy);
  const languagePair = screen.getAllByRole("combobox", {
    name: /Language pair/,
  });
  await chooseLanguage(user, languagePair[0], "en", "English");
  await chooseLanguage(user, languagePair[1], "da", "Danish");
  await user.click(
    await screen.findByRole("button", { name: "Details", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: collectionCopy.en.toolsImport,
      exact: true,
    }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Import CSV",
  });
  expect(previewParams).toBeUndefined();
  await user.upload(
    within(dialog).getByLabelText("Choose CSV file"),
    new File([v2], "cards-v2.csv", { type: "text/csv" }),
  );
  await user.click(within(dialog).getByRole("button", { name: "Preview" }));
  await within(dialog).findByRole("button", {
    name: "Import 1 card into Greetings",
  });
  expect(previewParams).toMatchObject({
    collection_id: "one",
    fixed_destination: "true",
  });
  expect(within(dialog).getByText("'=1+1")).toHaveAttribute("lang", "en");
  expect(within(dialog).getByText("hej — καλημέρα")).toHaveAttribute(
    "lang",
    "da",
  );
});

test("an en/da workspace derives controls from the registry and creates cards by language ID", async () => {
  const user = userEvent.setup();
  let submitted;
  const englishDanish = {
    ...own,
    source_language: "en",
    target_language: "da",
  };
  server.use(
    http.post("*/api/collections/one/cards", async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({
        ...card,
        source_language: "en",
        target_language: "da",
      });
    }),
  );
  window.history.pushState({}, "", "/collections?direction=en_to_da");
  open("en", englishDanish);
  const pair = screen.getAllByRole("combobox", { name: /Language pair/ });
  expect(pair[0]).toHaveValue("English");
  expect(pair[1]).toHaveValue("Danish");
  const direction = screen.getByRole("combobox", {
    name: /^Practice direction/,
  });
  expect([...direction.options].map((option) => option.value)).toEqual([
    "en_to_da",
    "da_to_en",
  ]);
  expect(direction).toHaveDisplayValue("English → Danish");

  await user.click(
    await screen.findByRole("button", { name: "Details", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Create card", exact: true }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Danish", exact: true }),
    "hus",
  );
  await user.type(
    screen.getByRole("textbox", { name: "English", exact: true }),
    "house",
  );
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() =>
    expect(submitted).toMatchObject({
      source_language: "da",
      target_language: "en",
      source_text: "hus",
      target_text: "house",
    }),
  );
});

test("an en/el workspace practises both directions with language-ID text mapping", async () => {
  const user = userEvent.setup();
  const directions = [];
  const englishGreek = {
    ...own,
    source_language: "en",
    target_language: "el",
  };
  const englishGreekCard = {
    ...card,
    source_language: "en",
    target_language: "el",
    source_text: "house",
    target_text: "σπίτι",
  };
  server.use(
    http.post("*/api/sessions", async ({ request }) => {
      const body = await request.json();
      directions.push(body.direction);
      return HttpResponse.json({
        id: "s",
        cards: [
          {
            position: 0,
            snapshot: englishGreekCard,
          },
        ],
      });
    }),
    http.post("*/api/sessions/s/cards/0/reveal", () =>
      HttpResponse.json({ revealed: true }),
    ),
  );
  window.history.pushState({}, "", "/collections?direction=en_to_el");
  open("en", englishGreek, englishGreekCard);
  await user.click(
    await screen.findByLabelText("Select for practice: Greetings"),
  );
  await user.click(
    screen.getByRole("button", {
      name: "Practise selected collections",
      exact: true,
    }),
  );
  expect(await screen.findByRole("heading", { name: "house" })).toHaveAttribute(
    "lang",
    "en",
  );
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  expect(
    await screen.findByText("σπίτι", { selector: ".collection-answer" }),
  ).toHaveAttribute("lang", "el");

  await user.click(screen.getByRole("button", { name: "Back to collections" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: /^Practice direction/ }),
    "el_to_en",
  );
  await user.click(
    screen.getByRole("button", {
      name: "Practise selected collections",
      exact: true,
    }),
  );
  expect(await screen.findByRole("heading", { name: "σπίτι" })).toHaveAttribute(
    "lang",
    "el",
  );
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  expect(
    await screen.findByText("house", { selector: ".collection-answer" }),
  ).toHaveAttribute("lang", "en");
  expect(directions).toEqual(["en_to_el", "el_to_en"]);
});

test("a reversed legacy snapshot maps prompt and answer by its stored language IDs", async () => {
  const user = userEvent.setup();
  const reversed = {
    ...card,
    source_language: "el",
    target_language: "it",
    source_text: "γεια",
    target_text: "ciao",
  };
  server.use(
    http.post("*/api/sessions", () =>
      HttpResponse.json({
        id: "s",
        cards: [{ position: 0, snapshot: reversed }],
      }),
    ),
    http.post("*/api/sessions/s/cards/0/reveal", () =>
      HttpResponse.json({ revealed: true }),
    ),
  );
  open();
  await user.click(
    await screen.findByLabelText("Select for practice: Greetings"),
  );
  await user.click(
    screen.getByRole("button", {
      name: "Practise selected collections",
      exact: true,
    }),
  );
  expect(await screen.findByRole("heading", { name: "γεια" })).toHaveAttribute(
    "lang",
    "el",
  );
  await user.click(screen.getByRole("button", { name: "Show answer" }));
  expect(
    await screen.findByText("ciao", { selector: ".collection-answer" }),
  ).toHaveAttribute("lang", "it");
});
