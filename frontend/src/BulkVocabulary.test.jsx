import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  test,
  expect,
} from "vitest";
import Library from "./Library.jsx";
import { copy } from "./copy.js";

const units = [
  { id: "u", code: "00", title: "Benvenuti" },
  { id: "v", code: "01", title: "New unit" },
];
let entries, writes;
function matching(request) {
  const params = new URL(request.url).searchParams;
  return entries.filter(
    (entry) =>
      (!params.get("q") || entry.italian.includes(params.get("q"))) &&
      (!params.getAll("unit_ids").length ||
        params.getAll("unit_ids").includes(entry.unit.id)),
  );
}
const server = setupServer(
  http.get("*/api/units", () => HttpResponse.json(units)),
  http.get("*/api/vocabulary", ({ request }) => {
    const items = matching(request),
      page = Number(new URL(request.url).searchParams.get("page"));
    return HttpResponse.json({
      items: items.slice((page - 1) * 12, page * 12),
      total: items.length,
    });
  }),
  http.post("*/api/vocabulary/bulk", async ({ request }) => {
    expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
    const body = await request.json();
    writes.push(body);
    if (body.action === "move")
      entries = entries.map((entry) =>
        body.entry_ids.includes(entry.id)
          ? { ...entry, unit: units.find((unit) => unit.id === body.unit_id) }
          : entry,
      );
    else if (body.entry_ids.includes("e0"))
      return HttpResponse.json(
        { error: { code: "bulk_blocked", entry_ids: ["e0"] } },
        { status: 409 },
      );
    else
      entries = entries.filter((entry) => !body.entry_ids.includes(entry.id));
    return HttpResponse.json({
      count: body.entry_ids.length,
      action: body.action,
    });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  entries = Array.from({ length: 13 }, (_, index) => ({
    id: `e${index}`,
    italian: `carta ${index}`,
    greek: `κάρτα ${index}`,
    word_type: "noun",
    italian_gender: "masculine",
    greek_gender: "neuter",
    unit: units[0],
  }));
  writes = [];
});
function open(text = copy.en) {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Library text={text} csrf="csrf" onLocked={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
async function selectAll(user) {
  await user.click(
    await screen.findByRole("button", { name: "Select cards", exact: true }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Select all on this page" }),
  );
  await screen.findByText("12 cards selected");
}

test("select-all only selects displayed cards and persists across pages and clears on filter changes without an API request", async () => {
  open();
  const user = userEvent.setup();
  await selectAll(user);
  expect(screen.getByText("12 cards selected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  const last = await screen.findByRole("checkbox", {
    name: "Select card: carta 12 — κάρτα 12",
  });
  expect(screen.getByText("12 cards selected")).toBeInTheDocument();
  await user.click(
    screen.getByRole("checkbox", { name: "Select all on this page" }),
  );
  expect(last).toBeChecked();
  expect(screen.getByText("13 cards selected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Previous page" }));
  await screen.findByRole("checkbox", {
    name: "Select card: carta 0 — κάρτα 0",
  });
  expect(screen.getByText("13 cards selected")).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "Select card: carta 0 — κάρτα 0" }),
  ).toBeChecked();
  await user.type(screen.getByRole("searchbox"), "carta 0");
  expect(screen.getByText("0 cards selected")).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getAllByRole("checkbox", { name: /Select card:/ }),
    ).toHaveLength(1),
  );
  const page = screen.getByRole("checkbox", {
    name: "Select all on this page",
  });
  await user.click(page);
  expect(screen.getByText("1 card selected")).toBeInTheDocument();
  await user.click(page);
  expect(screen.getByText("0 cards selected")).toBeInTheDocument();
});

