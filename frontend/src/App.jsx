import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  BookOpen,
  House,
  LibraryBig,
  Layers,
  ChartNoAxesCombined,
  Settings,
  LogOut,
} from "lucide-react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { request } from "./api.js";
import { notifySessionChanged } from "./auth.js";
import AuthGate from "./AuthGate.jsx";
import AccountCard from "./AccountCard.jsx";
import { AccountContext } from "./AccountContext.jsx";
import Admin from "./Admin.jsx";
import LegacyClaim, {
  captureLegacyClaim,
  LegacyRequest,
} from "./LegacyClaim.jsx";
import { copy, languages } from "./copy.js";
import Library from "./Library.jsx";
import SharedCollections from "./SharedCollections.jsx";
import Profiles from "./Profiles.jsx";
import Practice from "./Practice.jsx";
import Progress from "./Progress.jsx";
import DeviceSettings from "./DeviceSettings.jsx";
import MobileNavigation from "./MobileNavigation.jsx";
import {
  useDeviceSetting,
  useReducedMotion,
  useMobileViewport,
} from "./device-settings.js";

export default function App() {
  const location = useLocation();
  const main = useRef(null);
  useLayoutEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);
  const [language, setLocalLanguage] = useDeviceSetting(
    "notebook-language",
    Object.keys(copy),
    Object.keys(copy).includes(navigator.language?.split("-")[0])
      ? navigator.language.split("-")[0]
      : "el",
  );
  const reducedMotion = useReducedMotion("system");
  const mobile = useMobileViewport();
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
  const text = copy[language];
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => request("/api/auth/session"),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    enabled: online,
    networkMode: "always",
  });
  const capture = useQuery({
    queryKey: ["claim-capture"],
    queryFn: captureLegacyClaim,
    retry: false,
  });
  const onAuthenticated = useCallback(async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    const fresh = await request("/api/auth/session");
    queryClient.setQueryData(["session"], fresh);
    notifySessionChanged();
    return fresh;
  }, [queryClient]);
  const preferences = useMutation({
    mutationFn: ({ value }) =>
      request("/api/account", {
        method: "PATCH",
        headers: { "X-CSRF-Token": session.data?.csrf_token },
        body: JSON.stringify({ interface_language: value }),
      }),
    onSuccess: (account, { accountId: expectedId }) =>
      queryClient.setQueryData(["session"], (current) =>
        current?.authenticated &&
        current.account?.id === expectedId &&
        (!account.id || account.id === expectedId)
          ? {
              ...current,
              account: {
                ...current.account,
                interface_language: account.interface_language,
              },
            }
          : current,
      ),
  });
  const accountId = session.data?.account?.id;
  const languageInitialized = useRef(null);
  useEffect(() => {
    if (!accountId || languageInitialized.current === accountId) return;
    languageInitialized.current = accountId;
    const saved = session.data.account.interface_language;
    if (Object.keys(copy).includes(saved)) setLocalLanguage(saved);
    else preferences.mutate({ value: language, accountId });
  }, [accountId, session.data, preferences, language, setLocalLanguage]);
  function setLanguage(value) {
    setLocalLanguage(value);
    if (session.data?.authenticated)
      preferences.mutate({ value, accountId: session.data.account?.id });
  }
  const lockNotebook = useCallback(() => {
    const csrf = queryClient.getQueryData(["session"])?.csrf_token;
    queryClient.setQueryData(["session"], {
      authenticated: false,
      csrf_token: csrf,
    });
    void queryClient.cancelQueries();
    queryClient.removeQueries({
      predicate: (query) =>
        !["session", "claim-capture"].includes(query.queryKey[0]),
    });
  }, [queryClient]);
  useEffect(() => {
    window.addEventListener("lexi:unauthorized", lockNotebook);
    return () => window.removeEventListener("lexi:unauthorized", lockNotebook);
  }, [lockNotebook]);
  useEffect(() => {
    const changed = (event) => {
      if (event.key !== "lexi-session-change") return;
      lockNotebook();
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [lockNotebook, queryClient]);
  const logoutAll = useMutation({
    mutationFn: () =>
      request("/api/auth/logout-all", {
        method: "POST",
        headers: { "X-CSRF-Token": session.data.csrf_token },
      }),
    onSuccess: () => {
      lockNotebook();
      notifySessionChanged();
    },
  });
  const logout = useMutation({
    mutationFn: () =>
      request("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": session.data.csrf_token },
      }),
    onSuccess: () => {
      lockNotebook();
      notifySessionChanged();
    },
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
    <AccountContext.Provider value={session.data?.account || null}>
      <div className="notebook-app">
        <a className="skip-link" href="#main">
          {text.skip}
        </a>
        <header className="topbar">
          <Link className="brand" to="/">
            <span className="brand-icon">
              <BookOpen size={24} aria-hidden="true" />
            </span>
            <span>Lexi</span>
          </Link>
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
              <button
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <LogOut size={18} aria-hidden="true" />
                <span>{text.logout}</span>
              </button>
            </nav>
          )}
          {mobile && session.data?.authenticated && (
            <button
              className="mobile-lock"
              type="button"
              aria-label={text.logout}
              title={text.logout}
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut size={20} aria-hidden="true" />
            </button>
          )}
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
        {preferences.isError && (
          <p role="alert" className="error">
            {text.actionFailed}
          </p>
        )}
        {session.data?.authenticated && location.state?.claimCompleted && (
          <p role="status" className="connection-notice">
            {text.claimDone}
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
          ) : capture.isPending ? (
            <p className="status" role="status">
              {text.loading}
            </p>
          ) : capture.isError && location.pathname === "/claim" ? (
            <p className="status" role="alert">
              {text.claimInvalid}
            </p>
          ) : location.pathname.startsWith("/auth/") ||
            !session.data.authenticated ? (
            capture.isPending ? (
              <p className="status" role="status">
                {text.loading}
              </p>
            ) : capture.isError && location.pathname === "/claim" ? (
              <p className="status" role="alert">
                {text.claimInvalid}
              </p>
            ) : (
              <AuthGate
                text={text}
                onAuthenticated={onAuthenticated}
                verificationRequired={session.data?.verification_required}
              />
            )
          ) : (
            <PrivateAccountBoundary
              key={`${accountId}:${session.data.account?.role}:${session.data.account?.legacy_access}:${session.data.account?.profile_id}`}
            >
              <Routes>
                <Route
                  path="/collections"
                  element={
                    <SharedCollections
                      language={language}
                      csrf={session.data.csrf_token}
                    />
                  }
                />
                <Route
                  path="/claim"
                  element={
                    <LegacyClaim
                      text={text}
                      csrf={session.data.csrf_token}
                      onSessionChanged={() =>
                        queryClient.invalidateQueries({ queryKey: ["session"] })
                      }
                    />
                  }
                />
                <Route
                  path="/admin"
                  element={
                    session.data.account?.role === "admin" ? (
                      <Admin
                        text={text}
                        csrf={session.data.csrf_token}
                        onSessionChanged={() =>
                          queryClient.invalidateQueries({
                            queryKey: ["session"],
                          })
                        }
                      />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
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
                    <section
                      className="settings-page"
                      aria-labelledby="settings-page-title"
                    >
                      <header className="settings-heading">
                        <h1 id="settings-page-title">
                          {text.settingsPageTitle}
                        </h1>
                      </header>
                      <AccountCard
                        text={text}
                        account={session.data.account}
                        logoutAll={logoutAll}
                        onLocked={lockNotebook}
                      />
                      <Profiles
                        text={text}
                        csrf={session.data.csrf_token}
                        onLocked={lockNotebook}
                      />
                      <LegacyRequest
                        text={text}
                        csrf={session.data.csrf_token}
                      />
                      <DeviceSettings
                        text={text}
                        language={language}
                        setLanguage={setLanguage}
                      />
                    </section>
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
                <Route
                  path="*"
                  element={<Navigate to="/vocabulary" replace />}
                />
              </Routes>
            </PrivateAccountBoundary>
          )}
        </main>
        <footer className="install-note">{text.installNote}</footer>
        {mobile && session.data?.authenticated && (
          <MobileNavigation text={text} />
        )}
      </div>
    </AccountContext.Provider>
  );
}

// Private caches are recreated synchronously whenever the authenticated account changes.
// Even a cross-tab cookie change cannot render the previous account's query data.
function PrivateAccountBoundary({ children }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 30_000, networkMode: "always" },
          mutations: { networkMode: "always" },
        },
      }),
  );
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
