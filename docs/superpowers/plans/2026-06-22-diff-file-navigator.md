# Diff File Navigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a left file-navigator panel inside the git DiffView — clicking a file scrolls the continuous diff to it, and the file currently at the top of the diff is auto-highlighted in the list.

**Architecture:** A pure helper `activeFileForOffset` maps the virtualizer's scroll offset to the active file path. DiffView builds `pathToRowIndex` (click → `scrollToIndex`) and `fileOffsets` (scroll → active highlight) during its existing flatten loop; the active path is a derived value of `virtualizer.scrollOffset` (no extra state). The body becomes a two-pane flex row [list | virtualized diff].

**Tech Stack:** React 19 + TypeScript, `@tanstack/react-virtual` v3, Vitest/jsdom.

**Reference spec:** `docs/superpowers/specs/2026-06-22-diff-file-navigator-design.md`

---

## File Structure

- **Create** `src/lib/diffNav.ts` — pure `activeFileForOffset(files, offset)`.
- **Create** `src/lib/diffNav.test.ts` — unit tests for it.
- **Modify** `src/components/DiffView.tsx` — build `pathToRowIndex`/`fileOffsets` in the flatten loop, derive `activePath`, add `jumpTo`, render a `DiffFileList` left panel, two-pane layout.
- **Modify** `src/components/DiffView.test.tsx` — navigator render + click-scroll tests.
- **Modify** `src/test/setup.ts` — `Element.prototype.scrollTo` polyfill (so `scrollToIndex` moves `scrollTop` in jsdom).

---

## Task 1: Pure `activeFileForOffset` helper

**Files:**
- Create: `src/lib/diffNav.ts`
- Test: `src/lib/diffNav.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/lib/diffNav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { activeFileForOffset } from "./diffNav";

const files = [
  { path: "a", top: 0 },
  { path: "b", top: 100 },
  { path: "c", top: 250 },
];

describe("activeFileForOffset", () => {
  it("returns the first file at offset 0", () => {
    expect(activeFileForOffset(files, 0)).toBe("a");
  });

  it("returns the file whose section contains the offset", () => {
    expect(activeFileForOffset(files, 99)).toBe("a");
    expect(activeFileForOffset(files, 100)).toBe("b");
    expect(activeFileForOffset(files, 240)).toBe("b");
    expect(activeFileForOffset(files, 250)).toBe("c");
  });

  it("returns the last file when scrolled past everything", () => {
    expect(activeFileForOffset(files, 9999)).toBe("c");
  });

  it("returns null for an empty list", () => {
    expect(activeFileForOffset([], 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/diffNav.test.ts`
Expected: FAIL — cannot resolve `./diffNav`.

- [ ] **Step 3: Implement `src/lib/diffNav.ts`**

```ts
/** A changed file's pixel offset (cumulative top) within the diff. */
export interface FileOffset {
  path: string;
  top: number;
}

/**
 * Returns the path of the file whose section is at the top of the viewport for
 * the given scroll `offset` — the last file whose `top` is at or before it.
 * `files` must be in ascending `top` order. Returns null for an empty list.
 */
export function activeFileForOffset(files: FileOffset[], offset: number): string | null {
  let active: string | null = files[0]?.path ?? null;
  for (const f of files) {
    if (f.top <= offset + 1) active = f.path; // +1 absorbs sub-pixel boundary error
    else break;
  }
  return active;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/diffNav.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/diffNav.ts src/lib/diffNav.test.ts
git commit -m "feat(frontend): add activeFileForOffset helper for diff navigator

- 스크롤 오프셋 → 최상단 파일 경로 매핑 순수 함수(가상화 하이라이트 파생용)"
```

---

## Task 2: Navigator panel in DiffView + test scrollTo polyfill

**Files:**
- Modify: `src/test/setup.ts`
- Modify: `src/components/DiffView.tsx`
- Modify: `src/components/DiffView.test.tsx`

- [ ] **Step 1: Add the `scrollTo` polyfill to `src/test/setup.ts`**

Insert this block immediately AFTER the `offsetHeight`/`offsetWidth` block (after its closing `}`, before the `localStorage` block):

```ts
// jsdom lacks Element.prototype.scrollTo; @tanstack/react-virtual's scrollToIndex
// calls scrollElement.scrollTo({ top }), a silent no-op when missing. Polyfill it
// to assign scrollTop so click-to-scroll is observable in tests.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function (
    this: Element,
    options?: ScrollToOptions | number,
    y?: number
  ) {
    if (typeof options === "object" && options?.top != null) this.scrollTop = options.top;
    else if (typeof y === "number") this.scrollTop = y;
  } as typeof Element.prototype.scrollTo;
}

// scrollToIndex clamps its target to getMaxScrollOffset() = scrollHeight − clientHeight,
// both 0 in jsdom (no layout) → every scroll would clamp to 0. Stub them on `.zk-scroll`
// (large scrollHeight, 800 clientHeight) so the clamp permits a real positive offset.
if (typeof HTMLElement !== "undefined") {
  for (const [prop, size] of [
    ["scrollHeight", 100000],
    ["clientHeight", 800],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList?.contains("zk-scroll")) return size;
        return original?.get?.call(this) ?? 0;
      },
    });
  }
}
```

