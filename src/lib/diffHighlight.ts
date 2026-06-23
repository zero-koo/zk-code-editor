import { highlightTree } from "@lezer/highlight";
import { StyleModule } from "style-mod";
import { zkHighlight } from "./editorTheme";
import { lezerParserFor } from "./language";

export interface Segment {
  text: string;
  className?: string;
}

let stylesMounted = false;
function ensureStyles(): void {
  // zkHighlight uses inline-style specs so .module is non-null; mounting it makes
  // the class names produced by highlightTree carry the editor's colors. mount()
  // dedupes, so this is safe even though EditorPane also mounts it.
  if (!stylesMounted && zkHighlight.module) {
    StyleModule.mount(document, zkHighlight.module);
    stylesMounted = true;
  }
}

const cache = new Map<string, Segment[][]>();

export function clearHighlightCache(): void {
  cache.clear();
}

/** Parses the full text and returns per-line styled segments (index = line - 1). */
export function highlightToLines(text: string, languageId: string): Segment[][] {
  const parser = lezerParserFor(languageId);
  if (!parser) {
    return text.split("\n").map((line) => [{ text: line }]);
  }
  ensureStyles();
  const tree = parser.parse(text);

  // Ordered ranges over the whole text, filling gaps between styled tokens.
  const ranges: { from: number; to: number; cls?: string }[] = [];
  let pos = 0;
  highlightTree(tree, zkHighlight, (from, to, classes) => {
    if (from > pos) ranges.push({ from: pos, to: from });
    ranges.push({ from, to, cls: classes });
    pos = to;
  });
  if (pos < text.length) ranges.push({ from: pos, to: text.length });

  // Split ranges into per-line segments on newlines.
  const lines: Segment[][] = [];
  let current: Segment[] = [];
  for (const r of ranges) {
    const parts = text.slice(r.from, r.to).split("\n");
    parts.forEach((part, i) => {
      if (i > 0) {
        lines.push(current);
        current = [];
      }
      if (part.length) current.push({ text: part, className: r.cls });
    });
  }
  lines.push(current);
  return lines;
}

/** Memoized by (languageId, text) so each file is parsed once. */
export function getHighlightedLines(text: string, languageId: string): Segment[][] {
  const key = `${languageId}\n${text}`;
  let v = cache.get(key);
  if (!v) {
    v = highlightToLines(text, languageId);
    cache.set(key, v);
  }
  return v;
}
