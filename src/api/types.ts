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
