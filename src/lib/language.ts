import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { go } from "@codemirror/legacy-modes/mode/go";
import { shell } from "@codemirror/legacy-modes/mode/shell";

const EXT_TO_ID: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  json: "json",
  html: "html", htm: "html",
  css: "css",
  md: "markdown", markdown: "markdown",
  py: "python",
  rs: "rust",
  yaml: "yaml", yml: "yaml",
  go: "go",
  sh: "shell", bash: "shell", zsh: "shell",
};

const ID_TO_LABEL: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  markdown: "Markdown",
  python: "Python",
  rust: "Rust",
  yaml: "YAML",
  go: "Go",
  shell: "Shell",
  plaintext: "Plain Text",
};

export function languageIdForFile(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_ID[ext] ?? "plaintext";
}

export function languageLabel(id: string): string {
  return ID_TO_LABEL[id] ?? "Plain Text";
}

/** Returns the CodeMirror language extension(s) for a language id. */
export function languageExtension(id: string): Extension {
  switch (id) {
    case "javascript": return javascript({ jsx: true });
    case "typescript": return javascript({ jsx: true, typescript: true });
    case "json": return json();
    case "html": return html();
    case "css": return css();
    case "markdown": return markdown();
    case "python": return python();
    case "rust": return rust();
    case "yaml": return yaml();
    case "go": return StreamLanguage.define(go);
    case "shell": return StreamLanguage.define(shell);
    default: return [];
  }
}
