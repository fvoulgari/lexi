import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { AccountContext } from "./AccountContext.jsx";
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
afterEach(() => server.resetHandlers());
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
test("publication shows exact exposure before sending confirmation and stale token", async () => {
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
    await screen.findByRole("button", { name: "Open", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Publish collection",
      exact: true,
    }),
  );
  expect(confirmation).toBeUndefined();
  expect(
    await screen.findByRole("region", { name: "Confirm publication" }),
  ).toHaveTextContent("γεια — ciao");
  await user.click(
    screen.getByRole("button", { name: "Confirm publication", exact: true }),
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
    await screen.findByRole("button", { name: "Open", exact: true }),
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
      await screen.findByRole("button", { name: t.open, exact: true }),
    ).toBeInTheDocument();
  },
);
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
    await screen.findByRole("button", { name: "Open", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Publish collection",
      exact: true,
    }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Confirm publication",
      exact: true,
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    collectionCopy.en.error,
  );
  expect(
    screen.getByRole("region", { name: "Confirm publication" }),
  ).toBeInTheDocument();
});
