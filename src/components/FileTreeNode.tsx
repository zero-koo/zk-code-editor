import { useState } from "react";
import type { DirEntry } from "../api/types";
import { readDir } from "../api/fs";

interface Props {
  entry: DirEntry;
  depth: number;
  onOpenFile: (path: string) => void;
}

export function FileTreeNode({ entry, depth, onOpenFile }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  async function toggle() {
    if (entry.is_dir) {
      const next = !expanded;
      setExpanded(next);
      if (next && children === null) {
        setChildren(await readDir(entry.path));
      }
    } else {
      onOpenFile(entry.path);
    }
  }

  return (
    <div>
      <div
        className="tree-row"
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={toggle}
        role="treeitem"
      >
        <span className="tree-icon">{entry.is_dir ? (expanded ? "📂" : "📁") : "📄"}</span>{" "}
        <span className="tree-name">{entry.name}</span>
      </div>
      {expanded &&
        children?.map((child) => (
          <FileTreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            onOpenFile={onOpenFile}
          />
        ))}
    </div>
  );
}
