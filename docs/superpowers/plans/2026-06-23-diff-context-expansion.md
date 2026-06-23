# Diff Context Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub-style context expansion in the DiffView — up/down (↑/↓) controls in hidden gaps between/above/below hunks reveal unchanged lines (20 at a time) from the already-available `new_text`.

**Architecture:** A pure `diffExpand` module computes the hidden gaps per file (from hunk line numbers + new_text line count) and, given per-gap expansion state, the revealed context lines. DiffView holds the expansion state, inserts expander rows + revealed context "line" rows into its virtualized flatten, and renders the expander controls.

**Tech Stack:** React 19 + TS, Vitest. No backend/type/store changes.

**Reference spec:** `docs/superpowers/specs/2026-06-23-diff-context-expansion-design.md`

---

## File Structure

- **Create** `src/lib/diffExpand.ts` (+ test) — `hunkBounds`, `fileGaps`, `revealGap` (pure).
- **Modify** `src/components/DiffView.tsx` (+ test) — expander Row kind + `ROW_H`, `expanded` state + reset, `expand` handler, gap-aware flatten, `renderRow` expander branch.

---

## Task 1: Pure `diffExpand` helper

**Files:** Create `src/lib/diffExpand.ts`, `src/lib/diffExpand.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/lib/diffExpand.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hunkBounds, fileGaps, revealGap } from "./diffExpand";
import type { Hunk, DiffLine } from "../api/types";

const line = (kind: DiffLine["kind"], old_no: number | null, new_no: number | null): DiffLine => ({
  kind,
  old_no,
  new_no,
  text: "x",
});
const hunk = (lines: DiffLine[]): Hunk => ({ header: "@@", lines });

describe("hunkBounds", () => {
  it("scans first/last non-null numbers across add/del-only edges", () => {
    // first line is del (new_no null), last line is add (old_no null)
    const h = hunk([
      line("del", 5, null),
      line("context", 6, 5),
      line("add", null, 6),
    ]);
    expect(hunkBounds(h)).toEqual({ firstNew: 5, lastNew: 6, firstOld: 5, lastOld: 6 });
  });
});

describe("fileGaps", () => {
  const h0 = hunk([line("context", 4, 4), line("context", 6, 6)]); // new 4..6, old 4..6
  const h1 = hunk([line("context", 19, 20), line("context", 21, 22)]); // new 20..22, old 19..21

  it("computes before / between / after gaps with deltas and direction flags", () => {
    const gaps = fileGaps([h0, h1], 30);
    expect(gaps).toEqual([
      { beforeHunkIndex: 0, startNew: 1, endNew: 3, delta: 0, hasPrev: false, hasNext: true },
      { beforeHunkIndex: 1, startNew: 7, endNew: 19, delta: 1, hasPrev: true, hasNext: true },
      { beforeHunkIndex: 2, startNew: 23, endNew: 30, delta: 1, hasPrev: true, hasNext: false },
    ]);
  });

  it("omits zero-length gaps (whole-file single hunk)", () => {
    const whole = hunk([line("add", null, 1), line("add", null, 3)]); // new 1..3, no old
    // firstNew 1 → before gap [1,0] empty; lastNew 3, total 3 → after [4,3] empty
    expect(fileGaps([whole], 3)).toEqual([]);
  });

  it("returns no gaps for an empty hunk list", () => {
    expect(fileGaps([], 10)).toEqual([]);
  });
});

describe("revealGap", () => {
  const gap = { beforeHunkIndex: 1, startNew: 7, endNew: 19, delta: 1, hasPrev: true, hasNext: true };
  const newLines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);

  it("reveals from the top (down) and bottom (up) with oldNo = newNo - delta", () => {
    const r = revealGap(gap, { top: 2, bottom: 1 }, newLines);
    expect(r.topLines).toEqual([
      { newNo: 7, oldNo: 6, text: "line7" },
      { newNo: 8, oldNo: 7, text: "line8" },
    ]);
    expect(r.bottomLines).toEqual([{ newNo: 19, oldNo: 18, text: "line19" }]);
    expect(r.remaining).toBe(13 - 3);
    expect(r.canUp).toBe(true);
    expect(r.canDown).toBe(true);
  });

  it("clamps converging top/bottom without overlap and hides controls when fully revealed", () => {
    const r = revealGap(gap, { top: 100, bottom: 100 }, newLines);
    expect(r.topLines).toHaveLength(13); // whole gap from the top
    expect(r.bottomLines).toHaveLength(0);
    expect(r.remaining).toBe(0);
    expect(r.canUp).toBe(false);
    expect(r.canDown).toBe(false);
  });

  it("disables a direction when the gap has no neighbor on that side", () => {
    const before = { beforeHunkIndex: 0, startNew: 1, endNew: 3, delta: 0, hasPrev: false, hasNext: true };
    const r = revealGap(before, { top: 0, bottom: 0 }, newLines);
    expect(r.canDown).toBe(false); // no previous hunk → no ↓
    expect(r.canUp).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/diffExpand.test.ts`
