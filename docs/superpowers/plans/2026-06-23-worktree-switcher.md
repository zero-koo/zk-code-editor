# Worktree Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a title-bar dropdown that lists the repo's git worktrees and switches the workspace root to a chosen worktree, remapping open tabs by relative path.

**Architecture:** A new backend command `git_worktrees(root)` runs `git worktree list --porcelain` and a pure `parse_worktrees` turns it into `{path, branch, is_current}` (current detected by comparing each worktree path to `git rev-parse --show-toplevel`). The frontend TitleBar becomes a dropdown; selecting a non-current worktree calls `App.switchWorktree`, which re-points the root (`set_workspace_root` + store + persistence), clears tabs under the old root, and re-opens each by relative path under the new root. FileExplorer re-lists on `[root]` change so the tree follows the switch. Git reload happens via the existing `[root]` effect.

**Tech Stack:** Rust (`std::process::Command`, serde, `tauri::command`, `spawn_blocking`); React 19 + TypeScript; Zustand; Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-23-worktree-switcher-design.md`

---

### Task 1: Backend — `Worktree` type + `parse_worktrees` (pure)

**Files:**
- Modify: `src-tauri/src/git.rs` (add struct after `GitChanges` ~line 40; add parser + tests)

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/git.rs` (after the existing tests, before the closing `}`):

```rust
    #[test]
    fn parses_multiple_worktrees() {
        let out = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n\
worktree /repo/wt\nHEAD def\nbranch refs/heads/feature\n\n";
        let wts = parse_worktrees(out, "/repo");
        assert_eq!(wts.len(), 2);
        assert_eq!(wts[0].path, "/repo");
        assert_eq!(wts[0].branch.as_deref(), Some("main"));
        assert!(wts[0].is_current);
        assert_eq!(wts[1].path, "/repo/wt");
        assert_eq!(wts[1].branch.as_deref(), Some("feature"));
        assert!(!wts[1].is_current);
    }

    #[test]
    fn parses_detached_and_ignores_unknown_lines() {
        let out = "worktree /repo\nHEAD abc\ndetached\nlocked\nprunable gitdir gone\n\n\
worktree /repo/bare\nbare\n";
        let wts = parse_worktrees(out, "");
        assert_eq!(wts.len(), 2);
        assert_eq!(wts[0].path, "/repo");
        assert_eq!(wts[0].branch, None); // detached
        assert!(!wts[0].is_current); // current is empty → nothing matches
        assert_eq!(wts[1].path, "/repo/bare");
        assert_eq!(wts[1].branch, None); // bare worktree, no branch line
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test parse_worktrees parses_detached -q`
Expected: FAIL — `cannot find function parse_worktrees` / `cannot find type Worktree`.

- [ ] **Step 3: Add the `Worktree` struct**

In `src-tauri/src/git.rs`, after the `GitChanges` struct (the block ending at line 40):

```rust
#[derive(Debug, Serialize, PartialEq)]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub is_current: bool,
}
```

- [ ] **Step 4: Implement `parse_worktrees`**

In `src-tauri/src/git.rs`, add above `compute_changes` (e.g. just before line 298):

```rust
/// Parses `git worktree list --porcelain` output. Blocks are blank-line
/// separated and each starts with `worktree <path>`. Only known prefixes are
/// read; any other line (`HEAD`, `bare`, `locked`, `prunable`, …) is ignored.
/// `branch refs/heads/<name>` → Some(name); `detached` → None.
/// `is_current` is true when the block path equals `current` (a non-empty
/// `git rev-parse --show-toplevel`); both sides are git-reported, so they agree
/// even when the workspace was opened via a symlinked path.
pub fn parse_worktrees(stdout: &str, current: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;

    for line in stdout.split('\n') {
        let line = line.trim_end_matches('\r');
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(prev) = path.take() {
                let is_current = !current.is_empty() && prev == current;
                out.push(Worktree { path: prev, branch: branch.take(), is_current });
            }
            branch = None;
            path = Some(p.to_string());
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
        } else if line == "detached" {
            branch = None;
        }
    }
    if let Some(prev) = path.take() {
        let is_current = !current.is_empty() && prev == current;
        out.push(Worktree { path: prev, branch, is_current });
    }
    out
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test parse_worktrees parses_detached -q`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git.rs
git commit -m "feat(git): parse worktree list porcelain output"
```

---

### Task 2: Backend — `git_worktrees` command + registration

**Files:**
- Modify: `src-tauri/src/git.rs` (add `list_worktrees` + `git_worktrees` command + integration test)
- Modify: `src-tauri/src/lib.rs:24` (register the handler)

- [ ] **Step 1: Write the failing integration test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/git.rs`:

