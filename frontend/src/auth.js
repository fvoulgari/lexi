import SuperTokens from "supertokens-web-js";
import Session from "supertokens-web-js/recipe/session";
import Passwordless from "supertokens-web-js/recipe/passwordless";
import ThirdParty from "supertokens-web-js/recipe/thirdparty";

let initialized = false;
export function initializeAuth() {
  if (initialized) return;
  SuperTokens.init({
    appInfo: {
      appName: "Lexi",
      apiDomain: window.location.origin,
      apiBasePath: "/api/auth",
    },
    recipeList: [
      Session.init({
        tokenTransferMethod: "cookie",
        onHandleEvent: (event) => {
          if (["UNAUTHORISED", "SIGN_OUT"].includes(event.action))
            window.dispatchEvent(new Event("lexi:unauthorized"));
        },
      }),
      Passwordless.init(),
      ThirdParty.init(),
    ],
  });
  initialized = true;
}

export function safeReturn(value) {
  try {
    const target = new URL(value || "/", window.location.origin);
    if (
      target.origin !== window.location.origin ||
      target.pathname.startsWith("/auth")
    )
      return "/";
    return target.pathname + target.search;
  } catch {
    return "/";
  }
}
export function rememberReturn(path) {
  try {
    sessionStorage.setItem("lexi-auth-return", safeReturn(path));
  } catch {
    /* Optional navigation hint. */
  }
}
export function takeReturn() {
  try {
    const path = safeReturn(sessionStorage.getItem("lexi-auth-return"));
    sessionStorage.removeItem("lexi-auth-return");
    return path;
  } catch {
    return "/";
  }
}
export async function sendMagicLink(email) {
  initializeAuth();
  const result = await Passwordless.createCode({
    email,
    shouldTryLinkingWithSessionUser: false,
  });
  if (result.status !== "OK") throw new Error("authentication_failed");
  // This stores a login attempt identifier, never a session token or password.
  await Passwordless.setLoginAttemptInfo({
    attemptInfo: {
      deviceId: result.deviceId,
      preAuthSessionId: result.preAuthSessionId,
      flowType: result.flowType,
    },
  });
}
export async function startGoogle() {
  initializeAuth();
  const url = await ThirdParty.getAuthorisationURLWithQueryParamsAndSetState({
    thirdPartyId: "google",
    frontendRedirectURI: window.location.origin + "/auth/callback/google",
    shouldTryLinkingWithSessionUser: false,
  });
  window.location.assign(url);
}
export async function finishAuthentication(kind) {
  initializeAuth();
  const result =
    kind === "google"
      ? await ThirdParty.signInAndUp()
      : await Passwordless.consumeCode();
  if (result.status !== "OK")
    throw Object.assign(new Error("authentication_failed"), {
      code: "link_expired",
    });
  if (kind !== "google") await Passwordless.clearLoginAttemptInfo();
  window.history.replaceState(null, "", window.location.pathname);
}

export function notifySessionChanged() {
  // A random navigation signal carries no credentials or account information.
  try {
    localStorage.setItem("lexi-session-change", crypto.randomUUID());
  } catch {
    /* Focus revalidation also covers unavailable storage. */
  }
}
