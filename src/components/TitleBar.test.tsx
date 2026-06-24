import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitleBar } from "./TitleBar";

const gitWorktrees = vi.fn();
vi.mock("../api/git", () => ({ gitWorktrees: (...a: unknown[]) => gitWorktrees(...a) }));

describe("TitleBar", () => {
  beforeEach(() => {
    gitWorktrees.mockReset();
    gitWorktrees.mockResolvedValue([]);
  });

  it("shows the project name and branch", () => {
    render(<TitleBar root="/proj" name="proj" branch="main" onSwitchWorktree={() => {}} />);
    expect(screen.getByText("proj")).toBeInTheDocument();
    expect(screen.getByText("(main)")).toBeInTheDocument();
  });

  it("falls back to the app name when no folder is open", () => {
    render(<TitleBar root={null} name={null} branch={null} onSwitchWorktree={() => {}} />);
    expect(screen.getByText("zk-code-editor")).toBeInTheDocument();
  });

  it("opens the dropdown and switches to another worktree", async () => {
    gitWorktrees.mockResolvedValue([
      { path: "/proj", branch: "main", is_current: true },
      { path: "/proj-wt", branch: "feature", is_current: false },
    ]);
    const onSwitch = vi.fn();
    render(<TitleBar root="/proj" name="proj" branch="main" onSwitchWorktree={onSwitch} />);
    await userEvent.click(screen.getByRole("button", { name: /switch worktree/i }));
    await userEvent.click(await screen.findByText("feature"));
    expect(onSwitch).toHaveBeenCalledWith("/proj-wt");
  });

  it("does not switch when the current worktree is clicked", async () => {
    gitWorktrees.mockResolvedValue([
      { path: "/proj", branch: "main", is_current: true },
      { path: "/proj-wt", branch: "feature", is_current: false },
    ]);
    const onSwitch = vi.fn();
    render(<TitleBar root="/proj" name="proj" branch="main" onSwitchWorktree={onSwitch} />);
    await userEvent.click(screen.getByRole("button", { name: /switch worktree/i }));
    await userEvent.click(await screen.findByText("main"));
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
