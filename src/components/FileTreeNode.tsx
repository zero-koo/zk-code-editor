import { useState } from "react";
import type { DirEntry } from "../api/types";
import { readDir, deletePath, rename, createFile } from "../api/fs";
import { dirname, joinPath } from "../lib/paths";
import { useWorkspaceStore } from "../store/workspaceStore";

export type FsChange =
  | { type: "delete"; path: string }
  | { type: "rename"; from: string; to: string }
  | { type: "create"; path: string };

interface Props {
  entry: DirEntry;
  depth: number;
  onOpenFile: (path: string) => void;
  onFsChange?: (change: FsChange) => void;
}

export function FileTreeNode({ entry, depth, onOpenFile, onFsChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const selected = useWorkspaceStore(
    (s) => !entry.is_dir && s.activeTabPath === entry.path
  );

  async function loadChildren() {
    setChildren(await readDir(entry.path));
  }

  async function toggle() {
    if (entry.is_dir) {
      const next = !expanded;
      setExpanded(next);
      if (next && children === null) await loadChildren();
    } else {
      onOpenFile(entry.path);
    }
  }

  async function handleDelete() {
    setMenuOpen(false);
    if (!confirm(`Delete ${entry.name}?`)) return;
    await deletePath(entry.path);
    onFsChange?.({ type: "delete", path: entry.path });
  }

  async function handleRename() {
    setMenuOpen(false);
    const name = prompt("New name", entry.name);
    if (!name) return;
    const to = joinPath(dirname(entry.path), name);
    await rename(entry.path, to);
    onFsChange?.({ type: "rename", from: entry.path, to });
  }

  async function handleNewFile() {
    setMenuOpen(false);
    const name = prompt("New file name");
    if (!name) return;
    const target = joinPath(entry.path, name);
    await createFile(target);
    onFsChange?.({ type: "create", path: target });
    if (expanded) await loadChildren();
  }

  return (
    <div>
      <div
        className={`relative flex items-center gap-1.5 h-[27px] px-1.5 rounded-md cursor-pointer ${
          selected
            ? "bg-accent/15 text-white font-medium"
            : "text-tx-2 hover:bg-white/5 hover:text-tx-bright"
        }`}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={toggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        role="treeitem"
        aria-selected={selected}
      >
        {selected && (
          <span className="absolute left-0 top-[5px] w-[2.5px] h-[17px] rounded bg-accent" />
        )}
        <span className="tree-icon flex items-center shrink-0">
          {entry.is_dir ? (
            <>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#63636e"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#7c84a8"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 8a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
              </svg>
            </>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#7aa2f7"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
          )}
        </span>
        <span className="tree-name truncate">{entry.name}</span>
      </div>
      {menuOpen && (
        <div
          role="menu"
          className="bg-[#1c1c22] border border-[#2c2c34] rounded-[10px] p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)] min-w-[184px]"
        >
          {entry.is_dir && (
            <button
              role="menuitem"
              onClick={handleNewFile}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[7px] text-[12.5px] cursor-pointer text-tx-bright hover:bg-white/5 hover:text-white"
            >
              <svg
                width="14"
                height="14"
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
              New File
            </button>
          )}
          <button
            role="menuitem"
            onClick={handleRename}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[7px] text-[12.5px] cursor-pointer text-tx-bright hover:bg-white/5 hover:text-white"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Rename
          </button>
          <div className="h-px bg-[#2c2c34] my-1 mx-1.5" />
          <button
            role="menuitem"
            onClick={handleDelete}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[7px] text-[12.5px] cursor-pointer text-danger hover:bg-danger/12"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Delete
          </button>
        </div>
      )}
      {expanded &&
        children?.map((child) => (
          <FileTreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            onOpenFile={onOpenFile}
            onFsChange={onFsChange}
          />
        ))}
    </div>
  );
}
