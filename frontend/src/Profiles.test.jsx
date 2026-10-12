import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
let profiles;
const server = setupServer(
  http.get("*/api/auth/session", () =>
    HttpResponse.json({ authenticated: true, csrf_token: "csrf" }),
  ),
  http.get("*/api/profiles", () => HttpResponse.json(profiles)),
  http.patch("*/api/profiles/:id", async ({ params, request }) => {
    expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
    const body = await request.json();
    profiles = profiles.map((p) =>
      p.id === params.id ? { ...p, ...body } : p,
    );
    return HttpResponse.json(profiles.find((p) => p.id === params.id));
  }),
  http.post("*/api/profiles", async ({ request }) => {
    const profile = { id: "new", ...(await request.json()) };
    profiles.push(profile);
    return HttpResponse.json(profile, { status: 201 });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("notebook-language", "en");
  profiles = [
    {
      id: "f",
      display_name: "Foteini",
      preferred_direction: "greek_to_italian",
      default_session_size: 25,
    },
    {
      id: "s",
      display_name: "Spyros",
      preferred_direction: "italian_to_greek",
      default_session_size: 10,
    },
  ];
});
function openSettings() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
test("switching learners loads persisted preferences and remembers selection", async () => {
  localStorage.setItem("notebook-profile", "s");
  const view = openSettings();
  expect(await screen.findByLabelText("Display name")).toHaveValue("Spyros");
  expect(screen.getByLabelText("Default session size")).toHaveValue(10);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Learner profile"), "f");
  expect(screen.getByLabelText("Display name")).toHaveValue("Foteini");
  await user.selectOptions(
    screen.getByLabelText("Learning direction"),
    "italian_to_greek",
  );
  await user.clear(screen.getByLabelText("Default session size"));
  await user.type(screen.getByLabelText("Default session size"), "30");
  await user.click(screen.getByRole("button", { name: "Save preferences" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Preferences saved",
  );
  expect(localStorage.getItem("notebook-profile")).toBe("f");
  view.unmount();
  openSettings();
  expect(await screen.findByLabelText("Default session size")).toHaveValue(30);
});
test("a missing remembered profile offers a fresh selection", async () => {
  localStorage.setItem("notebook-profile", "missing");
  openSettings();
  expect(
    await screen.findByText(
      "The remembered learner is no longer available. Choose a profile.",
    ),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(localStorage.getItem("notebook-profile")).toBeNull(),
  );
  expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
  await userEvent
    .setup()
    .selectOptions(screen.getByLabelText("Learner profile"), "s");
  expect(await screen.findByLabelText("Display name")).toHaveValue("Spyros");
});
test("create a profile with defaults and validate blank names", async () => {
  openSettings();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Create learner profile" }),
  );
  await user.type(screen.getByLabelText("Display name"), "   ");
  await user.click(screen.getByRole("button", { name: "Create profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name");
  await user.clear(screen.getByLabelText("Display name"));
  await user.type(screen.getByLabelText("Display name"), "Maria");
  await user.click(screen.getByRole("button", { name: "Create profile" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Preferences saved",
  );
  expect(screen.getByLabelText("Learner profile")).toHaveValue("new");
  expect(screen.getByLabelText("Default session size")).toHaveValue(25);
  expect(
    screen.getByText(/Everyone inside the gate can select any profile/),
  ).toBeInTheDocument();
});
