import { invoke } from "@tauri-apps/api/core";
import type { GitChanges, Worktree } from "./types";

export const gitChanges = (root: string) =>
  invoke<GitChanges>("git_changes", { root });

export const gitWorktrees = (root: string) =>
  invoke<Worktree[]>("git_worktrees", { root });
