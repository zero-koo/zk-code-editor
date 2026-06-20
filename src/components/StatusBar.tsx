import { memo } from "react";
import { languageLabel } from "../lib/language";
import { useCursorStore } from "../store/cursorStore";

interface Props {
  path: string | null;
  languageId: string | null;
}

// Subscribes to the cursor store directly so cursor updates re-render only the
// status bar, not the App tree. Cursor is shown only when a file is open (path).
export const StatusBar = memo(function StatusBar({ path, languageId }: Props) {
  const cursor = useCursorStore((s) => s.cursor);
  return (
    <div
      className="h-[30px] shrink-0 flex items-center px-3.5 bg-bg-1 border-t border-bd-2 text-[11.5px] text-tx-2"
      data-testid="statusbar"
    >
      {path && <span className="text-tx-2">{path}</span>}
      <span className="flex-1" />
      <div className="flex items-center gap-4">
        {path && cursor && (
          <span>
            Ln {cursor.line}, Col {cursor.col}
            {cursor.selection > 0 && ` (${cursor.selection} selected)`}
          </span>
        )}
        {languageId && (
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            {languageLabel(languageId)}
          </span>
        )}
      </div>
    </div>
  );
});
