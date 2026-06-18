import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { cursorInfo } from "./cursorInfo";

describe("cursorInfo", () => {
  it("reports line 1, col 1 at the document start", () => {
    const s = EditorState.create({ doc: "hello\nworld" });
    expect(cursorInfo(s)).toEqual({ line: 1, col: 1, selection: 0 });
  });

  it("computes line and column for a cursor on line 2", () => {
    // "hello\nworld": offset 8 is on line 2 ("world"), line.from = 6 → col = 3
    const s = EditorState.create({ doc: "hello\nworld", selection: { anchor: 8 } });
    expect(cursorInfo(s)).toEqual({ line: 2, col: 3, selection: 0 });
  });

  it("sums the selection length", () => {
    const s = EditorState.create({ doc: "hello world", selection: { anchor: 0, head: 5 } });
    expect(cursorInfo(s).selection).toBe(5);
  });
});
