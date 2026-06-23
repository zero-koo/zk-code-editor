# Diff Syntax Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-file-context syntax highlighting for the git DiffView — color diff lines using the editor's existing CodeMirror/Lezer highlighting, with backend-supplied file contents for accurate multi-line parsing.

**Architecture:** Backend adds `new_text`/`old_text` to each `FileDiff` (working-tree content + `git show HEAD:<ref>`). A new frontend `diffHighlight` module parses each full file once with the language's Lezer parser, runs `@lezer/highlight`'s `highlightTree` with the editor's exported `zkHighlight` HighlightStyle, and yields per-line segments. DiffView lazily highlights visible files' lines (cached) and maps each diff line to its segments, falling back to plain text.

**Tech Stack:** Rust (`git show`, serde), React 19 + TS, CodeMirror (`@codemirror/language`, `@lezer/highlight`), `style-mod`, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-23-diff-syntax-highlight-design.md`

---

## File Structure

- **Modify** `src-tauri/src/fs_ops.rs` — extract `pub fn classify_bytes(Vec<u8>) -> FileContent`; `detect_file` reuses it.
- **Modify** `src-tauri/src/git.rs` — add `new_text`/`old_text` to `FileDiff`; fill them in `compute_changes`.
- **Modify** `src/api/types.ts` — add `new_text`/`old_text` to `FileDiff`.
- **Modify** `src/lib/language.ts` — add `lezerParserFor(id)`.
- **Modify** `src/lib/editorTheme.ts` — `export` `zkHighlight`.
- **Create** `src/lib/diffHighlight.ts` (+ test) — `highlightToLines`/`getHighlightedLines`/`clearHighlightCache`.
- **Modify** `src/components/DiffView.tsx` (+ test) — line rows carry `langId`/`newText`/`oldText`; `renderRow` renders highlighted spans; clear cache on changes reload.
- **Modify** `package.json` — add `style-mod` as a direct dependency.

---

## Task 1: Backend — file contents in `FileDiff`

**Files:** `src-tauri/src/fs_ops.rs`, `src-tauri/src/git.rs`

Rust env: `cd src-tauri && . "$HOME/.cargo/env" && cargo test --lib`.

- [ ] **Step 1: Extract `classify_bytes` in `fs_ops.rs`**

Replace `detect_file` with:

```rust
/// Classifies raw bytes as Text/Binary/TooLarge (used for files read off-disk
/// and for `git show` output).
pub fn classify_bytes(bytes: Vec<u8>) -> FileContent {
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return FileContent::TooLarge;
    }
    if bytes.contains(&0) {
        return FileContent::Binary;
    }
    match String::from_utf8(bytes) {
        Ok(text) => FileContent::Text(text),
        Err(_) => FileContent::Binary,
    }
}

/// Classifies a file at an absolute path as Text/Binary/TooLarge.
pub fn detect_file(file: &Path) -> Result<FileContent, AppError> {
    let meta = std::fs::metadata(file)?;
    if meta.len() > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge); // avoid reading an oversized file into memory
    }
    Ok(classify_bytes(std::fs::read(file)?))
}
```

- [ ] **Step 2: Add `classify_bytes` unit tests** to the `fs_ops` `tests` module:

```rust
    #[test]
    fn classify_bytes_text() {
        assert_eq!(classify_bytes(b"hello".to_vec()), FileContent::Text("hello".into()));
    }

    #[test]
    fn classify_bytes_binary_on_null() {
        assert_eq!(classify_bytes(vec![104, 0, 105]), FileContent::Binary);
    }

    #[test]
    fn classify_bytes_too_large() {
        let big = vec![b'a'; (MAX_TEXT_BYTES + 1) as usize];
        assert_eq!(classify_bytes(big), FileContent::TooLarge);
    }
```

- [ ] **Step 3: Run fs_ops tests**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test --lib fs_ops::tests`
Expected: PASS (existing + 3 new).

