import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

const reset = () =>
  useWorkspaceStore.setState({
    root: null,
    tabs: [],
    activeTabPath: null,
    expandedDirs: new Set<string>(),
    activeView: "explorer",
  });

describe("workspace store", () => {
  beforeEach(reset);

  it("openTab adds a tab and activates it", () => {
    useWorkspaceStore.getState().openTab({
      path: "/p/a.ts", name: "a.ts", languageId: "typescript", dirty: false,
    });
    const s = useWorkspaceStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabPath).toBe("/p/a.ts");
  });

  it("openTab on an existing path activates without duplicating", () => {
    const tab = { path: "/p/a.ts", name: "a.ts", languageId: "typescript", dirty: false };
    const { openTab } = useWorkspaceStore.getState();
    openTab(tab);
    openTab(tab);
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
  });

  it("setDirty flips the flag on the matching tab", () => {
    const { openTab, setDirty } = useWorkspaceStore.getState();
    openTab({ path: "/p/a.ts", name: "a.ts", languageId: "typescript", dirty: false });
    setDirty("/p/a.ts", true);
    expect(useWorkspaceStore.getState().tabs[0].dirty).toBe(true);
  });

  it("closeTab removes the tab and picks a neighbor as active", () => {
    const { openTab, closeTab } = useWorkspaceStore.getState();
    openTab({ path: "/p/a.ts", name: "a.ts", languageId: "typescript", dirty: false });
    openTab({ path: "/p/b.ts", name: "b.ts", languageId: "typescript", dirty: false });
    closeTab("/p/b.ts");
    const s = useWorkspaceStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(["/p/a.ts"]);
    expect(s.activeTabPath).toBe("/p/a.ts");
  });

  it("renameTab updates path and name of an open tab", () => {
    const { openTab, renameTab } = useWorkspaceStore.getState();
    openTab({ path: "/p/a.ts", name: "a.ts", languageId: "typescript", dirty: false });
    renameTab("/p/a.ts", "/p/b.ts", "b.ts");
    const s = useWorkspaceStore.getState();
    expect(s.tabs[0].path).toBe("/p/b.ts");
    expect(s.activeTabPath).toBe("/p/b.ts");
  });

  it("closeTabsUnder closes tabs inside a deleted directory", () => {
    const { openTab, closeTabsUnder } = useWorkspaceStore.getState();
    openTab({ path: "/p/sub/a.ts", name: "a.ts", languageId: "typescript", dirty: false });
    openTab({ path: "/p/keep.ts", name: "keep.ts", languageId: "typescript", dirty: false });
    closeTabsUnder("/p/sub");
    expect(useWorkspaceStore.getState().tabs.map((t) => t.path)).toEqual(["/p/keep.ts"]);
  });

  it("toggleDir adds then removes from expandedDirs", () => {
    const { toggleDir } = useWorkspaceStore.getState();
    toggleDir("/p/sub");
    expect(useWorkspaceStore.getState().expandedDirs.has("/p/sub")).toBe(true);
    toggleDir("/p/sub");
    expect(useWorkspaceStore.getState().expandedDirs.has("/p/sub")).toBe(false);
  });

  it("activeView defaults to explorer and can switch", () => {
    expect(useWorkspaceStore.getState().activeView).toBe("explorer");
    useWorkspaceStore.getState().setActiveView("search");
    expect(useWorkspaceStore.getState().activeView).toBe("search");
  });
});
