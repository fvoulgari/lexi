import { afterEach, expect, test, vi } from "vitest";
import { safeReturn } from "./auth.js";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
test("claim secrets are scrubbed before secure capture and never put in browser storage", async () => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/claim#token=one-time-secret");
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ captured: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const { captureLegacyClaim } = await import("./claim-capture.js");
  expect(window.location.href).not.toContain("one-time-secret");
  expect(fetch).not.toHaveBeenCalled();
  await captureLegacyClaim();
  await captureLegacyClaim();
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    token: "one-time-secret",
  });
  expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(
    "one-time-secret",
  );
});
test.each([
  "https://attacker.example/steal",
  "//attacker.example/steal",
  "/auth/callback/google",
  "javascript:alert(1)",
])("authentication return path rejects %s", (path) =>
  expect(safeReturn(path)).toBe("/"),
);
test("authentication return retains a safe internal claim route without fragments", () =>
  expect(safeReturn("/claim#secret=bad")).toBe("/claim"));
