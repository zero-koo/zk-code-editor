import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutsModal } from "./ShortcutsModal";

describe("ShortcutsModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ShortcutsModal open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders grouped shortcuts when open", () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    expect(screen.getByText("Show Explorer")).toBeInTheDocument();
    expect(screen.getByText("Show Search")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("focuses the filter input on open", () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/filter/i)).toHaveFocus();
  });

  it("filters the list by label", async () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/filter/i), "search");
    expect(screen.getByText("Show Search")).toBeInTheDocument();
    expect(screen.queryByText("Show Explorer")).not.toBeInTheDocument();
  });

  it("closes via the close button", async () => {
    const onClose = vi.fn();
    render(<ShortcutsModal open onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<ShortcutsModal open onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
