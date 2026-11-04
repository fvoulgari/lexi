import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Leaf } from "lucide-react";
import {
  finishAuthentication,
  passwordSignIn,
  registerPassword,
  requestPasswordReset,
  resetPassword,
  sendVerification,
  verifyEmail,
  signOutUnverified,
  rememberReturn,
  startGoogle,
  takeReturn,
} from "./auth.js";

export default function AuthGate({
  text,
  onAuthenticated,
  verificationRequired = false,
}) {
  const navigate = useNavigate();
  const path = window.location.pathname;
  const [mode, setMode] = useState(
    path === "/auth/reset-password"
      ? "reset"
      : path === "/auth/verify-email" || verificationRequired
        ? "verify"
        : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [callbackFailed, setCallbackFailed] = useState(false);
  const completion = useRef(null);
  const callback = path === "/auth/callback/google";
  useEffect(() => {
    // Discard stale credentials from the removed passwordless callback.
    if (path === "/auth/verify") window.history.replaceState(null, "", path);
  }, [path]);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  useEffect(() => {
    if (!callback) return;
    if (!completion.current) completion.current = finishAuthentication();
    let active = true;
    completion.current
      .then(async () => {
        if (!active) return;
        const state = await onAuthenticated();
        if (state?.verification_required) {
          setMode("verify");
          setCallbackFailed(true);
          navigate("/auth/verify-email", { replace: true });
        } else navigate(takeReturn(), { replace: true });
      })
      .catch(() => {
        if (!active) return;
        window.history.replaceState(null, "", path);
        setCallbackFailed(true);
        setError(text.authExpired);
      });
    return () => {
      active = false;
    };
  }, [callback, navigate, onAuthenticated, path, text.authExpired]);
  function switchMode(next) {
    setMode(next);
    setPassword("");
    setError("");
    setNotice("");
    setShow(false);
  }
  async function act(action) {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    if (!path.startsWith("/auth"))
      rememberReturn(path + window.location.search);
    try {
      if (action === "google") await startGoogle();
      else if (action === "signin") {
        await passwordSignIn(email.trim(), password);
        setPassword("");
        const state = await onAuthenticated();
        if (state?.verification_required) {
          setMode("verify");
          navigate("/auth/verify-email", { replace: true });
        } else navigate(takeReturn(), { replace: true });
      } else if (action === "signup") {
        await registerPassword(email.trim(), password);
        setPassword("");
        setNotice(text.authRegistered);
        setMode("signin");
      } else if (action === "forgot") {
        await requestPasswordReset(email.trim());
        setNotice(text.authRecoverySent);
        setRemaining(60);
      } else if (action === "reset") {
        await resetPassword(password);
        setPassword("");
        setMode("signin");
        setNotice(text.authResetDone);
      } else if (action === "verify") {
        await verifyEmail();
        const state = await onAuthenticated();
        if (state?.authenticated) navigate(takeReturn(), { replace: true });
        else {
          setMode("signin");
          setNotice(text.authVerified);
        }
      } else if (action === "resend") {
        await sendVerification();
        setNotice(text.authVerificationSent);
        setRemaining(60);
      } else if (action === "logout") {
        await signOutUnverified();
        await onAuthenticated();
        switchMode("signin");
        navigate("/auth", { replace: true });
      }
    } catch {
      setError(
        action === "signin"
          ? text.authCredentials
          : ["reset", "verify"].includes(action)
            ? text.authExpired
            : text.authUnavailable,
      );
    } finally {
      setPending(false);
    }
  }
  const passwordMode = ["signin", "signup", "reset"].includes(mode);
  const newPassword = mode !== "signin";
  return (
    <div className="gate-layout">
      <section className="gate-intro">
        <span className="eyebrow">
          <Leaf size={15} aria-hidden="true" /> LEXI
        </span>
        <h1>{text.authTitle}</h1>
        <p>{text.authIntro}</p>
        <div className="notebook-decoration" aria-hidden="true">
          <span>Italian Notebook</span>
          <strong>
            Le parole
            <br />
            che ci uniscono.
          </strong>
          <small>Ελληνικά ↔ Italiano</small>
        </div>
      </section>
      <section className="gate-card">
        <div className="gate-card-heading">
          <BookOpen aria-hidden="true" />
          <h2>{text.authSignIn}</h2>
        </div>
        {callback && !callbackFailed ? (
          <p role="status">{text.authCompleting}</p>
        ) : (
          <>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {mode === "verify" ? (
              <>
                <p>{text.authVerifyHint}</p>
                {new URLSearchParams(window.location.search).has("token") && (
                  <button
                    className="primary"
                    disabled={pending}
                    onClick={() => act("verify")}
                  >
                    {text.authVerify}
                  </button>
                )}
                {verificationRequired && (
                  <>
                    <button
                      disabled={pending || remaining > 0}
                      onClick={() => act("resend")}
                    >
                      {text.authResendVerification}
                      {remaining > 0 ? ` (${remaining})` : ""}
                    </button>
                    <button disabled={pending} onClick={() => act("logout")}>
                      {text.logout}
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                {mode === "signin" && (
                  <button
                    className="primary"
                    disabled={pending}
                    onClick={() => act("google")}
                  >
                    {text.authGoogle}
                  </button>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    act(mode);
                  }}
                >
                  {mode !== "reset" && (
                    <>
                      <label htmlFor="auth-email">{text.authEmail}</label>
                      <input
                        id="auth-email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </>
                  )}
                  {passwordMode && (
                    <>
                      <label htmlFor="auth-password">{text.authPassword}</label>
                      <input
                        id="auth-password"
                        name="password"
                        type={show ? "text" : "password"}
                        autoComplete={
                          newPassword ? "new-password" : "current-password"
                        }
                        minLength={newPassword ? 15 : undefined}
                        maxLength={128}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        aria-describedby={
                          newPassword ? "password-policy" : undefined
                        }
                      />
                      <button
                        type="button"
                        aria-pressed={show}
                        disabled={pending}
                        onClick={() => setShow((v) => !v)}
                      >
                        {show ? text.authHidePassword : text.authShowPassword}
                      </button>
                      {newPassword && (
                        <p id="password-policy" className="settings-helper">
                          {text.authPasswordPolicy}
                        </p>
                      )}
                    </>
                  )}
                  <button
                    className="secondary"
                    disabled={pending || (mode === "forgot" && remaining > 0)}
                  >
                    {pending ? text.loading : text["authAction_" + mode]}
                  </button>
                </form>
                {mode === "signin" && (
                  <>
                    <button
                      disabled={pending}
                      onClick={() => switchMode("signup")}
                    >
                      {text.authAction_signup}
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => switchMode("forgot")}
                    >
                      {text.authForgot}
                    </button>
                  </>
                )}
              </>
            )}
            {mode !== "signin" && (
              <button disabled={pending} onClick={() => switchMode("signin")}>
                {text.authBack}
              </button>
            )}
            <p className="settings-helper">{text.authPrivacy}</p>
            <p className="settings-helper">{text.authMethods}</p>
          </>
        )}
      </section>
    </div>
  );
}
