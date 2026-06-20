# Persistent EditorView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-file CodeMirror remount (`key={activeTab.path}`) with a single persistent `EditorView` that swaps `EditorState` per file and caches state per path, so file switches are instant and preserve undo/cursor/scroll within a session.

**Architecture:** Extract the CodeMirror extension set into a pure `buildEditorState()` helper. Rewrite `EditorPane` to mount one `EditorView` for its lifetime, holding a `Map<path, EditorState>` cache, a `Map<path, scrollTop>` cache, a `currentPathRef`, and a `propsRef` (assigned during render). Switching files saves the outgoing state + scroll + doc, then `view.setState()` loads the cached or freshly-built state, explicitly reports the cursor (since `setState` does not fire the update listener), and restores scroll. A separate effect prunes caches for closed tabs.

**Tech Stack:** React 19 + TypeScript, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`), Vitest + Testing Library (jsdom).

**Reference spec:** `docs/superpowers/specs/2026-06-21-persistent-editor-view-design.md`

---

## File Structure

- **Create** `src/lib/editorState.ts` — pure helpers: `buildEditorState(doc, languageId, callbacksRef)` (the CodeMirror extension set + state factory) and `pruneByKeys(map, keep)` (cache eviction). One responsibility: constructing/maintaining editor state, isolated from React.
- **Create** `src/lib/editorState.test.ts` — unit tests for both helpers (headless, no DOM needed for `EditorState.create`).
- **Modify** `src/components/EditorPane.tsx` — rewrite to a persistent single view with the per-path caches and switch/reveal/evict effects.
- **Modify (migrate + extend)** `src/components/EditorPane.test.tsx` — this file ALREADY EXISTS with 6 tests written against the old `path` prop API. Migrate them (`path` → `activePath`, add `openPaths`) and ADD 3 persistence tests (no-remount, content swap on switch, outgoing-doc persist + cursor report on switch). Do NOT overwrite/drop the existing 6.
- **Modify** `src/App.tsx` — remove `key`, pass `activePath` + memoized `openPaths`.

---

## Task 1: Extract `buildEditorState` and `pruneByKeys` helpers

**Files:**
- Create: `src/lib/editorState.ts`
- Test: `src/lib/editorState.test.ts`

This isolates the CodeMirror extension graph (currently inline in `EditorPane`) into a testable factory, and provides the cache-eviction primitive. The `updateListener` and save keymap read callbacks through a ref so cached states always invoke the latest handlers.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/editorState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildEditorState, pruneByKeys } from "./editorState";

const callbacks = { current: { onChange: () => {}, onSave: () => {} } };

describe("buildEditorState", () => {
  it("creates a state holding the given document", () => {
    const state = buildEditorState("line1\nline2", "typescript", callbacks);
    expect(state.doc.toString()).toBe("line1\nline2");
    expect(state.doc.lines).toBe(2);
  });

  it("starts with the cursor at the document start", () => {
    const state = buildEditorState("abc", "typescript", callbacks);
    expect(state.selection.main.head).toBe(0);
  });
});

describe("pruneByKeys", () => {
  it("removes keys that are not in the keep list", () => {
    const m = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
    pruneByKeys(m, ["a", "c"]);
    expect([...m.keys()]).toEqual(["a", "c"]);
  });

  it("keeps all present keys even if the keep list has extras", () => {
    const m = new Map<string, number>([["a", 1]]);
    pruneByKeys(m, ["a", "b"]);
    expect(m.has("a")).toBe(true);
    expect(m.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/editorState.test.ts`
Expected: FAIL — `Failed to resolve import "./editorState"` (module does not exist yet).

- [ ] **Step 3: Implement the helpers**

Create `src/lib/editorState.ts`:

```ts
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { zkTheme } from "./editorTheme";
import { languageExtension } from "./language";
import { cursorInfo, type CursorInfo } from "./cursorInfo";

export interface EditorCallbacks {
  onChange: (doc: string) => void;
  onSave: (doc: string) => void;
  onCursorChange?: (info: CursorInfo) => void;
}

/**
 * Builds a fresh EditorState with the editor's full extension set and the
 * given document/language. Callbacks are read through a ref at event time so
 * cached states always invoke the latest handlers.
 */
export function buildEditorState(
  doc: string,
  languageId: string,
  callbacks: { current: EditorCallbacks }
): EditorState {
  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      run: (view) => {
        callbacks.current.onSave(view.state.doc.toString());
        return true;
      },
    },
  ]);
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      saveKeymap,
      languageExtension(languageId),
      zkTheme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
        if (u.docChanged || u.selectionSet) {
          callbacks.current.onCursorChange?.(cursorInfo(u.state));
        }
      }),
    ],
  });
}

/** Deletes every key of `map` that is not present in `keep`. */
export function pruneByKeys<T>(map: Map<string, T>, keep: string[]): void {
  const open = new Set(keep);
  for (const key of [...map.keys()]) {
    if (!open.has(key)) map.delete(key);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/editorState.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the build is still green**

Run: `npm run build`
Expected: `tsc` and `vite build` succeed (the new module is not yet imported anywhere, so nothing else changes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/editorState.ts src/lib/editorState.test.ts
git commit -m "feat(frontend): extract buildEditorState and pruneByKeys helpers

- EditorState 팩토리와 확장 집합을 순수 함수로 분리(테스트 용이)
- 캐시 evict용 pruneByKeys set-difference 헬퍼 추가"
```

