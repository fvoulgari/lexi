import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterAll, afterEach, test, expect, vi } from "vitest";
import Library from "./Library.jsx";
import { copy } from "./copy.js";

const server = setupServer(
  http.get("*/api/collections", () =>
    HttpResponse.json([
      {
        id: "one",
        name: "Lezione 01",
        card_count: 14,
        visibility: "private",
        can_edit: true,
      },
    ]),
  ),
  http.get("*/api/vocabulary", ({ request }) =>
    HttpResponse.json({
      items: [],
      total: new URL(request.url).searchParams.has("q") ? 2 : 14,
    }),
  ),
  http.get("*/api/tags", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openLibrary(onLocked = vi.fn()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <Library text={copy.en} csrf="csrf" onLocked={onLocked} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function openExport(user) {
  await user.click(screen.getByRole("button", { name: "Export CSV" }));
  return within(screen.getByRole("dialog", { name: "Export CSV" }));
}

test("exports the whole selected Collection by default and offers a separately counted filtered scope", async () => {
  const requests = [];
  const filenames = [];
  server.use(
    http.get("*/api/vocabulary/export.csv", ({ request }) => {
      requests.push(Object.fromEntries(new URL(request.url).searchParams));
      return new HttpResponse("italian,greek\nandare,πηγαίνω", {
        headers: { "Content-Type": "text/csv" },
      });
    }),
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:export";
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function () {
      filenames.push(this.download);
    },
  );
  const user = openLibrary();
  await screen.findByRole("option", { name: "Lezione 01" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Collection" }),
    "one",
  );
  await user.type(screen.getByRole("searchbox"), "go");
  let dialog = await openExport(user);
  expect(
    dialog.getByRole("radio", { name: /Lezione 01 · 14 cards/ }),
  ).toBeChecked();
  await dialog.findByRole("radio", {
    name: /Current filtered results · 2 cards/,
  });
  await user.click(dialog.getByRole("button", { name: "Export CSV" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("status")).toHaveTextContent(copy.en.exportStarted);

  dialog = await openExport(user);
  await user.click(
    dialog.getByRole("radio", { name: /Current filtered results · 2 cards/ }),
  );
  await user.click(dialog.getByRole("button", { name: "Export CSV" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(requests).toEqual([
    { collection_id: "one", include_ids: "true", format: "v2" },
    { collection_id: "one", q: "go", include_ids: "true", format: "v2" },
  ]);
  expect(filenames).toEqual(["Lezione 01.csv", "Lezione 01.csv"]);
});

test("aggregate export has one scope, keeps errors inside the dialog and handles lost admission", async () => {
  let status = 503;
  server.use(
    http.get("*/api/vocabulary/export.csv", ({ request }) => {
      expect(new URL(request.url).searchParams.has("collection_id")).toBe(
        false,
      );
      return HttpResponse.json(
        { error: { code: "service_unavailable" } },
        { status },
      );
    }),
  );
  const onLocked = vi.fn();
  const user = openLibrary(onLocked);
  const dialog = await openExport(user);
  expect(
    await dialog.findByText("All accessible cards · 14 cards"),
  ).toBeInTheDocument();
  expect(dialog.queryByRole("radio")).toBeNull();
  const button = dialog.getByRole("button", { name: "Export CSV" });
  await user.click(button);
  expect(await dialog.findByRole("alert")).toHaveTextContent(
    copy.en.errors.service_unavailable,
  );
  status = 401;
  await user.click(button);
  await waitFor(() => expect(onLocked).toHaveBeenCalledOnce());
});
