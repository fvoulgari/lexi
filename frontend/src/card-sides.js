/** Primary text follows explicit storage language; grammar stays language-named. */
export function cardText(card, language) {
  return language === (card.source_language || "it")
    ? (card.source_text ?? card.italian)
    : (card.target_text ?? card.greek);
}

export function directionLanguages(direction) {
  if (direction === "greek_to_italian") return ["el", "it"];
  if (direction === "italian_to_greek") return ["it", "el"];
  return direction.split("_to_");
}

export function practiceSides(card, direction) {
  const [prompt, answer] = directionLanguages(direction);
  return {
    prompt: cardText(card, prompt),
    answer: cardText(card, answer),
  };
}

export function cardLanguages(pair) {
  return pair.includes("el") && pair.includes("it")
    ? ["it", "el"]
    : [...pair].sort();
}
