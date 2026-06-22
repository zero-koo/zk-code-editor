import { type KeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { searchWorkspace } from "../api/fs";
import type { FileMatches, LineMatch, SearchResponse } from "../api/types";
import { splitHighlights } from "../lib/highlight";
import { SectionLabel } from "./SectionLabel";
import { SidebarPanel } from "./SidebarPanel";

interface Props {
  onOpenMatch: (path: string, line: number, matchStart: number, matchEnd: number) => void;
  /** Whether this panel is the active sidebar view. */
  active?: boolean;
}

interface FlatMatch {
  path: string;
  line: number;
  matchStart: number;
  matchEnd: number;
}

// A single virtualized row: either a file header or one match line.
type Row =
  | { kind: "header"; file: FileMatches }
  | { kind: "match"; file: FileMatches; match: LineMatch; flatIndex: number };

const HEADER_H = 26;
const MATCH_H = 24;

export const SearchPanel = memo(function SearchPanel({ onOpenMatch, active = false }: Props) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (query.trim() === "") {
      setResponse(null);
      setSelectedIndex(-1);
      return;
    }
    const seq = ++seqRef.current;
    const handle = setTimeout(async () => {
      const result = await searchWorkspace(query, { case_sensitive: caseSensitive, regex });
      if (seq === seqRef.current) {
        setResponse(result); // drop stale responses
        setSelectedIndex(-1); // reset selection for the new result set
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, caseSensitive, regex]);

  function toggleCollapse(path: string) {
    setSelectedIndex(-1); // the flat list changes when a group folds
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  // Flatten the grouped results into one row list for virtualization. `flat` is
  // the navigable subset (match rows only); `flatToRow` maps a flat index back
  // to its row index so keyboard navigation can scroll it into view.
  const rows: Row[] = [];
  const flat: FlatMatch[] = [];
  const flatToRow: number[] = [];
  if (response) {
    for (const file of response.files) {
      rows.push({ kind: "header", file });
      if (collapsed.has(file.path)) continue;
      for (const m of file.matches) {
        const flatIndex = flat.length;
        flat.push({ path: file.path, line: m.line_number, matchStart: m.match_start, matchEnd: m.match_end });
        flatToRow.push(rows.length);
        rows.push({ kind: "match", file, match: m, flatIndex });
      }
    }
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].kind === "header" ? HEADER_H : MATCH_H),
    overscan: 12,
  });

  // Keep the selected match visible as it moves.
  useEffect(() => {
    if (selectedIndex < 0) return;
    const rowIdx = flatToRow[selectedIndex];
    if (rowIdx != null) virtualizer.scrollToIndex(rowIdx, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);

  function openMatchAt(i: number) {
    const m = flat[i];
    if (m) onOpenMatch(m.path, m.line, m.matchStart, m.matchEnd);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return; // don't hijack keys mid-IME-composition
    if (flat.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        e.key === "ArrowDown"
          ? Math.min(selectedIndex + 1, flat.length - 1)
          : Math.max(selectedIndex - 1, 0);
      if (next === selectedIndex) return; // already at the edge
      setSelectedIndex(next);
      openMatchAt(next); // arrow navigation also jumps to the file + line
    } else if (e.key === "Enter") {
      if (selectedIndex < 0 || selectedIndex >= flat.length) return;
      e.preventDefault();
      openMatchAt(selectedIndex);
    }
  }

  return (
    <SidebarPanel>
      <div className="px-3 pt-3 pb-2">
        <div className="mb-2.5"><SectionLabel>Search</SectionLabel></div>
        <div className="flex items-center gap-1.5 bg-bg-0 border border-bd-hover rounded-md px-2 py-1.5">
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-tx-1 font-mono placeholder:text-tx-3"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            aria-label="Match case"
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive((v) => !v)}
            className={`w-[22px] h-[22px] rounded-[5px] text-[11px] font-semibold ${caseSensitive ? "bg-accent/25 text-white" : "text-tx-2 bg-white/5"}`}
          >
            Aa
          </button>
          <button
            aria-label="Use regular expression"
            aria-pressed={regex}
            onClick={() => setRegex((v) => !v)}
            className={`w-[22px] h-[22px] rounded-[5px] text-[12px] ${regex ? "bg-accent/25 text-white" : "text-tx-2 bg-white/5"}`}
          >
            .*
          </button>
        </div>
        {response?.regex_error && (
          <div className="mt-2 text-[11.5px] text-danger">{response.regex_error}</div>
        )}
        {response && !response.regex_error && (
          <div className="mt-2 text-[11.5px] text-tx-3">
            {response.total_matches} results in {response.files.length} files
            {response.truncated && " · showing first results"}
          </div>
        )}
      </div>

      <div ref={scrollRef} className="zk-scroll flex-1 overflow-auto px-1.5 pb-2.5 text-[13px]">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const row = rows[vItem.index];
            const selected = row.kind === "match" && row.flatIndex === selectedIndex;
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                aria-selected={row.kind === "match" ? selected : undefined}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vItem.size,
                  transform: `translateY(${vItem.start}px)`,
                }}
              >
                {row.kind === "header" ? (
                  <div
                    className="flex items-center gap-1.5 h-[26px] px-1.5 rounded-md cursor-pointer text-tx-bright hover:bg-white/5"
                    onClick={() => toggleCollapse(row.file.path)}
                  >
                    <span className="flex-1 truncate text-tx-1">{row.file.rel_path}</span>
                    <span className="text-[10.5px] text-tx-2 bg-white/[0.06] rounded-full px-1.5">{row.file.matches.length}</span>
                  </div>
                ) : (
                  <div
                    className={`flex items-center gap-2.5 h-6 pl-6 pr-1.5 rounded-md cursor-pointer font-mono text-[12px] ${
                      selected ? "bg-white/10 text-tx-bright" : "text-tx-2 hover:bg-white/[0.04]"
                    }`}
                    // Keep keyboard focus in the search input on click so arrow
                    // navigation continues; clicking also sets the selection.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedIndex(row.flatIndex);
                      onOpenMatch(row.file.path, row.match.line_number, row.match.match_start, row.match.match_end);
                    }}
                  >
                    <span className="text-tx-faint min-w-[22px] text-right">{row.match.line_number}</span>
                    <span className="truncate whitespace-pre">
                      {splitHighlights(row.match.preview, row.match.highlight_ranges).map((seg, j) =>
                        seg.hl ? (
                          <span key={j} className="bg-accent/30 text-white rounded-[2px]">{seg.text}</span>
                        ) : (
                          <span key={j}>{seg.text}</span>
                        )
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </SidebarPanel>
  );
});
