# Search Results Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Navigate search-result matches with ↑/↓ and open the selected one with Enter, all from the search input.

**Architecture:** Entirely local to `SearchPanel`. A `selectedIndex` indexes a flat list of matches from non-collapsed files (built in render with the same iteration order). The input's `onKeyDown` moves the index (Arrows) or opens the match (Enter), guarded against IME composition and out-of-range. The selected row gets a highlight + `aria-selected` + `scrollIntoView`. `selectedIndex` resets to −1 on every new response and on collapse toggle. No App/API changes.

**Tech Stack:** React 19 + TypeScript + Tailwind, Vitest + Testing Library (jsdom).

---

## Conventions
- Paths relative to project root `/Users/zerokoo/Projects/zerokoo/zk-code-editor`.
- Single test: `npx vitest run <path>`; full: `npm run test`. Build: `npm run build`.
- Commit after the task. Conventional Commits. **No `Co-Authored-By`.** Body bullets `- `.
- TDD. After the task: full suite + build green.

## File Structure
- `src/components/SearchPanel.tsx` (modify) — selectedIndex state, flat list, key handler, selected-row highlight/ref/scroll, resets.
- `src/components/SearchPanel.test.tsx` (modify) — keyboard-nav tests.

---

## Task 1: Keyboard navigation in SearchPanel

**Files:** Modify `src/components/SearchPanel.tsx`, `src/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing tests** — add to `src/components/SearchPanel.test.tsx`. Add this 2-match fixture near the top (after the existing `resp` helper):
```tsx
const navResp = {
  files: [
    {
      path: "/proj/a.ts",
      rel_path: "a.ts",
      matches: [
        { line_number: 1, preview: "one", highlight_ranges: [[0, 3]] as [number, number][], match_start: 0, match_end: 3 },
        { line_number: 2, preview: "two", highlight_ranges: [[0, 3]] as [number, number][], match_start: 0, match_end: 3 },
      ],
    },
  ],
  total_matches: 2,
  truncated: false,
  regex_error: null,
};
```
Then add the tests:
```tsx
  it("selects the first match on ArrowDown and opens it with Enter", async () => {
    searchWorkspace.mockResolvedValue(navResp);
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await screen.findByText("one");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    expect(onOpenMatch).toHaveBeenCalledWith("/proj/a.ts", 1, 0, 3);
  });

  it("moves the selection down then up", async () => {
    searchWorkspace.mockResolvedValue(navResp);
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await screen.findByText("two");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}"); // 0 → 1 → 0
    await userEvent.keyboard("{Enter}");
    expect(onOpenMatch).toHaveBeenCalledWith("/proj/a.ts", 1, 0, 3);
  });

  it("marks the selected match with aria-selected", async () => {
    searchWorkspace.mockResolvedValue(navResp);
    render(<SearchPanel onOpenMatch={() => {}} active />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await screen.findByText("one");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.querySelector('[aria-selected="true"]')?.textContent).toContain("one");
  });

  it("does nothing on arrows/Enter when there are no results", async () => {
    searchWorkspace.mockResolvedValue({ files: [], total_matches: 0, truncated: false, regex_error: null });
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} active />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await screen.findByText(/0 results/);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onOpenMatch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/SearchPanel.test.tsx`
Expected: the 4 new tests FAIL (no selection / Enter does nothing), existing tests pass.

- [ ] **Step 3: Implement** — replace `src/components/SearchPanel.tsx` with:
```tsx
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
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

interface FlatMatch {
  path: string;
  line: number;
  matchStart: number;
  matchEnd: number;
}

export function SearchPanel({ onOpenMatch, active = false }: Props) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

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

  // Keep the selected row visible.
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  function toggleCollapse(path: string) {
    setSelectedIndex(-1); // the flat list changes when a group folds
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  // Flat list of navigable matches — non-collapsed files, in display order.
  const flat: FlatMatch[] = [];
  if (response) {
    for (const file of response.files) {
      if (collapsed.has(file.path)) continue;
      for (const m of file.matches) {
        flat.push({ path: file.path, line: m.line_number, matchStart: m.match_start, matchEnd: m.match_end });
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return; // don't hijack keys mid-IME-composition
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (selectedIndex < 0 || selectedIndex >= flat.length) return;
      e.preventDefault();
      const m = flat[selectedIndex];
      onOpenMatch(m.path, m.line, m.matchStart, m.matchEnd);
    }
  }

  // Running index that mirrors `flat` construction (same files, same skip).
  let renderIndex = -1;

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
                file.matches.map((m, i) => {
                  const idx = ++renderIndex; // aligns with `flat` (same order/skip)
                  const selected = idx === selectedIndex;
                  return (
                    <div
                      key={i}
                      ref={selected ? selectedRef : undefined}
                      aria-selected={selected}
                      className={`flex items-center gap-2.5 h-6 pl-6 pr-1.5 rounded-md cursor-pointer font-mono text-[12px] ${
                        selected ? "bg-white/10 text-tx-bright" : "text-tx-2 hover:bg-white/[0.04]"
                      }`}
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
                  );
                })}
            </div>
          );
        })}
      </div>
    </SidebarPanel>
  );
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/components/SearchPanel.test.tsx`
Expected: all pass (4 new + existing).

- [ ] **Step 5: Run the full suite + build**

Run: `npm run test` then `npm run build`
Expected: all tests pass; build clean.

- [ ] **Step 6: Manual check (deferred to user — native, incl. IME)**

`source "$HOME/.cargo/env" && npm run tauri dev` → open a folder, search, press ↓/↑ to move the highlighted match (it scrolls into view), Enter opens it. **Korean/IME:** type a Hangul query and press Enter mid-composition — it must commit the syllable (NOT open a match); a second Enter (composition finished) opens the selected match.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat(frontend): keyboard navigation for search results"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §1/§2.2 ↑/↓ over flat list, Enter opens — `onKeyDown`. ✓
- §2.1 flat list = non-collapsed files, `path = file.path`, line/start/end mapping — `flat` build. ✓
- §2.2 reset on both `setResponse` paths (result + empty), Enter bounds guard, IME guard — implemented. ✓
- §2.3 single flat-index source (running `renderIndex` mirroring `flat`), highlight + `aria-selected` + `scrollIntoView?.()` — implemented. ✓
- §4 empty → no-op (`flat.length===0` early return + Enter guard); collapse resets selection (`toggleCollapse`). ✓
- §5 tests (down+Enter, down/up, aria-selected, empty no-op) + IME manual note. ✓
- §6 non-goals — nothing beyond scope. ✓

**Placeholder scan:** No TBD/TODO; full file + full tests provided.

**Type consistency:** `FlatMatch {path, line, matchStart, matchEnd}` consumed by `onOpenMatch(path, line, matchStart, matchEnd)` (matches existing signature). `m.line_number/match_start/match_end` field names match `LineMatch` (api/types.ts). `KeyboardEvent<HTMLInputElement>` imported from react.

**Known minor notes (non-blocking):**
- `renderIndex` is mutated during render; it resets each render and increments only in the same `!isCollapsed` branch that builds `flat`, so the row index and `flat` index stay in lockstep. Deterministic, no React issue.
- IME composition can't be faithfully simulated in jsdom — the `isComposing` guard is covered by manual verification (Step 6), not an automated test.
- Selecting then opening (Enter) moves focus to the editor (existing reveal behavior); returning to keyboard nav requires re-focusing search — out of scope per spec.
