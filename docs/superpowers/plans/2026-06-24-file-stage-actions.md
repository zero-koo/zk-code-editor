# 파일 단위 Stage / Unstage / Discard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** diff 뷰 섹션 행에서 파일 단위로 git 변경을 stage / unstage / discard 한다.

**Architecture:** 단일 백엔드 명령 `git_file_action(root, path, action)`이 action에 따라 `git add` / `git restore --staged`(HEAD 없으면 `git rm --cached`) / discard(tracked는 `git restore`, untracked는 워킹트리 파일 삭제)를 수행한다. discard 삭제는 기존 `workspace::resolve_in_workspace`로 경로를 검증한다. 프론트는 "Staged"/"Unstaged" 섹션 행에 버튼을 달고, 액션 후 `gitStore.load(root)`로 단방향 갱신한다. 읽기 전용 다음 단계 — 헌크 단위는 별도 sub-project.

**Tech Stack:** Rust(Tauri v2, `std::process::Command`), TypeScript/React, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-file-stage-actions-design.md`

**테스트 명령 (반복):**
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml`
- 프론트: `npm test` (단일 파일: `npm test -- <path>`)
- 타입 체크: `npx tsc --noEmit`

---

## Task 1: 백엔드 — `git_file_action` 명령 + 순수 로직 + 테스트

**Files:**
- Modify: `src-tauri/src/git.rs` (import `1-5`, 명령 추가, `mod tests`에 테스트 추가)
- Modify: `src-tauri/src/lib.rs` (`generate_handler!` `15-27`에 등록)

**배경:** `git.rs`는 현재 `use serde::Serialize;`만 import. `is_inside_repo`(`226`), `has_head`(`253`), `git_output`(`217`)가 이미 있다. 경로 검증은 `crate::workspace::resolve_in_workspace(root: &Path, candidate: &str) -> Result<PathBuf, AppError>` (lexical normalize + `starts_with`, 위반 시 `ErrorCode::OutsideWorkspace`). `AppError { pub code: ErrorCode, pub message }`, `ErrorCode`는 `PartialEq` 파생.

- [ ] **Step 1: serde import에 Deserialize 추가**

`src-tauri/src/git.rs:3`의 `use serde::Serialize;`를 교체:
```rust
use serde::{Deserialize, Serialize};
```

- [ ] **Step 2: workspace import 추가**

`src-tauri/src/git.rs` 상단 import 블록(`1-5`, `use std::process::Command;` 아래)에 추가:
```rust
use crate::workspace::resolve_in_workspace;
```

- [ ] **Step 3: `FileAction` enum + 헬퍼 + 순수 로직 + 명령 추가**

`src-tauri/src/git.rs`의 기존 `git_changes` 명령 정의(`#[tauri::command] pub async fn git_changes` 블록, `439-444` — `list_worktrees`(446~) 직전) **뒤에** 추가:
```rust
#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FileAction {
    Stage,
    Unstage,
    Discard,
}

/// Runs a git mutation command, mapping a non-zero exit to an AppError that
/// carries git's stderr.
fn run_git(root: &str, args: &[&str]) -> Result<(), AppError> {
    let out = git_output(root, args)?;
    if out.status.success() {
        Ok(())
    } else {
        let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = if msg.is_empty() { format!("git {args:?} failed") } else { msg };
        Err(AppError::new(ErrorCode::Io, msg))
    }
}

/// True when `path` is tracked (present in the index). Untracked → false.
fn is_tracked(root: &str, path: &str) -> bool {
    git_output(root, &["ls-files", "--error-unmatch", "--", path])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Applies a stage / unstage / discard action to a single file path
/// (root-relative, as reported by `compute_changes`). See spec §2.2.
pub fn file_action(root: &str, path: &str, action: &FileAction) -> Result<(), AppError> {
    if !is_inside_repo(root) {
        return Err(AppError::new(ErrorCode::Io, "not a git repository".to_string()));
    }
    match action {
        // `add` records untracked adds, modifications, and worktree deletions.
        FileAction::Stage => run_git(root, &["add", "--", path]),
        FileAction::Unstage => {
            if has_head(root) {
                run_git(root, &["restore", "--staged", "--", path])
            } else {
                // No HEAD yet (pre-first-commit): drop from the index instead.
                run_git(root, &["rm", "--cached", "--", path])
            }
        }
        FileAction::Discard => {
            if is_tracked(root, path) {
                // restore worktree <- index (default source); staged changes preserved.
                run_git(root, &["restore", "--", path])
            } else {
                // Untracked: delete the worktree file, guarded by the workspace check.
                let abs = Path::new(root).join(path);
                let abs_str = abs
                    .to_str()
                    .ok_or_else(|| AppError::new(ErrorCode::Io, "invalid path".to_string()))?;
                let safe = resolve_in_workspace(Path::new(root), abs_str)?;
                std::fs::remove_file(&safe).map_err(AppError::from)
            }
        }
    }
}

#[tauri::command]
pub async fn git_file_action(root: String, path: String, action: FileAction) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || file_action(&root, &path, &action))
        .await
        .map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))?
}
```

