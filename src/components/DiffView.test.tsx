import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import type { MatcherFunction } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// A diff line may be syntax-highlighted into several <span>s, so its text is
// split across child nodes. Match against the row's full textContent instead.
const wholeLine = (text: string): MatcherFunction => (_content, node) =>
  node?.classList.contains("font-mono") === true && node?.textContent?.includes(text) === true;
import type { GitChanges } from "../api/types";
import { useGitStore } from "../store/gitStore";

const gitChanges = vi.fn();
const gitFileAction = vi.fn();
vi.mock("../api/git", () => ({
  gitChanges: (...a: unknown[]) => gitChanges(...a),
  gitFileAction: (...a: unknown[]) => gitFileAction(...a),
}));

import { DiffView } from "./DiffView";

const sample: GitChanges = {
  is_repo: true,
  branch: "main",
  staged: [],
  unstaged: [
    {
      path: "src/a.ts",
      old_path: null,
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
      too_large: false,
      new_text: "const neo = 2\n",
      old_text: "const old = 2\n",
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          lines: [
            { kind: "del", old_no: 1, new_no: null, text: "const old = 2" },
            { kind: "add", old_no: null, new_no: 1, text: "const neo = 2" },
          ],
        },
      ],
    },
  ],
};

// Three files; clicking the 3rd (src/c.ts) scrolls to a positive offset thanks
// to the scrollHeight/clientHeight stubs in setup.ts.
const oneAdd = (text: string) => [{ kind: "add" as const, old_no: null, new_no: 1, text }];
const multi: GitChanges = {
  is_repo: true,
  branch: "main",
  staged: [],
  unstaged: [
    { path: "src/a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "aaa\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: oneAdd("aaa") }] },
    { path: "src/b.ts", old_path: null, status: "added", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "bbb\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: oneAdd("bbb") }] },
    { path: "src/c.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "ccc\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: oneAdd("ccc") }] },
  ],
};

beforeEach(() => {
  gitChanges.mockReset();
  gitFileAction.mockReset();
  gitFileAction.mockResolvedValue(undefined);
  useGitStore.setState({ changes: null, loading: false, error: null });
});

