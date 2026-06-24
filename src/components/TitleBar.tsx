import { useEffect, useState } from "react";
import { CodeIcon } from "./icons";
import { gitWorktrees } from "../api/git";
import type { Worktree } from "../api/types";

interface Props {
  /** Workspace root path, or null when no folder is open. Used to fetch worktrees. */
  root: string | null;
  /** Display project name (kept in sync with `branch` so the title updates once). */
  name: string | null;
  /** Current branch label, or null. */
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
export function TitleBar({ root, name, branch, onSwitchWorktree }: Props) {
  const [open, setOpen] = useState(false);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);

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