- [ ] **Step 4: 명령 등록**

`src-tauri/src/lib.rs:26`의 `git::git_worktrees,` 뒤에 추가:
```rust
            git::git_file_action,
```

- [ ] **Step 5: 컴파일 확인**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: 컴파일 성공 (경고 가능, 에러 없음).

- [ ] **Step 6: 테스트 헬퍼 `init_repo` 추가**

`src-tauri/src/git.rs`의 `mod tests` 안, 기존 `fn git(...)` 헬퍼 **아래**에 추가(신규 테스트 전용 DRY 헬퍼):
```rust
    fn init_repo(dir: &std::path::Path) {
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
    }
```

- [ ] **Step 7: stage / unstage 테스트 추가**

`mod tests` 안에 추가:
```rust
    #[test]
    fn file_action_stages_untracked_file() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        std::fs::write(dir.join("base.txt"), "x\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        std::fs::write(dir.join("u.txt"), "new\n").unwrap();

        file_action(dir.to_str().unwrap(), "u.txt", &FileAction::Stage).unwrap();
        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        let s = changes.staged.iter().find(|f| f.path == "u.txt").unwrap();
        assert_eq!(s.status, "added");
        assert!(changes.unstaged.iter().all(|f| f.path != "u.txt"));
    }

    #[test]
    fn file_action_unstages_with_head() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        git(dir, &["add", "a.txt"]); // staged

        file_action(dir.to_str().unwrap(), "a.txt", &FileAction::Unstage).unwrap();
        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        assert!(changes.staged.iter().all(|f| f.path != "a.txt"));
        assert!(changes.unstaged.iter().any(|f| f.path == "a.txt" && f.status == "modified"));
    }

    #[test]
    fn file_action_unstage_without_head_uses_rm_cached() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir); // no commit → no HEAD
        std::fs::write(dir.join("n.txt"), "hi\n").unwrap();
        git(dir, &["add", "n.txt"]); // staged-new, pre-first-commit

        file_action(dir.to_str().unwrap(), "n.txt", &FileAction::Unstage).unwrap();
        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        assert!(changes.staged.is_empty()); // compute_changes skips --cached without HEAD
        assert!(changes.unstaged.iter().any(|f| f.path == "n.txt" && f.status == "untracked"));
        assert!(dir.join("n.txt").exists()); // file stays on disk
    }
```

- [ ] **Step 8: 실행**

Run: `cargo test --manifest-path src-tauri/Cargo.toml file_action`
Expected: PASS (위 3개)

- [ ] **Step 9: discard 테스트 추가 (tracked / untracked / partial-staging)**

