import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { AccountContext } from "./AccountContext.jsx";
import Library from "./Library.jsx";
import LegacyClaim from "./LegacyClaim.jsx";
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
  expect(screen.getByRole("combobox", { name: "Unit *" })).toHaveValue("");
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
test.each([
  ["claim_expired", "claimExpired"],
  ["claim_revoked", "claimRevoked"],
  ["claim_used", "claimUsed"],
  ["profile_claimed", "profileClaimed"],
  ["claim_invalid", "claimInvalid"],
])(
  "claim preview displays a distinct %s state without consuming the claim",
  async (code, label) => {
    server.use(
      http.get("*/api/legacy-claims/preview", () =>
        HttpResponse.json({ error: { code } }, { status: 410 }),
      ),
    );
    open(<LegacyClaim text={text} csrf="csrf" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(text[label]);
    expect(
      screen.queryByRole("button", { name: text.claimConfirm }),
    ).not.toBeInTheDocument();
  },
);
test("claim preview requires explicit confirmation and conflicts preserve both profiles", async () => {
  server.use(
    http.get("*/api/legacy-claims/preview", () =>
      HttpResponse.json({
        profile: {
          id: "legacy",
          display_name: "My previous profile",
          review_count: 500,
          session_count: 20,
        },
      }),
    ),
    http.post("*/api/legacy-claims/redeem", async ({ request }) => {
      expect(await request.json()).toEqual({});
      return HttpResponse.json(
        { error: { code: "claim_conflict", report: { current_reviews: 30 } } },
        { status: 409 },
      );
    }),
  );
  open(<LegacyClaim text={text} csrf="csrf" />);
  const user = userEvent.setup();
  await screen.findByText("My previous profile");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: text.claimConfirm }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    text.claimConflict,
  );
  expect(
    screen.getByRole("button", { name: text.claimConfirm }),
  ).toBeDisabled();
});
test("administrator role assignment and bearer-link generation are explicit authorized operations", async () => {
  let role = "learner",
    generated = false;
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
    http.get("*/api/admin/legacy-profiles", () =>
      HttpResponse.json([
        {
          id: "old",
          display_name: "Old learner",
          review_count: 3,
          session_count: 1,
        },
      ]),
    ),
    http.get("*/api/admin/legacy-requests", () => HttpResponse.json([])),
    http.post(
      "*/api/admin/legacy-profiles/old/claim-links",
      async ({ request }) => {
        expect(await request.json()).toEqual({ acknowledge: true });
        generated = true;
        return HttpResponse.json({
          claim_url: "https://lexi.example/claim#token=private",
          expires_at: "2026-11-05T12:00:00Z",
        });
      },
    ),
  );
  open(<Admin text={text} csrf="csrf" />, "admin");
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText(text.role), "editor");
  await waitFor(() => expect(role).toBe("editor"));
  const generate = await screen.findByRole("button", {
    name: text.generateClaim,
  });
  expect(generate).toBeDisabled();
  expect(generated).toBe(false);
  await user.click(screen.getByLabelText(text.claimAcknowledge));
  await user.click(generate);
  expect(await screen.findByLabelText(text.claimLink)).toHaveValue(
    "https://lexi.example/claim#token=private",
  );
  expect(generated).toBe(true);
  expect(
    within(screen.getByRole("article")).getByText(text.claimWarning),
  ).toBeInTheDocument();
});
