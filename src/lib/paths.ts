// Posix-style path helpers. Tauri returns OS paths; on Windows the backend
// already returns forward/back slashes consistently per-entry, so we split on
// both separators for safety but join with "/".
const SEP = /[/\\]/;

export function basename(p: string): string {
  const parts = p.split(SEP);
  return parts[parts.length - 1] || p;
}

export function dirname(p: string): string {
  const parts = p.split(SEP);
  parts.pop();
  return parts.join("/");
}

export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[/\\]+$/, "")}/${name}`;
}

/**
 * Path of `p` relative to the workspace `root`. Returns the root's own basename
 * if `p` is the root itself, and falls back to `p` unchanged if it isn't under root.
 */
export function relativePath(root: string, p: string): string {
  const r = root.replace(/[/\\]+$/, "");
  if (p === r) return basename(p);
  if (p.startsWith(`${r}/`) || p.startsWith(`${r}\\`)) return p.slice(r.length + 1);
  return p;
}
