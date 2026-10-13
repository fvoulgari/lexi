import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  LockKeyhole,
  ArrowRight,
  Leaf,
  House,
  LibraryBig,
  LogOut,
} from "lucide-react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { request } from "./api.js";
import { copy, languages } from "./copy.js";
import Library from "./Library.jsx";
import Profiles from "./Profiles.jsx";
import Practice from "./Practice.jsx";

export default function App() {
  const [language, setLanguage] = useState(() => {
    try {
      return Object.hasOwn(copy, localStorage.getItem("notebook-language"))
        ? localStorage.getItem("notebook-language")
        : "el";
    } catch {
      return "el";
    }
  });
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const [password, setPassword] = useState("");
  const text = copy[language];
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => request("/api/auth/session"),
    retry: false,
    enabled: online,
    networkMode: "always",
  });
  const login = useMutation({
    mutationFn: () =>
      request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
        headers: { "X-CSRF-Token": session.data.csrf_token },
      }),
    onSuccess: () => {
      setPassword("");
      queryClient.setQueryData(["session"], {
        ...session.data,
        authenticated: true,
      });
    },
  });
  const lockNotebook = useCallback(() => {
    const csrf = queryClient.getQueryData(["session"])?.csrf_token;
    queryClient.setQueryData(["session"], {
      authenticated: false,
      csrf_token: csrf,
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== "session",
    });
  }, [queryClient]);
  const logout = useMutation({
    mutationFn: () =>
      request("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": session.data.csrf_token },
      }),
    onSuccess: lockNotebook,
  });
  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem("notebook-language", language);
    } catch {
      /* The setting still works without device storage. */
    }
  }, [language]);

  return (
    <div className="notebook-app">
      <a className="skip-link" href="#main">
        {text.skip}
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <BookOpen size={24} aria-hidden="true" />
          </span>
          <div>
            Italian Notebook<small>{text.tagline}</small>
          </div>
        </div>
        <label className="language-picker">
          <span className="sr-only">{text.language}</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {Object.entries(languages).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </header>
      {session.data?.authenticated && (
        <nav className="main-navigation" aria-label={text.library}>
          <NavLink to="/" end>
            <House size={18} aria-hidden="true" />
            {text.home}
          </NavLink>
          <NavLink to="/vocabulary">
            <LibraryBig size={18} aria-hidden="true" />
            {text.library}
          </NavLink>
          <NavLink to="/practice">{text.practice}</NavLink>
          <NavLink to="/settings">{text.settings}</NavLink>
          <button disabled={logout.isPending} onClick={() => logout.mutate()}>
            <LogOut size={18} aria-hidden="true" />
            <span>{text.logout}</span>
          </button>
        </nav>
      )}
      {!online && session.data?.authenticated && (
        <p className="connection-notice" role="status">
          {text.offlineNote}
        </p>
      )}
      {logout.isError && (
        <p className="error logout-error" role="alert">
          {text.errors[logout.error.code] || text.errors.request_failed}
        </p>
      )}
      <main id="main">
        {(!online || session.error?.code === "connection_error") &&
        !session.data?.authenticated ? (
          <section className="status" aria-labelledby="offline-title">
            <h1 id="offline-title">{text.offlineTitle}</h1>
            <p role="status">{text.offlineNote}</p>
            <button
              className="primary"
              disabled={!online}
              onClick={() => session.refetch()}
            >
              {text.retry}
            </button>
          </section>
        ) : session.isPending ? (
          <p className="status" role="status">
            {text.loading}
          </p>
        ) : session.isError ? (
          <div className="status">
            <p role="alert">
              {text.errors[session.error.code] || text.errors.request_failed}
            </p>
            <button className="primary" onClick={() => session.refetch()}>
              {text.retry}
            </button>
          </div>
        ) : !session.data.authenticated ? (
          <div className="gate-layout">
            <section className="gate-intro">
              <span className="eyebrow">
                <Leaf size={15} aria-hidden="true" />
                {text.gateLabel}
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
              <span className="lock-icon">
                <LockKeyhole size={24} aria-hidden="true" />
              </span>
              <h2>Italian Notebook</h2>
              <p>{text.gateNote}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  login.mutate();
                }}
              >
                <label htmlFor="password">{text.password}</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={login.isError ? "login-error" : undefined}
                  aria-invalid={login.isError}
                />
                {login.isError && (
                  <p id="login-error" className="error" role="alert">
                    {text.errors[login.error.code] ||
                      text.errors.request_failed}
                  </p>
                )}
                <button
                  className="primary"
                  type="submit"
                  disabled={login.isPending}
                >
                  {login.isPending ? text.entering : text.enter}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </form>
              <p className="privacy-note">{text.privacyNote}</p>
            </section>
          </div>
        ) : (
          <Routes>
            <Route
              path="/practice"
              element={
                <Practice
                  text={text}
                  csrf={session.data.csrf_token}
                  onLocked={lockNotebook}
                />
              }
            />
            <Route
              path="/settings"
              element={
                <Profiles
                  text={text}
                  csrf={session.data.csrf_token}
                  onLocked={lockNotebook}
                />
              }
            />
            <Route
              path="/vocabulary"
              element={
                <Library
                  text={text}
                  csrf={session.data.csrf_token}
                  onLocked={lockNotebook}
                />
              }
            />
            <Route
              path="/"
              element={
                <section className="home-page">
                  <span className="eyebrow">
                    <Leaf size={15} aria-hidden="true" />
                    ITALIAN NOTEBOOK
                  </span>
                  <h1>{text.welcome}</h1>
                  <p>{text.homeIntro}</p>
                  <Link className="primary" to="/practice">
                    {text.startPractice}
                  </Link>
                  <Link className="secondary" to="/vocabulary">
                    {text.openLibrary}
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                  <div className="home-note">
                    <BookOpen size={22} aria-hidden="true" />
                    <span>{text.tagline}</span>
                    <small>Ελληνικά ↔ Italiano</small>
                  </div>
                </section>
              }
            />
            <Route path="*" element={<Navigate to="/vocabulary" replace />} />
          </Routes>
        )}
      </main>
      <footer className="install-note">{text.installNote}</footer>
    </div>
  );
}
