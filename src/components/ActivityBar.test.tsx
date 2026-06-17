import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityBar } from "./ActivityBar";

describe("ActivityBar", () => {
  it("renders the explorer toggle button", () => {
    render(<ActivityBar sidebarVisible onToggleSidebar={() => {}} />);
    expect(screen.getByRole("button", { name: /explorer/i })).toBeInTheDocument();
  });

  it("calls onToggleSidebar when clicked", async () => {
    const onToggle = vi.fn();
    render(<ActivityBar sidebarVisible onToggleSidebar={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: /explorer/i }));
    expect(onToggle).toHaveBeenCalled();
  });
});