Expected: FAIL — cannot resolve `./diffExpand`.

- [ ] **Step 3: Implement `src/lib/diffExpand.ts`**

```ts
import type { Hunk } from "../api/types";

export interface HunkBounds {
  firstNew: number;
  lastNew: number;
  firstOld: number;
  lastOld: number;
}

export interface GapSpec {
  beforeHunkIndex: number; // gap precedes this hunk index (=== hunks.length → after last)
  startNew: number; // hidden new-side range (inclusive)
  endNew: number;
  delta: number; // oldNo = newNo - delta within the gap
  hasPrev: boolean;
  hasNext: boolean;
}

export interface RevealLine {
  newNo: number;
  oldNo: number;
  text: string;
}

export interface RevealedGap {
  topLines: RevealLine[];
  bottomLines: RevealLine[];
  remaining: number;
  canUp: boolean;
  canDown: boolean;
}

function firstNonNull(xs: (number | null)[]): number {
  for (const x of xs) if (x != null) return x;
  return 0;
}
function lastNonNull(xs: (number | null)[]): number {
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i];
    if (x != null) return x;
  }
  return 0;
}

export function hunkBounds(h: Hunk): HunkBounds {
  const news = h.lines.map((l) => l.new_no);
  const olds = h.lines.map((l) => l.old_no);
  return {
    firstNew: firstNonNull(news),
    lastNew: lastNonNull(news),
    firstOld: firstNonNull(olds),
    lastOld: lastNonNull(olds),
  };
}

export function fileGaps(hunks: Hunk[], totalNewLines: number): GapSpec[] {
  if (hunks.length === 0) return [];
  const b = hunks.map(hunkBounds);
  const gaps: GapSpec[] = [];

  // before the first hunk
  if (b[0].firstNew - 1 >= 1) {
    gaps.push({
      beforeHunkIndex: 0,
      startNew: 1,
      endNew: b[0].firstNew - 1,
      delta: b[0].firstNew - b[0].firstOld,
      hasPrev: false,
      hasNext: true,
    });
  }
  // between consecutive hunks
  for (let i = 0; i < hunks.length - 1; i++) {
    const startNew = b[i].lastNew + 1;
    const endNew = b[i + 1].firstNew - 1;
    if (endNew >= startNew) {
      gaps.push({
        beforeHunkIndex: i + 1,
        startNew,
        endNew,
        delta: b[i + 1].firstNew - b[i + 1].firstOld,
        hasPrev: true,
        hasNext: true,
      });
    }
  }
  // after the last hunk
  const last = b[b.length - 1];
  if (totalNewLines >= last.lastNew + 1) {
    gaps.push({
      beforeHunkIndex: hunks.length,
      startNew: last.lastNew + 1,
      endNew: totalNewLines,
      delta: last.lastNew - last.lastOld,
      hasPrev: true,
      hasNext: false,
    });
  }
  return gaps;
}

export function revealGap(
  gap: GapSpec,
  state: { top: number; bottom: number },
  newLines: string[]
): RevealedGap {
  const len = gap.endNew - gap.startNew + 1;
  const top = Math.min(Math.max(state.top, 0), len);
  const bottom = Math.min(Math.max(state.bottom, 0), len - top);
  const mk = (L: number): RevealLine => ({ newNo: L, oldNo: L - gap.delta, text: newLines[L - 1] ?? "" });

  const topLines: RevealLine[] = [];
  for (let L = gap.startNew; L <= gap.startNew + top - 1; L++) topLines.push(mk(L));
  const bottomLines: RevealLine[] = [];
  for (let L = gap.endNew - bottom + 1; L <= gap.endNew; L++) bottomLines.push(mk(L));

  const remaining = len - top - bottom;
  return {
    topLines,
    bottomLines,
    remaining,
    canUp: gap.hasNext && remaining > 0,
    canDown: gap.hasPrev && remaining > 0,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/diffExpand.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/diffExpand.ts src/lib/diffExpand.test.ts
git commit -m "feat(frontend): add diffExpand helper for diff context expansion

- hunkBounds(non-null 스캔)/fileGaps(앞·사이·뒤 간격+delta+방향)/revealGap(clamp·공개 줄)"
```

