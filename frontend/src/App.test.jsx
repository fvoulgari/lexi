import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  vi,
} from "vitest";
import App from "./App.jsx";
import { sendMagicLink, startGoogle, finishAuthentication } from "./auth.js";
vi.mock("./auth.js", () => ({
  sendMagicLink: vi.fn(),
  startGoogle: vi.fn(),
  finishAuthentication: vi.fn(),
  rememberReturn: vi.fn(),
  takeReturn: () => "/",
  notifySessionChanged: vi.fn(),
}));
import { copy } from "./copy.js";

let authenticated = false;
const server = setupServer(
  http.get("*/api/collections", () => HttpResponse.json([])),
  http.patch("*/api/account", async ({ request }) =>
    HttpResponse.json(await request.json()),
  ),
  http.get("*/api/auth/session", () =>
    HttpResponse.json({ authenticated, csrf_token: "test-csrf" }),
  ),
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
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("notebook-language", "en");
});

function renderApp(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
  path = "/vocabulary",
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("public sign-in offers Google and verified email without revealing private content", async () => {
  renderApp();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: copy.en.authGoogle }),
  );
  expect(startGoogle).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("heading", { name: "Your vocabulary" }),
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText(copy.en.authEmail),
    "learner@example.com",
  );
  await user.click(screen.getByRole("button", { name: copy.en.authSend }));
  expect(sendMagicLink).toHaveBeenCalledWith("learner@example.com");
  expect(await screen.findByRole("status")).toHaveTextContent(copy.en.authSent);
  expect(
    screen.getByRole("button", { name: /Send another link/ }),
  ).toBeDisabled();
});

test("provider failure remains recoverable and does not reveal the library", async () => {
  sendMagicLink.mockRejectedValueOnce(new Error("unavailable"));
  renderApp();
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText(copy.en.authEmail),
    "learner@example.com",
  );
  await user.click(screen.getByRole("button", { name: copy.en.authSend }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    copy.en.authUnavailable,
  );
  expect(screen.getByRole("button", { name: copy.en.authSend })).toBeEnabled();
  expect(
    screen.queryByRole("heading", { name: "Your vocabulary" }),
  ).not.toBeInTheDocument();
});

