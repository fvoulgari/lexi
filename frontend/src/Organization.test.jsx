import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterAll, afterEach, test, expect } from "vitest";
import Library from "./Library.jsx";
import { copy } from "./copy.js";
let lastParams;
const server = setupServer(
 http.get("*/api/profiles", () => HttpResponse.json([])),
  http.get("*/api/units", () =>
    HttpResponse.json([
      { id: "u", code: "003", title: "Travel", sort_order: 3 },
    ]),
  ),
  http.get("*/api/tags", () => HttpResponse.json([{ id: "t", name: "Daily" }])),
  http.get("*/api/vocabulary", ({ request }) => {
    lastParams = new URL(request.url).searchParams;
    return HttpResponse.json({
      items: [
        {
          id: "e",
          italian: lastParams.get("page") === "2" ? "due" : "uno",
          greek: "ένα",
          word_type: "noun",
          unit: {id:"u", code:"003", title:"Travel"},
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
      <MemoryRouter><Library text={text} csrf="csrf" onLocked={() => {}} /></MemoryRouter>
    </QueryClientProvider>,
  );
}
test("combined filters persist through pages and changing search resets page", async () => {
  open();
  const user = userEvent.setup();
  await user.click(screen.getByText("Filters", { exact: true }));
  await user.click(
    await screen.findByRole("checkbox", { name: "003 — Travel" }),
  );
  await user.click(screen.getByRole("checkbox", { name: "No unit" }));
  await user.click(screen.getByRole("checkbox", { name: "Noun" }));
  await user.click(screen.getByRole("checkbox", { name: "Expression" }));
  expect(
    screen.getByText("Filters", { exact: false, selector: "summary" }),
  ).toHaveTextContent("4");
  expect(
    screen.queryByRole("checkbox", { name: "Daily" }),
  ).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Next page" }));
  expect(
    await screen.findByRole("heading", { name: "due" }),
  ).toBeInTheDocument();
  expect(lastParams.getAll("unit_ids")).toEqual(["u"]);
  expect(lastParams.get("no_unit")).toBe("true");
  expect(lastParams.getAll("word_types")).toEqual(["noun", "expression"]);
  expect(lastParams.has("tag_ids")).toBe(false);
  await user.type(screen.getByLabelText("Search Italian or Greek"), "σπίτι");
  await waitFor(() => expect(lastParams.get("q")).toBe("σπίτι"));
  expect(lastParams.get("page")).toBe("1");
  expect(lastParams.get("page_size")).toBe("12");
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(lastParams.has("tag_ids")).toBe(false));
  expect(screen.getByLabelText("Search Italian or Greek")).toHaveValue("");
});

test("create a unit and assign it while tag controls remain hidden", async () => {
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
  await user.click(screen.getByRole("button", { name: "New unit" }));
  await user.type(screen.getByLabelText("Unit code"), "007");
  await user.type(screen.getByLabelText("Title"), "A new chapter");
  expect(screen.queryByLabelText("Order")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New unit" })).toHaveFocus(),
  );
  await user.click(screen.getByText("Filters", { exact: true }));
  await screen.findByRole("checkbox", { name: "007 — A new chapter" });
  expect(
    screen.queryByRole("button", { name: "Create tag" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "New card" }));
  await user.type(screen.getByLabelText("Italian *"), "viaggiare");
  await user.type(screen.getByLabelText("Greek *"), "ταξιδεύω");
  await user.selectOptions(screen.getByLabelText("Word type *"), "verb");
  await user.selectOptions(screen.getByRole("combobox", {name: "Unit *"}), "new-unit");
  expect(
    screen.queryByRole("group", { name: "Assign tags" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(saved?.tag_ids).toEqual([]));
  expect(saved.unit_id).toBe("new-unit");
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
            italian: "casa",
            greek: "σπίτι",
            word_type: "noun",
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
        entry: { id: "e", ...saved },
        duplicate_ids: [],
      });
    }),
  );
  open(copy.it);
  const user = userEvent.setup();
  await user.click(await cardAction("Modifica scheda: casa"));
  expect(screen.getByRole("combobox", {name: "Unità *"})).toHaveValue("u");
  expect(
    screen.queryByRole("group", { name: "Assegna etichette" }),
  ).not.toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", {name: "Unità *"}), "u");
  await user.click(screen.getByRole("button", { name: "Salva scheda" }));
  await waitFor(() => expect(saved?.tag_ids).toEqual(["t"]));
  expect(saved.unit_id).toBe("u");
});

test("failed unit creation retains the draft for retry with Greek labels", async () => {
  let fail = true;
  server.use(
    http.post("*/api/units", async ({ request }) =>
      fail
        ? HttpResponse.error()
        : HttpResponse.json(
            { id: "new", ...(await request.json()) },
            { status: 201 },
          ),
    ),
  );
  open(copy.el);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: copy.el.toolsNewUnit }));
  await user.type(screen.getByLabelText(copy.el.unitCode), "007");

  await user.type(screen.getByLabelText(copy.el.unitTitle), "Ταξίδι");
  await user.click(screen.getByRole("button", { name: "Δημιουργία" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Έλεγξε τη σύνδεσή σου",
  );
  expect(screen.getByLabelText(copy.el.unitTitle)).toHaveValue("Ταξίδι");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Δημιουργία" }));
  await waitFor(() =>
    expect(screen.queryByLabelText(copy.el.unitTitle)).not.toBeInTheDocument(),
  );
});