---

## Task 2: DiffView context-expansion integration

**Files:** `src/components/DiffView.tsx`, `src/components/DiffView.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `src/components/DiffView.test.tsx` (inside `describe("DiffView", ...)`):

```tsx
  it("reveals hidden context lines via the expander controls", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      files: [
        {
          path: "a.txt", // plaintext → predictable single-node text
          old_path: null,
          status: "modified",
          additions: 1,
          deletions: 1,
          binary: false,
          too_large: false,
          new_text: "x1\nx2\nx3\nx4\nx5new\nx6\nx7\nx8\n",
          old_text: "x1\nx2\nx3\nx4\nx5old\nx6\nx7\nx8\n",
          hunks: [
            {
              header: "@@ -4,3 +4,3 @@",
              lines: [
                { kind: "context", old_no: 4, new_no: 4, text: "x4" },
                { kind: "del", old_no: 5, new_no: null, text: "x5old" },
                { kind: "add", old_no: null, new_no: 5, text: "x5new" },
                { kind: "context", old_no: 6, new_no: 6, text: "x6" },
              ],
            },
          ],
        },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByTestId("diff-scroll");
    // hidden lines not shown yet
    expect(screen.queryByText("x1")).not.toBeInTheDocument();
    // before-first gap has only ↑ (Expand up); after-last has only ↓ (Expand down)
    await userEvent.click(screen.getByRole("button", { name: /expand up/i }));
    expect(await screen.findByText("x1")).toBeInTheDocument();
    expect(screen.getByText("x3")).toBeInTheDocument();
  });

  it("shows no expander for files without new_text", async () => {
    gitChanges.mockResolvedValue({
      is_repo: true,
      branch: "main",
      files: [
        {
          path: "img.bin",
          old_path: null,
          status: "modified",
          additions: 0,
          deletions: 0,
          binary: true,
          too_large: false,
          new_text: null,
          old_text: null,
          hunks: [],
        },
      ],
    });
    render(<DiffView root="/repo" active />);
    await screen.findByText(/binary file/i);
    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: FAIL — no expander controls exist yet (no `/expand up/i` button; "x1" never appears).

- [ ] **Step 3: Modify `src/components/DiffView.tsx`**

(a) Import the helper (with the other imports):
```tsx
import { fileGaps, revealGap } from "../lib/diffExpand";
```

(b) Add the `expander` Row variant (in the `Row` union) and `ROW_H` entry + a step constant:
```tsx
  | { kind: "expander"; gapKey: string; canUp: boolean; canDown: boolean; remaining: number }
```
```tsx
const ROW_H: Record<Row["kind"], number> = { file: 34, hunk: 22, line: 20, info: 28, expander: 22 };
const EXPAND_STEP = 20;
```

(c) Add expansion state + reset-on-reload (next to the existing `collapsed` state / `clearHighlightCache` effect):
```tsx
  const [expanded, setExpanded] = useState<Map<string, { top: number; bottom: number }>>(new Map());
```
```tsx
  useEffect(() => {
    clearHighlightCache();
    setExpanded(new Map()); // line numbers change on reload → reset gap expansion
  }, [changes]);
```
```tsx
  function expand(gapKey: string, dir: "up" | "down") {
    setExpanded((prev) => {
      const next = new Map(prev);
      const cur = next.get(gapKey) ?? { top: 0, bottom: 0 };
      next.set(
        gapKey,
        dir === "down" ? { ...cur, top: cur.top + EXPAND_STEP } : { ...cur, bottom: cur.bottom + EXPAND_STEP }
      );
      return next;
    });
  }
```

(d) Replace the hunks loop in the flatten. The current block is:
```tsx
      for (const h of file.hunks) {
        rows.push({ kind: "hunk", header: h.header });
        top += ROW_H.hunk;
        for (const l of h.lines) {
          rows.push({ kind: "line", lineKind: l.kind, oldNo: l.old_no, newNo: l.new_no, text: l.text, langId, newText: file.new_text, oldText: file.old_text });
          top += ROW_H.line;
        }
      }
```
Replace with (gap-aware; `langId` is already defined above in this loop):
```tsx
      const newText = file.new_text;
      const newLines = newText != null ? newText.split("\n") : null;
      if (newLines && newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
      const gaps = newLines ? fileGaps(file.hunks, newLines.length) : [];
      const gapByIndex = new Map(gaps.map((g) => [g.beforeHunkIndex, g]));

      const emitGap = (idx: number) => {
        const g = gapByIndex.get(idx);
        if (!g || !newLines) return;
        const key = `${file.path}#${idx}`;
        const r = revealGap(g, expanded.get(key) ?? { top: 0, bottom: 0 }, newLines);
        for (const rl of r.topLines) {
          rows.push({ kind: "line", lineKind: "context", oldNo: rl.oldNo, newNo: rl.newNo, text: rl.text, langId, newText, oldText: file.old_text });
          top += ROW_H.line;
        }
        if (r.remaining > 0) {
          rows.push({ kind: "expander", gapKey: key, canUp: r.canUp, canDown: r.canDown, remaining: r.remaining });
          top += ROW_H.expander;
        }
        for (const rl of r.bottomLines) {
          rows.push({ kind: "line", lineKind: "context", oldNo: rl.oldNo, newNo: rl.newNo, text: rl.text, langId, newText, oldText: file.old_text });
          top += ROW_H.line;
        }
      };

      for (let hi = 0; hi < file.hunks.length; hi++) {
        emitGap(hi);
        const h = file.hunks[hi];
        rows.push({ kind: "hunk", header: h.header });
        top += ROW_H.hunk;
        for (const l of h.lines) {
          rows.push({ kind: "line", lineKind: l.kind, oldNo: l.old_no, newNo: l.new_no, text: l.text, langId, newText: file.new_text, oldText: file.old_text });
          top += ROW_H.line;
        }
      }
      emitGap(file.hunks.length);
```

(e) Pass `expand` to `renderRow`. Change the call site `{renderRow(row, toggle)}` to `{renderRow(row, toggle, expand)}`.

(f) Update `renderRow`'s signature and add the expander branch. Change:
```tsx
function renderRow(row: Row, toggle: (path: string) => void) {
```
to:
```tsx
function renderRow(row: Row, toggle: (path: string) => void, expand: (gapKey: string, dir: "up" | "down") => void) {
```
and add this branch immediately AFTER the `if (row.kind === "info")` block (before the line rendering):
```tsx
  if (row.kind === "expander") {
    return (
      <div className="h-[22px] flex items-center gap-2 px-3 font-mono text-[11px] text-tx-3 bg-bg-2">
        {row.canDown && (
          <button
            aria-label="Expand down"
            onClick={() => expand(row.gapKey, "down")}
            className="px-1.5 rounded text-tx-2 hover:bg-white/10 hover:text-tx-bright"
          >
            ↓
          </button>
        )}
        {row.canUp && (
          <button
            aria-label="Expand up"
            onClick={() => expand(row.gapKey, "up")}
            className="px-1.5 rounded text-tx-2 hover:bg-white/10 hover:text-tx-bright"
          >
            ↑
          </button>
        )}
        <span>{row.remaining} hidden lines</span>
      </div>
    );
  }
```

- [ ] **Step 4: Run the DiffView tests + full suite + build**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: PASS (prior tests + the 2 new expander tests).
Run: `npx vitest run`
Expected: PASS — full suite (investigate failures; do NOT delete tests).
Run: `npm run build`
Expected: `tsc && vite build` succeed (the `Row` union change forces `ROW_H.expander` — already added).

- [ ] **Step 5: Commit**

```bash
git add src/components/DiffView.tsx src/components/DiffView.test.tsx
git commit -m "feat(frontend): reveal hidden diff context with expander controls

- 헌크 사이/위/아래 간격에 ↑/↓ expander 행, 클릭 시 new_text에서 컨텍스트 줄 공개(20씩)
- 공개 줄은 context 행으로 기존 강조 적용, 확장 상태는 changes 재로드 시 초기화"
```

---

## Task 3: Manual verification

**Files:** none (manual QA)

- [ ] **Step 1: Launch** `npm run tauri dev`, open a repo with a file that has changes separated by unchanged regions (e.g. edits near the top and bottom of a long file), open Source Control.

- [ ] **Step 2: Verify**
- An expander row (`↑`/`↓` + "N hidden lines") appears above the first hunk (↑ only), between hunks (↑ and ↓), and after the last hunk (↓ only).
- Clicking ↓ reveals ~20 lines from the top of the gap; ↑ reveals ~20 from the bottom; repeating reveals more; when the gap is fully revealed the expander disappears and the context is continuous.
- Revealed lines are syntax-highlighted and show correct old/new line numbers in the gutters.
- Binary / too-large / deleted files show no expander.
- Refreshing (or editing+saving) resets expansion (no stale/overlapping lines), and the file-list active highlight still tracks scroll correctly.

- [ ] **Step 3: (No commit)** — manual only; commit any fixes referencing the observed defect.

---

## Self-Review Notes

- **Spec coverage:** §2.1 non-null bounds (`hunkBounds`), §2.2 gaps+delta (`fileGaps`), §2.3 totalNewLines trailing-"" pop (flatten step 3d), §3 directions (canDown=hasPrev, canUp=hasNext via revealGap), §4 helper signatures + clamp (Task 1), §5 expander Row/ROW_H/state/reset/expand/flatten/renderRow + `top` accumulation for expander & revealed rows (Task 2), §6 edges (new_text null gate, zero-len gap omitted, all-add → no gaps, no-trailing-newline), §7 tests (diffExpand unit incl. add/del edges + all-add + converging clamp; DiffView reveal + no-new_text), §8 file changes.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `GapSpec`/`RevealLine`/`RevealedGap`, `hunkBounds`/`fileGaps`/`revealGap` signatures match between Task 1 (defs) and Task 2 (usage). `expander` Row fields (`gapKey/canUp/canDown/remaining`) match `renderRow`'s branch. `expand(gapKey, "up"|"down")` matches the handler and call site. `ROW_H` includes `expander` (TS enforces via `Record<Row["kind"], number>`). Revealed "line" rows set `text` to `newLines[L-1]` so the existing `join("")===row.text` highlight guard passes.
