import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
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
import { copy } from "./copy.js";

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
  return render(
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
    await screen.findByRole("heading", { name: "Your vocabulary" }),
  ).toBeInTheDocument();
});

test("login refreshes a CSRF token rotated after the gate loaded", async () => {
  let token = "old-token";
  server.use(
    http.get("*/api/auth/session", () =>
      HttpResponse.json({ authenticated: false, csrf_token: token }),
    ),
    http.post("*/api/auth/login", ({ request }) => {
      if (request.headers.get("X-CSRF-Token") !== token) {
        return HttpResponse.json(
          { error: { code: "csrf_rejected" } },
          { status: 403 },
        );
      }
      authenticated = true;
      return HttpResponse.json({ authenticated: true });
    }),
  );
  renderApp();
  const user = userEvent.setup();
  const input = await screen.findByLabelText("Shared password");
  token = "rotated-token";
  await user.type(input, "our-notebook-password");
  await user.click(screen.getByRole("button", { name: "Open my notebook" }));
  expect(
    await screen.findByRole("heading", { name: "Your vocabulary" }),
  ).toBeInTheDocument();
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
    screen.queryByRole("heading", { name: "Your vocabulary" }),
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
  expect(await screen.findByLabelText("Shared password")).toBeInTheDocument();
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
  await user.selectOptions(
    screen.getByLabelText("App language"),
    "it",
  );
  expect(screen.getByLabelText("Direzione di esercitazione")).toHaveValue(
    "italian_to_greek",
  );
  first.unmount();
  renderApp();
  await user.click(
    await screen.findByRole("link", { name: "Profili e impostazioni" }),
  );
  expect(
    screen.getByLabelText("Lingua dell’app"),
  ).toHaveValue("it");
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

test("Greek is the default and invalid device preferences recover safely", async () => {
  localStorage.setItem("notebook-language", "unknown");
  localStorage.setItem("notebook-motion", "unknown");
  renderApp();
  expect(await screen.findByLabelText("Κοινός κωδικός")).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("el");
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
  expect(screen.queryByLabelText("Shared password")).not.toBeInTheDocument();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  act(() => window.dispatchEvent(new Event("online")));
  expect(await screen.findByLabelText("Shared password")).toBeInTheDocument();
});

test("a failed connection gates the notebook even when the browser reports online", async () => {
  server.use(http.get("*/api/auth/session", () => HttpResponse.error()));
  renderApp();
  expect(
    await screen.findByRole("heading", { name: "You’re offline" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Shared password")).not.toBeInTheDocument();
  server.resetHandlers();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Shared password")).toBeInTheDocument();
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
  const link = await screen.findByRole("link", {name: "Practice", exact:true});
  const main = screen.getByRole("main");
  const focus = vi.spyOn(main, "focus");
  scroll.mockClear();
  await userEvent.click(link);
  await screen.findByRole("heading", {name:"Practice", exact:true});
  expect(focus).toHaveBeenCalledWith({preventScroll:true});
  expect(scroll).toHaveBeenCalledWith({top:0,left:0,behavior:"instant"});
  expect(main).toHaveFocus();
  focus.mockRestore();
  scroll.mockRestore();
});


test("the header contains navigation and the Lexi logo returns to home", async () => {
  authenticated = true;
  server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
  renderApp();
  const header = screen.getByRole("banner");
  await within(header).findByRole("navigation", {name: copy.en.library});
  const logo = within(header).getByRole("link", {name: "Lexi", exact:true});
  expect(logo).toHaveAttribute("href", "/");
  await userEvent.click(logo);
  expect(await screen.findByRole("heading", {name: copy.en.welcome})).toBeInTheDocument();
  expect(within(header).getByRole("link", {name: copy.en.home, exact:true})).toHaveAttribute("aria-current", "page");
});

test("mobile navigation follows viewport changes, retains header controls and disappears when locked", async () => {
  authenticated = true;
  const mobile = new EventTarget();
  mobile.matches = true;
  vi.stubGlobal("matchMedia", (query) => query === "(max-width: 760px)" ? mobile : Object.assign(new EventTarget(), { matches: false }));
  server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
  try {
    renderApp();
    const nav = await screen.findByRole("navigation", { name: copy.en.mobileNavigation });
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Lexi" })).toHaveAttribute("href", "/");
    expect(within(header).getByLabelText("Interface language")).toBeInTheDocument();
    expect(within(header).getByLabelText("Lock notebook")).toHaveClass("mobile-lock");
    act(() => { mobile.matches = false; mobile.dispatchEvent(new Event("change")); });
    expect(screen.queryByRole("navigation", { name: copy.en.mobileNavigation })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lock notebook" })).not.toHaveClass("mobile-lock");
    act(() => { mobile.matches = true; mobile.dispatchEvent(new Event("change")); });
    await userEvent.click(within(header).getByLabelText("Lock notebook"));
    await screen.findByLabelText("Shared password");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  } finally { vi.unstubAllGlobals(); }
});
