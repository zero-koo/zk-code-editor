import { relativePath, joinPath } from "./paths";

export interface WorktreeSwitchOps {
  setWorkspaceRoot: (path: string) => Promise<void>;
  setRoot: (path: string) => void;
  saveWorkspaceRoot: (path: string) => void;
  closeTabsUnder: (dir: string) => void;
  openFile: (path: string) => Promise<void>;
  setActive: (path: string) => void;
  /** Whether a tab with this path is currently open (read after re-opening). */
  isTabOpen: (path: string) => boolean;
}

/**
 * Re-points the workspace from `oldRoot` to `newRoot` and remaps the open tabs:
 * each open path (under `oldRoot`) is reopened at the same relative location
 * under `newRoot`, and the active tab is restored if it reopened successfully.
 *
 * Relative paths are captured up front, before the root is re-pointed. Callers
 * own the guards (no-op on same root, dirty-confirm, in-flight lock); this
 * helper performs only the re-point + remap sequence.
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

  await ops.setWorkspaceRoot(newRoot);
  ops.setRoot(newRoot);
  ops.saveWorkspaceRoot(newRoot);
  ops.closeTabsUnder(oldRoot);

  for (const rel of openRel) {
    await ops.openFile(joinPath(newRoot, rel)); // missing/binary/large are skipped by openFile
  }
  if (activeRel) {
    const target = joinPath(newRoot, activeRel);
    if (ops.isTabOpen(target)) ops.setActive(target);
  }
}
