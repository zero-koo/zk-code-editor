# Git Diff View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only "Git changes" view that shows the working-tree diff (`git diff HEAD` + untracked files) as one continuous GitHub "Files changed"-style unified diff, opened from a new activity-bar icon.

**Architecture:** Rust shells out to the `git` CLI and parses the unified diff into structured JSON (a pure `parse_diff` fn + a `git_changes` command). The React frontend renders that data in a virtualized `DiffView` shown in the main area when `activeView==="git"`; the editor subtree stays mounted (hidden) so the persistent EditorView cache survives.

**Tech Stack:** Rust (`std::process::Command`, serde), Tauri v2 commands, React 19 + TypeScript, Zustand, `@tanstack/react-virtual`, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-22-git-diff-view-design.md`

---

## File Structure

- **Create** `src-tauri/src/git.rs` — git data types, the pure `parse_diff` parser, untracked-file synthesis, and the `git_changes` command. One responsibility: produce `GitChanges` from a repo root.
- **Modify** `src-tauri/src/lib.rs` — `mod git;` + register `git::git_changes`.
- **Modify** `src-tauri/src/fs_ops.rs` — extract a `pub fn detect_file(&Path) -> Result<FileContent, AppError>` (reused by git.rs for untracked files); refactor `read_file_impl` to call it.
- **Create** `src/api/git.ts` — `gitChanges(root)` command wrapper.
- **Modify** `src/api/types.ts` — `DiffLine`/`Hunk`/`FileDiff`/`GitChanges` types (snake_case).
- **Create** `src/store/gitStore.ts` — Zustand store `{ changes, loading, error, load(root) }`.
- **Create** `src/components/DiffView.tsx` — the virtualized continuous diff view + states.
- **Modify** `src/components/icons.tsx` — add `GitBranchIcon`.
- **Modify** `src/components/ActivityBar.tsx` — add git button; make `isActive` view-aware.
- **Modify** `src/store/workspaceStore.ts` — extend `activeView` to include `"git"`.
- **Modify** `src/App.tsx` — `activate("git")`, render DiffView (hidden-toggle, editor stays mounted).

---

## Task 1: Rust diff parser + data types

**Files:**
- Create: `src-tauri/src/git.rs`

The pure parser is the testable core; no git invocation yet.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/git.rs` with ONLY the types, an empty parser, and tests:

