import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { test, expect } from "vitest";
import App from "./App.jsx";

test("old migration links show an unavailable message and route to sign in", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/claim#token=old"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    screen.getByText("This migration link is no longer available"),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/",
  );
});
