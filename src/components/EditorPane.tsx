import { useEffect, useRef } from "react";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildEditorState, pruneByKeys } from "../lib/editorState";
import { cursorInfo, type CursorInfo } from "../lib/cursorInfo";

interface Props {
  activePath: string;
  openPaths: string[];
  languageId: string;
  initialDoc: string;
  onChange: (doc: string) => void;
  onSave: (doc: string) => void;
  onPersist?: (path: string, doc: string) => void;
  onCursorChange?: (info: CursorInfo) => void;
  reveal?: { line: number; matchStart: number; matchEnd: number; seq: number };
}

export function EditorPane({
  activePath,
  openPaths,
  languageId,
  initialDoc,
  onChange,
  onSave,
  onPersist,
  onCursorChange,
  reveal,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cacheRef = useRef(new Map<string, EditorState>());
  const scrollRef = useRef(new Map<string, number>());
  const currentPathRef = useRef<string | null>(null);
  // Assigned during render (not in an effect) so every effect reads the latest
  // committed props. buildEditorState reads onChange/onSave/onCursorChange here.
  const propsRef = useRef({
    languageId,
    initialDoc,
    openPaths,
    onChange,
    onSave,
    onPersist,
    onCursorChange,
  });
  propsRef.current = {
    languageId,
    initialDoc,
    openPaths,
    onChange,
    onSave,
    onPersist,
    onCursorChange,
  };

  // Mount once: create the single persistent view for the initial file.
  useEffect(() => {
    if (!hostRef.current) return;
    const p = propsRef.current;
    const state = buildEditorState(p.initialDoc, p.languageId, propsRef);
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    currentPathRef.current = activePath;
    cacheRef.current.set(activePath, view.state);
    p.onCursorChange?.(cursorInfo(view.state));
    return () => {
      const cur = currentPathRef.current;
      if (cur) propsRef.current.onPersist?.(cur, view.state.doc.toString());
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch files: save the outgoing state/scroll/doc, then swap in the target.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activePath) return;
    const prev = currentPathRef.current;
    if (prev === activePath) return; // includes the first render (set in mount)
    const p = propsRef.current;
    if (prev != null && p.openPaths.includes(prev)) {
      cacheRef.current.set(prev, view.state);
      scrollRef.current.set(prev, view.scrollDOM.scrollTop);
      p.onPersist?.(prev, view.state.doc.toString());
    }
    const state =
      cacheRef.current.get(activePath) ??
      buildEditorState(p.initialDoc, p.languageId, propsRef);
    view.setState(state);
    // setState does NOT fire the updateListener, so report the cursor explicitly.
    p.onCursorChange?.(cursorInfo(view.state));
    // setState does NOT restore scroll either — re-apply the saved offset.
    const top = scrollRef.current.get(activePath);
    if (top != null) {
      view.requestMeasure({
        read: () => {},
        write: () => {
          if (viewRef.current) viewRef.current.scrollDOM.scrollTop = top;
        },
      });
    }
    currentPathRef.current = activePath;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // Reveal a search match (declared after the switch effect so the target doc
  // is already loaded). Keeps focus in the search panel (no view.focus()).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq]);

  // Evict cached states/scroll for tabs that are no longer open. Declared last
  // so it runs after the switch effect in a shared commit (e.g. closing a tab).
  useEffect(() => {
    pruneByKeys(cacheRef.current, openPaths);
    pruneByKeys(scrollRef.current, openPaths);
  }, [openPaths]);

  return <div className="editor-host" ref={hostRef} />;
}
