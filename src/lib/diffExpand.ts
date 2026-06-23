import type { Hunk } from "../api/types";

export interface HunkBounds {
  firstNew: number;
  lastNew: number;
  firstOld: number;
  lastOld: number;
}

export interface GapSpec {
  beforeHunkIndex: number; // gap precedes this hunk index (=== hunks.length → after last)
  startNew: number; // hidden new-side range (inclusive)
  endNew: number;
  delta: number; // oldNo = newNo - delta within the gap
  hasPrev: boolean;
  hasNext: boolean;
}

export interface RevealLine {
  newNo: number;
  oldNo: number;
  text: string;
}

export interface RevealedGap {
  topLines: RevealLine[];
  bottomLines: RevealLine[];
  remaining: number;
  canUp: boolean;
  canDown: boolean;
}

function firstNonNull(xs: (number | null)[]): number {
  for (const x of xs) if (x != null) return x;
  return 0;
}
function lastNonNull(xs: (number | null)[]): number {
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i];
    if (x != null) return x;
  }
  return 0;
}

export function hunkBounds(h: Hunk): HunkBounds {
  const news = h.lines.map((l) => l.new_no);
  const olds = h.lines.map((l) => l.old_no);
  return {
    firstNew: firstNonNull(news),
    lastNew: lastNonNull(news),
    firstOld: firstNonNull(olds),
    lastOld: lastNonNull(olds),
  };
}

export function fileGaps(hunks: Hunk[], totalNewLines: number): GapSpec[] {
  if (hunks.length === 0) return [];
  const b = hunks.map(hunkBounds);
  const gaps: GapSpec[] = [];

  if (b[0].firstNew - 1 >= 1) {
    gaps.push({
      beforeHunkIndex: 0,
      startNew: 1,
      endNew: b[0].firstNew - 1,
      delta: b[0].firstNew - b[0].firstOld,
      hasPrev: false,
      hasNext: true,
    });
  }
  for (let i = 0; i < hunks.length - 1; i++) {
    const startNew = b[i].lastNew + 1;
    const endNew = b[i + 1].firstNew - 1;
    if (endNew >= startNew) {
      gaps.push({
        beforeHunkIndex: i + 1,
        startNew,
        endNew,
        delta: b[i + 1].firstNew - b[i + 1].firstOld,
        hasPrev: true,
        hasNext: true,
      });
    }
  }
  const last = b[b.length - 1];
  if (totalNewLines >= last.lastNew + 1) {
    gaps.push({
      beforeHunkIndex: hunks.length,
      startNew: last.lastNew + 1,
      endNew: totalNewLines,
      delta: last.lastNew - last.lastOld,
      hasPrev: true,
      hasNext: false,
    });
  }
  return gaps;
}

export function revealGap(
  gap: GapSpec,
  state: { top: number; bottom: number },
  newLines: string[]
): RevealedGap {
  const len = gap.endNew - gap.startNew + 1;
  const top = Math.min(Math.max(state.top, 0), len);
  const bottom = Math.min(Math.max(state.bottom, 0), len - top);
  const mk = (L: number): RevealLine => ({ newNo: L, oldNo: L - gap.delta, text: newLines[L - 1] ?? "" });

  const topLines: RevealLine[] = [];
  for (let L = gap.startNew; L <= gap.startNew + top - 1; L++) topLines.push(mk(L));
  const bottomLines: RevealLine[] = [];
  for (let L = gap.endNew - bottom + 1; L <= gap.endNew; L++) bottomLines.push(mk(L));

  const remaining = len - top - bottom;
  return {
    topLines,
    bottomLines,
    remaining,
    canUp: gap.hasNext && remaining > 0,
    canDown: gap.hasPrev && remaining > 0,
  };
}
