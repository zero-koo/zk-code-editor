import { invoke } from "@tauri-apps/api/core";
import type { GitChanges, Worktree, FileAction } from "./types";

export const gitChanges = (root: string) =>
  invoke<GitChanges>("git_changes", { root });

export const gitWorktrees = (root: string) =>
  invoke<Worktree[]>("git_worktrees", { root });

export const gitFileAction = (root: string, path: string, action: FileAction) =>
  invoke<void>("git_file_action", { root, path, action });
