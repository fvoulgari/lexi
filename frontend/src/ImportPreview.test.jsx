import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import Import from "./Import.jsx";
import { request } from "./api.js";
import { copy } from "./copy.js";
import { collectionCopy } from "./collection-copy.js";

vi.mock("./api.js", () => ({ request: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const text = copy.el;
const t = collectionCopy.el;
const destination = {
  id: "lesson",
  name: "Benvenuti",
  can_edit: true,
  visibility: "private",
  source_language: "it",
  target_language: "el",
};
const rows = Array.from({ length: 245 }, (_, index) => ({
  row: index + 2,
  italian: `parola ${index}`,
  greek: `λέξη ${index}`,
  status: index === 243 ? "duplicate" : index === 244 ? "error" : "valid",
  entry: {
    word_type: "noun",
    italian_gender: "feminine",
    greek_gender: "feminine",
    pronunciation: "αμπ-μπι-νά-ρε",
    greek_pronunciation: "lèk-si",
  },
  tags: ["lesson"],
  errors: index === 244 ? ["greek_gender: required"] : [],
}));
const report = {
  counts: { valid: 243, duplicate: 1, error: 1 },
  destination_collection: { id: destination.id, name: destination.name },
  rows,
};
const primary = (count) =>
  t.importMany.replace("{count}", count).replace("{name}", destination.name);
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(
  preview = () => Promise.resolve(report),
  confirm = () => Promise.resolve(report),
) {
  request.mockImplementation((path) => {
    if (path === "/api/collections") return Promise.resolve([destination]);
    return path.includes("/preview") ? preview() : confirm();
  });
  const onImported = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Import
        text={text}
        csrf="csrf"
        language="el"
        selectedCollection={destination}
        onLocked={() => {}}
        onClose={onClose}
        onImported={onImported}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const file = new File(["italian,greek,word_type\n"], "245-cards.csv", {
    type: "text/csv",
  });
  await user.upload(screen.getByLabelText(t.chooseCsv), file);
  await user.click(screen.getByRole("button", { name: text.csvPreview }));
  await waitFor(() =>
    expect(request.mock.calls.some(([path]) => path.includes("/preview"))).toBe(
      true,
    ),
  );
  return { user, file, onClose, onImported, ...view };
}

test("preview paginates, shows row details and confirms the whole file after filtering", async () => {
  const { user, file, onImported } = await setup();
  const panel = within(
    await screen.findByRole("region", { name: text.csvPreviewTitle }),
  );
  expect(panel.getAllByRole("listitem")).toHaveLength(10);
  const row = within(panel.getAllByRole("listitem")[0]);
  await user.click(row.getByText(text.csvDetails));
  expect(row.getByText("αμπ-μπι-νά-ρε")).toBeInTheDocument();
  expect(row.getByText("lèk-si")).toBeInTheDocument();
  await user.click(panel.getByRole("button", { name: text.next }));
  expect(panel.getByText("parola 10")).toBeInTheDocument();
  await user.click(
    panel.getByRole("button", { name: `${text.csvErrorRows} (1)` }),
  );
  expect(panel.getByText("greek_gender: required")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: primary(243) }));
  const [path, options] = request.mock.calls.find(([path]) =>
    path.includes("/confirm"),
  );
  expect(path).toContain("expected_valid=243");
  expect(options.body).toBe(file);
  expect(options.signal).toBeUndefined();
  expect(onImported).toHaveBeenCalledWith(report);
});

test("cancelling an in-flight preview stops its request", async () => {
  const pending = deferred();
  const { user, onClose, unmount } = await setup(() => pending.promise);
  const [, options] = request.mock.calls.find(([path]) =>
    path.includes("/preview"),
  );
  await user.click(screen.getAllByRole("button", { name: text.cancel })[0]);
  expect(onClose).toHaveBeenCalledOnce();
  unmount();
  expect(options.signal.aborted).toBe(true);
  await act(async () => pending.resolve(report));
});

test("a late response for an earlier file cannot replace the current preview", async () => {
  const old = deferred();
  let call = 0;
  const { user } = await setup(() =>
    ++call === 1
      ? old.promise
      : Promise.resolve({
          ...report,
          counts: { valid: 0, duplicate: 1, error: 0 },
          rows: [rows[243]],
        }),
  );
  await user.upload(
    screen.getByLabelText(t.chooseCsv),
    new File(["new"], "replacement.csv", { type: "text/csv" }),
  );
  await user.click(screen.getByRole("button", { name: text.csvPreview }));
  await screen.findByRole("button", { name: primary(0) });
  await act(async () => old.resolve(report));
  expect(screen.getByRole("button", { name: primary(0) })).toBeDisabled();
  expect(screen.getByText("replacement.csv")).toBeInTheDocument();
});

test("confirmation locks the modal, defeats double-clicks and permits retry after failure", async () => {
  const pending = deferred();
  const { user, file, onClose } = await setup(undefined, () => pending.promise);
  const confirm = await screen.findByRole("button", { name: primary(243) });
  await user.dblClick(confirm);
  expect(
    request.mock.calls.filter(([path]) => path.includes("/confirm")),
  ).toHaveLength(1);
  expect(screen.getByLabelText(t.chooseCsv)).toBeDisabled();
  expect(
    screen.getByRole("button", { name: text.csvImporting }),
  ).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();
  await act(async () =>
    pending.resolve(Promise.reject(new Error("Connection lost"))),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByRole("button", { name: primary(243) })).toBeEnabled();
  expect(screen.getByLabelText(t.chooseCsv).files[0]).toBe(file);
});
