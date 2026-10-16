import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  LockKeyhole,
  ArrowRight,
  Leaf,
  House,
  LibraryBig,
  Layers,
  ChartNoAxesCombined,
  Settings,
  LogOut,
} from "lucide-react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { request } from "./api.js";
import { copy, languages } from "./copy.js";
import Library from "./Library.jsx";
import Profiles from "./Profiles.jsx";
import Practice from "./Practice.jsx";
import Progress from "./Progress.jsx";
import DeviceSettings from "./DeviceSettings.jsx";
import { useDeviceSetting, useReducedMotion } from "./device-settings.js";

export default function App() {
  const location = useLocation();
  const main = useRef(null);
  useEffect(() => {
    main.current?.focus();
  }, [location.pathname]);
  const [language, setLanguage] = useDeviceSetting(
    "notebook-language",
    Object.keys(copy),
    "el",
  );
  const [motion, setMotion] = useDeviceSetting(
    "notebook-motion",
    ["system", "reduce", "full"],
    "system",
  );
  const reducedMotion = useReducedMotion(motion);
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
    mutationFn: async () => {
      const freshSession = await request("/api/auth/session");
      await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
        headers: { "X-CSRF-Token": freshSession.csrf_token },
      });
      return freshSession;
    },
    onSuccess: (freshSession) => {
      setPassword("");
      queryClient.setQueryData(["session"], {
        ...freshSession,
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
  }, [language]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduce" : "full";
    return () => {
      delete document.documentElement.dataset.motion;
    };
  }, [reducedMotion]);

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
            Lexi
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
          <NavLink to="/practice">
            <Layers size={18} aria-hidden="true" />
            {text.practice}
          </NavLink>
          <NavLink to="/progress">
            <ChartNoAxesCombined size={18} aria-hidden="true" />
            {text.progress}
          </NavLink>
          <NavLink to="/settings">
            <Settings size={18} aria-hidden="true" />
            {text.settings}
          </NavLink>
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
      <main id="main" ref={main} tabIndex={-1}>
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
                <h2>{text.gateNote}</h2>
              </div>
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
                <>
                  <DeviceSettings
                    text={text}
                    language={language}
                    setLanguage={setLanguage}
                    reducedMotion={reducedMotion}
                    motion={motion}
                    setMotion={setMotion}
                  />
                  <Profiles
                    text={text}
                    csrf={session.data.csrf_token}
                    onLocked={lockNotebook}
                  />
                </>
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
              element={<Progress text={text} onLocked={lockNotebook} />}
            />
            <Route
              path="/progress"
              element={
                <Progress
                  key="detail"
                  text={text}
                  onLocked={lockNotebook}
                  detailed
                />
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
