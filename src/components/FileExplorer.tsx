import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { setWorkspaceRoot, readDir } from "../api/fs";
import type { DirEntry } from "../api/types";
import { useWorkspaceStore } from "../store/workspaceStore";
import { saveWorkspaceRoot, loadWorkspaceRoot } from "../lib/workspacePersistence";
import { FileTreeNode } from "./FileTreeNode";
import type { FsChange } from "./FileTreeNode";

interface Props {
  onOpenFile: (path: string) => void;
  onFsChange?: (change: FsChange) => void;
}

export function FileExplorer({ onOpenFile, onFsChange }: Props) {
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

  // Restore the workspace after a reload/restart: the dev server (Vite) reloads
  // the webview when project files change, which wipes the in-memory store —
  // re-open the last folder and re-list its tree so it doesn't vanish.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = useWorkspaceStore.getState().root;
      const target = current ?? loadWorkspaceRoot();
      if (!target) return;
      try {
        if (!current) {
          await setWorkspaceRoot(target);
          setRoot(target);
        }
        const list = await readDir(target);
        if (!cancelled) setEntries(list);
      } catch {
        saveWorkspaceRoot(null); // folder gone/invalid — forget it
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFsChange(change: FsChange) {
    onFsChange?.(change);
    if (root) setEntries(await readDir(root));
  }

  return (
    <div className="w-[258px] shrink-0 bg-bg-1 border-r border-bd-2 flex flex-col">
      <div className="h-[42px] shrink-0 flex items-center justify-between pl-4 pr-2.5">
        <span className="text-[11px] font-semibold tracking-[0.13em] uppercase text-tx-3">
          Explorer
        </span>
        <button
          onClick={openFolder}
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-tx-2 bg-transparent border border-bd-1 rounded-[7px] px-2.5 py-1 cursor-pointer hover:bg-bg-3 hover:text-tx-1 hover:border-bd-hover"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
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
    </div>
  );
}
