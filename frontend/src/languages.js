/** Language choices and direction metadata hydrated from `/api/languages`.
 *
 * There is no static language list in the frontend. The API returns only the
 * curated, publicly available subset of the backend registry, including the
 * script, text direction, enhanced-grammar flag and explicit direction keys.
 */
import { useSyncExternalStore } from "react";

// Legacy identity belongs to historical text slots, not to the language list.
export const LEGACY_PAIR = ["el", "it"];

let current = null;
const listeners = new Set();

function normalize(payload) {
  const languages = Array.isArray(payload?.languages) ? payload.languages : [];
  const directions = Array.isArray(payload?.directions) ? payload.directions : [];
  return {
    languages,
    directions,
    ids: languages.map((language) => language.id),
    byId: new Map(languages.map((language) => [language.id, language])),
    byKey: new Map(directions.map((direction) => [direction.key, direction])),
  };
}

function notify() {
  for (const listener of listeners) listener();
}

export function hydrateLanguages(payload) {
  current = normalize(payload);
  notify();
}

export function resetLanguages() {
  current = null;
  notify();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return current;
}

/** Re-render a component when the registry response arrives. */
export function useLanguageRegistry() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function registry() {
  if (!current) throw new Error("The language registry has not been loaded.");
  return current;
}

export function languageIds() {
  return [...registry().ids];
}

/** Full curated catalogue rows for searchable pickers. */
export function languageOptions() {
  return [...registry().languages];
}

export function languageInfo(code) {
  return registry().byId.get(code);
}

export function languageLabel(code) {
  return registry().byId.get(code)?.label || String(code);
}

export function isSupportedLanguage(code) {
  return registry().byId.has(code);
}

export function samePair(first, second, otherFirst, otherSecond) {
  return (
    isSupportedLanguage(first) &&
    isSupportedLanguage(second) &&
    isSupportedLanguage(otherFirst) &&
    isSupportedLanguage(otherSecond) &&
    first !== second &&
    [first, second].sort().join() === [otherFirst, otherSecond].sort().join()
  );
}

export function isLegacyPair(first, second) {
  return samePair(first, second, ...LEGACY_PAIR);
}

/** Explicit direction key for an ordered pair, from the API's direction rows. */
export function directionKey(from, to) {
  const direction = registry().directions.find(
    (item) => item.prompt_language === from && item.answer_language === to,
  );
  if (!direction) throw new Error("Unsupported practice direction.");
  return direction.key;
}

/** Ordered [prompt, answer] language IDs for a directed practice key. */
export function directionLanguages(key) {
  const direction = registry().byKey.get(key);
  if (!direction) throw new Error("Unsupported practice direction.");
  return [direction.prompt_language, direction.answer_language];
}

/** Both directed keys for one unordered pair, in a stable order. */
export function pairDirections(first, second) {
  if (
    !isSupportedLanguage(first) ||
    !isSupportedLanguage(second) ||
    first === second
  )
    return [];
  return [directionKey(first, second), directionKey(second, first)];
}

export function isLegacyDirection(key) {
  return Boolean(registry().byKey.get(key)?.legacy);
}

/** Label a direction from its language IDs, not from its legacy key names. */
export function directionLabel(direction, label = languageLabel) {
  try {
    const [prompt, answer] = directionLanguages(direction);
    return `${label(prompt) || prompt} → ${label(answer) || answer}`;
  } catch {
    return String(direction || "").replace(/_to_/g, " → ");
  }
}
