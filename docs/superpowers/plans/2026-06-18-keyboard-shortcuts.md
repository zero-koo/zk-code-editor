# Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add view-switching shortcuts (`Cmd/Ctrl+Shift+E` → Explorer, `Cmd/Ctrl+Shift+F` → Search) and a read-only "Keyboard Shortcuts" modal opened by `Cmd/Ctrl+/` or an ActivityBar button.

**Architecture:** A central registry (`src/lib/shortcuts.ts`) is the single source of truth for shortcut data + pure match/format helpers. A `useGlobalShortcuts` hook attaches one **capture-phase** `window` keydown listener that matches events against the registry and runs App-provided handlers (calling `preventDefault`+`stopPropagation` so CodeMirror's `Mod-/` comment-toggle never fires). A `ShortcutsModal` renders the registry grouped, with a filter and `kbd` chips.

**Tech Stack:** React 18 + TypeScript + Tailwind, Vitest + Testing Library.

---

## Conventions
- Paths relative to project root `/Users/zerokoo/Projects/zerokoo/zk-code-editor`.
- Single test: `npx vitest run <path>`; full: `npm run test`. Build: `npm run build`.
- **jsdom note:** `isMac` is computed from `navigator` and is **false** in jsdom, so tests that dispatch real `KeyboardEvent`s use **Ctrl**-based combos (not Meta). Pure-function tests pass `mac` explicitly to cover both platforms.
- Commit after every task. Conventional Commits. **No `Co-Authored-By`.** Body bullets `- `.
- TDD throughout.

## File Structure
- `src/lib/shortcuts.ts` (new) — types, `SHORTCUTS`, `isMac`, `matchKeyEvent`, `formatCombo` + tests.
- `src/hooks/useGlobalShortcuts.ts` (new) — capture-phase window listener + tests.
- `src/components/ShortcutsModal.tsx` (new) — modal UI + tests.
- `src/components/ActivityBar.tsx` (modify) — add bottom "Keyboard Shortcuts" button; rewrite its test.
- `src/App.tsx` (modify) — wire handlers, modal open state, render modal, pass button handler; integration tests.

---

## Task 1: Shortcut registry + pure helpers

**Files:** Create `src/lib/shortcuts.ts`, `src/lib/shortcuts.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/shortcuts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SHORTCUTS, matchKeyEvent, formatCombo } from "./shortcuts";

function kd(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("matchKeyEvent", () => {
  const combo = { mod: true, shift: true, key: "e" };
  it("matches Cmd+Shift+E on mac", () => {
    expect(matchKeyEvent(kd({ key: "e", metaKey: true, shiftKey: true }), combo, true)).toBe(true);
  });
  it("matches Ctrl+Shift+E off-mac", () => {
    expect(matchKeyEvent(kd({ key: "E", ctrlKey: true, shiftKey: true }), combo, false)).toBe(true);
  });
  it("does not match when an extra modifier is held", () => {
    expect(matchKeyEvent(kd({ key: "e", metaKey: true, shiftKey: true, altKey: true }), combo, true)).toBe(false);
  });
  it("does not match when the cross-platform modifier is held", () => {
    // on mac, ctrl must never be down for our combos
    expect(matchKeyEvent(kd({ key: "e", metaKey: true, shiftKey: true, ctrlKey: true }), combo, true)).toBe(false);
  });
  it("does not match a missing modifier", () => {
    expect(matchKeyEvent(kd({ key: "e", metaKey: true }), combo, true)).toBe(false); // no shift
  });
  it("save (Cmd+S) does not fire when Shift is held", () => {
    const save = { mod: true, key: "s" };
    expect(matchKeyEvent(kd({ key: "s", metaKey: true }), save, true)).toBe(true);
    expect(matchKeyEvent(kd({ key: "s", metaKey: true, shiftKey: true }), save, true)).toBe(false);
  });
});

describe("formatCombo", () => {
  it("uses mac symbols", () => {
    expect(formatCombo({ mod: true, shift: true, key: "e" }, true)).toEqual(["⌘", "⇧", "E"]);
  });
  it("uses PC labels", () => {
    expect(formatCombo({ mod: true, shift: true, key: "e" }, false)).toEqual(["Ctrl", "Shift", "E"]);
  });
  it("renders the slash key literally", () => {
    expect(formatCombo({ mod: true, key: "/" }, true)).toEqual(["⌘", "/"]);
  });
});

describe("SHORTCUTS registry", () => {
  it("contains the four v1 shortcuts with stable ids", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids).toEqual(["view.explorer", "view.search", "file.save", "help.shortcuts"]);
  });
  it("marks save as displayOnly and the rest as actionable", () => {
    const actionable = SHORTCUTS.filter((s) => !s.displayOnly).map((s) => s.id);
    expect(actionable).toEqual(["view.explorer", "view.search", "help.shortcuts"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/shortcuts.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/lib/shortcuts.ts`:
```ts
export interface KeyCombo {
  mod?: boolean; // ⌘ on mac, Ctrl elsewhere
  shift?: boolean;
  alt?: boolean;
  key: string; // e.key value; letters lowercase, e.g. "e", "f", "s", "/"
}

export interface Shortcut {
  id: string;
  label: string;
  group: string;
  combo: KeyCombo;
  displayOnly?: boolean; // handled elsewhere (e.g. CodeMirror); shown but not globally bound
}

export const SHORTCUTS: Shortcut[] = [
  { id: "view.explorer", label: "Show Explorer", group: "View", combo: { mod: true, shift: true, key: "e" } },
  { id: "view.search", label: "Show Search", group: "View", combo: { mod: true, shift: true, key: "f" } },
  // Save is handled by CodeMirror's Mod-s keymap (see EditorPane); listed here for display only.
  { id: "file.save", label: "Save", group: "File", combo: { mod: true, key: "s" }, displayOnly: true },
  { id: "help.shortcuts", label: "Keyboard Shortcuts", group: "Help", combo: { mod: true, key: "/" } },
];

export const isMac =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent || "");

/** Exact modifier match. `mod` → metaKey on mac / ctrlKey elsewhere; the other
 * platform modifier must never be held; shift/alt must match exactly. */
export function matchKeyEvent(e: KeyboardEvent, combo: KeyCombo, mac: boolean): boolean {
  const modActive = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (otherMod) return false;
  if (!!combo.mod !== modActive) return false;
  if (!!combo.shift !== e.shiftKey) return false;
  if (!!combo.alt !== e.altKey) return false;
  return e.key.toLowerCase() === combo.key.toLowerCase();
}

/** Returns display tokens for a combo, e.g. ["⌘","⇧","E"] (mac) or ["Ctrl","Shift","E"]. */
export function formatCombo(combo: KeyCombo, mac: boolean): string[] {
  const tokens: string[] = [];
  if (combo.mod) tokens.push(mac ? "⌘" : "Ctrl");
  if (combo.shift) tokens.push(mac ? "⇧" : "Shift");
  if (combo.alt) tokens.push(mac ? "⌥" : "Alt");
  tokens.push(combo.key === "/" ? "/" : combo.key.toUpperCase());
  return tokens;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/shortcuts.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add keyboard shortcut registry and match/format helpers"
```

---

## Task 2: useGlobalShortcuts hook

**Files:** Create `src/hooks/useGlobalShortcuts.ts`, `src/hooks/useGlobalShortcuts.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/hooks/useGlobalShortcuts.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

function Harness({ handlers }: { handlers: Record<string, () => void> }) {
  useGlobalShortcuts(handlers);
  return null;
}

describe("useGlobalShortcuts", () => {
  it("runs the matching handler and prevents default", () => {
    const onSearch = vi.fn();
    render(<Harness handlers={{ "view.search": onSearch }} />);
    // jsdom: isMac is false → Ctrl+Shift+F matches view.search
    const e = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("ignores keys with no registered handler", () => {
    const onSearch = vi.fn();
    render(<Harness handlers={{ "view.search": onSearch }} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("does not fire display-only shortcuts (save) even if matched", () => {
    const onSave = vi.fn();
    render(<Harness handlers={{ "file.save": onSave }} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/hooks/useGlobalShortcuts.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/hooks/useGlobalShortcuts.ts`:
```ts
import { useEffect, useRef } from "react";
import { SHORTCUTS, matchKeyEvent, isMac } from "../lib/shortcuts";

/**
 * Attaches a single capture-phase window keydown listener that dispatches to
 * `handlers` keyed by shortcut id. Capture phase + stopPropagation lets these
 * win over CodeMirror's own keymap (e.g. Mod-/ comment toggle). displayOnly
 * shortcuts are never dispatched here.
 */
export function useGlobalShortcuts(handlers: Record<string, () => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      for (const sc of SHORTCUTS) {
        if (sc.displayOnly) continue;
        const handler = ref.current[sc.id];
        if (!handler) continue;
        if (matchKeyEvent(e, sc.combo, isMac)) {
          e.preventDefault();
          e.stopPropagation();
          handler();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/hooks/useGlobalShortcuts.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add useGlobalShortcuts capture-phase key handler"
```

---

## Task 3: ShortcutsModal component

**Files:** Create `src/components/ShortcutsModal.tsx`, `src/components/ShortcutsModal.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/components/ShortcutsModal.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutsModal } from "./ShortcutsModal";

describe("ShortcutsModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ShortcutsModal open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders grouped shortcuts when open", () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    expect(screen.getByText("Show Explorer")).toBeInTheDocument();
    expect(screen.getByText("Show Search")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("focuses the filter input on open", () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/filter/i)).toHaveFocus();
  });

  it("filters the list by label", async () => {
    render(<ShortcutsModal open onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/filter/i), "search");
    expect(screen.getByText("Show Search")).toBeInTheDocument();
    expect(screen.queryByText("Show Explorer")).not.toBeInTheDocument();
  });

  it("closes via the close button", async () => {
    const onClose = vi.fn();
    render(<ShortcutsModal open onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<ShortcutsModal open onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/ShortcutsModal.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/components/ShortcutsModal.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { SHORTCUTS, formatCombo, isMac } from "../lib/shortcuts";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ open, onClose }: Props) {
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement;
      inputRef.current?.focus();
    } else {
      setFilter("");
      (prevFocus.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);

  if (!open) return null;

  const q = filter.trim().toLowerCase();
  const visible = SHORTCUTS.filter(
    (sc) =>
      q === "" ||
      sc.label.toLowerCase().includes(q) ||
      formatCombo(sc.combo, isMac).join(" ").toLowerCase().includes(q)
  );
  const groups: string[] = [];
  for (const sc of visible) if (!groups.includes(sc.group)) groups.push(sc.group);

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-label="Keyboard Shortcuts"
        className="mt-[8vh] w-[540px] max-w-[92%] bg-bg-1 border border-[#2c2c34] rounded-[14px] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.75)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-bd-2">
          <span className="flex-1 text-sm font-semibold text-tx-1">Keyboard Shortcuts</span>
          <button
            aria-label="Close"
            onClick={onClose}
            className="flex w-6 h-6 items-center justify-center rounded-md text-tx-2 hover:bg-white/5 hover:text-tx-1"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-4 pt-3 pb-1.5">
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or key…"
            className="w-full bg-bg-0 border border-bd-hover rounded-md px-2.5 py-1.5 text-[13px] text-tx-1 outline-none placeholder:text-tx-3"
          />
        </div>
        <div className="zk-scroll px-2 pb-3 max-h-[60vh] overflow-auto">
          {groups.map((group) => (
            <div key={group}>
              <div className="px-2.5 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-tx-3">
                {group}
              </div>
              {visible
                .filter((sc) => sc.group === group)
                .map((sc) => (
                  <div key={sc.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg">
                    <span className="flex-1 text-[13px] text-tx-1">{sc.label}</span>
                    <span className="flex gap-1">
                      {formatCombo(sc.combo, isMac).map((tok, i) => (
                        <kbd
                          key={i}
                          className="font-mono text-[11px] text-tx-bright bg-bg-3 border border-bd-hover rounded-[5px] px-1.5 py-0.5"
                        >
                          {tok}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
            </div>
          ))}
          {visible.length === 0 && (
            <div className="px-2.5 py-6 text-center text-[12.5px] text-tx-3">No matching shortcuts</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/ShortcutsModal.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add ShortcutsModal reference panel"
```

---

## Task 4: ActivityBar "Keyboard Shortcuts" button

**Files:** Modify `src/components/ActivityBar.tsx`; rewrite `src/components/ActivityBar.test.tsx`

- [ ] **Step 1: Rewrite the test** — replace `src/components/ActivityBar.test.tsx` with:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityBar } from "./ActivityBar";

