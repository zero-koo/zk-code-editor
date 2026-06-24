import { describe, it, expect, vi } from "vitest";
import { switchWorktreeTabs, type WorktreeSwitchOps } from "./worktreeSwitch";

function makeOps(openAfter: Set<string>) {
  const calls: string[] = [];
  const opened: string[] = [];
  const ops: WorktreeSwitchOps = {
    setWorkspaceRoot: vi.fn(async (p: string) => { calls.push(`setWorkspaceRoot:${p}`); }),
    setRoot: vi.fn((p: string) => { calls.push(`setRoot:${p}`); }),
    saveWorkspaceRoot: vi.fn((p: string) => { calls.push(`saveWorkspaceRoot:${p}`); }),
    closeTabsUnder: vi.fn((d: string) => { calls.push(`closeTabsUnder:${d}`); }),
    openFile: vi.fn(async (p: string) => { calls.push(`openFile:${p}`); opened.push(p); }),
    setActive: vi.fn((p: string) => { calls.push(`setActive:${p}`); }),
    isTabOpen: (p: string) => openAfter.has(p),
  };
  return { ops, calls, opened };
}

describe("switchWorktreeTabs", () => {
  it("re-points the root then remaps each open tab under the new root", async () => {
    const opened = new Set(["/b/src/x.ts", "/b/y.ts"]);
    const { ops, calls } = makeOps(opened);
    await switchWorktreeTabs(
      "/a",
      "/b",
      ["/a/src/x.ts", "/a/y.ts"],
      "/a/src/x.ts",
      ops
    );
    // re-point happens before any file is reopened
    expect(calls).toEqual([
      "setWorkspaceRoot:/b",
      "setRoot:/b",
      "saveWorkspaceRoot:/b",
      "closeTabsUnder:/a",
      "openFile:/b/src/x.ts",
      "openFile:/b/y.ts",
      "setActive:/b/src/x.ts",
    ]);
  });

  it("does not restore the active tab when it failed to reopen in the new worktree", async () => {
    // active file is missing in the new worktree → not in openAfter
    const { ops } = makeOps(new Set(["/b/y.ts"]));
    await switchWorktreeTabs("/a", "/b", ["/a/gone.ts", "/a/y.ts"], "/a/gone.ts", ops);
    expect(ops.setActive).not.toHaveBeenCalled();
  });

  it("never calls setActive when there is no active tab", async () => {
    const { ops } = makeOps(new Set(["/b/y.ts"]));
    await switchWorktreeTabs("/a", "/b", ["/a/y.ts"], null, ops);
    expect(ops.setActive).not.toHaveBeenCalled();
  });

  it("handles an empty tab set (just re-points)", async () => {
    const { ops, calls } = makeOps(new Set());
    await switchWorktreeTabs("/a", "/b", [], null, ops);
    expect(calls).toEqual([
      "setWorkspaceRoot:/b",
      "setRoot:/b",
      "saveWorkspaceRoot:/b",
      "closeTabsUnder:/a",
    ]);
  });
});