describe("DiffView", () => {
  it("renders the file header and diff lines", async () => {
    gitChanges.mockResolvedValue(sample);
    render(<DiffView root="/repo" active />);
    expect(await screen.findByTestId("diff-scroll")).toBeInTheDocument();
    expect(await screen.findByText(wholeLine("const neo = 2"))).toBeInTheDocument();
    expect(screen.getByText(wholeLine("const old = 2"))).toBeInTheDocument();
  });

  it("collapses a file's lines when its header is clicked", async () => {
    gitChanges.mockResolvedValue(sample);
    const { container } = render(<DiffView root="/repo" active />);
    await screen.findByText(wholeLine("const neo = 2"));
    const diff = container.querySelector('[data-testid="diff-scroll"]') as HTMLElement;
    await userEvent.click(within(diff).getByText("src/a.ts"));
    expect(screen.queryByText(wholeLine("const neo = 2"))).not.toBeInTheDocument();
  });

  it("shows a binary-file notice instead of hunks", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [{ path: "img.png", old_path: null, status: "modified", additions: 0, deletions: 0, binary: true, too_large: false, new_text: null, old_text: null, hunks: [] }],
    });
    render(<DiffView root="/repo" active />);
    expect(await screen.findByText(/binary file/i)).toBeInTheDocument();
  });

  it("shows the not-a-repository state", async () => {
    gitChanges.mockResolvedValue({ is_repo: false, branch: null, staged: [], unstaged: [] });
    render(<DiffView root="/repo" active />);
    expect(await screen.findByText(/not a git repository/i)).toBeInTheDocument();
  });

  it("shows the no-changes state", async () => {
    gitChanges.mockResolvedValue({ is_repo: true, branch: "main", staged: [], unstaged: [] });
    render(<DiffView root="/repo" active />);
    expect(await screen.findByText(/no changes/i)).toBeInTheDocument();
  });

  it("lists all changed files in the navigator", async () => {
    gitChanges.mockResolvedValue(multi);
    render(<DiffView root="/repo" active />);
    const nav = await screen.findByTestId("diff-file-list");
    expect(within(nav).getByText("src/a.ts")).toBeInTheDocument();
    expect(within(nav).getByText("src/b.ts")).toBeInTheDocument();
    expect(within(nav).getByText("src/c.ts")).toBeInTheDocument();
  });

  it("syntax-highlights a supported line into colored spans", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        {
          path: "a.ts",
          old_path: null,
          status: "added",
          additions: 1,
          deletions: 0,
          binary: false,
          too_large: false,
          new_text: "const x = 1\n",
          old_text: null,
          hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "const x = 1" }] }],
        },
      ],
    });
    const { container } = render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    const constSpan = [...container.querySelectorAll("span")].find((s) => s.textContent === "const");
    expect(constSpan).toBeTruthy();
    expect(constSpan!.className).toBeTruthy();
  });

  it("scrolls the diff when a navigator file is clicked", async () => {
    gitChanges.mockResolvedValue(multi);
    render(<DiffView root="/repo" active />);
    const nav = await screen.findByTestId("diff-file-list");
    const scroller = screen.getByTestId("diff-scroll");
    expect(scroller.scrollTop).toBe(0);
    await userEvent.click(within(nav).getByText("src/c.ts"));
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  it("reveals hidden context lines via the expander controls", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        {
          path: "a.txt",
          old_path: null,
          status: "modified",
          additions: 1,
          deletions: 1,
          binary: false,
          too_large: false,
          new_text: "x1\nx2\nx3\nx4\nx5new\nx6\nx7\nx8\n",
          old_text: "x1\nx2\nx3\nx4\nx5old\nx6\nx7\nx8\n",
          hunks: [
            {
              header: "@@ -4,3 +4,3 @@",
              lines: [
                { kind: "context", old_no: 4, new_no: 4, text: "x4" },
                { kind: "del", old_no: 5, new_no: null, text: "x5old" },
                { kind: "add", old_no: null, new_no: 5, text: "x5new" },
                { kind: "context", old_no: 6, new_no: 6, text: "x6" },
              ],
            },
          ],
        },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    expect(screen.queryByText("x1")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /expand up/i }));
    expect(await screen.findByText("x1")).toBeInTheDocument();
    expect(screen.getByText("x3")).toBeInTheDocument();
  });

  it("shows no expander for files without new_text", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        {
          path: "img.bin",
          old_path: null,
          status: "modified",
          additions: 0,
          deletions: 0,
          binary: true,
          too_large: false,
          new_text: null,
          old_text: null,
          hunks: [],
        },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByText(/binary file/i);
    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
  });

  it("shows Staged and Unstaged sections for a partially staged file", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "staged\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "staged" }] }] },
      ],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "unstaged\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "unstaged" }] }] },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    expect(screen.getByText("Staged")).toBeInTheDocument();
    expect(screen.getByText("Unstaged")).toBeInTheDocument();
  });

  it("shows only the Staged section for a staged-only file", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [
        { path: "a.ts", old_path: null, status: "added", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "s\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "s" }] }] },
      ],
      unstaged: [],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    expect(screen.getByText("Staged")).toBeInTheDocument();
    expect(screen.queryByText("Unstaged")).not.toBeInTheDocument();
  });

  it("badges a partially staged file with both S and U in the navigator", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "s\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "s" }] }] },
      ],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    render(<DiffView root="/repo" active />);
    const nav = await screen.findByTestId("diff-file-list");
    expect(within(nav).getByTestId("badge-staged")).toBeInTheDocument();
    expect(within(nav).getByTestId("badge-unstaged")).toBeInTheDocument();
  });

  it("omits the unstaged stream badge for an untracked file", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        { path: "n.ts", old_path: null, status: "untracked", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "n\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "n" }] }] },
      ],
    });
    render(<DiffView root="/repo" active />);
    const nav = await screen.findByTestId("diff-file-list");
    // Status badge already shows "U" (untracked); the stream badge would duplicate it.
    expect(within(nav).queryByTestId("badge-unstaged")).not.toBeInTheDocument();
  });

  it("expands staged and unstaged context independently", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [
        {
          path: "a.txt",
          old_path: null,
          status: "modified",
          additions: 1,
          deletions: 1,
          binary: false,
          too_large: false,
          new_text: "s1\ns2\ns3\ns4\ns5x\ns6\ns7\ns8\n",
          old_text: null,
          hunks: [
            {
              header: "@@ -4,3 +4,3 @@",
              lines: [
                { kind: "context", old_no: 4, new_no: 4, text: "s4" },
                { kind: "del", old_no: 5, new_no: null, text: "s5old" },
                { kind: "add", old_no: null, new_no: 5, text: "s5x" },
                { kind: "context", old_no: 6, new_no: 6, text: "s6" },
              ],
            },
          ],
        },
      ],
      unstaged: [
        {
          path: "a.txt",
          old_path: null,
          status: "modified",
          additions: 1,
          deletions: 1,
          binary: false,
          too_large: false,
          new_text: "u1\nu2\nu3\nu4\nu5x\nu6\nu7\nu8\n",
          old_text: null,
          hunks: [
            {
              header: "@@ -4,3 +4,3 @@",
              lines: [
                { kind: "context", old_no: 4, new_no: 4, text: "u4" },
                { kind: "del", old_no: 5, new_no: null, text: "u5old" },
                { kind: "add", old_no: null, new_no: 5, text: "u5x" },
                { kind: "context", old_no: 6, new_no: 6, text: "u6" },
              ],
            },
          ],
        },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    expect(screen.queryByText("s1")).not.toBeInTheDocument();
    expect(screen.queryByText("u1")).not.toBeInTheDocument();
    // The staged section renders first, so its expander is the first "expand up".
    const upButtons = screen.getAllByRole("button", { name: /expand up/i });
    await userEvent.click(upButtons[0]);
    expect(await screen.findByText("s1")).toBeInTheDocument();
    expect(screen.queryByText("u1")).not.toBeInTheDocument();
  });

  it("renders Unstage on the Staged section and Stage/Discard on Unstaged", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "s\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "s" }] }] },
      ],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    expect(screen.getByRole("button", { name: "Unstage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("stages a file and reloads when Stage is clicked", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    const callsBefore = gitChanges.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Stage" }));
    await waitFor(() => expect(gitFileAction).toHaveBeenCalledWith("/repo", "a.ts", "stage"));
    await waitFor(() => expect(gitChanges.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("discards only after the user confirms", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(gitFileAction).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(gitFileAction).toHaveBeenCalledWith("/repo", "a.ts", "discard"));
    confirmSpy.mockRestore();
  });

  it("shows an inline error when an action fails", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    gitFileAction.mockRejectedValue({ code: "io", message: "git add boom" });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    await userEvent.click(screen.getByRole("button", { name: "Stage" }));
    expect(await screen.findByTestId("diff-action-error")).toHaveTextContent("git add boom");
  });

  it("disables section buttons while an action is in flight", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    let release: () => void = () => {};
    gitFileAction.mockImplementation(() => new Promise<void>((res) => { release = res; }));
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    await userEvent.click(screen.getByRole("button", { name: "Stage" }));
    expect(screen.getByRole("button", { name: "Stage" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Stage" })).not.toBeDisabled());
  });
});