```rust
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq)]
pub struct DiffLine {
    pub kind: String, // "context" | "add" | "del"
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Hunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String, // "modified" | "added" | "deleted" | "renamed" | "untracked"
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub too_large: bool,
    pub hunks: Vec<Hunk>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct GitChanges {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub files: Vec<FileDiff>,
}

pub fn parse_diff(_diff: &str) -> Vec<FileDiff> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_simple_modification() {
        let diff = "diff --git a/src/a.ts b/src/a.ts\n\
index 111..222 100644\n\
--- a/src/a.ts\n\
+++ b/src/a.ts\n\
@@ -1,3 +1,3 @@\n\
 const x = 1\n\
-const old = 2\n\
+const neo = 2\n\
 doStuff()\n";
        let files = parse_diff(diff);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.path, "src/a.ts");
        assert_eq!(f.status, "modified");
        assert_eq!(f.additions, 1);
        assert_eq!(f.deletions, 1);
        assert_eq!(f.hunks.len(), 1);
        let lines = &f.hunks[0].lines;
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[0].kind, "context");
        assert_eq!(lines[0].old_no, Some(1));
        assert_eq!(lines[0].new_no, Some(1));
        assert_eq!(lines[1].kind, "del");
        assert_eq!(lines[1].old_no, Some(2));
        assert_eq!(lines[1].new_no, None);
        assert_eq!(lines[2].kind, "add");
        assert_eq!(lines[2].old_no, None);
        assert_eq!(lines[2].new_no, Some(2));
        assert_eq!(lines[2].text, "const neo = 2");
    }

    #[test]
    fn parses_new_and_deleted_files() {
        let diff = "diff --git a/n.txt b/n.txt\n\
new file mode 100644\n\
index 0000000..abc\n\
--- /dev/null\n\
+++ b/n.txt\n\
@@ -0,0 +1,2 @@\n\
+line one\n\
+line two\n\
diff --git a/d.txt b/d.txt\n\
deleted file mode 100644\n\
index abc..0000000\n\
--- a/d.txt\n\
+++ /dev/null\n\
@@ -1,1 +0,0 @@\n\
-gone\n";
        let files = parse_diff(diff);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "n.txt");
        assert_eq!(files[0].status, "added");
        assert_eq!(files[0].additions, 2);
        assert_eq!(files[1].path, "d.txt");
        assert_eq!(files[1].status, "deleted");
        assert_eq!(files[1].deletions, 1);
    }

    #[test]
    fn parses_rename_with_content_change() {
        let diff = "diff --git a/old.ts b/new.ts\n\
similarity index 80%\n\
rename from old.ts\n\
rename to new.ts\n\
index 111..222 100644\n\
--- a/old.ts\n\
+++ b/new.ts\n\
@@ -1,1 +1,1 @@\n\
-a\n\
+b\n";
        let files = parse_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "renamed");
        assert_eq!(files[0].old_path, Some("old.ts".to_string()));
        assert_eq!(files[0].path, "new.ts");
    }

    #[test]
    fn marks_binary_files() {
        let diff = "diff --git a/img.png b/img.png\n\
index 111..222 100644\n\
Binary files a/img.png and b/img.png differ\n";
        let files = parse_diff(diff);
        assert_eq!(files.len(), 1);
        assert!(files[0].binary);
        assert!(files[0].hunks.is_empty());
    }

    #[test]
    fn handles_mode_only_change_and_no_count_hunk() {
        // chmod only -> no hunks, modified
        let chmod = "diff --git a/s.sh b/s.sh\nold mode 100644\nnew mode 100755\n";
        let files = parse_diff(chmod);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[0].path, "s.sh"); // path must come from the diff --git header
        assert!(files[0].hunks.is_empty());

        // single-line hunk with omitted counts: "@@ -1 +1 @@"
        let single = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
        let f = parse_diff(single);
        assert_eq!(f[0].hunks[0].lines[0].old_no, Some(1));
        assert_eq!(f[0].hunks[0].lines[1].new_no, Some(1));
    }

    #[test]
    fn ignores_no_newline_marker() {
        let diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+a\n\\ No newline at end of file\n";
        let files = parse_diff(diff);
        assert_eq!(files[0].deletions, 1);
        assert_eq!(files[0].additions, 1);
        assert_eq!(files[0].hunks[0].lines.len(), 2);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test --lib git::tests`
Expected: FAIL (the empty `parse_diff` returns no files; assertions fail).

- [ ] **Step 3: Implement `parse_diff` and `parse_hunk_header`**

Replace the `parse_diff` stub in `src-tauri/src/git.rs` with:

