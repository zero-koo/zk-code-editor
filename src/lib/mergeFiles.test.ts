import { describe, it, expect } from "vitest";
import { mergeFiles } from "./mergeFiles";
import type { FileDiff } from "../api/types";

const mk = (path: string, status: FileDiff["status"] = "modified"): FileDiff => ({
  path,
  old_path: null,
  status,
  additions: 0,
  deletions: 0,
  binary: false,
  too_large: false,
  new_text: null,
  old_text: null,
  hunks: [],
});

describe("mergeFiles", () => {
  it("keeps a staged-only file with unstaged null", () => {
    const m = mergeFiles([mk("a.ts")], []);
    expect(m).toHaveLength(1);
    expect(m[0].path).toBe("a.ts");
    expect(m[0].staged).not.toBeNull();
    expect(m[0].unstaged).toBeNull();
  });

  it("keeps an unstaged-only file with staged null", () => {
    const m = mergeFiles([], [mk("b.ts")]);
    expect(m[0].path).toBe("b.ts");
    expect(m[0].staged).toBeNull();
    expect(m[0].unstaged).not.toBeNull();
  });

  it("merges a file present in both streams", () => {
    const m = mergeFiles([mk("c.ts")], [mk("c.ts")]);
    expect(m).toHaveLength(1);
    expect(m[0].staged).not.toBeNull();
    expect(m[0].unstaged).not.toBeNull();
  });

  it("uses the staged status when present in both", () => {
    const m = mergeFiles([mk("d.ts", "added")], [mk("d.ts", "modified")]);
    expect(m[0].status).toBe("added");
  });

  it("orders staged files first, then unstaged-only files", () => {
    const m = mergeFiles([mk("s.ts")], [mk("s.ts"), mk("u.ts")]);
    expect(m.map((f) => f.path)).toEqual(["s.ts", "u.ts"]);
  });
});
