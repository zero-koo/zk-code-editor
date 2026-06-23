import { describe, it, expect } from "vitest";
import { activeFileForOffset } from "./diffNav";

const files = [
  { path: "a", top: 0 },
  { path: "b", top: 100 },
  { path: "c", top: 250 },
];

describe("activeFileForOffset", () => {
  it("returns the first file at offset 0", () => {
    expect(activeFileForOffset(files, 0)).toBe("a");
  });

  it("returns the file whose section contains the offset", () => {
    expect(activeFileForOffset(files, 99)).toBe("a");
    expect(activeFileForOffset(files, 100)).toBe("b");
    expect(activeFileForOffset(files, 240)).toBe("b");
    expect(activeFileForOffset(files, 250)).toBe("c");
  });

  it("returns the last file when scrolled past everything", () => {
    expect(activeFileForOffset(files, 9999)).toBe("c");
  });

  it("returns null for an empty list", () => {
    expect(activeFileForOffset([], 0)).toBeNull();
  });
});
