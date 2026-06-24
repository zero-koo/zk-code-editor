import { create } from "zustand";
import type { GitChanges } from "../api/types";
import { gitChanges } from "../api/git";

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

interface GitState {
  changes: GitChanges | null;
  loadedRoot: string | null;
  loading: boolean;
  error: string | null;
  load: (root: string) => Promise<void>;
}

let seq = 0;

export const useGitStore = create<GitState>((set) => ({
  changes: null,
  loadedRoot: null,
  loading: false,
  error: null,
  load: async (root) => {
    const s = ++seq;
    set({ loading: true, error: null });
    try {
      const changes = await gitChanges(root);
      if (s === seq) set({ changes, loadedRoot: root, loading: false });
    } catch (e) {
      if (s === seq) set({ error: errorMessage(e), loading: false });
    }
  },
}));
