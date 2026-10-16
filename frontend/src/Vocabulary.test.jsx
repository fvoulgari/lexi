import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  test,
  expect,
} from "vitest";
import App from "./App.jsx";
let entries;
const server = setupServer(
  http.get("*/api/auth/session", () =>
    HttpResponse.json({ authenticated: true, csrf_token: "csrf" }),
  ),
  http.get("*/api/tags", () => HttpResponse.json([])),
  http.get("*/api/vocabulary", () =>
    HttpResponse.json({
      items: entries,
      total: entries.length,
      page: 1,
      page_size: 6,
    }),
  ),
  http.get("*/api/units", () =>
    HttpResponse.json([{ id: "u", code: "00", title: "Benvenuti" }]),
  ),
  http.post("*/api/vocabulary", async ({ request }) => {
    expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
    const entry = { id: "new", ...(await request.json()) };
    entries.push(entry);
    return HttpResponse.json({ entry, duplicate_ids: [] }, { status: 201 });
  }),
  http.patch("*/api/vocabulary/:id", async ({ request, params }) => {
    expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
    const body = await request.json();
    entries = entries.map((entry) =>
      entry.id === params.id ? { ...entry, ...body } : entry,
    );
    return HttpResponse.json({
      entry: entries.find((entry) => entry.id === params.id),
      duplicate_ids: [],
    });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("notebook-language", "en");
  entries = [
    {
      id: "house",
      italian: "la casa",
      greek: "το σπίτι",
      word_type: "noun",
      italian_gender: "feminine",
      greek_gender: "neuter",
      notes: "Home",
    },
  ];
});
function openLibrary() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter initialEntries={["/vocabulary"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
test("add a complete bilingual meaning and edit it from the library", async () => {
  openLibrary();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New card" }));
  await user.type(screen.getByLabelText("Italian *"), "il perché");
  await user.type(screen.getByLabelText("Greek *"), "το γιατί");
  await user.selectOptions(screen.getByLabelText("Word type *"), "noun");
  await user.selectOptions(
    screen.getByLabelText("Italian gender"),
    "masculine",
  );
  await user.selectOptions(screen.getByLabelText("Greek gender"), "neuter");
  await user.type(screen.getByLabelText("Italian plural"), "i perché");
  await user.type(screen.getByLabelText("Greek plural"), "τα γιατί");
  await user.type(
    screen.getByLabelText("Italian example"),
    "Non so il perché.",
  );
  await user.type(screen.getByLabelText("Greek example"), "Δεν ξέρω το γιατί.");
  await user.type(screen.getByLabelText("Pronunciation text"), "perˈke");
  await user.click(screen.getByRole("button", { name: "Save card" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Card saved.");
  expect(
    await screen.findByRole("heading", { name: "il perché" }),
  ).toBeInTheDocument();
  await user.click(await cardAction("Edit card: il perché"));
  expect(screen.getByLabelText("Italian gender")).toHaveValue("masculine");
  expect(screen.getByLabelText("Greek example")).toHaveValue(
    "Δεν ξέρω το γιατί.",
  );
  await user.clear(screen.getByLabelText("Italian *"));
  await user.type(screen.getByLabelText("Italian *"), "il motivo");
  await user.click(screen.getByRole("button", { name: "Save card" }));
  expect(
    await screen.findByRole("heading", { name: "il motivo" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "il perché" }),
  ).not.toBeInTheDocument();
});

test("required fields are identified and failed saves keep the draft for retry", async () => {
  let failed = true;
  server.use(
    http.post("*/api/vocabulary", async ({ request }) => {
      if (failed)
        return HttpResponse.json(
          { error: { code: "invalid_input", fields: ["italian"] } },
          { status: 422 },
        );
      const entry = { id: "retry", ...(await request.json()) };
      entries.push(entry);
      return HttpResponse.json({ entry, duplicate_ids: [] }, { status: 201 });
    }),
  );
  openLibrary();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New card" }));
  await user.click(screen.getByRole("button", { name: "Save card" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Italian, Greek, Word type",
  );
  expect(screen.getByLabelText("Italian *")).toHaveFocus();
  await user.type(screen.getByLabelText("Italian *"), "è");
  await user.type(screen.getByLabelText("Greek *"), "είναι");
  await user.selectOptions(screen.getByLabelText("Word type *"), "verb");
  await user.click(screen.getByRole("button", { name: "Save card" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check these fields: Italian",
  );
  expect(screen.getByLabelText("Italian *")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("Greek *")).toHaveValue("είναι");
  expect(screen.getByLabelText("Italian *")).toHaveFocus();
  failed = false;
  await user.click(screen.getByRole("button", { name: "Save card" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Card saved.");
});

test("matching-pair warnings appear after save and all interface languages retain the draft", async () => {
  server.use(
    http.post("*/api/vocabulary", async ({ request }) => {
      const entry = { id: "duplicate", ...(await request.json()) };
      entries.push(entry);
      return HttpResponse.json(
        { entry, duplicate_ids: ["house"] },
        { status: 201 },
      );
    }),
  );
  openLibrary();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New card" }));
  await user.type(screen.getByLabelText("Italian *"), "la casa");
  await user.type(screen.getByLabelText("Greek *"), "το σπίτι");
  await user.selectOptions(screen.getByLabelText("Word type *"), "noun");
  await user.selectOptions(screen.getByLabelText("Interface language"), "el");
  expect(screen.getByLabelText("Ιταλικά *")).toHaveValue("la casa");
  expect(screen.getByLabelText("Ελληνικά *")).toHaveValue("το σπίτι");
  await user.selectOptions(screen.getByLabelText("Γλώσσα εφαρμογής"), "it");
  expect(screen.getByLabelText("Italiano *")).toHaveValue("la casa");
  expect(screen.getByLabelText("Tipo di parola *")).toHaveValue("noun");
  await user.click(screen.getByRole("button", { name: "Salva scheda" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Esiste già una coppia italiano–greco corrispondente",
  );
  await user.selectOptions(
    screen.getByLabelText("Lingua dell’interfaccia"),
    "en",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "A matching Italian–Greek pair already exists",
  );
});

test("cancel restores focus and a connection error allows retry without losing text", async () => {
  server.use(http.patch("*/api/vocabulary/:id", () => HttpResponse.error()));
  openLibrary();
  const user = userEvent.setup();
  await user.click(await cardAction("Edit card: la casa"));
  await user.type(screen.getByLabelText("Notes"), " — σπίτι");
  await user.click(screen.getByRole("button", { name: "Save card" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check your connection",
  );
  expect(screen.getByLabelText("Notes")).toHaveValue("Home — σπίτι");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New card" })).toHaveFocus();
});

test("a pending save prevents switching to another card until completion", async () => {
  let finishSave;
  const responseReady = new Promise((resolve) => {
    finishSave = resolve;
  });
  server.use(
    http.patch("*/api/vocabulary/:id", async ({ request }) => {
      const body = await request.json();
      await responseReady;
      entries[0] = { ...entries[0], ...body };
      return HttpResponse.json({ entry: entries[0], duplicate_ids: [] });
    }),
  );
  openLibrary();
  const user = userEvent.setup();
  await user.click(await cardAction("Edit card: la casa"));
  await user.type(screen.getByLabelText("Notes"), " — revised");
  await user.click(screen.getByRole("button", { name: "Save card" }));
  try {
    expect(
      await screen.findByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "New card" })).toBeDisabled();
    expect(screen.getByRole("button", {name: "Card actions: la casa"})).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  } finally {
    finishSave();
  }
  expect(await screen.findByRole("status")).toHaveTextContent("Card saved.");
  expect(screen.getByRole("button", { name: "New card" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "New card" }));
  await user.type(screen.getByLabelText("Italian *"), "nuovo");
  expect(screen.getByLabelText("Italian *")).toHaveValue("nuovo");
});

test("delete confirms the meaning, explains review protection, and retries a failed deletion", async () => {
  let protectedEntry = true;
  server.use(
    http.delete("*/api/vocabulary/:id", ({ request, params }) => {
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      if (protectedEntry)
        return HttpResponse.json(
          { error: { code: "entry_reviewed" } },
          { status: 409 },
        );
      entries = entries.filter((e) => e.id !== params.id);
      return HttpResponse.json({ deleted: params.id });
    }),
  );
  openLibrary();
  const user = userEvent.setup();
  await user.click(await cardAction("Delete card: la casa"));
  expect(screen.getByRole("dialog")).toHaveTextContent("la casa");
  expect(screen.getByRole("dialog")).toHaveTextContent("το σπίτι");
  await user.click(screen.getByRole("button", { name: "Permanently delete" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This card has reviews and cannot be deleted.",
  );
  expect(screen.getByRole("heading", { name: "la casa" })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Interface language"), "el");
  expect(screen.getByRole("alert")).toHaveTextContent("έχει αξιολογήσεις");
  await user.selectOptions(screen.getByLabelText("Γλώσσα εφαρμογής"), "it");
  expect(screen.getByRole("alert")).toHaveTextContent("ha delle revisioni");
  await user.selectOptions(
    screen.getByLabelText("Lingua dell’interfaccia"),
    "en",
  );
  protectedEntry = false;
  await user.click(screen.getByRole("button", { name: "Permanently delete" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Card deleted.");
  expect(
    screen.queryByRole("heading", { name: "la casa" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New card" })).toHaveFocus();
});

test("cancel and Escape restore delete focus; connection failures retain the confirmation", async () => {
  server.use(http.delete("*/api/vocabulary/:id", () => HttpResponse.error()));
  openLibrary();
  const user = userEvent.setup();
  const action = await cardAction("Delete card: la casa");
  await user.click(action);
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Card actions: la casa")).toHaveFocus();
  await user.click(await cardAction("Delete card: la casa"));
  await user.click(screen.getByRole("button", { name: "Permanently delete" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check your connection",
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "la casa" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Card actions: la casa")).toHaveFocus();
});

async function cardAction(name) {
  const italian = name.split(": ").slice(1).join(": ");
  const summary = await screen.findByLabelText(
    `${name.startsWith("Modifica") ? "Azioni scheda" : "Card actions"}: ${italian}`,
  );
  if (summary.getAttribute("aria-expanded") !== "true") await userEvent.click(summary);
  return screen.getByRole("menuitem", { name });
}

test("floating card actions support one open menu, keyboard navigation and dismissal", async () => {
  entries.push({id: "book", italian: "il libro", greek: "το βιβλίο", word_type: "noun"});
  openLibrary();
  const user = userEvent.setup();
  const house = await screen.findByRole("button", {name: "Card actions: la casa"});
  house.focus();
  await user.keyboard("{ArrowDown}");
  const edit = screen.getByRole("menuitem", {name: "Edit card: la casa"});
  const remove = screen.getByRole("menuitem", {name: "Delete card: la casa"});
  expect(edit).toHaveFocus();
  expect(screen.getByRole("menu").parentElement).toBe(document.body);
  await user.keyboard("{ArrowDown}");
  expect(remove).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(edit).toHaveFocus();
  await user.keyboard("{End}");
  expect(remove).toHaveFocus();
  await user.keyboard("{Home}");
  expect(edit).toHaveFocus();
  await user.keyboard("d");
  expect(remove).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(house).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("menuitem", {name: "Delete card: la casa"})).toHaveFocus();
  const book = screen.getByRole("button", {name: "Card actions: il libro"});
  await user.click(book);
  expect(screen.getAllByRole("menu")).toHaveLength(1);
  expect(house).toHaveAttribute("aria-expanded", "false");
  expect(book).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("heading", {name: "Your vocabulary"}));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(book).toHaveFocus();
  await user.click(book);
  await user.keyboard("{Tab}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(house);
  await user.click(screen.getByRole("menuitem", {name: "Delete card: la casa"}));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", {name: "Cancel"})).toHaveFocus();
  await user.click(screen.getByRole("button", {name: "Cancel"}));
  expect(house).toHaveFocus();
});
