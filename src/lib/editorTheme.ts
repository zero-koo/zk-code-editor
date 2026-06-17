import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const bg = "#17171b";
const fg = "#c9c9d2";
const accent = "#6e7bf2";

const zkEditorTheme = EditorView.theme(
  {
    "&": { color: fg, backgroundColor: bg, height: "100%" },
    ".cm-content": { caretColor: accent, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: "13px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: accent },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "rgba(110,123,242,0.30)" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.035)" },
    ".cm-gutters": { backgroundColor: bg, color: "#3f3f48", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#aab2f7" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 14px" },
    ".cm-foldPlaceholder": { backgroundColor: "transparent", border: "none", color: "#63636e" },
  },
  { dark: true }
);

const zkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: "#c08cf0" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#8fce9b" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7aa2f7" },
  { tag: [t.typeName, t.className, t.namespace], color: "#5fd0c5" },
  { tag: [t.propertyName, t.attributeName], color: "#82aaff" },
  { tag: [t.number, t.bool, t.atom], color: "#e5a366" },
  { tag: [t.tagName, t.angleBracket], color: "#f06d6d" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "#8a8a96" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#5a5a66", fontStyle: "italic" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "#c9c9d2" },
  { tag: [t.constant(t.variableName)], color: "#82aaff" },
  { tag: t.invalid, color: "#f06d6d" },
]);

export const zkTheme: Extension = [zkEditorTheme, syntaxHighlighting(zkHighlight)];