test("move-all uses an explicit destination and restores focus after completion", async () => {
  open();
  const user = userEvent.setup();
  await selectAll(user);
  await user.click(
    screen.getByRole("button", { name: "Move to unit", exact: true }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(
    within(dialog).getByRole("button", { name: "Move to unit" }),
  ).toBeDisabled();
  await user.selectOptions(
    within(dialog).getByLabelText("Destination unit"),
    "v",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Move to unit" }),
  );
  expect(await screen.findByText("12 cards moved.")).toBeInTheDocument();
  expect(writes[0]).toEqual({
    action: "move",
    entry_ids: Array.from({ length: 12 }, (_, i) => `e${i}`),
    unit_id: "v",
  });
  expect(entries.slice(0, 12).every((entry) => entry.unit.id === "v")).toBe(
    true,
  );
  expect(entries[12].unit.id).toBe("u");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New card" })).toHaveFocus(),
  );
});

test("mass delete requires confirmation, Escape restores focus, and unavailable cards are automatically excluded", async () => {
  open();
  const user = userEvent.setup();
  await selectAll(user);
  const trigger = screen.getByRole("button", { name: "Delete selected" });
  await user.click(trigger);
  expect(writes).toEqual([]);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Permanently delete",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Nothing was deleted",
  );
  expect(entries).toHaveLength(13);
  expect(screen.getAllByText("11 cards selected").length).toBeGreaterThan(0);
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Permanently delete",
    }),
  );
  expect(await screen.findByText("11 cards deleted.")).toBeInTheDocument();
  expect(entries.map((entry) => entry.id)).toEqual(["e0", "e12"]);
  expect(writes[1].entry_ids).not.toContain("e0");
});

test("a failed move preserves selection and destination for retry", async () => {
  let fail = true;
  server.use(
    http.post("*/api/vocabulary/bulk", async ({ request }) => {
      const body = await request.json();
      writes.push(body);
      return fail
        ? HttpResponse.error()
        : HttpResponse.json({ count: 12, action: "move" });
    }),
  );
  open();
  const user = userEvent.setup();
  await selectAll(user);
  await user.click(screen.getByRole("button", { name: "Move to unit" }));
  const dialog = screen.getByRole("dialog");
  await user.selectOptions(
    within(dialog).getByLabelText("Destination unit"),
    "v",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Move to unit" }),
  );
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Destination unit")).toHaveValue("v");
  fail = false;
  await user.click(
    within(dialog).getByRole("button", { name: "Move to unit" }),
  );
  expect(await screen.findByText("12 cards moved.")).toBeInTheDocument();
  expect(writes[0]).toEqual(writes[1]);
});

for (const language of ["el", "it"])
  test(`selection controls use ${language} translations`, async () => {
    const text = copy[language];
    open(text);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: text.bulkSelect, exact: true }),
    );
    await user.click(screen.getByRole("checkbox", { name: text.bulkPage }));
    await user.click(screen.getByRole("button", { name: text.bulkDelete }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      text.bulkDeleteTitle,
    );
    expect(screen.getByText(text.bulkDeleteWarning)).toBeInTheDocument();
  });

for (const allBlocked of [false, true])
  test(`blocking cards are excluded automatically (${allBlocked ? "all blocked" : "unavailable cards"})`, async () => {
    server.use(
      http.post("*/api/vocabulary/bulk", async ({ request }) => {
        const body = await request.json();
        writes.push(body);
        return HttpResponse.json(
          {
            error: {
              code: "bulk_blocked",
              entry_ids: allBlocked ? body.entry_ids : ["e0", "e1"],
            },
          },
          { status: 409 },
        );
      }),
    );
    open();
    const user = userEvent.setup();
    await selectAll(user);
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Permanently delete",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      allBlocked
        ? copy.en.errors.bulk_nothing_to_delete
        : copy.en.errors.bulk_selection_updated,
    );
    const count = allBlocked ? 0 : 10;
    expect(
      screen.getAllByText(`${count} cards selected`).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("checkbox", { name: "Select card: carta 0 — κάρτα 0" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select card: carta 1 — κάρτα 1" }),
    ).not.toBeChecked();
    expect(entries).toHaveLength(13);
    expect(writes).toHaveLength(1);
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Permanently delete",
    });
    if (allBlocked) expect(confirm).toBeDisabled();
    else {
      expect(confirm).toBeEnabled();
      expect(
        screen.getByRole("checkbox", {
          name: "Select card: carta 2 — κάρτα 2",
        }),
      ).toBeChecked();
    }
  });

