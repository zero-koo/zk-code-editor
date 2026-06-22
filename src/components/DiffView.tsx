import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileDiff } from "../api/types";
import { useGitStore } from "../store/gitStore";

interface Props {
  root: string | null;
  active: boolean;
}

type Row =
  | { kind: "file"; file: FileDiff }
  | { kind: "hunk"; header: string }
  | { kind: "line"; lineKind: "context" | "add" | "del"; oldNo: number | null; newNo: number | null; text: string }
  | { kind: "info"; text: string };

const ROW_H: Record<Row["kind"], number> = { file: 34, hunk: 22, line: 20, info: 28 };

const STATUS_BADGE: Record<FileDiff["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export function DiffView({ root, active }: Props) {
  const changes = useGitStore((s) => s.changes);
  const loading = useGitStore((s) => s.loading);
  const error = useGitStore((s) => s.error);
  const load = useGitStore((s) => s.load);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active && root) load(root);
  }, [active, root, load]);

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  const rows: Row[] = [];
  if (changes) {
    for (const file of changes.files) {
      rows.push({ kind: "file", file });
      if (collapsed.has(file.path)) continue;
      if (file.binary) {
        rows.push({ kind: "info", text: "Binary file not shown" });
        continue;
      }
      if (file.too_large) {
        rows.push({ kind: "info", text: "File too large to display" });
        continue;
      }
      for (const h of file.hunks) {
        rows.push({ kind: "hunk", header: h.header });
        for (const l of h.lines) {
          rows.push({ kind: "line", lineKind: l.kind, oldNo: l.old_no, newNo: l.new_no, text: l.text });
        }
      }
    }
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_H[rows[i].kind],
    overscan: 16,
  });

  const headerBar = (
    <div className="h-10 shrink-0 flex items-center gap-3 px-3.5 border-b border-bd-2 text-[12.5px] text-tx-2">
      <span className="font-medium text-tx-bright">{changes?.branch ?? "—"}</span>
      <span className="text-tx-3">{changes ? `${changes.files.length} changed` : ""}</span>
      <span className="flex-1" />
      <button
        onClick={() => root && load(root)}
        className="text-[11.5px] text-tx-2 border border-bd-1 rounded-[7px] px-2.5 py-1 hover:bg-bg-3 hover:text-tx-1"
      >
        Refresh
      </button>
    </div>
  );

  let body;
  if (loading && !changes) {
    body = <Centered>Loading changes…</Centered>;
  } else if (error) {
    body = <Centered>{error}</Centered>;
  } else if (changes && !changes.is_repo) {
    body = <Centered>Not a Git repository</Centered>;
  } else if (changes && changes.files.length === 0) {
    body = <Centered>No changes</Centered>;
  } else {
    body = (
      <div ref={scrollRef} className="zk-scroll flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const row = rows[vItem.index];
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vItem.size, transform: `translateY(${vItem.start}px)` }}
              >
                {renderRow(row, toggle)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {headerBar}
      {body}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center text-[13px] text-tx-3">{children}</div>
  );
}

function renderRow(row: Row, toggle: (path: string) => void) {
  if (row.kind === "file") {
    const f = row.file;
    const label = f.old_path ? `${f.old_path} → ${f.path}` : f.path;
    return (
      <div
        className="flex items-center gap-2 h-[34px] px-3 bg-bg-1 border-b border-bd-2 cursor-pointer hover:bg-bg-3"
        onClick={() => toggle(f.path)}
      >
        <span className="w-4 text-center text-[11px] text-tx-2">{STATUS_BADGE[f.status]}</span>
        <span className="flex-1 truncate text-[12.5px] text-tx-1">{label}</span>
        {f.additions > 0 && <span className="text-[11.5px] text-emerald-400">+{f.additions}</span>}
        {f.deletions > 0 && <span className="text-[11.5px] text-red-400">−{f.deletions}</span>}
      </div>
    );
  }
  if (row.kind === "hunk") {
    return (
      <div className="h-[22px] px-3 font-mono text-[11.5px] text-tx-3 bg-bg-2 flex items-center truncate">
        {row.header}
      </div>
    );
  }
  if (row.kind === "info") {
    return <div className="h-[28px] px-3 flex items-center text-[12px] text-tx-3 italic">{row.text}</div>;
  }
  const bg = row.lineKind === "add" ? "bg-emerald-500/10" : row.lineKind === "del" ? "bg-red-500/10" : "";
  const marker = row.lineKind === "add" ? "+" : row.lineKind === "del" ? "−" : " ";
  return (
    <div className={`h-5 flex items-stretch font-mono text-[12px] ${bg}`}>
      <span className="w-10 shrink-0 text-right pr-2 text-tx-faint select-none">{row.oldNo ?? ""}</span>
      <span className="w-10 shrink-0 text-right pr-2 text-tx-faint select-none">{row.newNo ?? ""}</span>
      <span className="w-4 shrink-0 text-center text-tx-3 select-none">{marker}</span>
      <span className="whitespace-pre flex-1 pr-3 text-tx-1">{row.text}</span>
    </div>
  );
}
