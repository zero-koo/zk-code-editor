# Status Bar Cursor Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the cursor position (`Ln, Col`) and selection size in the status bar, driven by the real CodeMirror selection.

**Architecture:** A pure `cursorInfo(state)` helper derives `{line, col, selection}` from a CodeMirror `EditorState`. `EditorPane` reports it via a new `onCursorChange` callback (on mount + on selection/doc changes). `App` holds it in state and passes it (only while a tab is active) to `StatusBar`, which renders `Ln L, Col C` + `(N selected)`.

**Tech Stack:** React 18 + TypeScript, CodeMirror 6 (`@codemirror/state`/`view`), Vitest + Testing Library.

---

## Conventions
- Paths relative to project root `/Users/zerokoo/Projects/zerokoo/zk-code-editor`.
- Single test: `npx vitest run <path>`; full: `npm run test`. Build: `npm run build`.
- Commit after every task. Conventional Commits. **No `Co-Authored-By`.** Body bullets `- `.
- TDD. After each task: full suite + build green.

## File Structure
- `src/lib/cursorInfo.ts` (new) — `CursorInfo` type + `cursorInfo(state)` pure helper.
- `src/components/StatusBar.tsx` (modify) — add `cursor` prop + render.
- `src/components/EditorPane.tsx` (modify) — `onCursorChange` callback.
- `src/App.tsx` (modify) — `cursor` state + wiring.
- Tests: `cursorInfo.test.ts`, `StatusBar.test.tsx`, `EditorPane.test.tsx`, `App.test.tsx`.

---

## Task 1: cursorInfo helper

**Files:** Create `src/lib/cursorInfo.ts`, `src/lib/cursorInfo.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/cursorInfo.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { cursorInfo } from "./cursorInfo";

describe("cursorInfo", () => {
  it("reports line 1, col 1 at the document start", () => {
    const s = EditorState.create({ doc: "hello\nworld" });
    expect(cursorInfo(s)).toEqual({ line: 1, col: 1, selection: 0 });
  });

  it("computes line and column for a cursor on line 2", () => {
    // "hello\nworld": offset 8 is on line 2 ("world"), line.from = 6 → col = 3
    const s = EditorState.create({ doc: "hello\nworld", selection: { anchor: 8 } });
    expect(cursorInfo(s)).toEqual({ line: 2, col: 3, selection: 0 });
  });

  it("sums the selection length", () => {
    const s = EditorState.create({ doc: "hello world", selection: { anchor: 0, head: 5 } });
    expect(cursorInfo(s).selection).toBe(5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/cursorInfo.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/lib/cursorInfo.ts`:
```ts
import type { EditorState } from "@codemirror/state";

export interface CursorInfo {
  line: number; // 1-based
  col: number; // 1-based (head offset within its line + 1)
  selection: number; // total selected characters across all ranges (0 if none)
}

export function cursorInfo(state: EditorState): CursorInfo {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const selection = state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
  return { line: line.number, col: head - line.from + 1, selection };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/cursorInfo.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add cursorInfo helper for status bar"
```

---

## Task 2: StatusBar shows cursor position

**Files:** Modify `src/components/StatusBar.tsx`, `src/components/StatusBar.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `src/components/StatusBar.test.tsx`:
```tsx
  it("shows the cursor position", () => {
    render(<StatusBar path="/p/a.ts" languageId="typescript" cursor={{ line: 2, col: 5, selection: 0 }} />);
    expect(screen.getByText(/Ln 2, Col 5/)).toBeInTheDocument();
  });

  it("shows the selection count when text is selected", () => {
    render(<StatusBar path="/p/a.ts" languageId="typescript" cursor={{ line: 1, col: 3, selection: 4 }} />);
    expect(screen.getByText(/4 selected/)).toBeInTheDocument();
  });

  it("omits cursor info when cursor is null", () => {
    render(<StatusBar path="/p/a.ts" languageId="typescript" cursor={null} />);
    expect(screen.queryByText(/Ln /)).not.toBeInTheDocument();
  });
```
(The existing path/language tests call `<StatusBar path=… languageId=… />` without `cursor`; keep them — `cursor` is optional.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/StatusBar.test.tsx`
Expected: FAIL — `cursor` prop / `Ln …` text not rendered.

- [ ] **Step 3: Implement** — replace `src/components/StatusBar.tsx` with:
```tsx
import { languageLabel } from "../lib/language";
import type { CursorInfo } from "../lib/cursorInfo";

interface Props {
  path: string | null;
  languageId: string | null;
  cursor?: CursorInfo | null;
}

export function StatusBar({ path, languageId, cursor }: Props) {
  return (
    <div
      className="h-[30px] shrink-0 flex items-center px-3.5 bg-bg-1 border-t border-bd-2 text-[11.5px] text-tx-2"
      data-testid="statusbar"
    >
      {path && <span className="text-tx-2">{path}</span>}
      <span className="flex-1" />
      <div className="flex items-center gap-4">
        {cursor && (
          <span>
            Ln {cursor.line}, Col {cursor.col}
            {cursor.selection > 0 && ` (${cursor.selection} selected)`}
          </span>
        )}
        {languageId && (
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            {languageLabel(languageId)}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/StatusBar.test.tsx`
Expected: all pass (new + existing).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): show cursor position in the status bar"
```

---

## Task 3: EditorPane reports cursor + App wiring

**Files:** Modify `src/components/EditorPane.tsx`, `src/App.tsx`; Test `src/components/EditorPane.test.tsx`, `src/App.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/components/EditorPane.test.tsx`:
```tsx
  it("reports the cursor on mount and on selection change", async () => {
    const onCursorChange = vi.fn();
    const { container } = render(
      <EditorPane
        path="/p/a.ts"
        languageId="typescript"
        initialDoc={"abc\ndef"}
        onChange={() => {}}
        onSave={() => {}}
        onCursorChange={onCursorChange}
      />
    );
    expect(onCursorChange).toHaveBeenCalled(); // initial report
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    onCursorChange.mockClear();
    view.dispatch({ selection: { anchor: 5 } }); // offset 5 → line 2 of "abc\ndef"
    expect(onCursorChange).toHaveBeenCalledWith(expect.objectContaining({ line: 2 }));
  });
