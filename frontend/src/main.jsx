import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";
import { request } from "./api.js";
import { initializeAuth } from "./auth.js";
import { hydrateLanguages } from "./languages.js";

initializeAuth();

const REGISTRY_CACHE = "lexi-language-registry";

function cachedRegistry() {
  try {
    return JSON.parse(localStorage.getItem(REGISTRY_CACHE));
  } catch {
    return null; // A corrupt cache must not block startup.
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000, networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

function render() {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

// The API is the only source of language data. Cache the response so an
// offline PWA can still start with the last curated catalogue.
request("/api/languages")
  .then((payload) => {
    try {
      localStorage.setItem(REGISTRY_CACHE, JSON.stringify(payload));
    } catch {
      // Storage may be unavailable; the in-memory registry still works.
    }
    hydrateLanguages(payload);
  })
  .catch(() =>
    hydrateLanguages(cachedRegistry() || { languages: [], directions: [] }),
  )
  .finally(render);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch(() => {
        // The online notebook remains usable if installation is unavailable.
      });
  });
}
