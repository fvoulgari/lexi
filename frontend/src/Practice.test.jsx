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
import { copy } from "./copy.js";
let saves;
let fail;
const server = setupServer(
  http.get("*/api/units", () => HttpResponse.json([{id: "u", code: "00", title: "Benvenuti", card_count: 10}])),
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
  http.get("*/api/profiles/f/progress", () =>
    HttpResponse.json({
      vocabulary_count: 1,
      total_reviews: 0,
      entries_practised: 0,
      difficult_entries: 0,
      counts: { again: 0, hard: 0, easy: 0 },
      directions: [],
      units: [],
      word_types: [],
      recent_session: null,
    }),
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
  expect(await screen.findByText(/Only 1 cards/)).toBeInTheDocument();
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
  expect(await screen.findByText("100%")).toBeInTheDocument();
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
  await chooseDirection(user, "italian_to_greek");
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
  await user.click(screen.getByRole("radio", { name: "All", exact: true }));
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The selected units have no eligible cards",
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
    await screen.findByRole("heading", { name: "Welcome, Foteini" }),
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
  await chooseDirection(user, "italian_to_greek");
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
        no_unit: false,
        word_types: ["noun", "verb"],
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
  await user.click(
    screen.getByRole("radio", { name: "With filters", exact: true }),
  );
  await user.click(await screen.findByLabelText("00 — Benvenuti"));
  await user.click(screen.getByLabelText("Noun"));
  await user.click(screen.getByLabelText("Verb"));
  expect(screen.queryByRole("group", { name: "Tags" })).not.toBeInTheDocument();
  await chooseDirection(user, "italian_to_greek");
  await user.click(screen.getByRole("radio", { name: "10", exact: true }));
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  expect(
    await screen.findByRole("heading", { name: "Category practice" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Only 1 cards/)).toBeInTheDocument();
  expect(screen.getByText("la casa")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reveal answer" }));
  await user.click(await screen.findByRole("button", { name: "Hard" }));
  expect(
    await screen.findByRole("heading", { name: "Session summary" }),
  ).toBeInTheDocument();
  expect(saves).toEqual([{ direction: "italian_to_greek", rating: "hard" }]);
  await user.click(screen.getByRole("button", { name: "Practice Again" }));
  expect(
    screen.getByRole("radio", { name: "Random cards", exact: true }),
  ).toBeChecked();
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
  await user.click(
    screen.getByRole("radio", { name: "With filters", exact: true }),
  );
  await user.click(screen.getByRole("button", { name: "Start practice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Clear filters");
  expect(screen.getByRole("link", { name: "Vocabulary" })).toHaveAttribute(
    "href",
    "/vocabulary",
  );
  await user.click(screen.getByRole("button", { name: "Clear selections" }));
  expect(screen.queryByLabelText("No unit")).not.toBeInTheDocument();
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
  await user.click(
    screen.getByRole("radio", { name: "Difficult cards", exact: true }),
  );
  expect(await screen.findByText("1 available card")).toBeInTheDocument();
  expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  expect(screen.queryByText("View cards")).not.toBeInTheDocument();
  expect(screen.getByText("1 available card").tagName).toBe("SPAN");
  await chooseDirection(user, "italian_to_greek");
  expect(await screen.findByText(/No difficult cards/)).toBeInTheDocument();
  expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  await chooseDirection(user, "greek_to_italian");
  await screen.findByText("1 available card");
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

test.each(["reveal", "reviews"])(
  "a deleted card at %s is skipped with an adjusted count and the remaining queue preserved",
  async (stage) => {
    server.use(
      http.post("*/api/sessions", () =>
        HttpResponse.json({
          id: "s",
          requested_size: 10,
          available: 2,
          cards: [
            {
              position: 0,
              entry_id: "e",
              snapshot: { italian: "la casa", greek: "το σπίτι" },
            },
            {
              position: 1,
              entry_id: "b",
              snapshot: { italian: "il libro", greek: "το βιβλίο" },
            },
          ],
        }),
      ),
      http.post(`*/api/sessions/s/cards/0/${stage}`, () =>
        HttpResponse.json(
          { error: { code: "entry_deleted" } },
          { status: 409 },
        ),
      ),
      http.post("*/api/sessions/s/cards/1/reveal", () =>
        HttpResponse.json({ revealed: true }),
      ),
      http.post("*/api/sessions/s/cards/1/reviews", () =>
        HttpResponse.json({ id: "r1" }),
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
    if (stage === "reviews")
      await user.click(await screen.findByRole("button", { name: "Hard" }));
    expect(
      await screen.findByText(
        /It was skipped and the session count was adjusted/,
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText("το βιβλίο")).toBeInTheDocument();
    expect(screen.getByText("Foteini · 1 / 1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Finish and see summary" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Reveal answer" }));
    await user.click(await screen.findByRole("button", { name: "Easy" }));
    expect(
      await screen.findByRole("heading", { name: "Session summary" }),
    ).toBeInTheDocument();
  },
);

test("deleting the final unreviewed card reaches a zero-review summary with an explanation", async () => {
  server.use(
    http.post("*/api/sessions/s/cards/0/reveal", () =>
      HttpResponse.json({ error: { code: "entry_deleted" } }, { status: 409 }),
    ),
    http.get("*/api/sessions/s/summary", () =>
      HttpResponse.json({
        total: 0,
        counts: { again: 0, hard: 0, easy: 0 },
        remembered: 0,
        needs_practice: [],
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
  expect(
    await screen.findByRole("heading", { name: "Session summary" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/It was skipped/)).toBeInTheDocument();
  expect(screen.getByText("0%")).toBeInTheDocument();
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
  await user.click(
    screen.getByRole("radio", { name: "Mixed practice", exact: true }),
  );
  await user.click(screen.getByRole("radio", { name: "All", exact: true }));
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

async function chooseDirection(user, value) {
  const group = screen.queryByRole("group", { name: "Practice direction" });
  if (group) {
    await user.click(
      screen.getByRole("radio", {
        name:
          value === "greek_to_italian" ? "Greek → Italian" : "Italian → Greek",
        exact: true,
      }),
    );
  } else {
    await user.selectOptions(
      screen.getByLabelText("Learning direction"),
      value,
    );
  }
}

test("setup uses numeric profile defaults, resets with the learner and never submits hidden tags", async () => {
  let tagRequests = 0;
  let submissions = 0;
  let payload;
  server.use(
    http.get("*/api/profiles", () =>
      HttpResponse.json([
        {
          id: "f",
          display_name: "Foteini",

        preferred_direction: "greek_to_italian",
          default_session_size: 50,
        },
        {
          id: "s",
          display_name: "Spyros",

        preferred_direction: "italian_to_greek",
          default_session_size: null,
        },
      ]),
    ),
    http.get("*/api/units", () =>
      HttpResponse.json([{ id: "u", code: "00", title: "Benvenuti" }]),
    ),
    http.get("*/api/tags", () => {
      tagRequests++;
      return HttpResponse.json([]);
    }),
    http.post("*/api/sessions", async ({ request }) => {
      submissions++;
      payload = await request.json();
      return HttpResponse.json(
        { error: { code: "no_matches" } },
        { status: 409 },
      );
    }),
  );
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Learner profile"),
    "f",
  );
  expect(screen.getByRole("radio", { name: "50", exact: true })).toBeChecked();
  expect(
    screen.getByRole("radio", { name: "Greek → Italian", exact: true }),
  ).toBeChecked();
  await user.click(
    screen.getByRole("radio", { name: "With filters", exact: true }),
  );
  await user.click(await screen.findByLabelText("00 — Benvenuti"));
  await user.click(screen.getByRole("radio", { name: "10", exact: true }));
  await user.selectOptions(screen.getByLabelText("Learner profile"), "s");
  expect(
    screen.getByRole("radio", { name: "Random cards", exact: true }),
  ).toBeChecked();
  expect(
    screen.getByRole("radio", { name: "Italian → Greek", exact: true }),
  ).toBeChecked();
  expect(screen.getByRole("radio", { name: "All", exact: true })).toBeChecked();
  expect(submissions).toBe(0);
  await user.click(
    screen.getByRole("radio", { name: "With filters", exact: true }),
  );
  expect(screen.getByLabelText("00 — Benvenuti")).not.toBeChecked();
  await user.click(
    screen.getByRole("button", { name: "Start practice", exact: true }),
  );
  await screen.findByRole("alert");
  expect(payload).toEqual({
    profile_id: "s",
    direction: "italian_to_greek",
    size: null,
    unit_ids: [],
    no_unit: false,
    word_types: [],
  });
  expect(submissions).toBe(1);
  expect(tagRequests).toBe(0);
});

test.each([
  ["el", 1, "1 διαθέσιμη κάρτα"], ["el", 4, "4 διαθέσιμες κάρτες"],
  ["en", 1, "1 available card"], ["en", 4, "4 available cards"],
  ["it", 1, "1 scheda disponibile"], ["it", 4, "4 schede disponibili"],
])("available-card badge uses the query count in %s (%s)", async (language, count, expected) => {
  server.use(http.get("*/api/profiles/f/difficult-entries", () => HttpResponse.json(
    Array.from({length: count}, (_,i) => ({entry:{id:String(i), italian:"casa", greek:"σπίτι"}}))
  )));
  localStorage.setItem("notebook-language", language);
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText(copy[language].profile), "f");
  await user.click(screen.getByRole("radio", {name:copy[language].setupDifficultPractice, exact:true}));
  expect(await screen.findByText(expected)).toBeVisible();
});

test("direction loading, failure, retry and a different learner never retain another count", async () => {
  let finish;
  const pending = new Promise(resolve => {finish = resolve;});
  let fail = true;
  server.use(
    http.get("*/api/profiles", () => HttpResponse.json([
      {id:"f", display_name:"Foteini", practice_unit_ids: ["u"],
        preferred_direction:"greek_to_italian", default_session_size:25},
      {id:"s", display_name:"Spyros", practice_unit_ids: ["u"],
        preferred_direction:"greek_to_italian", default_session_size:25},
    ])),
    http.get("*/api/profiles/:id/difficult-entries", async ({request, params}) => {
      if (params.id === "s") return HttpResponse.json([]);
      if (new URL(request.url).searchParams.get("direction") === "greek_to_italian") {
        return HttpResponse.json([{entry:{id:"e",italian:"casa",greek:"σπίτι"}}]);
      }
      await pending;
      return fail ? HttpResponse.json({error:{code:"service_unavailable"}}, {status:503}) : HttpResponse.json([]);
    }),
  );
  openPractice();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Learner profile"), "f");
  await user.click(screen.getByRole("radio", {name:"Difficult cards",exact:true}));
  await screen.findByText("1 available card");
  await chooseDirection(user, "italian_to_greek");
  expect(screen.queryByText("1 available card")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(copy.en.loading);
  finish();
  expect(await screen.findByRole("alert")).toHaveTextContent(copy.en.errors.service_unavailable);
  expect(screen.queryByText("1 available card")).not.toBeInTheDocument();
  fail = false;
  await user.click(screen.getByRole("button", {name:"Try again"}));
  await screen.findByText(copy.en.noDifficultEntries);
  expect(screen.queryByText(/available card/)).not.toBeInTheDocument();
  await chooseDirection(user, "greek_to_italian");
  await screen.findByText("1 available card");
  await user.selectOptions(screen.getByLabelText("Learner profile"), "s");
  expect(screen.queryByText("1 available card")).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", {name:"Difficult cards",exact:true}));
  await screen.findByText(copy.en.noDifficultEntries);
  expect(screen.queryByText(/available card/)).not.toBeInTheDocument();
});

test("all shared units can be selected directly without profile assignment", async () => {
  server.use(
    http.get("*/api/profiles", () => HttpResponse.json([{id:"f", display_name:"Foteini", preferred_direction:"greek_to_italian", default_session_size:25}])),
    http.get("*/api/units", () => HttpResponse.json([{id:"u",code:"00",title:"Benvenuti"},{id:"v",code:"01",title:"Un nuovo inizio"}])),
    http.post("*/api/sessions", async ({request}) => {
      const body = await request.json();
      expect(body.unit_ids).toEqual(["v"]);
      expect(body.word_types).toEqual(["noun"]);
      return HttpResponse.json({id:"s", requested_size:25, available:1, cards:[{position:0,snapshot:{italian:"casa",greek:"σπίτι"}}]});
    })
  );
  localStorage.setItem("notebook-profile", "f");
  openPractice();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("radio", {name:"With filters",exact:true}));
  expect(await screen.findByLabelText("00 — Benvenuti")).toBeInTheDocument();
  await user.click(screen.getByLabelText("01 — Un nuovo inizio"));
  await user.click(screen.getByLabelText("Noun"));
  expect(screen.queryByRole("link", {name:"Practice units"})).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", {name:"Start practice"}));
  expect(await screen.findByRole("button", {name:"Reveal answer"})).toBeInTheDocument();
});
