import { describe, it, expect } from "vitest";
import { splitHighlights } from "./highlight";

describe("splitHighlights", () => {
  it("splits a preview into highlighted and plain segments", () => {
    expect(splitHighlights("abcde", [[1, 3]])).toEqual([
      { text: "a", hl: false },
      { text: "bc", hl: true },
      { text: "de", hl: false },
    ]);
  });
  it("handles a match at the start and multiple ranges", () => {
    expect(splitHighlights("foobar", [[0, 3], [3, 4]])).toEqual([
      { text: "foo", hl: true },
      { text: "b", hl: true },
      { text: "ar", hl: false },
    ]);
  });
  it("returns the whole string unhighlighted when no ranges", () => {
    expect(splitHighlights("plain", [])).toEqual([{ text: "plain", hl: false }]);
  });
});
