/** A changed file's pixel offset (cumulative top) within the diff. */
export interface FileOffset {
  path: string;
  top: number;
}

/**
 * Returns the path of the file whose section is at the top of the viewport for
 * the given scroll `offset` — the last file whose `top` is at or before it.
 * `files` must be in ascending `top` order. Returns null for an empty list.
 */
export function activeFileForOffset(files: FileOffset[], offset: number): string | null {
  let active: string | null = files[0]?.path ?? null;
  for (const f of files) {
    if (f.top <= offset) active = f.path;
    else break;
  }
  return active;
}
