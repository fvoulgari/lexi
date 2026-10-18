import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import VocabularyForm from "./VocabularyForm.jsx";
import { adjectiveFields } from "./grammar.js";
import { copy } from "./copy.js";

const unit = { id: "u", code: "00", title: "Benvenuti" };
const card = {
  id: "e",
  italian: "casa",
  greek: "σπίτι",
  word_type: "noun",
  italian_gender: "masculine",
  greek_gender: "neuter",
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
      "entry-word_type",
      "entry-unit_id",
      "entry-italian",
      "entry-greek",
    ]);
    expect(screen.getByLabelText(`${text.fields.italian} *`)).toHaveFocus();
    expect(screen.getByLabelText(text.fields.pronunciation)).not.toBeVisible();
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
    italian_gender: "masculine",
    greek_gender: "neuter",
    unit_id: "u",
    tag_ids: ["t"],
    ...optional,
    ...Object.fromEntries(adjectiveFields.map((field) => [field, null])),
    greek_pronunciation: null,
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
            { error: { code: "invalid_input", fields: ["pronunciation"] } },
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
  const notes = await screen.findByRole("textbox", {
    name: copy.en.fields.pronunciation,
  });
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
  expect(payload.pronunciation).toBe("Keep this draft");
});

test("card preview follows unsaved edits and both learning directions without writes", async () => {
  const writes = vi.fn();
  server.use(
    http.patch("*/api/vocabulary/:id", () => {
      writes();
      return HttpResponse.json({});
    }),
  );
  const saved = openForm({
    ...card,
    pronunciation: "old sound",
    notes: "old note",
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Preview card" }));
  const preview = screen.getByRole("region", { name: "Preview card" });
  expect(within(preview).getByText("σπίτι")).toBeVisible();
  expect(within(preview).queryByText("casa")).not.toBeInTheDocument();
  await user.click(
    within(preview).getByRole("button", { name: "Reveal answer" }),
  );
  expect(within(preview).getByRole("heading", { name: "casa" })).toBeVisible();
  await user.clear(screen.getByLabelText("Italian *"));
  await user.type(screen.getByLabelText("Italian *"), "la casa");
  await user.clear(screen.getByLabelText(copy.en.fields.pronunciation));
  await user.type(
    screen.getByLabelText(copy.en.fields.pronunciation),
    "new sound",
  );
  expect(
    within(preview).getByRole("heading", { name: "la casa" }),
  ).toBeVisible();
  expect(within(preview).getByText("new sound")).toBeVisible();
  expect(within(preview).queryByText("old note")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Word type *"), "verb");
  expect(within(preview).getByText(copy.en.verb)).toBeVisible();
  await user.selectOptions(
    within(preview).getByLabelText("Learning direction"),
    "italian_to_greek",
  );
  expect(within(preview).getByText("la casa")).toBeVisible();
  expect(within(preview).queryByText("σπίτι")).not.toBeInTheDocument();
  await user.click(
    within(preview).getByRole("button", { name: "Reveal answer" }),
  );
  expect(within(preview).getByRole("heading", { name: "σπίτι" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Hide preview" }));
  expect(
    screen.queryByRole("region", { name: "Preview card" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Italian *")).toHaveValue("la casa");
  expect(writes).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
});

for (const language of ["el", "it"]) {
  test(`preview controls are localized in ${language}`, async () => {
    const text = copy[language];
    openForm(card, text);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: text.cardPreview }));
    const preview = screen.getByRole("region", { name: text.cardPreview });
    expect(within(preview).getByText(text.cardPreviewHint)).toBeVisible();
    await user.click(
      within(preview).getByRole("button", { name: text.revealAnswer }),
    );
    expect(
      within(preview).getByRole("heading", { name: "casa" }),
    ).toBeVisible();
    expect(
      within(preview).getByRole("button", { name: text.cardHideAnswer }),
    ).toBeVisible();
  });
}

for (const editing of [false, true]) {
  for (const category of [
    "noun",
    "verb",
    "adjective",
    "adverb",
    "expression",
    "other",
  ]) {
    test(`${editing ? "edit" : "add"} shows only ${category} grammar and keeps common optional fields`, async () => {
      openForm(editing ? { ...card, word_type: category } : undefined);
      const user = userEvent.setup();
      if (!editing)
        await user.selectOptions(
          screen.getByLabelText("Word type *"),
          category,
        );
      if (category === "adjective") {
        await user.selectOptions(
          screen.getByLabelText(copy.en.fields.italian_adjective_gender),
          "masculine",
        );
        await user.selectOptions(
          screen.getByLabelText(copy.en.fields.greek_adjective_gender),
          "masculine",
        );
      }
      const details = screen
        .getByText(copy.en.cardOptionalDetails)
        .closest("details");
      if (!details.open)
        await user.click(screen.getByText(copy.en.cardOptionalDetails));
      for (const field of ["italian_example", "greek_example"])
        expect(screen.getByLabelText(copy.en.fields[field])).toBeVisible();
      expect(screen.getByLabelText(copy.en.fields.pronunciation)).toBeVisible();
      for (const field of [
        "italian_gender",
        "greek_gender",
        "italian_plural",
        "greek_plural",
      ]) {
        if (category === "noun")
          expect(screen.getByLabelText(copy.en.fields[field])).toBeVisible();
        else
          expect(
            screen.queryByLabelText(copy.en.fields[field]),
          ).not.toBeInTheDocument();
      }
      for (const field of [
        "italian_feminine_singular",
        "italian_masculine_plural",
        "italian_feminine_plural",
      ]) {
        if (category === "adjective")
          expect(
            within(
              screen.getByRole("group", { name: "Italian", exact: true }),
            ).getByLabelText(copy.en.fields[field]),
          ).toBeVisible();
        else
          expect(
            screen.queryByLabelText(copy.en.fields[field]),
          ).not.toBeInTheDocument();
      }
      if (category === "noun") {
        const italian = screen.getByLabelText("Italian gender");
        const greek = screen.getByLabelText("Greek gender");
        expect([...italian.options].map((option) => option.value)).toEqual([
          "",
          "masculine",
          "feminine",
        ]);
        expect([...greek.options].map((option) => option.value)).toEqual([
          "",
          "masculine",
          "feminine",
          "neuter",
        ]);
      }
    });
  }
}

test("category switching preserves all draft grammar but saves only compatible fields", async () => {
  let payload;
  server.use(
    http.patch("*/api/vocabulary/e", async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({
        entry: { ...card, ...payload },
        duplicate_ids: [],
      });
    }),
  );
  const onSaved = openForm({
    ...card,
    italian_plural: "i biglietti",
    greek_gender: "neuter",
    notes: "note",
  });
  const user = userEvent.setup();
  const type = screen.getByLabelText("Word type *");
  await user.selectOptions(type, "adjective");
  await user.selectOptions(
    screen.getByLabelText(copy.en.fields.italian_adjective_gender),
    "masculine",
  );
  await user.type(
    within(
      screen.getByRole("group", { name: "Italian", exact: true }),
    ).getByLabelText(copy.en.fields.italian_feminine_singular),
    "italiana",
  );
  await user.type(
    within(
      screen.getByRole("group", { name: "Italian", exact: true }),
    ).getByLabelText(copy.en.fields.italian_masculine_plural),
    "italiani",
  );
  await user.selectOptions(type, "noun");
  expect(screen.getByLabelText("Italian plural")).toHaveValue("i biglietti");
  expect(screen.getByLabelText("Greek gender")).toHaveValue("neuter");
  await user.selectOptions(type, "adjective");
  expect(
    within(
      screen.getByRole("group", { name: "Italian", exact: true }),
    ).getByLabelText(copy.en.fields.italian_feminine_singular),
  ).toHaveValue("italiana");
  expect(
    within(
      screen.getByRole("group", { name: "Italian", exact: true }),
    ).getByLabelText(copy.en.fields.italian_masculine_plural),
  ).toHaveValue("italiani");
  await user.selectOptions(type, "verb");
  await user.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  for (const field of [
    "italian_gender",
    "greek_gender",
    "italian_plural",
    "greek_plural",
    "italian_feminine_singular",
    "italian_masculine_plural",
    "italian_feminine_plural",
  ])
    expect(payload[field]).toBeNull();
  expect(payload).not.toHaveProperty("notes");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("legacy common genders open unset and save without inferring from articles", async () => {
  let payload;
  server.use(
    http.patch("*/api/vocabulary/e", async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({
        entry: { ...card, ...payload },
        duplicate_ids: [],
      });
    }),
  );
  const saved = openForm({
    ...card,
    italian: "l’artista",
    italian_gender: "common",
    greek_gender: "common",
  });
  expect(screen.getByLabelText("Italian gender")).toHaveValue("");
  expect(screen.getByLabelText("Greek gender")).toHaveValue("");
  expect(screen.getByLabelText("Italian *")).toHaveValue("l’artista");
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Greek gender"), "neuter");
  await user.selectOptions(screen.getByLabelText("Italian gender"), "feminine");
  await user.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(payload.italian_gender).toBe("feminine");
  expect(payload.greek_gender).toBe("neuter");
  expect(payload.italian).toBe("l’artista");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

for (const [language, genders] of [
  ["italian", ["masculine", "feminine"]],
  ["greek", ["masculine", "feminine", "neuter"]],
]) {
  test(`${language} adjective main gender orders forms without rewriting draft values`, async () => {
    openForm(undefined);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Word type *"), "adjective");
    await user.click(screen.getByText(copy.en.cardOptionalDetails));
    const group = screen.getByRole("group", {
      name: copy.en[language],
      exact: true,
    });
    const selector = screen.getByLabelText(
      copy.en.fields[`${language}_adjective_gender`],
    );
    expect(selector).toHaveValue("");
    expect(selector).toBeRequired();
    await user.selectOptions(selector, "masculine");
    expect([...selector.options].map((option) => option.value)).toEqual([
      "",
      ...genders,
    ]);
    const main = screen.getByLabelText(
      language === "italian" ? "Italian *" : "Greek *",
    );
    await user.type(main, language === "italian" ? "alta" : "ψηλή");
    const feminineSingular = within(group).getByLabelText(
      copy.en.fields[`${language}_feminine_singular`],
    );
    await user.type(feminineSingular, "kept feminine form");
    for (const gender of genders) {
      await user.selectOptions(selector, gender);
      const expected = [
        `${language}_${gender}_plural`,
        ...genders
          .filter((other) => other !== gender)
          .flatMap((other) => [
            `${language}_${other}_singular`,
            `${language}_${other}_plural`,
          ]),
      ];
      const inputs = [
        ...group.querySelectorAll(".entry-adjective-pair input"),
      ].map((input) => input.id.replace("entry-", ""));
      expect(inputs).toEqual(expected);
      expect(
        within(group).queryByLabelText(
          copy.en.fields[`${language}_${gender}_singular`],
        ),
      ).not.toBeInTheDocument();
      expect(main).toHaveValue(language === "italian" ? "alta" : "ψηλή");
    }
    await user.selectOptions(selector, "masculine");
    expect(
      within(group).getByLabelText(
        copy.en.fields[`${language}_feminine_singular`],
      ),
    ).toHaveValue("kept feminine form");
  });
}

test("both pronunciations accept independent free text and are saved for every category", async () => {
  let payload;
  server.use(
    http.patch("*/api/vocabulary/e", async ({ request }) => {
      payload = await request.json();
      return HttpResponse.json({
        entry: { ...card, ...payload },
        duplicate_ids: [],
      });
    }),
  );
  const onSaved = openForm({
    ...card,
    word_type: "adjective",
    italian_adjective_gender: "feminine",
    greek_adjective_gender: "neuter",
    pronunciation: "άλτα",
  });
  const user = userEvent.setup();
  expect(screen.getByLabelText(copy.en.fields.pronunciation)).toHaveValue(
    "άλτα",
  );
  await user.type(
    screen.getByLabelText(copy.en.fields.greek_pronunciation),
    "psee-LO",
  );
  for (const category of [
    "noun",
    "verb",
    "adjective",
    "adverb",
    "expression",
    "other",
  ]) {
    await user.selectOptions(screen.getByLabelText("Word type *"), category);
    expect(screen.getByLabelText(copy.en.fields.pronunciation)).toHaveValue(
      "άλτα",
    );
    expect(
      screen.getByLabelText(copy.en.fields.greek_pronunciation),
    ).toHaveValue("psee-LO");
  }
  await user.click(screen.getByRole("button", { name: "Save card" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(payload.pronunciation).toBe("άλτα");
  expect(payload.greek_pronunciation).toBe("psee-LO");
});

for (const category of ["noun", "adjective"]) {
  test(`${category} requires explicit Italian and Greek genders beside the main inputs`, async () => {
    let payload;
    server.use(
      http.post("*/api/vocabulary", async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({
          entry: { ...payload, id: "new" },
          duplicate_ids: [],
        });
      }),
    );
    const saved = openForm(undefined);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Italian *"),
      category === "noun" ? "l’artista" : "alta",
    );
    await user.type(
      screen.getByLabelText("Greek *"),
      category === "noun" ? "καλλιτέχνης" : "ψηλή",
    );
    await user.selectOptions(screen.getByLabelText("Word type *"), category);
    await user.selectOptions(screen.getByLabelText("Unit *"), "u");
    const italianField =
      category === "noun" ? "italian_gender" : "italian_adjective_gender";
    const greekField =
      category === "noun" ? "greek_gender" : "greek_adjective_gender";
    const italian = screen.getByLabelText(copy.en.fields[italianField]);
    const greek = screen.getByLabelText(copy.en.fields[greekField]);
    for (const select of [italian, greek]) {
      expect(select).toHaveValue("");
      expect(select).toBeRequired();
      expect(select.closest("details")).toBeNull();
      expect(select.closest("label")).toHaveTextContent("Gender *");
    }
    expect(italian.closest(".entry-main-language")).toContainElement(
      screen.getByLabelText("Italian *"),
    );
    expect(greek.closest(".entry-main-language")).toContainElement(
      screen.getByLabelText("Greek *"),
    );
    await user.click(screen.getByRole("button", { name: "Save card" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      copy.en.fields[italianField],
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      copy.en.fields[greekField],
    );
    expect(payload).toBeUndefined();
    await user.selectOptions(italian, "feminine");
    await user.click(screen.getByRole("button", { name: "Save card" }));
    expect(greek).toHaveFocus();
    expect(payload).toBeUndefined();
    await user.selectOptions(greek, "neuter");
    await user.click(screen.getByRole("button", { name: "Save card" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(payload[italianField]).toBe("feminine");
    expect(payload[greekField]).toBe("neuter");
    expect(payload).not.toHaveProperty("notes");
    expect(
      screen.queryByLabelText(copy.en.fields.notes),
    ).not.toBeInTheDocument();
  });
}

test("legacy noun missing genders opens without defaults and must be corrected before save", async () => {
  const saved = openForm({
    ...card,
    italian_gender: null,
    greek_gender: null,
    notes: "Archived",
  });
  const user = userEvent.setup();
  expect(screen.getByLabelText("Italian gender")).toHaveValue("");
  expect(screen.getByLabelText("Greek gender")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Save card" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Italian gender");
  expect(screen.getByRole("alert")).toHaveTextContent("Greek gender");
  expect(saved).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(copy.en.fields.notes)).not.toBeInTheDocument();
});

test("optional grammar precedes aligned example and single-line pronunciation rows", async () => {
  openForm({
    ...card,
    word_type: "adjective",
    italian_adjective_gender: "masculine",
    greek_adjective_gender: "masculine",
    italian_feminine_singular: "alta",
    greek_neuter_plural: "ψηλά",
  });
  const user = userEvent.setup();
  const details = screen
    .getByText(copy.en.cardOptionalDetails)
    .closest("details");
  if (!details.open)
    await user.click(screen.getByText(copy.en.cardOptionalDetails));
  expect(details.querySelectorAll("details")).toHaveLength(0);
  const italian = screen.getByRole("group", { name: "Italian", exact: true });
  const greek = screen.getByRole("group", { name: "Greek", exact: true });
  expect(
    within(italian).getByRole("heading", { name: "Feminine" }),
  ).toBeVisible();
  expect(within(greek).getByRole("heading", { name: "Neuter" })).toBeVisible();
  const pair = within(italian)
    .getByRole("heading", { name: "Feminine" })
    .closest(".entry-adjective-group");
  expect(
    [...pair.querySelectorAll("label")].map((label) => label.textContent),
  ).toEqual(["Singular", "Plural"]);
  expect(
    screen
      .getByLabelText(copy.en.fields.italian_example)
      .closest(".entry-examples"),
  ).toContainElement(screen.getByLabelText(copy.en.fields.greek_example));
  expect(
    screen
      .getByLabelText(copy.en.fields.pronunciation)
      .closest(".entry-pronunciations"),
  ).toContainElement(screen.getByLabelText(copy.en.fields.greek_pronunciation));
  for (const field of ["pronunciation", "greek_pronunciation"]) {
    const input = screen.getByLabelText(copy.en.fields[field]);
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("maxLength", "10000");
  }
  const grammar = details.querySelector(".entry-language-details");
  const examples = details.querySelector(".entry-examples");
  const pronunciations = details.querySelector(".entry-pronunciations");
  expect(
    grammar.compareDocumentPosition(examples) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    examples.compareDocumentPosition(pronunciations) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