test("a learner browses cards loaded from the API and moves to the next page", async () => {
  authenticated = true;
  server.use(
    http.get("*/api/vocabulary", ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get("page") || 1);
      return HttpResponse.json({
        page,
        page_size: 12,
        total: 13,
        items:
          page === 1
            ? [
                {
                  id: "house",
                  can_edit: true,
                  visibility: "private",
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

test("locking the notebook removes the authenticated library", async () => {
  authenticated = true;
  renderApp();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Your vocabulary" }),
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
  expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
});

test("interface language can change independently of vocabulary languages", async () => {
  authenticated = true;
  renderApp();
  await screen.findByRole("heading", { name: "Your vocabulary" });
  await userEvent
    .setup()
    .selectOptions(screen.getByLabelText("Interface language"), "it");
  expect(
    screen.getByRole("heading", { name: "Il tuo vocabolario" }),
  ).toBeInTheDocument();
  expect(localStorage.getItem("notebook-language")).toBe("it");
  expect(document.documentElement.lang).toBe("it");
});

test("device settings persist without changing learning direction", async () => {
  authenticated = true;
  server.use(
    http.get("*/api/profiles", () =>
      HttpResponse.json([
        {
          id: "foteini",
          display_name: "Foteini",
          preferred_direction: "italian_to_greek",
          default_session_size: 25,
        },
      ]),
    ),
  );
  localStorage.setItem("notebook-profile", "foteini");
  const user = userEvent.setup();
  const first = renderApp();
  await user.click(
    await screen.findByRole("link", { name: "Learners & settings" }),
  );
  expect(await screen.findByLabelText("Practice direction")).toHaveValue(
    "italian_to_greek",
  );
  await user.selectOptions(screen.getByLabelText("App language"), "it");
  expect(screen.getByLabelText("Direzione di esercitazione")).toHaveValue(
    "italian_to_greek",
  );
  first.unmount();
  renderApp();
  await user.click(
    await screen.findByRole("link", { name: "Profili e impostazioni" }),
  );
  expect(screen.getByLabelText("Lingua dell’app")).toHaveValue("it");
  expect(
    await screen.findByLabelText("Direzione di esercitazione"),
  ).toHaveValue("italian_to_greek");
});

test("operating-system reduced motion overrides full motion and updates live", async () => {
  authenticated = true;
  server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
  const media = new EventTarget();
  media.matches = true;
  vi.stubGlobal("matchMedia", () => media);
  try {
    renderApp();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("link", { name: "Learners & settings" }),
    );
    expect(screen.queryByLabelText("Motion effects")).not.toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-motion", "reduce");
    act(() => {
      media.matches = false;
      media.dispatchEvent(new Event("change"));
    });
    expect(document.documentElement).toHaveAttribute("data-motion", "full");
    expect(screen.queryByLabelText("Motion effects")).not.toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("browser language initialises the interface when local preferences are invalid", async () => {
  localStorage.setItem("notebook-language", "unknown");
  localStorage.setItem("notebook-motion", "unknown");
  renderApp();
  expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("en");
});

test("device settings work when browser storage is unavailable", async () => {
  authenticated = true;
  server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  try {
    renderApp();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox"), "en");
    await user.click(
      await screen.findByRole("link", { name: "Learners & settings" }),
    );
    expect(screen.queryByLabelText("Motion effects")).not.toBeInTheDocument();
  } finally {
    get.mockRestore();
    set.mockRestore();
  }
});

test("offline launches show a connection gate and recover online", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  renderApp();
  expect(
    await screen.findByRole("heading", { name: "You’re offline" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  act(() => window.dispatchEvent(new Event("online")));
  expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
});

test("a failed connection gates the notebook even when the browser reports online", async () => {
  server.use(http.get("*/api/auth/session", () => HttpResponse.error()));
  renderApp();
  expect(
    await screen.findByRole("heading", { name: "You’re offline" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  server.resetHandlers();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
});

test.each(["el", "en", "it"])(
  "keyboard navigation focuses the new screen in %s",
  async (language) => {
    authenticated = true;
    localStorage.setItem("notebook-language", language);
    server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
    renderApp();
    const user = userEvent.setup();
    const link = await screen.findByRole("link", {
      name: copy[language].practice,
      exact: true,
    });
    link.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("heading", { name: copy[language].practice }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
  },
);

test("navbar navigation resets scroll without letting focus scroll the page", async () => {
  authenticated = true;
  server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  renderApp();
  const link = await screen.findByRole("link", {
    name: "Practice",
    exact: true,
  });
  const main = screen.getByRole("main");
  const focus = vi.spyOn(main, "focus");
  scroll.mockClear();
  await userEvent.click(link);
  await screen.findByRole("heading", { name: "Practice", exact: true });
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  expect(main).toHaveFocus();
  focus.mockRestore();
  scroll.mockRestore();
});

test("the header contains navigation and the Lexi logo returns to home", async () => {
  authenticated = true;
  server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
  renderApp();
  const header = screen.getByRole("banner");
  await within(header).findByRole("navigation", { name: copy.en.library });
  const logo = within(header).getByRole("link", { name: "Lexi", exact: true });
  expect(logo).toHaveAttribute("href", "/");
  await userEvent.click(logo);
  expect(
    await screen.findByRole("heading", { name: copy.en.homeWelcomeTitle }),
  ).toBeInTheDocument();
  expect(
    within(header).getByRole("link", { name: copy.en.home, exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("mobile navigation follows viewport changes, retains header controls and disappears when locked", async () => {
  authenticated = true;
  const mobile = new EventTarget();
  mobile.matches = true;
  vi.stubGlobal("matchMedia", (query) =>
    query === "(max-width: 760px)"
      ? mobile
      : Object.assign(new EventTarget(), { matches: false }),
  );
  server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
  try {
    renderApp();
    const nav = await screen.findByRole("navigation", {
      name: copy.en.mobileNavigation,
    });
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Lexi" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      within(header).getByLabelText("Interface language"),
    ).toBeInTheDocument();
    expect(within(header).getByLabelText("Sign out")).toHaveClass(
      "mobile-lock",
    );
    act(() => {
      mobile.matches = false;
      mobile.dispatchEvent(new Event("change"));
    });
    expect(
      screen.queryByRole("navigation", { name: copy.en.mobileNavigation }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toHaveClass(
      "mobile-lock",
    );
    act(() => {
      mobile.matches = true;
      mobile.dispatchEvent(new Event("change"));
    });
    await userEvent.click(within(header).getByLabelText("Sign out"));
    await screen.findByLabelText("Email address");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a refetched account identity synchronously replaces private caches", async () => {
  authenticated = true;
  let identity = "a";
  let release;
  server.use(
    http.get("*/api/auth/session", () =>
      HttpResponse.json({
        authenticated: true,
        csrf_token: "csrf",
        account: { id: identity, role: "learner", interface_language: "en" },
      }),
    ),
    http.get("*/api/vocabulary", async () => {
      if (identity === "b")
        await new Promise((resolve) => {
          release = resolve;
        });
      return HttpResponse.json({
        total: 1,
        items: [
          {
            id: identity,
            italian: identity === "a" ? "private-A" : "private-B",
            greek: "λέξη",
            word_type: "noun",
            visibility: "private",
            can_edit: true,
          },
        ],
      });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderApp(client);
  await screen.findByText("private-A");
  identity = "b";
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["session"] });
  });
  await waitFor(() =>
    expect(screen.queryByText("private-A")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(release).toBeTypeOf("function"));
  await act(async () => {
    release();
  });
  expect(await screen.findByText("private-B")).toBeInTheDocument();
  expect(screen.queryByText("private-A")).not.toBeInTheDocument();
});

test("successful legacy claim refreshes the outer account and displays the legacy learner", async () => {
  authenticated = true;
  let profileId = "temporary",
    sessionReads = 0;
  server.use(
    http.get("*/api/auth/session", () => {
      sessionReads++;
      return HttpResponse.json({
        authenticated: true,
        csrf_token: "csrf",
        account: {
          id: "a",
          role: "learner",
          legacy_access: false,
          interface_language: "en",
          profile_id: profileId,
        },
      });
    }),
    http.get("*/api/legacy-claims/preview", () =>
      HttpResponse.json({
        profile: {
          id: "legacy",
          display_name: "Legacy learner",
          review_count: 500,
          session_count: 20,
        },
      }),
    ),
    http.post("*/api/legacy-claims/redeem", () => {
      profileId = "legacy";
      return HttpResponse.json({ status: "claimed" });
    }),
    http.get("*/api/profiles", () =>
      HttpResponse.json([
        {
          id: profileId,
          display_name:
            profileId === "legacy" ? "Legacy learner" : "Temporary learner",
          preferred_direction: "greek_to_italian",
          default_session_size: 25,
        },
      ]),
    ),
    http.get("*/api/profiles/legacy/progress", () =>
      HttpResponse.json({
        vocabulary_count: 1,
        entries_practised: 1,
        total_reviews: 500,
        difficult_entries: 0,
        counts: { again: 0, hard: 0, easy: 500 },
        directions: [],
        units: [],
        word_types: [],
        recent_session: null,
      }),
    ),
  );
  renderApp(undefined, "/claim");
  await userEvent.click(
    await screen.findByRole("button", { name: copy.en.claimConfirm }),
  );
  expect(
    await screen.findByRole("heading", { name: "Welcome, Legacy learner" }),
  ).toBeVisible();
  expect(screen.getByText(copy.en.claimDone)).toBeVisible();
  await waitFor(() => expect(sessionReads).toBeGreaterThan(1));
  expect(screen.queryByText("Temporary learner")).not.toBeInTheDocument();
});

test("Google callback completes even when an earlier account session already exists", async () => {
  authenticated = true;
  finishAuthentication.mockResolvedValueOnce(undefined);
  window.history.replaceState(
    null,
    "",
    "/auth/callback/google?code=provider-code&state=sdk-state",
  );
  server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
  try {
    renderApp(undefined, "/auth/callback/google");
    expect(
      await screen.findByRole("heading", { name: copy.en.homeWelcomeTitle }),
    ).toBeVisible();
    expect(finishAuthentication).toHaveBeenCalledWith("google");
  } finally {
    window.history.replaceState(null, "", "/");
  }
});

test("a delayed preference write from account A cannot replace account B identity or permissions", async () => {
  authenticated = true;
  let identity = "a",
    release;
  server.use(
    http.get("*/api/auth/session", () =>
      HttpResponse.json({
        authenticated: true,
        csrf_token: "csrf",
        account: {
          id: identity,
          role: "learner",
          legacy_access: false,
          interface_language: "en",
          profile_id: identity,
        },
      }),
    ),
    http.patch("*/api/account", async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return HttpResponse.json({
        id: "a",
        role: "admin",
        legacy_access: true,
        profile_id: "a",
        interface_language: "it",
      });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderApp(client);
  await screen.findByRole("heading", { name: "Your vocabulary" });
  await userEvent.selectOptions(screen.getByLabelText(copy.en.language), "it");
  await waitFor(() => expect(release).toBeTypeOf("function"));
  identity = "b";
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["session"] });
  });
  await waitFor(() =>
    expect(client.getQueryData(["session"]).account.id).toBe("b"),
  );
  await act(async () => {
    release();
  });
  await waitFor(() =>
    expect(screen.getByLabelText(copy.en.language)).toHaveValue("en"),
  );
  expect(client.getQueryData(["session"]).account).toMatchObject({
    id: "b",
    role: "learner",
    legacy_access: false,
    profile_id: "b",
  });
});
