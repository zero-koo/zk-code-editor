import { describe, it, expect } from "vitest";
import { hunkBounds, fileGaps, revealGap } from "./diffExpand";
import type { Hunk, DiffLine } from "../api/types";

const line = (kind: DiffLine["kind"], old_no: number | null, new_no: number | null): DiffLine => ({
  kind,
  old_no,
  new_no,
  text: "x",
});
const hunk = (lines: DiffLine[]): Hunk => ({ header: "@@", lines });

describe("hunkBounds", () => {
  it("scans first/last non-null numbers across add/del-only edges", () => {
    const h = hunk([
      line("del", 5, null),
      line("context", 6, 5),
      line("add", null, 6),
    ]);
    expect(hunkBounds(h)).toEqual({ firstNew: 5, lastNew: 6, firstOld: 5, lastOld: 6 });
  });
});

describe("fileGaps", () => {
  const h0 = hunk([line("context", 4, 4), line("context", 6, 6)]);
  const h1 = hunk([line("context", 19, 20), line("context", 21, 22)]);

  it("computes before / between / after gaps with deltas and direction flags", () => {
    const gaps = fileGaps([h0, h1], 30);
    expect(gaps).toEqual([
      { beforeHunkIndex: 0, startNew: 1, endNew: 3, delta: 0, hasPrev: false, hasNext: true },
      { beforeHunkIndex: 1, startNew: 7, endNew: 19, delta: 1, hasPrev: true, hasNext: true },
      { beforeHunkIndex: 2, startNew: 23, endNew: 30, delta: 1, hasPrev: true, hasNext: false },
    ]);
  });

  it("omits zero-length gaps (whole-file single hunk)", () => {
    const whole = hunk([line("add", null, 1), line("add", null, 3)]);
    expect(fileGaps([whole], 3)).toEqual([]);
  });

  it("returns no gaps for an empty hunk list", () => {
    expect(fileGaps([], 10)).toEqual([]);
  });
});

describe("revealGap", () => {
  const gap = { beforeHunkIndex: 1, startNew: 7, endNew: 19, delta: 1, hasPrev: true, hasNext: true };
  const newLines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);

  it("reveals from the top (down) and bottom (up) with oldNo = newNo - delta", () => {
    const r = revealGap(gap, { top: 2, bottom: 1 }, newLines);
    expect(r.topLines).toEqual([
      { newNo: 7, oldNo: 6, text: "line7" },
      { newNo: 8, oldNo: 7, text: "line8" },
    ]);
    expect(r.bottomLines).toEqual([{ newNo: 19, oldNo: 18, text: "line19" }]);
    expect(r.remaining).toBe(13 - 3);
    expect(r.canUp).toBe(true);
    expect(r.canDown).toBe(true);
  });

  it("clamps converging top/bottom without overlap and hides controls when fully revealed", () => {
    const r = revealGap(gap, { top: 100, bottom: 100 }, newLines);
    expect(r.topLines).toHaveLength(13);
    expect(r.bottomLines).toHaveLength(0);
    expect(r.remaining).toBe(0);
    expect(r.canUp).toBe(false);
    expect(r.canDown).toBe(false);
  });

  it("disables a direction when the gap has no neighbor on that side", () => {
    const before = { beforeHunkIndex: 0, startNew: 1, endNew: 3, delta: 0, hasPrev: false, hasNext: true };
    const r = revealGap(before, { top: 0, bottom: 0 }, newLines);
    expect(r.canDown).toBe(false);
    expect(r.canUp).toBe(true);
  });
});
