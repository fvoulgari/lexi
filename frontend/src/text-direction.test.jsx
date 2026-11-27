import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import CardPreview from "./CardPreview.jsx";
import CollectionCardForm from "./CollectionCardForm.jsx";
import { collectionCopy } from "./collection-copy.js";
import { copy } from "./copy.js";
import LanguagePicker from "./LanguagePicker.jsx";
import PracticeCardView from "./PracticeCardView.jsx";
import { hydrateLanguages } from "./languages.js";
import { REGISTRY_PAYLOAD } from "./language-fixtures.js";

const RTL_PAYLOAD = {
  languages: [
    ...REGISTRY_PAYLOAD.languages,
    {
      id: "ar",
      label: "Arabic",
      native_name: "العربية",
      script: "Arab",
      text_direction: "rtl",
      enhanced: false,
    },
  ],
  directions: [
    ...REGISTRY_PAYLOAD.directions,
    {
      key: "en_to_ar",
      prompt_language: "en",
      answer_language: "ar",
      legacy: false,
    },
    {
      key: "ar_to_en",
      prompt_language: "ar",
      answer_language: "en",
      legacy: false,
    },
  ],
};

const server = setupServer(
  http.get("*/api/tags", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

function withRegistry() {
  hydrateLanguages(RTL_PAYLOAD);
}

function wrap(children) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

test("card authoring inputs follow each side of a mixed pair and keep Unicode", async () => {
  withRegistry();
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(
    wrap(
      <CollectionCardForm
        pair={["en", "ar"]}
        collection={{}}
        text={copy.en}
        t={collectionCopy.en}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    ),
  );
  const english = screen.getByRole("textbox", { name: "English", exact: true });
  const arabic = screen.getByRole("textbox", { name: "Arabic", exact: true });
  expect(english).toHaveAttribute("lang", "en");
  expect(english).toHaveAttribute("dir", "ltr");
  expect(english).toHaveAttribute("data-script", "Latn");
  expect(arabic).toHaveAttribute("lang", "ar");
  expect(arabic).toHaveAttribute("dir", "rtl");
  expect(arabic).toHaveAttribute("data-script", "Arab");
  await user.type(english, "house");
  await user.type(arabic, "بيت");
  await user.selectOptions(screen.getByLabelText("Word type *"), "expression");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    source_text: "بيت",
    target_text: "house",
    source_language: "ar",
    target_language: "en",
  });
});

test("preview renders prompt and answer with their own directions", async () => {
  withRegistry();
  const user = userEvent.setup();
  const { container } = render(
    wrap(
      <CardPreview
        pair={["en", "ar"]}
        entry={{
          source_language: "en",
          target_language: "ar",
          source_text: "house",
          target_text: "بيت",
          word_type: "expression",
        }}
        text={copy.en}
        initiallyOpen
      />,
    ),
  );
  const prompt = container.querySelector(".card-prompt");
  expect(prompt).toHaveAttribute("dir", "ltr");
  expect(screen.queryByRole("heading", { name: "بيت" })).toBeNull();
  await user.click(screen.getByRole("button", { name: copy.en.revealAnswer }));
  const answer = screen.getByRole("heading", { name: "بيت" });
  expect(answer).toHaveAttribute("lang", "ar");
  expect(answer).toHaveAttribute("dir", "rtl");
  expect(answer).toHaveAttribute("data-script", "Arab");
});

test("practice renders an RTL prompt and an LTR answer for the reverse direction", () => {
  withRegistry();
  const { container } = render(
    <PracticeCardView
      entry={{
        source_language: "en",
        target_language: "ar",
        source_text: "house",
        target_text: "بيت",
        word_type: "expression",
      }}
      text={copy.en}
      direction="ar_to_en"
      revealed
    />,
  );
  expect(container.querySelector(".card-prompt")).toHaveAttribute("dir", "rtl");
  expect(screen.getByRole("heading", { name: "house" })).toHaveAttribute(
    "dir",
    "ltr",
  );
});

test("language picker native names use the language's own direction", async () => {
  withRegistry();
  const user = userEvent.setup();
  render(<LanguagePicker value="" onChange={() => {}} label="Language" />);
  await user.click(screen.getByRole("combobox", { name: "Language" }));
  const option = screen.getByRole("option", { name: /Arabic/ });
  expect(option.querySelector(".language-picker-native")).toHaveAttribute(
    "dir",
    "rtl",
  );
  expect(option.querySelector(".language-picker-native")).toHaveAttribute(
    "data-script",
    "Arab",
  );
});
