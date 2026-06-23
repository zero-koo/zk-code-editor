import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityBar } from "./ActivityBar";
import { useGitStore } from "../store/gitStore";
import type { FileDiff } from "../api/types";

const baseProps = {
  activeView: "explorer" as const,
  sidebarVisible: true,
  onActivate: () => {},
  onOpenShortcuts: () => {},
};

const mkFile = (path: string): FileDiff => ({
  path,
  old_path: null,
  status: "modified",
  additions: 0,
  deletions: 0,
  binary: false,
  too_large: false,
  new_text: null,
  old_text: null,
  hunks: [],
});

describe("ActivityBar", () => {
  beforeEach(() => useGitStore.setState({ changes: null, loading: false, error: null }));
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

  it("shows a badge with the changed-file count on the git button", () => {
    useGitStore.setState({
      changes: { is_repo: true, branch: "main", files: [mkFile("a"), mkFile("b"), mkFile("c")] },
    });
    render(<ActivityBar {...baseProps} />);
    const git = screen.getByRole("button", { name: /source control/i });
    expect(within(git).getByText("3")).toBeInTheDocument();
  });

  it("shows no badge when there are no changes", () => {
    useGitStore.setState({ changes: { is_repo: true, branch: "main", files: [] } });
    render(<ActivityBar {...baseProps} />);
    const git = screen.getByRole("button", { name: /source control/i });
    expect(within(git).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });
});
