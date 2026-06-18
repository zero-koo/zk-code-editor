import { languageLabel } from "../lib/language";
import type { CursorInfo } from "../lib/cursorInfo";

interface Props {
  path: string | null;
  languageId: string | null;
  cursor?: CursorInfo | null;
}

export function StatusBar({ path, languageId, cursor }: Props) {
  return (
    <div
      className="h-[30px] shrink-0 flex items-center px-3.5 bg-bg-1 border-t border-bd-2 text-[11.5px] text-tx-2"
      data-testid="statusbar"
    >
      {path && <span className="text-tx-2">{path}</span>}
      <span className="flex-1" />
      <div className="flex items-center gap-4">
        {cursor && (
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
}
