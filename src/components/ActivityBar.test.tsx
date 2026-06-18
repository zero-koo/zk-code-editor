import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityBar } from "./ActivityBar";

const baseProps = {
  activeView: "explorer" as const,
  sidebarVisible: true,
  onActivate: () => {},
  onOpenShortcuts: () => {},
};

describe("ActivityBar", () => {
  it("renders Explorer, Search, and Keyboard Shortcuts buttons", () => {
    render(<ActivityBar {...baseProps} />);
    expect(screen.getByRole("button", { name: /explorer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("marks the active view as pressed when the sidebar is visible", () => {
    render(<ActivityBar {...baseProps} activeView="search" />);
    expect(screen.getByRole("button", { name: /search/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /explorer/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onActivate with the clicked view", async () => {
    const onActivate = vi.fn();
    render(<ActivityBar {...baseProps} onActivate={onActivate} />);
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(onActivate).toHaveBeenCalledWith("search");
  });

  it("calls onOpenShortcuts when the shortcuts button is clicked", async () => {
    const onOpenShortcuts = vi.fn();
    render(<ActivityBar {...baseProps} onOpenShortcuts={onOpenShortcuts} />);
    await userEvent.click(screen.getByRole("button", { name: /keyboard shortcuts/i }));
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });
});
