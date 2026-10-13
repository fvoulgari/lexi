import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
let saves;
let fail;
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
    ]),
  ),
  http.post("*/api/sessions", () =>
    HttpResponse.json({
      id: "s",
      available: 1,
      requested_size: 25,
      cards: [
        {
          position: 0,
          entry_id: "e",
          snapshot: {
            italian: "la casa",
            word_type: "noun",
            unit: { code: "00", title: "Benvenuti" },
            greek: "το σπίτι",
            italian_gender: "feminine",
            italian_plural: "le case",
            pronunciation: "KA-za",
            notes: "welcome",
          },
        },
      ],
    }),
  ),
  http.post("*/api/sessions/s/cards/0/reveal", () =>
    HttpResponse.json({ revealed: true }),
  ),
  http.post("*/api/sessions/s/cards/0/reviews", async ({ request }) => {
    expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
    saves.push(await request.json());
    if (fail)
      return HttpResponse.json(
        { error: { code: "service_unavailable" } },
        { status: 503 },
      );
    return HttpResponse.json({ id: "r" });
  }),
  http.get("*/api/sessions/s/summary", () =>
    HttpResponse.json({
      total: 1,
      counts: { again: 0, hard: 1, easy: 0 },
      remembered: 100,
      needs_practice: [],
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("notebook-language", "en");
  saves = [];
  fail = false;
});
function openPractice() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/practice"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
test("keyboard reveal conceals hints and a failed save retries before advancing to summary", async () => {
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  expect(await screen.findByText(/Only 1 entries/)).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: "Greek → Italian" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: "Italian → Greek" }),
  ).toBeInTheDocument();
  expect(screen.getByText("00 · Benvenuti")).toBeInTheDocument();
  expect(screen.getByText("Noun")).toBeInTheDocument();
  expect(screen.queryByText("la casa")).not.toBeInTheDocument();
  expect(screen.queryByText("welcome")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Hard" })).toBeDisabled();
  const reveal = screen.getByRole("button", { name: /Reveal answer/ });
  reveal.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByText("la casa")).toBeInTheDocument();
  expect(screen.getByText("KA-za")).toBeInTheDocument();
  expect(screen.getByText("welcome")).toBeInTheDocument();
  fail = true;
  await user.click(screen.getByRole("button", { name: "Hard" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("la casa")).toBeInTheDocument();
  expect(screen.getByText("Selected rating: Hard")).toBeInTheDocument();
  expect(screen.getByLabelText("Learning direction")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Finish and see summary" }),
  ).toBeDisabled();
  fail = false;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("heading", { name: "Session summary" }),
  ).toBeInTheDocument();
  expect(screen.getByText("100%")).toBeInTheDocument();
  expect(saves).toEqual([
    { direction: "greek_to_italian", rating: "hard" },
    { direction: "greek_to_italian", rating: "hard" },
  ]);
  await user.click(screen.getByRole("button", { name: "Practice Again" }));
  expect(
    await screen.findByRole("button", { name: "Start practice" }),
  ).toBeInTheDocument();
});

test("switching direction retains the queue and requires a fresh reveal", async () => {
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  await user.click(
    await screen.findByRole("button", { name: "Reveal answer" }),
  );
  expect(await screen.findByText("la casa")).toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText("Learning direction"),
    "italian_to_greek",
  );
  expect(screen.getByRole("button", { name: "Hard" })).toBeDisabled();
  expect(screen.queryByText("το σπίτι")).not.toBeInTheDocument();
  expect(screen.queryByText("KA-za")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reveal answer" }));
  await user.click(await screen.findByRole("button", { name: "Easy" }));
  expect(
    await screen.findByRole("heading", { name: "Session summary" }),
  ).toBeInTheDocument();
  expect(saves).toEqual([{ direction: "italian_to_greek", rating: "easy" }]);
});

test("zero matches remain in setup with an explanation", async () => {
  server.use(
    http.post("*/api/sessions", () =>
      HttpResponse.json({ error: { code: "no_matches" } }, { status: 409 }),
    ),
  );
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.selectOptions(screen.getByLabelText("Session size"), "all");
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No vocabulary entries are available",
  );
  expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled();
});

