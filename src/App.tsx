import { useState } from "react";
import { ActivityBar } from "./components/ActivityBar";
import { FileExplorer } from "./components/FileExplorer";
import type { FsChange } from "./components/FileTreeNode";
import { TabBar } from "./components/TabBar";
import { EditorPane } from "./components/EditorPane";
import { StatusBar } from "./components/StatusBar";
import { readFile, writeFile } from "./api/fs";
import { useWorkspaceStore } from "./store/workspaceStore";
import { languageIdForFile } from "./lib/language";
import { basename } from "./lib/paths";
import "./App.css";

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, string>>({});

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
    <div className="app">
      <ActivityBar
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
      />
      {sidebarVisible && (
        <div className="sidebar">
          <FileExplorer onOpenFile={openFile} onFsChange={handleFsChange} />
        </div>
      )}
      <div className="editor-area">
        <TabBar
          tabs={tabs}
          activePath={activeTabPath}
          onSelect={setActive}
          onClose={handleClose}
        />
        {notice && <div className="notice">{notice}</div>}
        {activeTab ? (
          <EditorPane
            key={activeTab.path}
            path={activeTab.path}
            languageId={activeTab.languageId}
            initialDoc={docs[activeTab.path] ?? ""}
            onChange={() => setDirty(activeTab.path, true)}
            onSave={(doc) => handleSave(activeTab.path, doc)}
            onPersist={persistDoc}
          />
        ) : (
          <div className="empty">No file open</div>
        )}
        <StatusBar
          path={activeTab?.path ?? null}
          languageId={activeTab?.languageId ?? null}
        />
      </div>
    </div>
  );
}
