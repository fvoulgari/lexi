/** UI mirror of backend/app/languages.py.
 *
 * Supported codes and directed keys come from one place so pair controls,
 * direction selectors and language attributes never infer a pair from a
 * position or a legacy field name. Legacy direction keys stay valid because
 * they name existing learning progress.
 */
export const LANGUAGES = ["da", "el", "en", "it"];
export const LEGACY_PAIR = ["el", "it"];
const LEGACY_DIRECTIONS = {
  greek_to_italian: ["el", "it"],
  italian_to_greek: ["it", "el"],
};

export function isSupportedLanguage(code) {
  return LANGUAGES.includes(code);
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

export function directionKey(from, to) {
  if (from === "el" && to === "it") return "greek_to_italian";
  if (from === "it" && to === "el") return "italian_to_greek";
  if (
    !isSupportedLanguage(from) ||
    !isSupportedLanguage(to) ||
    from === to
  )
    throw new Error("Unsupported practice direction.");
  return `${from}_to_${to}`;
}

/** Ordered [prompt, answer] language IDs for a directed practice key. */
export function directionLanguages(direction) {
  if (LEGACY_DIRECTIONS[direction]) return [...LEGACY_DIRECTIONS[direction]];
  const parts = String(direction || "").split("_to_");
  if (
    parts.length === 2 &&
    parts.every(isSupportedLanguage) &&
    parts[0] !== parts[1]
  )
    return parts;
  throw new Error("Unsupported practice direction.");
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

export function isLegacyDirection(direction) {
  return Object.hasOwn(LEGACY_DIRECTIONS, direction);
}

/** Label a direction from its language IDs, not from its legacy key names. */
export function directionLabel(direction, label) {
  try {
    const [prompt, answer] = directionLanguages(direction);
    return `${label(prompt) || prompt} → ${label(answer) || answer}`;
  } catch {
    return String(direction || "").replace(/_to_/g, " → ");
  }
}
