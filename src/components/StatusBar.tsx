import { languageLabel } from "../lib/language";

interface Props {
  path: string | null;
  languageId: string | null;
}

export function StatusBar({ path, languageId }: Props) {
  return (
    <div className="statusbar" data-testid="statusbar">
      {path && <span className="status-path">{path}</span>}
      {languageId && <span className="status-lang">{languageLabel(languageId)}</span>}
    </div>
  );
}