```rust
fn strip_ab(s: &str) -> Option<String> {
    if s == "/dev/null" {
        return None;
    }
    let p = s
        .strip_prefix("a/")
        .or_else(|| s.strip_prefix("b/"))
        .unwrap_or(s);
    Some(p.to_string())
}

/// Parses `@@ -oldStart[,n] +newStart[,n] @@` into (old_start, new_start).
/// Counts may be omitted (`@@ -1 +1 @@`); start defaults to 0 if unparseable.
fn parse_hunk_header(line: &str) -> (u32, u32) {
    let mut old_start = 0u32;
    let mut new_start = 0u32;
    for tok in line.split_whitespace() {
        if let Some(t) = tok.strip_prefix('-') {
            old_start = t.split(',').next().unwrap_or("0").parse().unwrap_or(0);
        } else if let Some(t) = tok.strip_prefix('+') {
            new_start = t.split(',').next().unwrap_or("0").parse().unwrap_or(0);
        }
    }
    (old_start, new_start)
}

pub fn parse_diff(diff: &str) -> Vec<FileDiff> {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut cur: Option<FileDiff> = None;
    let mut old_no: u32 = 0;
    let mut new_no: u32 = 0;

    for line in diff.split('\n') {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(f) = cur.take() {
                files.push(f);
            }
            // Default path from the header's b-side. This covers mode-only
            // (chmod) entries, which emit no ---/+++/rename lines; the
            // authoritative ---/+++/rename lines below override it when present.
            let default_path = rest
                .rfind(" b/")
                .map(|i| rest[i + 3..].to_string())
                .unwrap_or_default();
            cur = Some(FileDiff {
                path: default_path,
                old_path: None,
                status: "modified".to_string(),
                additions: 0,
                deletions: 0,
                binary: false,
                too_large: false,
                hunks: Vec::new(),
            });
            continue;
        }
        let Some(f) = cur.as_mut() else { continue };

        if line.starts_with("new file mode") {
            f.status = "added".to_string();
            continue;
        }
        if line.starts_with("deleted file mode") {
            f.status = "deleted".to_string();
            continue;
        }
        if let Some(p) = line.strip_prefix("rename from ") {
            f.status = "renamed".to_string();
            f.old_path = Some(p.to_string());
            continue;
        }
        if let Some(p) = line.strip_prefix("rename to ") {
            f.status = "renamed".to_string();
            f.path = p.to_string();
            continue;
        }
        if line.starts_with("old mode")
            || line.starts_with("new mode")
            || line.starts_with("index ")
            || line.starts_with("similarity index")
            || line.starts_with("dissimilarity index")
            || line.starts_with("copy from ")
            || line.starts_with("copy to ")
        {
            continue;
        }
        if line.starts_with("Binary files") {
            f.binary = true;
            continue;
        }
        if line.starts_with("--- ") {
            continue; // old-side path; ignored (b-side default + +++ are authoritative)
        }
        if let Some(rest) = line.strip_prefix("+++ ") {
            // Authoritative new path when present (not /dev/null). For a delete
            // (+++ /dev/null) keep the b-side default from the diff --git header.
            if let Some(p) = strip_ab(rest) {
                f.path = p;
            }
            continue;
        }
        if line.starts_with("@@") {
            let (os, ns) = parse_hunk_header(line);
            old_no = os;
            new_no = ns;
            f.hunks.push(Hunk {
                header: line.to_string(),
                lines: Vec::new(),
            });
            continue;
        }
        if line.starts_with('\\') {
            continue; // "\ No newline at end of file"
        }

        if let Some(h) = f.hunks.last_mut() {
            if let Some(text) = line.strip_prefix('+') {
                h.lines.push(DiffLine {
                    kind: "add".to_string(),
                    old_no: None,
                    new_no: Some(new_no),
                    text: text.to_string(),
                });
                new_no += 1;
                f.additions += 1;
            } else if let Some(text) = line.strip_prefix('-') {
                h.lines.push(DiffLine {
                    kind: "del".to_string(),
                    old_no: Some(old_no),
                    new_no: None,
                    text: text.to_string(),
                });
                old_no += 1;
                f.deletions += 1;
            } else if let Some(text) = line.strip_prefix(' ') {
                h.lines.push(DiffLine {
                    kind: "context".to_string(),
                    old_no: Some(old_no),
                    new_no: Some(new_no),
                    text: text.to_string(),
                });
                old_no += 1;
                new_no += 1;
            }
        }
    }
    if let Some(f) = cur.take() {
        files.push(f);
    }
    files
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test --lib git::tests`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git.rs
git commit -m "feat(backend): add git unified-diff parser and types

- 순수 parse_diff로 git diff 출력을 FileDiff/Hunk/DiffLine 구조로 파싱
- 수정/추가/삭제/리네임/바이너리/모드변경/count생략 헌크/no-newline 처리"
```

---

## Task 2: `git_changes` command (git invocation + untracked synthesis)

**Files:**
- Modify: `src-tauri/src/git.rs` (add command + helpers + integration test)
- Modify: `src-tauri/src/fs_ops.rs` (extract `detect_file`)
- Modify: `src-tauri/src/lib.rs` (register module + command)

- [ ] **Step 1: Extract `detect_file` in `fs_ops.rs`**

In `src-tauri/src/fs_ops.rs`, replace the body of `read_file_impl` (lines 54-68) so the detection logic lives in a reusable `detect_file`:

```rust
/// Classifies a file at an absolute path as Text/Binary/TooLarge.
pub fn detect_file(file: &Path) -> Result<FileContent, AppError> {
    let meta = std::fs::metadata(file)?;
    if meta.len() > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge);
    }
    let bytes = std::fs::read(file)?;
    if bytes.contains(&0) {
        return Ok(FileContent::Binary);
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok(FileContent::Text(text)),
        Err(_) => Ok(FileContent::Binary),
    }
}

