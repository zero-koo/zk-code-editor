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
