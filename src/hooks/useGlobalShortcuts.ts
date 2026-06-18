import { useEffect, useRef } from "react";
import { SHORTCUTS, matchKeyEvent, isMac } from "../lib/shortcuts";

/**
 * Attaches a single capture-phase window keydown listener that dispatches to
 * `handlers` keyed by shortcut id. Capture phase + stopPropagation lets these
 * win over CodeMirror's own keymap (e.g. Mod-/ comment toggle). displayOnly
 * shortcuts are never dispatched here.
 */
export function useGlobalShortcuts(handlers: Record<string, () => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      for (const sc of SHORTCUTS) {
        if (sc.displayOnly) continue;
        const handler = ref.current[sc.id];
        if (!handler) continue;
        if (matchKeyEvent(e, sc.combo, isMac)) {
          e.preventDefault();
          e.stopPropagation();
          handler();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
