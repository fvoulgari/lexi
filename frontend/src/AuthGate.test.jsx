import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import AuthGate from "./AuthGate.jsx";
import {
  finishAuthentication,
  passwordSignIn,
  registerPassword,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
  sendVerification,
  startGoogle,
  takeReturn,
} from "./auth.js";
import { copy } from "./copy.js";
vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal()),
  finishAuthentication: vi.fn(),
  passwordSignIn: vi.fn(),
  registerPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
  sendVerification: vi.fn(),
  signOutUnverified: vi.fn(),
  startGoogle: vi.fn(),
}));
afterEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  vi.clearAllMocks();
});
function open(props = {}) {
  render(
    <MemoryRouter>
      <AuthGate
        text={copy.en}
        onAuthenticated={vi.fn().mockResolvedValue({ authenticated: true })}
        {...props}
      />
    </MemoryRouter>,
  );
  return userEvent.setup();
}
test("failed Google callback permits password retry and retains pending claim", async () => {
  window.history.replaceState(
    null,
    "",
    "/auth/callback/google?code=old&state=old",
  );
  sessionStorage.setItem("lexi-auth-return", "/claim");
  finishAuthentication.mockRejectedValueOnce(new Error("expired"));
  passwordSignIn.mockRejectedValueOnce(new Error("transient"));
  const user = open();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    copy.en.authExpired,
  );
  expect(window.location.search).toBe("");
  await user.type(
    screen.getByLabelText(copy.en.authEmail),
    "learner@example.com",
  );
  await user.type(
    screen.getByLabelText(copy.en.authPassword),
    "long password for testing",
  );
  await user.click(
    screen.getByRole("button", { name: copy.en.authAction_signin }),
  );
  expect(passwordSignIn).toHaveBeenCalledWith(
    "learner@example.com",
    "long password for testing",
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    copy.en.authUnavailable,
  );
  expect(screen.queryByText(copy.en.authCompleting)).not.toBeInTheDocument();
  expect(takeReturn()).toBe("/claim");
});
test("registration supports password managers, visibility and generic confirmation", async () => {
  const user = open();
  await user.click(
    screen.getByRole("button", { name: copy.en.authAction_signup }),
  );
  const password = screen.getByLabelText(copy.en.authPassword);
  expect(password).toHaveAttribute("autocomplete", "new-password");
  expect(password).toHaveAttribute("minlength", "15");
  await user.click(
    screen.getByRole("button", { name: copy.en.authShowPassword }),
  );
  expect(password).toHaveAttribute("type", "text");
  expect(
    screen.getByRole("button", { name: copy.en.authHidePassword }),
  ).toHaveAttribute("aria-pressed", "true");
  await user.type(
    screen.getByLabelText(copy.en.authEmail),
    "learner@example.com",
  );
  await user.type(password, "long password for testing");
  await user.click(
    screen.getByRole("button", { name: copy.en.authAction_signup }),
  );
  expect(registerPassword).toHaveBeenCalledWith(
    "learner@example.com",
    "long password for testing",
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    copy.en.authRegistered,
  );
  expect(screen.getByLabelText(copy.en.authPassword)).toHaveValue("");
  expect(screen.getByLabelText(copy.en.authPassword)).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
});
test("forgot password confirms without disclosing existence and throttles resend", async () => {
  const user = open();
  await user.click(screen.getByRole("button", { name: copy.en.authForgot }));
  await user.type(
    screen.getByLabelText(copy.en.authEmail),
    "unknown@example.com",
  );
  await user.click(
    screen.getByRole("button", { name: copy.en.authAction_forgot }),
  );
  expect(requestPasswordReset).toHaveBeenCalledWith("unknown@example.com");
  expect(await screen.findByRole("status")).toHaveTextContent(
    copy.en.authRecoverySent,
  );
  expect(
    screen.getByRole("button", { name: copy.en.authAction_forgot }),
  ).toBeDisabled();
});
test("reset link requires explicit new password submission", async () => {
  window.history.replaceState(null, "", "/auth/reset-password?token=one-use");
  const user = open();
  expect(resetPassword).not.toHaveBeenCalled();
  await user.type(
    screen.getByLabelText(copy.en.authPassword),
    "new password for testing",
  );
  await user.click(
    screen.getByRole("button", { name: copy.en.authAction_reset }),
  );
  expect(resetPassword).toHaveBeenCalledWith("new password for testing");
  expect(await screen.findByRole("status")).toHaveTextContent(
    copy.en.authResetDone,
  );
});
test("verification link is never consumed on page load", async () => {
  window.history.replaceState(null, "", "/auth/verify-email?token=one-use");
  const user = open();
  expect(verifyEmail).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: copy.en.authVerify }));
  expect(verifyEmail).toHaveBeenCalledOnce();
});
test("unverified account receives verification controls without password form", async () => {
  const user = open({ verificationRequired: true });
  expect(screen.queryByLabelText(copy.en.authPassword)).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: copy.en.authResendVerification }),
  );
  expect(sendVerification).toHaveBeenCalledOnce();
  expect(await screen.findByRole("status")).toHaveTextContent(
    copy.en.authVerificationSent,
  );
});

