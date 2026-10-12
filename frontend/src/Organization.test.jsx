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
          tags: [],
        },
      ],
      total: 7,
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
      <Library text={text} csrf="csrf" onLocked={() => {}} />
    </QueryClientProvider>,
  );
}
test("combined filters persist through pages and changing search resets page", async () => {
  open();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("checkbox", { name: "003 — Travel" }),
  );
  await user.click(screen.getByRole("checkbox", { name: "No unit" }));
  await user.click(screen.getByRole("checkbox", { name: "Noun" }));
  await user.click(screen.getByRole("checkbox", { name: "Expression" }));
  await user.click(screen.getByRole("checkbox", { name: "Daily" }));
  await user.click(await screen.findByRole("button", { name: "Next page" }));
  expect(
    await screen.findByRole("heading", { name: "due" }),
  ).toBeInTheDocument();
  expect(lastParams.getAll("unit_ids")).toEqual(["u"]);
  expect(lastParams.get("no_unit")).toBe("true");
  expect(lastParams.getAll("word_types")).toEqual(["noun", "expression"]);
  expect(lastParams.getAll("tag_ids")).toEqual(["t"]);
  await user.type(screen.getByLabelText("Search Italian or Greek"), "σπίτι");
  await waitFor(() => expect(lastParams.get("q")).toBe("σπίτι"));
  expect(lastParams.get("page")).toBe("1");
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(lastParams.has("tag_ids")).toBe(false));
  expect(screen.getByLabelText("Search Italian or Greek")).toHaveValue("");
});

test("create a unit and tags then assign them independently of word type", async () => {
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
  await user.click(screen.getByRole("button", { name: "Create unit" }));
  await user.type(screen.getByLabelText("Unit code"), "007");
  await user.type(screen.getByLabelText("Title"), "A new chapter");
  await user.clear(screen.getByLabelText("Order"));
  await user.type(screen.getByLabelText("Order"), "7");
  await user.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("checkbox", { name: "007 — A new chapter" });
  for (const name of ["Travel", "Food"]) {
    await user.click(screen.getByRole("button", { name: "Create tag" }));
    await user.type(screen.getByLabelText("Tag name"), name);
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("checkbox", { name });
  }
  await user.click(screen.getByRole("button", { name: "Add entry" }));
  await user.type(screen.getByLabelText("Italian *"), "viaggiare");
  await user.type(screen.getByLabelText("Greek *"), "ταξιδεύω");
  await user.selectOptions(screen.getByLabelText("Word type *"), "verb");
  await user.selectOptions(screen.getByLabelText("Unit"), "new-unit");
  const form = screen.getByRole("group", { name: "Assign tags" });
  const { within } = await import("@testing-library/react");
  await user.click(within(form).getByRole("checkbox", { name: "Travel" }));
  await user.click(within(form).getByRole("checkbox", { name: "Food" }));
  await user.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() => expect(saved?.tag_ids).toEqual(["tag-0", "tag-1"]));
  expect(saved.unit_id).toBe("new-unit");
  expect(saved.word_type).toBe("verb");
});

test("editing retains assignments across languages and clears them on save", async () => {
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
  await user.click(
    await screen.findByRole("button", { name: "Modifica voce: casa" }),
  );
  expect(screen.getByLabelText("Unità")).toHaveValue("u");
  const { within } = await import("@testing-library/react");
  const assignments = within(
    screen.getByRole("group", { name: "Assegna etichette" }),
  );
  expect(assignments.getByRole("checkbox", { name: "Daily" })).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Unità"), "");
  await user.click(assignments.getByRole("checkbox", { name: "Daily" }));
  await user.click(screen.getByRole("button", { name: "Salva voce" }));
  await waitFor(() => expect(saved?.tag_ids).toEqual([]));
  expect(saved.unit_id).toBeNull();
});

test("failed tag creation retains the draft for retry with Greek labels", async () => {
  let fail = true;
  server.use(
    http.post("*/api/tags", async ({ request }) =>
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
  await user.click(screen.getByRole("button", { name: "Δημιουργία ετικέτας" }));
  await user.type(screen.getByLabelText("Όνομα ετικέτας"), "Ταξίδι");
  await user.click(screen.getByRole("button", { name: "Δημιουργία" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Έλεγξε τη σύνδεσή σου",
  );
  expect(screen.getByLabelText("Όνομα ετικέτας")).toHaveValue("Ταξίδι");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Δημιουργία" }));
  await waitFor(() =>
    expect(screen.queryByLabelText("Όνομα ετικέτας")).not.toBeInTheDocument(),
  );
});
