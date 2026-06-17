import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { useWorkspaceStore } from "./store/workspaceStore";

const open = vi.fn();
const readDir = vi.fn();
const readFile = vi.fn();
const setWorkspaceRoot = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => open(...a) }));
vi.mock("./api/fs", () => ({
  setWorkspaceRoot: (...a: unknown[]) => setWorkspaceRoot(...a),
  readDir: (...a: unknown[]) => readDir(...a),
  readFile: (...a: unknown[]) => readFile(...a),
  writeFile: vi.fn(),
}));

describe("App integration", () => {
  beforeEach(() => {
    [open, readDir, readFile, setWorkspaceRoot].forEach((m) => m.mockReset());
    useWorkspaceStore.setState({ root: null, tabs: [], activeTabPath: null, expandedDirs: new Set() });
  });

  it("opening a folder then a file creates a tab and shows the editor", async () => {
    open.mockResolvedValue("/proj");
    readDir.mockResolvedValue([{ name: "a.ts", path: "/proj/a.ts", is_dir: false }]);
    readFile.mockResolvedValue({ kind: "text", text: "const x = 1;" });

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /open folder/i }));
    await userEvent.click(await screen.findByText("a.ts"));

    expect(await screen.findByRole("tab", { name: /a\.ts/ })).toBeInTheDocument();
    const line = await screen.findByText(
      (_content, el) => el?.classList.contains("cm-line") === true && /const x = 1;/.test(el?.textContent ?? "")
    );
    expect(line.textContent).toMatch(/const x = 1;/);
  });

  it("shows a placeholder for binary files instead of opening a tab", async () => {
    open.mockResolvedValue("/proj");
    readDir.mockResolvedValue([{ name: "img.png", path: "/proj/img.png", is_dir: false }]);
    readFile.mockResolvedValue({ kind: "binary" });

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /open folder/i }));
    await userEvent.click(await screen.findByText("img.png"));

    expect(await screen.findByText(/cannot preview/i)).toBeInTheDocument();
    expect(useWorkspaceStore.getState().tabs).toHaveLength(0);
  });
});
