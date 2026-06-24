import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileDiff } from "../api/types";
import { useGitStore } from "../store/gitStore";
import { activeFileForOffset, type FileOffset } from "../lib/diffNav";
import { getHighlightedLines, clearHighlightCache } from "../lib/diffHighlight";
import { languageIdForFile } from "../lib/language";
import { fileGaps, revealGap } from "../lib/diffExpand";
import { mergeFiles, type MergedFile } from "../lib/mergeFiles";

interface Props {
  root: string | null;
  active: boolean;
}

type Row =
  | { kind: "file"; path: string; oldPath: string | null; status: FileDiff["status"]; additions: number; deletions: number }
  | { kind: "section"; label: "Staged" | "Unstaged" }
  | { kind: "line"; lineKind: "context" | "add" | "del"; oldNo: number | null; newNo: number | null; text: string; langId: string; newText: string | null; oldText: string | null }
  | { kind: "info"; text: string }
  | { kind: "expander"; gapKey: string; canUp: boolean; canDown: boolean; remaining: number };

const ROW_H: Record<Row["kind"], number> = { file: 34, section: 24, line: 20, info: 28, expander: 22 };
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

  const merged = changes ? mergeFiles(changes.staged, changes.unstaged) : [];
  const rows: Row[] = [];
  const pathToRowIndex = new Map<string, number>();
  const fileOffsets: FileOffset[] = [];
  let top = 0;

  // Emit one FileDiff's body (binary/too_large notice or hunks + gap expanders).
  // `tag` ("s"|"u") namespaces the gapKey so a partially-staged file's two
  // streams expand independently.
  const emitBody = (fd: FileDiff, tag: "s" | "u", path: string) => {
    const langId = languageIdForFile(path);
    if (fd.binary) {
      rows.push({ kind: "info", text: "Binary file not shown" });
      top += ROW_H.info;
      return;
    }
    if (fd.too_large) {
      rows.push({ kind: "info", text: "File too large to display" });
      top += ROW_H.info;
      return;
    }
    const newText = fd.new_text;
    const newLines = newText != null ? newText.split("\n") : null;
    if (newLines && newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
    const gaps = newLines ? fileGaps(fd.hunks, newLines.length) : [];
    const gapByIndex = new Map(gaps.map((g) => [g.beforeHunkIndex, g]));

    const emitGap = (idx: number) => {
      const g = gapByIndex.get(idx);
      if (!g || !newLines) return;
      const key = `${path}#${tag}#${idx}`;
      const r = revealGap(g, expanded.get(key) ?? { top: 0, bottom: 0 }, newLines);
      for (const rl of r.topLines) {
        rows.push({ kind: "line", lineKind: "context", oldNo: rl.oldNo, newNo: rl.newNo, text: rl.text, langId, newText, oldText: fd.old_text });
        top += ROW_H.line;
      }
      if (r.remaining > 0) {
        rows.push({ kind: "expander", gapKey: key, canUp: r.canUp, canDown: r.canDown, remaining: r.remaining });
        top += ROW_H.expander;
      }
      for (const rl of r.bottomLines) {
        rows.push({ kind: "line", lineKind: "context", oldNo: rl.oldNo, newNo: rl.newNo, text: rl.text, langId, newText, oldText: fd.old_text });
        top += ROW_H.line;
      }
    };

    for (let hi = 0; hi < fd.hunks.length; hi++) {
      emitGap(hi);
      const h = fd.hunks[hi];
      for (const l of h.lines) {
        rows.push({ kind: "line", lineKind: l.kind, oldNo: l.old_no, newNo: l.new_no, text: l.text, langId, newText: fd.new_text, oldText: fd.old_text });
        top += ROW_H.line;
      }
    }
    emitGap(fd.hunks.length);
  };

  for (const mf of merged) {
    pathToRowIndex.set(mf.path, rows.length);
    fileOffsets.push({ path: mf.path, top });
    const additions = (mf.staged?.additions ?? 0) + (mf.unstaged?.additions ?? 0);
    const deletions = (mf.staged?.deletions ?? 0) + (mf.unstaged?.deletions ?? 0);
    const oldPath = mf.staged?.old_path ?? mf.unstaged?.old_path ?? null;
    rows.push({ kind: "file", path: mf.path, oldPath, status: mf.status, additions, deletions });
    top += ROW_H.file;
    if (collapsed.has(mf.path)) continue;
    if (mf.staged) {
      rows.push({ kind: "section", label: "Staged" });
      top += ROW_H.section;
      emitBody(mf.staged, "s", mf.path);
    }
    if (mf.unstaged) {
      rows.push({ kind: "section", label: "Unstaged" });
      top += ROW_H.section;
      emitBody(mf.unstaged, "u", mf.path);
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
      <span className="text-tx-3">{changes ? `${merged.length} changed` : ""}</span>
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
  } else if (changes && merged.length === 0) {
    body = <Centered>No changes</Centered>;
  } else if (changes) {
    body = (
      <div className="flex flex-1 min-h-0">
        <DiffFileList files={merged} activePath={activePath} onSelect={jumpTo} />
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
  files: MergedFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div data-testid="diff-file-list" className="zk-scroll shrink-0 w-56 overflow-auto border-r border-bd-2 py-1">
      {files.map((f) => {
        const additions = (f.staged?.additions ?? 0) + (f.unstaged?.additions ?? 0);
        const deletions = (f.staged?.deletions ?? 0) + (f.unstaged?.deletions ?? 0);
        return (
          <div
            key={f.path}
            onClick={() => onSelect(f.path)}
            className={`flex items-center gap-2 h-7 px-2.5 cursor-pointer text-[12px] ${
              f.path === activePath ? "bg-white/10 text-tx-bright" : "text-tx-2 hover:bg-white/5"
            }`}
          >
            <span className="w-3.5 text-center text-[10.5px] text-tx-3 shrink-0">{STATUS_BADGE[f.status]}</span>
            <span className="flex-1 truncate">{f.path}</span>
            {f.staged && <span data-testid="badge-staged" title="Staged" className="text-[10px] font-medium text-emerald-400 shrink-0">S</span>}
            {/* Untracked files are inherently unstaged and already show a "U" status badge,
                so the stream badge would just duplicate the glyph. */}
            {f.unstaged && f.status !== "untracked" && <span data-testid="badge-unstaged" title="Unstaged" className="text-[10px] font-medium text-amber-400 shrink-0">U</span>}
            {additions > 0 && <span className="text-[10.5px] text-emerald-400 shrink-0">+{additions}</span>}
            {deletions > 0 && <span className="text-[10.5px] text-red-400 shrink-0">−{deletions}</span>}
          </div>
        );
      })}
    </div>
  );
}

function renderRow(row: Row, toggle: (path: string) => void, expand: (gapKey: string, dir: "up" | "down") => void) {
  if (row.kind === "file") {
    const label = row.oldPath ? `${row.oldPath} → ${row.path}` : row.path;
    return (
      <div
        className="flex items-center gap-2 h-[34px] px-3 bg-bg-1 border-b border-bd-2 cursor-pointer hover:bg-bg-3"
        onClick={() => toggle(row.path)}
      >
        <span className="w-4 text-center text-[11px] text-tx-2">{STATUS_BADGE[row.status]}</span>
        <span className="flex-1 truncate text-[12.5px] text-tx-1">{label}</span>
        {row.additions > 0 && <span className="text-[11.5px] text-emerald-400">+{row.additions}</span>}
        {row.deletions > 0 && <span className="text-[11.5px] text-red-400">−{row.deletions}</span>}
      </div>
    );
  }
  if (row.kind === "section") {
    return (
      <div className="h-6 flex items-center px-3 text-[11px] font-medium uppercase tracking-wide text-tx-3 bg-bg-2 border-b border-bd-2">
        {row.label}
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