- [ ] **Step 4: Add `new_text`/`old_text` to the `FileDiff` struct** (`git.rs`, the `pub struct FileDiff`):

```rust
    pub binary: bool,
    pub too_large: bool,
    pub new_text: Option<String>,
    pub old_text: Option<String>,
    pub hunks: Vec<Hunk>,
```

- [ ] **Step 5: Default the new fields at BOTH `FileDiff` construction sites**

In `parse_diff` (the `cur = Some(FileDiff { ... })` initializer) and in `untracked_file_diff` (the `let mut fd = FileDiff { ... }` initializer), add:

```rust
        new_text: None,
        old_text: None,
```

- [ ] **Step 6: Write the failing content-fill integration test** — add to the `git.rs` `tests` module:

```rust
    #[test]
    fn compute_changes_includes_file_contents() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(dir.join("gone.txt"), "bye\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        // modify a, delete gone, add untracked u
        std::fs::write(dir.join("a.txt"), "one\nTWO\n").unwrap();
        std::fs::remove_file(dir.join("gone.txt")).unwrap();
        std::fs::write(dir.join("u.txt"), "new\n").unwrap();

        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        let a = changes.files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(a.new_text.as_deref(), Some("one\nTWO\n"));
        assert_eq!(a.old_text.as_deref(), Some("one\ntwo\n"));
        let gone = changes.files.iter().find(|f| f.path == "gone.txt").unwrap();
        assert_eq!(gone.status, "deleted");
        assert_eq!(gone.new_text, None);
        assert_eq!(gone.old_text.as_deref(), Some("bye\n"));
        let u = changes.files.iter().find(|f| f.path == "u.txt").unwrap();
        assert_eq!(u.new_text.as_deref(), Some("new\n"));
        assert_eq!(u.old_text, None);
    }
```

- [ ] **Step 7: Run to verify it fails**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test --lib git::tests::compute_changes_includes_file_contents`
Expected: FAIL (new_text/old_text are all None — not yet filled).

- [ ] **Step 8: Fill `new_text`/`old_text` in `compute_changes`**

Add `classify_bytes` to the fs_ops import at the top of `git.rs`:
```rust
use crate::fs_ops::{classify_bytes, detect_file, FileContent};
```
Then, in `compute_changes`, AFTER the untracked loop and BEFORE the final `Ok(GitChanges { ... })`, insert:

```rust
    // Attach full file contents for syntax highlighting (text files only).
    for f in &mut files {
        if f.status != "deleted" {
            if let Ok(FileContent::Text(t)) = detect_file(&root_path.join(&f.path)) {
                f.new_text = Some(t);
            }
        }
        if f.status != "added" && f.status != "untracked" {
            let r = f.old_path.clone().unwrap_or_else(|| f.path.clone());
            if let Ok(out) = git_output(root, &["show", &format!("HEAD:{r}")]) {
                if out.status.success() {
                    if let FileContent::Text(t) = classify_bytes(out.stdout) {
                        f.old_text = Some(t);
                    }
                }
            }
        }
    }
```

- [ ] **Step 9: Run tests + build**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test --lib`
Expected: PASS (all, incl. the new content test).
Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo build`
Expected: compiles.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/fs_ops.rs src-tauri/src/git.rs
git commit -m "feat(backend): include file contents in git_changes for diff highlighting

- FileDiff에 new_text(작업트리)/old_text(git show HEAD:) 추가, 텍스트만
- fs_ops.classify_bytes 추출(바이트 분류 공유), git show stdout은 바이트로 분류"
```

---

## Task 2: Frontend highlight engine

**Files:** `package.json`, `src/lib/language.ts`, `src/lib/editorTheme.ts`, `src/lib/diffHighlight.ts`, `src/lib/diffHighlight.test.ts`

- [ ] **Step 1: Add `style-mod` as a direct dependency**

Run: `npm install style-mod@^4.1.3`
(It is already resolved transitively at 4.1.3; this records it as a direct dep so the import is stable.)

