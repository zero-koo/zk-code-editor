# Staged / Unstaged 변경사항 구분 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Git diff 뷰를 staged(`git diff --cached`)와 unstaged(`git diff`) 변경으로 분리해, partial-staging 파일을 "Staged"/"Unstaged" 섹션 블록으로 보여준다.

**Architecture:** 백엔드 `compute_changes`가 두 diff를 각각 실행해 `GitChanges`의 `staged`/`unstaged` 두 배열로 반환한다. 각 FileDiff의 `new_text`/`old_text`는 스트림별로 다른 출처(HEAD / index / 파일시스템)에서 채운다. 프론트엔드는 순수 헬퍼 `mergeFiles`로 path 기준 머지해 단일 파일 목록을 만들고, DiffView가 파일당 staged·unstaged 섹션을 세로로 렌더한다. 이번엔 읽기 전용(stage/unstage 액션은 후속).

**Tech Stack:** Rust(Tauri v2, `std::process::Command`로 git 호출), TypeScript/React, Zustand, Vitest, @tanstack/react-virtual.

**Spec:** `docs/superpowers/specs/2026-06-24-staged-unstaged-diff-design.md`

**테스트 명령 (반복 사용):**
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml`
- 프론트 단위/컴포넌트: `npm test`
- 타입 체크: `npx tsc --noEmit`

---

## Task 1: 백엔드 — `GitChanges` staged/unstaged 분리 + 스트림별 텍스트 출처

**Files:**
- Modify: `src-tauri/src/git.rs` (구조체 `35-40`, `compute_changes` `339-391`, 기존 테스트 `442-508`)

**배경:** 현재 `compute_changes`는 `git diff HEAD` 1회로 staged·unstaged를 합쳐 `files`에 담고, 첨부 텍스트는 modified/added→파일시스템·deleted/renamed→`git show HEAD:`로 채운다(`368-384`). 이를 두 스트림으로 나누고, 스트림별로 §2.3 표대로 텍스트 출처를 바꾼다.

| 구분 | `old_text` | `new_text` |
|---|---|---|
| staged | HEAD (`git show HEAD:<old_path 또는 path>`) | index (`git show :<path>`) |
| unstaged | index (`git show :<old_path 또는 path>`) | 파일시스템 |
| untracked | `null` | 파일시스템 |

- [ ] **Step 1: 기존 테스트 fixture를 새 구조로 갱신 (먼저 실패 상태 만들기)**

`src-tauri/src/git.rs`의 기존 3개 테스트에서 `changes.files`를 스트림 접근으로 바꾼다. `compute_changes_reports_modified_and_untracked`(`460-470`)·`compute_changes_includes_file_contents`(`489-500`)는 모두 unstaged(스테이징 안 함)이므로 `changes.unstaged`로, `compute_changes_on_non_repo`(`503-508`)는 양쪽 비어있음으로 바꾼다.

`compute_changes_reports_modified_and_untracked` 본문의 assert 블록을 교체:
```rust
        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        assert!(changes.is_repo);
        let modified = changes.unstaged.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(modified.status, "modified");
        assert_eq!(modified.additions, 1);
        assert_eq!(modified.deletions, 1);
        let untracked = changes.unstaged.iter().find(|f| f.path == "u.txt").unwrap();
        assert_eq!(untracked.status, "untracked");
        assert_eq!(untracked.additions, 2);
        assert!(!untracked.hunks.is_empty());
```

`compute_changes_includes_file_contents` 본문의 assert 블록을 교체(unstaged의 old_text는 index판이지만, 스테이징하지 않았으므로 index==HEAD이라 값은 동일):
```rust
        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        let a = changes.unstaged.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(a.new_text.as_deref(), Some("one\nTWO\n"));
        assert_eq!(a.old_text.as_deref(), Some("one\ntwo\n"));
        let gone = changes.unstaged.iter().find(|f| f.path == "gone.txt").unwrap();
        assert_eq!(gone.status, "deleted");
        assert_eq!(gone.new_text, None);
        assert_eq!(gone.old_text.as_deref(), Some("bye\n"));
        let u = changes.unstaged.iter().find(|f| f.path == "u.txt").unwrap();
        assert_eq!(u.new_text.as_deref(), Some("new\n"));
        assert_eq!(u.old_text, None);
