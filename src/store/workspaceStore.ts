import { create } from "zustand";
import type { Tab } from "../api/types";
import { languageIdForFile } from "../lib/language";

interface WorkspaceState {
  root: string | null;
  tabs: Tab[];
  activeTabPath: string | null;
  expandedDirs: Set<string>;
  activeView: "explorer" | "search" | "git";

  setRoot: (root: string) => void;
  setActiveView: (view: "explorer" | "search" | "git") => void;
  openTab: (tab: Tab) => void;
  closeTab: (path: string) => void;
  closeTabsUnder: (dir: string) => void;
  setActive: (path: string) => void;
  setDirty: (path: string, dirty: boolean) => void;
  renameTab: (oldPath: string, newPath: string, newName: string) => void;
  toggleDir: (path: string) => void;
}

function neighborPath(tabs: Tab[], removedPath: string): string | null {
  const idx = tabs.findIndex((t) => t.path === removedPath);
  if (idx < 0) return null;
  const remaining = tabs.filter((t) => t.path !== removedPath);
  if (remaining.length === 0) return null;
  return remaining[Math.min(idx, remaining.length - 1)].path;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  root: null,
  tabs: [],
  activeTabPath: null,
  expandedDirs: new Set<string>(),
  activeView: "explorer",

  setRoot: (root) => set({ root }),
  setActiveView: (view) => set({ activeView: view }),

  openTab: (tab) =>
    set((s) => {
      if (s.tabs.some((t) => t.path === tab.path)) {
        return { activeTabPath: tab.path };
      }
      return { tabs: [...s.tabs, tab], activeTabPath: tab.path };
    }),

  closeTab: (path) =>
    set((s) => {
      const nextActive =
        s.activeTabPath === path ? neighborPath(s.tabs, path) : s.activeTabPath;
      return { tabs: s.tabs.filter((t) => t.path !== path), activeTabPath: nextActive };
    }),

  closeTabsUnder: (dir) =>
    set((s) => {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      const kept = s.tabs.filter((t) => t.path !== dir && !t.path.startsWith(prefix));
      const activeStillOpen = kept.some((t) => t.path === s.activeTabPath);
      return {
        tabs: kept,
        activeTabPath: activeStillOpen ? s.activeTabPath : kept[kept.length - 1]?.path ?? null,
      };
    }),

  setActive: (path) => set({ activeTabPath: path }),

  setDirty: (path, dirty) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.path === path);
      if (!tab || tab.dirty === dirty) return s; // unchanged → no new array, no re-render
      return { tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty } : t)) };
    }),

  renameTab: (oldPath, newPath, newName) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === oldPath
          ? { ...t, path: newPath, name: newName, languageId: languageIdForFile(newName) }
          : t
      ),
      activeTabPath: s.activeTabPath === oldPath ? newPath : s.activeTabPath,
    })),

  toggleDir: (path) =>
    set((s) => {
      const next = new Set(s.expandedDirs);
      next.has(path) ? next.delete(path) : next.add(path);
      return { expandedDirs: next };
    }),
}));
