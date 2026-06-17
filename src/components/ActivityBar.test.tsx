import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityBar } from "./ActivityBar";

describe("ActivityBar", () => {
  it("renders Explorer and Search buttons", () => {
    render(<ActivityBar activeView="explorer" sidebarVisible onActivate={() => {}} />);
    expect(screen.getByRole("button", { name: /explorer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("marks the active view as pressed when the sidebar is visible", () => {
    render(<ActivityBar activeView="search" sidebarVisible onActivate={() => {}} />);
    expect(screen.getByRole("button", { name: /search/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /explorer/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onActivate with the clicked view", async () => {
    const onActivate = vi.fn();
    render(<ActivityBar activeView="explorer" sidebarVisible onActivate={onActivate} />);
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(onActivate).toHaveBeenCalledWith("search");
  });
});
