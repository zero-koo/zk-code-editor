# Global Search (Find in Files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-wide find-in-files: a search panel that lists matches grouped by file and jumps to the selected match in the editor.

**Architecture:** A Rust `search_workspace` command walks the opened workspace with ripgrep's libraries (`ignore` + `grep-searcher` + `grep-regex`), respecting `.gitignore`/binary/size limits, and returns file-grouped matches with UTF-16 highlight offsets. The React frontend adds a `SearchPanel` (swapped into the sidebar via a store `activeView`), debounced + stale-guarded, and an `EditorPane` reveal effect that selects + scrolls to a clicked match.

**Tech Stack:** Rust (`ignore`, `grep-searcher`, `grep-regex`, `grep-matcher`, `regex`), Tauri v2, React 18 + TS + Tailwind + Zustand, CodeMirror 6, Vitest.

---

## Conventions
- Paths relative to project root `/Users/zerokoo/Projects/zerokoo/zk-code-editor`.
- Rust: run from `src-tauri/` with cargo NOT on PATH by default — prefix every cargo command with `. "$HOME/.cargo/env" &&`.
- Frontend single test: `npx vitest run <path>`; full: `npm run test`.
- Commit after every task. Conventional Commits. **No `Co-Authored-By` line.** Body bullets use `- `.
- TDD throughout.

## File Structure
**Rust (`src-tauri/src/`):**
- `search.rs` (new) — `search_workspace` command + `search_impl`, matcher building, line/offset helpers, types, all unit tests.
- `fs_ops.rs` (modify) — make `MAX_TEXT_BYTES` `pub` so search reuses the same size cap.
- `lib.rs` (modify) — `mod search;` + register command.
- `Cargo.toml` (modify) — add deps.

**Frontend (`src/`):**
- `api/types.ts` (modify) — search types.
- `api/fs.ts` (modify) — `searchWorkspace` wrapper.
- `store/workspaceStore.ts` (modify) — `activeView` + `setActiveView`.
- `lib/highlight.ts` (new) — `splitHighlights` preview-splitting helper.
- `components/SearchPanel.tsx` (new) — the panel.
- `components/SearchPanel.test.tsx`, `lib/highlight.test.ts` (new) — tests.
- `components/EditorPane.tsx` (modify) — `reveal` prop + effect.
- `components/ActivityBar.tsx` (modify) — Explorer/Search buttons + toggle rule.
- `App.tsx` (modify) — `activeView` sidebar swap, `openAt` flow, `reveal` state.

---

## Task 1: Add Rust dependencies + empty search module

**Files:** Modify `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`; Create `src-tauri/src/search.rs`

- [ ] **Step 1: Add deps to `src-tauri/Cargo.toml`** under `[dependencies]`:
```toml
ignore = "0.4"
grep-searcher = "0.1"
grep-regex = "0.1"
grep-matcher = "0.1"
regex = "1"
```

- [ ] **Step 2: Create `src-tauri/src/search.rs`** with a placeholder that compiles:
```rust
// Workspace-wide find-in-files. Walks with `ignore`, matches with ripgrep libs.
```

