# Shared UI Components Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract duplicated UI into shared components — an icon set, an `IconButton`, a `SectionLabel`, and a `SidebarPanel` shell — without changing any behavior or appearance.

**Architecture:** Pure, behavior-preserving refactor. Inline SVGs (duplicated across 7 files) move into `src/components/icons.tsx` as named components over a shared `Icon` base that forwards `size`/`stroke`/`strokeWidth`/`style`/`className`, so every call site keeps its exact props → identical pixels. Repeated icon-button, section-label, and sidebar-shell markup become small components. The 81-test suite plus preserved semantic hooks (roles, `aria-label`s, `data-testid`s, `tree-icon`/`tree-name` spans) guard correctness; the build (`tsc`) guards types.

**Tech Stack:** React 18 + TypeScript + Tailwind v4, Vitest + Testing Library.

---

## Conventions
- Paths relative to project root `/Users/zerokoo/Projects/zerokoo/zk-code-editor`.
- Single test: `npx vitest run <path>`; full: `npm run test`. Build: `npm run build`.
- Commit after every task. Conventional Commits. **No `Co-Authored-By`.** Body bullets `- `.
- **Behavior-preserving:** do NOT change any `role`, `aria-label`, `aria-pressed`, `data-testid`, the `tree-icon`/`tree-name` spans, class strings on non-extracted elements, or any SVG's visual props. When replacing an inline `<svg>` with an icon component, pass the SAME `size` (= the old width/height), `stroke`, `strokeWidth`, `style`, and `className` it had.
- After every task the full suite (81 tests) and build must stay green.

## File Structure
- `src/components/icons.tsx` (new) — `Icon` base + named icon components.
- `src/components/IconButton.tsx` (new) — square icon button (button + aria-label + centering).
- `src/components/SectionLabel.tsx` (new) — uppercase sidebar section label.
- `src/components/SidebarPanel.tsx` (new) — 258px sidebar shell.
- Consumers modified: `FileTreeNode.tsx`, `TabBar.tsx`, `ActivityBar.tsx`, `FileExplorer.tsx`, `SearchPanel.tsx`, `ShortcutsModal.tsx`, `TitleBar.tsx`, `App.tsx`.
- New tests: `icons.test.tsx`, `IconButton.test.tsx`, `SectionLabel.test.tsx`, `SidebarPanel.test.tsx`.

---

## Task 1: Icon set module

**Files:** Create `src/components/icons.tsx`, `src/components/icons.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/components/icons.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FileIcon, CloseIcon } from "./icons";

describe("icons", () => {
  it("renders an svg at the given size and forwards stroke", () => {
    const { container } = render(<FileIcon size={14} stroke="#7aa2f7" />);
    const svg = container.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("height")).toBe("14");
    expect(svg.getAttribute("stroke")).toBe("#7aa2f7");
  });

  it("defaults stroke to currentColor and forwards className", () => {
    const { container } = render(<CloseIcon className="x" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("class")).toContain("x");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/icons.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/components/icons.tsx` (exact path data copied from the current inline SVGs):
