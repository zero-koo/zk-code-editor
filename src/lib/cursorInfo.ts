import type { EditorState } from "@codemirror/state";

export interface CursorInfo {
  line: number; // 1-based
  col: number; // 1-based (head offset within its line + 1)
  selection: number; // total selected characters across all ranges (0 if none)
}

export function cursorInfo(state: EditorState): CursorInfo {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const selection = state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
  return { line: line.number, col: head - line.from + 1, selection };
}