pub fn read_file_impl(root: &Path, path: &str) -> Result<FileContent, AppError> {
    let file = resolve_in_workspace(root, path)?;
    detect_file(&file)
}
```

- [ ] **Step 2: Run existing fs_ops tests to verify no regression**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test --lib fs_ops::tests`
Expected: PASS (existing tests unchanged, e.g. `reads_text_file`, `detects_binary_via_null_byte`).

- [ ] **Step 3: Write the failing integration test for `compute_changes`**

Add to the `tests` module in `src-tauri/src/git.rs`:

```rust
    use std::path::Path;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {:?} failed", args);
    }

    #[test]
    fn compute_changes_reports_modified_and_untracked() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        // Hermetic: a global core.excludesFile could ignore u.txt, and global
        // hooks (e.g. gitleaks) could fail the commit. Local config wins and is
        // honored by compute_changes's own `git -C` calls.
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        // modify tracked + add untracked
        std::fs::write(dir.join("a.txt"), "one\nTWO\n").unwrap();
        std::fs::write(dir.join("u.txt"), "new\nfile\n").unwrap();

        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        assert!(changes.is_repo);
        let modified = changes.files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(modified.status, "modified");
        assert_eq!(modified.additions, 1);
        assert_eq!(modified.deletions, 1);
        let untracked = changes.files.iter().find(|f| f.path == "u.txt").unwrap();
        assert_eq!(untracked.status, "untracked");
        assert_eq!(untracked.additions, 2);
        assert!(!untracked.hunks.is_empty());
    }

    #[test]
    fn compute_changes_on_non_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let changes = compute_changes(tmp.path().to_str().unwrap()).unwrap();
        assert!(!changes.is_repo);
        assert!(changes.files.is_empty());
    }
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test --lib git::tests::compute_changes`
Expected: FAIL to compile (`compute_changes` not defined).

- [ ] **Step 5: Implement the command + helpers**

Add to the top of `src-tauri/src/git.rs` (after the `use serde::Serialize;` line add the imports) and append the functions:

```rust
use crate::error::{AppError, ErrorCode};
use crate::fs_ops::{detect_file, FileContent};
use std::path::Path;
use std::process::Command;

/// Runs `git -C <root> <args>` and returns stdout as a String on success.
fn git_output(root: &str, args: &[&str]) -> Result<std::process::Output, AppError> {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| AppError::new(ErrorCode::Io, format!("failed to run git: {e}")))
}

fn is_inside_repo(root: &str) -> bool {
    match git_output(root, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(out) => out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "true",
        Err(_) => false,
    }
}

fn current_branch(root: &str) -> Option<String> {
    if let Ok(out) = git_output(root, &["symbolic-ref", "--short", "HEAD"]) {
        if out.status.success() {
            let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !b.is_empty() {
                return Some(b);
            }
        }
    }
    // detached HEAD -> short SHA
    if let Ok(out) = git_output(root, &["rev-parse", "--short", "HEAD"]) {
        if out.status.success() {
            let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !b.is_empty() {
                return Some(b);
            }
        }
    }
    None
}

fn has_head(root: &str) -> bool {
    git_output(root, &["rev-parse", "--verify", "HEAD"])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Synthesizes an all-additions FileDiff for an untracked file.
fn untracked_file_diff(root: &Path, rel: &str) -> FileDiff {
    let abs = root.join(rel);
    let mut fd = FileDiff {
        path: rel.to_string(),
        old_path: None,
        status: "untracked".to_string(),
        additions: 0,
        deletions: 0,
        binary: false,
        too_large: false,
        hunks: Vec::new(),
    };
    match detect_file(&abs) {
        Ok(FileContent::Text(text)) => {
            let mut content: Vec<&str> = text.split('\n').collect();
            if matches!(content.last(), Some(&"")) {
                content.pop(); // drop the empty element from a trailing newline
            }
            let n = content.len() as u32;
            fd.additions = n;
            if n > 0 {
                let lines = content
                    .iter()
                    .enumerate()
                    .map(|(i, t)| DiffLine {
                        kind: "add".to_string(),
                        old_no: None,
                        new_no: Some(i as u32 + 1),
                        text: t.to_string(),
                    })
                    .collect();
                fd.hunks.push(Hunk {
                    header: format!("@@ -0,0 +1,{n} @@"),
                    lines,
                });
            }
        }
        Ok(FileContent::Binary) => fd.binary = true,
        Ok(FileContent::TooLarge) => fd.too_large = true,
        Err(_) => {} // unreadable -> header only
    }
    fd
}

pub fn compute_changes(root: &str) -> Result<GitChanges, AppError> {
    if !is_inside_repo(root) {
        return Ok(GitChanges {
            is_repo: false,
            branch: None,
            files: Vec::new(),
        });
    }
    let branch = current_branch(root);
    let mut files: Vec<FileDiff> = Vec::new();

    // Tracked changes vs HEAD (skip if no commits yet).
    if has_head(root) {
        let out = git_output(root, &["diff", "HEAD", "--no-color", "-M"])?;
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            files.extend(parse_diff(&text));
        }
    }

    // Untracked files.
    let root_path = Path::new(root);
    let out = git_output(root, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    if out.status.success() {
        let raw = String::from_utf8_lossy(&out.stdout);
        for rel in raw.split('\0').filter(|s| !s.is_empty()) {
            files.push(untracked_file_diff(root_path, rel));
        }
    }

    Ok(GitChanges {
        is_repo: true,
        branch,
        files,
    })
}

#[tauri::command]
pub async fn git_changes(root: String) -> Result<GitChanges, AppError> {
    tauri::async_runtime::spawn_blocking(move || compute_changes(&root))
        .await
        .map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))?
}
```