const baseProps = {
  activeView: "explorer" as const,
  sidebarVisible: true,
  onActivate: () => {},
  onOpenShortcuts: () => {},
};

describe("ActivityBar", () => {
  it("renders Explorer, Search, and Keyboard Shortcuts buttons", () => {
    render(<ActivityBar {...baseProps} />);
    expect(screen.getByRole("button", { name: /explorer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("marks the active view as pressed when the sidebar is visible", () => {
    render(<ActivityBar {...baseProps} activeView="search" />);
    expect(screen.getByRole("button", { name: /search/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /explorer/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onActivate with the clicked view", async () => {
    const onActivate = vi.fn();
    render(<ActivityBar {...baseProps} onActivate={onActivate} />);
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(onActivate).toHaveBeenCalledWith("search");
  });

  it("calls onOpenShortcuts when the shortcuts button is clicked", async () => {
    const onOpenShortcuts = vi.fn();
    render(<ActivityBar {...baseProps} onOpenShortcuts={onOpenShortcuts} />);
    await userEvent.click(screen.getByRole("button", { name: /keyboard shortcuts/i }));
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/ActivityBar.test.tsx`
Expected: FAIL — `onOpenShortcuts` prop / button not present.

- [ ] **Step 3: Implement** — in `src/components/ActivityBar.tsx`, add the prop and a bottom button. Update the `Props` interface:
```tsx
interface Props {
  activeView: View;
  sidebarVisible: boolean;
  onActivate: (view: View) => void;
  onOpenShortcuts: () => void;
}
```
Update the destructure to include `onOpenShortcuts`. Then, just before the closing `</div>` of the container, add the bottom-pinned button:
```tsx
      <button
        aria-label="Keyboard Shortcuts"
        onClick={onOpenShortcuts}
        className="mt-auto w-[38px] h-[38px] rounded-[9px] flex items-center justify-center text-tx-3 hover:bg-white/5 hover:text-tx-bright"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 10h0M10 10h0M14 10h0M18 10h0M8 14h8" />
        </svg>
      </button>
```
(The `mt-auto` pushes it to the bottom of the existing `flex-col` container.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/ActivityBar.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add Keyboard Shortcuts button to ActivityBar"
```

---

## Task 5: Wire shortcuts into App

**Files:** Modify `src/App.tsx`; Test `src/App.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `src/App.test.tsx`. Add `waitFor` to the `@testing-library/react` import. Then add:
```tsx
  it("Ctrl+Shift+F switches to the search view (global shortcut)", async () => {
    render(<App />);
    // jsdom isMac=false → Ctrl is the 'mod' key
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    );
    await waitFor(() => expect(useWorkspaceStore.getState().activeView).toBe("search"));
  });

  it("Ctrl+/ opens the keyboard shortcuts modal", async () => {
    render(<App />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true })
    );
    expect(await screen.findByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("the ActivityBar shortcuts button opens the modal", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /keyboard shortcuts/i }));
    expect(await screen.findByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });
```
(The App test already imports `useWorkspaceStore`, `screen`, `userEvent`; only `waitFor` is new.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — no global shortcuts / modal wired.

- [ ] **Step 3: Implement** — edit `src/App.tsx`:
- Add imports:
```tsx
import { ShortcutsModal } from "./components/ShortcutsModal";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
```
- Add modal open state near the other `useState`s:
```tsx
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
```
- Register the global shortcuts (place after `activate` is defined):
```tsx
  useGlobalShortcuts({
    "view.explorer": () => activate("explorer"),
    "view.search": () => activate("search"),
    "help.shortcuts": () => setShortcutsOpen((o) => !o),
  });
```
- Pass the button handler to ActivityBar (update its usage):
```tsx
      <ActivityBar
        activeView={activeView}
        sidebarVisible={sidebarVisible}
        onActivate={activate}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
```
- Render the modal just before the final closing `</div>` of the root element:
```tsx
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/App.test.tsx`
Expected: all pass.

- [ ] **Step 5: Run the full suite + build**

Run: `npm run test` then `npm run build`
Expected: all tests pass; build clean.

- [ ] **Step 6: Manual check (deferred to user — native, not coverable in jsdom)**

`source "$HOME/.cargo/env" && npm run tauri dev` → with focus IN the editor: `Cmd+Shift+E`/`Cmd+Shift+F` switch sidebar views; `Cmd+/` opens the modal **without** toggling a code comment (verifies the capture-phase override); the ActivityBar bottom button opens it; Esc / backdrop / × close it.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat(frontend): wire global shortcuts and shortcuts modal into App"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §1 shortcuts (⌘⇧E / ⌘⇧F / ⌘/) — registry Task 1, dispatch Task 2, wiring Task 5. ✓
- §2.1 registry + `matchKeyEvent` exact-match contract + `formatCombo` + `isMac` — Task 1 (with negative/extra-modifier/cross-platform tests). ✓
- §2.2 capture-phase window listener + preventDefault/stopPropagation + displayOnly skip — Task 2 (incl. displayOnly-not-fired test). ✓
- §2.3 App handler map — Task 5. ✓
- §3.1 ShortcutsModal (groups, filter, kbd, Esc/backdrop/×, focus-on-open + restore) — Task 3. ✓
- §3.2 ActivityBar bottom button (`mt-auto`, aria-label) — Task 4. ✓
- §5 edge/limitations (input focus fires mod-combos; prompt/confirm freeze; save/Esc not via global hook) — encoded by design (no input-focus guard; nothing added). ✓
- §6 tests incl. registry↔handlers invariant — Task 1 asserts the actionable id set `["view.explorer","view.search","help.shortcuts"]`; Task 5 provides handlers for exactly those (and the integration tests exercise each). The two together enforce the invariant. ✓
- §7 non-goals — nothing built beyond scope. ✓

**Placeholder scan:** No TBD/TODO; complete code in every step.

**Type consistency:** `KeyCombo`/`Shortcut` shape, `matchKeyEvent(e, combo, mac)`, `formatCombo(combo, mac)`, `useGlobalShortcuts(handlers)`, shortcut ids (`view.explorer`/`view.search`/`file.save`/`help.shortcuts`), and `ShortcutsModal {open,onClose}` / ActivityBar `onOpenShortcuts` are consistent across Tasks 1–5.

**Known minor notes (non-blocking):**
- jsdom can't reproduce CodeMirror's real keymap, so the ⌘/-doesn't-toggle-comment guarantee is verified manually (Task 5 Step 6), not in unit tests — acceptable, matches spec §6.
- Focus-restore-on-close is implemented; a deterministic unit test for restore is omitted (focus-on-open is tested instead) to avoid jsdom focus flakiness.
