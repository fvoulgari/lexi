/** Language choices and direction metadata hydrated from `/api/languages`.
 *
 * There is no static language list in the frontend. The API returns only the
 * curated, publicly available subset of the backend registry, including the
 * script, text direction, enhanced-grammar flag and explicit direction keys.
 */
import { useSyncExternalStore } from "react";

// Legacy identity belongs to historical text slots, not to the language list.
export const LEGACY_PAIR = ["el", "it"];

// Shown before the full catalogue in every picker; the rest stays alphabetical.
export const POPULAR_LANGUAGE_IDS = ["en", "el", "it", "da", "es", "fr", "de", "ja"];

let current = null;
const listeners = new Set();

/** Accent- and case-insensitive comparison key for language search. */
export function searchKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function normalize(payload) {
  const languages = Array.isArray(payload?.languages) ? payload.languages : [];
  const directions = Array.isArray(payload?.directions) ? payload.directions : [];
  return {
    languages,
    directions,
    ids: languages.map((language) => language.id),
    byId: new Map(languages.map((language) => [language.id, language])),
    byKey: new Map(directions.map((direction) => [direction.key, direction])),
    byPair: new Map(
      directions.map((direction) => [
        `${direction.prompt_language}\u0000${direction.answer_language}`,
        direction,
      ]),
    ),
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

export function nativeLanguageName(code) {
  const language = registryInfo(code);
  return language?.native_name || language?.label || String(code);
}

export function languageAliases(code) {
  return registryInfo(code)?.aliases || [];
}

/** Curated options ranked for discovery, then by display label. */
export function popularLanguageOptions() {
  const options = languageOptions();
  const rank = new Map(
    POPULAR_LANGUAGE_IDS.map((id, index) => [id, index]),
  );
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const left = rank.get(a.option.id) ?? Number.MAX_SAFE_INTEGER;
      const right = rank.get(b.option.id) ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return a.index - b.index;
    })
    .map(({ option }) => option);
}

/** Search labels, native names, aliases and IDs without diacritic Sensitivity. */
export function searchLanguageOptions(query, exclude = []) {
  const needle = searchKey(query);
  const excluded = new Set(exclude);
  return languageOptions().filter((language) => {
    if (excluded.has(language.id)) return false;
    if (!needle) return true;
    return [
      language.label,
      language.native_name,
      ...(language.aliases || []),
      language.id,
    ].some((value) => searchKey(value).includes(needle));
  });
}

function registryInfo(code) {
  if (!code) return undefined;
  try {
    return languageInfo(code);
  } catch {
    // A card may be rendered before the catalogue arrives or may reference an
    // unregistered legacy code. Its own ID is still valid as a `lang` value.
    return undefined;
  }
}

/** Text direction for one language, always supplied by the registry. */
export function languageDirection(code) {
  const direction = registryInfo(code)?.text_direction;
  return direction === "rtl" || direction === "ltr" ? direction : undefined;
}

/** Script code for one language, used for script-level font fallbacks. */
export function languageScript(code) {
  return registryInfo(code)?.script || undefined;
}

/** Metadata attributes for any element containing text in one language.
 *
 * Spreading these keeps `lang`, `dir` and the script hint together, so mixed
 * pairs render each side with its own direction without per-language branches.
 * Interface text passes no language and therefore gets no attributes.
 */
export function languageTextProps(code) {
  if (!code) return {};
  return {
    lang: String(code),
    dir: languageDirection(code),
    "data-script": languageScript(code),
  };
}

export function isSupportedLanguage(code) {
  return registry().byId.has(code);
}

export function pairKey(source, target) {
  return [source, target].sort().join("-");
}

/** Canonical language IDs encoded in an unordered pair key, when supported. */
export function parsePairKey(key) {
  const [first, second] = String(key || "").split("-");
  try {
    if (
      !first ||
      !second ||
      first === second ||
      !isSupportedLanguage(first) ||
      !isSupportedLanguage(second) ||
      pairKey(first, second) !== key
    )
      return null;
    return [first, second];
  } catch {
    return null;
  }
}

/** Unordered pair key for a direction, or null for an unknown direction. */
export function directionPairKey(key) {
  const languages = safeDirectionLanguages(key);
  return languages.length ? pairKey(...languages) : null;
}

/** Pair directions without throwing when a stale snapshot has unknown IDs. */
export function safePairDirections(first, second) {
  try {
    return pairDirections(first, second);
  } catch {
    return [];
  }
}

/** Every unordered pair of available languages, in a stable order.
 *
 * Callers pass the IDs from `/api/languages`; `LEGACY_PAIR` is only a fallback
 * for contexts where the registry has not loaded yet.
 */
export function supportedPairs(ids = []) {
  const available = ids.length ? ids : [...LEGACY_PAIR];
  const priority = ["en", "el", "it"];
  const order = [
    ...priority.filter((code) => available.includes(code)),
    ...available.filter((code) => !priority.includes(code)),
  ];
  const seen = new Set();
  const pairs = [];
  for (const source of order) {
    for (const target of order) {
      if (source === target) continue;
      const key = pairKey(source, target);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ key, languages: [source, target] });
    }
  }
  return pairs;
}

export function pairLabel(languages, label = languageLabel) {
  return languages.map((code) => label(code)).join(" ↔ ");
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
  const direction = registry().byPair.get(`${from}\u0000${to}`);
  if (!direction) throw new Error("Unsupported practice direction.");
  return direction.key;
}

/** Explicit direction key for an ordered pair, or null when not registered. */
export function safeDirectionKey(from, to) {
  try {
    return directionKey(from, to);
  } catch {
    return null;
  }
}

/** Ordered [prompt, answer] language IDs for a directed practice key. */
export function directionLanguages(key) {
  const direction = registry().byKey.get(key);
  if (!direction) throw new Error("Unsupported practice direction.");
  return [direction.prompt_language, direction.answer_language];
}

/** True when a direction key is registered, without throwing on stale data. */
export function isRegisteredDirection(key) {
  try {
    directionLanguages(key);
    return true;
  } catch {
    return false;
  }
}

/** Language IDs for a direction, or an empty pair for stale/unknown keys. */
export function safeDirectionLanguages(key) {
  try {
    return directionLanguages(key);
  } catch {
    return [];
  }
}

/** Registered direction keys in catalogue order. */
export function registeredDirections() {
  return [...registry().directions.map((direction) => direction.key)];
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
