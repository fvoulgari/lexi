import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import AccountCard from "./AccountCard.jsx";
import { request } from "./api.js";
import { copy } from "./copy.js";
vi.mock("./api.js", () => ({ request: vi.fn() }));
const identity = {
  display_name: "Synthetic learner",
  email: "synthetic@example.invalid",
  sign_in_methods: ["password"],
  can_change_password: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  request.mockResolvedValue(identity);
});
function open() {
  const onLocked = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter>
        <AccountCard
          text={copy.en}
          account={{ display_name: "Synthetic learner", role: "learner" }}
          logoutAll={{ isPending: false, isError: false, mutate: vi.fn() }}
          onLocked={onLocked}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onLocked };
}
async function edit() {
  const state = open();
  await state.user.click(
    await screen.findByRole("button", { name: copy.en.changePassword }),
  );
  return state;
}
async function fill(user) {
  await user.type(
    screen.getByLabelText(copy.en.currentPassword),
    "old synthetic password",
  );
  await user.type(
    screen.getByLabelText(copy.en.newPassword, { exact: true }),
    "new synthetic password",
  );
  await user.type(
    screen.getByLabelText(copy.en.confirmPassword),
    "new synthetic password",
  );
}
test("password account renders compact identity and separate secondary sign-out", async () => {
  open();
  expect(await screen.findByText(identity.email)).toBeVisible();
  expect(screen.getByText(copy.en.accountMethod_password)).toBeVisible();
  expect(screen.queryByText(copy.en.accountPrivate)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: copy.en.logoutAll })).toHaveClass(
    "secondary",
  );
});
test("Google-only account has no password action even with a matching email", async () => {
  request.mockResolvedValue({
    ...identity,
    sign_in_methods: ["google"],
    can_change_password: false,
  });
  open();
  expect(await screen.findByText(copy.en.accountGoogle)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: copy.en.changePassword }),
  ).not.toBeInTheDocument();
});
test("actual password credential is available regardless of latest method", async () => {
  request.mockResolvedValue({
    ...identity,
    sign_in_methods: ["google", "password"],
  });
  open();
  expect(
    await screen.findByRole("button", { name: copy.en.changePassword }),
  ).toBeVisible();
});
test("password form focuses current password and validates without submitting", async () => {
  const { user } = await edit();
  expect(screen.getByLabelText(copy.en.currentPassword)).toHaveFocus();
  expect(screen.getByLabelText(copy.en.currentPassword)).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  expect(
    screen.getByLabelText(copy.en.newPassword, { exact: true }),
  ).toHaveAttribute("autocomplete", "new-password");
  await user.click(
    screen.getByRole("button", { name: copy.en.changePassword }),
  );
  expect(screen.getByText(copy.en.authPasswordRequired)).toBeVisible();
  expect(screen.getByText(copy.en.passwordMismatch)).toBeVisible();
  expect(request).toHaveBeenCalledTimes(1);
  await user.click(
    screen.getByRole("button", {
      name: copy.en.authShowPassword + ": " + copy.en.currentPassword,
    }),
  );
  expect(screen.getByLabelText(copy.en.currentPassword)).toHaveAttribute(
    "type",
    "text",
  );
});
test.each([
  ["current_password_incorrect", "currentPasswordIncorrect"],
  ["connection_error", "authUnavailable"],
  ["password_change_rejected", "authPasswordPolicy"],
])("%s is visible and restores controls", async (code, key) => {
  const { user, onLocked } = await edit();
  await fill(user);
  request.mockRejectedValueOnce(
    Object.assign(new Error("test-only"), { code }),
  );
  await user.click(
    screen.getByRole("button", { name: copy.en.changePassword }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(copy.en[key]);
  expect(
    screen.getByRole("button", { name: copy.en.changePassword }),
  ).toBeEnabled();
  expect(onLocked).not.toHaveBeenCalled();
});
test("successful change requires sign-in again and sends no user-selected identity", async () => {
  const { user, onLocked } = await edit();
  await fill(user);
  request.mockResolvedValueOnce({
    changed: true,
    reauthentication_required: true,
  });
  await user.click(
    screen.getByRole("button", { name: copy.en.changePassword }),
  );
  expect(onLocked).toHaveBeenCalledOnce();
  expect(request.mock.calls[1][0]).toBe("/api/account/password");
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
    current_password: "old synthetic password",
    new_password: "new synthetic password",
    confirmation: "new synthetic password",
  });
});

test("cancel discards password values before reopening", async () => {
  const { user } = await edit();
  await fill(user);
  await user.click(screen.getByRole("button", { name: copy.en.cancel }));
  await user.click(
    screen.getByRole("button", { name: copy.en.changePassword }),
  );
  expect(screen.getByLabelText(copy.en.currentPassword)).toHaveValue("");
  expect(
    screen.getByLabelText(copy.en.newPassword, { exact: true }),
  ).toHaveValue("");
  expect(screen.getByLabelText(copy.en.confirmPassword)).toHaveValue("");
});