test("old magic-link callback is inert and removes stale URL credentials", () => {
  window.history.replaceState(
    null,
    "",
    "/auth/verify?preAuthSessionId=old#old-code",
  );
  open();
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("");
  expect(finishAuthentication).not.toHaveBeenCalled();
  expect(verifyEmail).not.toHaveBeenCalled();
  expect(screen.getByLabelText(copy.en.authPassword)).toBeVisible();
});

test("network failure has retryable feedback and restores sign-in controls", async () => {
  passwordSignIn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const user = open();
  await user.type(
    screen.getByLabelText(copy.en.authEmail),
    "learner@example.com",
  );
  await user.type(
    screen.getByLabelText(copy.en.authPassword),
    "wrong password example",
  );
  await user.click(
    screen.getByRole("button", { name: copy.en.authAction_signin }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    copy.en.authUnavailable,
  );
  expect(screen.getByLabelText(copy.en.authEmail)).toHaveValue(
    "learner@example.com",
  );
  expect(
    screen.getByRole("button", { name: copy.en.authAction_signin }),
  ).toBeEnabled();
});

test("landing preserves original hero copy", () => {
  open();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    copy.en.gateTitle,
  );
  expect(screen.getByText("ITALIAN NOTEBOOK")).toBeVisible();
});

test.each(["unknown email", "wrong password"])(
  "%s uses the same non-enumerating banner",
  async () => {
    passwordSignIn.mockResolvedValueOnce({ status: "WRONG_CREDENTIALS_ERROR" });
    const user = open();
    await user.type(
      screen.getByLabelText(copy.en.authEmail),
      "learner@example.com",
    );
    await user.type(
      screen.getByLabelText(copy.en.authPassword),
      "wrong password example",
    );
    await user.click(
      screen.getByRole("button", { name: copy.en.authAction_signin }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect email or password.",
    );
    expect(
      screen.getByRole("button", { name: copy.en.authAction_signin }),
    ).toBeEnabled();
  },
);

test("required fields show inline errors without contacting the provider", async () => {
  const user = open();
  await user.click(
    screen.getByRole("button", { name: copy.en.authAction_signin }),
  );
  expect(screen.getByText(copy.en.authEmailInvalid)).toBeVisible();
  expect(screen.getByText(copy.en.authPasswordRequired)).toBeVisible();
  expect(passwordSignIn).not.toHaveBeenCalled();
});

test("late recovery completion cannot update a different form", async () => {
  let complete;
  requestPasswordReset.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const user = open();
  await user.click(screen.getByRole("button", { name: copy.en.authForgot }));
  await user.type(
    screen.getByLabelText(copy.en.authEmail),
    "learner@example.com",
  );
  await user.click(
    screen.getByRole("button", { name: copy.en.authAction_forgot }),
  );
  expect(
    screen.getByRole("button", { name: copy.en.authLoading_forgot }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: copy.en.authBack }));
  await act(async () => complete());
  expect(screen.queryByText(copy.en.authRecoverySent)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: copy.en.authAction_signin }),
  ).toBeEnabled();
});

test.each([
  ["signin", passwordSignIn],
  ["signup", registerPassword],
  ["forgot", requestPasswordReset],
  ["reset", resetPassword],
  ["resend", sendVerification],
  ["google", startGoogle],
])(
  "%s has operation-specific loading and recovers on failure",
  async (action, provider) => {
    let reject;
    provider.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    if (action === "reset")
      window.history.replaceState(
        null,
        "",
        "/auth/reset-password?token=test-only",
      );
    const user = open({ verificationRequired: action === "resend" });
    if (action === "signup")
      await user.click(
        screen.getByRole("button", { name: copy.en.authAction_signup }),
      );
    if (action === "forgot")
      await user.click(
        screen.getByRole("button", { name: copy.en.authForgot }),
      );
    if (!["resend", "google", "reset"].includes(action))
      await user.type(
        screen.getByLabelText(copy.en.authEmail),
        "learner@example.com",
      );
    if (["signin", "signup", "reset"].includes(action))
      await user.type(
        screen.getByLabelText(copy.en.authPassword),
        "long password for testing",
      );
    const label =
      action === "resend"
        ? copy.en.authResendVerification
        : action === "google"
          ? copy.en.authGoogle
          : copy.en["authAction_" + action];
    await user.click(screen.getByRole("button", { name: label }));
    expect(
      screen.getByRole("button", { name: copy.en["authLoading_" + action] }),
    ).toBeDisabled();
    await act(async () => reject(new TypeError("Failed to fetch")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      copy.en.authUnavailable,
    );
    expect(screen.getByRole("button", { name: label })).toBeEnabled();
  },
);
