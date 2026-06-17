import { invoke } from "@tauri-apps/api/core";
import type { DirEntry, FileContent } from "./types";

export const setWorkspaceRoot = (path: string) =>
  invoke<void>("set_workspace_root", { path });

export const readDir = (path: string) =>
  invoke<DirEntry[]>("read_dir", { path });

export const readFile = (path: string) =>
  invoke<FileContent>("read_file", { path });

export const writeFile = (path: string, contents: string) =>
  invoke<void>("write_file", { path, contents });

export const createFile = (path: string) =>
  invoke<void>("create_file", { path });

export const createDir = (path: string) =>
  invoke<void>("create_dir", { path });

export const rename = (from: string, to: string) =>
  invoke<void>("rename", { from, to });

export const deletePath = (path: string) =>
  invoke<void>("delete", { path });
