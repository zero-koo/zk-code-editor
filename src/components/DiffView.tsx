import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileDiff } from "../api/types";
import { useGitStore } from "../store/gitStore";
import { activeFileForOffset, type FileOffset } from "../lib/diffNav";
import { getHighlightedLines, clearHighlightCache } from "../lib/diffHighlight";
import { languageIdForFile } from "../lib/language";
import { fileGaps, revealGap } from "../lib/diffExpand";

interface Props {
  root: string | null;
  active: boolean;
}

type Row =
  | { kind: "file"; file: FileDiff }
  | { kind: "hunk"; header: string }
  | { kind: "line"; lineKind: "context" | "add" | "del"; oldNo: number | null; newNo: number | null; text: string; langId: string; newText: string | null; oldText: string | null }
  | { kind: "info"; text: string }
  | { kind: "expander"; gapKey: string; canUp: boolean; canDown: boolean; remaining: number };

const ROW_H: Record<Row["kind"], number> = { file: 34, hunk: 22, line: 20, info: 28, expander: 22 };
const EXPAND_STEP = 20;

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
  const [expanded, setExpanded] = useState<Map<string, { top: number; bottom: number }>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active && root) load(root);
  }, [active, root, load]);

  useEffect(() => {
    clearHighlightCache();
    setExpanded(new Map()); // line numbers change on reload → reset gap expansion
  }, [changes]);

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  function expand(gapKey: string, dir: "up" | "down") {
    setExpanded((prev) => {
      const next = new Map(prev);
      const cur = next.get(gapKey) ?? { top: 0, bottom: 0 };
      next.set(
        gapKey,
        dir === "down" ? { ...cur, top: cur.top + EXPAND_STEP } : { ...cur, bottom: cur.bottom + EXPAND_STEP }
      );
      return next;
    });
  }

  const rows: Row[] = [];
  const pathToRowIndex = new Map<string, number>();
  const fileOffsets: FileOffset[] = [];
  let top = 0;
  if (changes) {
    for (const file of changes.files) {
      pathToRowIndex.set(file.path, rows.length);
      fileOffsets.push({ path: file.path, top });
      rows.push({ kind: "file", file });
      top += ROW_H.file;
      const langId = languageIdForFile(file.path);
      if (collapsed.has(file.path)) continue;
      if (file.binary) {
        rows.push({ kind: "info", text: "Binary file not shown" });
        top += ROW_H.info;
        continue;
      }
      if (file.too_large) {
        rows.push({ kind: "info", text: "File too large to display" });
        top += ROW_H.info;
        continue;
      }
      const newText = file.new_text;
      const newLines = newText != null ? newText.split("\n") : null;
      if (newLines && newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
      const gaps = newLines ? fileGaps(file.hunks, newLines.length) : [];
      const gapByIndex = new Map(gaps.map((g) => [g.beforeHunkIndex, g]));

      const emitGap = (idx: number) => {
        const g = gapByIndex.get(idx);
        if (!g || !newLines) return;
        const key = `${file.path}#${idx}`;
        const r = revealGap(g, expanded.get(key) ?? { top: 0, bottom: 0 }, newLines);
        for (const rl of r.topLines) {
          rows.push({ kind: "line", lineKind: "context", oldNo: rl.oldNo, newNo: rl.newNo, text: rl.text, langId, newText, oldText: file.old_text });
          top += ROW_H.line;
        }
        if (r.remaining > 0) {
          rows.push({ kind: "expander", gapKey: key, canUp: r.canUp, canDown: r.canDown, remaining: r.remaining });
          top += ROW_H.expander;
        }
        for (const rl of r.bottomLines) {
          rows.push({ kind: "line", lineKind: "context", oldNo: rl.oldNo, newNo: rl.newNo, text: rl.text, langId, newText, oldText: file.old_text });
          top += ROW_H.line;
        }
      };

      for (let hi = 0; hi < file.hunks.length; hi++) {
        emitGap(hi);
        const h = file.hunks[hi];
        rows.push({ kind: "hunk", header: h.header });
        top += ROW_H.hunk;
        for (const l of h.lines) {
          rows.push({ kind: "line", lineKind: l.kind, oldNo: l.old_no, newNo: l.new_no, text: l.text, langId, newText: file.new_text, oldText: file.old_text });
          top += ROW_H.line;
        }
      }
      emitGap(file.hunks.length);
    }
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => ROW_H[rows[i].kind],
    overscan: 16,
  });

  const activePath = activeFileForOffset(fileOffsets, virtualizer.scrollOffset ?? 0);
  function jumpTo(path: string) {
    const idx = pathToRowIndex.get(path);
    if (idx != null) virtualizer.scrollToIndex(idx, { align: "start" });
  }

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
  } else if (changes) {
    body = (
      <div className="flex flex-1 min-h-0">
        <DiffFileList files={changes.files} activePath={activePath} onSelect={jumpTo} />
        <div ref={scrollRef} data-testid="diff-scroll" className="zk-scroll flex-1 overflow-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = rows[vItem.index];
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vItem.size, transform: `translateY(${vItem.start}px)` }}
                >
                  {renderRow(row, toggle, expand)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  } else {
    body = <Centered>Loading changes…</Centered>;
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

function DiffFileList({
  files,
  activePath,
  onSelect,
}: {
  files: FileDiff[];
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div data-testid="diff-file-list" className="zk-scroll shrink-0 w-56 overflow-auto border-r border-bd-2 py-1">
      {files.map((f) => (
        <div
          key={f.path}
          onClick={() => onSelect(f.path)}
          className={`flex items-center gap-2 h-7 px-2.5 cursor-pointer text-[12px] ${
            f.path === activePath ? "bg-white/10 text-tx-bright" : "text-tx-2 hover:bg-white/5"
          }`}
        >
          <span className="w-3.5 text-center text-[10.5px] text-tx-3 shrink-0">{STATUS_BADGE[f.status]}</span>
          <span className="flex-1 truncate">{f.path}</span>
          {f.additions > 0 && <span className="text-[10.5px] text-emerald-400 shrink-0">+{f.additions}</span>}
          {f.deletions > 0 && <span className="text-[10.5px] text-red-400 shrink-0">−{f.deletions}</span>}
        </div>
      ))}
    </div>
  );
}

function renderRow(row: Row, toggle: (path: string) => void, expand: (gapKey: string, dir: "up" | "down") => void) {
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
  if (row.kind === "expander") {
    return (
      <div className="h-[22px] flex items-center gap-2 px-3 font-mono text-[11px] text-tx-3 bg-bg-2">
        {row.canDown && (
          <button
            aria-label="Expand down"
            onClick={() => expand(row.gapKey, "down")}
            className="px-1.5 rounded text-tx-2 hover:bg-white/10 hover:text-tx-bright"
          >
            ↓
          </button>
        )}
        {row.canUp && (
          <button
            aria-label="Expand up"
            onClick={() => expand(row.gapKey, "up")}
            className="px-1.5 rounded text-tx-2 hover:bg-white/10 hover:text-tx-bright"
          >
            ↑
          </button>
        )}
        <span>{row.remaining} hidden lines</span>
      </div>
    );
  }
  const bg = row.lineKind === "add" ? "bg-emerald-500/10" : row.lineKind === "del" ? "bg-red-500/10" : "";
  const marker = row.lineKind === "add" ? "+" : row.lineKind === "del" ? "−" : " ";
  const sideText = row.lineKind === "del" ? row.oldText : row.newText;
  const lineNo = row.lineKind === "del" ? row.oldNo : row.newNo;
  let content: React.ReactNode = row.text;
  if (sideText != null && lineNo != null) {
    const segs = getHighlightedLines(sideText, row.langId)[lineNo - 1];
    if (segs && segs.map((s) => s.text).join("") === row.text) {
      content = segs.map((s, i) => (
        <span key={i} className={s.className}>{s.text}</span>
      ));
    }
  }
  return (
    <div className={`h-5 flex items-stretch font-mono text-[12px] ${bg}`}>
      <span className="w-10 shrink-0 text-right pr-2 text-tx-faint select-none">{row.oldNo ?? ""}</span>
      <span className="w-10 shrink-0 text-right pr-2 text-tx-faint select-none">{row.newNo ?? ""}</span>
      <span className="w-4 shrink-0 text-center text-tx-3 select-none">{marker}</span>
      <span className="whitespace-pre flex-1 pr-3 text-tx-1">{content}</span>
    </div>
  );
}
