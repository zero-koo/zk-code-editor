import { languageLabel } from "../lib/language";

interface Props {
  path: string | null;
  languageId: string | null;
}

export function StatusBar({ path, languageId }: Props) {
  return (
    <div
      className="h-[30px] shrink-0 flex items-center px-3.5 bg-bg-1 border-t border-bd-2 text-[11.5px] text-tx-2"
      data-testid="statusbar"
    >
      {path && <span className="text-tx-2">{path}</span>}
      <span className="flex-1" />
      {languageId && (
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          {languageLabel(languageId)}
        </span>
      )}
    </div>
  );
}