- [ ] **Step 2: Add `lezerParserFor` to `src/lib/language.ts`**

Add imports and the function (append at end):
```ts
import { LanguageSupport, Language } from "@codemirror/language";
import type { Parser } from "@lezer/common";

/** The Lezer parser for a language id, or null for plaintext/unsupported. */
export function lezerParserFor(id: string): Parser | null {
  const ext = languageExtension(id);
  const lang =
    ext instanceof LanguageSupport ? ext.language : ext instanceof Language ? ext : null;
  return lang ? lang.parser : null;
}
```
(Note: `StreamLanguage` extends `Language`, so go/shell resolve via the `Language` branch. `@codemirror/language` already provides `StreamLanguage`; `LanguageSupport`/`Language` are exported classes.)

- [ ] **Step 3: Export `zkHighlight` from `src/lib/editorTheme.ts`**

Change `const zkHighlight = HighlightStyle.define([` to `export const zkHighlight = HighlightStyle.define([`. (Leave `zkTheme` unchanged — it references `zkHighlight` in the same module.)

- [ ] **Step 4: Write the failing tests `src/lib/diffHighlight.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { highlightToLines } from "./diffHighlight";

describe("highlightToLines", () => {
  it("returns one entry per line", () => {
    expect(highlightToLines("const x = 1\nconst y = 2", "typescript").length).toBe(2);
  });

  it("highlights a keyword with a class", () => {
    const out = highlightToLines("const x = 1", "typescript");
    const kw = out[0].find((s) => s.text === "const");
    expect(kw?.className).toBeTruthy();
  });

  it("falls back to plain segments for an unsupported language", () => {
    expect(highlightToLines("hello world", "plaintext")).toEqual([[{ text: "hello world" }]]);
  });

  it("preserves each line's content for CRLF text", () => {
    const out = highlightToLines("a\r\nb", "typescript");
    expect(out.length).toBe(2);
    expect(out[0].map((s) => s.text).join("")).toBe("a\r");
    expect(out[1].map((s) => s.text).join("")).toBe("b");
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run src/lib/diffHighlight.test.ts`
Expected: FAIL — cannot resolve `./diffHighlight`.

- [ ] **Step 6: Implement `src/lib/diffHighlight.ts`**

```ts
import { highlightTree } from "@lezer/highlight";
import { StyleModule } from "style-mod";
import { zkHighlight } from "./editorTheme";
import { lezerParserFor } from "./language";

export interface Segment {
  text: string;
  className?: string;
}

let stylesMounted = false;
function ensureStyles(): void {
  // zkHighlight uses inline-style specs so .module is non-null; mounting it makes
  // the class names produced by highlightTree carry the editor's colors. mount()
  // dedupes, so this is safe even though EditorPane also mounts it.
  if (!stylesMounted && zkHighlight.module) {
    StyleModule.mount(document, zkHighlight.module);
    stylesMounted = true;
  }
}

const cache = new Map<string, Segment[][]>();

export function clearHighlightCache(): void {
  cache.clear();
}

/** Parses the full text and returns per-line styled segments (index = line - 1). */
export function highlightToLines(text: string, languageId: string): Segment[][] {
  const parser = lezerParserFor(languageId);
  if (!parser) {
    return text.split("\n").map((line) => [{ text: line }]);
  }
  ensureStyles();
  const tree = parser.parse(text);

  // Ordered ranges over the whole text, filling gaps between styled tokens.
  const ranges: { from: number; to: number; cls?: string }[] = [];
  let pos = 0;
  highlightTree(tree, zkHighlight, (from, to, classes) => {
    if (from > pos) ranges.push({ from: pos, to: from });
    ranges.push({ from, to, cls: classes });
    pos = to;
  });
  if (pos < text.length) ranges.push({ from: pos, to: text.length });

  // Split ranges into per-line segments on newlines.
  const lines: Segment[][] = [];
  let current: Segment[] = [];
  for (const r of ranges) {
    const parts = text.slice(r.from, r.to).split("\n");
    parts.forEach((part, i) => {
      if (i > 0) {
        lines.push(current);
        current = [];
      }
      if (part.length) current.push({ text: part, className: r.cls });
    });
  }
  lines.push(current);
  return lines;
}

/** Memoized by (languageId, text) so each file is parsed once. */
export function getHighlightedLines(text: string, languageId: string): Segment[][] {
  const key = `${languageId}\n${text}`;
  let v = cache.get(key);
  if (!v) {
    v = highlightToLines(text, languageId);
    cache.set(key, v);
  }
  return v;
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run src/lib/diffHighlight.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/language.ts src/lib/editorTheme.ts src/lib/diffHighlight.ts src/lib/diffHighlight.test.ts
git commit -m "feat(frontend): add diff syntax-highlight engine

- lezerParserFor로 언어별 Lezer 파서 추출, zkHighlight export
- highlightToLines: 전체 텍스트 파싱→줄별 세그먼트, (언어,텍스트) 캐시
- 색상은 zkHighlight StyleModule mount로 에디터와 일치, style-mod 직접 의존성 추가"
```

