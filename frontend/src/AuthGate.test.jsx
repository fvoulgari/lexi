import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import AuthGate from "./AuthGate.jsx";
import { finishAuthentication, sendMagicLink, takeReturn } from "./auth.js";
import { copy } from "./copy.js";
vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal()),
  finishAuthentication: vi.fn(),
  sendMagicLink: vi.fn(),
  startGoogle: vi.fn(),
}));
afterEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  vi.clearAllMocks();
});
test.each([
  "/auth/verify?preAuthSessionId=expired#one-use-code",
  "/auth/callback/google?code=expired-code&state=old-state",
])(
  "failed callback %s can send a fresh email without losing a pending claim",
  async (url) => {
    window.history.replaceState(null, "", url);
    sessionStorage.setItem("lexi-auth-return", "/claim");
    finishAuthentication.mockRejectedValueOnce(new Error("expired"));
    sendMagicLink.mockResolvedValueOnce(undefined);
    render(
      <MemoryRouter>
        <AuthGate text={copy.en} onAuthenticated={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      copy.en.authExpired,
    );
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(copy.en.authEmail),
      "learner@example.com",
    );
    await user.click(screen.getByRole("button", { name: copy.en.authSend }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      copy.en.authSent,
    );
    expect(screen.queryByText(copy.en.authCompleting)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Send another link/ }),
    ).toBeDisabled();
    expect(sendMagicLink).toHaveBeenCalledWith("learner@example.com");
    expect(takeReturn()).toBe("/claim");
  },
);