---

## Task 2: Rewrite EditorPane as a persistent view and rewire App

**Files:**
- Modify: `src/components/EditorPane.tsx` (full rewrite of the body)
- Modify: `src/App.tsx` (EditorPane render site + `openPaths` memo + `useMemo` import)
- Modify (migrate + extend): `src/components/EditorPane.test.tsx` (already has 6 tests on the old `path` API)

EditorPane's prop interface changes (`path` → `activePath`, add `openPaths`), so the App render site AND the existing test file must change in the same commit to keep the build green. The component test drives switches by re-rendering with a new `activePath`.

- [ ] **Step 1: Migrate the existing tests and add the persistence tests**

Replace the entire contents of `src/components/EditorPane.test.tsx` with the following. The first 6 tests are the existing ones migrated to the new prop API (`path` → `activePath`, `openPaths` added); the last 3 are new:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { EditorPane } from "./EditorPane";

describe("EditorPane", () => {
  it("renders a left line-number gutter for each line", () => {
    const { container } = render(
      <EditorPane
        activePath="/p/multi.ts"
        openPaths={["/p/multi.ts"]}
        languageId="typescript"
        initialDoc={"first\nsecond\nthird"}
        onChange={() => {}}
        onSave={() => {}}
      />
    );
    const gutter = container.querySelector(".cm-lineNumbers");
    expect(gutter).not.toBeNull();
    const numbers = Array.from(gutter!.querySelectorAll(".cm-gutterElement")).map(
      (el) => el.textContent
    );
    expect(numbers).toContain("1");
    expect(numbers).toContain("2");
    expect(numbers).toContain("3");
  });

  it("renders the document text into the editor", () => {
    const { container } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc="const x = 1;"
        onChange={() => {}}
        onSave={() => {}}
      />
    );
    const line = container.querySelector(".cm-line") as HTMLElement;
    expect(line).toBeInTheDocument();
    expect(line.textContent).toMatch(/const x = 1;/);
  });

  it("calls onChange when the document is edited", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc=""
        onChange={onChange}
        onSave={() => {}}
      />
    );
    const editable = container.querySelector(".cm-content") as HTMLElement;
    editable.focus();
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.type(editable, "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("reveals a match: selects the range and is clamped to the doc", async () => {
    const { container, rerender } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc={"line one\nline two\nline three"}
        onChange={() => {}}
        onSave={() => {}}
      />
    );
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    rerender(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
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

  it("calls onPersist with the current doc when unmounted", async () => {
    const onPersist = vi.fn();
    const { unmount, container } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
        languageId="typescript"
        initialDoc="start"
        onChange={() => {}}
        onSave={() => {}}
        onPersist={onPersist}
      />
    );
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    view.dispatch({ changes: { from: 5, insert: "X" } }); // "startX"
    unmount();
    expect(onPersist).toHaveBeenCalledWith("/p/a.ts", "startX");
  });

  it("reports the cursor on mount and on selection change", async () => {
    const onCursorChange = vi.fn();
    const { container } = render(
      <EditorPane
        activePath="/p/a.ts"
        openPaths={["/p/a.ts"]}
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

  // --- persistent-view behavior (new) ---

  it("keeps the same EditorView DOM across a file switch (no remount)", () => {
    const props = {
      activePath: "/a.ts",
      openPaths: ["/a.ts"],
      languageId: "typescript",
      initialDoc: "alpha",
      onChange: vi.fn(),
      onSave: vi.fn(),
    };
    const { container, rerender } = render(<EditorPane {...props} />);
    const before = container.querySelector(".cm-editor");
    expect(before).not.toBeNull();
    rerender(
      <EditorPane {...props} activePath="/b.ts" openPaths={["/a.ts", "/b.ts"]} initialDoc="beta" />
    );
    const after = container.querySelector(".cm-editor");
    expect(after).toBe(before); // same node → view was not destroyed/recreated
  });

  it("swaps the document content on a file switch", async () => {
    const props = {
      activePath: "/a.ts",
      openPaths: ["/a.ts"],
      languageId: "typescript",
      initialDoc: "alpha",
      onChange: vi.fn(),
      onSave: vi.fn(),
    };
    const { container, rerender } = render(<EditorPane {...props} />);
    rerender(
      <EditorPane {...props} activePath="/b.ts" openPaths={["/a.ts", "/b.ts"]} initialDoc="beta" />
    );
    const { EditorView } = await import("@codemirror/view");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    expect(view.state.doc.toString()).toBe("beta");
  });

  it("persists the outgoing doc and reports the cursor on switch", () => {
    const onPersist = vi.fn();
    const onCursorChange = vi.fn();
    const props = {
      activePath: "/a.ts",
      openPaths: ["/a.ts"],
      languageId: "typescript",
      initialDoc: "alpha",
      onChange: vi.fn(),
      onSave: vi.fn(),
      onPersist,
      onCursorChange,
    };
    const { rerender } = render(<EditorPane {...props} />);
    onCursorChange.mockClear();
    rerender(
      <EditorPane {...props} activePath="/b.ts" openPaths={["/a.ts", "/b.ts"]} initialDoc="beta" />
    );
    expect(onPersist).toHaveBeenCalledWith("/a.ts", "alpha");
    expect(onCursorChange).toHaveBeenCalled(); // setState does not fire it; we report explicitly
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: FAIL — the current EditorPane still uses the `path` prop, so the migrated tests pass `activePath`/`openPaths` (ignored) and the 3 new persistence tests fail (no `onPersist("/a.ts","alpha")` on a prop change; content does not swap because the old code only rebuilds on `key`). Assertion-time failures (vitest does not run `tsc`).

- [ ] **Step 3: Rewrite `EditorPane.tsx`**

Replace the entire contents of `src/components/EditorPane.tsx` with:

```tsx
import { useEffect, useRef } from "react";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildEditorState, pruneByKeys } from "../lib/editorState";
import { cursorInfo, type CursorInfo } from "../lib/cursorInfo";

interface Props {
  activePath: string;
  openPaths: string[];
  languageId: string;
  initialDoc: string;
  onChange: (doc: string) => void;
  onSave: (doc: string) => void;
  onPersist?: (path: string, doc: string) => void;
  onCursorChange?: (info: CursorInfo) => void;
  reveal?: { line: number; matchStart: number; matchEnd: number; seq: number };
}

export function EditorPane({
  activePath,
  openPaths,
  languageId,
  initialDoc,
  onChange,
  onSave,
  onPersist,
  onCursorChange,
  reveal,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cacheRef = useRef(new Map<string, EditorState>());
  const scrollRef = useRef(new Map<string, number>());
  const currentPathRef = useRef<string | null>(null);
  // Assigned during render (not in an effect) so every effect reads the latest
  // committed props. buildEditorState reads onChange/onSave/onCursorChange here.
  const propsRef = useRef({
    languageId,
    initialDoc,
    openPaths,
    onChange,
    onSave,
    onPersist,
    onCursorChange,
  });
  propsRef.current = {
    languageId,
    initialDoc,
    openPaths,
    onChange,
    onSave,
    onPersist,
    onCursorChange,
  };

  // Mount once: create the single persistent view for the initial file.
  useEffect(() => {
    if (!hostRef.current) return;
    const p = propsRef.current;
    const state = buildEditorState(p.initialDoc, p.languageId, propsRef);
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    currentPathRef.current = activePath;
    cacheRef.current.set(activePath, view.state);
    p.onCursorChange?.(cursorInfo(view.state));
    return () => {
      const cur = currentPathRef.current;
      if (cur) propsRef.current.onPersist?.(cur, view.state.doc.toString());
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch files: save the outgoing state/scroll/doc, then swap in the target.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activePath) return;
    const prev = currentPathRef.current;
    if (prev === activePath) return; // includes the first render (set in mount)
    const p = propsRef.current;
    if (prev != null && p.openPaths.includes(prev)) {
      cacheRef.current.set(prev, view.state);
      scrollRef.current.set(prev, view.scrollDOM.scrollTop);
      p.onPersist?.(prev, view.state.doc.toString());
    }
    const state =
      cacheRef.current.get(activePath) ??
      buildEditorState(p.initialDoc, p.languageId, propsRef);
    view.setState(state);
    // setState does NOT fire the updateListener, so report the cursor explicitly.
    p.onCursorChange?.(cursorInfo(view.state));
    // setState does NOT restore scroll either — re-apply the saved offset.
    const top = scrollRef.current.get(activePath);
    if (top != null) {
      view.requestMeasure({
        read: () => {},
        write: () => {
          if (viewRef.current) viewRef.current.scrollDOM.scrollTop = top;
        },
      });
    }
    currentPathRef.current = activePath;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // Reveal a search match (declared after the switch effect so the target doc
  // is already loaded). Keeps focus in the search panel (no view.focus()).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq]);

  // Evict cached states/scroll for tabs that are no longer open. Declared last
  // so it runs after the switch effect in a shared commit (e.g. closing a tab).
  useEffect(() => {
    pruneByKeys(cacheRef.current, openPaths);
    pruneByKeys(scrollRef.current, openPaths);
  }, [openPaths]);

  return <div className="editor-host" ref={hostRef} />;
}
```

- [ ] **Step 4: Rewire the EditorPane render site in `App.tsx`**

In `src/App.tsx`, add `useMemo` to the React import:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

Add a memoized `openPaths` next to the `activeTab` derivation (after `const activeTab = tabs.find(...) ?? null;`):

```tsx
  const openPaths = useMemo(() => tabs.map((t) => t.path), [tabs]);
```

Replace the `<EditorPane .../>` element (remove `key`, rename `path` → `activePath`, add `openPaths`):

```tsx
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
```

- [ ] **Step 5: Run the component test to verify it passes**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: PASS (9 tests — 6 migrated + 3 new).

- [ ] **Step 6: Run the full suite and the build**

Run: `npx vitest run`
Expected: PASS — baseline is **113** (which already includes the 6 EditorPane tests). After this work: +4 from `editorState.test.ts` and +3 new EditorPane tests (the 6 are migrated in place, net 0) → **120 total**. Confirm all files pass.

Run: `npm run build`
Expected: `tsc` and `vite build` succeed with no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/EditorPane.tsx src/components/EditorPane.test.tsx src/App.tsx
git commit -m "perf(frontend): persistent EditorView with per-path state cache

- key 리마운트 제거, 단일 EditorView 유지하며 view.setState로 파일 전환
- 경로별 EditorState/scrollTop 캐시로 재방문 시 재파싱 없이 undo/커서/스크롤 보존
- setState가 updateListener를 발화하지 않으므로 전환 후 커서 명시 보고
- 닫힌 탭은 pruneByKeys로 캐시에서 정리"
```

---

## Task 3: Manual verification in the real app

**Files:** none (manual QA)

jsdom cannot exercise real CodeMirror layout, scrolling, focus, or Lezer parse timing, so verify these behaviors in the running app.

- [ ] **Step 1: Launch the app**

Run: `npm run tauri dev`
Expected: app builds and opens.

- [ ] **Step 2: Verify switch performance and state preservation**

Open a workspace folder with at least one large TS/TSX file. Then check:
- Open two files, switch between them via the tab bar — switching back is instant (no visible re-parse flash).
- In file A: scroll down, place the caret mid-file, type a few characters (undoable), then switch to B and back — caret position, scroll position, and undo history (Cmd+Z restores the typed chars) are preserved.
- Status bar Ln/Col updates immediately on switch (not stale from the previous file).
- Search a term, use ↑/↓ to navigate matches — the editor reveals the match line and keyboard focus stays in the search input.
- Type continuously in a file — only the first keystroke flips the dirty dot; typing stays smooth.
- Close a tab and reopen the same file — it loads correctly (cache was pruned, rebuilt from disk).

Expected: all behaviors hold. If any fail, use superpowers:systematic-debugging before patching.

- [ ] **Step 3: (No commit)** — manual verification only. If fixes were needed, commit them with a descriptive message referencing the observed defect.

---

## Self-Review Notes

- **Spec coverage:** §2 architecture (Task 2 EditorPane + App), §2.3 buildState/no-Compartment (Task 1), §3.1 mount + currentPathRef seed (Task 2 mount effect), §3.2 switch effect with open-tab guard + C1 cursor report + I3 scroll restore (Task 2), §3.3 reveal ordering (Task 2, declared after switch), §3.4 evict + `useMemo(openPaths)` (Task 2 evict effect + App memo), §4 docs/onPersist (Task 2 preserves `persistDoc`), §5 setState-not-dirty / focus (covered by using `setState` not dispatch; verified in Task 3), §6 file changes (all tasks), §7 testing (Tasks 1–3), §8 edge cases (mount no-op, async open, active-tab-close guard — all in Task 2 code).
- **No placeholders:** every step has concrete code/commands.
- **Type consistency:** `buildEditorState(doc, languageId, callbacksRef)` and `pruneByKeys(map, keep)` signatures are identical across Task 1 (definition), Task 1 tests, and Task 2 (usage in EditorPane). `propsRef` is structurally assignable to `{ current: EditorCallbacks }` because it includes `onChange`/`onSave`/`onCursorChange`.
