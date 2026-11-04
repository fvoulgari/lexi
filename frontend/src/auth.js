import SuperTokens from "supertokens-web-js";
import Session from "supertokens-web-js/recipe/session";
import EmailPassword from "supertokens-web-js/recipe/emailpassword";
import EmailVerification from "supertokens-web-js/recipe/emailverification";
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
      EmailPassword.init(),
      EmailVerification.init(),
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
function requireOK(result) {
  if (result.status !== "OK") throw new Error("authentication_failed");
  return result;
}
export async function passwordSignIn(email, password) {
  initializeAuth();
  requireOK(
    await EmailPassword.signIn({
      formFields: [
        { id: "email", value: email },
        { id: "password", value: password },
      ],
      shouldTryLinkingWithSessionUser: false,
    }),
  );
}
export async function registerPassword(email, password) {
  initializeAuth();
  // Registration intentionally returns no identity/session, including for an
  // existing address. Password validation and storage remain SDK/Core-owned.
  const response = await fetch("/api/auth/signup", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", rid: "emailpassword" },
    body: JSON.stringify({
      formFields: [
        { id: "email", value: email },
        { id: "password", value: password },
      ],
      shouldTryLinkingWithSessionUser: false,
    }),
  });
  if (!response.ok) throw new Error("authentication_failed");
  requireOK(await response.json());
}
export async function requestPasswordReset(email) {
  initializeAuth();
  requireOK(
    await EmailPassword.sendPasswordResetEmail({
      formFields: [{ id: "email", value: email }],
    }),
  );
}
export async function resetPassword(password) {
  initializeAuth();
  try {
    requireOK(
      await EmailPassword.submitNewPassword({
        formFields: [{ id: "password", value: password }],
      }),
    );
  } finally {
    window.history.replaceState(null, "", window.location.pathname);
  }
}
export async function sendVerification() {
  initializeAuth();
  const result = await EmailVerification.sendVerificationEmail();
  if (!["OK", "EMAIL_ALREADY_VERIFIED_ERROR"].includes(result.status))
    throw new Error("authentication_failed");
}
export async function verifyEmail() {
  initializeAuth();
  try {
    requireOK(await EmailVerification.verifyEmail());
  } finally {
    window.history.replaceState(null, "", window.location.pathname);
  }
}
export async function signOutUnverified() {
  initializeAuth();
  await Session.signOut();
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
export async function finishAuthentication() {
  initializeAuth();
  try {
    requireOK(await ThirdParty.signInAndUp());
  } finally {
    window.history.replaceState(null, "", window.location.pathname);
  }
}

export function notifySessionChanged() {
  // A random navigation signal carries no credentials or account information.
  try {
    localStorage.setItem("lexi-session-change", crypto.randomUUID());
  } catch {
    /* Focus revalidation also covers unavailable storage. */
  }
}
