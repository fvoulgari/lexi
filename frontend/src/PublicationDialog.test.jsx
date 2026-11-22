import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import PublicationDialog from "./PublicationDialog.jsx";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterAll(() => {
  delete HTMLDialogElement.prototype.showModal;
  delete HTMLDialogElement.prototype.close;
});

function Harness({ onCancel = () => {}, onConfirm = () => {}, busy = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Review</button>
      <PublicationDialog
        open={open}
        title="Publish collection"
        name="Greetings"
        cardCount={3}
        cardsLabel="cards"
        explanation="The collection and its cards will be visible to other users. You can keep editing them."
        confirmLabel="Publish"
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      />
    </>
  );
}

test("publication confirmation is compact, focused, and restores focus on cancel", async () => {
  const onCancel = vi.fn();
  const user = userEvent.setup();
  render(<Harness onCancel={onCancel} />);
  const trigger = screen.getByRole("button", { name: "Review" });

  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", {
    name: "Publish collection",
  });
  expect(dialog).toHaveTextContent("Greetings");
  expect(dialog).toHaveTextContent("3 cards");
  expect(dialog).toHaveTextContent(
    "The collection and its cards will be visible to other users. You can keep editing them.",
  );
  expect(dialog.querySelectorAll("li")).toHaveLength(0);
  expect(document.activeElement).toBe(
    within(dialog).getByRole("button", { name: "Publish" }),
  );

  fireEvent(dialog, new Event("cancel"));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("a busy publication ignores cancellation", async () => {
  const onCancel = vi.fn();
  const user = userEvent.setup();
  render(<Harness busy onCancel={onCancel} />);

  await user.click(screen.getByRole("button", { name: "Review" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Publish collection",
  });
  expect(
    within(dialog).getByRole("button", { name: "Publish" }),
  ).toBeDisabled();
  fireEvent(dialog, new Event("cancel"));
  expect(onCancel).not.toHaveBeenCalled();
  expect(dialog).toBeInTheDocument();
});
