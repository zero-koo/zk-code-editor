import { create } from "zustand";
import type { CursorInfo } from "../lib/cursorInfo";

interface CursorState {
  cursor: CursorInfo | null;
  setCursor: (cursor: CursorInfo | null) => void;
}

// Cursor position lives in its own store so the high-frequency updates
// (every keystroke / caret move) only re-render the status bar, not the
// whole App tree.
export const useCursorStore = create<CursorState>((set) => ({
  cursor: null,
  setCursor: (cursor) => set({ cursor }),
}));
