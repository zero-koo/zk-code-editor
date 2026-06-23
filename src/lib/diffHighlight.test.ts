import { describe, it, expect } from "vitest";
import { highlightToLines } from "./diffHighlight";

describe("highlightToLines", () => {
  it("returns one entry per line", () => {
    expect(highlightToLines("const x = 1\nconst y = 2", "typescript").length).toBe(2);
  });

  it("highlights a keyword with a class", () => {
    const out = highlightToLines("const x = 1", "typescript");
    const kw = out[0].find((s) => s.text === "const");
    expect(kw?.className).toBeTruthy();
  });

  it("falls back to plain segments for an unsupported language", () => {
    expect(highlightToLines("hello world", "plaintext")).toEqual([[{ text: "hello world" }]]);
  });

  it("preserves each line's content for CRLF text", () => {
    const out = highlightToLines("a\r\nb", "typescript");
    expect(out.length).toBe(2);
    expect(out[0].map((s) => s.text).join("")).toBe("a\r");
    expect(out[1].map((s) => s.text).join("")).toBe("b");
  });
});