- [ ] **Step 6: Register the command in `lib.rs`**

In `src-tauri/src/lib.rs`, add `mod git;` near the other `mod` declarations, and add `git::git_changes,` to the `generate_handler!` list (after `search::search_workspace,`).

- [ ] **Step 7: Run tests + build**

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo test --lib`
Expected: PASS (git parser tests + the 2 new integration tests + existing fs_ops/error tests).

Run: `cd src-tauri && . "$HOME/.cargo/env" && cargo build`
Expected: compiles (no warnings that fail the build).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git.rs src-tauri/src/fs_ops.rs src-tauri/src/lib.rs
git commit -m "feat(backend): add git_changes command for working-tree diff

- git diff HEAD + untracked 합성으로 GitChanges 생성(브랜치/저장소 감지)
- unborn HEAD(symbolic-ref)·비-저장소 처리, untracked는 detect_file 재사용
- fs_ops.detect_file 추출(파일 분류 로직 공유)"
```

---

## Task 3: Frontend types, API wrapper, and git store

**Files:**
- Modify: `src/api/types.ts`
- Create: `src/api/git.ts`
- Create: `src/store/gitStore.ts`
- Test: `src/store/gitStore.test.ts`

- [ ] **Step 1: Add types to `src/api/types.ts`**

Append (snake_case to match Rust serde output):

```ts
export interface DiffLine {
  kind: "context" | "add" | "del";
  old_no: number | null;
  new_no: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  old_path: string | null;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  binary: boolean;
  too_large: boolean;
  hunks: Hunk[];
}

export interface GitChanges {
  is_repo: boolean;
  branch: string | null;
  files: FileDiff[];
}
```

- [ ] **Step 2: Create the API wrapper `src/api/git.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { GitChanges } from "./types";

export const gitChanges = (root: string) =>
  invoke<GitChanges>("git_changes", { root });
```

- [ ] **Step 3: Write the failing store test `src/store/gitStore.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitChanges } from "../api/types";

const gitChanges = vi.fn();
vi.mock("../api/git", () => ({ gitChanges: (...a: unknown[]) => gitChanges(...a) }));

import { useGitStore } from "./gitStore";

const empty: GitChanges = { is_repo: true, branch: "main", files: [] };

describe("gitStore", () => {
  beforeEach(() => {
    gitChanges.mockReset();
    useGitStore.setState({ changes: null, loading: false, error: null });
  });

  it("loads changes and clears loading", async () => {
    gitChanges.mockResolvedValue(empty);
    await useGitStore.getState().load("/repo");
    expect(gitChanges).toHaveBeenCalledWith("/repo");
    expect(useGitStore.getState().changes).toEqual(empty);
    expect(useGitStore.getState().loading).toBe(false);
    expect(useGitStore.getState().error).toBeNull();
  });

  it("records an error message on failure", async () => {
    gitChanges.mockRejectedValue({ message: "git boom" });
    await useGitStore.getState().load("/repo");
    expect(useGitStore.getState().error).toBe("git boom");
    expect(useGitStore.getState().loading).toBe(false);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/store/gitStore.test.ts`
