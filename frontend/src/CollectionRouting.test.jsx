import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import Library from "./Library.jsx";
import { collectionCopy } from "./collection-copy.js";
import { copy } from "./copy.js";

const collections = [
  {
    id: "mine",
    name: "Mine",
    visibility: "private",
    can_edit: true,
    can_import: true,
    card_count: 2,
    source_language: "el",
    target_language: "it",
  },
  {
    id: "public",
    name: "Public",
    visibility: "published",
    can_edit: true,
    can_import: true,
    card_count: 3,
    source_language: "el",
    target_language: "it",
  },
  {
    id: "readonly",
    name: "Read only",
    visibility: "published",
    can_edit: false,
    can_save: true,
    card_count: 0,
    source_language: "el",
    target_language: "it",
  },
];

function RouteControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate(-1)}>Back route</button>
      <button onClick={() => navigate(1)}>Forward route</button>
    </div>
  );
}

function renderLibrary(initialEntry) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[initialEntry]}>
        <RouteControls />
        <Routes>
          <Route
            path="/vocabulary"
            element={
              <Library
                text={copy.en}
                language="en"
                csrf="csrf"
                onLocked={() => {}}
              />
            }
          />
          <Route path="/collections" element={<p>Collections page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function mockApi(requests, list = collections) {
  server.use(
    http.get("*/api/collections", () => HttpResponse.json(list)),
    http.get("*/api/vocabulary", ({ request }) => {
      const params = Object.fromEntries(new URL(request.url).searchParams);
      requests.push(params);
      return HttpResponse.json({
        items: [],
        total: params.q || params.archived ? 1 : Number(params.collection_id === "public" ? 3 : params.collection_id === "mine" ? 2 : 0),
      });
    }),
  );
}

test("does not refetch the library on an unchanged initial route", async () => {
  const requests = [];
  mockApi(requests);
  renderLibrary("/vocabulary");

  await waitFor(() => expect(requests.length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(screen.queryByText(copy.en.loading)).not.toBeInTheDocument(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(requests).toHaveLength(1);
});

test("opens the clicked collection from the URL and keeps history, filters, and focus state in sync", async () => {
  const requests = [];
  mockApi(requests);
  const user = userEvent.setup();
  renderLibrary("/vocabulary?collection_id=public");

  expect(
    await screen.findByRole("heading", { name: "Public", exact: true }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(collectionCopy.en.published, {
      selector: ".audience-badge",
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Collection" })).toHaveValue(
    "public",
  );
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ collection_id: "public" }),
  );

  await user.type(screen.getByRole("searchbox", { name: copy.en.search }), "stale");
  await waitFor(() => expect(requests.at(-1).q).toBe("stale"));
  await user.selectOptions(screen.getByRole("combobox", { name: "Collection" }), "mine");
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({
      collection_id: "mine",
      page: "1",
    }),
  );
  expect(requests.at(-1).q).toBeUndefined();
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/vocabulary?collection_id=mine",
  );
  expect(
    await screen.findByRole("heading", { name: "Mine", exact: true }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Back route" }));
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/vocabulary?collection_id=public",
  );
  expect(
    await screen.findByRole("heading", { name: "Public", exact: true }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ collection_id: "public" }),
  );

  await user.click(screen.getByRole("button", { name: "Forward route" }));
  expect(screen.getByRole("combobox", { name: "Collection" })).toHaveValue(
    "mine",
  );
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ collection_id: "mine" }),
  );
});

test("handles unavailable, empty, and read-only collections from the URL", async () => {
  const requests = [];
  mockApi(requests);
  const first = renderLibrary("/vocabulary?collection_id=missing");
  expect(
    await screen.findByRole("alert"),
  ).toHaveTextContent(collectionCopy.en.collectionUnavailable);
  expect(
    within(screen.getByRole("alert")).getByRole("link", {
      name: collectionCopy.en.back,
    }),
  ).toHaveAttribute("href", "/collections");
  expect(
    screen.getByRole("heading", {
      name: collectionCopy.en.allAccessible,
      exact: true,
    }),
  ).toBeInTheDocument();
  first.unmount();

  mockApi(requests);
  renderLibrary("/vocabulary?collection_id=readonly");
  expect(
    await screen.findByRole("heading", { name: "Read only", exact: true }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: copy.en.addEntry }),
  ).toBeDisabled();
  await waitFor(() =>
    expect(screen.getByText("0")).toBeInTheDocument(),
  );
  expect(
    screen.getByText(collectionCopy.en.published, {
      selector: ".audience-badge",
    }),
  ).toBeInTheDocument();
});