```rust
    #[test]
    fn list_worktrees_reports_linked_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t.t"]);
        git(dir, &["config", "user.name", "t"]);
        git(dir, &["config", "core.excludesFile", "/dev/null"]);
        git(dir, &["config", "core.hooksPath", "/dev/null"]);
        std::fs::write(dir.join("a.txt"), "x\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-q", "-m", "init"]);

        // linked worktree in a separate temp dir
        let wt = tempfile::tempdir().unwrap();
        let wt_path = wt.path().join("feature-wt");
        git(dir, &["worktree", "add", "-q", "-b", "feature", wt_path.to_str().unwrap()]);

        let wts = list_worktrees(dir.to_str().unwrap()).unwrap();
        assert_eq!(wts.len(), 2);
        let main = wts.iter().find(|w| w.branch.as_deref() == Some("main")).unwrap();
        let feat = wts.iter().find(|w| w.branch.as_deref() == Some("feature")).unwrap();
        assert!(main.is_current); // dir's --show-toplevel matches the main worktree path
        assert!(!feat.is_current);
    }

    #[test]
    fn list_worktrees_on_non_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let wts = list_worktrees(tmp.path().to_str().unwrap()).unwrap();
        assert!(wts.is_empty());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test list_worktrees -q`
Expected: FAIL — `cannot find function list_worktrees`.

- [ ] **Step 3: Implement `list_worktrees` + the command**

In `src-tauri/src/git.rs`, add after the `git_changes` command (after line 357):

```rust
fn list_worktrees(root: &str) -> Result<Vec<Worktree>, AppError> {
    if !is_inside_repo(root) {
        return Ok(Vec::new());
    }
    let current = git_output(root, &["rev-parse", "--show-toplevel"])
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let out = git_output(root, &["worktree", "list", "--porcelain"])?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_worktrees(&text, &current))
}

#[tauri::command]
pub async fn git_worktrees(root: String) -> Result<Vec<Worktree>, AppError> {
    tauri::async_runtime::spawn_blocking(move || list_worktrees(&root))
        .await
        .map_err(|e| AppError::new(ErrorCode::Io, e.to_string()))?
}
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, add `git::git_worktrees,` to the `generate_handler!` list (after `git::git_changes,` on line 25):

```rust
            git::git_changes,
            git::git_worktrees,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test list_worktrees -q`
Expected: PASS (2 tests). (Requires `git` on PATH; it is used by the existing diff tests too.)

- [ ] **Step 6: Verify the crate still builds**

Run: `cd src-tauri && cargo build -q`
Expected: builds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git.rs src-tauri/src/lib.rs
git commit -m "feat(git): add git_worktrees command"
```

---

### Task 3: Frontend — `Worktree` type + `gitWorktrees` API

**Files:**
- Modify: `src/api/types.ts` (add `Worktree` after `GitChanges`, ~line 87)
- Modify: `src/api/git.ts` (add `gitWorktrees`)

- [ ] **Step 1: Add the `Worktree` type**

Append to `src/api/types.ts`:

```ts
export interface Worktree {
  path: string;
  branch: string | null;
  is_current: boolean;
}
```

- [ ] **Step 2: Add the API wrapper**

Replace the contents of `src/api/git.ts` with:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { GitChanges, Worktree } from "./types";

export const gitChanges = (root: string) =>
  invoke<GitChanges>("git_changes", { root });

export const gitWorktrees = (root: string) =>
  invoke<Worktree[]>("git_worktrees", { root });
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/api/types.ts src/api/git.ts
git commit -m "feat(api): add Worktree type and gitWorktrees wrapper"
```

---

### Task 4: TitleBar dropdown + App `switchWorktree` wiring

This task changes the `TitleBar` props, so the App call site **must** change in the same commit to keep the build green.

**Files:**
- Modify: `src/components/TitleBar.tsx` (rewrite as dropdown)
- Modify: `src/components/TitleBar.test.tsx` (rewrite for new props)
- Modify: `src/App.tsx` (add `switchWorktree`, wire `<TitleBar>`)

- [ ] **Step 1: Write the failing TitleBar tests**

Replace the contents of `src/components/TitleBar.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitleBar } from "./TitleBar";

