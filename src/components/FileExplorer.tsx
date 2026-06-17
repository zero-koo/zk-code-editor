import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { setWorkspaceRoot, readDir } from "../api/fs";
import type { DirEntry } from "../api/types";
import { useWorkspaceStore } from "../store/workspaceStore";
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
    setEntries(await readDir(selected));
  }

  async function handleFsChange(change: FsChange) {
    onFsChange?.(change);
    if (root) setEntries(await readDir(root));
  }

  return (
    <div className="explorer">
      <div className="explorer-header">
        <span className="label">EXPLORER</span>
        <button onClick={openFolder}>Open Folder</button>
      </div>
      {root && (
        <div role="tree">
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
