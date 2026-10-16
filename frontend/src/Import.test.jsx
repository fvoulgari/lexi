import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterAll, afterEach, test, expect } from "vitest";
import Library from "./Library.jsx";
import { copy } from "./copy.js";
const report = {
  counts: { imported: 0, valid: 1, skipped: 1, duplicate: 0, error: 1 },
  proposed_units: [{ code: "07", title: "Domande", sort_order: 0 }],
  proposed_tags: ["questions"],
  rows: [
    {
      row: 2,
      italian: "il perché",
      greek: "το γιατί",
      status: "valid",
      entry: {
        word_type: "noun",
        italian_gender: "masculine",
        pronunciation: "perˈke",
      },
      errors: [],
    },
    {
      row: 3,
      italian: "bad",
      greek: "",
      status: "error",
      errors: ["greek: required"],
    },
  ],
};
const server = setupServer(
  http.get("*/api/units", () => HttpResponse.json([])),
  http.get("*/api/tags", () => HttpResponse.json([])),
  http.get("*/api/vocabulary", () =>
    HttpResponse.json({ items: [], total: 0 }),
  ),
  http.post("*/api/imports/preview", async ({ request }) => {
    expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
    expect(await request.text()).toContain("το γιατί");
    return HttpResponse.json(report);
  }),
  http.post("*/api/imports/confirm", () =>
    HttpResponse.json({
      ...report,
      counts: { ...report.counts, imported: 1 },
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
test("upload previews rows and proposed metadata before explicit confirmation", async () => {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Library text={copy.en} csrf="csrf" onLocked={() => {}} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Import CSV" }));
  await user.upload(
    screen.getByLabelText("CSV file"),
    new File(
      ["italian,greek,word_type\nil perché,το γιατί,noun\n"],
      "vocabulary.csv",
      { type: "text/csv" },
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Confirm import" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByText("greek: required")).toBeInTheDocument();
  expect(screen.getByText("07 — Domande")).toBeInTheDocument();
  expect(screen.getByText("questions")).toBeInTheDocument();
  await user.click(screen.getByText("Card details"));
  expect(screen.getByText("Italian gender")).toBeInTheDocument();
  expect(screen.getByText("Pronunciation text")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm import" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Imported: 1");
  await user.click(screen.getByRole("button", { name: "Import CSV" }));
  expect(screen.getByRole("status", { hidden: true })).not.toBeVisible();
  await user.click(screen.getByRole("button", { name: "Import CSV" }));
  expect(screen.getByRole("status")).toHaveTextContent("Imported: 1");
  expect(
    screen.queryByRole("button", { name: "Confirm import" }),
  ).not.toBeInTheDocument();
});

test("failed confirmation retains preview for retry and changing file clears it", async () => {
  server.use(http.post("*/api/imports/confirm", () => HttpResponse.error()));
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Library text={copy.en} csrf="csrf" onLocked={() => {}} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Import CSV" }));
  const file = new File(
    ["italian,greek,word_type\nil perché,το γιατί,noun\n"],
    "test.csv",
    { type: "text/csv" },
  );
  await user.upload(screen.getByLabelText("CSV file"), file);
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await user.click(
    await screen.findByRole("button", { name: "Confirm import" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check your connection",
  );
  expect(screen.getByRole("button", { name: "Confirm import" })).toBeEnabled();
  await user.upload(
    screen.getByLabelText("CSV file"),
    new File(["new"], "new.csv", { type: "text/csv" }),
  );
  expect(
    screen.queryByRole("button", { name: "Confirm import" }),
  ).not.toBeInTheDocument();
});

test("interface language changes retain the file and preview", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (text) => (
    <QueryClientProvider client={client}>
      <Library text={text} csrf="csrf" onLocked={() => {}} />
    </QueryClientProvider>
  );
  const rendered = render(view(copy.en));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Import CSV" }));
  await user.upload(
    screen.getByLabelText("CSV file"),
    new File(
      ["italian,greek,word_type\nil perché,το γιατί,noun\n"],
      "test.csv",
      { type: "text/csv" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("button", { name: "Confirm import" });
  rendered.rerender(view(copy.el));
  expect(
    screen.getByRole("button", { name: "Επιβεβαίωση εισαγωγής" }),
  ).toBeEnabled();
  expect(screen.getByLabelText("Αρχείο CSV").files[0].name).toBe("test.csv");
  rendered.rerender(view(copy.it));
  expect(
    screen.getByRole("button", { name: "Conferma importazione" }),
  ).toBeEnabled();
});

test.each(["success", "error"])(
  "a pending preview reopens the panel on %s",
  async (outcome) => {
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    server.use(
      http.post("*/api/imports/preview", async () => {
        await pending;
        return outcome === "success"
          ? HttpResponse.json(report)
          : HttpResponse.json(
              { error: { code: "invalid_csv", message: "Invalid row" } },
              { status: 422 },
            );
      }),
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Library text={copy.en} csrf="csrf" onLocked={() => {}} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const toggle = screen.getByRole("button", { name: "Import CSV" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls"));
    expect(panel).not.toBeVisible();
    await user.click(toggle);
    expect(
      screen.getByText("CSV format and requirements").closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    const file = new File(
      ["italian,greek,word_type\nil perché,το γιατί,noun\n"],
      "pending.csv",
      { type: "text/csv" },
    );
    await user.upload(screen.getByLabelText("CSV file"), file);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    await user.click(toggle);
    expect(panel).not.toBeVisible();
    finish();
    if (outcome === "success") {
      expect(
        await screen.findByRole("button", { name: "Confirm import" }),
      ).toBeVisible();
      expect(screen.getByRole("heading", { name: "Preview" })).toHaveFocus();
    } else {
      expect(await screen.findByRole("alert")).toHaveTextContent("Invalid row");
    }
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(screen.getByLabelText("CSV file").files[0]).toBe(file);
  },
);

test.each(["el", "en", "it"])(
  "inline CSV example toggles without changing headers or selected file in %s",
  async (language) => {
    const text = copy[language];
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Library text={text} csrf="csrf" onLocked={() => {}} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: text.toolsImport }));
    const toggle = screen.getByRole("button", { name: text.csvViewExample });
    const example = document.getElementById(
      toggle.getAttribute("aria-controls"),
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(example).not.toBeVisible();
    const file = new File(
      ["italian,greek,word_type\ncasa,σπίτι,noun"],
      "cards.csv",
      { type: "text/csv" },
    );
    await user.upload(screen.getByLabelText(text.csvFile), file);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(example).toBeVisible();
    const { within } = await import("@testing-library/react");
    const table = within(example).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["italian", "greek", "word_type"]);
    expect(
      within(table)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "casa",
      "σπίτι",
      "noun",
      "parlare",
      "μιλάω",
      "verb",
      "bello",
      "όμορφος",
      "adjective",
    ]);
    expect(screen.getByRole("link", { name: text.csvExample })).toHaveAttribute(
      "href",
      "/api/imports/example",
    );
    expect(screen.getByRole("link", { name: text.csvExample })).toHaveAttribute(
      "download",
    );
    await user.click(toggle);
    expect(example).not.toBeVisible();
    expect(screen.getByLabelText(text.csvFile).files[0]).toBe(file);
  },
);
