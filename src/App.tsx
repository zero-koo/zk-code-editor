import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { ActivityBar } from "./components/ActivityBar";
import { FileExplorer } from "./components/FileExplorer";
import { SearchPanel } from "./components/SearchPanel";
import type { FsChange } from "./components/FileTreeNode";
import { TabBar } from "./components/TabBar";
import { EditorPane } from "./components/EditorPane";
import { StatusBar } from "./components/StatusBar";
import { DiffView } from "./components/DiffView";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { InfoIcon, FileIcon } from "./components/icons";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { readFile, writeFile, setWorkspaceRoot } from "./api/fs";
import { useWorkspaceStore } from "./store/workspaceStore";
import { languageIdForFile } from "./lib/language";
import { basename, relativePath } from "./lib/paths";
import { switchWorktreeTabs } from "./lib/worktreeSwitch";
import { loadOpenTabs, saveOpenTabs, saveWorkspaceRoot } from "./lib/workspacePersistence";
import { useCursorStore } from "./store/cursorStore";
import { useGitStore } from "./store/gitStore";

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<
    { path: string; line: number; matchStart: number; matchEnd: number; seq: number } | null
  >(null);
  const revealSeq = useRef(0);
  // Stable setter; the cursor value lives in its own store (only StatusBar reads it).
  const setCursor = useCursorStore((s) => s.setCursor);
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  const root = useWorkspaceStore((s) => s.root);
  const activeView = useWorkspaceStore((s) => s.activeView);
  const setActiveView = useWorkspaceStore((s) => s.setActiveView);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const setDirty = useWorkspaceStore((s) => s.setDirty);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const closeTabsUnder = useWorkspaceStore((s) => s.closeTabsUnder);
  const setRoot = useWorkspaceStore((s) => s.setRoot);

  const gitBranch = useGitStore((s) => s.changes?.branch ?? null);
  const gitLoadedRoot = useGitStore((s) => s.loadedRoot);
  const switchingRef = useRef(false);

  // Source the title name from the git store's loaded root so it changes in the
  // same commit as the branch label — a worktree switch updates the title once,
  // not twice (name now, branch a beat later). Falls back to the live root before
  // the first git load so the name still shows immediately on initial open.
  const titleRoot = gitLoadedRoot ?? root;
  const titleName = titleRoot ? basename(titleRoot) : null;

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;
  const openPaths = useMemo(() => tabs.map((t) => t.path), [tabs]);

  const persistDoc = (p: string, doc: string) =>
    setDocs((d) => ({ ...d, [p]: doc }));

  const openFile = useCallback(
    async (path: string, activate = true) => {
      setNotice(null);
      // Already open — just focus the tab. Re-reading would round-trip the IPC
      // for nothing and clobber any unsaved edits in that tab with disk contents.
      if (useWorkspaceStore.getState().tabs.some((t) => t.path === path)) {
        if (activate) setActive(path);
        return;
      }
      let content;
      try {
        content = await readFile(path);
      } catch (e) {
        setNotice(`Failed to open ${basename(path)}: ${errorMessage(e)}`);
        return;
      }
      if (content.kind === "binary") {
        setNotice(`Cannot preview binary file: ${basename(path)}`);
        return;
      }
      if (content.kind === "too_large") {
        setNotice(`Cannot preview file (too large): ${basename(path)}`);
        return;
      }
      setDocs((d) => ({ ...d, [path]: content.text }));
      openTab(
        {
          path,
          name: basename(path),
          languageId: languageIdForFile(path),
          dirty: false,
        },
        activate
      );
    },
    [openTab, setActive]
  );

  const switchWorktree = useCallback(
    async (path: string) => {
      const store = useWorkspaceStore.getState();
      const oldRoot = store.root;
      if (!oldRoot || path === oldRoot || switchingRef.current) return;
      if (
        store.tabs.some((t) => t.dirty) &&
        !confirm("Unsaved changes will be lost. Switch worktree?")
      )
        return;
      switchingRef.current = true;
      try {
        await switchWorktreeTabs(
          oldRoot,
          path,
          store.tabs.map((t) => t.path),
          store.activeTabPath,
          {
            setWorkspaceRoot,
            setRoot,
            saveWorkspaceRoot,
            closeTabsUnder,
            openFile,
            setActive,
            listOpenPaths: () => useWorkspaceStore.getState().tabs.map((t) => t.path),
          }
        );
      } finally {
        switchingRef.current = false;
      }
    },
    [setRoot, closeTabsUnder, openFile, setActive]
  );

  async function restoreTabs(paths: string[], activePath: string | null) {
    for (const path of paths) {
      try {
        const content = await readFile(path);
        if (content.kind !== "text") continue; // skip binary/too_large
        setDocs((d) => ({ ...d, [path]: content.text }));
        openTab({
          path,
          name: basename(path),
          languageId: languageIdForFile(path),
          dirty: false,
        });
      } catch {
        // missing/unreadable file — skip
      }
    }
    if (activePath && paths.includes(activePath)) setActive(activePath);
  }

  useEffect(() => {
    if (hydratedRef.current) return;
    if (!root) return; // wait until the workspace root is restored/opened
    hydratedRef.current = true;
    const saved = loadOpenTabs();
    if (saved && saved.root === root && tabs.length === 0) {
      void restoreTabs(saved.paths, saved.activePath).finally(() => setHydrated(true));
    } else {
      setHydrated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // Load git changes when a workspace opens so the activity-bar badge shows the
  // current changed-file count from launch (refreshed on save and git-view entry).
  useEffect(() => {
    if (root) useGitStore.getState().load(root);
  }, [root]);

  useEffect(() => {
    if (!hydrated) return; // don't persist until restore has run (avoids clobbering with [])
    if (!root) return;
    // Debounce so the synchronous localStorage write stays off the switch
    // critical path; rapid tab switches coalesce into one write.
    const handle = setTimeout(() => {
      saveOpenTabs({ root, paths: tabs.map((t) => t.path), activePath: activeTabPath });
    }, 300);
    return () => clearTimeout(handle);
  }, [hydrated, root, tabs, activeTabPath]);

  function activate(view: "explorer" | "search" | "git") {
    if (view === "git") {
      setActiveView("git");
      setSidebarVisible(false);
      return;
    }
    if (activeView === view && sidebarVisible) {
      setSidebarVisible(false);
    } else {
      setActiveView(view);
      setSidebarVisible(true);
    }
  }

  useGlobalShortcuts({
    "view.explorer": () => activate("explorer"),
    "view.search": () => activate("search"),
    "view.git": () => activate("git"),
    "help.shortcuts": () => setShortcutsOpen((o) => !o),
  });

  const openAt = useCallback(
    async (path: string, line: number, matchStart: number, matchEnd: number) => {
      const store = useWorkspaceStore.getState();
      if (!store.tabs.some((t) => t.path === path)) {
        await openFile(path);
      } else if (store.activeTabPath !== path) {
        setActive(path);
      }
      setReveal({ path, line, matchStart, matchEnd, seq: ++revealSeq.current });
    },
    [openFile, setActive]
  );

  const handleClose = useCallback(
    (path: string) => {
      const tab = useWorkspaceStore.getState().tabs.find((t) => t.path === path);
      if (tab?.dirty && !confirm(`${tab.name} has unsaved changes. Close anyway?`)) return;
      closeTab(path);
    },
    [closeTab]
  );

  const handleFsChange = useCallback(
    (change: FsChange) => {
      if (change.type === "delete") {
        closeTab(change.path);
        closeTabsUnder(change.path);
      } else if (change.type === "rename") {
        renameTab(change.from, change.to, basename(change.to));
        setDocs((d) => {
          if (!(change.from in d)) return d;
          const next = { ...d };
          next[change.to] = next[change.from];
          delete next[change.from];
          return next;
        });
      }
    },
    [closeTab, closeTabsUnder, renameTab]
  );

  async function handleSave(path: string, doc: string) {
    try {
      await writeFile(path, doc);
      setDocs((d) => ({ ...d, [path]: doc }));
      setDirty(path, false);
      if (root) useGitStore.getState().load(root); // refresh the changed-file badge
    } catch (e) {
      setNotice(`Failed to save ${basename(path)}: ${errorMessage(e)}`);
    }
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-2 text-tx-1 font-sans">
      <TitleBar root={root} name={titleName} branch={gitBranch} onSwitchWorktree={switchWorktree} />
      <div className="flex flex-1 min-h-0">
      <ActivityBar
        activeView={activeView}
        sidebarVisible={sidebarVisible}
        onActivate={activate}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      {sidebarVisible && (
        <>
          {/* Both panels stay mounted so their state (results, expanded tree)
              persists across view switches; only the active one is shown. */}
          <div className={activeView === "explorer" ? "flex" : "hidden"}>
            <FileExplorer onOpenFile={openFile} onFsChange={handleFsChange} />
          </div>
          <div className={activeView === "search" ? "flex" : "hidden"}>
            <SearchPanel onOpenMatch={openAt} active={activeView === "search"} />
          </div>
        </>
      )}
      <div className="flex-1 min-w-0 flex flex-col bg-bg-2">
        <div className={activeView === "git" ? "hidden" : "flex flex-col flex-1 min-h-0"}>
          <TabBar
            tabs={tabs}
            activePath={activeTabPath}
            onSelect={setActive}
            onClose={handleClose}
          />
          {notice && (
            <div className="flex items-start gap-3 m-2 rounded-[11px] border border-bd-1 bg-bg-1 px-3.5 py-3 text-tx-bright text-[12.5px]">
              <InfoIcon size={16} strokeWidth={1.8} className="text-accent shrink-0 mt-px" />
              <span>{notice}</span>
            </div>
          )}
          {activeTab ? (
            <EditorPane
              activePath={activeTab.path}
              openPaths={openPaths}
              languageId={activeTab.languageId}
              initialDoc={docs[activeTab.path] ?? ""}
              onChange={() => setDirty(activeTab.path, true)}
              onSave={(doc) => handleSave(activeTab.path, doc)}
              onPersist={persistDoc}
              onCursorChange={setCursor}
              reveal={reveal && reveal.path === activeTab.path ? reveal : undefined}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-center">
              <div className="w-10 h-10 rounded-[11px] bg-bg-3 text-tx-faint flex items-center justify-center">
                <FileIcon size={20} />
              </div>
              <div className="text-[13.5px] text-tx-bright font-medium">No file open</div>
              <div className="text-xs text-tx-3">
                Select a file in the explorer to start editing
              </div>
            </div>
          )}
          <StatusBar
            path={activeTab ? (root ? relativePath(root, activeTab.path) : activeTab.path) : null}
            languageId={activeTab?.languageId ?? null}
          />
        </div>
        <div className={activeView === "git" ? "flex flex-col flex-1 min-h-0" : "hidden"}>
          <DiffView root={root} active={activeView === "git"} />
        </div>
      </div>
      </div>
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