```

`compute_changes_on_non_repo` 본문을 교체:
```rust
        let changes = compute_changes(tmp.path().to_str().unwrap()).unwrap();
        assert!(!changes.is_repo);
        assert!(changes.staged.is_empty());
        assert!(changes.unstaged.is_empty());
```

- [ ] **Step 2: 빌드 실패 확인**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 컴파일 에러 — `GitChanges`에 `staged`/`unstaged`/`files` 필드 불일치(아직 구조체·`compute_changes`가 `files` 기반).

- [ ] **Step 3: `GitChanges` 구조체 변경**

`src-tauri/src/git.rs:35-40`을 교체:
```rust
#[derive(Debug, Serialize, PartialEq)]
pub struct GitChanges {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub staged: Vec<FileDiff>,
    pub unstaged: Vec<FileDiff>,
}
```

- [ ] **Step 4: 스트림별 텍스트 첨부 헬퍼 추가**

`src-tauri/src/git.rs`의 `compute_changes` 함수 **바로 앞**(`339` 직전)에 추가:
```rust
#[derive(Clone, Copy)]
enum Stream {
    Staged,
    Unstaged,
}

/// Attaches `new_text`/`old_text` to each FileDiff per the staged/unstaged
/// source matrix (spec §2.3). Text-file content only; failures leave the field
/// as None (the frontend falls back to plain rendering).
fn attach_contents(root: &str, root_path: &Path, files: &mut [FileDiff], stream: Stream) {
    for f in files {
        // new side
        if f.status != "deleted" {
            match stream {
                // staged new side = index version at the (rename-to) path
                Stream::Staged => {
                    if let Ok(out) = git_output(root, &["show", &format!(":{}", f.path)]) {
                        if out.status.success() {
                            if let FileContent::Text(t) = classify_bytes(out.stdout) {
                                f.new_text = Some(t);
                            }
                        }
                    }
                }
                // unstaged new side = working-tree file
                Stream::Unstaged => {
                    if let Ok(FileContent::Text(t)) = detect_file(&root_path.join(&f.path)) {
                        f.new_text = Some(t);
                    }
                }
            }
        }
        // old side (skip for added/untracked: nothing precedes them)
        if f.status != "added" && f.status != "untracked" {
            // rename: HEAD/index hold the old path, so prefer old_path when set
            let r = f.old_path.clone().unwrap_or_else(|| f.path.clone());
            let spec = match stream {
                Stream::Staged => format!("HEAD:{r}"),
                Stream::Unstaged => format!(":{r}"),
            };
            if let Ok(out) = git_output(root, &["show", &spec]) {
                if out.status.success() {
                    if let FileContent::Text(t) = classify_bytes(out.stdout) {
                        f.old_text = Some(t);
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 5: `compute_changes` 본문 교체**

`src-tauri/src/git.rs:339-391`(`pub fn compute_changes` … 닫는 `}`)을 교체:
```rust
pub fn compute_changes(root: &str) -> Result<GitChanges, AppError> {
    if !is_inside_repo(root) {
        return Ok(GitChanges {
            is_repo: false,
            branch: None,
            staged: Vec::new(),
            unstaged: Vec::new(),
        });
    }
    let branch = current_branch(root);
    let root_path = Path::new(root);

    // staged: HEAD <-> index. Skipped without HEAD (matches prior behavior:
    // a fresh repo shows no staged stream).
    let mut staged: Vec<FileDiff> = Vec::new();
    if has_head(root) {
        let out = git_output(root, &["diff", "--cached", "--no-color", "-M"])?;
        if out.status.success() {
            staged.extend(parse_diff(&String::from_utf8_lossy(&out.stdout)));
        }
    }

    // unstaged: index <-> working tree, plus untracked files appended.
    let mut unstaged: Vec<FileDiff> = Vec::new();
    let out = git_output(root, &["diff", "--no-color", "-M"])?;
    if out.status.success() {
        unstaged.extend(parse_diff(&String::from_utf8_lossy(&out.stdout)));
    }
    let out = git_output(root, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    if out.status.success() {
        let raw = String::from_utf8_lossy(&out.stdout);
        for rel in raw.split('\0').filter(|s| !s.is_empty()) {
            unstaged.push(untracked_file_diff(root_path, rel));
        }
    }

    attach_contents(root, root_path, &mut staged, Stream::Staged);
    attach_contents(root, root_path, &mut unstaged, Stream::Unstaged);

    Ok(GitChanges {
        is_repo: true,
        branch,
        staged,
        unstaged,
    })
}
```

- [ ] **Step 6: 기존 테스트 통과 확인**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (Step 1에서 고친 3개 테스트 포함 전부 통과).

- [ ] **Step 7: partial-staging 분리 테스트 추가**

`src-tauri/src/git.rs`의 `mod tests` 안(예: `compute_changes_on_non_repo` 테스트 뒤)에 추가:
```rust
    #[test]
    fn compute_changes_separates_staged_and_unstaged() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        // stage one change, then make a further unstaged change to the same file
        std::fs::write(dir.join("a.txt"), "ONE\ntwo\n").unwrap();
        git(dir, &["add", "a.txt"]);
        std::fs::write(dir.join("a.txt"), "ONE\nTWO\n").unwrap();

        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        let staged = changes.staged.iter().find(|f| f.path == "a.txt").unwrap();
        let unstaged = changes.unstaged.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(staged.status, "modified");
        assert_eq!(unstaged.status, "modified");
        // staged: HEAD -> index
        assert_eq!(staged.old_text.as_deref(), Some("one\ntwo\n"));
        assert_eq!(staged.new_text.as_deref(), Some("ONE\ntwo\n"));
        // unstaged: index -> working tree
        assert_eq!(unstaged.old_text.as_deref(), Some("ONE\ntwo\n"));
        assert_eq!(unstaged.new_text.as_deref(), Some("ONE\nTWO\n"));
    }
```

- [ ] **Step 8: 테스트 실행 (통과 확인)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml compute_changes_separates_staged_and_unstaged`
Expected: PASS

- [ ] **Step 9: staged 신규 파일 테스트 추가**

`mod tests` 안에 추가:
```rust
    #[test]
    fn compute_changes_staged_new_file() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(dir.join("base.txt"), "x\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);
        std::fs::write(dir.join("new.txt"), "hi\n").unwrap();
        git(dir, &["add", "new.txt"]);

        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        let staged = changes.staged.iter().find(|f| f.path == "new.txt").unwrap();
        assert_eq!(staged.status, "added");
        assert_eq!(staged.new_text.as_deref(), Some("hi\n")); // index version
        assert_eq!(staged.old_text, None); // absent from HEAD
        assert!(changes.unstaged.iter().all(|f| f.path != "new.txt"));
    }
```

- [ ] **Step 10: HEAD 없는 repo 테스트 추가**

`mod tests` 안에 추가:
```rust
    #[test]
    fn compute_changes_headless_repo_has_no_staged() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(dir.join("u.txt"), "new\n").unwrap();

        let changes = compute_changes(dir.to_str().unwrap()).unwrap();
        assert!(changes.is_repo);
        assert!(changes.staged.is_empty());
        let u = changes.unstaged.iter().find(|f| f.path == "u.txt").unwrap();
        assert_eq!(u.status, "untracked");
    }
```

- [ ] **Step 11: 전체 Rust 테스트 통과 확인**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (기존 + 신규 3개 모두 통과)

- [ ] **Step 12: 커밋**

```bash
git add src-tauri/src/git.rs
git commit -m "feat(git): split compute_changes into staged and unstaged streams

- replace GitChanges.files with staged/unstaged Vec<FileDiff>
- run git diff --cached and git diff separately, append untracked to unstaged
- attach new_text/old_text per stream (HEAD/index/worktree) via attach_contents
- skip --cached without HEAD (fresh repo has no staged stream)
- add tests for partial staging, staged new file, headless repo"
```

---

## Task 2: 프론트 — `mergeFiles` 순수 헬퍼

**Files:**
- Create: `src/lib/mergeFiles.ts`
- Test: `src/lib/mergeFiles.test.ts`

**배경:** 백엔드가 주는 `staged`/`unstaged` 두 배열을 path 기준으로 머지해 단일 파일 목록(`MergedFile[]`)을 만든다. React/Tauri 비의존 순수 함수라 단위 테스트가 쉽다. `FileDiff` 타입(변경 없음)만 import.

- [ ] **Step 1: 실패 테스트 작성**

Create `src/lib/mergeFiles.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mergeFiles } from "./mergeFiles";
import type { FileDiff } from "../api/types";

const mk = (path: string, status: FileDiff["status"] = "modified"): FileDiff => ({
  path,
  old_path: null,
  status,
  additions: 0,
  deletions: 0,
  binary: false,
  too_large: false,
  new_text: null,
  old_text: null,
  hunks: [],
});

describe("mergeFiles", () => {
  it("keeps a staged-only file with unstaged null", () => {
    const m = mergeFiles([mk("a.ts")], []);
    expect(m).toHaveLength(1);
    expect(m[0].path).toBe("a.ts");
    expect(m[0].staged).not.toBeNull();
    expect(m[0].unstaged).toBeNull();
  });

  it("keeps an unstaged-only file with staged null", () => {
    const m = mergeFiles([], [mk("b.ts")]);
    expect(m[0].path).toBe("b.ts");
    expect(m[0].staged).toBeNull();
    expect(m[0].unstaged).not.toBeNull();
  });

  it("merges a file present in both streams", () => {
    const m = mergeFiles([mk("c.ts")], [mk("c.ts")]);
    expect(m).toHaveLength(1);
    expect(m[0].staged).not.toBeNull();
    expect(m[0].unstaged).not.toBeNull();
  });

  it("uses the staged status when present in both", () => {
    const m = mergeFiles([mk("d.ts", "added")], [mk("d.ts", "modified")]);
    expect(m[0].status).toBe("added");
  });

  it("orders staged files first, then unstaged-only files", () => {
    const m = mergeFiles([mk("s.ts")], [mk("s.ts"), mk("u.ts")]);
    expect(m.map((f) => f.path)).toEqual(["s.ts", "u.ts"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/mergeFiles.test.ts`
Expected: FAIL — `mergeFiles`/`./mergeFiles` 모듈 없음.

- [ ] **Step 3: 헬퍼 구현**

Create `src/lib/mergeFiles.ts`:
```ts
import type { FileDiff } from "../api/types";

export interface MergedFile {
  path: string;
  staged: FileDiff | null;
  unstaged: FileDiff | null;
  status: FileDiff["status"]; // staged 우선, 없으면 unstaged
}

/**
 * Merges staged and unstaged FileDiff lists into a single per-path list.
 * Staged files come first (in their order); unstaged-only files are appended.
 * A file present in both (partial staging) carries both diffs; its status is
 * taken from the staged side.
 */
export function mergeFiles(staged: FileDiff[], unstaged: FileDiff[]): MergedFile[] {
  const byPath = new Map<string, MergedFile>();
  const order: string[] = [];
  for (const f of staged) {
    byPath.set(f.path, { path: f.path, staged: f, unstaged: null, status: f.status });
    order.push(f.path);
  }
  for (const f of unstaged) {
    const existing = byPath.get(f.path);
    if (existing) {
      existing.unstaged = f;
    } else {
      byPath.set(f.path, { path: f.path, staged: null, unstaged: f, status: f.status });
      order.push(f.path);
    }
  }
  return order.map((p) => byPath.get(p)!);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/mergeFiles.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/mergeFiles.ts src/lib/mergeFiles.test.ts
git commit -m "feat(frontend): add mergeFiles helper for staged/unstaged merge

- merge two FileDiff streams by path into MergedFile[]
- staged first, unstaged-only appended; status prefers staged
- partial-staging files carry both diffs"
```

---

## Task 3: 프론트 — 타입 마이그레이션 + DiffView 섹션 렌더 + 소비자 갱신

**Files:**
- Modify: `src/api/types.ts` (`GitChanges` `82-86`)
- Modify: `src/store/gitStore.test.ts` (fixture `9`)
- Modify: `src/components/ActivityBar.tsx` (`gitCount` `15`)
- Modify: `src/components/ActivityBar.test.tsx` (fixture `59`, `67`)
- Modify: `src/components/DiffView.tsx` (Row 타입 `15-19`, `ROW_H` `21`, `STATUS_BADGE` 유지, 행 빌드 `70-127`, virtualizer/headerBar/body, `DiffFileList` `205-232`, `renderRow` `234-299`)
- Modify: `src/components/DiffView.test.tsx` (fixtures + 신규 테스트)

**배경(중요):** `GitChanges.files` 제거는 `types.ts`를 바꾸는 즉시 `ActivityBar.tsx:15`, `DiffView.tsx`(다수), 세 테스트 fixture를 동시에 깨뜨린다. 따라서 이 태스크는 **타입 변경과 모든 소비자 수정을 한 번에** 처리해 빌드를 녹색으로 되돌린다. 순수 TDD의 red→green이 어려운 구간(컴파일 에러가 여러 파일에 걸침)이므로, 편집을 모두 끝낸 뒤 전체 스위트를 녹색으로 확인하고, 신규 동작(섹션 라벨·S/U 배지·머지 카운트)에는 새 테스트를 추가한다.

`SearchPanel.tsx`의 `response.files`는 검색 결과(별개 타입)이므로 건드리지 않는다.

- [ ] **Step 1: `GitChanges` 타입 변경**

`src/api/types.ts:82-86`을 교체:
```ts
export interface GitChanges {
  is_repo: boolean;
  branch: string | null;
  staged: FileDiff[];
  unstaged: FileDiff[];
}
```

- [ ] **Step 2: gitStore 테스트 fixture 갱신**

`src/store/gitStore.test.ts:9`를 교체:
```ts
const empty: GitChanges = { is_repo: true, branch: "main", staged: [], unstaged: [] };
```

- [ ] **Step 3: ActivityBar 배지 카운트를 머지 파일 수로 변경**

`src/components/ActivityBar.tsx:15`을 교체(중복 path는 1개로 카운트):
```tsx
  const gitCount = useGitStore((s) => {
    const c = s.changes;
    if (!c) return 0;
    return new Set([...c.staged, ...c.unstaged].map((f) => f.path)).size;
  });
```

- [ ] **Step 4: ActivityBar 테스트 fixture + 카운트 검증 갱신**

`src/components/ActivityBar.test.tsx`의 배지 테스트 두 개(`57-71`)를 교체(머지 dedup 검증 포함 — 같은 path b가 양쪽에 있어도 3개):
```tsx
  it("shows a badge with the merged changed-file count on the git button", () => {
    useGitStore.setState({
      changes: {
        is_repo: true,
        branch: "main",
        staged: [mkFile("a"), mkFile("b")],
        unstaged: [mkFile("b"), mkFile("c")],
      },
    });
    render(<ActivityBar {...baseProps} />);
    const git = screen.getByRole("button", { name: /source control/i });
    expect(within(git).getByText("3")).toBeInTheDocument();
  });

  it("shows no badge when there are no changes", () => {
    useGitStore.setState({ changes: { is_repo: true, branch: "main", staged: [], unstaged: [] } });
    render(<ActivityBar {...baseProps} />);
    const git = screen.getByRole("button", { name: /source control/i });
    expect(within(git).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 5: DiffView — import 및 Row/ROW_H 변경**

`src/components/DiffView.tsx` 상단 import 블록(`1-8`)에 `mergeFiles`/`MergedFile` 추가. `import type { FileDiff }`는 유지:
```tsx
import { mergeFiles, type MergedFile } from "../lib/mergeFiles";
```

`Row` 타입(`15-19`)을 교체 — `file` 행은 이제 MergedFile에서 계산한 필드를 직접 들고, `section` 행을 추가:
```tsx
type Row =
  | { kind: "file"; path: string; oldPath: string | null; status: FileDiff["status"]; additions: number; deletions: number }
  | { kind: "section"; label: "Staged" | "Unstaged" }
  | { kind: "line"; lineKind: "context" | "add" | "del"; oldNo: number | null; newNo: number | null; text: string; langId: string; newText: string | null; oldText: string | null }
  | { kind: "info"; text: string }
  | { kind: "expander"; gapKey: string; canUp: boolean; canDown: boolean; remaining: number };
```

`ROW_H`(`21`)에 `section` 추가:
```tsx
const ROW_H: Record<Row["kind"], number> = { file: 34, section: 24, line: 20, info: 28, expander: 22 };
```

- [ ] **Step 6: DiffView — 행 빌드 루프 교체 (staged/unstaged 섹션)**

`src/components/DiffView.tsx`의 행 빌드 블록(`70-127`, `const rows: Row[] = [];` 부터 `if (changes) { … }` 닫는 `}`까지)을 교체:
```tsx
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
```

- [ ] **Step 7: DiffView — headerBar 카운트, body 빈 상태, DiffFileList props 교체**

`src/components/DiffView.tsx` headerBar의 파일 수 표기(`145`)를 교체:
```tsx
      <span className="text-tx-3">{changes ? `${merged.length} changed` : ""}</span>
```

body 분기의 "no changes" 조건(`163`)을 교체:
```tsx
  } else if (changes && merged.length === 0) {
```

body의 `DiffFileList` 호출(`168`)을 교체(머지 목록 전달):
```tsx
        <DiffFileList files={merged} activePath={activePath} onSelect={jumpTo} />
```

- [ ] **Step 8: DiffView — `DiffFileList`를 MergedFile + S/U 배지로 교체**

`src/components/DiffView.tsx`의 `DiffFileList`(`205-232`)를 교체:
```tsx
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
            {f.staged && <span title="Staged" className="text-[10px] font-medium text-emerald-400 shrink-0">S</span>}
            {f.unstaged && <span title="Unstaged" className="text-[10px] font-medium text-amber-400 shrink-0">U</span>}
            {additions > 0 && <span className="text-[10.5px] text-emerald-400 shrink-0">+{additions}</span>}
            {deletions > 0 && <span className="text-[10.5px] text-red-400 shrink-0">−{deletions}</span>}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 9: DiffView — `renderRow`의 `file` 행 교체 + `section` 행 추가**

`src/components/DiffView.tsx`의 `renderRow`(`234-`) 안 `file` 분기(`235-249`)를 교체:
```tsx
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
```

- [ ] **Step 10: 타입 체크 + 기존 테스트 fixture 마이그레이션**

먼저 타입 체크로 남은 깨짐을 확인:

Run: `npx tsc --noEmit`
Expected: `src/components/DiffView.test.tsx`가 `files`를 쓰는 부분에서 타입 에러(나머지 소스는 통과).

`src/components/DiffView.test.tsx`에서 모든 fixture의 `files: [...]`를 `staged`/`unstaged` 구조로 마이그레이션한다(기존 동작 보존: 모두 unstaged 스트림으로 옮기고 `staged: []` 추가):
- `sample`(`18-43`): `files:` → `staged: [],` + `unstaged:` 로 키 변경.
- `multi`(`48-56`): 동일하게 `staged: [], unstaged: [ … 3 files … ]`. 주석의 "pixel offset 152"(`45-46`)는 섹션 행(24px) 추가로 값이 틀려지므로 **수치 표현을 반드시 삭제**하고 "scrolls to a positive offset"로만 남긴다(오해 소지 제거).
- 인라인 mock 4곳: "shows a binary-file notice"(`82-86`) `files` → `staged: [], unstaged: [ … ]`; "not-a-repository"(`92`) `{ is_repo: false, branch: null, files: [] }` → `{ is_repo: false, branch: null, staged: [], unstaged: [] }`; "no-changes"(`98`) `files: []` → `staged: [], unstaged: []`; "syntax-highlights"(`113-130`) `files` → `staged: [], unstaged: [ … ]`; "reveals hidden context"(`149-176`) `files` → `staged: [], unstaged: [ … ]`; "shows no expander"(`186-202`) `files` → `staged: [], unstaged: [ … ]`.

- [ ] **Step 11: 타입 체크 통과 확인**

Run: `npx tsc --noEmit`
Expected: PASS (에러 없음)

- [ ] **Step 12: 기존 프론트 테스트 통과 확인**

Run: `npm test`
Expected: PASS (기존 DiffView/ActivityBar/gitStore 테스트가 새 구조에서 통과; mergeFiles 5개 포함)

- [ ] **Step 13: 신규 DiffView 테스트 추가 (섹션 + 배지)**

`src/components/DiffView.test.tsx`의 `describe("DiffView", …)` 안에 추가:
```tsx
  it("shows Staged and Unstaged sections for a partially staged file", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "staged\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "staged" }] }] },
      ],
      unstaged: [
        { path: "a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "unstaged\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "unstaged" }] }] },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    expect(screen.getByText("Staged")).toBeInTheDocument();
    expect(screen.getByText("Unstaged")).toBeInTheDocument();
  });

  it("shows only the Staged section for a staged-only file", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      staged: [
        { path: "a.ts", old_path: null, status: "added", additions: 1, deletions: 0, binary: false, too_large: false, new_text: "s\n", old_text: null, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ kind: "add", old_no: null, new_no: 1, text: "s" }] }] },
      ],
      unstaged: [],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    expect(screen.getByText("Staged")).toBeInTheDocument();
    expect(screen.queryByText("Unstaged")).not.toBeInTheDocument();
  });

  // NOTE: fixtures here must avoid untracked / "U"-status files. STATUS_BADGE.untracked
  // is "U", which would collide with the unstaged "U" badge and make getByText("U") ambiguous.
  it("badges a partially staged file with both S and U in the navigator", async () => {
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
    const nav = await screen.findByTestId("diff-file-list");
    expect(within(nav).getByText("S")).toBeInTheDocument();
    expect(within(nav).getByText("U")).toBeInTheDocument();
  });
```

- [ ] **Step 14: 전체 테스트 + 타입 체크 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: PASS (신규 3개 포함 전부 통과, 타입 에러 없음)

- [ ] **Step 15: 커밋**

```bash
git add src/api/types.ts src/store/gitStore.test.ts src/components/ActivityBar.tsx src/components/ActivityBar.test.tsx src/components/DiffView.tsx src/components/DiffView.test.tsx
git commit -m "feat(frontend): render staged and unstaged diff sections

- replace GitChanges.files with staged/unstaged in the type
- merge files by path via mergeFiles; show Staged/Unstaged section blocks
- badge navigator files with S/U/S+U; count merged files for header and ActivityBar
- namespace gap expander keys by section so streams expand independently
- migrate existing fixtures and add partial-staging section/badge tests"
```

---

## Self-Review

**1. Spec coverage:**
- §2.1 `GitChanges` staged/unstaged → Task 1 Step 3. ✓
- §2.2 `git diff --cached` + `git diff` + untracked→unstaged, HEAD 없으면 staged 빈 배열 → Task 1 Step 5. ✓
- §2.3/§2.4 텍스트 출처(staged: HEAD/index, unstaged: index/fs, rename은 new=path·old=old_path) → Task 1 Step 4 `attach_contents`. ✓
- §3 TS 타입 → Task 3 Step 1. ✓
- §3.1 ActivityBar 머지 카운트, SearchPanel 무관 → Task 3 Step 3·4. ✓
- §4.1 `mergeFiles` → Task 2. ✓
- §4.2 파일 목록 S/U/S+U 배지 → Task 3 Step 8. ✓
- §4.3 section Row·ROW_H 24·렌더 순서·collapse path 단위·gapKey 섹션 구분·섹션 내 binary info → Task 3 Step 5·6·9. ✓
- §4.4 offset/index MergedFile 단위·top 누적(section·info 포함) → Task 3 Step 6(`fileOffsets`/`pathToRowIndex`/`top`). ✓
- §4.5 헤더 머지 카운트·빈 상태 → Task 3 Step 7. ✓
- §7 테스트: Rust(partial/staged-new/headless/출처) Task 1; mergeFiles Task 2; DiffView 섹션·배지 + fixture 마이그레이션(gitStore/ActivityBar/DiffView) Task 3. ✓

**2. Placeholder scan:** 모든 코드 단계에 실제 코드/명령/기대결과 포함. 플레이스홀더 없음. ✓

**3. Type consistency:** `MergedFile { path, staged, unstaged, status }`가 Task 2 정의와 Task 3 사용처(`mf.staged?.additions`, `mf.status`, `DiffFileList` props) 일치. `Stream::{Staged,Unstaged}`·`attach_contents(root, root_path, &mut files, stream)` 시그니처 Task 1 내 일치. `Row`의 `file`/`section` 변형이 행 빌드(Step 6)와 `renderRow`(Step 9) 양쪽에서 동일 필드 사용. gapKey 포맷 `${path}#${tag}#${idx}` (tag "s"|"u") 행 빌드 내 일관. ✓

---

## Execution Handoff

이 플랜은 3개 태스크(백엔드 → mergeFiles → 프론트 통합)로, 각 태스크가 독립적으로 빌드·테스트 녹색 상태를 만든다. 태스크 간 의존: Task 3은 Task 2의 `mergeFiles`에 의존하므로 순서대로 실행.
