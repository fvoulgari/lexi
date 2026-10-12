import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "vitest";
import App from "./App.jsx";

let authenticated = false;
const server = setupServer(
  http.get("*/api/auth/session", () =>
    HttpResponse.json({ authenticated, csrf_token: "test-csrf" }),
  ),
  http.post("*/api/auth/login", async ({ request }) => {
    const body = await request.json();
    if (body.password !== "our-notebook-password") {
      return HttpResponse.json(
        { error: { code: "incorrect_password" } },
        { status: 401 },
      );
    }
    expect(request.headers.get("X-CSRF-Token")).toBe("test-csrf");
    authenticated = true;
    return HttpResponse.json({ authenticated });
  }),
  http.get("*/api/units", () => HttpResponse.json([])),
  http.get("*/api/tags", () => HttpResponse.json([])),
  http.get("*/api/vocabulary", () =>
    HttpResponse.json({ items: [], total: 0, page: 1, page_size: 6 }),
  ),
  http.post("*/api/auth/logout", () => {
    authenticated = false;
    return HttpResponse.json({ authenticated });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  authenticated = false;
  localStorage.clear();
  localStorage.setItem("notebook-language", "en");
});

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/vocabulary"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("a learner enters the shared password before seeing the library", async () => {
  renderApp();
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("Shared password"),
    "our-notebook-password",
  );
  await user.click(screen.getByRole("button", { name: "Open my notebook" }));
  expect(
    await screen.findByRole("heading", { name: "Your vocabulary notebook" }),
  ).toBeInTheDocument();
});

test("a learner browses entries loaded from the API and moves to the next page", async () => {
  authenticated = true;
  server.use(
    http.get("*/api/vocabulary", ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get("page") || 1);
      return HttpResponse.json({
        page,
        page_size: 6,
        total: 7,
        items:
          page === 1
            ? [
                {
                  id: "house",
                  italian: "la casa",
                  greek: "το σπίτι",
                  word_type: "noun",
                  unit: { code: "00", title: "Benvenuti" },
                },
              ]
            : [
                {
                  id: "book",
                  italian: "il libro",
                  greek: "το βιβλίο",
                  word_type: "noun",
                  unit: { code: "00", title: "Benvenuti" },
                },
              ],
      });
    }),
  );
  renderApp();
  const user = userEvent.setup();
  expect(await screen.findByText("la casa")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByText("il libro")).toBeInTheDocument();
  expect(screen.queryByText("la casa")).not.toBeInTheDocument();
});

test("an incorrect password shows an error without revealing the library", async () => {
  renderApp();
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("Shared password"),
    "wrong-password",
  );
  await user.click(screen.getByRole("button", { name: "Open my notebook" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That password isn’t quite right. Try again.",
  );
  expect(
    screen.queryByRole("heading", { name: "Your vocabulary notebook" }),
  ).not.toBeInTheDocument();
});

test("locking the notebook removes the authenticated library", async () => {
  authenticated = true;
  renderApp();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Lock notebook" }),
  );
  expect(await screen.findByLabelText("Shared password")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Your vocabulary notebook" }),
  ).not.toBeInTheDocument();
});

test("a failed library request can be retried without losing access", async () => {
  authenticated = true;
  let failed = true;
  server.use(
    http.get("*/api/vocabulary", () =>
      failed
        ? HttpResponse.error()
        : HttpResponse.json({ items: [], total: 0, page: 1, page_size: 6 }),
    ),
  );
  renderApp();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check your connection",
  );
  failed = false;
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "A fresh page" }),
  ).toBeInTheDocument();
});

test("a revoked session returns the learner to the gate", async () => {
  authenticated = true;
  server.use(
    http.get("*/api/vocabulary", () =>
      HttpResponse.json(
        { error: { code: "authentication_required" } },
        { status: 401 },
      ),
    ),
  );
  renderApp();
  expect(await screen.findByLabelText("Shared password")).toBeInTheDocument();
});

test("interface language can change independently of vocabulary languages", async () => {
  authenticated = true;
  renderApp();
  await screen.findByRole("heading", { name: "Your vocabulary notebook" });
  await userEvent
    .setup()
    .selectOptions(screen.getByLabelText("Interface language"), "it");
  expect(
    screen.getByRole("heading", { name: "Il tuo quaderno di vocaboli" }),
  ).toBeInTheDocument();
  expect(localStorage.getItem("notebook-language")).toBe("it");
  expect(document.documentElement.lang).toBe("it");
});