---

## Task 3: DiffView integration

**Files:** `src/api/types.ts`, `src/components/DiffView.tsx`, `src/components/DiffView.test.tsx`

- [ ] **Step 1: Add the content fields to `FileDiff` in `src/api/types.ts`**

```ts
export interface FileDiff {
  path: string;
  old_path: string | null;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  binary: boolean;
  too_large: boolean;
  new_text: string | null;
  old_text: string | null;
  hunks: Hunk[];
}
```

- [ ] **Step 2: Write/extend the failing test in `src/components/DiffView.test.tsx`**

Every `FileDiff` literal in the fixtures now needs `new_text`/`old_text`. Add them to the existing fixtures (set the relevant content; `null` where not applicable), and add a highlighting test. Concretely:

(a) In `sample`'s file, add after `too_large: false,`:
```tsx
      new_text: "const neo = 2\n",
      old_text: "const old = 2\n",
```
(b) `multi` is three inline `FileDiff` literals (not a builder). To each of the three, add `new_text` equal to its single line + "\n" and `old_text: null` — i.e. `new_text: "aaa\n", old_text: null,` on src/a.ts, `"bbb\n"` on src/b.ts, `"ccc\n"` on src/c.ts.
(c) In the binary-file test fixture, add `new_text: null, old_text: null,`.

Then add this test:
```tsx
  it("syntax-highlights a supported line into colored spans", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      files: [
        {
          path: "a.ts",
          old_path: null,
          status: "added",
          additions: 1,
          deletions: 0,
          binary: false,
          too_large: false,
          new_text: "const x = 1\n",
          old_text: null,
          hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "const x = 1" }] }],
        },
      ],
    });
    const { container } = render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    const constSpan = [...container.querySelectorAll("span")].find((s) => s.textContent === "const");
    expect(constSpan).toBeTruthy();
    expect(constSpan!.className).toBeTruthy(); // highlighted token carries a class
  });
```

- [ ] **Step 3: Run to verify the new test fails (and types compile in the test)**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: FAIL — the line renders as plain text (no highlighting yet), so no `<span>` with textContent exactly `"const"`.

- [ ] **Step 4: Modify `src/components/DiffView.tsx`**

(a) Imports:
```tsx
import { getHighlightedLines, clearHighlightCache } from "../lib/diffHighlight";
import { languageIdForFile } from "../lib/language";
```

(b) Extend the `Row` line variant:
```tsx
  | { kind: "line"; lineKind: "context" | "add" | "del"; oldNo: number | null; newNo: number | null; text: string; langId: string; newText: string | null; oldText: string | null }
```

