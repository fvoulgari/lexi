import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import Library from "./Library.jsx";
import { copy } from "./copy.js";
import { collectionCopy } from "./collection-copy.js";

const owned = {
  id: "mine",
  name: "Mine",
  visibility: "private",
  can_edit: true,
  source_language: "el",
  target_language: "it",
};
const shared = {
  ...owned,
  id: "shared",
  name: "Shared",
  visibility: "published",
  can_edit: false,
  saved: true,
  owner_name: "Alba",
};
const published = {
  ...owned,
  id: "published",
  name: "Published",
  visibility: "published",
};
const existing = [owned, shared, published];
const sample = "italian,greek,word_type\nandare,πηγαίνω,verb";
const file = new File([sample], "cards.csv", { type: "text/csv" });
const result = {
  counts: { imported: 1, valid: 1, duplicate: 1, error: 1 },
  rows: [
    { row: 2, italian: "andare", greek: "πηγαίνω", status: "valid" },
    { row: 3, italian: "andare", greek: "πηγαίνω", status: "duplicate" },
    {
      row: 4,
      italian: "bad",
      greek: "",
      status: "error",
      errors: ["greek: required"],
    },
  ],
};
const server = setupServer(
  http.get("*/api/collections", () => HttpResponse.json(existing)),
  http.get("*/api/vocabulary", () =>
    HttpResponse.json({ items: [], total: 0 }),
  ),
  http.get("*/api/tags", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

function openLibrary(language = "en") {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Library
        text={copy[language]}
        language={language}
        csrf="csrf"
        onLocked={() => {}}
      />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function openImport(user, language = "en") {
  await user.click(
    screen.getByRole("button", { name: copy[language].toolsImport }),
  );
  return within(
    screen.getByRole("dialog", { name: copy[language].toolsImport }),
  );
}

test("preselects only an owned, editable private destination", async () => {
  const user = openLibrary();
  const scope = screen.getByRole("combobox", { name: "Collection" });
  await screen.findByRole("option", { name: "Mine" });
  await user.selectOptions(scope, "mine");
  const dialog = await openImport(user);
  expect(dialog.getByRole("combobox", { name: "Collection" })).toHaveValue(
    "mine",
  );
  expect(dialog.queryByRole("option", { name: "Shared" })).toBeNull();
  expect(dialog.queryByRole("option", { name: "Published" })).toBeNull();
  await user.click(dialog.getAllByRole("button", { name: copy.en.cancel })[0]);
  await user.selectOptions(scope, "shared");
  expect(
    screen.getByRole("option", { name: "Shared · By Alba" }).selected,
  ).toBe(true);
  expect(screen.getByRole("button", { name: copy.en.addEntry })).toBeDisabled();
  const next = await openImport(user);
  expect(next.getByRole("combobox", { name: "Collection" })).toHaveValue("");
  expect(next.getByRole("button", { name: copy.en.csvPreview })).toBeDisabled();
  await user.click(next.getAllByRole("button", { name: copy.en.cancel })[0]);
  await user.selectOptions(scope, "");
  await user.click(screen.getByRole("button", { name: copy.en.addEntry }));
  const form = within(screen.getByRole("form", { name: copy.en.addEntry }));
  expect(form.queryByRole("option", { name: /Shared/ })).toBeNull();
});

test("keeps the file and preview when changing destinations, then selects each new Collection", async () => {
  const created = [];
  const received = [];
  server.use(
    http.get("*/api/collections", () =>
      HttpResponse.json([...existing, ...created]),
    ),
    http.post("*/api/imports/preview", async ({ request }) => {
      const params = new URL(request.url).searchParams;
      expect(params.get("fixed_destination")).toBe("true");
      expect(await request.text()).toBe(sample);
      return HttpResponse.json(result);
    }),
    http.post("*/api/imports/confirm", async ({ request }) => {
      const params = new URL(request.url).searchParams;
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      expect(await request.text()).toBe(sample);
      const name = params.get("new_name");
      received.push(name);
      created.push({ ...owned, id: name, name, card_count: 1 });
      return HttpResponse.json({
        ...result,
        destination_collection: { id: name, name },
      });
    }),
  );
  const user = openLibrary();
  for (const name of ["Lezione 01", "Verbi"]) {
    const dialog = await openImport(user);
    await user.upload(dialog.getByLabelText("Choose CSV file"), file);
    await user.selectOptions(
      await dialog.findByRole("combobox", { name: "Collection" }),
      "mine",
    );
    await user.click(dialog.getByRole("button", { name: copy.en.csvPreview }));
    await dialog.findByRole("button", { name: "Import 1 card into Mine" });
    await user.click(dialog.getByRole("radio", { name: "New collection" }));
    expect(dialog.getByText("cards.csv")).toBeInTheDocument();
    expect(
      dialog.getByRole("button", { name: "Duplicates (1)" }),
    ).toBeInTheDocument();
    await user.type(
      dialog.getByRole("textbox", { name: "Collection name" }),
      name,
    );
    const confirm = await dialog.findByRole("button", {
      name: `Import 1 card into ${name}`,
    });
    expect(dialog.getByText("Private")).toBeInTheDocument();
    expect(
      dialog.getByRole("button", { name: `${copy.en.csvErrorRows} (1)` }),
    ).toBeInTheDocument();
    await user.dblClick(confirm);
    await screen.findByRole("heading", { name, exact: true });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Collection" })).toHaveValue(
        name,
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      `Imported into ${name}`,
    );
  }
  expect(received).toEqual(["Lezione 01", "Verbi"]);
});

test.each(["el", "it"])(
  "localizes the upload and destination controls in %s",
  async (language) => {
    const user = openLibrary(language);
    const dialog = await openImport(user, language);
    const text = collectionCopy[language];
    expect(dialog.getByLabelText(text.chooseCsv)).toHaveAttribute(
      "type",
      "file",
    );
    expect(
      dialog.getByRole("option", { name: text.chooseCollection }),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole("radio", { name: text.newCollection }));
    expect(dialog.getByLabelText(text.name)).toBeInTheDocument();
    expect(dialog.getByLabelText(text.sourceLanguage)).toBeInTheDocument();
  },
);
