import { describe, it, expect } from "vitest";
import { basename, dirname, joinPath, relativePath } from "./paths";

describe("path helpers", () => {
  it("basename returns the last segment", () => {
    expect(basename("/a/b/c.ts")).toBe("c.ts");
  });
  it("dirname returns the parent", () => {
    expect(dirname("/a/b/c.ts")).toBe("/a/b");
  });
  it("joinPath joins with a single separator", () => {
    expect(joinPath("/a/b", "c.ts")).toBe("/a/b/c.ts");
    expect(joinPath("/a/b/", "c.ts")).toBe("/a/b/c.ts");
  });
  it("relativePath strips the root prefix", () => {
    expect(relativePath("/proj", "/proj/src/a.ts")).toBe("src/a.ts");
    expect(relativePath("/proj/", "/proj/src/a.ts")).toBe("src/a.ts");
  });
  it("relativePath returns the basename for the root itself", () => {
    expect(relativePath("/proj", "/proj")).toBe("proj");
  });
  it("relativePath falls back to the original path when not under root", () => {
    expect(relativePath("/proj", "/other/x.ts")).toBe("/other/x.ts");
  });
});
