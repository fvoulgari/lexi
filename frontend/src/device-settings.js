import { useEffect, useState } from "react";

export function useMobileViewport() {
  const [media] = useState(() => window.matchMedia?.("(max-width: 760px)"));
  const [mobile, setMobile] = useState(() => media?.matches ?? false);
  useEffect(() => {
    if (!media) return;
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [media]);
  return mobile;
}

export function useDeviceSetting(key, values, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return values.includes(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Preferences still work when device storage is unavailable. */
    }
  }, [key, value]);
  return [value, setValue];
}

export function useReducedMotion(motion) {
  const [media] = useState(() =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)"),
  );
  const [systemReduced, setSystemReduced] = useState(
    () => media?.matches ?? false,
  );
  useEffect(() => {
    if (!media) return;
    const update = () => setSystemReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [media]);
  return motion === "reduce" || systemReduced;
}
