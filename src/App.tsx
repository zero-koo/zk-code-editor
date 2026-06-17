import { useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { ActivityBar } from "./components/ActivityBar";
import { FileExplorer } from "./components/FileExplorer";
import { SearchPanel } from "./components/SearchPanel";
import type { FsChange } from "./components/FileTreeNode";
import { TabBar } from "./components/TabBar";
import { EditorPane } from "./components/EditorPane";
import { StatusBar } from "./components/StatusBar";
import { readFile, writeFile } from "./api/fs";
import { useWorkspaceStore } from "./store/workspaceStore";
import { languageIdForFile } from "./lib/language";
import { basename } from "./lib/paths";

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<
    { path: string; line: number; matchStart: number; matchEnd: number; seq: number } | null
  >(null);
  const revealSeq = useRef(0);

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

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;

  const persistDoc = (p: string, doc: string) =>
    setDocs((d) => ({ ...d, [p]: doc }));

  async function openFile(path: string) {
    setNotice(null);
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
    openTab({
      path,
      name: basename(path),
      languageId: languageIdForFile(path),
      dirty: false,
    });
  }

  function activate(view: "explorer" | "search") {
    if (activeView === view && sidebarVisible) {
      setSidebarVisible(false);
    } else {
      setActiveView(view);
      setSidebarVisible(true);
    }
  }

  async function openAt(path: string, line: number, matchStart: number, matchEnd: number) {
    const isOpen = tabs.some((t) => t.path === path);
    if (!isOpen) {
      await openFile(path);
    } else if (activeTabPath !== path) {
      setActive(path);
    }
    setReveal({ path, line, matchStart, matchEnd, seq: ++revealSeq.current });
  }

  function handleClose(path: string) {
    const tab = tabs.find((t) => t.path === path);
    if (tab?.dirty && !confirm(`${tab.name} has unsaved changes. Close anyway?`)) return;
    closeTab(path);
  }

  function handleFsChange(change: FsChange) {
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
  }

  async function handleSave(path: string, doc: string) {
    try {
      await writeFile(path, doc);
      setDocs((d) => ({ ...d, [path]: doc }));
      setDirty(path, false);
    } catch (e) {
      setNotice(`Failed to save ${basename(path)}: ${errorMessage(e)}`);
    }
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-2 text-tx-1 font-sans">
      <TitleBar title={activeTab?.name ?? null} />
      <div className="flex flex-1 min-h-0">
      <ActivityBar activeView={activeView} sidebarVisible={sidebarVisible} onActivate={activate} />
      {sidebarVisible && (
        <>
          {/* Both panels stay mounted so their state (results, expanded tree)
              persists across view switches; only the active one is shown. */}
          <div className={activeView === "explorer" ? "flex" : "hidden"}>
            <FileExplorer onOpenFile={openFile} onFsChange={handleFsChange} />
          </div>
          <div className={activeView === "search" ? "flex" : "hidden"}>
            <SearchPanel onOpenMatch={openAt} />
          </div>
        </>
      )}
      <div className="flex-1 min-w-0 flex flex-col bg-bg-2">
        <TabBar
          tabs={tabs}
          activePath={activeTabPath}
          onSelect={setActive}
          onClose={handleClose}
        />
        {notice && (
          <div className="flex items-start gap-3 m-2 rounded-[11px] border border-bd-1 bg-bg-1 px-3.5 py-3 text-tx-bright text-[12.5px]">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-accent shrink-0 mt-px"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <span>{notice}</span>
          </div>
        )}
        {activeTab ? (
          <EditorPane
            key={activeTab.path}
            path={activeTab.path}
            languageId={activeTab.languageId}
            initialDoc={docs[activeTab.path] ?? ""}
            onChange={() => setDirty(activeTab.path, true)}
            onSave={(doc) => handleSave(activeTab.path, doc)}
            onPersist={persistDoc}
            reveal={reveal && reveal.path === activeTab.path ? reveal : undefined}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-center">
            <div className="w-10 h-10 rounded-[11px] bg-bg-3 text-tx-faint flex items-center justify-center">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
            </div>
            <div className="text-[13.5px] text-tx-bright font-medium">No file open</div>
            <div className="text-xs text-tx-3">
              Select a file in the explorer to start editing
            </div>
          </div>
        )}
        <StatusBar
          path={activeTab?.path ?? null}
          languageId={activeTab?.languageId ?? null}
        />
      </div>
      </div>
    </div>
  );
}
