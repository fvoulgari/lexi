import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { request } from "./api.js";
import {
  hydrateLanguages,
  languageIds,
  languageLabel,
  pairDirections,
} from "./languages.js";

const payload = {
  languages: [
    {
      id: "zz",
      label: "Registry Language",
      script: "Arab",
      text_direction: "rtl",
      enhanced: false,
    },
    {
      id: "en",
      label: "English",
      script: "Latn",
      text_direction: "ltr",
      enhanced: false,
    },
  ],
  directions: [
    {
      key: "custom_forward",
      prompt_language: "zz",
      answer_language: "en",
      legacy: false,
    },
    {
      key: "custom_reverse",
      prompt_language: "en",
      answer_language: "zz",
      legacy: false,
    },
  ],
};

const server = setupServer(
  http.get("*/api/languages", () => HttpResponse.json(payload)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function CatalogueView() {
  return (
    <div>
      <p data-testid="ids">{languageIds().join(",")}</p>
      <p data-testid="directions">{pairDirections("zz", "en").join(",")}</p>
      <p data-testid="label">{languageLabel("zz")}</p>
    </div>
  );
}

test("component data comes from the registry API response, not a local list", async () => {
  const response = await request("/api/languages");
  hydrateLanguages(response);
  render(<CatalogueView />);

  expect(screen.getByTestId("ids")).toHaveTextContent("zz,en");
  expect(screen.getByTestId("directions")).toHaveTextContent(
    "custom_forward,custom_reverse",
  );
  expect(screen.getByTestId("label")).toHaveTextContent("Registry Language");
});