for (const remaining of [12, 13]) {
  test(`deleting on page two stays on the nearest valid page (${remaining} remaining)`, async () => {
    entries = Array.from({ length: remaining + 1 }, (_, index) => ({
      ...entries[0],
      id: `e${index}`,
      italian: `carta ${index}`,
    }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Next page" }));
    await user.click(
      screen.getByRole("button", { name: "Select cards", exact: true }),
    );
    await user.click(
      await screen.findByRole("checkbox", {
        name: "Select card: carta 12 — κάρτα 0",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Permanently delete",
      }),
    );
    await screen.findByText("1 card deleted.");
    expect(
      await screen.findByText(
        `Page ${remaining === 12 ? 1 : 2} of ${remaining === 12 ? 1 : 2}`,
      ),
    ).toBeInTheDocument();
  });
}

for (const remaining of [12, 13]) {
  test(`single deletion keeps the nearest valid page (${remaining} remaining)`, async () => {
    entries = Array.from({ length: remaining + 1 }, (_, index) => ({
      ...entries[0],
      id: `e${index}`,
      italian: `carta ${index}`,
    }));
    server.use(
      http.delete("*/api/vocabulary/:id", ({ params }) => {
        entries = entries.filter((entry) => entry.id !== params.id);
        return HttpResponse.json({ deleted: params.id });
      }),
    );
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Next page" }));
    await user.click(
      await screen.findByRole("button", {
        name: `${copy.en.cardActions}: carta 12`,
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Delete card: carta 12" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(copy.en.deleteWarning);
    await user.click(
      screen.getByRole("button", { name: "Permanently delete" }),
    );
    await screen.findByText("Card deleted.");
    expect(
      await screen.findByText(
        `Page ${remaining === 12 ? 1 : 2} of ${remaining === 12 ? 1 : 2}`,
      ),
    ).toBeInTheDocument();
  });
}

test("bulk deletion submits selected cards from multiple pages", async () => {
  open();
  const user = userEvent.setup();
  await selectAll(user);
  // Leave the unavailable fixture out of this selection.
  await user.click(
    screen.getByRole("checkbox", { name: "Select card: carta 0 — κάρτα 0" }),
  );
  await user.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByRole("checkbox", {
    name: "Select card: carta 12 — κάρτα 12",
  });
  await user.click(
    screen.getByRole("checkbox", { name: "Select all on this page" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete selected" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Permanently delete",
    }),
  );
  await screen.findByText("12 cards deleted.");
  expect(writes[0].entry_ids).toEqual(
    Array.from({ length: 12 }, (_, i) => `e${i + 1}`),
  );
  expect(entries.map((entry) => entry.id)).toEqual(["e0"]);
});

for (const leavesFilter of [false, true]) {
  test(`editing on page two keeps the nearest valid page (leaves filter: ${leavesFilter})`, async () => {
    server.use(
      http.patch("*/api/vocabulary/:id", async ({ request, params }) => {
        const body = await request.json();
        entries = entries.map((entry) =>
          entry.id === params.id ? { ...entry, ...body } : entry,
        );
        return HttpResponse.json({
          entry: entries.find((entry) => entry.id === params.id),
          duplicate_ids: [],
        });
      }),
    );
    open();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Next page" });
    await user.type(screen.getByRole("searchbox"), "carta");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.click(
      await screen.findByRole("button", {
        name: `${copy.en.cardActions}: carta 12`,
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Edit card: carta 12" }),
    );
    await user.clear(screen.getByLabelText("Italian *"));
    await user.type(
      screen.getByLabelText("Italian *"),
      leavesFilter ? "updated" : "carta updated",
    );
    await user.click(screen.getByRole("button", { name: "Save card" }));
    await screen.findByText(/^Card saved\./);
    expect(
      await screen.findByText(leavesFilter ? "Page 1 of 1" : "Page 2 of 2"),
    ).toBeInTheDocument();
    if (!leavesFilter)
      expect(
        screen.getByRole("heading", { name: "carta updated" }),
      ).toBeInTheDocument();
  });
}
