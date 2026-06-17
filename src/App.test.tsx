import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { useWorkspaceStore } from "./store/workspaceStore";

const open = vi.fn();
const readDir = vi.fn();
const readFile = vi.fn();
const writeFile = vi.fn();
const setWorkspaceRoot = vi.fn();
const searchWorkspace = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => open(...a) }));
vi.mock("./api/fs", () => ({
  setWorkspaceRoot: (...a: unknown[]) => setWorkspaceRoot(...a),
  readDir: (...a: unknown[]) => readDir(...a),
  readFile: (...a: unknown[]) => readFile(...a),
  writeFile: (...a: unknown[]) => writeFile(...a),
  searchWorkspace: (...a: unknown[]) => searchWorkspace(...a),
}));

describe("App integration", () => {
  beforeEach(() => {
    [open, readDir, readFile, writeFile, setWorkspaceRoot, searchWorkspace].forEach((m) => m.mockReset());
    useWorkspaceStore.setState({ root: null, tabs: [], activeTabPath: null, expandedDirs: new Set(), activeView: "explorer" });
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

  it("shows a notice when saving fails", async () => {
    open.mockResolvedValue("/proj");
    readDir.mockResolvedValue([{ name: "a.ts", path: "/proj/a.ts", is_dir: false }]);
    readFile.mockResolvedValue({ kind: "text", text: "x" });
    writeFile.mockRejectedValue({ code: "permission", message: "denied" });

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /open folder/i }));
    await userEvent.click(await screen.findByText("a.ts"));
    // Trigger save via CodeMirror's Mod-s keymap. userEvent.keyboard does not
    // reliably reach CM's keydown handler in jsdom, so dispatch a Ctrl-s
    // KeyboardEvent directly on the editor's content element (which CM listens on).
    const content = document.body.querySelector(".cm-content") as HTMLElement;
    content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, bubbles: true })
    );
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
  });

  it("switches to the search view and opens a clicked match at its line", async () => {
    open.mockResolvedValue("/proj");
    readDir.mockResolvedValue([{ name: "a.ts", path: "/proj/a.ts", is_dir: false }]);
    readFile.mockResolvedValue({ kind: "text", text: "alpha\nbeta useEffect gamma" });
    searchWorkspace.mockResolvedValue({
      files: [
        {
          path: "/proj/a.ts",
          rel_path: "a.ts",
          matches: [{ line_number: 2, preview: "beta useEffect gamma", highlight_ranges: [[5, 14]], match_start: 5, match_end: 14 }],
        },
      ],
      total_matches: 1,
      truncated: false,
      regex_error: null,
    });

    render(<App />);
    // open a folder first so the workspace exists
    await userEvent.click(screen.getByRole("button", { name: /open folder/i }));
    // switch to search view
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    await userEvent.type(await screen.findByPlaceholderText(/search/i), "useEffect");
    // click the match → opens the file and the editor shows its content
    await userEvent.click(await screen.findByText("useEffect"));
    const lines = await screen.findAllByText((_t, el) => el?.classList.contains("cm-line") ?? false);
    expect(lines.some((l) => /beta useEffect gamma/.test(l.textContent ?? ""))).toBe(true);
  });
});