Expected: FAIL — cannot resolve `./gitStore`.

- [ ] **Step 5: Implement `src/store/gitStore.ts`**

```ts
import { create } from "zustand";
import type { GitChanges } from "../api/types";
import { gitChanges } from "../api/git";

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

interface GitState {
  changes: GitChanges | null;
  loading: boolean;
  error: string | null;
  load: (root: string) => Promise<void>;
}

let seq = 0;

export const useGitStore = create<GitState>((set) => ({
  changes: null,
  loading: false,
  error: null,
  load: async (root) => {
    const s = ++seq;
    set({ loading: true, error: null });
    try {
      const changes = await gitChanges(root);
      if (s === seq) set({ changes, loading: false });
    } catch (e) {
      if (s === seq) set({ error: errorMessage(e), loading: false });
    }
  },
}));
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/store/gitStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/api/types.ts src/api/git.ts src/store/gitStore.ts src/store/gitStore.test.ts
git commit -m "feat(frontend): add git changes types, api wrapper, and store

- GitChanges/FileDiff/Hunk/DiffLine 타입(snake_case)
- gitChanges 명령 래퍼, 레이스 가드 포함 gitStore.load"
```

---

## Task 4: DiffView component (virtualized continuous diff)

**Files:**
- Create: `src/components/DiffView.tsx`
- Test: `src/components/DiffView.test.tsx`

- [ ] **Step 1: Write the failing tests `src/components/DiffView.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitChanges } from "../api/types";
import { useGitStore } from "../store/gitStore";

const gitChanges = vi.fn();
vi.mock("../api/git", () => ({ gitChanges: (...a: unknown[]) => gitChanges(...a) }));

import { DiffView } from "./DiffView";

const sample: GitChanges = {
  is_repo: true,
  branch: "main",
  files: [
    {
      path: "src/a.ts",
      old_path: null,
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
      too_large: false,
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          lines: [
            { kind: "del", old_no: 1, new_no: null, text: "const old = 2" },
            { kind: "add", old_no: null, new_no: 1, text: "const neo = 2" },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  gitChanges.mockReset();
  useGitStore.setState({ changes: null, loading: false, error: null });
});

describe("DiffView", () => {
  it("renders the file header and diff lines", async () => {
    gitChanges.mockResolvedValue(sample);
    render(<DiffView root="/repo" active />);
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
    expect(await screen.findByText("const neo = 2")).toBeInTheDocument();
    expect(screen.getByText("const old = 2")).toBeInTheDocument();
  });

  it("collapses a file's lines when its header is clicked", async () => {
    gitChanges.mockResolvedValue(sample);
    render(<DiffView root="/repo" active />);
    await screen.findByText("const neo = 2");
    await userEvent.click(screen.getByText("src/a.ts"));
    expect(screen.queryByText("const neo = 2")).not.toBeInTheDocument();
  });

  it("shows a binary-file notice instead of hunks", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      files: [{ path: "img.png", old_path: null, status: "modified", additions: 0, deletions: 0, binary: true, too_large: false, hunks: [] }],
    });
    render(<DiffView root="/repo" active />);
    expect(await screen.findByText(/binary file/i)).toBeInTheDocument();
  });

  it("shows the not-a-repository state", async () => {
    gitChanges.mockResolvedValue({ is_repo: false, branch: null, files: [] });
    render(<DiffView root="/repo" active />);
    expect(await screen.findByText(/not a git repository/i)).toBeInTheDocument();
  });

  it("shows the no-changes state", async () => {
    gitChanges.mockResolvedValue({ is_repo: true, branch: "main", files: [] });
    render(<DiffView root="/repo" active />);
    expect(await screen.findByText(/no changes/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: FAIL — cannot resolve `./DiffView`.

- [ ] **Step 3: Implement `src/components/DiffView.tsx`**

```tsx
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

  // Load when the view becomes active (and on root change while active).
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

  // Flatten files -> rows for virtualization.
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
  // line
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: PASS (5 tests). The `.zk-scroll` jsdom offsetHeight stub (already in `src/test/setup.ts`) gives the scroller a non-zero height so the virtualizer renders rows.

- [ ] **Step 5: Commit**

