import { describe, it, expect } from "vitest";
import { buildEditorState, pruneByKeys } from "./editorState";

const callbacks = { current: { onChange: () => {}, onSave: () => {} } };

describe("buildEditorState", () => {
  it("creates a state holding the given document", () => {
    const state = buildEditorState("line1\nline2", "typescript", callbacks);
    expect(state.doc.toString()).toBe("line1\nline2");
    expect(state.doc.lines).toBe(2);
  });

  it("starts with the cursor at the document start", () => {
    const state = buildEditorState("abc", "typescript", callbacks);
    expect(state.selection.main.head).toBe(0);
  });
});

describe("pruneByKeys", () => {
  it("removes keys that are not in the keep list", () => {
    const m = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
    pruneByKeys(m, ["a", "c"]);
    expect([...m.keys()]).toEqual(["a", "c"]);
  });

  it("keeps all present keys even if the keep list has extras", () => {
    const m = new Map<string, number>([["a", 1]]);
    pruneByKeys(m, ["a", "b"]);
    expect(m.has("a")).toBe(true);
    expect(m.size).toBe(1);
  });
});
