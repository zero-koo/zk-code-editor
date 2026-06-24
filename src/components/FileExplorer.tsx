import { memo, useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { setWorkspaceRoot, readDir } from "../api/fs";
import type { DirEntry } from "../api/types";
import { useWorkspaceStore } from "../store/workspaceStore";
import { saveWorkspaceRoot, loadWorkspaceRoot } from "../lib/workspacePersistence";
import { FileTreeNode } from "./FileTreeNode";
import type { FsChange } from "./FileTreeNode";
import { FolderOpenIcon } from "./icons";
import { SectionLabel } from "./SectionLabel";
import { SidebarPanel } from "./SidebarPanel";

interface Props {
  onOpenFile: (path: string) => void;
  onFsChange?: (change: FsChange) => void;
}

export const FileExplorer = memo(function FileExplorer({ onOpenFile, onFsChange }: Props) {
  const root = useWorkspaceStore((s) => s.root);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const [entries, setEntries] = useState<DirEntry[]>([]);

  async function openFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    await setWorkspaceRoot(selected);
    setRoot(selected);
    saveWorkspaceRoot(selected);
    setEntries(await readDir(selected));
  }

  // Restore the workspace root after a reload/restart: the dev server (Vite)
  // reloads the webview when project files change, wiping the in-memory store.
  // Only restore when the store has no root yet; the list effect below does the
  // actual `readDir` once `root` is set (here or via Open Folder / a switch).
  useEffect(() => {
    if (useWorkspaceStore.getState().root) return;
    const target = loadWorkspaceRoot();
    if (!target) return;
    (async () => {
      try {
        await setWorkspaceRoot(target);
        setRoot(target);
      } catch {
        saveWorkspaceRoot(null); // folder gone/invalid — forget it
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // List the tree whenever the root changes (mount, Open Folder, worktree
  // switch). Guard against the initial null root.
  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await readDir(root);
        if (!cancelled) setEntries(list);
      } catch {
        // invalid root; the restore effect forgets it on a cold start
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root]);

  // Stable identity so memoized FileTreeNode children don't re-render.
  const handleFsChange = useCallback(
    async (change: FsChange) => {
      onFsChange?.(change);
      const current = useWorkspaceStore.getState().root;
      if (current) setEntries(await readDir(current));
    },
    [onFsChange]
  );

  return (
    <SidebarPanel>
      <div className="h-[42px] shrink-0 flex items-center justify-between pl-4 pr-2.5">
        <SectionLabel>Explorer</SectionLabel>
        <button
          onClick={openFolder}
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-tx-2 bg-transparent border border-bd-1 rounded-[7px] px-2.5 py-1 cursor-pointer hover:bg-bg-3 hover:text-tx-1 hover:border-bd-hover"
        >
          <FolderOpenIcon size={13} strokeWidth={1.8} />
          Open Folder
        </button>
      </div>
      {root && (
        <div role="tree" className="zk-scroll flex-1 overflow-auto px-1.5 pb-2.5 text-[13px]">
          {entries.map((e) => (
            <FileTreeNode
              key={e.path}
              entry={e}
              depth={0}
              onOpenFile={onOpenFile}
              onFsChange={handleFsChange}
            />
          ))}
        </div>
      )}
    </SidebarPanel>
  );
});
