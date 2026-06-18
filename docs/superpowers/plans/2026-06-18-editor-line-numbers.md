# Editor Line Numbers (VS Code-style gutter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a left-hand line-number gutter (with active-line highlight) in the editor, like VS Code.

**Architecture:** CodeMirror 6 already provides the gutter as built-in extensions in `@codemirror/view` (already a dependency). The zkDark theme (`src/lib/editorTheme.ts`) already styles `.cm-gutters`, `.cm-lineNumbers .cm-gutterElement`, `.cm-activeLineGutter`, and `.cm-activeLine` — those rules are currently inert because the extensions that produce the gutter/active-line aren't enabled. This change just adds `lineNumbers()`, `highlightActiveLineGutter()`, and `highlightActiveLine()` to `EditorPane`'s extension list. No new dependencies, no theme changes.

**Tech Stack:** React 18 + TypeScript, CodeMirror 6 (`@codemirror/view`), Vitest.

**Decisions (sensible defaults — VS Code parity):**
- Absolute line numbers (CodeMirror default), not relative.
- Include active-line + active-line-gutter highlight (the theme already styles them, so this makes the current line stand out like VS Code).

---

## Task 1: Enable the line-number gutter and active-line highlight in EditorPane

**Files:**
- Modify: `src/components/EditorPane.tsx`
- Test: `src/components/EditorPane.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `src/components/EditorPane.test.tsx`:
```tsx
  it("renders a left line-number gutter for each line", () => {
    const { container } = render(
      <EditorPane
        path="/p/multi.ts"
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
    // CodeMirror renders a spacer gutter element plus one per line; assert the
    // visible line numbers are present.
    expect(numbers).toContain("1");
    expect(numbers).toContain("2");
    expect(numbers).toContain("3");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: FAIL — `.cm-lineNumbers` is null (no gutter extension enabled).

- [ ] **Step 3: Implement** — in `src/components/EditorPane.tsx`:

Update the `@codemirror/view` import to add the three extensions (merge with the existing import on line 3):
```ts
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
```

Add them to the `extensions` array in `EditorState.create(...)`, before `language.of(...)` (gutter first is conventional):
```ts
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        saveKeymap,
        language.of(languageExtension(languageId)),
        zkTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbRef.current.onChange(u.state.doc.toString());
        }),
      ],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/EditorPane.test.tsx`
Expected: PASS (the new gutter test plus the existing EditorPane tests — render, change, reveal).

- [ ] **Step 5: Run the full suite + build**

Run: `npm run test` then `npm run build`
Expected: all 52 tests pass; build clean.

- [ ] **Step 6: Manual check (deferred to user, native run)**

`source "$HOME/.cargo/env" && npm run tauri dev` → open a file → a line-number gutter shows on the left; the current line and its gutter number are subtly highlighted. (Layout/visual, not covered by headless tests.)

- [ ] **Step 7: Commit**
```bash
git add -A
git commit -m "feat(frontend): add line-number gutter and active-line highlight to editor"
```

---

## Self-Review (completed by plan author)

**Coverage:** Single requirement — VS Code-style left line numbers — implemented in Task 1 via `lineNumbers()` + active-line extensions; theme styling already present. ✓

**Placeholder scan:** No TBD/TODO; full code in every step.

**Type/consistency:** All three extensions (`lineNumbers`, `highlightActiveLine`, `highlightActiveLineGutter`) are exports of `@codemirror/view` (already a dependency — no Cargo/npm change). The existing import already pulls `EditorView, keymap` from the same module; the plan extends that one import. No new symbols referenced elsewhere.

**Known minor note (non-blocking):** the gutter test asserts specific line-number text in jsdom; CodeMirror renders gutter elements in jsdom, but if the exact `.cm-gutterElement` set proves environment-sensitive, relax the assertion to `expect(gutter).not.toBeNull()` plus `expect(gutter!.textContent).toMatch(/1/)` — the behavior under test (gutter is enabled) is unchanged.
