import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import VocabularyForm from "./VocabularyForm.jsx";
import { copy } from "./copy.js";

const unit = { id: "u", code: "00", title: "Benvenuti" };
const card = {
  id: "e",
  italian: "casa",
  greek: "σπίτι",
  word_type: "noun",
  unit,
};
const server = setupServer(
  http.get("*/api/units", () => HttpResponse.json([unit])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

function openForm(entry, text = copy.en) {
  const onSaved = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <VocabularyForm
        entry={entry}
        text={text}
        csrf="csrf"
        onSaved={onSaved}
        onCancel={() => {}}
        onLocked={() => {}}
        onSavingChange={() => {}}
      />
    </QueryClientProvider>,
  );
  return onSaved;
}

for (const language of ["el", "en", "it"]) {
  test(`new card has required fields first and collapsed optional details in ${language}`, async () => {
    const text = copy[language];
    openForm(undefined, text);
    const disclosure = screen
      .getByText(text.cardOptionalDetails)
      .closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText(text.meaningHint)).toBeVisible();
    expect(screen.getByText(text.cardRequiredHint)).toBeVisible();
    const form = disclosure.closest("form");
    expect(
      [...form.querySelectorAll("[required]")].map((field) => field.id),
    ).toEqual([
      "entry-italian",
      "entry-greek",
      "entry-word_type",
      "entry-unit_id",
    ]);
    expect(screen.getByLabelText(`${text.fields.italian} *`)).toHaveFocus();
    expect(screen.getByLabelText(text.cardPronunciation)).not.toBeVisible();
    expect(
      await screen.findByRole("button", { name: text.saveEntry }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: text.cancel })).toBeVisible();
  });
}

test("editing without optional information starts collapsed", () => {
  openForm(card);
  expect(screen.getByText(copy.en.cardEditHint)).toBeVisible();
  expect(
    screen.getByText("Optional details").closest("details"),
  ).not.toHaveAttribute("open");
});

test("editing opens existing details and collapsing preserves every value and hidden tags in the payload", async () => {
  const optional = {
    italian_gender: "feminine",
    greek_gender: "neuter",
    italian_plural: "case",
    greek_plural: "σπίτια",
    italian_example: "La casa è grande.",
    greek_example: "Το σπίτι είναι μεγάλο.",
    pronunciation: "ˈkaza",
    notes: "A home",
  };
  let payload;
  server.use(
    http.patch("*/api/vocabulary/e", async ({ request }) => {
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      payload = await request.json();
      return HttpResponse.json({
        entry: { ...card, ...payload },
        duplicate_ids: [],
      });
    }),
  );
  const onSaved = openForm({
    ...card,
    ...optional,
    tags: [{ id: "t", name: "Daily" }],
  });
  const disclosure = screen.getByText("Optional details").closest("details");
  expect(disclosure).toHaveAttribute("open");
  const user = userEvent.setup();
  await user.click(screen.getByText("Optional details"));
  expect(disclosure).not.toHaveAttribute("open");
  await user.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(payload).toEqual({
    italian: card.italian,
    greek: card.greek,
    word_type: "noun",
    unit_id: "u",
    tag_ids: ["t"],
    ...optional,
  });
});

test("an optional-field server error opens details before focusing it and preserves the draft for retry", async () => {
  let failing = true;
  let payload;
  server.use(
    http.patch("*/api/vocabulary/e", async ({ request }) => {
      payload = await request.json();
      return failing
        ? HttpResponse.json(
            { error: { code: "invalid_input", fields: ["notes"] } },
            { status: 422 },
          )
        : HttpResponse.json({
            entry: { ...card, ...payload },
            duplicate_ids: [],
          });
    }),
  );
  const onSaved = openForm(card);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Save card" }));
  const notes = await screen.findByRole("textbox", { name: "Notes" });
  expect(
    screen.getByText("Optional details").closest("details"),
  ).toHaveAttribute("open");
  await waitFor(() => expect(notes).toHaveFocus());
  expect(notes).toHaveAttribute("aria-invalid", "true");
  await user.type(notes, "Keep this draft");
  await user.click(screen.getByText("Optional details"));
  failing = false;
  await user.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(payload.notes).toBe("Keep this draft");
});