`mod tests` 안에 추가:
```rust
    #[test]
    fn file_action_discards_tracked_modification() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        std::fs::write(dir.join("a.txt"), "two\n").unwrap(); // unstaged modification

        file_action(dir.to_str().unwrap(), "a.txt", &FileAction::Discard).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "one\n");
        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        assert!(changes.unstaged.iter().all(|f| f.path != "a.txt"));
    }

    #[test]
    fn file_action_discards_untracked_by_deleting() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        std::fs::write(dir.join("base.txt"), "x\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        std::fs::write(dir.join("u.txt"), "junk\n").unwrap();
        assert!(dir.join("u.txt").exists());

        file_action(dir.to_str().unwrap(), "u.txt", &FileAction::Discard).unwrap();
        assert!(!dir.join("u.txt").exists());
    }

    #[test]
    fn file_action_discard_preserves_staged_modification() {
        // Discard restores worktree <- index (NOT HEAD): staged change is kept.
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        std::fs::write(dir.join("a.txt"), "v1\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        std::fs::write(dir.join("a.txt"), "v2\n").unwrap();
        git(dir, &["add", "a.txt"]); // staged: v1 -> v2
        std::fs::write(dir.join("a.txt"), "v3\n").unwrap(); // unstaged: v2 -> v3

        file_action(dir.to_str().unwrap(), "a.txt", &FileAction::Discard).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "v2\n"); // index, not HEAD
        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        assert!(changes.staged.iter().any(|f| f.path == "a.txt"));
        assert!(changes.unstaged.iter().all(|f| f.path != "a.txt"));
    }

    #[test]
    fn file_action_discard_on_partially_staged_add_keeps_file() {
        // AM: staged-add then further worktree edit. Discard reverts the worktree
        // to the staged-add content; the file is NOT deleted and stays staged.
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        std::fs::write(dir.join("base.txt"), "x\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        std::fs::write(dir.join("n.txt"), "staged\n").unwrap();
        git(dir, &["add", "n.txt"]); // staged add
        std::fs::write(dir.join("n.txt"), "worktree\n").unwrap(); // further unstaged edit (AM)

        file_action(dir.to_str().unwrap(), "n.txt", &FileAction::Discard).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("n.txt")).unwrap(), "staged\n");
        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        assert!(changes.staged.iter().any(|f| f.path == "n.txt" && f.status == "added"));
        assert!(changes.unstaged.iter().all(|f| f.path != "n.txt"));
    }
```

- [ ] **Step 10: 실행**

Run: `cargo test --manifest-path src-tauri/Cargo.toml file_action_discard`
Expected: PASS (위 4개)

- [ ] **Step 11: 경로 탈출 / 비-저장소 테스트 추가**

`mod tests` 안에 추가:
```rust
    #[test]
    fn file_action_discard_rejects_path_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        init_repo(dir);
        std::fs::write(dir.join("base.txt"), "x\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);

        // "../escape.txt" is not tracked → delete branch → workspace guard rejects.
        let err = file_action(dir.to_str().unwrap(), "../escape.txt", &FileAction::Discard).unwrap_err();
        assert_eq!(err.code, ErrorCode::OutsideWorkspace);
    }

    #[test]
    fn file_action_on_non_repo_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let err = file_action(tmp.path().to_str().unwrap(), "a.txt", &FileAction::Stage).unwrap_err();
        assert_eq!(err.code, ErrorCode::Io);
    }
```

- [ ] **Step 12: 전체 Rust 테스트**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (전부)

- [ ] **Step 13: 커밋**

```bash
git add src-tauri/src/git.rs src-tauri/src/lib.rs
git commit -m "feat(git): add git_file_action for stage/unstage/discard

- single command dispatches stage (git add), unstage (restore --staged or
  rm --cached without HEAD), discard (restore, or delete for untracked)
- discard restores worktree from index so staged changes are preserved
- guard untracked discard delete with workspace::resolve_in_workspace
- tests: stage, unstage with/without HEAD, discard tracked/untracked,
  partial-staging discard, path escape, non-repo"
```

---

## Task 2: 프론트 — `gitFileAction` API + 타입

**Files:**
- Modify: `src/api/types.ts` (`FileAction` 타입 추가)
- Modify: `src/api/git.ts` (`gitFileAction` 추가)
- Create: `src/api/git.test.ts`

**배경:** `src/api/git.ts`는 `invoke`로 `git_changes`/`git_worktrees`를 호출한다. 같은 패턴으로 `gitFileAction` 추가. 추가만 하므로 기존 코드 안 깨짐.

- [ ] **Step 1: 실패 테스트 작성**

Create `src/api/git.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { gitFileAction } from "./git";

describe("gitFileAction", () => {
  beforeEach(() => invoke.mockReset());

  it("invokes git_file_action with root, path, and action", async () => {
    invoke.mockResolvedValue(undefined);
    await gitFileAction("/repo", "src/a.ts", "stage");
    expect(invoke).toHaveBeenCalledWith("git_file_action", {
      root: "/repo",
      path: "src/a.ts",
      action: "stage",
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/api/git.test.ts`
Expected: FAIL — `gitFileAction` export 없음.

