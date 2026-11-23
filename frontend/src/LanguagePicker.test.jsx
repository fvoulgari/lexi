import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import LanguagePicker from "./LanguagePicker.jsx";
import { hydrateLanguages, resetLanguages } from "./languages.js";
import { REGISTRY_PAYLOAD } from "./language-fixtures.js";

function Harness({ onChange = () => {}, ...props }) {
  return (
    <LanguagePicker
      label="Learning language"
      value="el"
      onChange={onChange}
      {...props}
    />
  );
}

function optionNames() {
  return screen
    .queryAllByRole("option")
    .map((option) => option.querySelector("span")?.textContent);
}

afterEach(() => hydrateLanguages(REGISTRY_PAYLOAD));

test("offers every curated catalogue option with its API label and code", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("combobox"));

  expect(optionNames()).toEqual(["Danish", "Greek", "English", "Italian"]);
  expect(
    screen
      .getAllByRole("option")
      .map((option) => option.querySelector(".language-picker-code")?.textContent),
  ).toEqual(["da", "el", "en", "it"]);
});

test("filters options by language name and by code", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByRole("combobox");

  await user.click(input);
  await user.type(input, "dan");
  expect(optionNames()).toEqual(["Danish"]);

  await user.clear(input);
  await user.type(input, "it");
  expect(optionNames()).toEqual(["Italian"]);
});

test("shows a clear empty state when nothing matches", async () => {
  const user = userEvent.setup();
  render(<Harness emptyMessage="Nothing here" />);
  const input = screen.getByRole("combobox");
  await user.click(input);
  await user.type(input, "klingon");
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByText("Nothing here")).toBeInTheDocument();
  expect(input).toHaveAttribute("aria-expanded", "true");
});

test("selects an option by click and reports the language ID", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Harness onChange={onChange} />);
  await user.click(screen.getByRole("combobox"));
  await user.type(screen.getByRole("combobox"), "ita");
  await user.click(screen.getByRole("option", { name: /Italian/ }));

  expect(onChange).toHaveBeenCalledWith("it");
  expect(screen.getByRole("combobox")).toHaveValue("Greek");
  expect(screen.getByRole("listbox", { hidden: true })).toHaveAttribute("hidden");
});

test("supports keyboard search, navigation and selection with ARIA state", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Harness onChange={onChange} value="da" />);
  const input = screen.getByRole("combobox");

  await user.tab();
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute("aria-expanded", "true");
  const listbox = screen.getByRole("listbox");
  expect(listbox.id).toBe(input.getAttribute("aria-controls"));

  await user.keyboard("{ArrowDown}");
  expect(screen.queryAllByRole("option")[0]).toHaveClass("is-active");
  expect(input).toHaveAttribute(
    "aria-activedescendant",
    screen.queryAllByRole("option")[0].id,
  );
  await user.keyboard("{ArrowDown}");
  expect(screen.queryAllByRole("option")[1]).toHaveClass("is-active");
  expect(input).toHaveAttribute(
    "aria-activedescendant",
    screen.queryAllByRole("option")[1].id,
  );
  await user.keyboard("{ArrowUp}");
  expect(screen.queryAllByRole("option")[0]).toHaveClass("is-active");

  await user.keyboard("{End}");
  expect(screen.queryAllByRole("option")[3]).toHaveClass("is-active");
  await user.keyboard("{Home}");
  expect(screen.queryAllByRole("option")[0]).toHaveClass("is-active");

  await user.keyboard("{Enter}");
  expect(onChange).toHaveBeenCalledWith("da");
  expect(input).toHaveAttribute("aria-expanded", "false");
  expect(input).not.toHaveAttribute("aria-activedescendant");
});

test("ArrowUp wraps to the last option and Enter selects it", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Harness onChange={onChange} />);
  await user.click(screen.getByRole("combobox"));
  await user.keyboard("{ArrowUp}");
  expect(screen.queryAllByRole("option")[3]).toHaveClass("is-active");
  await user.keyboard("{Enter}");
  expect(onChange).toHaveBeenCalledWith("it");
});

test("Escape closes the list and restoring focus reopens on demand", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByRole("combobox");
  await user.click(input);
  await user.type(input, "gree");
  expect(screen.queryAllByRole("option")).toHaveLength(1);

  await user.keyboard("{Escape}");
  expect(input).toHaveAttribute("aria-expanded", "false");
  expect(input).toHaveValue("Greek");

  await user.click(input);
  expect(screen.queryAllByRole("option")).toHaveLength(4);
});

test("marks the current value as selected and excludes configured IDs", async () => {
  const user = userEvent.setup();
  render(<Harness exclude={["it", "da"]} />);
  await user.click(screen.getByRole("combobox"));
  expect(
    screen.queryAllByRole("option").map((option) => option.getAttribute("aria-selected")),
  ).toEqual(["true", "false"]);
  expect(screen.queryByRole("option", { name: /Italian/ })).toBeNull();
  expect(screen.queryByRole("option", { name: /Danish/ })).toBeNull();
});

test("only ever offers rows supplied by the API and reacts to rehydration", async () => {
  const user = userEvent.setup();
  render(<Harness value="zz" />);
  const input = screen.getByRole("combobox");

  await user.click(input);
  expect(screen.getByRole("option", { name: /Greek/ })).toBeInTheDocument();

  act(() =>
    hydrateLanguages({
      languages: [
        {
          id: "zz",
          label: "Synthetic Language",
          script: "Arab",
          text_direction: "rtl",
          enhanced: false,
        },
      ],
      directions: [],
    }),
  );

  expect(screen.queryAllByRole("option")).toHaveLength(1);
  expect(
    screen.getByRole("option", { name: /Synthetic Language/ }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Greek/ })).toBeNull();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("combobox")).toHaveValue("Synthetic Language");
});

test("renders empty before the API hydrates then reacts to it", async () => {
  const user = userEvent.setup();
  resetLanguages();
  render(<Harness />);
  await user.click(screen.getByRole("combobox"));
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  act(() => hydrateLanguages(REGISTRY_PAYLOAD));
  expect(screen.queryAllByRole("option")).toHaveLength(4);
});

test("a disabled picker ignores input", async () => {
  const user = userEvent.setup();
  render(<Harness disabled />);
  const input = screen.getByRole("combobox");
  expect(input).toBeDisabled();
  await user.click(input);
  expect(input).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});
