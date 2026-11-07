/** Primary text follows explicit storage language; grammar stays language-named. */
export function cardText(card, language) {
  return language === (card.source_language || "it")
    ? (card.source_text ?? card.italian)
    : (card.target_text ?? card.greek);
}

export function practiceSides(card, direction) {
  const languages =
    direction === "greek_to_italian"
      ? ["el", "it"]
      : direction === "italian_to_greek"
        ? ["it", "el"]
        : direction.split("_to_");
  return {
    prompt: cardText(card, languages[0]),
    answer: cardText(card, languages[1]),
  };
}

export function cardLanguages(pair) {
  return pair.includes("el") && pair.includes("it")
    ? ["it", "el"]
    : [...pair].sort();
}