test("saving the final filtered-page result returns to a valid page and keeps filters", async () => {
  let changed = false;
  server.use(
    http.get("*/api/vocabulary", ({ request }) => {
      const params = new URL(request.url).searchParams;
      lastParams = params;
      const second = params.get("page") === "2";
      return HttpResponse.json({
        total: changed ? 12 : 13,
        items:
          second && changed
            ? []
            : [
                {
                  id: "e",
                  italian: second ? "last" : "first",
                  greek: "ένα",
                  word_type: "noun",
                  unit: {id:"u", code:"003", title:"Travel"},
                  tags: [{ id: "t", name: "Daily" }],
                },
              ],
      });
    }),
    http.patch("*/api/vocabulary/e", async ({ request }) => {
      changed = true;
      return HttpResponse.json({
        entry: { id: "e", ...(await request.json()) },
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
    await screen.findByRole("heading", { name: "first" }),
  ).toBeInTheDocument();
  expect(lastParams.get("page")).toBe("1");
  expect(lastParams.get("page_size")).toBe("12");
  expect(lastParams.has("tag_ids")).toBe(false);
  expect(lastParams.getAll("word_types")).toEqual(["noun"]);
});

async function cardAction(name) {
  const italian = name.split(": ").slice(1).join(": ");
  const summary = await screen.findByLabelText(
    `${name.startsWith("Modifica") ? "Azioni scheda" : "Card actions"}: ${italian}`,
  );
  if (summary.getAttribute("aria-expanded") !== "true") await userEvent.click(summary);
  return screen.getByRole("menuitem", { name });
}

test("library loading, retry and empty results remain accessible", async () => {
  let resolveRequest;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });
  server.use(http.get("*/api/vocabulary", async () => {
    await pending;
    return HttpResponse.json({error: {code: "service_unavailable"}}, {status: 503});
  }));
  open();
  expect(screen.getByRole("status")).toHaveTextContent(copy.en.loading);
  resolveRequest();
  expect(await screen.findByRole("alert")).toHaveTextContent(copy.en.errors.service_unavailable);
  server.use(http.get("*/api/vocabulary", () => HttpResponse.json({items: [], total: 0})));
  await userEvent.click(screen.getByRole("button", {name: "Try again"}));
  expect(await screen.findByRole("heading", {name: "A fresh page"})).toBeInTheDocument();
  expect(screen.queryByRole("button", {name: "Clear filters"})).not.toBeInTheDocument();
});
