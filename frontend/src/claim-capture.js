import { request } from "./api.js";

// Capture a bearer secret only in memory, then remove it from the address bar.
// The server replaces it with an opaque HttpOnly continuation cookie before sign-in.
let incomingToken;
if (window.location.pathname === "/claim" && window.location.hash) {
  incomingToken = new URLSearchParams(window.location.hash.slice(1)).get(
    "token",
  );
  window.history.replaceState(null, "", "/claim");
}
let capture;
export function captureLegacyClaim() {
  if (!capture) {
    const token = incomingToken;
    incomingToken = undefined;
    capture = token
      ? request("/api/legacy-claims/capture", {
          method: "POST",
          body: JSON.stringify({ token }),
        })
      : Promise.resolve({ captured: false });
  }
  return capture;
}
