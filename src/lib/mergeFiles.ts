import type { FileDiff } from "../api/types";

export interface MergedFile {
  path: string;
  staged: FileDiff | null;
  unstaged: FileDiff | null;
  status: FileDiff["status"]; // staged 우선, 없으면 unstaged
}

/**
 * Merges staged and unstaged FileDiff lists into a single per-path list.
 * Staged files come first (in their order); unstaged-only files are appended.
 * A file present in both (partial staging) carries both diffs; its status is
 * taken from the staged side.
 */
export function mergeFiles(staged: FileDiff[], unstaged: FileDiff[]): MergedFile[] {
  const byPath = new Map<string, MergedFile>();
  const order: string[] = [];
  for (const f of staged) {
    byPath.set(f.path, { path: f.path, staged: f, unstaged: null, status: f.status });
    order.push(f.path);
  }
  for (const f of unstaged) {
    const existing = byPath.get(f.path);
    if (existing) {
      existing.unstaged = f;
    } else {
      byPath.set(f.path, { path: f.path, staged: null, unstaged: f, status: f.status });
      order.push(f.path);
    }
  }
  return order.map((p) => byPath.get(p)!);
}
