import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import MobileNavigation from "./MobileNavigation.jsx";
import { copy } from "./copy.js";

test("mobile navigation retains home alongside practice, words, progress and profile", () => {
  render(
    <MemoryRouter initialEntries={["/vocabulary"]}>
      <MobileNavigation text={copy.el} />
    </MemoryRouter>,
  );
  const navigation = screen.getByRole("navigation", { name: "Κύρια πλοήγηση" });
  const links = within(navigation).getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual([
    "Αρχική",
    "Εξάσκηση",
    "Λέξεις",
    "Πρόοδος",
    "Προφίλ",
  ]);
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "/",
    "/practice",
    "/vocabulary",
    "/progress",
    "/settings",
  ]);
  for (const link of links)
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(links[0].querySelector("svg")).toHaveClass("lucide-house");
  expect(links[1].querySelector("svg")).toHaveClass("lucide-copy");
  expect(links[2].querySelector("svg")).toHaveClass("lucide-book-open");
  expect(links[4].querySelector("svg")).toHaveClass("lucide-user-round");
});

test.each([
  ["/", "Αρχική"],
  ["/practice", "Εξάσκηση"],
  ["/practice/session/123", "Εξάσκηση"],
  ["/vocabulary", "Λέξεις"],
  ["/vocabulary/123/edit", "Λέξεις"],
  ["/progress", "Πρόοδος"],
  ["/progress/learners/123", "Πρόοδος"],
  ["/settings", "Προφίλ"],
  ["/settings/profiles/123", "Προφίλ"],
])("%s marks only %s active", (path, label) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <MobileNavigation text={copy.el} />
    </MemoryRouter>,
  );
  const links = screen.getAllByRole("link");
  expect(
    links.filter((link) => link.getAttribute("aria-current") === "page"),
  ).toHaveLength(1);
  expect(screen.getByRole("link", { name: label })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test.each(["/practice-other"])(
  "%s does not mark an unrelated destination active",
  (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <MobileNavigation text={copy.el} />
      </MemoryRouter>,
    );
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.hasAttribute("aria-current")),
    ).toBe(false);
  },
);
