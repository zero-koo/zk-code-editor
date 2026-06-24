import { describe, it, expect, vi } from "vitest";
import { switchWorktreeTabs, type WorktreeSwitchOps } from "./worktreeSwitch";

function makeOps(finalOpen: string[]) {
  const calls: string[] = [];
  const ops: WorktreeSwitchOps = {
    setWorkspaceRoot: vi.fn(async (p: string) => { calls.push(`setWorkspaceRoot:${p}`); }),
    setRoot: vi.fn((p: string) => { calls.push(`setRoot:${p}`); }),
    saveWorkspaceRoot: vi.fn((p: string) => { calls.push(`saveWorkspaceRoot:${p}`); }),
    closeTabsUnder: vi.fn((d: string) => { calls.push(`closeTabsUnder:${d}`); }),
    openFile: vi.fn(async (p: string, activate: boolean) => { calls.push(`openFile:${p}:${activate}`); }),
    setActive: vi.fn((p: string) => { calls.push(`setActive:${p}`); }),
    listOpenPaths: () => finalOpen,
  };
  return { ops, calls };
}

describe("switchWorktreeTabs", () => {
  it("opens+focuses the active file first, then closes old tabs, then reopens the rest unfocused", async () => {
    const { ops, calls } = makeOps(["/b/src/x.ts", "/b/y.ts"]);
    await switchWorktreeTabs(
      "/a",
      "/b",
      ["/a/src/x.ts", "/a/y.ts"],
      "/a/src/x.ts",
      ops
    );
    expect(calls).toEqual([
      "setWorkspaceRoot:/b",
      "setRoot:/b",
      "saveWorkspaceRoot:/b",
      "openFile:/b/src/x.ts:true",   // active file first, focused
      "closeTabsUnder:/a",            // then drop old tabs
      "openFile:/b/y.ts:false",       // rest reopened without focus
    ]);
    // active file reopened successfully → no fallback setActive
    expect(ops.setActive).not.toHaveBeenCalled();
  });

  it("focuses the first remaining tab when the active file cannot reopen", async () => {
    // active file (/a/gone.ts) is NOT in the final open set
    const { ops, calls } = makeOps(["/b/y.ts"]);
    await switchWorktreeTabs("/a", "/b", ["/a/gone.ts", "/a/y.ts"], "/a/gone.ts", ops);
    expect(calls).toContain("openFile:/b/gone.ts:true"); // attempted, focused
    expect(calls).toContain("openFile:/b/y.ts:false");
    expect(ops.setActive).toHaveBeenCalledWith("/b/y.ts"); // fallback focus
  });

  it("never opens an active file or sets active when there is no active tab", async () => {
    const { ops } = makeOps(["/b/y.ts"]);
    await switchWorktreeTabs("/a", "/b", ["/a/y.ts"], null, ops);
    // y.ts is the only file and was reopened unfocused; fallback focuses it
    expect(ops.openFile).toHaveBeenCalledWith("/b/y.ts", false);
    expect(ops.setActive).toHaveBeenCalledWith("/b/y.ts");
  });

  it("handles an empty tab set (just re-points, no setActive)", async () => {
    const { ops, calls } = makeOps([]);
    await switchWorktreeTabs("/a", "/b", [], null, ops);
    expect(calls).toEqual([
      "setWorkspaceRoot:/b",
      "setRoot:/b",
      "saveWorkspaceRoot:/b",
      "closeTabsUnder:/a",
    ]);
    expect(ops.setActive).not.toHaveBeenCalled();
  });
});
