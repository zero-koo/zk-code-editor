export interface Segment {
  text: string;
  hl: boolean;
}

/**
 * Splits `preview` into highlighted/plain segments using UTF-16 ranges from the
 * backend (assumed sorted, non-overlapping, and clipped to preview length).
 */
export function splitHighlights(preview: string, ranges: [number, number][]): Segment[] {
  const segs: Segment[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) segs.push({ text: preview.slice(pos, s), hl: false });
    segs.push({ text: preview.slice(s, e), hl: true });
    pos = e;
  }
  if (pos < preview.length) segs.push({ text: preview.slice(pos), hl: false });
  if (segs.length === 0) segs.push({ text: preview, hl: false });
  return segs;
}