test("finishing without a review is defined and reloading starts fresh setup", async () => {
  server.use(
    http.get("*/api/sessions/s/summary", () =>
      HttpResponse.json({
        total: 0,
        counts: { again: 0, hard: 0, easy: 0 },
        remembered: 0,
        needs_practice: [],
      }),
    ),
  );
  const view = openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  await user.click(
    await screen.findByRole("button", { name: "Finish and see summary" }),
  );
  expect(await screen.findByText("0%")).toBeInTheDocument();
  expect(screen.getByText(/No reviews yet/)).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Return Home" }));
  expect(
    await screen.findByRole("heading", { name: "Benvenuti." }),
  ).toBeInTheDocument();
  view.unmount();
  openPractice();
  expect(
    await screen.findByRole("button", { name: "Start practice" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Reveal answer" }),
  ).not.toBeInTheDocument();
});

test("ratings stay disabled while reveal or review is saving", async () => {
  let accept;
  server.use(
    http.post(
      "*/api/sessions/s/cards/0/reviews",
      () =>
        new Promise((resolve) => {
          accept = () => resolve(HttpResponse.json({ id: "r" }));
        }),
    ),
  );
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  await user.click(
    await screen.findByRole("button", { name: "Reveal answer" }),
  );
  await user.click(await screen.findByRole("button", { name: "Hard" }));
  expect(await screen.findByText("Saving…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Hard" })).toBeDisabled();
  expect(screen.getByLabelText("Learning direction")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Finish and see summary" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("heading", { name: "Session summary" }),
  ).not.toBeInTheDocument();
  accept();
  expect(
    await screen.findByRole("heading", { name: "Session summary" }),
  ).toBeInTheDocument();
});

test("a lost response retries the selected review before switching the remaining queue", async () => {
  let sessions = 0;
  const accepted = new Map();
  server.use(
    http.post("*/api/sessions", () => {
      sessions += 1;
      return HttpResponse.json({
        id: "s",
        requested_size: 10,
        available: 2,
        cards: [
          { position: 0, snapshot: { italian: "la casa", greek: "το σπίτι" } },
          {
            position: 1,
            snapshot: { italian: "il libro", greek: "το βιβλίο" },
          },
        ],
      });
    }),
    http.post("*/api/sessions/s/cards/:position/reveal", () =>
      HttpResponse.json({ revealed: true }),
    ),
    http.post(
      "*/api/sessions/s/cards/:position/reviews",
      async ({ request, params }) => {
        const body = await request.json();
        saves.push(body);
        const previous = accepted.get(params.position);
        if (previous) {
          expect(body).toEqual(previous);
          return HttpResponse.json({ id: "r0" });
        }
        accepted.set(params.position, body);
        if (params.position === "0") return HttpResponse.error();
        return HttpResponse.json({ id: "r1" });
      },
    ),
  );
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  await user.click(
    await screen.findByRole("button", { name: "Reveal answer" }),
  );
  await user.dblClick(await screen.findByRole("button", { name: "Hard" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(saves).toHaveLength(1);
  expect(screen.getByText("Selected rating: Hard")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "la casa" })).toBeInTheDocument();
  await user.dblClick(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("το βιβλίο")).toBeInTheDocument();
  expect(saves).toHaveLength(2);
  expect(
    screen.getByRole("button", { name: "Finish and see summary" }),
  ).toBeEnabled();
  await user.selectOptions(
    screen.getByLabelText("Learning direction"),
    "italian_to_greek",
  );
  expect(screen.queryByText("το βιβλίο")).not.toBeInTheDocument();
  expect(screen.getByText("il libro")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reveal answer" }));
  await user.click(await screen.findByRole("button", { name: "Easy" }));
  expect(
    await screen.findByRole("heading", { name: "Session summary" }),
  ).toBeInTheDocument();
  expect(sessions).toBe(1);
  expect([...accepted.values()]).toEqual([
    { direction: "greek_to_italian", rating: "hard" },
    { direction: "italian_to_greek", rating: "easy" },
  ]);
});

test("category practice combines selections, explains shortages and reaches summary", async () => {
  server.use(
    http.get("*/api/units", () =>
      HttpResponse.json([{ id: "u", code: "00", title: "Benvenuti" }]),
    ),
    http.get("*/api/tags", () =>
      HttpResponse.json([{ id: "t", name: "Home" }]),
    ),
    http.post("*/api/sessions", async ({ request }) => {
      expect(await request.json()).toEqual({
        profile_id: "f",
        direction: "italian_to_greek",
        size: 10,
        unit_ids: ["u"],
        no_unit: true,
        word_types: ["noun", "verb"],
        tag_ids: ["t"],
      });
      return HttpResponse.json({
        id: "s",
        requested_size: 10,
        available: 1,
        cards: [
          { position: 0, snapshot: { italian: "la casa", greek: "το σπίτι" } },
        ],
      });
    }),
  );
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.selectOptions(screen.getByLabelText("Practice type"), "category");
  await user.click(await screen.findByLabelText("00 — Benvenuti"));
  await user.click(screen.getByLabelText("No unit"));
  await user.click(screen.getByLabelText("Noun"));
  await user.click(screen.getByLabelText("Verb"));
  await user.click(screen.getByLabelText("Home"));
  await user.selectOptions(
    screen.getByLabelText("Learning direction"),
    "italian_to_greek",
  );
  await user.selectOptions(screen.getByLabelText("Session size"), "10");
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  expect(
    await screen.findByRole("heading", { name: "Category practice" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Only 1 entries/)).toBeInTheDocument();
  expect(screen.getByText("la casa")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reveal answer" }));
  await user.click(await screen.findByRole("button", { name: "Hard" }));
  expect(
    await screen.findByRole("heading", { name: "Session summary" }),
  ).toBeInTheDocument();
  expect(saves).toEqual([{ direction: "italian_to_greek", rating: "hard" }]);
  await user.click(screen.getByRole("button", { name: "Practice Again" }));
  expect(screen.getByLabelText("Practice type")).toHaveValue("random");
});

test("empty category selections offer clear filters and library actions", async () => {
  server.use(
    http.get("*/api/units", () => HttpResponse.json([])),
    http.get("*/api/tags", () => HttpResponse.json([])),
    http.post("*/api/sessions", () =>
      HttpResponse.json({ error: { code: "no_matches" } }, { status: 409 }),
    ),
  );
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.selectOptions(screen.getByLabelText("Practice type"), "category");
  await user.click(await screen.findByLabelText("No unit"));
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Clear filters");
  expect(screen.getByRole("link", { name: "Vocabulary" })).toHaveAttribute(
    "href",
    "/vocabulary",
  );
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByLabelText("No unit")).not.toBeChecked();
});

test("difficult selection follows direction and uses the review flow", async () => {
  let selection;
  server.use(
    http.get("*/api/profiles/f/difficult-entries", ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get("direction") ===
          "greek_to_italian"
          ? [
              {
                entry: { id: "e", italian: "la casa", greek: "το σπίτι" },
                difficulty: 0.5,
                reviews: 1,
              },
            ]
          : [],
      ),
    ),
    http.post("*/api/sessions", async ({ request }) => {
      selection = await request.json();
      return HttpResponse.json({
        id: "s",
        available: 1,
        requested_size: 25,
        cards: [
          {
            position: 0,
            entry_id: "e",
            snapshot: { italian: "la casa", greek: "το σπίτι" },
          },
        ],
      });
    }),
  );
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.selectOptions(screen.getByLabelText("Practice type"), "difficult");
  expect(await screen.findByRole("listitem")).toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText("Learning direction"),
    "italian_to_greek",
  );
  expect(await screen.findByText(/No difficult entries/)).toBeInTheDocument();
  expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText("Learning direction"),
    "greek_to_italian",
  );
  await screen.findByRole("listitem");
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  await user.click(
    await screen.findByRole("button", { name: "Reveal answer" }),
  );
  await user.click(await screen.findByRole("button", { name: "Hard" }));
  expect(
    await screen.findByRole("heading", { name: "Session summary" }),
  ).toBeInTheDocument();
  expect(selection).toEqual({
    profile_id: "f",
    direction: "greek_to_italian",
    size: 25,
    mode: "difficult",
  });
});

test("mixed setup follows the reveal, review and summary journey", async () => {
  let body;
  server.use(
    http.post("*/api/sessions", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({
        id: "s",
        available: 1,
        requested_size: null,
        cards: [
          {
            position: 0,
            entry_id: "e",
            snapshot: { italian: "casa", greek: "σπίτι" },
          },
        ],
      });
    }),
  );
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  await user.selectOptions(screen.getByLabelText("Practice type"), "mixed");
  await user.selectOptions(screen.getByLabelText("Session size"), "all");
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  expect(
    await screen.findByRole("heading", { name: "Mixed practice" }),
  ).toBeInTheDocument();
  expect(body).toEqual({
    profile_id: "f",
    direction: "greek_to_italian",
    size: null,
    mode: "mixed",
  });
  await user.click(screen.getByRole("button", { name: "Reveal answer" }));
  await user.click(screen.getByRole("button", { name: "Easy" }));
  expect(
    await screen.findByRole("heading", { name: "Session summary" }),
  ).toBeInTheDocument();
});
