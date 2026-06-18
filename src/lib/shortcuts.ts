export interface KeyCombo {
  mod?: boolean; // ⌘ on mac, Ctrl elsewhere
  shift?: boolean;
  alt?: boolean;
  key: string; // e.key value; letters lowercase, e.g. "e", "f", "s", "/"
}

export interface Shortcut {
  id: string;
  label: string;
  group: string;
  combo: KeyCombo;
  displayOnly?: boolean; // handled elsewhere (e.g. CodeMirror); shown but not globally bound
}

export const SHORTCUTS: Shortcut[] = [
  { id: "view.explorer", label: "Show Explorer", group: "View", combo: { mod: true, shift: true, key: "e" } },
  { id: "view.search", label: "Show Search", group: "View", combo: { mod: true, shift: true, key: "f" } },
  // Save is handled by CodeMirror's Mod-s keymap (see EditorPane); listed here for display only.
  { id: "file.save", label: "Save", group: "File", combo: { mod: true, key: "s" }, displayOnly: true },
  { id: "help.shortcuts", label: "Keyboard Shortcuts", group: "Help", combo: { mod: true, key: "/" } },
];

export const isMac =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent || "");

/** Exact modifier match. `mod` → metaKey on mac / ctrlKey elsewhere; the other
 * platform modifier must never be held; shift/alt must match exactly. */
export function matchKeyEvent(e: KeyboardEvent, combo: KeyCombo, mac: boolean): boolean {
  const modActive = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (otherMod) return false;
  if (!!combo.mod !== modActive) return false;
  if (!!combo.shift !== e.shiftKey) return false;
  if (!!combo.alt !== e.altKey) return false;
  return e.key.toLowerCase() === combo.key.toLowerCase();
}

/** Returns display tokens for a combo, e.g. ["⌘","⇧","E"] (mac) or ["Ctrl","Shift","E"]. */
export function formatCombo(combo: KeyCombo, mac: boolean): string[] {
  const tokens: string[] = [];
  if (combo.mod) tokens.push(mac ? "⌘" : "Ctrl");
  if (combo.shift) tokens.push(mac ? "⇧" : "Shift");
  if (combo.alt) tokens.push(mac ? "⌥" : "Alt");
  tokens.push(combo.key === "/" ? "/" : combo.key.toUpperCase());
  return tokens;
}
