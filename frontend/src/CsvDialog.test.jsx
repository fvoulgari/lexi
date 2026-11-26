import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import CsvDialog from "./CsvDialog.jsx";

function Harness({ onClose }) {
  return (
    <section className="shared-collections">
      <button type="button">Create collection</button>
      <CsvDialog
        title="Import CSV"
        cancelLabel="Close"
        onClose={onClose}
      >
        <p>Dialog body</p>
      </CsvDialog>
    </section>
  );
}

test("CSV dialogs render outside the page container that opened them", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "Import CSV" });

  expect(dialog.closest(".shared-collections")).toBeNull();
  expect(dialog.parentElement).toBe(document.body);
  expect(dialog).toHaveTextContent("Dialog body");

  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledOnce();
});
