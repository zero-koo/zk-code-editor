import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { languageExtension } from "../lib/language";

interface Props {
  path: string;
  languageId: string;
  initialDoc: string;
  onChange: (doc: string) => void;
  onSave: (doc: string) => void;
}

export function EditorPane({ path, languageId, initialDoc, onChange, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef({ onChange, onSave });
  cbRef.current = { onChange, onSave };

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
        oneDark,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbRef.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return <div className="editor-host" ref={hostRef} />;
}