- [ ] **Step 3: Register the module** — add to `src-tauri/src/lib.rs` near the other `mod` lines:
```rust
mod search;
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo build`
Expected: compiles (new deps download on first build; may take a few minutes). Dead-code warning for the empty module is fine.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "chore(backend): add ripgrep search deps and empty search module"
```

---

## Task 2: Search types + matcher builder

**Files:** Modify `src-tauri/src/search.rs`

- [ ] **Step 1: Write the failing test** — append to `search.rs`:
```rust
use crate::error::{AppError, ErrorCode};
use grep_regex::RegexMatcher;
use grep_regex::RegexMatcherBuilder;
use serde::Serialize;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub regex: bool,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct LineMatch {
    pub line_number: u32,
    pub preview: String,
    pub highlight_ranges: Vec<[u32; 2]>,
    pub match_start: u32,
    pub match_end: u32,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FileMatches {
    pub path: String,
    pub rel_path: String,
    pub matches: Vec<LineMatch>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SearchResponse {
    pub files: Vec<FileMatches>,
    pub total_matches: usize,
    pub truncated: bool,
    pub regex_error: Option<String>,
}

/// Builds the regex pattern string from the query + options.
/// Literal queries are escaped; regex queries are used verbatim.
fn build_pattern(query: &str, opts: &SearchOptions) -> String {
    if opts.regex {
        query.to_string()
    } else {
        regex::escape(query)
    }
}

/// Builds a ripgrep matcher, or returns the regex error message on failure.
fn build_matcher(query: &str, opts: &SearchOptions) -> Result<RegexMatcher, String> {
    let pattern = build_pattern(query, opts);
    RegexMatcherBuilder::new()
        .case_insensitive(!opts.case_sensitive)
        .build(&pattern)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_literal_queries() {
        let p = build_pattern("a.b(c)", &SearchOptions { case_sensitive: true, regex: false });
        assert_eq!(p, regex::escape("a.b(c)"));
        assert!(p.contains("\\."));
    }

    #[test]
    fn regex_query_is_verbatim() {
        let p = build_pattern("a.+b", &SearchOptions { case_sensitive: true, regex: true });
        assert_eq!(p, "a.+b");
    }

    #[test]
    fn invalid_regex_returns_error() {
        let err = build_matcher("(", &SearchOptions { case_sensitive: true, regex: true });
        assert!(err.is_err());
    }

    #[test]
    fn valid_matcher_builds() {
        assert!(build_matcher("foo", &SearchOptions { case_sensitive: false, regex: false }).is_ok());
    }
}
```
(`AppError`/`ErrorCode` imports are used in later tasks; if the compiler warns they're unused now, that's fine.)

- [ ] **Step 2: Run the tests**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test search::tests`
Expected: 4 pass.

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(backend): add search types and matcher builder"
```

---

## Task 3: Line offset helpers (byte → UTF-16, preview, ranges)

**Files:** Modify `src-tauri/src/search.rs`

This is the highest-risk correctness area. Pure functions, heavily tested.

- [ ] **Step 1: Write the failing test** — add the helpers ABOVE the `#[cfg(test)]` module:
```rust
const PREVIEW_MAX_UTF16: usize = 400;
const MAX_RANGES_PER_LINE: usize = 100;

/// UTF-16 code-unit offset of a byte offset within `line` (byte offset must be on a char boundary).
fn byte_to_utf16(line: &str, byte_off: usize) -> u32 {
    let mut units = 0u32;
    for (i, ch) in line.char_indices() {
        if i >= byte_off {
            break;
        }
        units += ch.len_utf16() as u32;
    }
    units
}

/// Truncates `line` to a preview by char boundary, capped at PREVIEW_MAX_UTF16 code units.
/// Returns (preview, preview_utf16_len).
fn build_preview(line: &str) -> (String, usize) {
    let mut out = String::new();
    let mut units = 0usize;
    for ch in line.chars() {
        let w = ch.len_utf16();
        if units + w > PREVIEW_MAX_UTF16 {
            break;
        }
        out.push(ch);
        units += w;
    }
    (out, units)
}

/// Builds a LineMatch from a 1-based line number, the (newline-stripped) line text,
/// and the byte ranges of matches within that line.
pub fn process_line(line_number: u32, line: &str, match_byte_ranges: &[(usize, usize)]) -> LineMatch {
    let (preview, preview_u16) = build_preview(line);
    let mut highlight_ranges: Vec<[u32; 2]> = Vec::new();
    for (bs, be) in match_byte_ranges.iter().take(MAX_RANGES_PER_LINE) {
        let s = byte_to_utf16(line, *bs);
        let e = byte_to_utf16(line, *be);
        // preview is a prefix of the line, so line-relative offsets == preview-relative offsets,
        // clipped to the preview length; drop matches starting beyond the preview.
        if (s as usize) < preview_u16 {
            let he = (e as usize).min(preview_u16) as u32;
            if he > s {
                highlight_ranges.push([s, he]);
            }
        }
    }
    let (match_start, match_end) = match_byte_ranges
        .first()
        .map(|(bs, be)| (byte_to_utf16(line, *bs), byte_to_utf16(line, *be)))
        .unwrap_or((0, 0));
    LineMatch { line_number, preview, highlight_ranges, match_start, match_end }
}
```

Add tests inside `mod tests`:
```rust
    #[test]
    fn utf16_offsets_account_for_multibyte() {
        // "héllo" — é is 2 bytes UTF-8 but 1 UTF-16 unit. Match "llo" starts at byte 3.
        let line = "héllo";
        // byte offsets: h=0, é=1..3, l=3, l=4, o=5
        assert_eq!(byte_to_utf16(line, 3), 2); // h + é = 2 UTF-16 units
        assert_eq!(byte_to_utf16(line, 6), 5); // whole string = 5 units
    }

    #[test]
    fn process_line_multibyte_ranges() {
        // match "llo" in "héllo": byte range (3,6) → UTF-16 (2,5)
        let lm = process_line(7, "héllo", &[(3, 6)]);
        assert_eq!(lm.preview, "héllo");
        assert_eq!(lm.match_start, 2);
        assert_eq!(lm.match_end, 5);
        assert_eq!(lm.highlight_ranges, vec![[2, 5]]);
        assert_eq!(lm.line_number, 7);
    }

    #[test]
    fn preview_caps_long_lines() {
        let long = "x".repeat(1000);
        let (preview, units) = build_preview(&long);
        assert_eq!(units, PREVIEW_MAX_UTF16);
        assert_eq!(preview.chars().count(), PREVIEW_MAX_UTF16);
    }

    #[test]
    fn highlight_dropped_when_match_beyond_preview() {
        // match near end of a >cap line is dropped from highlight but match_start still set
        let long = format!("{}MATCH", "x".repeat(500));
        let start = 500;
        let lm = process_line(1, &long, &[(start, start + 5)]);
        assert!(lm.highlight_ranges.is_empty());
        assert_eq!(lm.match_start, 500);
    }
```

- [ ] **Step 2: Run the tests**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test search::tests`
Expected: 8 pass (4 from Task 2 + 4 new).

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(backend): add UTF-16 offset and preview helpers for search"
```

---

## Task 4: Workspace walk + search_impl with caps

**Files:** Modify `src-tauri/src/fs_ops.rs` (make const pub), `src-tauri/src/search.rs`

- [ ] **Step 1: Make the size cap shared** — in `src-tauri/src/fs_ops.rs`, change the existing line
```rust
const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024; // 5 MB
```
to
```rust
pub const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024; // 5 MB
```

- [ ] **Step 2: Write the failing test** — add `search_impl` ABOVE the tests module in `search.rs`:
```rust
use crate::fs_ops::MAX_TEXT_BYTES;
use grep_matcher::Matcher;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use std::path::Path;

const MAX_FILES: usize = 1000;
const MAX_TOTAL_MATCHES: usize = 5000;
const MAX_PER_FILE: usize = 500;

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

/// Core search: walks `root`, returns file-grouped matches. Pure w.r.t. Tauri.
pub fn search_impl(root: &Path, query: &str, opts: &SearchOptions) -> SearchResponse {
    if query.trim().is_empty() {
        return SearchResponse { files: vec![], total_matches: 0, truncated: false, regex_error: None };
    }
    let matcher = match build_matcher(query, opts) {
        Ok(m) => m,
        Err(msg) => {
            return SearchResponse { files: vec![], total_matches: 0, truncated: false, regex_error: Some(msg) }
        }
    };

    let mut files: Vec<FileMatches> = Vec::new();
    let mut total_matches = 0usize;
    let mut truncated = false;

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();

    let walker = WalkBuilder::new(root)
        .sort_by_file_name(|a, b| a.cmp(b))
        .build();

    for result in walker {
        if total_matches >= MAX_TOTAL_MATCHES {
            truncated = true;
            break;
        }
        if files.len() >= MAX_FILES {
            truncated = true;
            break;
        }
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.len() > MAX_TEXT_BYTES {
                continue;
            }
        }
        let path = entry.path();
        let mut line_matches: Vec<LineMatch> = Vec::new();
        let remaining_total = MAX_TOTAL_MATCHES - total_matches;
        let file_cap = MAX_PER_FILE.min(remaining_total);

        let search_result = searcher.search_path(
            &matcher,
            path,
            UTF8(|lnum, line| {
                let trimmed = line.strip_suffix('\n').unwrap_or(line);
                let trimmed = trimmed.strip_suffix('\r').unwrap_or(trimmed);
                let mut byte_ranges: Vec<(usize, usize)> = Vec::new();
                let _ = matcher.find_iter(trimmed.as_bytes(), |m| {
                    byte_ranges.push((m.start(), m.end()));
                    true
                });
                if !byte_ranges.is_empty() {
                    line_matches.push(process_line(lnum as u32, trimmed, &byte_ranges));
                }
                // stop this file once its cap is reached
                Ok(line_matches.len() < file_cap)
            }),
        );
        // a non-UTF8 / unreadable file errors here — just skip it
        if search_result.is_err() {
            continue;
        }
        if line_matches.len() >= file_cap && file_cap == MAX_PER_FILE {
            truncated = true;
        }
        if !line_matches.is_empty() {
            total_matches += line_matches.len();
            files.push(FileMatches {
                path: path.to_string_lossy().into_owned(),
                rel_path: rel_path(root, path),
                matches: line_matches,
            });
        }
    }

    SearchResponse { files, total_matches, truncated, regex_error: None }
}
```

Add tests inside `mod tests`:
```rust
    use std::fs;
    use tempfile::tempdir;

    fn opts(cs: bool, rx: bool) -> SearchOptions {
        SearchOptions { case_sensitive: cs, regex: rx }
    }

    #[test]
    fn finds_matches_grouped_by_file() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "hello world\nbye").unwrap();
        fs::write(tmp.path().join("b.txt"), "no match here").unwrap();
        let resp = search_impl(tmp.path(), "hello", &opts(false, false));
        assert_eq!(resp.files.len(), 1);
        assert_eq!(resp.files[0].matches[0].line_number, 1);
        assert_eq!(resp.total_matches, 1);
        assert!(!resp.truncated);
    }

    #[test]
    fn empty_query_returns_nothing() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "stuff").unwrap();
        let resp = search_impl(tmp.path(), "   ", &opts(false, false));
        assert!(resp.files.is_empty());
    }

    #[test]
    fn respects_gitignore() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(tmp.path().join("ignored.txt"), "secret").unwrap();
        fs::write(tmp.path().join("kept.txt"), "secret").unwrap();
        let resp = search_impl(tmp.path(), "secret", &opts(false, false));
        let names: Vec<&str> = resp.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert!(names.contains(&"kept.txt"));
        assert!(!names.iter().any(|n| n.contains("ignored.txt")));
    }

    #[test]
    fn skips_binary_files() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("bin.dat"), [0u8, b's', b'e', b'c', 0u8]).unwrap();
        fs::write(tmp.path().join("ok.txt"), "sec").unwrap();
        let resp = search_impl(tmp.path(), "sec", &opts(false, false));
        let names: Vec<&str> = resp.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(names, vec!["ok.txt"]);
    }

    #[test]
    fn case_insensitive_by_default() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "Hello").unwrap();
        assert_eq!(search_impl(tmp.path(), "hello", &opts(false, false)).total_matches, 1);
        assert_eq!(search_impl(tmp.path(), "hello", &opts(true, false)).total_matches, 0);
    }

    #[test]
    fn invalid_regex_sets_error() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "x").unwrap();
        let resp = search_impl(tmp.path(), "(", &opts(true, true));
        assert!(resp.regex_error.is_some());
        assert!(resp.files.is_empty());
    }
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test search::tests`
Expected: 14 pass (8 + 6 new). If `meta.len()` borrow/move issues arise, bind `entry.path()` after the metadata check as written.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(backend): implement workspace search walk with caps and ignore rules"
```

---

## Task 5: Async `search_workspace` command + register

**Files:** Modify `src-tauri/src/search.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command** — append to `search.rs` (above tests):
```rust
use crate::workspace::Workspace;
use tauri::State;

#[tauri::command]
pub async fn search_workspace(
    query: String,
    opts: SearchOptions,
    ws: State<'_, Workspace>,
) -> Result<SearchResponse, AppError> {
    let root = ws
        .root()
        .ok_or_else(|| AppError::new(ErrorCode::Io, "no workspace open"))?;
    // Run the blocking filesystem walk off the IPC worker thread.
    tauri::async_runtime::spawn_blocking(move || search_impl(&root, &query, &opts))
        .await
        .map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))
}
```

- [ ] **Step 2: Register in `src-tauri/src/lib.rs`** — add `search::search_workspace` to the `tauri::generate_handler![ ... ]` list (after the fs_ops commands).

- [ ] **Step 3: Verify build + full backend tests**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo build && cargo test`
Expected: compiles; all search tests + existing 19 fs/error tests pass.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(backend): expose async search_workspace command"
```

---

## Task 6: Frontend search types + api wrapper

**Files:** Modify `src/api/types.ts`, `src/api/fs.ts`; Test `src/api/fs.test.ts`

- [ ] **Step 1: Add types** — append to `src/api/types.ts`:
```ts
export interface SearchOptions {
  case_sensitive: boolean;
  regex: boolean;
}

export interface LineMatch {
  line_number: number;
  preview: string;
  highlight_ranges: [number, number][];
  match_start: number;
  match_end: number;
}

export interface FileMatches {
  path: string;
  rel_path: string;
  matches: LineMatch[];
}

export interface SearchResponse {
  files: FileMatches[];
  total_matches: number;
  truncated: boolean;
  regex_error: string | null;
}
```

- [ ] **Step 2: Write the failing test** — add to `src/api/fs.test.ts` (inside the existing `describe`):
```ts
  it("searchWorkspace passes query and opts", async () => {
    invokeMock.mockResolvedValue({ files: [], total_matches: 0, truncated: false, regex_error: null });
    const { searchWorkspace } = await import("./fs");
    await searchWorkspace("foo", { case_sensitive: false, regex: false });
    expect(invokeMock).toHaveBeenCalledWith("search_workspace", {
      query: "foo",
      opts: { case_sensitive: false, regex: false },
    });
  });
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/api/fs.test.ts`
Expected: FAIL — `searchWorkspace` not exported.

- [ ] **Step 4: Implement** — add to `src/api/fs.ts`:
```ts
import type { DirEntry, FileContent, SearchOptions, SearchResponse } from "./types";

export const searchWorkspace = (query: string, opts: SearchOptions) =>
  invoke<SearchResponse>("search_workspace", { query, opts });
```
(Merge the type import with the existing `import type { ... } from "./types";` line rather than duplicating it.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/api/fs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(frontend): add search types and searchWorkspace api"
```

---

## Task 7: Store `activeView`

**Files:** Modify `src/store/workspaceStore.ts`; Test `src/store/workspaceStore.test.ts`

- [ ] **Step 1: Write the failing test** — add to `workspaceStore.test.ts`:
```ts
  it("activeView defaults to explorer and can switch", () => {
    expect(useWorkspaceStore.getState().activeView).toBe("explorer");
    useWorkspaceStore.getState().setActiveView("search");
    expect(useWorkspaceStore.getState().activeView).toBe("search");
  });
```
Also update the `reset()` helper in that file to include `activeView: "explorer"` in its `setState({...})` so other tests start clean.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store/workspaceStore.test.ts`
Expected: FAIL — `activeView`/`setActiveView` undefined.

- [ ] **Step 3: Implement** — in `src/store/workspaceStore.ts`:
- Add to the `WorkspaceState` interface:
```ts
  activeView: "explorer" | "search";
  setActiveView: (view: "explorer" | "search") => void;
```
- Add to the `create(...)` initial object:
```ts
  activeView: "explorer",
  setActiveView: (view) => set({ activeView: view }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/store/workspaceStore.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add activeView state to workspace store"
```

---

## Task 8: EditorPane reveal (select + scroll to match)

**Files:** Modify `src/components/EditorPane.tsx`; Test `src/components/EditorPane.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `EditorPane.test.tsx`:
```ts
  it("reveals a match: selects the range and is clamped to the doc", async () => {
    const { container, rerender } = render(
      <EditorPane
        path="/p/a.ts"
        languageId="typescript"
        initialDoc={"line one\nline two\nline three"}
        onChange={() => {}}
        onSave={() => {}}
      />
    );
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    // reveal line 2, match offsets 5..8 ("two")
    rerender(
      <EditorPane
        path="/p/a.ts"
        languageId="typescript"
        initialDoc={"line one\nline two\nline three"}
        onChange={() => {}}
        onSave={() => {}}
        reveal={{ line: 2, matchStart: 5, matchEnd: 8, seq: 1 }}
      />
    );
    const sel = view.state.selection.main;
    const line2 = view.state.doc.line(2);
    expect(sel.from).toBe(line2.from + 5);
    expect(sel.to).toBe(line2.from + 8);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: FAIL — `reveal` prop unknown / no selection applied.

- [ ] **Step 3: Implement** — in `src/components/EditorPane.tsx`:
- Add to imports from `@codemirror/state`: `EditorSelection` (merge with the existing `EditorState, Compartment` import):
```ts
import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
```
- Add to `Props`:
```ts
  reveal?: { line: number; matchStart: number; matchEnd: number; seq: number };
```
- Destructure `reveal` in the component signature.
- Add a SEPARATE effect (after the existing mount effect), keyed on `reveal?.seq`:
```ts
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal) return;
    const doc = view.state.doc;
    const line = Math.min(Math.max(reveal.line, 1), doc.lines);
    const info = doc.line(line);
    const from = Math.min(info.from + reveal.matchStart, info.to);
    const to = Math.min(info.from + reveal.matchEnd, info.to);
    view.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: all pass (existing 3 + new).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add reveal-match support to EditorPane"
```

---

## Task 9: Highlight split helper

**Files:** Create `src/lib/highlight.ts`, `src/lib/highlight.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/highlight.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { splitHighlights } from "./highlight";

describe("splitHighlights", () => {
  it("splits a preview into highlighted and plain segments", () => {
    expect(splitHighlights("abcde", [[1, 3]])).toEqual([
      { text: "a", hl: false },
      { text: "bc", hl: true },
      { text: "de", hl: false },
    ]);
  });
  it("handles a match at the start and multiple ranges", () => {
    expect(splitHighlights("foobar", [[0, 3], [3, 4]])).toEqual([
      { text: "foo", hl: true },
      { text: "b", hl: true },
      { text: "ar", hl: false },
    ]);
  });
  it("returns the whole string unhighlighted when no ranges", () => {
    expect(splitHighlights("plain", [])).toEqual([{ text: "plain", hl: false }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/highlight.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/lib/highlight.ts`:
```ts
export interface Segment {
  text: string;
  hl: boolean;
}

/**
 * Splits `preview` into highlighted/plain segments using UTF-16 ranges from the
 * backend (assumed sorted, non-overlapping, and clipped to preview length).
 */
export function splitHighlights(preview: string, ranges: [number, number][]): Segment[] {
  const segs: Segment[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) segs.push({ text: preview.slice(pos, s), hl: false });
    segs.push({ text: preview.slice(s, e), hl: true });
    pos = e;
  }
  if (pos < preview.length) segs.push({ text: preview.slice(pos), hl: false });
  if (segs.length === 0) segs.push({ text: preview, hl: false });
  return segs;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/highlight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add highlight split helper"
```

---

## Task 10: SearchPanel component

**Files:** Create `src/components/SearchPanel.tsx`, `src/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/components/SearchPanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPanel } from "./SearchPanel";
import type { SearchResponse } from "../api/types";

const searchWorkspace = vi.fn();
vi.mock("../api/fs", () => ({ searchWorkspace: (...a: unknown[]) => searchWorkspace(...a) }));

const resp = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  files: [
    {
      path: "/proj/src/a.ts",
      rel_path: "src/a.ts",
      matches: [
        { line_number: 3, preview: "const useEffect = 1", highlight_ranges: [[6, 15]], match_start: 6, match_end: 15 },
      ],
    },
  ],
  total_matches: 1,
  truncated: false,
  regex_error: null,
  ...over,
});

describe("SearchPanel", () => {
  beforeEach(() => searchWorkspace.mockReset());

  it("runs a debounced search and renders grouped results", async () => {
    searchWorkspace.mockResolvedValue(resp());
    render(<SearchPanel onOpenMatch={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "useEffect");
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
    expect(await screen.findByText("useEffect")).toBeInTheDocument(); // highlighted segment
    expect(searchWorkspace).toHaveBeenCalled();
  });

  it("calls onOpenMatch with path, line and match offsets when a match is clicked", async () => {
    searchWorkspace.mockResolvedValue(resp());
    const onOpenMatch = vi.fn();
    render(<SearchPanel onOpenMatch={onOpenMatch} />);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "useEffect");
    await userEvent.click(await screen.findByText("useEffect"));
    expect(onOpenMatch).toHaveBeenCalledWith("/proj/src/a.ts", 3, 6, 15);
  });

  it("shows an inline message for an invalid regex", async () => {
    searchWorkspace.mockResolvedValue(resp({ files: [], total_matches: 0, regex_error: "bad pattern" }));
    render(<SearchPanel onOpenMatch={() => {}} />);
    await userEvent.click(screen.getByLabelText(/use regular expression/i));
    await userEvent.type(screen.getByPlaceholderText(/search/i), "(");
    expect(await screen.findByText(/bad pattern/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/SearchPanel.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/components/SearchPanel.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { searchWorkspace } from "../api/fs";
import type { SearchResponse } from "../api/types";
import { splitHighlights } from "../lib/highlight";

interface Props {
  onOpenMatch: (path: string, line: number, matchStart: number, matchEnd: number) => void;
}

export function SearchPanel({ onOpenMatch }: Props) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const seqRef = useRef(0);

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
    <div className="w-[258px] shrink-0 bg-bg-1 border-r border-bd-2 flex flex-col">
      <div className="px-3 pt-3 pb-2">
        <div className="text-[11px] font-semibold tracking-[0.13em] uppercase text-tx-3 mb-2.5">Search</div>
        <div className="flex items-center gap-1.5 bg-bg-0 border border-bd-hover rounded-md px-2 py-1.5">
          <input
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
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/SearchPanel.test.tsx`
Expected: all pass. (The debounced search resolves within `waitFor`/`findBy` defaults; if the case-toggle test races, `findBy` already retries.)

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add SearchPanel with debounced search and grouped results"
```

---

## Task 11: ActivityBar — Explorer/Search toggle

**Files:** Modify `src/components/ActivityBar.tsx`; Test `src/components/ActivityBar.test.tsx`

- [ ] **Step 1: Rewrite the test** — replace `src/components/ActivityBar.test.tsx` with:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityBar } from "./ActivityBar";

describe("ActivityBar", () => {
  it("renders Explorer and Search buttons", () => {
    render(<ActivityBar activeView="explorer" sidebarVisible onActivate={() => {}} />);
    expect(screen.getByRole("button", { name: /explorer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("marks the active view as pressed when the sidebar is visible", () => {
    render(<ActivityBar activeView="search" sidebarVisible onActivate={() => {}} />);
    expect(screen.getByRole("button", { name: /search/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /explorer/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onActivate with the clicked view", async () => {
    const onActivate = vi.fn();
    render(<ActivityBar activeView="explorer" sidebarVisible onActivate={onActivate} />);
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(onActivate).toHaveBeenCalledWith("search");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/ActivityBar.test.tsx`
Expected: FAIL — prop API differs.

- [ ] **Step 3: Implement** — replace `src/components/ActivityBar.tsx` with:
```tsx
type View = "explorer" | "search";

interface Props {
  activeView: View;
  sidebarVisible: boolean;
  onActivate: (view: View) => void;
}

export function ActivityBar({ activeView, sidebarVisible, onActivate }: Props) {
  const isActive = (v: View) => sidebarVisible && activeView === v;
  return (
    <div className="w-[54px] shrink-0 bg-titlebar border-r border-bd-2 flex flex-col items-center py-2.5 gap-1">
      <button
        aria-label="Explorer"
        aria-pressed={isActive("explorer")}
        onClick={() => onActivate("explorer")}
        className={`relative w-[38px] h-[38px] rounded-[9px] flex items-center justify-center ${
          isActive("explorer") ? "bg-accent/15 text-accent-soft" : "text-tx-3 hover:bg-white/5 hover:text-tx-bright"
        }`}
      >
        {isActive("explorer") && (
          <span className="absolute left-[-10px] top-[9px] w-[2.5px] h-5 rounded bg-accent" />
        )}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </button>
      <button
        aria-label="Search"
        aria-pressed={isActive("search")}
        onClick={() => onActivate("search")}
        className={`relative w-[38px] h-[38px] rounded-[9px] flex items-center justify-center ${
          isActive("search") ? "bg-accent/15 text-accent-soft" : "text-tx-3 hover:bg-white/5 hover:text-tx-bright"
        }`}
      >
        {isActive("search") && (
          <span className="absolute left-[-10px] top-[9px] w-[2.5px] h-5 rounded bg-accent" />
        )}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/ActivityBar.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): ActivityBar Explorer/Search view toggle"
```

---

## Task 12: App wiring — sidebar swap, openAt, reveal

**Files:** Modify `src/App.tsx`; Test `src/App.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `src/App.test.tsx`. Extend the existing `vi.mock("./api/fs", ...)` factory to also export `searchWorkspace: (...a) => searchWorkspace(...a)` and declare `const searchWorkspace = vi.fn();` near the other mock fns. **Also add `searchWorkspace` to the `beforeEach` reset array** (it currently resets a fixed list `[open, readDir, readFile, writeFile, setWorkspaceRoot]` — append `searchWorkspace`), and include `activeView: "explorer"` in the `useWorkspaceStore.setState({...})` reset object for hygiene. Then add:
```tsx
  it("switches to the search view and opens a clicked match at its line", async () => {
    open.mockResolvedValue("/proj");
    readDir.mockResolvedValue([{ name: "a.ts", path: "/proj/a.ts", is_dir: false }]);
    readFile.mockResolvedValue({ kind: "text", text: "alpha\nbeta useEffect gamma" });
    searchWorkspace.mockResolvedValue({
      files: [
        {
          path: "/proj/a.ts",
          rel_path: "a.ts",
          matches: [{ line_number: 2, preview: "beta useEffect gamma", highlight_ranges: [[5, 14]], match_start: 5, match_end: 14 }],
        },
      ],
      total_matches: 1,
      truncated: false,
      regex_error: null,
    });

    render(<App />);
    // open a folder first so the workspace exists
    await userEvent.click(screen.getByRole("button", { name: /open folder/i }));
    // switch to search view
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    await userEvent.type(await screen.findByPlaceholderText(/search/i), "useEffect");
    // click the match → opens the file and the editor shows its content
    await userEvent.click(await screen.findByText("useEffect"));
    const lines = await screen.findAllByText((_t, el) => el?.classList.contains("cm-line") ?? false);
    expect(lines.some((l) => /beta useEffect gamma/.test(l.textContent ?? ""))).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — no Search button / search view wiring yet.

- [ ] **Step 3: Implement** — edit `src/App.tsx`:
- Imports: add
```tsx
import { SearchPanel } from "./components/SearchPanel";
```
- Replace the `sidebarVisible` local state usage with view-aware state. Add near the other store selectors:
```tsx
  const activeView = useWorkspaceStore((s) => s.activeView);
  const setActiveView = useWorkspaceStore((s) => s.setActiveView);
```
- Add reveal state (near the other `useState`s):
```tsx
  const [reveal, setReveal] = useState<
    { path: string; line: number; matchStart: number; matchEnd: number; seq: number } | null
  >(null);
  const revealSeq = useRef(0);
```
  (add `useRef` to the React import: `import { useRef, useState } from "react";`)
- Add the activity-bar handler and the openAt flow:
```tsx
  function activate(view: "explorer" | "search") {
    if (activeView === view && sidebarVisible) {
      setSidebarVisible(false);
    } else {
      setActiveView(view);
      setSidebarVisible(true);
    }
  }

  async function openAt(path: string, line: number, matchStart: number, matchEnd: number) {
    const isOpen = tabs.some((t) => t.path === path);
    if (!isOpen) {
      await openFile(path);
    } else if (activeTabPath !== path) {
      setActive(path);
    }
    setReveal({ path, line, matchStart, matchEnd, seq: ++revealSeq.current });
  }
```
- Replace the `<ActivityBar .../>` usage with the new prop API:
```tsx
      <ActivityBar activeView={activeView} sidebarVisible={sidebarVisible} onActivate={activate} />
```
- Replace the sidebar block so it swaps on `activeView`:
```tsx
      {sidebarVisible && (
        <div className="flex">
          {activeView === "explorer" ? (
            <FileExplorer onOpenFile={openFile} onFsChange={handleFsChange} />
          ) : (
            <SearchPanel onOpenMatch={openAt} />
          )}
        </div>
      )}
```
- Pass `reveal` to `EditorPane` (only when it targets the active tab):
```tsx
          <EditorPane
            key={activeTab.path}
            path={activeTab.path}
            languageId={activeTab.languageId}
            initialDoc={docs[activeTab.path] ?? ""}
            onChange={() => setDirty(activeTab.path, true)}
            onSave={(doc) => handleSave(activeTab.path, doc)}
            onPersist={persistDoc}
            reveal={reveal && reveal.path === activeTab.path ? reveal : undefined}
          />
```
(Keep `sidebarVisible` local state as-is; only its setter usage moves into `activate`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/App.test.tsx`
Expected: all pass.

- [ ] **Step 5: Run the full suite + build**

Run: `npm run test` then `npm run build`
Expected: all frontend tests pass; build clean.

- [ ] **Step 6: Manual integration check (deferred to user)**

`source "$HOME/.cargo/env" && npm run tauri dev` → open a folder → click the Search icon → type a query → results group by file with highlights → click a match → editor opens the file, selects the match, scrolls to it. (Native run; not covered by headless tests.)

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat(frontend): wire search panel, view switching, and match reveal into App"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §2 engine (`ignore` + grep libs) — Tasks 1, 4. ✓
- §4 command shape / types / caps / deterministic order / regex_error / empty query / binary+size — Tasks 2, 4, 5. ✓
- §4.6 UTF-16 offset conversion chain — Task 3 (with multibyte tests). ✓
- §4 `path` == read_dir absolute form — Task 4 uses `path.to_string_lossy()` (same as `read_dir` in fs_ops). ✓
- §5 reveal (openAt order, EditorPane `[reveal?.seq]` effect, clamp, select) — Tasks 8, 12. ✓
- §6 store activeView, ActivityBar toggle rule, SearchPanel (debounce + seq guard + groups + highlight + empty-clear), api wrapper — Tasks 6, 7, 9, 10, 11, 12. ✓
- §7 errors: no-workspace → AppError(Io) (Task 5) surfaced via existing notice path; regex_error inline (Task 10); truncated note (Task 10). ✓ (Note: no-workspace only occurs if search runs before a folder is opened; the panel simply shows the rejection — acceptable, and the UI only reaches search after a workspace exists in practice.)
- §8 testing — Rust fixtures (Task 4), frontend (Tasks 8–12). ✓
- §9 non-goals — nothing implemented beyond scope. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code.

**Type consistency:** `SearchOptions {case_sensitive, regex}`, `LineMatch {line_number, preview, highlight_ranges, match_start, match_end}`, `FileMatches {path, rel_path, matches}`, `SearchResponse {files, total_matches, truncated, regex_error}` identical across Rust (Task 2) and TS (Task 6). `onOpenMatch(path, line, matchStart, matchEnd)` ↔ `openAt(...)` ↔ `reveal{line,matchStart,matchEnd,seq}` consistent (Tasks 8, 10, 12). `activate`/`onActivate(view)` consistent (Tasks 11, 12).

**Known minor risks (non-blocking):**
- grep crate API details (`SinkMatch`/`UTF8` sink, `Matcher::find_iter` signature) may need a tiny adjustment against the installed crate versions; the test in Task 4 catches any mismatch immediately.
- The `truncated` flag is coarse (one bool for all cap types) — acceptable per spec.