```tsx
import type { SVGProps, ReactNode } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const FileIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </Icon>
);

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

// "open folder" / explorer glyph
export const FolderOpenIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const KeyboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h0M10 10h0M14 10h0M18 10h0M8 14h8" />
  </Icon>
);

export const CodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m16 18 6-6-6-6" />
    <path d="m8 6-6 6 6 6" />
  </Icon>
);

export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Icon>
);

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/icons.test.tsx`
Expected: 2 pass.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(frontend): add shared icon set"
```

---

## Task 2: Replace inline SVGs with icon components

**Files:** Modify `FileTreeNode.tsx`, `TabBar.tsx`, `ActivityBar.tsx`, `FileExplorer.tsx`, `TitleBar.tsx`, `App.tsx` (and `ShortcutsModal.tsx` close icon).

For each, replace the inline `<svg>…</svg>` with the matching icon component, **passing the exact same `size` (old width/height), `stroke`, `strokeWidth`, `style`, and `className`** so appearance is unchanged. Add the import `import { … } from "./icons";` (or `"./components/icons"` in App).

- [ ] **Step 1: FileTreeNode.tsx** — import `ChevronIcon, FolderIcon, FileIcon, PencilIcon, TrashIcon`. Replace:
  - Dir chevron `<svg width="13" … strokeWidth="2.4" stroke="#63636e" style={{transform…}}><path d="m6 9 6 6 6-6"/></svg>` → `<ChevronIcon size={13} stroke="#63636e" strokeWidth={2.4} style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }} />`
  - Dir folder `<svg width="15" … strokeWidth="1.7" stroke="#7c84a8">…</svg>` → `<FolderIcon size={15} stroke="#7c84a8" />`
  - File `<svg width="14" … stroke="#7aa2f7">…</svg>` → `<FileIcon size={14} stroke="#7aa2f7" />`
  - Context-menu "New File" file svg (`stroke="currentColor"` width 14) → `<FileIcon size={14} />`
  - Rename pencil → `<PencilIcon size={14} />`
  - Delete trash → `<TrashIcon size={14} />`
  Keep the `tree-icon`/`tree-name` spans and all wrappers exactly.

- [ ] **Step 2: TabBar.tsx** — import `FileIcon, CloseIcon`. Replace the per-tab file svg `<svg width="14" … stroke={active ? "#7aa2f7" : "#5b6da8"} strokeWidth="1.7" className="shrink-0">…</svg>` → `<FileIcon size={14} stroke={active ? "#7aa2f7" : "#5b6da8"} className="shrink-0" />`. Replace the close svg (`width="11" strokeWidth="2.2" stroke="currentColor"`) → `<CloseIcon size={11} strokeWidth={2.2} />`. Keep the close `<button aria-label={...}>` wrapper and dirty span.

- [ ] **Step 3: ActivityBar.tsx** — import `FolderOpenIcon, SearchIcon, KeyboardIcon`. Replace the explorer svg (`width="19" stroke="currentColor" strokeWidth="1.8"`, path `M3 7…`) → `<FolderOpenIcon size={19} strokeWidth={1.8} />`; the search svg → `<SearchIcon size={19} strokeWidth={1.8} />`; the keyboard svg → `<KeyboardIcon size={19} strokeWidth={1.8} />`. Keep all `<button>`s, `aria-label`/`aria-pressed`, active classes, and the accent-rail spans unchanged.

- [ ] **Step 4: FileExplorer.tsx** — import `FolderOpenIcon`. Replace the "Open Folder" button svg (`width="13" strokeWidth="1.8" stroke="currentColor"`, path `M3 7…`) → `<FolderOpenIcon size={13} strokeWidth={1.8} />`. Keep the button text "Open Folder".

- [ ] **Step 5: TitleBar.tsx** — import `CodeIcon`. Replace the code svg (`width="13" stroke="#6e7bf2" strokeWidth="2.1" className="shrink-0"`) → `<CodeIcon size={13} stroke="#6e7bf2" strokeWidth={2.1} className="shrink-0" />`.

- [ ] **Step 6: App.tsx** — import `InfoIcon, FileIcon` from `"./components/icons"`. Replace the notice banner info svg (`width="16" strokeWidth="1.8" className="text-accent shrink-0 mt-px"`) → `<InfoIcon size={16} strokeWidth={1.8} className="text-accent shrink-0 mt-px" />`. Replace the empty-state file svg (`width="20" strokeWidth="1.7"`) → `<FileIcon size={20} />`.

- [ ] **Step 7: ShortcutsModal.tsx** — import `CloseIcon`. Replace the close svg (`width="13" strokeWidth="2.2"`) → `<CloseIcon size={13} strokeWidth={2.2} />`. Keep the `aria-label="Close"` on the button.

- [ ] **Step 8: Run the full suite + build**

Run: `npm run test` then `npm run build`
Expected: all 81 tests pass (semantic hooks unchanged); build clean. If any icon import path or prop name (`strokeWidth`, not `stroke-width`) errors, fix to match the `icons.tsx` API.

- [ ] **Step 9: Commit**
```bash
git add -A && git commit -m "refactor(frontend): replace inline SVGs with shared icon components"
```

---

## Task 3: IconButton

**Files:** Create `src/components/IconButton.tsx`, `src/components/IconButton.test.tsx`; Modify `TabBar.tsx`, `ShortcutsModal.tsx`, `ActivityBar.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/IconButton.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("renders an accessible button with its children and calls onClick", async () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Close file" onClick={onClick}>
        <span data-testid="ico" />
      </IconButton>
    );
    const btn = screen.getByRole("button", { name: "Close file" });
    expect(btn).toBeInTheDocument();
    expect(screen.getByTestId("ico")).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("merges custom className", () => {
    render(<IconButton label="x" onClick={() => {}} className="w-5 h-5"><i /></IconButton>);
    expect(screen.getByRole("button", { name: "x" }).className).toContain("w-5");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/IconButton.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/components/IconButton.tsx`:
```tsx
import type { MouseEvent, ReactNode } from "react";

interface Props {
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: ReactNode;
}

/** Square, centered icon button. Size/rounding/colors come from `className`. */
export function IconButton({ label, onClick, className = "", children }: Props) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`flex items-center justify-center ${className}`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/IconButton.test.tsx`
Expected: 2 pass.

- [ ] **Step 5: Apply IconButton at the three plain icon-button sites** (keep the exact size/rounding/color classes by moving them into the `className` prop; keep the exact `aria-label` and onClick):
  - **TabBar.tsx** close button → `<IconButton label={`Close ${tab.name}`} onClick={(e) => { e.stopPropagation(); onClose(tab.path); }} className="w-[17px] h-[17px] rounded-[5px] text-tx-faint hover:bg-[#2a2a32] hover:text-tx-1"><CloseIcon size={11} strokeWidth={2.2} /></IconButton>`
  - **ShortcutsModal.tsx** close button → `<IconButton label="Close" onClick={onClose} className="w-6 h-6 rounded-md text-tx-2 hover:bg-white/5 hover:text-tx-1"><CloseIcon size={13} strokeWidth={2.2} /></IconButton>`
  - **ActivityBar.tsx** Keyboard Shortcuts (bottom) button → `<IconButton label="Keyboard Shortcuts" onClick={onOpenShortcuts} className="mt-auto w-[38px] h-[38px] rounded-[9px] text-tx-3 hover:bg-white/5 hover:text-tx-bright"><KeyboardIcon size={19} strokeWidth={1.8} /></IconButton>`
  Leave the Explorer/Search toggle buttons as plain `<button>`s (they carry `aria-pressed` + active-rail + active styling — not a plain IconButton).

- [ ] **Step 5b: Strengthen the TabBar close test to guard `stopPropagation`** — the existing close test only asserts `onClose` fired; it does not verify the click is stopped from also selecting the tab. In `src/components/TabBar.test.tsx`, in the "calls onClose when the close button is clicked" test, also pass an `onSelect` spy and assert it was NOT called:
```tsx
  it("calls onClose (and not onSelect) when the close button is clicked", async () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<TabBar tabs={tabs} activePath="/p/a.ts" onSelect={onSelect} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Close a.ts"));
    expect(onClose).toHaveBeenCalledWith("/p/a.ts");
    expect(onSelect).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Run the full suite + build**

Run: `npm run test` then `npm run build`
Expected: all tests pass (the `Close <name>`, `Close`, and `Keyboard Shortcuts` aria-labels are unchanged, so ActivityBar/TabBar/ShortcutsModal tests still pass; the strengthened close test confirms `stopPropagation` survived the IconButton extraction); build clean.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "refactor(frontend): extract IconButton for plain icon buttons"
```

---

## Task 4: SectionLabel

**Files:** Create `src/components/SectionLabel.tsx`, `src/components/SectionLabel.test.tsx`; Modify `FileExplorer.tsx`, `SearchPanel.tsx`.

The Explorer and Search sidebar headers use the identical class string `text-[11px] font-semibold tracking-[0.13em] uppercase text-tx-3`. Extract that. (The ShortcutsModal group labels use a different size/padding and are intentionally left as-is to preserve their look.)

- [ ] **Step 1: Write the failing test** — `src/components/SectionLabel.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionLabel } from "./SectionLabel";

describe("SectionLabel", () => {
  it("renders its text with the shared label styling", () => {
    render(<SectionLabel>Explorer</SectionLabel>);
    const el = screen.getByText("Explorer");
    expect(el.className).toContain("uppercase");
    expect(el.className).toContain("text-tx-3");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/SectionLabel.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/components/SectionLabel.tsx`:
```tsx
import type { ReactNode } from "react";

/** Uppercase sidebar section header label (Explorer, Search, …). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold tracking-[0.13em] uppercase text-tx-3">
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Apply it:**
  - **FileExplorer.tsx** — replace `<span className="text-[11px] font-semibold tracking-[0.13em] uppercase text-tx-3">Explorer</span>` with `<SectionLabel>Explorer</SectionLabel>` (import it).
  - **SearchPanel.tsx** — its label is a `<div className="text-[11px] font-semibold tracking-[0.13em] uppercase text-tx-3 mb-2.5">Search</div>` — note the **`mb-2.5`** (and it's a `<div>`, not a span). `SectionLabel` has NO margin, so to preserve spacing replace it with a wrapper that keeps the margin:
    ```tsx
    <div className="mb-2.5"><SectionLabel>Search</SectionLabel></div>
    ```
    Do NOT drop the `mb-2.5` — without it the search input shifts up ~10px (silent visual regression).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/SectionLabel.test.tsx` then `npm run test`
Expected: SectionLabel test passes; full suite green (FileExplorer's "Explorer"/SearchPanel's "Search" text unchanged).

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "refactor(frontend): extract SectionLabel for sidebar headers"
```

---

## Task 5: SidebarPanel shell

**Files:** Create `src/components/SidebarPanel.tsx`, `src/components/SidebarPanel.test.tsx`; Modify `FileExplorer.tsx`, `SearchPanel.tsx`.

Both panels' root element is `w-[258px] shrink-0 bg-bg-1 border-r border-bd-2 flex flex-col`. Extract the shell.

- [ ] **Step 1: Write the failing test** — `src/components/SidebarPanel.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarPanel } from "./SidebarPanel";

describe("SidebarPanel", () => {
  it("renders children inside the 258px sidebar shell", () => {
    const { container } = render(
      <SidebarPanel>
        <span>content</span>
      </SidebarPanel>
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("w-[258px]");
    expect(root.className).toContain("border-r");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/SidebarPanel.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `src/components/SidebarPanel.tsx`:
```tsx
import type { ReactNode } from "react";

/** Fixed-width sidebar shell shared by the Explorer and Search panels. */
export function SidebarPanel({ children }: { children: ReactNode }) {
  return (
    <div className="w-[258px] shrink-0 bg-bg-1 border-r border-bd-2 flex flex-col">
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Apply it** — in `FileExplorer.tsx` and `SearchPanel.tsx`, replace the outermost `<div className="w-[258px] shrink-0 bg-bg-1 border-r border-bd-2 flex flex-col"> … </div>` with `<SidebarPanel> … </SidebarPanel>` (import it). Move the inner content unchanged.

- [ ] **Step 5: Run the full suite + build**

Run: `npm run test` then `npm run build`
Expected: all 81 tests pass (FileExplorer "Open Folder" button, tree, and SearchPanel input/results all still render identically); build clean.

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "refactor(frontend): extract SidebarPanel shell"
```

---

## Self-Review (completed by plan author)

**Coverage (the 4 approved extractions):** icons (Task 1–2), IconButton (Task 3), SectionLabel (Task 4), SidebarPanel (Task 5). ✓

**Behavior preservation:** Every replacement preserves exact props (size = old width/height, stroke, strokeWidth, style, className) and all semantic hooks (`role` tablist/tab/tree/treeitem/menu/menuitem, `aria-label`s incl. `Close <name>`/`Keyboard Shortcuts`/`Explorer`/`Search`, `data-testid` dirty/statusbar, `tree-icon`/`tree-name` spans, `aria-pressed`). The 81-test suite + build are the verification gate after each task.

**Placeholder scan:** No TBD/TODO; the icon module is complete with verbatim path data; each consumer replacement lists exact props.

**Type consistency:** `Icon`/`IconProps` (`size?: number` + forwarded `SVGProps`), `IconButton {label,onClick,className?,children}`, `SectionLabel {children}`, `SidebarPanel {children}` are used consistently. JSX SVG attrs use camelCase (`strokeWidth`, `strokeLinecap`).

**Known minor notes (non-blocking):**
- IconButton intentionally does NOT absorb the ActivityBar Explorer/Search toggle buttons (they have `aria-pressed` + active rail) — leaving them avoids over-generalizing; they still use the shared icons.
- ShortcutsModal group labels are intentionally not folded into SectionLabel (different size/padding/element) to preserve their exact appearance.
- This is a visual refactor and the 81 tests are largely BLIND to it (no test asserts SVG props or class strings on the refactored elements). A manual `tauri dev` visual check is therefore **REQUIRED after Task 2** (icons render identically) **and after Task 4** (sidebar header spacing unchanged) — not optional.
