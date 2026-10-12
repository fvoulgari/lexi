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
  await user.click(screen.getByRole("button", { name: "Preview import" }));
  expect(await screen.findByText("greek: required")).toBeInTheDocument();
  expect(screen.getByText("07 — Domande")).toBeInTheDocument();
  expect(screen.getByText("questions")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm import" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Imported: 1");
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
  const file = new File(
    ["italian,greek,word_type\nil perché,το γιατί,noun\n"],
    "test.csv",
    { type: "text/csv" },
  );
  await user.upload(screen.getByLabelText("CSV file"), file);
  await user.click(screen.getByRole("button", { name: "Preview import" }));
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
  await user.upload(
    screen.getByLabelText("CSV file"),
    new File(
      ["italian,greek,word_type\nil perché,το γιατί,noun\n"],
      "test.csv",
      { type: "text/csv" },
    ),
  );
  await user.click(screen.getByRole("button", { name: "Preview import" }));
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
