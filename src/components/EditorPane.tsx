import { useEffect, useRef } from "react";
import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { zkTheme } from "../lib/editorTheme";
import { languageExtension } from "../lib/language";

interface Props {
  path: string;
  languageId: string;
  initialDoc: string;
  onChange: (doc: string) => void;
  onSave: (doc: string) => void;
  onPersist?: (path: string, doc: string) => void;
  reveal?: { line: number; matchStart: number; matchEnd: number; seq: number };
}

export function EditorPane({ path, languageId, initialDoc, onChange, onSave, onPersist, reveal }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef({ onChange, onSave, onPersist });
  cbRef.current = { onChange, onSave, onPersist };

  useEffect(() => {
    if (!hostRef.current) return;
    const language = new Compartment();
    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: (view) => {
          cbRef.current.onSave(view.state.doc.toString());
          return true;
        },
      },
    ]);
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        saveKeymap,
        language.of(languageExtension(languageId)),
        zkTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbRef.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    const p = path;
    return () => {
      cbRef.current.onPersist?.(p, view.state.doc.toString());
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal) return;
    const doc = view.state.doc;
    const line = Math.min(Math.max(reveal.line, 1), doc.lines);
    const info = doc.line(line);
    const from = Math.min(info.from + reveal.matchStart, info.to);
    const to = Math.min(info.from + reveal.matchEnd, info.to);
    view.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq]);

  return <div className="editor-host" ref={hostRef} />;
}
