import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole, Leaf, Eye, EyeOff } from "lucide-react";
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
  const [pending, setPending] = useState("");
  const [fields, setFields] = useState({});
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const [notice, setNotice] = useState("");
  const [completed, setCompleted] = useState(false);
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
        setError("authExpired");
      });
    return () => {
      active = false;
    };
  }, [callback, navigate, onAuthenticated, path]);
  function switchMode(next) {
    generation.current += 1;
    setPending("");
    setFields({});
    setMode(next);
    setPassword("");
    setError("");
    setNotice("");
    setCompleted(false);
    setShow(false);
  }
  async function act(action) {
    if (pending) return;
    const attempt = ++generation.current;
    const current = () => generation.current === attempt;
    setPending(action);
    setError("");
    setNotice("");
    setCompleted(false);
    setFields({});
    if (!path.startsWith("/auth"))
      rememberReturn(path + window.location.search);
    try {
      if (action === "google") await startGoogle(current);
      else if (action === "signin") {
        const result = await passwordSignIn(email.trim(), password);
        if (!current()) return;
        if (result && result.status !== "OK") {
          const failure = new Error("authentication_failed");
          failure.code = result.status;
          throw failure;
        }
        setPassword("");
        const state = await onAuthenticated();
        if (!current()) return;
        if (!state?.authenticated && !state?.verification_required)
          throw new Error("unavailable");
        if (state?.verification_required) {
          setMode("verify");
          navigate("/auth/verify-email", { replace: true });
        } else navigate(takeReturn(), { replace: true });
      } else if (action === "signup") {
        await registerPassword(email.trim(), password);
        if (!current()) return;
        setPassword("");
        setNotice("authRegistered");
        setCompleted(true);
      } else if (action === "forgot") {
        await requestPasswordReset(email.trim());
        if (!current()) return;
        setNotice("authRecoverySent");
        setCompleted(true);
        setRemaining(60);
      } else if (action === "reset") {
        await resetPassword(password);
        if (!current()) return;
        setPassword("");
        setNotice("authResetDone");
        setCompleted(true);
      } else if (action === "verify") {
        await verifyEmail();
        if (!current()) return;
        const state = await onAuthenticated();
        if (!current()) return;
        if (state?.authenticated) navigate(takeReturn(), { replace: true });
        else {
          setNotice("authVerified");
          setCompleted(true);
        }
      } else if (action === "resend") {
        await sendVerification();
        if (!current()) return;
        setNotice("authVerificationSent");
        setRemaining(60);
      } else if (action === "logout") {
        await signOutUnverified();
        if (!current()) return;
        await onAuthenticated();
        if (!current()) return;
        switchMode("signin");
        navigate("/auth", { replace: true });
      }
    } catch (failure) {
      if (!current()) return;
      if (failure.fields?.length) {
        setFields(
          Object.fromEntries(
            failure.fields.map(({ id }) => [
              id,
              id === "email" ? "authEmailInvalid" : "authPasswordPolicy",
            ]),
          ),
        );
      }
      setError(
        failure.code === "WRONG_CREDENTIALS_ERROR"
          ? "authCredentials"
          : [
                "RESET_PASSWORD_INVALID_TOKEN_ERROR",
                "EMAIL_VERIFICATION_INVALID_TOKEN_ERROR",
              ].includes(failure.code)
            ? "authExpired"
            : failure.code === "FIELD_ERROR"
              ? "authCheckFields"
              : "authUnavailable",
      );
    } finally {
      if (current()) setPending("");
    }
  }
  const passwordMode = ["signin", "signup", "reset"].includes(mode);
  const newPassword = mode !== "signin";
  return (
    <div className="gate-layout">
      <section className="gate-intro">
        <span className="eyebrow">
          <Leaf size={15} aria-hidden="true" />
          ITALIAN NOTEBOOK
        </span>
        <h1>{text.gateTitle}</h1>
        <p>{text.gateIntro}</p>
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
          <span className="lock-icon">
            <LockKeyhole size={24} aria-hidden="true" />
          </span>
          <h2>
            {mode === "signin"
              ? text.authSignIn
              : mode === "signup"
                ? text.authAction_signup
                : mode === "verify"
                  ? text.authVerify
                  : text.authResetTitle}
          </h2>
        </div>
        {callback && !callbackFailed ? (
          <p role="status">{text.authCompleting}</p>
        ) : (
          <>
            {error && (
              <p role="alert" className="error">
                {text[error]}
              </p>
            )}
            {notice && !completed && <p role="status">{text[notice]}</p>}
            {completed ? (
              <div className="auth-confirmation">
                <p role="status">{text[notice]}</p>
                {mode === "forgot" && (
                  <p className="auth-submitted-email">{email.trim()}</p>
                )}
              </div>
            ) : mode === "verify" ? (
              <>
                <p>{text.authVerifyHint}</p>
                {new URLSearchParams(window.location.search).has("token") && (
                  <button
                    className="primary"
                    disabled={pending}
                    onClick={() => act("verify")}
                  >
                    {pending === "verify"
                      ? text.authLoading_verify
                      : text.authVerify}
                  </button>
                )}
                {verificationRequired && (
                  <>
                    <button
                      disabled={pending || remaining > 0}
                      onClick={() => act("resend")}
                    >
                      {pending === "resend"
                        ? text.authLoading_resend
                        : text.authResendVerification}
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
                {mode === "forgot" && (
                  <p className="auth-reset-description">
                    {text.authResetDescription}
                  </p>
                )}
                <form
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    const invalid = {};
                    if (
                      mode !== "reset" &&
                      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
                    )
                      invalid.email = "authEmailInvalid";
                    if (
                      passwordMode &&
                      (!password ||
                        (newPassword &&
                          (password.length < 15 || password.length > 128)))
                    )
                      invalid.password = newPassword
                        ? "authPasswordPolicy"
                        : "authPasswordRequired";
                    setFields(invalid);
                    if (!Object.keys(invalid).length) act(mode);
                  }}
                >
                  {mode !== "reset" && (
                    <>
                      <label htmlFor="auth-email">{text.authEmail}</label>
                      <input
                        aria-invalid={!!fields.email}
                        aria-describedby={
                          fields.email ? "auth-email-error" : undefined
                        }
                        disabled={!!pending}
                        id="auth-email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                      {fields.email && (
                        <p id="auth-email-error" className="error">
                          {text[fields.email]}
                        </p>
                      )}
                    </>
                  )}
                  {passwordMode && (
                    <>
                      <label htmlFor="auth-password">{text.authPassword}</label>
                      <div className="auth-password-field">
                        <input
                          aria-invalid={!!fields.password}
                          disabled={!!pending}
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
                            fields.password
                              ? "auth-password-error"
                              : newPassword
                                ? "password-policy"
                                : undefined
                          }
                        />
                        <button
                          className="auth-eye"
                          type="button"
                          aria-label={
                            show ? text.authHidePassword : text.authShowPassword
                          }
                          aria-pressed={show}
                          disabled={pending}
                          onClick={() => setShow((v) => !v)}
                        >
                          {show ? (
                            <EyeOff size={20} aria-hidden="true" />
                          ) : (
                            <Eye size={20} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      {fields.password && (
                        <p id="auth-password-error" className="error">
                          {text[fields.password]}
                        </p>
                      )}
                      {mode === "signin" && (
                        <button
                          className="auth-link auth-forgot"
                          type="button"
                          onClick={() => switchMode("forgot")}
                        >
                          {text.authForgot}
                        </button>
                      )}
                      {newPassword && (
                        <p id="password-policy" className="settings-helper">
                          {text.authPasswordPolicy}
                        </p>
                      )}
                    </>
                  )}
                  <button
                    className="primary"
                    disabled={!!pending || (mode === "forgot" && remaining > 0)}
                  >
                    {pending === mode
                      ? text["authLoading_" + pending]
                      : text["authAction_" + mode]}
                  </button>
                </form>
                {mode === "signin" && (
                  <>
                    <div className="auth-separator">
                      <span>{text.authOr}</span>
                    </div>
                    <button
                      className="auth-google secondary"
                      disabled={!!pending}
                      onClick={() => act("google")}
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 48 48"
                        aria-hidden="true"
                      >
                        <path
                          fill="#4285F4"
                          d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.5-1.9 4.6-4.1 6v5h6.6c3.9-3.6 6.1-8.6 6.1-14.7Z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2C9.2 39.5 16.1 44 24 44Z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.2H5.8a20 20 0 0 0 0 17.6Z"
                        />
                        <path
                          fill="#EA4335"
                          d="M24 12c3 0 5.6 1 7.7 3l5.8-5.8A19.4 19.4 0 0 0 24 4C16.1 4 9.2 8.5 5.8 15.2l6.8 5.2C14.2 15.6 18.7 12 24 12Z"
                        />
                      </svg>
                      {pending === "google"
                        ? text.authLoading_google
                        : text.authGoogle}
                    </button>
                    <p className="auth-footer">
                      {text.authNewHere}{" "}
                      <button
                        className="auth-link"
                        onClick={() => switchMode("signup")}
                      >
                        {text.authAction_signup}
                      </button>
                    </p>
                  </>
                )}
              </>
            )}
            {mode !== "signin" && (
              <p className="auth-footer">
                {mode === "signup" && <span>{text.authAlready} </span>}
                <button
                  className="auth-link"
                  onClick={() => switchMode("signin")}
                >
                  {mode === "signup" ? text.authSignIn : text.authBack}
                </button>
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