- [ ] **Step 3: 타입 추가**

`src/api/types.ts` 끝(마지막 `interface` 뒤)에 추가:
```ts
export type FileAction = "stage" | "unstage" | "discard";
```

- [ ] **Step 4: API 함수 추가**

`src/api/git.ts`에 추가 — 먼저 import에 `FileAction` 포함(현재 `import type { GitChanges, Worktree } from "./types";`):
```ts
import type { GitChanges, Worktree, FileAction } from "./types";
```
파일 끝에 추가:
```ts
export const gitFileAction = (root: string, path: string, action: FileAction) =>
  invoke<void>("git_file_action", { root, path, action });
```

- [ ] **Step 5: 통과 확인**

Run: `npm test -- src/api/git.test.ts`
Expected: PASS

- [ ] **Step 6: 타입 체크**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/api/types.ts src/api/git.ts src/api/git.test.ts
git commit -m "feat(api): add gitFileAction wrapper and FileAction type

- gitFileAction(root, path, action) invokes git_file_action
- FileAction = stage | unstage | discard"
```

---

## Task 3: 프론트 — DiffView 섹션 액션 버튼 + 핸들러

**Files:**
- Modify: `src/components/DiffView.tsx` (import `1-9`, `Row` `16-21`, 행 빌드 `129-148`, headerBar `163-175`, `renderRow` 호출 `200` + 정의 `263`, `section` 분기 `278-284`)
- Modify: `src/components/DiffView.test.tsx` (mock 블록, 액션 테스트 추가)

**배경:** `section` Row는 현재 `{ kind:"section"; label }`. 행 빌드 루프(`129-148`)에서 `mf.path`·`mf.unstaged?.status`가 스코프에 있다. `renderRow(row, toggle, expand)`는 `200`에서 호출. discard는 `window.confirm` 사용(앱 내 기존 사용처 있음). 에러는 DiffView-로컬 `actionError` state(인라인), `gitStore.error`(전체화면)와 분리. in-flight는 전역 `busy` 플래그.

- [ ] **Step 1: import에 gitFileAction / FileAction 추가**

`src/components/DiffView.tsx`의 import 블록(`1-9`)에 추가:
```tsx
import { gitFileAction } from "../api/git";
import type { FileAction } from "../api/types";
```

- [ ] **Step 2: `section` Row에 path/isUntracked 추가**

`Row` 타입(`16-21`)의 `section` 줄을 교체:
```tsx
  | { kind: "section"; label: "Staged" | "Unstaged"; path: string; isUntracked: boolean }
```

- [ ] **Step 3: busy / actionError state + onAction 핸들러 추가**

`DiffView` 컴포넌트 본문에서 기존 `const [expanded, setExpanded] = ...`(`40`) **아래**에 추가:
```tsx
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
```
그리고 `expand` 함수(`60-70`) **아래**에 추가:
```tsx
  async function onAction(path: string, action: FileAction, isUntracked: boolean) {
    if (!root) return;
    if (action === "discard") {
      const msg = isUntracked
        ? `Delete untracked file ${path}? This cannot be undone.`
        : `Discard changes to ${path}? This cannot be undone.`;
      if (!window.confirm(msg)) return;
    }
    setActionError(null);
    setBusy(true);
    try {
      await gitFileAction(root, path, action);
    } catch (e) {
      const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      setActionError(m);
    } finally {
      await load(root);
      setBusy(false);
    }
  }
```

- [ ] **Step 4: 행 빌드 — section Row에 path/isUntracked 전달**

행 빌드 루프(`138-147`)의 두 `rows.push({ kind: "section", label: ... })`를 교체:
```tsx
    if (mf.staged) {
      rows.push({ kind: "section", label: "Staged", path: mf.path, isUntracked: false });
      top += ROW_H.section;
      emitBody(mf.staged, "s", mf.path);
    }
    if (mf.unstaged) {
      rows.push({ kind: "section", label: "Unstaged", path: mf.path, isUntracked: mf.unstaged.status === "untracked" });
      top += ROW_H.section;
      emitBody(mf.unstaged, "u", mf.path);
    }
