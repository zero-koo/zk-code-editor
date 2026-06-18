import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileExplorer } from "./FileExplorer";
import { useWorkspaceStore } from "../store/workspaceStore";

const open = vi.fn();
const setWorkspaceRoot = vi.fn();
const readDir = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => open(...a) }));
vi.mock("../api/fs", () => ({
  setWorkspaceRoot: (...a: unknown[]) => setWorkspaceRoot(...a),
  readDir: (...a: unknown[]) => readDir(...a),
}));

describe("FileExplorer", () => {
  beforeEach(() => {
    open.mockReset();
    setWorkspaceRoot.mockReset();
    readDir.mockReset();
    localStorage.clear();
    useWorkspaceStore.setState({ root: null, tabs: [], activeTabPath: null, expandedDirs: new Set() });
  });

  it("shows an Open Folder button when no root is set", () => {
    render(<FileExplorer onOpenFile={() => {}} />);
    expect(screen.getByRole("button", { name: /open folder/i })).toBeInTheDocument();
  });

  it("opening a folder sets root and lists the tree", async () => {
    open.mockResolvedValue("/proj");
    readDir.mockResolvedValue([{ name: "main.ts", path: "/proj/main.ts", is_dir: false }]);
    render(<FileExplorer onOpenFile={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /open folder/i }));
    expect(setWorkspaceRoot).toHaveBeenCalledWith("/proj");
    expect(await screen.findByText("main.ts")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().root).toBe("/proj");
  });

  it("restores the tree from a persisted root on mount (survives reload)", async () => {
    localStorage.setItem("zk.workspaceRoot", "/saved");
    setWorkspaceRoot.mockResolvedValue(undefined);
    readDir.mockResolvedValue([{ name: "restored.ts", path: "/saved/restored.ts", is_dir: false }]);
    render(<FileExplorer onOpenFile={() => {}} />);
    expect(await screen.findByText("restored.ts")).toBeInTheDocument();
    expect(setWorkspaceRoot).toHaveBeenCalledWith("/saved");
    expect(useWorkspaceStore.getState().root).toBe("/saved");
  });
});
