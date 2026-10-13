import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterAll, afterEach, test, expect, vi } from "vitest";
import Library from "./Library.jsx";
import { copy } from "./copy.js";

const server = setupServer(
  http.get("*/api/vocabulary", () =>
    HttpResponse.json({ items: [], total: 0 }),
  ),
  http.get("*/api/units", () => HttpResponse.json([])),
  http.get("*/api/tags", () => HttpResponse.json([])),
  http.get("*/api/vocabulary/export.csv", ({ request }) => {
    expect(new URL(request.url).search).toBe("");
    return new HttpResponse('"italian","greek"\r\n"caffè","καφές"', {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function openLibrary(language = "en", onLocked = vi.fn()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Library text={copy[language]} csrf="csrf" onLocked={onLocked} />
    </QueryClientProvider>,
  );
}
test("download the entire library and announce that the download started", async () => {
  let downloaded;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob) {
        downloaded = blob;
        return "blob:export";
      }
      static revokeObjectURL() {}
    },
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function () {
      expect(this.download).toBe("italian-notebook.csv");
      expect(this.href).toBe("blob:export");
    });
  openLibrary();
  const user = userEvent.setup();
  await user.type(screen.getByRole("searchbox"), "missing");
  await user.click(
    screen.getByRole("button", { name: "Export full library (CSV)" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "CSV download started.",
    ),
  );
  expect(click).toHaveBeenCalledOnce();
  expect(await downloaded.text()).toContain("καφές");
});

test("an export error is announced and the same button retries", async () => {
  server.use(
    http.get("*/api/vocabulary/export.csv", () =>
      HttpResponse.json(
        { error: { code: "service_unavailable" } },
        { status: 503 },
      ),
    ),
  );
  openLibrary();
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: copy.en.exportLibrary });
  await user.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    copy.en.errors.service_unavailable,
  );
  expect(button).toBeEnabled();
  server.use(
    http.get("*/api/vocabulary/export.csv", () => HttpResponse.error()),
  );
  await user.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    copy.en.errors.connection_error,
  );
});

test("expired export admission returns the learner to the gate", async () => {
  server.use(
    http.get("*/api/vocabulary/export.csv", () =>
      HttpResponse.json({ error: { code: "request_failed" } }, { status: 401 }),
    ),
  );
  const onLocked = vi.fn();
  openLibrary("en", onLocked);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: copy.en.exportLibrary }));
  await waitFor(() => expect(onLocked).toHaveBeenCalledOnce());
});

test.each(["el", "it"])(
  "export action is localized in %s and disabled while pending",
  async (language) => {
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    server.use(
      http.get("*/api/vocabulary/export.csv", async () => {
        await pending;
        return HttpResponse.json(
          { error: { code: "service_unavailable" } },
          { status: 503 },
        );
      }),
    );
    openLibrary(language);
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: copy[language].exportLibrary }),
      );
    try {
      expect(
        screen.getByRole("button", { name: copy[language].exporting }),
      ).toBeDisabled();
    } finally {
      finish();
    }
    expect(await screen.findByRole("alert")).toHaveTextContent(
      copy[language].errors.service_unavailable,
    );
  },
);
