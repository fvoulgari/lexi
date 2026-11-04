import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Leaf } from "lucide-react";
import {
  finishAuthentication,
  rememberReturn,
  sendMagicLink,
  startGoogle,
  takeReturn,
} from "./auth.js";

export default function AuthGate({ text, onAuthenticated }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [callbackFailed, setCallbackFailed] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const completion = useRef(null);
  const callback =
    window.location.pathname.startsWith("/auth/callback") ||
    window.location.pathname === "/auth/verify";
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  useEffect(() => {
    if (!callback) return;
    if (!completion.current)
      completion.current = finishAuthentication(
        window.location.pathname.includes("google") ? "google" : "email",
      );
    let active = true;
    completion.current
      .then(async () => {
        if (!active) return;
        await onAuthenticated();
        navigate(takeReturn(), { replace: true });
      })
      .catch(() => {
        if (!active) return;
        window.history.replaceState(null, "", window.location.pathname);
        setCallbackFailed(true);
        setError(text.authExpired);
      });
    return () => {
      active = false;
    };
  }, [callback, navigate, onAuthenticated, text.authExpired]);
  async function begin(action) {
    if (pending) return;
    setError(null);
    setPending(true);
    // Retrying from an auth callback must preserve the original internal destination.
    if (!window.location.pathname.startsWith("/auth"))
      rememberReturn(window.location.pathname + window.location.search);
    try {
      if (action === "google") await startGoogle();
      else {
        await sendMagicLink(email.trim());
        setSent(true);
        setRemaining(60);
      }
    } catch {
      setError(text.authUnavailable);
    } finally {
      setPending(false);
    }
  }
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
            <button
              className="primary"
              disabled={pending}
              onClick={() => begin("google")}
            >
              {text.authGoogle}
            </button>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                begin("email");
              }}
            >
              <label htmlFor="auth-email">{text.authEmail}</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button className="secondary" disabled={pending || remaining > 0}>
                {pending
                  ? text.loading
                  : remaining
                    ? `${text.authResend} (${remaining})`
                    : sent
                      ? text.authResend
                      : text.authSend}
              </button>
            </form>
            {sent && <p role="status">{text.authSent}</p>}
            <p className="settings-helper">{text.authPrivacy}</p>
            <p className="settings-helper">{text.authMethods}</p>
          </>
        )}
      </section>
    </div>
  );
}
