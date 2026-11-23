/** Primary text follows explicit storage language; grammar stays language-named. */
import { directionLanguages } from "./languages.js";

export { directionLanguages };

export function cardLanguageIds(card) {
  return [card?.source_language || "it", card?.target_language || "el"];
}

export function cardText(card, language) {
  const [source, target] = cardLanguageIds(card);
  if (language === source) return card.source_text ?? card.italian;
  if (language === target) return card.target_text ?? card.greek;
  return null;
}

export function practiceSides(card, direction) {
  const [prompt, answer] = directionLanguages(direction);
  return {
    prompt: cardText(card, prompt),
    answer: cardText(card, answer),
  };
}

/** Canonical text-slot order for one pair; legacy cards keep it/el slots. */
export function cardLanguages(pair) {
  return pair.includes("el") && pair.includes("it")
    ? ["it", "el"]
    : [...pair].sort();
}
