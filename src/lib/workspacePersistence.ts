const KEY = "zk.workspaceRoot";

/** Persists the opened workspace root so it can be restored after a reload/restart. */
export function saveWorkspaceRoot(path: string | null): void {
  try {
    if (path) localStorage.setItem(KEY, path);
    else localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors (private mode, disabled storage, etc.)
  }
}

/** Returns the last persisted workspace root, or null. */
export function loadWorkspaceRoot(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
