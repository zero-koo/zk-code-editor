import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitChanges } from "../api/types";
import { useGitStore } from "../store/gitStore";

const gitChanges = vi.fn();
vi.mock("../api/git", () => ({ gitChanges: (...a: unknown[]) => gitChanges(...a) }));

import { DiffView } from "./DiffView";

const sample: GitChanges = {
  is_repo: true,
  branch: "main",
  files: [
    {
      path: "src/a.ts",
      old_path: null,
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
      too_large: false,
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

// Three files; clicking the 3rd (src/c.ts, at pixel offset 152) scrolls to a
// positive offset thanks to the scrollHeight/clientHeight stubs in setup.ts.
const oneAdd = (text: string) => [{ kind: "add" as const, old_no: null, new_no: 1, text }];
const multi: GitChanges = {
  is_repo: true,
  branch: "main",
  files: [
    { path: "src/a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: oneAdd("aaa") }] },
    { path: "src/b.ts", old_path: null, status: "added", additions: 1, deletions: 0, binary: false, too_large: false, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: oneAdd("bbb") }] },
    { path: "src/c.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: oneAdd("ccc") }] },
  ],
};

beforeEach(() => {
  gitChanges.mockReset();
  useGitStore.setState({ changes: null, loading: false, error: null });
});

describe("DiffView", () => {
  it("renders the file header and diff lines", async () => {
    gitChanges.mockResolvedValue(sample);
    render(<DiffView root="/repo" active />);
    expect(await screen.findByTestId("diff-scroll")).toBeInTheDocument();
    expect(await screen.findByText("const neo = 2")).toBeInTheDocument();
    expect(screen.getByText("const old = 2")).toBeInTheDocument();
  });

  it("collapses a file's lines when its header is clicked", async () => {
    gitChanges.mockResolvedValue(sample);
    const { container } = render(<DiffView root="/repo" active />);
    await screen.findByText("const neo = 2");
    const diff = container.querySelector('[data-testid="diff-scroll"]') as HTMLElement;
    await userEvent.click(within(diff).getByText("src/a.ts"));
    expect(screen.queryByText("const neo = 2")).not.toBeInTheDocument();
  });

  it("shows a binary-file notice instead of hunks", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      files: [{ path: "img.png", old_path: null, status: "modified", additions: 0, deletions: 0, binary: true, too_large: false, hunks: [] }],
    });
    render(<DiffView root="/repo" active />);
    expect(await screen.findByText(/binary file/i)).toBeInTheDocument();
  });

  it("shows the not-a-repository state", async () => {
    gitChanges.mockResolvedValue({ is_repo: false, branch: null, files: [] });
    render(<DiffView root="/repo" active />);
    expect(await screen.findByText(/not a git repository/i)).toBeInTheDocument();
  });

  it("shows the no-changes state", async () => {
    gitChanges.mockResolvedValue({ is_repo: true, branch: "main", files: [] });
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

  it("scrolls the diff when a navigator file is clicked", async () => {
    gitChanges.mockResolvedValue(multi);
    render(<DiffView root="/repo" active />);
    const nav = await screen.findByTestId("diff-file-list");
    const scroller = screen.getByTestId("diff-scroll");
    expect(scroller.scrollTop).toBe(0);
    await userEvent.click(within(nav).getByText("src/c.ts"));
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });
});