(c) In the flatten loop, set the file's language id once per file and pass the fields to each line row. Inside `for (const file of changes.files) {`, after `pathToRowIndex.set(...)` etc., compute `const langId = languageIdForFile(file.path);` (place it right after the `rows.push({ kind: "file", file });`/offset lines, before the hunks loop). Then change the line push to:
```tsx
        for (const l of h.lines) {
          rows.push({ kind: "line", lineKind: l.kind, oldNo: l.old_no, newNo: l.new_no, text: l.text, langId, newText: file.new_text, oldText: file.old_text });
          top += ROW_H.line;
        }
```

(d) Clear the highlight cache when the change set reloads — add an effect near the existing load effect:
```tsx
  useEffect(() => {
    clearHighlightCache();
  }, [changes]);
```

(e) Replace the `line` rendering in `renderRow` (the final return block) so the content is highlighted segments with a plain fallback:
```tsx
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
```

- [ ] **Step 5: Run the DiffView tests + full suite + build**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: PASS (8 tests: prior 7 + highlighting).
Run: `npx vitest run`
Expected: PASS — full suite (investigate any failure; do not delete tests).
Run: `npm run build`
Expected: `tsc && vite build` succeed.

- [ ] **Step 6: Commit**

```bash
git add src/api/types.ts src/components/DiffView.tsx src/components/DiffView.test.tsx
git commit -m "feat(frontend): syntax-highlight diff lines via full-file context

- FileDiff new_text/old_text 타입 추가
- 줄을 getHighlightedLines로 강조한 세그먼트 span으로 렌더(불일치 시 플레인 폴백)
- changes 재로드 시 강조 캐시 정리"
```

---

## Task 4: Manual verification

**Files:** none (manual QA)

- [ ] **Step 1: Launch in a real repo**: `npm run tauri dev`, open a repo with TS/JS/Rust/etc. changes, go to Source Control.

- [ ] **Step 2: Verify**
- Diff lines are syntax-highlighted with the SAME colors as the editor (keywords, strings, comments, types).
- A file with a **multi-line block comment or template literal** spanning the diff is highlighted correctly (full-file context, not per-line mis-color).
- Added/modified/deleted/renamed lines all colored (add via new content, del via old content). Untracked files colored.
- Binary / very large / plaintext files render as before (plain). No console errors.
- Scrolling a large changed file is smooth after the first paint (highlight cached). Switching git↔editor still preserves the editor.

- [ ] **Step 3: (No commit)** — manual only; commit any fixes referencing the observed defect.

---

## Self-Review Notes

- **Spec coverage:** §2.1/§2.2 backend fields + fill (Task 1 steps 4-8), §2.3 classify_bytes extraction (Task 1 steps 1-3), §3.1 lezerParserFor (Task 2 step 2), §3.2 zkHighlight export + StyleModule mount (Task 2 steps 3,6), §3.3 highlightToLines gap-fill + line split (Task 2 step 6), §3.4 cache keyed by languageId+text + clearHighlightCache (Task 2 step 6 + Task 3 step 4d), §4 DiffView line fields + lazy render + fallback + guard (Task 3), §5 edge cases (deleted→old only, added/untracked→new only, binary/too_large/plaintext→plain via null fields, mismatch guard), §6 tests (Task 1 classify_bytes + content integration; Task 2 highlightToLines incl. CRLF; Task 3 highlighting render), §7 file changes (all), §8 non-goals (no intra-line, no bg change, no new language — none added).
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** Rust `new_text`/`old_text: Option<String>` ↔ TS `new_text`/`old_text: string | null` (snake_case). `classify_bytes(Vec<u8>) -> FileContent` used in git.rs. `lezerParserFor(id): Parser | null`, `highlightToLines(text, id): Segment[][]`, `getHighlightedLines`, `clearHighlightCache`, `Segment { text; className? }` consistent across Task 2 (defs) and Task 3 (usage). DiffView line Row adds `langId`/`newText`/`oldText` consumed by `renderRow`.
- **Note:** the `join("") === row.text` guard in renderRow keeps highlighting only when the highlighted line reconstructs the diff line exactly (handles rare drift / CRLF) — otherwise plain text, never wrong colors on mismatched content.
