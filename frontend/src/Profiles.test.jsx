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
  http.get("*/api/units", () => HttpResponse.json([{id: "u", code: "00", title: "Benvenuti", card_count: 10}])),
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
    const profile = { id: "m", ...(await request.json()) };
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
      practice_unit_ids: ["u"],
        preferred_direction: "greek_to_italian",
      default_session_size: 25,
    },
    {
      id: "s",
      display_name: "Spyros",
      practice_unit_ids: ["u"],
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
  expect(await screen.findByLabelText("Name")).toHaveValue("Spyros");
  expect(screen.getByLabelText("Cards per session")).toHaveValue("10");
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Learner profile"), "f");
  expect(screen.getByLabelText("Name")).toHaveValue("Foteini");
  await user.selectOptions(
    screen.getByLabelText("Practice direction"),
    "italian_to_greek",
  );
  await user.selectOptions(screen.getByLabelText("Cards per session"), "50");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Preferences saved",
  );
  expect(localStorage.getItem("notebook-profile")).toBe("f");
  view.unmount();
  openSettings();
  expect(await screen.findByLabelText("Cards per session")).toHaveValue(
    "50",
  );
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
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  await userEvent
    .setup()
    .selectOptions(screen.getByLabelText("Learner profile"), "s");
  expect(await screen.findByLabelText("Name")).toHaveValue("Spyros");
});
test("create a profile with defaults and validate blank names", async () => {
  openSettings();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "New profile" }),
  );
  await user.type(screen.getByLabelText("Name"), "   ");
  await user.click(screen.getByRole("button", { name: "Create profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name");
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Maria");
  await user.click(screen.getByRole("button", { name: "Create profile" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Preferences saved",
  );
  expect(screen.getByLabelText("Learner profile")).toHaveValue("m");
  expect(screen.getByLabelText("Cards per session")).toHaveValue("25");
  expect(
    screen.getByText(/anyone with access to the notebook can select them/),
  ).toBeInTheDocument();
});

test("All can be saved as a learner preference", async () => {
  localStorage.setItem("notebook-profile", "f");
  const view = openSettings();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Cards per session"),
    "all",
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Preferences saved",
  );
  view.unmount();
  openSettings();
  expect(await screen.findByLabelText("Cards per session")).toHaveValue(
    "all",
  );
});

test("settings heading precedes both full-width sections when there are no profiles", async () => {
  profiles = [];
  openSettings();
  const title = await screen.findByRole("heading", {name:"Profiles and settings", level:1});
  const profileCard = screen.getByRole("region", {name:"Your profile"});
  const deviceCard = screen.getByRole("region", {name:"On this device"});
  expect(title.compareDocumentPosition(profileCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(profileCard.compareDocumentPosition(deviceCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const newProfile = await screen.findByRole("button", {name:"New profile"});
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(screen.getByText("Changes are saved automatically on this device.")).toBeInTheDocument();
  await userEvent.click(newProfile);
  expect(screen.getByLabelText("Name")).toBeRequired();
  expect(screen.getByLabelText("Cards per session")).toHaveValue("25");
});

test("profile load errors can retry and revoked access returns to the gate", async () => {
  let status = 503;
  server.use(http.get("*/api/profiles", () => status ? HttpResponse.json(
    {error:{code:status === 401 ? "unauthenticated" : "service_unavailable"}}, {status}
  ) : HttpResponse.json(profiles)));
  const view = openSettings();
  expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
  status = 0;
  await userEvent.click(screen.getByRole("button", {name:"Try again"}));
  expect(await screen.findByRole("button", {name:"New profile"})).toBeInTheDocument();
  view.unmount();
  status = 401;
  openSettings();
  expect(await screen.findByLabelText("Shared password")).toBeInTheDocument();
});

test("practice units persist, clear explicitly and select only current units", async () => {
  localStorage.setItem("notebook-profile", "f");
  openSettings();
  const user = userEvent.setup();
  const unit = await screen.findByRole("checkbox", {name: "00 · Benvenuti — 10 cards"});
  expect(unit).toBeChecked();
  await user.click(screen.getByRole("button", {name: "Clear selections"}));
  expect(unit).not.toBeChecked();
  await user.click(screen.getByRole("button", {name: "Save changes"}));
  await screen.findByText("Preferences saved.");
  expect(profiles.find(p => p.id === "f").practice_unit_ids).toEqual([]);
  await user.click(screen.getByRole("button", {name: "Select all"}));
  await user.click(screen.getByRole("button", {name: "Save changes"}));
  await waitFor(() => expect(profiles.find(p => p.id === "f").practice_unit_ids).toEqual(["u"]));
  expect(profiles.find(p => p.id === "s").practice_unit_ids).toEqual(["u"]);
});
