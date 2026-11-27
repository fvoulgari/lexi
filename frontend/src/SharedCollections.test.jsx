import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import SharedCollections from "./SharedCollections.jsx";
import { collectionCopy } from "./collection-copy.js";

const own = {
  id: "one",
  name: "Greetings",
  source_language: "el",
  target_language: "it",
  visibility: "private",
  can_edit: true,
  card_count: 1,
};
const danish = {
  id: "two",
  name: "Hilsen",
  source_language: "en",
  target_language: "da",
  visibility: "private",
  can_edit: true,
  card_count: 2,
};
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  window.history.pushState({}, "", "/");
});
afterAll(() => server.close());

function open(language = "en", collections = [own]) {
  server.use(
    http.get("*/api/collections", () => HttpResponse.json(collections)),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <SharedCollections csrf="csrf" language={language} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("the page manages collections without details, open links, practice selection or practice controls", async () => {
  open();
  expect(
    await screen.findByRole("heading", { name: "Greetings" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Details" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", { name: /Select for practice/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Practise selected collections" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      "Select collections with the same language pair to practise together.",
    ),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Language pair" })).toHaveValue(
    "",
  );
});

test("the pair filter lists the user's pairs and defaults to all collections", async () => {
  const user = userEvent.setup();
  open("en", [own, danish]);
  await screen.findByRole("heading", { name: "Hilsen" });
  const filter = screen.getByRole("combobox", { name: "Language pair" });
  expect([...filter.options].map((option) => option.textContent)).toEqual([
    "All language pairs",
    "Greek ↔ Italian",
    "English ↔ Danish",
  ]);
  expect(
    await screen.findByRole("heading", { name: "Hilsen" }),
  ).toBeInTheDocument();
  await user.selectOptions(filter, "da-en");
  expect(
    screen.queryByRole("heading", { name: "Greetings" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Hilsen" })).toBeInTheDocument();
  await user.selectOptions(filter, "");
  expect(
    screen.getByRole("heading", { name: "Greetings" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Hilsen" })).toBeInTheDocument();
});

test("Edit collection opens a dialog and saves with the owner's language pair", async () => {
  const user = userEvent.setup();
  let patched;
  server.use(
    http.patch("*/api/collections/one", async ({ request }) => {
      patched = await request.json();
      return HttpResponse.json({ ...own, name: patched.name });
    }),
  );
  open();
  await user.click(
    await screen.findByRole("button", { name: "Edit collection" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Edit collection" });
  expect(dialog.querySelector("form")).not.toBeNull();
  const card = screen
    .getByRole("heading", { name: "Greetings", level: 2 })
    .closest("article");
  expect(
    within(card).queryByRole("textbox", { name: "Collection name" }),
  ).toBeNull();
  const input = within(dialog).getByRole("textbox", { name: "Collection name" });
  await user.clear(input);
  await user.type(input, "New name");
  await user.click(
    within(dialog).getByRole("button", { name: "Save", exact: true }),
  );
  await waitFor(() =>
    expect(patched).toEqual({
      name: "New name",
      source_language: "el",
      target_language: "it",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Edit collection" }),
    ).toBeNull(),
  );
});

test("the edit dialog publishes through the preview confirmation", async () => {
  const user = userEvent.setup();
  let published;
  server.use(
    http.get("*/api/collections/one/publish-preview", () =>
      HttpResponse.json({
        ...own,
        private_cards: [{ id: "ciao" }],
        preview_token: "revision",
      }),
    ),
    http.post("*/api/collections/one/publish", async ({ request }) => {
      published = await request.json();
      return HttpResponse.json({ ...own, visibility: "published" });
    }),
  );
  open();
  await user.click(
    await screen.findByRole("button", { name: "Edit collection" }),
  );
  const editor = await screen.findByRole("dialog", { name: "Edit collection" });
  const visibility = within(editor).getByRole("switch", {
    name: "Collection visibility",
  });
  expect(visibility).not.toBeChecked();
  await user.click(visibility);
  const dialog = await screen.findByRole("dialog", {
    name: collectionCopy.en.publicationTitle,
  });
  expect(dialog).toHaveTextContent("Greetings");
  expect(dialog).not.toHaveTextContent("ciao");
  await user.click(
    within(dialog).getByRole("button", {
      name: collectionCopy.en.publishAction,
    }),
  );
  await waitFor(() =>
    expect(published).toEqual({
      preview_token: "revision",
      confirm_private_ids: ["ciao"],
    }),
  );
});

test("unpublishing from the edit dialog keeps its exposure review", async () => {
  const user = userEvent.setup();
  let unpublished = false;
  server.use(
    http.get("*/api/collections/one/unpublish-preview", () =>
      HttpResponse.json({
        ...own,
        visibility: "published",
        private_cards: [{ id: "ciao" }],
        still_shared_cards: [],
      }),
    ),
    http.post("*/api/collections/one/unpublish", () => {
      unpublished = true;
      return HttpResponse.json({ ...own, visibility: "private" });
    }),
  );
  open("en", [{ ...own, visibility: "published" }]);
  await user.click(
    await screen.findByRole("button", { name: "Edit collection" }),
  );
  const editor = await screen.findByRole("dialog", { name: "Edit collection" });
  await user.click(
    within(editor).getByRole("switch", { name: "Collection visibility" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Confirm unpublishing",
  });
  expect(dialog).toHaveTextContent("will be hidden from other learners");
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm unpublishing" }),
  );
  await waitFor(() => expect(unpublished).toBe(true));
});

test("a failed publication stays open so it can be retried", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/collections/one/publish-preview", () =>
      HttpResponse.json({
        ...own,
        private_cards: [{ id: "ciao" }],
        preview_token: "stale",
      }),
    ),
    http.post("*/api/collections/one/publish", () =>
      HttpResponse.json({ error: { code: "request_failed" } }, { status: 409 }),
    ),
  );
  open();
  await user.click(
    await screen.findByRole("button", { name: "Edit collection" }),
  );
  const editor = await screen.findByRole("dialog", { name: "Edit collection" });
  await user.click(
    within(editor).getByRole("switch", { name: "Collection visibility" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: collectionCopy.en.publicationTitle,
  });
  await user.click(
    within(dialog).getByRole("button", {
      name: collectionCopy.en.publishAction,
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    collectionCopy.en.error,
  );
  expect(
    screen.getByRole("dialog", { name: collectionCopy.en.publicationTitle }),
  ).toBeInTheDocument();
});

test("delete is confirmed by name before the collection is removed", async () => {
  const user = userEvent.setup();
  let deleted = false;
  server.use(
    http.delete("*/api/collections/one", ({ request }) => {
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      deleted = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  open();
  await user.click(
    await screen.findByRole("button", { name: "Edit collection" }),
  );
  const editor = await screen.findByRole("dialog", { name: "Edit collection" });
  await user.click(
    within(editor).getByRole("button", { name: "Delete collection" }),
  );
  const dialog = screen.getByRole("dialog", {
    name: "Delete collection · Greetings",
  });
  expect(dialog).toHaveTextContent(collectionCopy.en.deleteEffect);
  expect(deleted).toBe(false);
  await user.click(
    within(dialog).getByRole("button", { name: "Yes, delete collection" }),
  );
  await waitFor(() => expect(deleted).toBe(true));
});

test("read-only collections have no edit or delete controls but can still be saved", async () => {
  const user = userEvent.setup();
  const shared = {
    ...own,
    can_edit: false,
    visibility: "published",
    owner_name: "Alba",
  };
  let saved = false;
  open("en", [shared]);
  server.use(
    http.get("*/api/collections", () =>
      HttpResponse.json([{ ...shared, saved }]),
    ),
    http.put("*/api/collections/one/saved", () => {
      saved = true;
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("*/api/collections/one/saved", () => {
      saved = false;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await user.click(screen.getByRole("button", { name: "Shared library" }));
  await user.click(
    await screen.findByRole("button", { name: "Add to my collections" }),
  );
  await screen.findByRole("button", { name: "Remove from my collections" });
  expect(
    screen.queryByRole("button", { name: "Edit collection" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete collection" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "My collections" }));
  expect(screen.getByText("By Alba")).toBeInTheDocument();
  expect(screen.getByText("Saved")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Remove from my collections" }),
  );
  await waitFor(() => expect(saved).toBe(false));
});

async function chooseLanguage(user, scope, label, name) {
  const input = scope.getByRole("combobox", { name: label });
  await user.click(input);
  await user.type(input, name);
  const listbox = await screen.findByRole("listbox");
  await user.click(
    await within(listbox).findByRole("option", {
      name: new RegExp(`^${name}`),
    }),
  );
}

test("creation opens the shared CSV dialog and requires a pair from all available languages", async () => {
  const user = userEvent.setup();
  let createdBody;
  const created = { ...own, id: "created", name: "New collection" };
  server.use(
    http.post("*/api/collections", async ({ request }) => {
      createdBody = await request.json();
      return HttpResponse.json(created);
    }),
    http.get("*/api/collections", () =>
      HttpResponse.json([own, danish, created]),
    ),
  );
  open("en", [own, danish]);
  await screen.findByRole("heading", { name: "Hilsen" });
  await user.click(screen.getByRole("button", { name: "Create collection" }));
  const dialog = await screen.findByRole("dialog", {
    name: collectionCopy.en.toolsImport,
  });
  expect(
    within(dialog).getByRole("radio", { name: "New collection" }),
  ).toBeChecked();
  const base = within(dialog).getByRole("combobox", { name: "Base language" });
  const learning = within(dialog).getByRole("combobox", {
    name: "Learning language",
  });
  expect(base).toHaveValue("");
  expect(learning).toHaveValue("");
  expect(
    within(dialog).getByRole("button", { name: "Create collection" }),
  ).toBeDisabled();
  await user.type(
    within(dialog).getByRole("textbox", { name: "Collection name" }),
    "New collection",
  );
  await chooseLanguage(user, within(dialog), "Base language", "English");
  await chooseLanguage(user, within(dialog), "Learning language", "Danish");
  await user.click(within(dialog).getByRole("radio", { name: "Public" }));
  await user.click(
    within(dialog).getByRole("button", { name: "Create collection" }),
  );
  await waitFor(() =>
    expect(createdBody).toEqual({
      name: "New collection",
      source_language: "en",
      target_language: "da",
      make_public: true,
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: collectionCopy.en.toolsImport }),
    ).toBeNull(),
  );
});

test.each(["el", "it"])(
  "the management controls are localized in %s",
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
      await screen.findByRole("button", {
        name: t.editCollection,
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: t.pair, exact: true }),
    ).toBeInTheDocument();
  },
);
