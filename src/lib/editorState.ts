import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { zkTheme } from "./editorTheme";
import { languageExtension } from "./language";
import { cursorInfo, type CursorInfo } from "./cursorInfo";

export interface EditorCallbacks {
  onChange: (doc: string) => void;
  onSave: (doc: string) => void;
  onCursorChange?: (info: CursorInfo) => void;
}

/**
 * Builds a fresh EditorState with the editor's full extension set and the
 * given document/language. Callbacks are read through a ref at event time so
 * cached states always invoke the latest handlers.
 */
export function buildEditorState(
  doc: string,
  languageId: string,
  callbacks: { current: EditorCallbacks }
): EditorState {
  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      run: (view) => {
        callbacks.current.onSave(view.state.doc.toString());
        return true;
      },
    },
  ]);
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      saveKeymap,
      languageExtension(languageId),
      zkTheme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
        if (u.docChanged || u.selectionSet) {
          callbacks.current.onCursorChange?.(cursorInfo(u.state));
        }
      }),
    ],
  });
}

/** Deletes every key of `map` that is not present in `keep`. */
export function pruneByKeys<T>(map: Map<string, T>, keep: string[]): void {
  const open = new Set(keep);
  for (const key of [...map.keys()]) {
    if (!open.has(key)) map.delete(key);
  }
}
