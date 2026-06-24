import { relativePath, joinPath } from "./paths";

export interface WorktreeSwitchOps {
  setWorkspaceRoot: (path: string) => Promise<void>;
  setRoot: (path: string) => void;
  saveWorkspaceRoot: (path: string) => void;
  closeTabsUnder: (dir: string) => void;
  /** Open a file; `activate` controls whether it also becomes the focused tab. */
  openFile: (path: string, activate: boolean) => Promise<void>;
  setActive: (path: string) => void;
  /** The paths of all currently-open tabs (read after reopening, for the fallback). */
  listOpenPaths: () => string[];
}

/**
 * Re-points the workspace from `oldRoot` to `newRoot` and remaps the open tabs.
 *
 * To avoid flickering the editor (which renders only the active tab), the
 * active file is opened and focused FIRST — so the viewport swaps exactly once,
 * directly from the old active file to the new one — then the old-root tabs are
 * dropped and the remaining files are reopened in the background without
 * stealing focus. If the active file can't reopen (missing/binary/large in the
 * new worktree), the first remaining tab is focused so the viewport isn't empty.
 *
 * Relative paths are captured up front, before the root is re-pointed. Callers
 * own the guards (no-op on same root, dirty-confirm, in-flight lock).
 */
export async function switchWorktreeTabs(
  oldRoot: string,
  newRoot: string,
  openPaths: string[],
  activePath: string | null,
  ops: WorktreeSwitchOps
): Promise<void> {
  const openRel = openPaths.map((p) => relativePath(oldRoot, p));
  const activeRel = activePath ? relativePath(oldRoot, activePath) : null;
  const activeTarget = activeRel ? joinPath(newRoot, activeRel) : null;

  await ops.setWorkspaceRoot(newRoot);
  ops.setRoot(newRoot);
  ops.saveWorkspaceRoot(newRoot);

  // Open and focus the active file first, so the editor swaps once (old → new)
  // instead of flashing through every reopened tab. Done before closing the old
  // tabs so the previous file stays visible until the new one is ready.
  if (activeTarget) await ops.openFile(activeTarget, true);

  // Drop the old-root tabs; the new active tab (under newRoot) survives.
  ops.closeTabsUnder(oldRoot);

  // Reopen the rest in the background without stealing focus.
  for (const rel of openRel) {
    const target = joinPath(newRoot, rel);
    if (target === activeTarget) continue; // already opened above
    await ops.openFile(target, false);
  }

  // Fallback: the active file couldn't reopen — focus the first remaining tab
  // so the viewport isn't left empty.
  const open = ops.listOpenPaths();
  if ((!activeTarget || !open.includes(activeTarget)) && open.length > 0) {
    ops.setActive(open[0]);
  }
}