```bash
git add src/components/DiffView.tsx src/components/DiffView.test.tsx
git commit -m "feat(frontend): add virtualized DiffView for git changes

- 파일/헌크/줄을 평탄화해 react-virtual로 연속 unified diff 렌더
- 파일 접기, +/−/context 색상·양쪽 라인번호, 바이너리/대용량 안내
- loading/error/not-a-repo/no-changes 상태, 새로고침 버튼"
```

---

## Task 5: App integration (activity-bar icon, activeView, hidden-toggle)

**Files:**
- Modify: `src/store/workspaceStore.ts`
- Modify: `src/components/icons.tsx`
- Modify: `src/components/ActivityBar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend `activeView` in `src/store/workspaceStore.ts`**

Change the three occurrences of the view union to include `"git"`:
- Line ~10: `activeView: "explorer" | "search" | "git";`
- Line ~13: `setActiveView: (view: "explorer" | "search" | "git") => void;`
(The initial value `activeView: "explorer"` and the setter body stay unchanged.)

- [ ] **Step 2: Add `GitBranchIcon` to `src/components/icons.tsx`**

Append:

```tsx
export const GitBranchIcon = (p: IconProps) => (
  <Icon {...p}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </Icon>
);
```

- [ ] **Step 3: Add the git button + view-aware highlight in `src/components/ActivityBar.tsx`**

Change the `View` type and `isActive`, and add a button. Replace the `type View` line:

```tsx
type View = "explorer" | "search" | "git";
```

Replace `isActive`:

```tsx
  const isActive = (v: View) =>
    v === "git" ? activeView === "git" : sidebarVisible && activeView === v;
```

Add the import of `GitBranchIcon` to the icons import, and add this button immediately after the Search `<button>` (before the `IconButton` for shortcuts):

```tsx
      <button
        aria-label="Source Control"
        aria-pressed={isActive("git")}
        onClick={() => onActivate("git")}
        className={`relative w-[38px] h-[38px] rounded-[9px] flex items-center justify-center ${
          isActive("git") ? "bg-accent/15 text-accent-soft" : "text-tx-3 hover:bg-white/5 hover:text-tx-bright"
        }`}
      >
        {isActive("git") && (
          <span className="absolute left-[-10px] top-[9px] w-[2.5px] h-5 rounded bg-accent" />
        )}
        <GitBranchIcon size={19} strokeWidth={1.8} />
      </button>
```

- [ ] **Step 4: Wire `activate("git")` and render DiffView in `src/App.tsx`**

(a) Add the import:

```tsx
import { DiffView } from "./components/DiffView";
```

(b) Update `activate` (App.tsx ~135) to handle git as a main-area-only view:

```tsx
  function activate(view: "explorer" | "search" | "git") {
    if (view === "git") {
      setActiveView("git");
      setSidebarVisible(false);
      return;
    }
    if (activeView === view && sidebarVisible) {
      setSidebarVisible(false);
    } else {
      setActiveView(view);
      setSidebarVisible(true);
    }
  }
```

(c) In the main column, keep the editor subtree mounted but hidden when git is active, and render DiffView alongside. Replace the editor column `<div className="flex-1 min-w-0 flex flex-col bg-bg-2">…</div>` (App.tsx ~223-263) so its inner content is wrapped:

```tsx
      <div className="flex-1 min-w-0 flex flex-col bg-bg-2">
        <div className={activeView === "git" ? "hidden" : "flex flex-col flex-1 min-h-0"}>
          <TabBar
            tabs={tabs}
            activePath={activeTabPath}
            onSelect={setActive}
            onClose={handleClose}
          />
          {notice && (
            <div className="flex items-start gap-3 m-2 rounded-[11px] border border-bd-1 bg-bg-1 px-3.5 py-3 text-tx-bright text-[12.5px]">
              <InfoIcon size={16} strokeWidth={1.8} className="text-accent shrink-0 mt-px" />
              <span>{notice}</span>
            </div>
          )}
          {activeTab ? (
            <EditorPane
              activePath={activeTab.path}
              openPaths={openPaths}
              languageId={activeTab.languageId}
              initialDoc={docs[activeTab.path] ?? ""}
              onChange={() => setDirty(activeTab.path, true)}
              onSave={(doc) => handleSave(activeTab.path, doc)}
              onPersist={persistDoc}
              onCursorChange={setCursor}
              reveal={reveal && reveal.path === activeTab.path ? reveal : undefined}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-center">
              <div className="w-10 h-10 rounded-[11px] bg-bg-3 text-tx-faint flex items-center justify-center">
                <FileIcon size={20} />
              </div>
              <div className="text-[13.5px] text-tx-bright font-medium">No file open</div>
              <div className="text-xs text-tx-3">
                Select a file in the explorer to start editing
              </div>
            </div>
          )}
          <StatusBar
            path={activeTab ? (root ? relativePath(root, activeTab.path) : activeTab.path) : null}
            languageId={activeTab?.languageId ?? null}
          />
        </div>
        <div className={activeView === "git" ? "flex flex-col flex-1 min-h-0" : "hidden"}>
          <DiffView root={root} active={activeView === "git"} />
        </div>
      </div>
