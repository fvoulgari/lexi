import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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
import { copy } from "./copy.js";

const server = setupServer(
  http.get("*/api/auth/session", () =>
    HttpResponse.json({ authenticated: true, csrf_token: "csrf" }),
  ),
  http.get("*/api/profiles", () => HttpResponse.json([])),
  http.get("*/api/units", () => HttpResponse.json([])),
  http.get("*/api/tags", () => HttpResponse.json([])),
  http.get("*/api/vocabulary", () =>
    HttpResponse.json({ items: [], total: 0, page: 1, page_size: 6 }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => localStorage.clear());
function open(language, route = "/") {
  localStorage.setItem("notebook-language", language);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test.each(["el", "en", "it"])(
  "all screens and empty-state card forms are labelled in %s",
  async (language) => {
    const text = copy[language];
    open(language);
    const user = userEvent.setup();
    expect(
      await screen.findByRole("heading", { name: text.homeWelcomeTitle }),
    ).toBeVisible();
    expect(screen.queryByLabelText(text.profile)).not.toBeInTheDocument();
    expect(await screen.findByText(text.homeCreateProfileHint)).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", language);
    const nav = within(screen.getByRole("navigation"));
    await user.click(
      nav.getByRole("link", { name: text.library, exact: true }),
    );
    expect(
      await screen.findByRole("heading", { name: text.empty }),
    ).toBeVisible();
    expect(screen.getByLabelText(text.csvFile)).not.toBeVisible();
    await user.click(screen.getByRole("button", {name: text.toolsImport}));
    expect(screen.getByLabelText(text.csvFile)).toBeVisible();
    expect(
      screen.getByRole("button", { name: text.csvPreview }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: text.addEntry }));
    expect(screen.getByLabelText(`${text.fields.italian} *`)).toHaveFocus();
    expect(screen.getByLabelText(`${text.fields.greek} *`)).toBeRequired();
    expect(screen.getByLabelText(`${text.fields.word_type} *`)).toBeRequired();
    await user.click(screen.getByRole("button", { name: text.cancel }));
    for (const [trigger, label] of [
      [text.toolsNewUnit, text.unitCode],
    ]) {
      await user.click(screen.getAllByRole("button", { name: trigger })[0]);
      expect(screen.getByLabelText(label)).toHaveFocus();
      await user.click(screen.getByRole("button", { name: text.cancel }));
    }
    await user.click(
      nav.getByRole("link", { name: text.practice, exact: true }),
    );
    expect(
      await screen.findByRole("heading", { name: text.practice }),
    ).toBeVisible();
    expect(await screen.findByText(text.practiceChooseProfile)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: text.startPractice }),
    ).not.toBeInTheDocument();
    await user.click(
      nav.getByRole("link", { name: text.progress, exact: true }),
    );
    expect(
      await screen.findByRole("heading", { name: text.detailTitle }),
    ).toBeVisible();
    expect(
      await screen.findByRole("link", { name: text.createProfile }),
    ).toBeVisible();
    await user.click(
      nav.getByRole("link", { name: text.settings, exact: true }),
    );
    expect(await within(screen.getByRole("region", {name: text.deviceSettings})).findByLabelText(text.deviceLanguage)).toHaveValue(
      language,
    );
    expect(screen.queryByLabelText(text.motion)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: text.settingsNewProfile }));
    expect(screen.getByLabelText(text.settingsName)).toBeVisible();
  },
);

test.each(["el", "en", "it"])(
  "service failure and recovery are readable in %s",
  async (language) => {
    server.use(
      http.get("*/api/auth/session", () =>
        HttpResponse.json(
          { error: { code: "service_unavailable" } },
          { status: 503 },
        ),
      ),
    );
    open(language);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      copy[language].errors.service_unavailable,
    );
    server.use(
      http.get("*/api/auth/session", () =>
        HttpResponse.json({ authenticated: false, csrf_token: "csrf" }),
      ),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: copy[language].retry }));
    expect(await screen.findByLabelText(copy[language].password)).toBeVisible();
    expect(
      screen.getByRole("button", { name: copy[language].enter }),
    ).toBeVisible();
  },
);
