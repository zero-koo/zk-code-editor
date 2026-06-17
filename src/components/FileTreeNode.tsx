import { useState } from "react";
import type { DirEntry } from "../api/types";
import { readDir, deletePath, rename, createFile } from "../api/fs";
import { dirname, joinPath } from "../lib/paths";

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
        className="tree-row"
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={toggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        role="treeitem"
      >
        <span className="tree-icon">{entry.is_dir ? (expanded ? "📂" : "📁") : "📄"}</span>{" "}
        <span className="tree-name">{entry.name}</span>
      </div>
      {menuOpen && (
        <div role="menu" className="context-menu">
          {entry.is_dir && (
            <button role="menuitem" onClick={handleNewFile}>New File</button>
          )}
          <button role="menuitem" onClick={handleRename}>Rename</button>
          <button role="menuitem" onClick={handleDelete}>Delete</button>
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
