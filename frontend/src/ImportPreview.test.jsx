import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import Import from "./Import.jsx";
import { request } from "./api.js";
import { copy } from "./copy.js";

vi.mock("./api.js", () => ({ request: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const rows = Array.from({ length: 245 }, (_, index) => ({
  row: index + 2,
  italian: `parola ${index}`,
  greek: `λέξη ${index}`,
  status:
    index === 243
      ? "duplicate"
      : index === 244
        ? "error"
        : index === 242
          ? "updated"
          : "valid",
  entry: {
    italian: `parola ${index}`,
    greek: `λέξη ${index}`,
    word_type: "noun",
    italian_gender: "feminine",
    greek_gender: "feminine",
    pronunciation: "αμπ-μπι-νά-ρε",
    greek_pronunciation: "lèk-si",
    italian_example: "Una parola italiana.",
    greek_example: "Μια ελληνική λέξη.",
  },
  tags: ["lesson"],
  errors: index === 244 ? ["greek_gender: required"] : [],
}));
const report = {
  counts: { valid: 243, updated: 1, duplicate: 1, error: 1, imported: 0 },
  destination_unit: { id: "u", code: "00", title: "Benvenuti" },
  proposed_tags: [],
  rows,
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(preview = () => Promise.resolve(report)) {
  request.mockImplementation((path) => {
    if (path === "/api/units")
      return Promise.resolve([{ id: "u", code: "00", title: "Benvenuti" }]);
    if (path.includes("/preview")) return preview();
    return Promise.resolve({
      ...report,
      counts: { ...report.counts, imported: 242 },
    });
  });
  const attention = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Import
        text={copy.el}
        csrf="csrf"
        onLocked={() => {}}
        onAttention={attention}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const file = new File(
    [
      "italian,greek,word_type\n" +
        rows.map((r) => `${r.italian},${r.greek},noun`).join("\n"),
    ],
    "245-cards.csv",
    { type: "text/csv" },
  );
  await user.upload(screen.getByLabelText("Αρχείο CSV"), file);
  await user.selectOptions(await screen.findByLabelText("Ενότητα *"), "u");
  await user.click(screen.getByRole("button", { name: "Προεπισκόπηση" }));
  return { user, file, attention };
}
test("245-row preview paginates and filters without changing the full confirmation upload", async () => {
  const { user, file } = await setup();
  const panel = await screen.findByRole("region", {
    name: "Προεπισκόπηση εισαγωγής",
  });
  expect(within(panel).getAllByRole("listitem")).toHaveLength(10);
  expect(within(panel).getByText("1–10 από 245")).toBeInTheDocument();
  expect(within(panel).queryByText(/Εισήχθησαν:/)).not.toBeInTheDocument();
  expect(
    within(panel).queryByText("Προτεινόμενες νέες ετικέτες"),
  ).not.toBeInTheDocument();
  expect(within(panel).getByText("245-cards.csv")).toBeInTheDocument();
  await user.click(
    within(panel).getByRole("button", { name: "Επόμενη σελίδα" }),
  );
  expect(within(panel).getByText("11–20 από 245")).toBeInTheDocument();
  await user.click(
    within(panel).getByRole("button", { name: "Με σφάλματα (1)" }),
  );
  expect(within(panel).getByText("1–1 από 1")).toBeInTheDocument();
  expect(within(panel).getByText(/greek_gender: required/)).toBeInTheDocument();
  await user.click(
    within(panel).getByRole("button", { name: "Διπλότυπες (1)" }),
  );
  expect(within(panel).getAllByRole("listitem")).toHaveLength(1);
  await user.click(
    within(panel).getByRole("button", { name: "Έγκυρες (243)" }),
  );
  expect(within(panel).getByText("1–10 από 243")).toBeInTheDocument();
  await user.click(
    within(panel).getByRole("button", { name: "Εισαγωγή 243 καρτών" }),
  );
  const calls = request.mock.calls.filter(([path]) =>
    path.includes("/confirm"),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0][1].body).toBe(file);
  expect(calls[0][1].signal).toBeUndefined();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Εισήχθησαν: 242",
  );
});
test("close preserves settings and returns focus; reopen retains details and cancel clears pending import", async () => {
  const { user, file } = await setup();
  const panel = await screen.findByRole("region", {
    name: "Προεπισκόπηση εισαγωγής",
  });
  const entry = within(panel).getAllByRole("listitem")[0];
  const details = entry.querySelector("details");
  expect(details).not.toHaveAttribute("open");
  await user.click(within(entry).getByText(copy.el.csvDetails));
  expect(within(details).getByText("Προφορά ελληνικών")).toBeInTheDocument();
  expect(within(details).getByText("Προφορά ιταλικών")).toBeInTheDocument();
  expect(within(details).getByText("αμπ-μπι-νά-ρε")).toBeInTheDocument();
  expect(within(details).getByText("lèk-si")).toBeInTheDocument();
  expect(within(details).queryByText("parola 0")).not.toBeInTheDocument();
  expect(within(details).queryByText("λέξη 0")).not.toBeInTheDocument();
  expect(within(details).queryByText(/Benvenuti/)).not.toBeInTheDocument();
  await user.click(
    within(panel).getByRole("button", { name: "Κλείσιμο προεπισκόπησης" }),
  );
  expect(
    screen.queryByRole("region", { name: "Προεπισκόπηση εισαγωγής" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Άνοιγμα προεπισκόπησης" }),
  ).toHaveFocus();
  expect(screen.getByLabelText("Αρχείο CSV").files[0]).toBe(file);
  expect(screen.getByLabelText("Ενότητα *")).toHaveValue("u");
  await user.click(
    screen.getByRole("button", { name: "Άνοιγμα προεπισκόπησης" }),
  );
  expect(
    request.mock.calls.filter(([path]) => path.includes("/preview")),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Ακύρωση εισαγωγής" }));
  expect(screen.getByLabelText("Αρχείο CSV").files).toHaveLength(0);
  expect(screen.getByLabelText("Ενότητα *")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Προεπισκόπηση" })).toBeDisabled();
  expect(
    request.mock.calls.filter(([path]) => path.includes("/confirm")),
  ).toHaveLength(0);
});
test.each(["success", "error"])(
  "cancel aborts validation and ignores a late %s even if the transport ignores abort",
  async (outcome) => {
    const pending = deferred();
    const { user, attention } = await setup(() => pending.promise);
    const [, options] = request.mock.calls.find(([path]) =>
      path.includes("/preview"),
    );
    await user.click(screen.getByRole("button", { name: "Ακύρωση εισαγωγής" }));
    expect(options.signal.aborted).toBe(true);
    attention.mockClear();
    await act(async () =>
      pending.resolve(
        outcome === "success"
          ? report
          : Promise.reject(new Error("Late validation error")),
      ),
    );
    expect(
      screen.queryByRole("region", { name: "Προεπισκόπηση εισαγωγής" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(attention).not.toHaveBeenCalled();
  },
);

test("all 245 eligible rows remain importable even when a filter has no matches", async () => {
  const all = {
    ...report,
    counts: { valid: 245, duplicate: 0, error: 0 },
    rows: rows.map((row) => ({ ...row, status: "valid", errors: [] })),
  };
  const { user, file } = await setup(() => Promise.resolve(all));
  const panel = await screen.findByRole("region", {
    name: "Προεπισκόπηση εισαγωγής",
  });
  await user.click(
    within(panel).getByRole("button", { name: "Διπλότυπες (0)" }),
  );
  expect(within(panel).getByText("0–0 από 0")).toBeInTheDocument();
  expect(
    within(panel).getByRole("button", { name: "Εισαγωγή 245 καρτών" }),
  ).toBeEnabled();
  await user.click(within(panel).getByRole("button", { name: "Όλες (245)" }));
  for (let page = 1; page < 25; page++) {
    await user.click(
      within(panel).getByRole("button", { name: "Επόμενη σελίδα" }),
    );
  }
  expect(within(panel).getByText("241–245 από 245")).toBeInTheDocument();
  expect(within(panel).getAllByRole("listitem")).toHaveLength(5);
  expect(
    within(panel).getByRole("button", { name: "Επόμενη σελίδα" }),
  ).toBeDisabled();
  await user.click(
    within(panel).getByRole("button", { name: "Εισαγωγή 245 καρτών" }),
  );
  expect(
    request.mock.calls.find(([path]) => path.includes("/confirm"))[1].body,
  ).toBe(file);
});

test("a file with no eligible rows cannot be confirmed", async () => {
  await setup(() =>
    Promise.resolve({
      ...report,
      counts: { valid: 0, duplicate: 245, error: 0 },
      rows: rows.map((row) => ({ ...row, status: "duplicate", errors: [] })),
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Εισαγωγή 0 καρτών" }),
  ).toBeDisabled();
});

test("failed import closes preview and shows a recoverable red banner", async () => {
  const { user, file } = await setup();
  await screen.findByRole("region", { name: "Προεπισκόπηση εισαγωγής" });
  request.mockRejectedValueOnce(new Error("Connection lost"));
  await user.click(screen.getByRole("button", { name: "Εισαγωγή 243 καρτών" }));
  expect(await screen.findByRole("alert")).toHaveClass("csv-result-error");
  expect(
    screen.queryByRole("region", { name: "Προεπισκόπηση εισαγωγής" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Αρχείο CSV").files[0]).toBe(file);
  await user.click(
    screen.getByRole("button", { name: "Άνοιγμα προεπισκόπησης" }),
  );
  expect(
    screen.getByRole("button", { name: "Εισαγωγή 243 καρτών" }),
  ).toBeEnabled();
});
test("replacement invalidates pending validation and resets pagination", async () => {
  const pending = deferred();
  const { user } = await setup(() => pending.promise);
  await user.upload(
    screen.getByLabelText("Αρχείο CSV"),
    new File(["new"], "new.csv", { type: "text/csv" }),
  );
  await act(async () => pending.resolve(report));
  expect(
    screen.queryByRole("region", { name: "Προεπισκόπηση εισαγωγής" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Προεπισκόπηση" }));
  expect(await screen.findByText("1–10 από 245")).toBeInTheDocument();
});
test("database import cannot be cancelled and double click submits once", async () => {
  const { user } = await setup();
  await screen.findByRole("region", { name: "Προεπισκόπηση εισαγωγής" });
  const pending = deferred();
  request.mockImplementation((path) =>
    path.includes("/confirm") ? pending.promise : Promise.resolve([]),
  );
  await user.dblClick(
    screen.getByRole("button", { name: "Εισαγωγή 243 καρτών" }),
  );
  expect(
    request.mock.calls.filter(([path]) => path.includes("/confirm")),
  ).toHaveLength(1);
  expect(
    screen.getByText("Η εισαγωγή βρίσκεται σε εξέλιξη", { selector: "strong" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Ακύρωση εισαγωγής" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("region", { name: "Προεπισκόπηση εισαγωγής" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Αρχείο CSV")).toBeDisabled();
  await act(async () =>
    pending.resolve({ ...report, counts: { ...report.counts, imported: 242 } }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Εισήχθησαν: 242"),
  );
  expect(screen.getByRole("status").closest("section")).toHaveClass(
    "csv-result-success",
  );
  expect(
    screen.queryByRole("button", { name: "Ακύρωση εισαγωγής" }),
  ).not.toBeInTheDocument();
});

test("an old response cannot replace validation of a new file", async () => {
  const older = deferred();
  const newer = deferred();
  let attempt = 0;
  const { user } = await setup(() =>
    ++attempt === 1 ? older.promise : newer.promise,
  );
  await user.upload(
    screen.getByLabelText("Αρχείο CSV"),
    new File(["new"], "replacement.csv", { type: "text/csv" }),
  );
  await user.click(screen.getByRole("button", { name: "Προεπισκόπηση" }));
  await act(async () =>
    newer.resolve({
      ...report,
      rows: [rows[0]],
      counts: { valid: 1, duplicate: 0, error: 0 },
    }),
  );
  await screen.findByRole("button", { name: "Εισαγωγή 1 κάρτας" });
  await act(async () => older.resolve(report));
  expect(screen.getByText("1–1 από 1")).toBeInTheDocument();
  expect(screen.getByText("replacement.csv")).toBeInTheDocument();
});
