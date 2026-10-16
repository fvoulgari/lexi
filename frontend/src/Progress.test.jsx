import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  test,
  expect,
} from "vitest";
import App from "./App.jsx";

const history = {
  vocabulary_count: 10,
  total_reviews: 3,
  entries_practised: 1,
  difficult_entries: 1,
  counts: { again: 1, hard: 1, easy: 1 },
  directions: [
    {
      key: "greek_to_italian",
      total_reviews: 2,
      entries_practised: 1,
      difficult_entries: 0,
      counts: { again: 1, hard: 0, easy: 1 },
    },
    {
      key: "italian_to_greek",
      total_reviews: 1,
      entries_practised: 1,
      difficult_entries: 1,
      counts: { again: 0, hard: 1, easy: 0 },
    },
  ],
  units: [
    {
      key: "00",
      title: "Benvenuti",
      total_reviews: 3,
      entries_practised: 1,
      counts: { again: 1, hard: 1, easy: 1 },
    },
  ],
  word_types: [
    {
      key: "noun",
      total_reviews: 3,
      entries_practised: 1,
      counts: { again: 1, hard: 1, easy: 1 },
    },
  ],
  recent_session: {
    total_reviews: 1,
    remembered: 100,
    counts: { again: 0, hard: 0, easy: 1 },
    last_reviewed_at: "2026-10-13T10:00:00Z",
  },
};
const server = setupServer(
  http.get("*/api/auth/session", () =>
    HttpResponse.json({ authenticated: true, csrf_token: "csrf" }),
  ),
  http.get("*/api/profiles", () =>
    HttpResponse.json([
      {
        id: "f",
        display_name: "Foteini",
        preferred_direction: "greek_to_italian",
        default_session_size: 25,
      },
      {
        id: "a",
        display_name: "Alex",
        preferred_direction: "italian_to_greek",
        default_session_size: 10,
      },
    ]),
  ),
  http.get("*/api/profiles/:id/progress", ({ params }) =>
    HttpResponse.json(
      params.id === "f"
        ? history
        : {
            ...history,
            total_reviews: 0,
            entries_practised: 0,
            difficult_entries: 0,
            counts: { again: 0, hard: 0, easy: 0 },
            directions: [],
            units: [],
            word_types: [],
            recent_session: null,
          },
    ),
  ),
  http.get("*/api/profiles/:id/difficult-entries", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("notebook-language", "en");
  localStorage.setItem("notebook-profile", "f");
});
function open(path = "/") {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
test("Home greets the selected learner, shows recent recall and opens difficult practice", async () => {
  open();
  expect(
    await screen.findByRole("heading", { name: "Welcome, Foteini" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("100%")).toBeInTheDocument();
  expect(screen.getByText("Recall")).toBeInTheDocument();
  expect(screen.getByText("Vocabulary cards")).toBeInTheDocument();
  const summary = screen.getByText("Vocabulary cards").closest("dl");
  expect(summary.children).toHaveLength(3);
  expect(within(summary).queryByText("Card reviews")).not.toBeInTheDocument();
  expect(within(summary).getByText("Cards practised").nextElementSibling).toHaveTextContent("1");
  const recent = screen.getByRole("region", { name: "Recent practice" });
  expect(within(recent).getByText("Card reviews")).toBeInTheDocument();
  expect(within(recent).queryByText("Percentage of responses rated ‘Easy’ or ‘Hard’ in the latest session.")).not.toBeInTheDocument();

  await userEvent.click(
    screen.getByRole("link", { name: "Practise difficult cards" }),
  );
  expect(await screen.findByLabelText("Practice type")).toHaveValue(
    "difficult",
  );
  expect(screen.getByLabelText("Learner profile")).toHaveValue("f");
});
test("Progress shows separate direction counts and switches to an empty learner without stale history", async () => {
  open("/progress");
  await screen.findByText("Vocabulary cards");
  const summary = screen.getByText("Vocabulary cards").closest("dl");
  expect(summary.children).toHaveLength(4);
  expect(within(summary).getByText("Card reviews").nextElementSibling).toHaveTextContent("3");
  expect(within(summary).getByText("Cards practised").nextElementSibling).toHaveTextContent("1");
  const directions = await screen.findByRole("region", {
    name: "By learning direction",
  });
  expect(
    within(directions).getByRole("heading", { name: "Greek → Italian" }),
  ).toBeInTheDocument();
  expect(
    within(directions).getByRole("heading", { name: "Italian → Greek" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "By unit" })).toHaveTextContent(
    "00 · Benvenuti",
  );
  expect(
    screen.getByRole("region", { name: "By word type" }),
  ).toHaveTextContent("Noun");
  expect(
    screen.getByRole("region", { name: "Rating distribution" }),
  ).toHaveTextContent("Again");
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Learner profile"), "a");
  expect(
    await screen.findByText(
      "No reviews for this learner yet. Start practice to build a history.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("100%")).not.toBeInTheDocument();
  expect(screen.queryByText("00 · Benvenuti")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Practise difficult cards" }),
  ).not.toBeInTheDocument();
  expect(localStorage.getItem("notebook-profile")).toBe("a");
});

test("progress failure offers retry and revoked access returns to the gate", async () => {
  let fail = true;
  server.use(
    http.get("*/api/profiles/:id/progress", () =>
      fail
        ? HttpResponse.json(
            { error: { code: "service_unavailable" } },
            { status: 503 },
          )
        : HttpResponse.json(history),
    ),
  );
  open();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("100%")).toBeInTheDocument();
  server.use(
    http.get("*/api/profiles/:id/progress", () =>
      HttpResponse.json(
        { error: { code: "unauthenticated" } },
        { status: 401 },
      ),
    ),
  );
  await userEvent.selectOptions(screen.getByLabelText("Learner profile"), "a");
  expect(await screen.findByLabelText("Shared password")).toBeInTheDocument();
  expect(screen.queryByText("100%")).not.toBeInTheDocument();
});

test("missing remembered learner prompts selection and does not expose a different history", async () => {
  localStorage.setItem("notebook-profile", "removed");
  open("/progress");
  expect(
    await screen.findByText(
      "The remembered learner is no longer available. Choose a profile.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Learner profile")).toHaveValue("");
  expect(screen.queryByText("100%")).not.toBeInTheDocument();
});

test("Greek home uses friendly card labels and explains session recall", async () => {
  localStorage.setItem("notebook-language", "el");
  open();
  await screen.findByText("Κάρτες λεξιλογίου");
  expect(screen.getByText("Κάρτες που εξασκήθηκαν")).toBeInTheDocument();
  const recent = screen.getByRole("region", { name: "Πρόσφατη εξάσκηση" });
  expect(within(recent).getByText("Επαναλήψεις καρτών")).toBeInTheDocument();
  expect(within(recent).getByText("Θυμήθηκες")).toBeInTheDocument();
  expect(within(recent).queryByText("Ποσοστό απαντήσεων “Εύκολο” ή “Δύσκολο” στην τελευταία συνεδρία.")).not.toBeInTheDocument();
});

test("Italian home uses card terminology and explains session recall", async () => {
  localStorage.setItem("notebook-language", "it");
  open();
  await screen.findByText("Schede di vocabolario");
  expect(screen.getByText("Schede esercitate")).toBeInTheDocument();
  const recent = screen.getByRole("region", { name: "Esercizio recente" });
  expect(within(recent).getByText("Ripassi delle schede")).toBeInTheDocument();
  expect(within(recent).getByText("Hai ricordato")).toBeInTheDocument();
  expect(within(recent).queryByText("Percentuale di risposte valutate “Facile” o “Difficile” nell’ultima sessione.")).not.toBeInTheDocument();
});
