import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterAll, afterEach, test, expect } from "vitest";
import Library from "./Library.jsx";
import { copy } from "./copy.js";
let lastParams;
const server = setupServer(
  http.get("*/api/collections", () =>
    HttpResponse.json([
      {
        id: "c",
        name: "Travel",
        card_count: 13,
        can_edit: true,
        source_language: "it",
        target_language: "el",
      },
    ]),
  ),
  http.patch("*/api/account", async ({ request }) =>
    HttpResponse.json(await request.json()),
  ),
  http.get("*/api/profiles", () => HttpResponse.json([])),
  http.get("*/api/units", () =>
    HttpResponse.json([
      { id: "u", code: "003", title: "Travel", sort_order: 3 },
    ]),
  ),
  http.get("*/api/tags", () => HttpResponse.json([{ id: "t", name: "Daily" }])),
  http.get("*/api/vocabulary", ({ request }) => {
    const params = new URL(request.url).searchParams;
    if (params.get("page_size") !== "1") lastParams = params;
    return HttpResponse.json({
      items: [
        {
          id: "e",
          can_edit: true,
          visibility: "private",
          italian: lastParams.get("page") === "2" ? "due" : "uno",
          greek: "ένα",
          word_type: "noun",
          italian_gender: "masculine",
          greek_gender: "neuter",
          unit: { id: "u", code: "003", title: "Travel" },
          tags: [],
        },
      ],
      total: 13,
    });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
function open(text = copy.en) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <Library text={text} csrf="csrf" onLocked={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
test("combined filters persist through pages and changing search resets page", async () => {
  open();
  const user = userEvent.setup();
  const collection = screen.getByRole("combobox", {
    name: "Collection",
    exact: true,
  });
  await within(collection).findByRole("option", { name: "Travel" });
  await user.selectOptions(collection, "c");
  await user.click(screen.getByText("Filters", { exact: true }));
  await user.click(screen.getByRole("checkbox", { name: "Noun" }));
  await user.click(screen.getByRole("checkbox", { name: "Expression" }));
  expect(
    screen.getByText("Filters", { exact: false, selector: "summary" }),
  ).toHaveTextContent("2");
  await user.click(await screen.findByRole("checkbox", { name: "Daily" }));
  await user.click(await screen.findByRole("button", { name: "Next page" }));
  expect(
    await screen.findByRole("heading", { name: "due" }),
  ).toBeInTheDocument();
  expect(lastParams.get("collection_id")).toBe("c");
  expect(lastParams.has("unit_ids")).toBe(false);
  expect(lastParams.getAll("word_types")).toEqual(["noun", "expression"]);
  expect(lastParams.getAll("tag_ids")).toEqual(["t"]);
  await user.type(screen.getByLabelText("Search Italian or Greek"), "σπίτι");
  await waitFor(() => expect(lastParams.get("q")).toBe("σπίτι"));
  expect(lastParams.get("page")).toBe("1");
  expect(lastParams.get("page_size")).toBe("12");
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(lastParams.has("tag_ids")).toBe(false));
  expect(screen.getByLabelText("Search Italian or Greek")).toHaveValue("");
});

test("new cards use collections while tag controls remain hidden", async () => {
  let units = [];
  let tags = [];
  let saved;
  server.use(
    http.get("*/api/units", () => HttpResponse.json(units)),
    http.get("*/api/tags", () => HttpResponse.json(tags)),
    http.post("*/api/units", async ({ request }) => {
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      const unit = { id: "new-unit", ...(await request.json()) };
      units.push(unit);
      return HttpResponse.json(unit, { status: 201 });
    }),
    http.post("*/api/tags", async ({ request }) => {
      const tag = { id: `tag-${tags.length}`, ...(await request.json()) };
      tags.push(tag);
      return HttpResponse.json(tag, { status: 201 });
    }),
    http.post("*/api/vocabulary", async ({ request }) => {
      saved = await request.json();
      return HttpResponse.json(
        { entry: { id: "saved", ...saved }, duplicate_ids: [] },
        { status: 201 },
      );
    }),
  );
  open();
  const user = userEvent.setup();
  expect(
    screen.queryByRole("button", { name: "Create tag" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "New card" }));
  await user.type(screen.getByLabelText("Italian *"), "viaggiare");
  await user.type(screen.getByLabelText("Greek *"), "ταξιδεύω");
  await user.selectOptions(screen.getByLabelText("Word type *"), "verb");
  await user.selectOptions(
    await within(
      screen.getByRole("form", { name: copy.en.addEntry }),
    ).findByLabelText(copy.en.cardCollection),
    "c",
  );
  expect(
    screen.queryByRole("group", { name: "Assign tags" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(saved?.tag_ids).toEqual([]));
  expect(saved.collection_id).toBe("c");
  expect(saved).not.toHaveProperty("unit_id");
  expect(saved.word_type).toBe("verb");
});

test("editing preserves hidden tags while allowing unit changes in Italian", async () => {
  let saved;
  server.use(
    http.get("*/api/vocabulary", () =>
      HttpResponse.json({
        items: [
          {
            id: "e",
            can_edit: true,
            visibility: "private",
            italian: "casa",
            greek: "σπίτι",
            word_type: "noun",
            italian_gender: "masculine",
            greek_gender: "neuter",
            unit: { id: "u", code: "003", title: "Travel" },
            tags: [{ id: "t", name: "Daily" }],
          },
        ],
        total: 1,
      }),
    ),
    http.patch("*/api/vocabulary/e", async ({ request }) => {
      saved = await request.json();
      return HttpResponse.json({
        entry: { id: "e", can_edit: true, visibility: "private", ...saved },
        duplicate_ids: [],
      });
    }),
  );
  open(copy.it);
  const user = userEvent.setup();
  await user.click(await cardAction("Modifica scheda: casa"));
  expect(
    screen.queryByRole("combobox", { name: "Unità *" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Assegna etichette" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Salva scheda" }));
  await waitFor(() => expect(saved?.tag_ids).toEqual(["t"]));
  expect(saved).not.toHaveProperty("unit_id");
});

test("saving the final filtered-page result returns to a valid page and keeps filters", async () => {
  let changed = false;
  let refreshedPageParams;
  server.use(
    http.get("*/api/vocabulary", async ({ request }) => {
      const params = new URL(request.url).searchParams;
      const second = params.get("page") === "2";
      if (changed && !second) {
        // Cached page 1 must not satisfy the assertion before its refresh arrives.
        await new Promise((resolve) => setTimeout(resolve, 100));
        refreshedPageParams = params;
      }
      return HttpResponse.json({
        total: changed ? 12 : 13,
        items:
          second && changed
            ? []
            : [
                {
                  id: "e",
                  can_edit: true,
                  visibility: "private",
                  italian: second
                    ? "last"
                    : changed
                      ? "first after save"
                      : "first",
                  greek: "ένα",
                  word_type: "noun",
                  italian_gender: "masculine",
                  greek_gender: "neuter",
                  unit: { id: "u", code: "003", title: "Travel" },
                  tags: [{ id: "t", name: "Daily" }],
                },
              ],
      });
    }),
    http.patch("*/api/vocabulary/e", async ({ request }) => {
      changed = true;
      return HttpResponse.json({
        entry: {
          id: "e",
          can_edit: true,
          visibility: "private",
          ...(await request.json()),
        },
        duplicate_ids: [],
      });
    }),
  );
  open();
  const user = userEvent.setup();
  await user.click(screen.getByText("Filters", { exact: true }));
  await user.click(await screen.findByRole("checkbox", { name: "Noun" }));
  await user.click(await screen.findByRole("button", { name: "Next page" }));
  await user.click(await cardAction("Edit card: last"));
  await user.click(screen.getByRole("button", { name: "Save card" }));
  expect(
    await screen.findByRole("heading", { name: "first after save" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(refreshedPageParams.get("page")).toBe("1");
  expect(refreshedPageParams.get("page_size")).toBe("12");
  expect(refreshedPageParams.has("tag_ids")).toBe(false);
  expect(refreshedPageParams.getAll("word_types")).toEqual(["noun"]);
});

async function cardAction(name) {
  const italian = name.split(": ").slice(1).join(": ");
  const summary = await screen.findByLabelText(
    `${name.startsWith("Modifica") ? "Azioni scheda" : "Card actions"}: ${italian}`,
  );
  if (summary.getAttribute("aria-expanded") !== "true")
    await userEvent.click(summary);
  return screen.getByRole("menuitem", { name });
}

test("library loading, retry and empty results remain accessible", async () => {
  let resolveRequest;
  const pending = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  server.use(
    http.get("*/api/vocabulary", async () => {
      await pending;
      return HttpResponse.json(
        { error: { code: "service_unavailable" } },
        { status: 503 },
      );
    }),
  );
  open();
  expect(screen.getByRole("status")).toHaveTextContent(copy.en.loading);
  resolveRequest();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    copy.en.errors.service_unavailable,
  );
  server.use(
    http.get("*/api/vocabulary", () =>
      HttpResponse.json({ items: [], total: 0 }),
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "A fresh page" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Clear filters" }),
  ).not.toBeInTheDocument();
});

test("Vocabulary creates and edits cards in a non-legacy collection", async () => {
  const existing = {
    id: "danish-card",
    source_language: "da",
    target_language: "en",
    source_text: "hus",
    target_text: "house",
    word_type: "noun",
    grammar: { da: { gender: "neuter", plural: "huse" } },
    can_edit: true,
    visibility: "private",
    tags: [],
  };
  let created;
  let edited;
  server.use(
    http.get("*/api/collections", () => HttpResponse.json([
      {
        id: "danish",
        name: "Danish vocabulary",
        source_language: "en",
        target_language: "da",
        card_count: 1,
        can_edit: true,
        visibility: "private",
      },
    ])),
    http.get("*/api/vocabulary", () => HttpResponse.json({ items: [existing], total: 1 })),
    http.post("*/api/collections/danish/cards", async ({ request }) => {
      created = await request.json();
      return HttpResponse.json({ ...created, id: "new-card" }, { status: 201 });
    }),
    http.patch("*/api/collections/cards/danish-card", async ({ request }) => {
      edited = await request.json();
      return HttpResponse.json({ ...existing, ...edited });
    }),
  );

  const user = userEvent.setup();
  open();
  const collection = screen.getByRole("combobox", { name: "Collection", exact: true });
  await within(collection).findByRole("option", { name: "Danish vocabulary" });
  await user.selectOptions(collection, "danish");
  await user.click(screen.getByRole("button", { name: "New card" }));
  await user.type(screen.getByRole("textbox", { name: "Danish", exact: true }), "hej");
  await user.type(screen.getByRole("textbox", { name: "English", exact: true }), "hello");
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => expect(created).toMatchObject({
    source_language: "da",
    target_language: "en",
    source_text: "hej",
    target_text: "hello",
  }));
  await screen.findByText("Card saved.", { exact: false });

  await user.click(screen.getByRole("button", { name: `${copy.en.cardActions}: hus` }));
  await user.click(screen.getByRole("menuitem", { name: `${copy.en.editEntry}: hus` }));
  const translation = screen.getByRole("textbox", { name: "English", exact: true });
  await user.clear(translation);
  await user.type(translation, "home");
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => expect(edited).toMatchObject({
    source_language: "da",
    target_language: "en",
    source_text: "hus",
    target_text: "home",
    grammar: { da: { gender: "neuter", plural: "huse" } },
  }));
});