const gitWorktrees = vi.fn();
vi.mock("../api/git", () => ({ gitWorktrees: (...a: unknown[]) => gitWorktrees(...a) }));

describe("TitleBar", () => {
  beforeEach(() => {
    gitWorktrees.mockReset();
    gitWorktrees.mockResolvedValue([]);
  });

  it("shows the project name and branch", () => {
    render(<TitleBar root="/proj" branch="main" onSwitchWorktree={() => {}} />);
    expect(screen.getByText("proj")).toBeInTheDocument();
    expect(screen.getByText("(main)")).toBeInTheDocument();
  });

  it("falls back to the app name when no folder is open", () => {
    render(<TitleBar root={null} branch={null} onSwitchWorktree={() => {}} />);
    expect(screen.getByText("zk-code-editor")).toBeInTheDocument();
  });

  it("opens the dropdown and switches to another worktree", async () => {
    gitWorktrees.mockResolvedValue([
      { path: "/proj", branch: "main", is_current: true },
      { path: "/proj-wt", branch: "feature", is_current: false },
    ]);
    const onSwitch = vi.fn();
    render(<TitleBar root="/proj" branch="main" onSwitchWorktree={onSwitch} />);
    await userEvent.click(screen.getByRole("button", { name: /switch worktree/i }));
    await userEvent.click(await screen.findByText("feature"));
    expect(onSwitch).toHaveBeenCalledWith("/proj-wt");
  });

  it("does not switch when the current worktree is clicked", async () => {
    gitWorktrees.mockResolvedValue([
      { path: "/proj", branch: "main", is_current: true },
      { path: "/proj-wt", branch: "feature", is_current: false },
    ]);
    const onSwitch = vi.fn();
    render(<TitleBar root="/proj" branch="main" onSwitchWorktree={onSwitch} />);
    await userEvent.click(screen.getByRole("button", { name: /switch worktree/i }));
    await userEvent.click(await screen.findByText("main"));
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/TitleBar.test.tsx`
Expected: FAIL — TitleBar still takes a `title` prop / no dropdown button.

- [ ] **Step 3: Rewrite TitleBar as a dropdown**

Replace the contents of `src/components/TitleBar.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { CodeIcon } from "./icons";
import { basename } from "../lib/paths";
import { gitWorktrees } from "../api/git";
import type { Worktree } from "../api/types";

interface Props {
  /** Workspace root path, or null when no folder is open. */
  root: string | null;
  /** Current branch label (from the git store), or null. */
  branch: string | null;
  /** Called with the chosen worktree path when the user switches. */
  onSwitchWorktree: (path: string) => void;
}

/**
 * macOS overlay-style titlebar. The bar is a drag region (tauri moves the
 * window); the centered title is a clickable trigger that opens a dropdown of
 * the repo's git worktrees. The trigger and dropdown opt out of the drag region
 * via `pointer-events-auto` so their clicks aren't swallowed as a window drag.
 */
export function TitleBar({ root, branch, onSwitchWorktree }: Props) {
  const [open, setOpen] = useState(false);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const name = root ? basename(root) : null;

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!root) return;
    try {
      setWorktrees(await gitWorktrees(root));
    } catch {
      setWorktrees([]);
    }
  }

  function choose(wt: Worktree) {
    setOpen(false);
    if (!wt.is_current) onSwitchWorktree(wt.path);
  }

  return (
    <div
      data-tauri-drag-region
      className="relative h-10 shrink-0 flex items-center bg-titlebar border-b border-bd-2 pl-[78px] pr-3 select-none"
    >
      <div
        data-tauri-drag-region
        className="flex-1 min-w-0 flex items-center justify-center gap-2 text-xs text-tx-2 pointer-events-none"
      >
        <CodeIcon size={13} stroke="#6e7bf2" strokeWidth={2.1} className="shrink-0" />
        {name ? (
          <button
            type="button"
            aria-label="Switch worktree"
            aria-expanded={open}
            onClick={toggle}
            className="pointer-events-auto flex items-center gap-1.5 max-w-full rounded-md px-1.5 py-0.5 hover:bg-white/5"
          >
            <span className="text-tx-bright font-medium truncate">{name}</span>
            {branch && <span className="text-tx-faint shrink-0">({branch})</span>}
            <span className="text-tx-faint shrink-0 text-[9px] leading-none">▾</span>
          </button>
        ) : (
          <span className="text-tx-bright font-medium truncate">zk-code-editor</span>
        )}
      </div>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 pointer-events-auto"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            aria-label="Worktrees"
            className="absolute z-50 top-9 left-1/2 -translate-x-1/2 min-w-[260px] max-w-[80vw] pointer-events-auto rounded-lg border border-bd-1 bg-bg-1 shadow-xl py-1 text-xs"
          >
            {worktrees.length === 0 ? (
              <div className="px-3 py-2 text-tx-3">No worktrees</div>
            ) : (
              worktrees.map((wt) => (
                <button
                  key={wt.path}
                  type="button"
                  role="option"
                  aria-selected={wt.is_current}
                  onClick={() => choose(wt)}
                  className={`w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 ${
                    wt.is_current ? "text-tx-bright" : "text-tx-2"
                  }`}
                >
                  <span className="w-3 shrink-0 text-accent">{wt.is_current ? "✓" : ""}</span>
                  <span className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{wt.branch ?? "(detached)"}</span>
                    <span className="text-tx-faint truncate text-[11px]">{wt.path}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the TitleBar tests to verify they pass**

Run: `npx vitest run src/components/TitleBar.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add `switchWorktree` to App and wire the TitleBar**

In `src/App.tsx`:

(a) Extend the imports. Change line 14 and 17–18:

```ts
import { readFile, writeFile, setWorkspaceRoot } from "./api/fs";
```
```ts
import { basename, relativePath, joinPath } from "./lib/paths";
import { loadOpenTabs, saveOpenTabs, saveWorkspaceRoot } from "./lib/workspacePersistence";
```

(b) Add `setRoot` to the store selectors (after line 51 `const closeTabsUnder = ...`):

```ts
  const setRoot = useWorkspaceStore((s) => s.setRoot);
```

(c) Add a branch subscription and an in-flight ref. After line 51 group (near the other `useGitStore`/refs), add:

```ts
  const gitBranch = useGitStore((s) => s.changes?.branch ?? null);
  const switchingRef = useRef(false);
```

(d) Add the `switchWorktree` callback. Place it after `openFile` (after line 92):

```ts
  const switchWorktree = useCallback(
    async (path: string) => {
      const store = useWorkspaceStore.getState();
      const oldRoot = store.root;
      if (!oldRoot || path === oldRoot || switchingRef.current) return;
      if (
        store.tabs.some((t) => t.dirty) &&
        !confirm("Unsaved changes will be lost. Switch worktree?")
      )
        return;
      switchingRef.current = true;
      try {
        // Capture relative paths against the OLD root before re-pointing.
        const openRel = store.tabs.map((t) => relativePath(oldRoot, t.path));
        const activeRel = store.activeTabPath
          ? relativePath(oldRoot, store.activeTabPath)
          : null;

        await setWorkspaceRoot(path);
        setRoot(path); // triggers the [root] git-load + FileExplorer re-list
        saveWorkspaceRoot(path);
        closeTabsUnder(oldRoot); // clears every tab under the old root

        for (const rel of openRel) {
          await openFile(joinPath(path, rel)); // missing/binary/large are skipped
        }
        if (activeRel) {
          const target = joinPath(path, activeRel);
          if (useWorkspaceStore.getState().tabs.some((t) => t.path === target)) {
            setActive(target);
          }
        }
      } finally {
        switchingRef.current = false;
      }
    },
    [setRoot, closeTabsUnder, openFile, setActive]
  );
```

(e) Replace the TitleBar render (line 218):

```tsx
      <TitleBar root={root} branch={gitBranch} onSwitchWorktree={switchWorktree} />
```

- [ ] **Step 6: Run the full frontend test suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — all suites green (TitleBar updated; no other suite references the old `title` prop).

- [ ] **Step 7: Commit**

```bash
git add src/components/TitleBar.tsx src/components/TitleBar.test.tsx src/App.tsx
git commit -m "feat(frontend): title-bar worktree switcher dropdown"
```

---

### Task 5: FileExplorer re-lists on root change

**Files:**
- Modify: `src/components/FileExplorer.tsx` (split restore vs. list effects)
- Modify: `src/components/FileExplorer.test.tsx` (add a re-list test)

- [ ] **Step 1: Write the failing test**

Add to `src/components/FileExplorer.test.tsx` inside the `describe` block:

```tsx
  it("re-lists the tree when the root changes (worktree switch)", async () => {
    readDir.mockResolvedValueOnce([{ name: "a.ts", path: "/wt1/a.ts", is_dir: false }]);
    useWorkspaceStore.setState({ root: "/wt1" });
    render(<FileExplorer onOpenFile={() => {}} />);
    expect(await screen.findByText("a.ts")).toBeInTheDocument();

    readDir.mockResolvedValueOnce([{ name: "b.ts", path: "/wt2/b.ts", is_dir: false }]);
    useWorkspaceStore.setState({ root: "/wt2" });
    expect(await screen.findByText("b.ts")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/FileExplorer.test.tsx`
Expected: FAIL — after the root change to `/wt2`, the tree still shows `a.ts` (the mount-only effect never re-lists), so `b.ts` is never found.

- [ ] **Step 3: Split the restore and list effects**

In `src/components/FileExplorer.tsx`, replace the single restore effect (lines 32–56) with two effects:

```tsx
  // Restore the workspace root after a reload/restart: the dev server (Vite)
  // reloads the webview when project files change, wiping the in-memory store.
  // Only restore when the store has no root yet; the list effect below does the
  // actual `readDir` once `root` is set (here or via Open Folder / a switch).
  useEffect(() => {
    if (useWorkspaceStore.getState().root) return;
    const target = loadWorkspaceRoot();
    if (!target) return;
    (async () => {
      try {
        await setWorkspaceRoot(target);
        setRoot(target);
      } catch {
        saveWorkspaceRoot(null); // folder gone/invalid — forget it
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // List the tree whenever the root changes (mount, Open Folder, worktree
  // switch). Guard against the initial null root.
  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await readDir(root);
        if (!cancelled) setEntries(list);
      } catch {
        // invalid root; the restore effect forgets it on a cold start
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root]);
```

Note: `openFolder` already calls `setRoot(selected)`; its `setEntries(await readDir(selected))` is now redundant with the list effect but harmless — leave it so the existing "opening a folder" test (which asserts on the `readDir` result) stays straightforward.

- [ ] **Step 4: Run the FileExplorer tests to verify they pass**

Run: `npx vitest run src/components/FileExplorer.test.tsx`
Expected: PASS — all FileExplorer tests, including the new re-list test and the existing restore/open tests.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/FileExplorer.tsx src/components/FileExplorer.test.tsx
git commit -m "feat(frontend): re-list explorer tree on root change"
```

---

### Task 6: Manual verification

**Not automated — run against a real repo with a real worktree.**

- [ ] **Step 1: Create a worktree to switch to**

```bash
git worktree add -b wt-demo ../zk-code-editor-wt
```

- [ ] **Step 2: Run the app**

Run: `npm run tauri dev`

- [ ] **Step 3: Verify the switch**

- Open the project folder. Title bar shows `zk-code-editor (main)` (or current branch) with a ▾.
- Click the title → dropdown lists both worktrees; the current one has a ✓.
- Open a couple of files (e.g. `src/App.tsx`, `README.md`).
- Click the other worktree (`wt-demo`).
- Confirm: the explorer tree, search results, and git diff view now reflect the new worktree's branch; the same files re-open (by relative path), and the active tab is preserved if it exists there.
- Make an unsaved edit, then try to switch → a confirm dialog appears; cancel keeps you put, OK switches and drops the edit.
- Switch back; everything tracks the original worktree again.

- [ ] **Step 4: Clean up**

```bash
git worktree remove ../zk-code-editor-wt
```

---

## Self-Review Notes

- **Spec coverage:** §2 backend command/parser → Tasks 1–2; §3.1 types/API → Task 3; §3.2 dropdown (drag-region opt-out, `is_current` flag, Escape/outside-click, re-fetch on open) → Task 4; §3.3 `switchWorktree` orchestration → Task 4; §3.4 FileExplorer `[root]` re-list (null guard, restore/list split) → Task 5; §5 path-normalization mitigation (no-op + current-row keyed on git `is_current`, not string compare) → Tasks 1/4; §6 tests → Tasks 1/2/4/5 + manual Task 6.
- **Type consistency:** Rust `Worktree { path, branch: Option<String>, is_current }` ↔ TS `Worktree { path, branch: string | null, is_current }`; serde uses field names verbatim (no `rename_all`), matching the existing `FileDiff` snake_case convention. `gitWorktrees` invokes `"git_worktrees"` with `{ root }`, matching the command signature.
- **No git reload step in `switchWorktree`:** intentional — `setRoot` triggers App's existing `useEffect(..., [root])` git load (App.tsx:128–130). The gitStore `seq` guard makes any redundant load safe.
