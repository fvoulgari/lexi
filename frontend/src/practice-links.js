import {
  LEGACY_PAIR,
  pairKey,
  safeDirectionKey,
  safeDirectionLanguages,
  safePairDirections,
} from "./languages.js";

/** Deterministic registry direction for a pair, never a Base/Learning guess. */
export function firstDirectionForLanguages(first, second) {
  return safePairDirections(first, second)[0] || null;
}

/** Unordered pair encoded by a registered direction key. */
export function practicePairForDirection(direction) {
  const languages = safeDirectionLanguages(direction);
  return languages.length ? pairKey(...languages) : null;
}

/** Practice URL carrying pair, direction and an optional collection filter. */
export function practiceUrl({
  mode,
  pair,
  direction,
  collection,
  collections = [],
} = {}) {
  const params = new URLSearchParams();
  const resolvedPair = pair || (direction && practicePairForDirection(direction));
  if (mode) params.set("mode", mode);
  if (resolvedPair) params.set("pair", resolvedPair);
  if (direction) params.set("direction", direction);
  const ids = [collection, ...collections].filter(Boolean);
  if (ids.length) params.set("collection", ids.join(","));
  const query = params.toString();
  return query ? `/practice?${query}` : "/practice";
}

export function practiceUrlForDirection(direction, options = {}) {
  return practiceUrl({
    ...options,
    pair: options.pair || practicePairForDirection(direction),
    direction,
  });
}

/** Practice URL for a collection, preserving its declared Base→Learning order. */
export function practiceUrlForCollection(collection, options = {}) {
  // Older collections predate pair metadata and describe the original course.
  const languages =
    collection?.source_language && collection?.target_language
      ? [collection.source_language, collection.target_language]
      : LEGACY_PAIR;
  const direction =
    options.direction ||
    safeDirectionKey(...languages) ||
    firstDirectionForLanguages(...languages);
  return practiceUrlForDirection(direction, {
    ...options,
    direction,
    pair: pairKey(...languages),
    collection: collection.id,
  });
}
