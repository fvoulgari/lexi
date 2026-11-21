import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { AccountContext } from "./AccountContext.jsx";
import Library from "./Library.jsx";
import Admin from "./Admin.jsx";
import { copy } from "./copy.js";
const text = copy.en;
const shared = {
  id: "shared",
  italian: "casa",
  greek: "σπίτι",
  word_type: "noun",
  visibility: "published",
  can_edit: false,
  archived_at: null,
  tags: [],
};
const server = setupServer(
  http.get("*/api/units", () => HttpResponse.json([])),
  http.get("*/api/tags", () => HttpResponse.json([])),
  http.get("*/api/admin/claim-links", () => HttpResponse.json([])),
  http.get("*/api/admin/legacy-resolution-cases", () => HttpResponse.json([])),
  http.get("*/api/collections", () => HttpResponse.json([])),
  http.get("*/api/vocabulary", () =>
    HttpResponse.json({ items: [shared], total: 1 }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
function open(component, role = "learner") {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AccountContext.Provider value={{ id: "me", role, legacy_access: false }}>
        <MemoryRouter>{component}</MemoryRouter>
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
}
function library(role) {
  open(<Library text={text} csrf="csrf" onLocked={vi.fn()} />, role);
}

test("a learner can read shared cards but cannot edit, archive, select or publish them", async () => {
  library();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Card actions: casa" }),
  );
  expect(
    screen.getByRole("menuitem", { name: "Preview card: casa" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("menuitem", { name: "Edit card: casa" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "Archive card: casa" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: text.publish }),
  ).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(
    screen.getByRole("button", { name: text.bulkSelect, exact: true }),
  );
  expect(screen.getByLabelText(/Select card: casa/)).toBeDisabled();
});
test("a personal variant starts a new private card and does not retain a shared unit", async () => {
  library();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: text.personalVariant }),
  );
  expect(screen.queryByLabelText(text.visibility)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Italian *")).toHaveValue("casa");
  expect(
    screen.queryByRole("combobox", { name: "Unit *" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText(text.cardCollection)).toHaveValue("");
  expect(screen.getByRole("button", { name: "Save card" })).toBeInTheDocument();
});
test("private collection membership accepts a 204 response and refetches membership", async () => {
  let member = false;
  server.use(
    http.get("*/api/collections", () =>
      HttpResponse.json([
        { id: "mine", name: "My list", entry_ids: member ? ["shared"] : [] },
      ]),
    ),
    http.post("*/api/collections/mine/entries", async ({ request }) => {
      expect(await request.json()).toEqual({ entry_id: "shared" });
      expect(request.headers.get("rid")).toBe("session");
      member = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  library();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Add to collection: casa"),
    "mine",
  );
  await waitFor(() =>
    expect(
      screen.queryByLabelText("Add to collection: casa"),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
test("archived owned cards can be restored with authorization and are distinct from active cards", async () => {
  let restored = false;
  server.use(
    http.get("*/api/vocabulary", ({ request }) => {
      const archive = new URL(request.url).searchParams.get("archived");
      return HttpResponse.json({
        items:
          archive && !restored
            ? [
                {
                  ...shared,
                  visibility: "private",
                  can_edit: true,
                  archived_at: "2026-01-01",
                },
              ]
            : [],
        total: archive && !restored ? 1 : 0,
      });
    }),
    http.post("*/api/vocabulary/shared/restore", ({ request }) => {
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      restored = true;
      return HttpResponse.json({ ...shared, archived_at: null });
    }),
  );
  library();
  const user = userEvent.setup();
  await screen.findByText(text.empty);
  await user.click(screen.getByLabelText(text.archiveFilter));
  await user.click(await screen.findByRole("button", { name: text.restore }));
  expect(await screen.findByText(text.empty)).toBeVisible();
  expect(restored).toBe(true);
});
test("administrator role assignment remains available", async () => {
  let role = "learner";
  server.use(
    http.get("*/api/admin/accounts", () =>
      HttpResponse.json([
        { id: "a", display_name: "A learner", role, legacy_access: false },
      ]),
    ),
    http.patch("*/api/admin/accounts/a", async ({ request }) => {
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      role = (await request.json()).role;
      return HttpResponse.json({ role });
    }),
  );
  open(<Admin text={text} csrf="csrf" />, "admin");
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText(text.role), "editor");
  await waitFor(() => expect(role).toBe("editor"));
  expect(screen.queryByText(text.adminLegacy)).not.toBeInTheDocument();
});
