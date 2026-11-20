import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import Profiles from "./Profiles.jsx";
import { copy } from "./copy.js";
let profile;
const server = setupServer(
  http.get("*/api/profiles", () => HttpResponse.json([profile])),
  http.patch("*/api/profiles/mine", async ({ request }) => {
    expect(request.headers.get("rid")).toBe("session");
    profile = { ...profile, ...(await request.json()) };
    return HttpResponse.json(profile);
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  localStorage.clear();
  profile = {
    id: "mine",
    display_name: "My learner",
    preferred_direction: "greek_to_italian",
    default_session_size: 25,
  };
});
function open(onLocked = vi.fn()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Profiles text={copy.en} csrf="csrf" onLocked={onLocked} />
    </QueryClientProvider>,
  );
}

test("owned profile loads automatically and stale remembered learner IDs cannot select someone else", async () => {
  localStorage.setItem("notebook-profile", "someone-else");
  open();
  expect(await screen.findByLabelText(copy.en.settingsName)).toHaveValue(
    "My learner",
  );
  expect(screen.queryByLabelText(copy.en.profile)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: copy.en.settingsNewProfile }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete profile" }),
  ).not.toBeInTheDocument();
});
test("owned profile preferences persist, including All session size", async () => {
  open();
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText(copy.en.settingsSessionSize),
    "all",
  );
  await user.selectOptions(
    screen.getByLabelText(copy.en.settingsDirection),
    "italian_to_greek",
  );
  await user.click(screen.getByRole("button", { name: copy.en.settingsSave }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    copy.en.preferencesSaved,
  );
  expect(profile.default_session_size).toBeNull();
  expect(profile.preferred_direction).toBe("italian_to_greek");
});
test("missing profile is recoverable without offering profile creation or switching", async () => {
  server.use(http.get("*/api/profiles", () => HttpResponse.json([])));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    copy.en.requestProfile,
  );
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: copy.en.createProfile }),
  ).not.toBeInTheDocument();
});
test("revoked profile access locks the account and request failures can retry", async () => {
  server.use(
    http.get("*/api/profiles", () =>
      HttpResponse.json(
        { error: { code: "authentication_required" } },
        { status: 401 },
      ),
    ),
  );
  const locked = vi.fn();
  open(locked);
  await screen.findByRole("alert");
  expect(locked).toHaveBeenCalled();
  server.resetHandlers();
  await userEvent.click(screen.getByRole("button", { name: copy.en.retry }));
  expect(await screen.findByLabelText(copy.en.settingsName)).toHaveValue(
    "My learner",
  );
});
