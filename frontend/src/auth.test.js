import { afterEach, expect, test, vi } from "vitest";
const provider = vi.hoisted(() => ({ reset: vi.fn(), verify: vi.fn() }));
vi.mock("supertokens-web-js", () => ({ default: { init: vi.fn() } }));
vi.mock("supertokens-web-js/recipe/session", () => ({
  default: { init: vi.fn() },
}));
vi.mock("supertokens-web-js/recipe/thirdparty", () => ({
  default: { init: vi.fn() },
}));
vi.mock("supertokens-web-js/recipe/emailpassword", () => ({
  default: { init: vi.fn(), submitNewPassword: provider.reset },
}));
vi.mock("supertokens-web-js/recipe/emailverification", () => ({
  default: { init: vi.fn(), verifyEmail: provider.verify },
}));
import { resetPassword, verifyEmail } from "./auth.js";
afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});
test.each([
  [
    "/auth/reset-password",
    () => resetPassword("long test password"),
    "reset",
    "RESET_PASSWORD_INVALID_TOKEN_ERROR",
  ],
  [
    "/auth/verify-email",
    verifyEmail,
    "verify",
    "EMAIL_VERIFICATION_INVALID_TOKEN_ERROR",
  ],
])(
  "%s retains valid token after transient failure and clears on success",
  async (path, action, method) => {
    window.history.replaceState(null, "", path + "?token=test-only");
    provider[method]
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ status: "OK" });
    await expect(action()).rejects.toThrow();
    expect(window.location.search).toBe("?token=test-only");
    await action();
    expect(provider[method]).toHaveBeenCalledTimes(2);
    expect(window.location.search).toBe("");
  },
);
test.each([
  [
    "/auth/reset-password",
    () => resetPassword("long test password"),
    "reset",
    "RESET_PASSWORD_INVALID_TOKEN_ERROR",
  ],
  [
    "/auth/verify-email",
    verifyEmail,
    "verify",
    "EMAIL_VERIFICATION_INVALID_TOKEN_ERROR",
  ],
])(
  "%s clears a definitively invalid token",
  async (path, action, method, status) => {
    window.history.replaceState(null, "", path + "?token=test-only");
    provider[method].mockResolvedValueOnce({ status });
    await expect(action()).rejects.toThrow();
    expect(window.location.search).toBe("");
  },
);