```

Add to `src/App.test.tsx` (in the existing "opening a folder then a file" flow it already opens `/proj/a.ts`; add a separate test):
```tsx
  it("shows the cursor position once a file is open", async () => {
    open.mockResolvedValue("/proj");
    readDir.mockResolvedValue([{ name: "a.ts", path: "/proj/a.ts", is_dir: false }]);
    readFile.mockResolvedValue({ kind: "text", text: "const x = 1;" });

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /open folder/i }));
    await userEvent.click(await screen.findByText("a.ts"));
    expect(await screen.findByText(/Ln 1, Col 1/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/EditorPane.test.tsx src/App.test.tsx`
Expected: FAIL — `onCursorChange` unknown / no `Ln …` text.

- [ ] **Step 3: Implement EditorPane** — in `src/components/EditorPane.tsx`:
- Add imports:
```tsx
import { cursorInfo, type CursorInfo } from "../lib/cursorInfo";
```
- Add to `Props`:
```tsx
  onCursorChange?: (info: CursorInfo) => void;
```
- Destructure `onCursorChange` in the component signature and include it in the `cbRef` object:
```tsx
  const cbRef = useRef({ onChange, onSave, onPersist, onCursorChange });
  cbRef.current = { onChange, onSave, onPersist, onCursorChange };
```
- In the mount effect, after `const view = new EditorView({ state, parent: hostRef.current });` and `viewRef.current = view;`, report the initial cursor:
```tsx
    cbRef.current.onCursorChange?.(cursorInfo(view.state));
```
- In the existing `EditorView.updateListener.of((u) => { … })`, report on selection/doc change (keep the existing `onChange` line):
```tsx
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbRef.current.onChange(u.state.doc.toString());
          if (u.docChanged || u.selectionSet) {
            cbRef.current.onCursorChange?.(cursorInfo(u.state));
          }
        }),
```

- [ ] **Step 4: Implement App wiring** — in `src/App.tsx`:
- Add import:
```tsx
import type { CursorInfo } from "./lib/cursorInfo";
```
- Add state near the other `useState`s:
```tsx
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
```
- Add `onCursorChange={setCursor}` as an **additional prop on the existing `<EditorPane …/>` element** (do not duplicate the element — it already has `path`/`languageId`/`initialDoc`/`onChange`/`onSave`/`onPersist`/`reveal`; just add one more prop line):
```tsx
            onCursorChange={setCursor}
```
- **Replace the existing `<StatusBar …/>` element** (currently a 2-prop call) with the 3-prop version below. Keep the `cursor={activeTab ? cursor : null}` gate **exactly** — it is load-bearing: when the last tab closes, EditorPane unmounts and fires no callback, so `cursor` would otherwise show a stale position; the gate masks it.
```tsx
        <StatusBar
          path={activeTab?.path ?? null}
          languageId={activeTab?.languageId ?? null}
          cursor={activeTab ? cursor : null}
        />
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/components/EditorPane.test.tsx src/App.test.tsx`
Expected: all pass.

- [ ] **Step 6: Run full suite + build**

Run: `npm run test` then `npm run build`
Expected: all pass; build clean.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat(frontend): report editor cursor position to the status bar"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §2.1 `cursorInfo` helper (line/col/selection, exact formula) — Task 1. ✓
- §2.2 EditorPane `onCursorChange` (mount + docChanged/selectionSet) — Task 3. ✓
- §2.3 App `cursor` state, gated `cursor={activeTab ? cursor : null}` — Task 3. ✓
- §2.4 StatusBar render (`Ln L, Col C` + `(N selected)`, language kept, testid kept) — Task 2. ✓
- §4 edges (no active tab → null; selection 0 → no "selected") — StatusBar gating (Task 2) + App gating (Task 3). ✓
- §5 tests (cursorInfo pure, StatusBar render, EditorPane report) + App integration — Tasks 1–3. ✓
- §6 non-goals — nothing beyond scope. ✓

**Placeholder scan:** No TBD/TODO; full code in every step.

**Type consistency:** `CursorInfo {line, col, selection}` defined in Task 1 and consumed identically in StatusBar (Task 2), EditorPane (`onCursorChange?: (info: CursorInfo) => void`), and App (`useState<CursorInfo | null>`). `cursorInfo(state)` signature consistent.

**Known minor notes (non-blocking):**
- `col` is UTF-16-code-unit based (tabs count as 1) per spec — not tab-aware. Intentional (non-goal).
- The EditorPane cursor test relies on `EditorView.findFromDOM` + a dispatched selection transaction, the same pattern already used by the existing reveal/gutter tests in that file — known to work in this jsdom setup.
