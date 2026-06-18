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