```

- [ ] **Step 5: headerBar에 actionError 인라인 표시**

headerBar(`163-175`)의 `<span className="flex-1" />` **앞**에 추가:
```tsx
      {actionError && <span data-testid="diff-action-error" className="text-[11.5px] text-red-400 truncate">{actionError}</span>}
```

- [ ] **Step 6: renderRow 호출에 onAction/busy 전달**

`renderRow(row, toggle, expand)` 호출(`200`)을 교체:
```tsx
                  {renderRow(row, toggle, expand, onAction, busy)}
```

- [ ] **Step 7: renderRow 시그니처 + section 분기 교체**

`renderRow` 정의(`263`)의 시그니처를 교체:
```tsx
function renderRow(
  row: Row,
  toggle: (path: string) => void,
  expand: (gapKey: string, dir: "up" | "down") => void,
  onAction: (path: string, action: FileAction, isUntracked: boolean) => void,
  busy: boolean
) {
```
그리고 `section` 분기(`278-284`)를 교체:
```tsx
  if (row.kind === "section") {
    const btn = "text-[10.5px] px-1.5 py-0.5 rounded text-tx-2 hover:bg-white/10 hover:text-tx-bright disabled:opacity-40 disabled:hover:bg-transparent";
    return (
      <div className="h-6 flex items-center gap-2 px-3 text-[11px] font-medium uppercase tracking-wide text-tx-3 bg-bg-2 border-b border-bd-2">
        <span className="flex-1">{row.label}</span>
        {row.label === "Staged" ? (
          <button disabled={busy} onClick={() => onAction(row.path, "unstage", row.isUntracked)} className={btn}>Unstage</button>
        ) : (
          <>
            <button disabled={busy} onClick={() => onAction(row.path, "stage", row.isUntracked)} className={btn}>Stage</button>
            <button disabled={busy} onClick={() => onAction(row.path, "discard", row.isUntracked)} className={btn}>Discard</button>
          </>
        )}
      </div>
    );
  }
```

- [ ] **Step 8: 타입 체크**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: 기존 테스트가 깨지지 않는지 확인**

Run: `npm test -- src/components/DiffView.test.tsx`
Expected: PASS (기존 테스트는 섹션에 버튼이 추가됐을 뿐, 기존 단언에 영향 없음)

- [ ] **Step 10: 테스트 mock에 gitFileAction 추가**

`src/components/DiffView.test.tsx`의 mock 블록(현재 `const gitChanges = vi.fn(); vi.mock("../api/git", () => ({ gitChanges: ... }));`)을 교체:
```tsx
const gitChanges = vi.fn();
const gitFileAction = vi.fn();
vi.mock("../api/git", () => ({
  gitChanges: (...a: unknown[]) => gitChanges(...a),
  gitFileAction: (...a: unknown[]) => gitFileAction(...a),
}));
```
그리고 `beforeEach`의 `gitChanges.mockReset();` 옆에 추가:
```tsx
  gitFileAction.mockReset();
  gitFileAction.mockResolvedValue(undefined);
```

`waitFor`를 `@testing-library/react` import에 추가(현재 `render, screen, within`):
```tsx
import { render, screen, within, waitFor } from "@testing-library/react";
```

- [ ] **Step 11: 액션 버튼 렌더 + 호출 테스트 추가**

`describe("DiffView", ...)` 안에 추가:
```tsx
  it("renders Unstage on the Staged section and Stage/Discard on Unstaged", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "s\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "s" }] }] },
      ],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    expect(screen.getByRole("button", { name: "Unstage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("stages a file and reloads when Stage is clicked", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    const callsBefore = gitChanges.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Stage" }));
    await waitFor(() => expect(gitFileAction).toHaveBeenCalledWith("/repo", "a.ts", "stage"));
    await waitFor(() => expect(gitChanges.mock.calls.length).toBeGreaterThan(callsBefore)); // reloaded
  });

  it("discards only after the user confirms", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(gitFileAction).not.toHaveBeenCalled(); // cancelled

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(gitFileAction).toHaveBeenCalledWith("/repo", "a.ts", "discard"));
    confirmSpy.mockRestore();
  });

  it("shows an inline error when an action fails", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    gitFileAction.mockRejectedValue({ code: "io", message: "git add boom" });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    await userEvent.click(screen.getByRole("button", { name: "Stage" }));
    expect(await screen.findByTestId("diff-action-error")).toHaveTextContent("git add boom");
  });
