import { describe, it, expect } from "vitest";
import { basename, dirname, joinPath } from "./paths";

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
});
