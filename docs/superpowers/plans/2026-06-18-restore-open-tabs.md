# Restore Open Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the open tab paths + active tab per workspace and reopen them (clean, from disk) after a reload/restart.

**Architecture:** Extend `workspacePersistence.ts` with `saveOpenTabs`/`loadOpenTabs` (stores `{root, paths, activePath}` under `zk.openTabs`). In `App`, a hydration-gated pair of effects: a restore effect (runs once when the workspace `root` becomes available — reopens saved paths via `readFile`, skipping binary/missing) and a save effect (writes the session on tab/active changes, but only AFTER hydration so it can't clobber the saved session with an empty list during restore).

**Tech Stack:** React 18 + TypeScript, Zustand, Vitest + Testing Library (jsdom; localStorage polyfilled in `src/test/setup.ts`).

---

## Conventions
- Paths relative to project root `/Users/zerokoo/Projects/zerokoo/zk-code-editor`.
- Single test: `npx vitest run <path>`; full: `npm run test`. Build: `npm run build`.
- Commit after every task. Conventional Commits. **No `Co-Authored-By`.** Body bullets `- `.
- TDD. After each task the full suite + build stay green.

## File Structure
- `src/lib/workspacePersistence.ts` (modify) — add `SavedTabs` type + `saveOpenTabs`/`loadOpenTabs`.
- `src/lib/workspacePersistence.test.ts` (modify) — add round-trip tests.
- `src/App.tsx` (modify) — hydration-gated restore + save effects, `restoreTabs` routine.
- `src/App.test.tsx` (modify) — integration tests for restore.

---

## Task 1: Persist/load open tabs

**Files:** Modify `src/lib/workspacePersistence.ts`, `src/lib/workspacePersistence.test.ts`

- [ ] **Step 1: Write the failing test** — add to `src/lib/workspacePersistence.test.ts`:
```ts
import { saveOpenTabs, loadOpenTabs } from "./workspacePersistence";

describe("open tabs persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the open tab session", () => {
    expect(loadOpenTabs()).toBeNull();
    saveOpenTabs({ root: "/proj", paths: ["/proj/a.ts", "/proj/b.ts"], activePath: "/proj/b.ts" });
    expect(loadOpenTabs()).toEqual({
      root: "/proj",
      paths: ["/proj/a.ts", "/proj/b.ts"],
      activePath: "/proj/b.ts",
    });
  });

  it("returns null when nothing is stored or it is malformed", () => {
    expect(loadOpenTabs()).toBeNull();
    localStorage.setItem("zk.openTabs", "{not json");
    expect(loadOpenTabs()).toBeNull();
  });
});
```
(The existing `import { saveWorkspaceRoot, loadWorkspaceRoot } from "./workspacePersistence";` line can be extended to also import `saveOpenTabs, loadOpenTabs`, or add a second import line — either compiles.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/workspacePersistence.test.ts`
Expected: FAIL — `saveOpenTabs`/`loadOpenTabs` not exported.

- [ ] **Step 3: Implement** — append to `src/lib/workspacePersistence.ts`:
```ts
const TABS_KEY = "zk.openTabs";

export interface SavedTabs {
  root: string;
  paths: string[];
  activePath: string | null;
}

/** Persists the open tab session (paths + active tab) for the given workspace root. */
export function saveOpenTabs(value: SavedTabs): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

/** Returns the last persisted tab session, or null if absent/malformed. */
export function loadOpenTabs(): SavedTabs | null {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedTabs;
    if (!parsed || typeof parsed.root !== "string" || !Array.isArray(parsed.paths)) return null;
    return parsed;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/workspacePersistence.test.ts`
Expected: all pass (including the existing root tests).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): persist open tab session to localStorage"
```

---

## Task 2: Restore tabs on startup (hydration-gated)

**Files:** Modify `src/App.tsx`, `src/App.test.tsx`

- [ ] **Step 1: Write the failing tests** — add to `src/App.test.tsx`. The existing `vi.mock("./api/fs", …)` already mocks `readFile`; the `beforeEach` already clears `localStorage` and resets the store. Add:
```tsx
  it("restores saved tabs and the active tab on startup", async () => {
    useWorkspaceStore.setState({ root: "/proj" });
    readDir.mockResolvedValue([]);
    localStorage.setItem(
      "zk.openTabs",
      JSON.stringify({ root: "/proj", paths: ["/proj/a.ts", "/proj/b.ts"], activePath: "/proj/b.ts" })
    );
    readFile.mockImplementation((p: string) => Promise.resolve({ kind: "text", text: `// ${p}` }));

    render(<App />);

    expect(await screen.findByRole("tab", { name: /a\.ts/ })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /b\.ts/ })).toBeInTheDocument();
    await waitFor(() => expect(useWorkspaceStore.getState().activeTabPath).toBe("/proj/b.ts"));
  });

  it("skips a binary/missing file when restoring tabs", async () => {
    useWorkspaceStore.setState({ root: "/proj" });
    readDir.mockResolvedValue([]);
    localStorage.setItem(
      "zk.openTabs",
      JSON.stringify({ root: "/proj", paths: ["/proj/img.png", "/proj/a.ts"], activePath: "/proj/a.ts" })
    );
    readFile.mockImplementation((p: string) =>
      p.endsWith(".png")
        ? Promise.resolve({ kind: "binary" })
        : Promise.resolve({ kind: "text", text: "ok" })
    );

    render(<App />);

    expect(await screen.findByRole("tab", { name: /a\.ts/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /img\.png/ })).not.toBeInTheDocument();
  });

  it("does not restore tabs when the saved root differs from the current root", async () => {
    useWorkspaceStore.setState({ root: "/proj" });
    readDir.mockResolvedValue([]);
    localStorage.setItem(
      "zk.openTabs",
      JSON.stringify({ root: "/other", paths: ["/other/a.ts"], activePath: "/other/a.ts" })
    );
    readFile.mockResolvedValue({ kind: "text", text: "x" });

    render(<App />);
    // give effects a tick; no tab should appear
    await waitFor(() => expect(useWorkspaceStore.getState().activeTabPath).toBeNull());
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — no restore wiring yet (no tabs appear).

- [ ] **Step 3: Implement** — edit `src/App.tsx`:

Add the import (merge with existing react import if present):
```tsx
import { loadOpenTabs, saveOpenTabs } from "./lib/workspacePersistence";
```

Add hydration state near the other `useState`/`useRef` declarations:
```tsx
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
```

Add the `restoreTabs` routine (place near `openFile`, after the store selectors so `openTab`/`setActive`/`setDocs` are in scope):
```tsx
  async function restoreTabs(paths: string[], activePath: string | null) {
    for (const path of paths) {
      try {
        const content = await readFile(path);
        if (content.kind !== "text") continue; // skip binary/too_large
        setDocs((d) => ({ ...d, [path]: content.text }));
        openTab({
          path,
          name: basename(path),
          languageId: languageIdForFile(path),
          dirty: false,
        });
      } catch {
        // missing/unreadable file — skip
      }
    }
    if (activePath && paths.includes(activePath)) setActive(activePath);
  }
```

Add the restore effect (MUST be declared BEFORE the save effect):
```tsx
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!root) return; // wait until the workspace root is restored/opened
    hydratedRef.current = true;
    const saved = loadOpenTabs();
    if (saved && saved.root === root && tabs.length === 0) {
      void restoreTabs(saved.paths, saved.activePath).finally(() => setHydrated(true));
    } else {
      setHydrated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);
```

Add the save effect (AFTER the restore effect):
```tsx
  useEffect(() => {
    if (!hydrated) return; // don't persist until restore has run (avoids clobbering with [])
    if (root) {
      saveOpenTabs({ root, paths: tabs.map((t) => t.path), activePath: activeTabPath });
    }
  }, [hydrated, root, tabs, activeTabPath]);
```

(If `useRef` isn't already imported in App, add it to the `react` import — it is already imported for `revealSeq`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/App.test.tsx`
Expected: the 3 new tests pass (plus all existing App tests).

- [ ] **Step 5: Run the full suite + build**

Run: `npm run test` then `npm run build`
Expected: all tests pass; build clean.

- [ ] **Step 6: Manual check (deferred to user, native)**

`source "$HOME/.cargo/env" && npm run tauri dev` → open a folder, open a few files, switch active tab → trigger a reload (edit a project file, or rerun) → the same tabs reopen and the active tab is selected. Open a different folder → its own tabs (not the previous folder's) are shown.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat(frontend): restore open tabs and active tab on startup"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §2 persistence (`saveOpenTabs`/`loadOpenTabs`, `{root,paths,activePath}`, `zk.openTabs`, null on absent/malformed) — Task 1. ✓
- §3.1 restore effect (once, root-gated, root-match, reopen via readFile, skip non-text, set active) — Task 2. ✓
- §3.2 save effect gated on `hydrated` (prevents empty-clobber race) — Task 2. ✓
- §3 effect ordering (restore declared before save) — Task 2 Step 3 states it explicitly. ✓
- §4 edges (root mismatch, malformed, binary/missing skip, already-open no-op, unsaved edits not restored) — covered by restore logic + tests (mismatch test, binary-skip test). ✓
- §5 tests (persistence round-trip + null; App restore/skip/mismatch) — Tasks 1–2. ✓
- §6 non-goals — nothing beyond scope built. ✓

**Placeholder scan:** No TBD/TODO; complete code in every step.

**Type consistency:** `SavedTabs {root, paths, activePath}` is identical in Task 1 (definition), the test JSON, and Task 2's `loadOpenTabs()` consumption + `saveOpenTabs({root, paths, activePath})`. `restoreTabs(paths, activePath)` matches its call. App symbols used (`root`, `tabs`, `activeTabPath`, `openTab`, `setActive`, `setDocs`, `readFile`, `basename`, `languageIdForFile`) all already exist in App.

**Known minor notes (non-blocking):**
- The App restore tests set the store `root` directly (`useWorkspaceStore.setState({ root })`) to trigger the restore effect in isolation, rather than driving it through FileExplorer's root-restore + mocked dialog — simpler and sufficient since `readFile` is mocked.
- jsdom can't reproduce the real reload; the end-to-end "reload restores tabs" behavior is verified manually (Step 6). The unit tests verify the restore/save logic directly.