- [ ] **Step 2: Write the failing navigator tests** — replace the entire `src/components/DiffView.test.tsx` with the version below (keeps the 5 existing tests, adds 2 navigator tests + a tall fixture):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

// Three files; clicking the 3rd (src/c.ts, at pixel offset 152) scrolls to a
// positive offset thanks to the scrollHeight/clientHeight stubs in setup.ts.
const oneAdd = (text: string) => [{ kind: "add" as const, old_no: null, new_no: 1, text }];
const multi: GitChanges = {
  is_repo: true,
  branch: "main",
  files: [
    { path: "src/a.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: oneAdd("aaa") }] },
    { path: "src/b.ts", old_path: null, status: "added", additions: 1, deletions: 0, binary: false, too_large: false, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: oneAdd("bbb") }] },
    { path: "src/c.ts", old_path: null, status: "modified", additions: 1, deletions: 0, binary: false, too_large: false, hunks: [{ header: "@@ -0,0 +1,1 @@", lines: oneAdd("ccc") }] },
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
    expect(await screen.findByTestId("diff-scroll")).toBeInTheDocument();
    expect(await screen.findByText("const neo = 2")).toBeInTheDocument();
    expect(screen.getByText("const old = 2")).toBeInTheDocument();
  });

  it("collapses a file's lines when its header is clicked", async () => {
    gitChanges.mockResolvedValue(sample);
    const { container } = render(<DiffView root="/repo" active />);
    await screen.findByText("const neo = 2");
    // the file header inside the diff body (not the nav) carries the toggle
    const diff = container.querySelector('[data-testid="diff-scroll"]') as HTMLElement;
    await userEvent.click(within(diff).getByText("src/a.ts"));
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

  it("lists all changed files in the navigator", async () => {
    gitChanges.mockResolvedValue(multi);
    render(<DiffView root="/repo" active />);
    const nav = await screen.findByTestId("diff-file-list");
    expect(within(nav).getByText("src/a.ts")).toBeInTheDocument();
    expect(within(nav).getByText("src/b.ts")).toBeInTheDocument();
    expect(within(nav).getByText("src/c.ts")).toBeInTheDocument();
  });

  it("scrolls the diff when a navigator file is clicked", async () => {
    gitChanges.mockResolvedValue(multi);
    render(<DiffView root="/repo" active />);
    const nav = await screen.findByTestId("diff-file-list");
    const scroller = screen.getByTestId("diff-scroll");
    expect(scroller.scrollTop).toBe(0);
    await userEvent.click(within(nav).getByText("src/c.ts"));
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: FAIL — there is no `diff-file-list` testid yet, and `diff-scroll` testid is missing (the existing tests that now reference `diff-scroll` and the 2 new nav tests fail).

- [ ] **Step 4: Modify `src/components/DiffView.tsx`**

(a) Update the import line (add the helper + its type):

```tsx
import { activeFileForOffset, type FileOffset } from "../lib/diffNav";
```

(b) Replace the flatten block (the `const rows: Row[] = [];` ... closing `}` that ends the `if (changes)` loop) with this — it also builds `pathToRowIndex` and `fileOffsets`:

```tsx
  const rows: Row[] = [];
  const pathToRowIndex = new Map<string, number>();
  const fileOffsets: FileOffset[] = [];
  let top = 0;
  if (changes) {
    for (const file of changes.files) {
      pathToRowIndex.set(file.path, rows.length);
      fileOffsets.push({ path: file.path, top });
      rows.push({ kind: "file", file });
      top += ROW_H.file;
      if (collapsed.has(file.path)) continue;
      if (file.binary) {
        rows.push({ kind: "info", text: "Binary file not shown" });
        top += ROW_H.info;
        continue;
      }
      if (file.too_large) {
        rows.push({ kind: "info", text: "File too large to display" });
        top += ROW_H.info;
        continue;
      }
      for (const h of file.hunks) {
        rows.push({ kind: "hunk", header: h.header });
        top += ROW_H.hunk;
        for (const l of h.lines) {
          rows.push({ kind: "line", lineKind: l.kind, oldNo: l.old_no, newNo: l.new_no, text: l.text });
          top += ROW_H.line;
        }
      }
    }
  }
```

(c) Immediately AFTER the `const virtualizer = useVirtualizer({ ... });` call, add the derived active path and the jump handler:

```tsx
  const activePath = activeFileForOffset(fileOffsets, virtualizer.scrollOffset ?? 0);
  function jumpTo(path: string) {
    const idx = pathToRowIndex.get(path);
    if (idx != null) virtualizer.scrollToIndex(idx, { align: "start" });
  }
```

(d) Replace the final `} else { body = ( ... ); }` branch (the virtualized list) with a two-pane layout. The new branch:

```tsx
  } else if (changes) {
    body = (
      <div className="flex flex-1 min-h-0">
        <DiffFileList files={changes.files} activePath={activePath} onSelect={jumpTo} />
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
                  {renderRow(row, toggle)}
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
```

(e) Add the `DiffFileList` component (place it after the `Centered` function, before `renderRow`):

```tsx
function DiffFileList({
  files,
  activePath,
  onSelect,
}: {
  files: FileDiff[];
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div data-testid="diff-file-list" className="zk-scroll shrink-0 w-56 overflow-auto border-r border-bd-2 py-1">
      {files.map((f) => (
        <div
          key={f.path}
          onClick={() => onSelect(f.path)}
          className={`flex items-center gap-2 h-7 px-2.5 cursor-pointer text-[12px] ${
            f.path === activePath ? "bg-white/10 text-tx-bright" : "text-tx-2 hover:bg-white/5"
          }`}
        >
          <span className="w-3.5 text-center text-[10.5px] text-tx-3 shrink-0">{STATUS_BADGE[f.status]}</span>
          <span className="flex-1 truncate">{f.path}</span>
          {f.additions > 0 && <span className="text-[10.5px] text-emerald-400 shrink-0">+{f.additions}</span>}
          {f.deletions > 0 && <span className="text-[10.5px] text-red-400 shrink-0">−{f.deletions}</span>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run the DiffView tests + full suite + build**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: PASS (7 tests: 5 existing + 2 navigator).

Run: `npx vitest run`
Expected: PASS — all tests (prior total + 4 diffNav + the navigator additions). Investigate any failure; do not delete tests.

Run: `npm run build`
Expected: `tsc && vite build` succeed.

- [ ] **Step 6: Commit**

```bash
git add src/test/setup.ts src/components/DiffView.tsx src/components/DiffView.test.tsx
git commit -m "feat(frontend): add file navigator panel to the diff view

- 좌측 파일 목록 패널: 클릭 시 해당 파일 섹션으로 스크롤(scrollToIndex)
- 스크롤 위치 기준 활성 파일 자동 하이라이트(virtualizer.scrollOffset + activeFileForOffset)
- 본문 2단 레이아웃(flex-1 min-h-0), 테스트용 scrollTo 폴리필 추가"
```

---

## Task 3: Manual verification

**Files:** none (manual QA)

- [ ] **Step 1: Launch in a real repo**

Run: `npm run tauri dev`, open a git repo with several changed files, click the Source Control icon.

- [ ] **Step 2: Verify**

- Left panel lists every changed file (status badge, path, ±). The diff is on the right.
- Clicking a file scrolls the diff so that file's section is at the top.
- Scrolling the diff highlights the file currently at the top in the left list (auto-sync), including as you scroll through a long file.
- Clicking a collapsed file still scrolls to its header.
- States with no list still work full-width: non-repo → "Not a Git repository", clean → "No changes".
- Switching git → editor and back preserves the editor (persistent view) — unaffected by this change.

- [ ] **Step 3: (No commit)** — manual only; commit any fixes referencing the observed defect.

---

## Self-Review Notes

- **Spec coverage:** §2 layout two-pane with `flex-1 min-h-0` + `shrink-0 w-56` (Task 2d/2e), §3.1 DiffFileList props/badge/highlight (2e), §3.2 pathToRowIndex/fileOffsets/derived activePath/jumpTo (2b/2c), §3.3 activeFileForOffset pure helper (Task 1), §5 edges (no-list states kept; collapsed file header always in pathToRowIndex since the file row is pushed before the collapse `continue`), §6 tests (diffNav unit + navigator render/click-scroll + scrollTo polyfill), §7 file changes (all), §8 non-goals (no dir tree/keyboard/filter/left-list virtualization — none added).
- **Placeholder scan:** none — all steps have concrete code/commands.
- **Type consistency:** `activeFileForOffset(files: FileOffset[], offset): string | null` and `FileOffset { path; top }` match between Task 1 (definition) and DiffView usage (2a/2c). `pathToRowIndex: Map<string, number>` keys on `file.path`, consumed by `jumpTo`. `DiffFileList` props (`files`/`activePath`/`onSelect`) match its call site (2d). `data-testid` values `diff-file-list` / `diff-scroll` match between component and tests.
- **Note:** `scrollToIndex` clamps its target to `getMaxScrollOffset() = scrollHeight − clientHeight`, which are 0 in jsdom (no layout) — so without a stub every scroll clamps to 0 and `scrollTop` stays 0. Task 2 Step 1 stubs `scrollHeight`/`clientHeight` on `.zk-scroll`; with that, clicking the 3rd file (offset 152px) yields `scrollTop = 152 > 0`. (Verified against the real @tanstack/virtual-core clamp logic, not `totalSize − viewport`.)
