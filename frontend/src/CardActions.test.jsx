import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, afterAll, expect, test, vi } from "vitest";
import CardActions from "./CardActions.jsx";
import { copy } from "./copy.js";

// jsdom lacks native dialog methods. Browser focus trapping is handled by <dialog>.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterAll(() => {
  delete HTMLDialogElement.prototype.showModal;
  delete HTMLDialogElement.prototype.close;
});

const entry = {
  id: "e",
  italian: "casa",
  greek: "σπίτι",
  word_type: "noun",
  italian_plural: "case",
  greek_plural: "σπίτια",
};

for (const language of ["en", "el", "it"]) {
  test(`card menu opens a preview directly and restores focus in ${language}`, async () => {
    const text = copy[language];
    const edit = vi.fn(),
      remove = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <CardActions
          entry={entry}
          text={text}
          open={open}
          onOpenChange={setOpen}
          editDisabled={false}
          deleteDisabled={false}
          onEdit={edit}
          onDelete={remove}
        />
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", {
      name: `${text.cardActions}: casa`,
    });
    await user.click(trigger);
    await user.click(
      screen.getByRole("menuitem", { name: `${text.cardPreview}: casa` }),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog", {
      name: `${text.cardPreview}: casa`,
    });
    expect(
      within(dialog).getByRole("button", { name: text.cardHidePreview }),
    ).toHaveFocus();
    expect(
      within(dialog).queryByText(text.cardPreviewHint),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: text.revealAnswer }),
    );
    expect(within(dialog).getByRole("heading", { name: "casa" })).toBeVisible();
    expect(within(dialog).getByText("case")).toBeVisible();
    expect(within(dialog).queryByText("σπίτια")).not.toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByLabelText(text.direction),
      "italian_to_greek",
    );
    await user.click(
      within(dialog).getByRole("button", { name: text.revealAnswer }),
    );
    expect(
      within(dialog).getByRole("heading", { name: "σπίτι" }),
    ).toBeVisible();
    expect(within(dialog).getByText("σπίτια")).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: text.cardHidePreview }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(
      screen.getByRole("menuitem", { name: `${text.cardPreview}: casa` }),
    );
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(edit).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
}