```

- [ ] **Step 12: in-flight disabled 테스트 추가**

`describe("DiffView", ...)` 안에 추가(미해결 프로미스로 busy 상태 고정):
```tsx
  it("disables section buttons while an action is in flight", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "u\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "u" }] }] },
      ],
    });
    let release: () => void = () => {};
    gitFileAction.mockImplementation(() => new Promise<void>((res) => { release = res; }));
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    await userEvent.click(screen.getByRole("button", { name: "Stage" }));
    // action promise still pending → buttons disabled
    expect(screen.getByRole("button", { name: "Stage" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    release(); // let it settle (load runs with the mocked gitChanges)
    await waitFor(() => expect(screen.getByRole("button", { name: "Stage" })).not.toBeDisabled());
  });
```

- [ ] **Step 13: 전체 테스트 + 타입 체크**

Run: `npm test && npx tsc --noEmit`
Expected: PASS (신규 5개 포함, 타입 에러 없음)

- [ ] **Step 14: 커밋**

```bash
git add src/components/DiffView.tsx src/components/DiffView.test.tsx
git commit -m "feat(frontend): add stage/unstage/discard buttons to diff sections

- Unstage on the Staged section; Stage and Discard on the Unstaged section
- discard confirms first (delete wording for untracked); reload after each action
- global in-flight flag disables buttons during an action
- inline actionError (separate from the full-screen gitStore error)
- tests for rendering, stage call, confirm gating, error, and disabled state"
```

---

## Self-Review

**1. Spec coverage:**
- §2.1 `FileAction` enum + `git_file_action` 명령 → Task 1 Step 3. ✓
- §2.2 stage(`add`)·unstage(`restore --staged`/no-HEAD `rm --cached`)·discard(tracked `restore`/untracked 삭제) + §2.2.1 AM 동작 → Task 1 Step 3, 테스트 Step 7·9. ✓
- §2.3 `resolve_in_workspace` 재사용 경로 검증 → Task 1 Step 3(discard 분기), 테스트 Step 11. ✓
- §2.4 `run_git` 헬퍼·기존 헬퍼 재사용 → Task 1 Step 3. ✓
- §3.1 `FileAction` 타입·`gitFileAction` → Task 2. ✓
- §3.2 액션 후 `load(root)`·전역 in-flight → Task 3 Step 3, 테스트 Step 11·12. ✓
- §3.3 DiffView-로컬 `actionError` 인라인·`gitStore.error`와 분리 → Task 3 Step 3·5, 테스트 Step 11. ✓
- §4.1 section Row path/isUntracked → Task 3 Step 2·4. ✓
- §4.2 섹션 버튼 배치(Staged→Unstage, Unstaged→Stage/Discard)·disabled → Task 3 Step 7. ✓
- §4.3 onAction(confirm 분기·문구·try/finally load) → Task 3 Step 3. ✓
- §5 데이터 흐름(단방향 재로드) → Task 3 Step 3. ✓
- §6 엣지(no-HEAD·discard staged 보존·untracked 삭제·경로 탈출·비-저장소) → Task 1 테스트 Step 7·9·11. ✓
- lib.rs 등록 → Task 1 Step 4. ✓

**2. Placeholder scan:** 모든 단계에 실제 코드/명령/기대결과. 플레이스홀더 없음. ✓

**3. Type consistency:** `FileAction`(TS union "stage"|"unstage"|"discard") ↔ Rust `FileAction` enum `rename_all="lowercase"` 매핑 일치. `gitFileAction(root, path, action)` 시그니처가 Task 2 정의·Task 3 호출(`onAction`)·테스트 단언에서 동일. `onAction(path, action, isUntracked)` 시그니처가 Step 3 정의·Step 7 호출에서 일치. section Row 필드(`path`, `isUntracked`)가 Step 2 타입·Step 4 생성·Step 7 사용에서 일치. `renderRow`의 5-인자 시그니처가 Step 6 호출·Step 7 정의에서 일치. ✓

---

## Execution Handoff

3개 태스크: 백엔드 명령+테스트 → TS API → DiffView 버튼/핸들러. Task 3은 Task 2의 `gitFileAction`에 의존하므로 순서대로. 각 태스크가 독립적으로 빌드·테스트 녹색.
