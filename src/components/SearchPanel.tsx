import { useEffect, useRef, useState } from "react";
import { searchWorkspace } from "../api/fs";
import type { SearchResponse } from "../api/types";
import { splitHighlights } from "../lib/highlight";
import { SectionLabel } from "./SectionLabel";
import { SidebarPanel } from "./SidebarPanel";

interface Props {
  onOpenMatch: (path: string, line: number, matchStart: number, matchEnd: number) => void;
  /** Whether this panel is the active sidebar view. */
  active?: boolean;
}

export function SearchPanel({ onOpenMatch, active = false }: Props) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search input whenever the panel becomes the active view. The
  // panel stays mounted across view switches, so this runs on entry each time.
  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (query.trim() === "") {
      setResponse(null);
      return;
    }
    const seq = ++seqRef.current;
    const handle = setTimeout(async () => {
      const result = await searchWorkspace(query, { case_sensitive: caseSensitive, regex });
      if (seq === seqRef.current) setResponse(result); // drop stale responses
    }, 200);
    return () => clearTimeout(handle);
  }, [query, caseSensitive, regex]);

  function toggleCollapse(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
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

      <div className="zk-scroll flex-1 overflow-auto px-1.5 pb-2.5 text-[13px]">
        {response?.files.map((file) => {
          const isCollapsed = collapsed.has(file.path);
          return (
            <div key={file.path}>
              <div
                className="flex items-center gap-1.5 h-[26px] px-1.5 rounded-md cursor-pointer text-tx-bright hover:bg-white/5"
                onClick={() => toggleCollapse(file.path)}
              >
                <span className="flex-1 truncate text-tx-1">{file.rel_path}</span>
                <span className="text-[10.5px] text-tx-2 bg-white/[0.06] rounded-full px-1.5">{file.matches.length}</span>
              </div>
              {!isCollapsed &&
                file.matches.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 h-6 pl-6 pr-1.5 rounded-md cursor-pointer text-tx-2 hover:bg-white/[0.04] font-mono text-[12px]"
                    onClick={() => onOpenMatch(file.path, m.line_number, m.match_start, m.match_end)}
                  >
                    <span className="text-tx-faint min-w-[22px] text-right">{m.line_number}</span>
                    <span className="truncate whitespace-pre">
                      {splitHighlights(m.preview, m.highlight_ranges).map((seg, j) =>
                        seg.hl ? (
                          <span key={j} className="bg-accent/30 text-white rounded-[2px]">{seg.text}</span>
                        ) : (
                          <span key={j}>{seg.text}</span>
                        )
                      )}
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </SidebarPanel>
  );
}