```

Note: EditorPane is NOT unmounted when git is active — only hidden via the wrapper's `hidden` class — so the persistent EditorView and its per-path EditorState cache survive.

- [ ] **Step 5: Run the full frontend suite + build**

Run: `npx vitest run`
Expected: PASS — all prior tests plus the new gitStore (2) and DiffView (5). If `App.test.tsx` fails because the mounted `DiffView` triggers a `git_changes` invoke, note that DiffView only calls `load` when `active` is true and the default `activeView` is `"explorer"` (active=false), so no invoke fires on startup; investigate any failure rather than deleting tests.

Run: `npm run build`
Expected: `tsc && vite build` succeed.

- [ ] **Step 6: Commit**

```bash
git add src/store/workspaceStore.ts src/components/icons.tsx src/components/ActivityBar.tsx src/App.tsx
git commit -m "feat(frontend): wire git diff view into the activity bar

- activeView에 git 추가, Source Control 아이콘(메인영역 전용 하이라이트)
- git 뷰 활성 시 에디터 서브트리는 hidden 토글(영속 EditorView 보존)하고 DiffView 표시"
```

---

## Task 6: Manual verification

**Files:** none (manual QA)

- [ ] **Step 1: Launch the app in a real git repo**

Run: `npm run tauri dev`, open a folder that is a git repo with uncommitted changes.

- [ ] **Step 2: Verify behaviors**

- Click the Source Control (git) icon → main area shows the continuous diff; sidebar is hidden; icon highlighted.
- Modified / added (staged) / deleted / renamed / untracked files all appear with correct badge and ± counts; lines show both gutters and red/green backgrounds.
- A binary file shows "Binary file not shown"; a large untracked file shows "File too large to display".
- Collapsing a file header hides its lines; expanding restores them.
- Refresh button re-reads after you edit+save a file (switch to editor, edit, save, back to git, Refresh).
- Large diff scrolls smoothly (virtualization).
- Switch git → Explorer and open/edit a file: the editor still has its previous undo history / cursor / scroll for already-open tabs (persistent EditorView preserved, not remounted).
- Open a non-git folder → "Not a Git repository"; a clean repo → "No changes".

- [ ] **Step 3: (No commit)** — manual only. If fixes are needed, commit them referencing the observed defect.

---

## Self-Review Notes

- **Spec coverage:** §2 backend (Tasks 1-2), §3.1-3.5 git invocation/parser/data/errors (Tasks 1-2, incl. unborn-HEAD via `has_head`/`symbolic-ref`, untracked synth, binary/too_large), §4.1 api/types (Task 3), §4.2 activeView/ActivityBar/hidden-toggle (Task 5), §4.3 gitStore (Task 3), §4.4 DiffView rows/virtualization/states (Task 4), §4.5 load-on-entry + refresh (Task 4 effect + button), §5 edge cases (Tasks 2/4: not-repo, no-changes, binary, too-large, deleted, renamed, mode-only via parser), §6 tests (Tasks 1-4 + Task 6 manual), §7 file changes (all tasks). The "staged-add + working-delete" known limitation needs no code (documented in spec §5).
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** Rust `GitChanges/FileDiff/Hunk/DiffLine` (snake_case fields `is_repo/old_path/old_no/new_no/too_large`) match the TS interfaces in Task 3 and DiffView's usage in Task 4. `compute_changes`/`parse_diff`/`detect_file`/`git_changes` names are consistent across Tasks 1, 2, 5. `useGitStore` `{changes,loading,error,load}` consistent across Tasks 3-4. `activate` signature updated to include `"git"` matches ActivityBar's `onActivate`/`View` (Task 5).
