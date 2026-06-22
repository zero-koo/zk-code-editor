export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export type FileContent =
  | { kind: "text"; text: string }
  | { kind: "binary" }
  | { kind: "too_large" };

export type ErrorCode =
  | "not_found"
  | "permission"
  | "conflict"
  | "io"
  | "outside_workspace";

export interface AppError {
  code: ErrorCode;
  message: string;
}

export interface Tab {
  path: string;
  name: string;
  languageId: string;
  dirty: boolean;
}

export interface SearchOptions {
  case_sensitive: boolean;
  regex: boolean;
}

export interface LineMatch {
  line_number: number;
  preview: string;
  highlight_ranges: [number, number][];
  match_start: number;
  match_end: number;
}

export interface FileMatches {
  path: string;
  rel_path: string;
  matches: LineMatch[];
}

export interface SearchResponse {
  files: FileMatches[];
  total_matches: number;
  truncated: boolean;
  regex_error: string | null;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  old_no: number | null;
  new_no: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  old_path: string | null;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  binary: boolean;
  too_large: boolean;
  hunks: Hunk[];
}

export interface GitChanges {
  is_repo: boolean;
  branch: string | null;
  files: FileDiff[];
}
