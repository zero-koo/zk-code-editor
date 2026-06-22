import { invoke } from "@tauri-apps/api/core";
import type { GitChanges } from "./types";

export const gitChanges = (root: string) =>
  invoke<GitChanges>("git_changes", { root });
