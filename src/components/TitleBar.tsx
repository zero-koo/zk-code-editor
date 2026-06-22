import { CodeIcon } from "./icons";

interface Props {
  /** The project (workspace root) name, or null when no folder is open. */
  title: string | null;
}

/**
 * macOS overlay-style titlebar. The native traffic-light buttons float over the
 * left padding (handled by tauri's `titleBarStyle: "Overlay"`); we draw the
 * centered title and make the whole bar a drag region to move the window.
 */
export function TitleBar({ title }: Props) {
  return (
    <div
      data-tauri-drag-region
      className="h-10 shrink-0 flex items-center bg-titlebar border-b border-bd-2 pl-[78px] pr-3 select-none"
    >
      <div
        data-tauri-drag-region
        className="flex-1 min-w-0 flex items-center justify-center gap-2 text-xs text-tx-2 pointer-events-none"
      >
        <CodeIcon size={13} stroke="#6e7bf2" strokeWidth={2.1} className="shrink-0" />
        {title ? (
          <>
            <span className="text-tx-bright font-medium truncate">{title}</span>
            <span className="text-tx-faint shrink-0">— zk-code-editor</span>
          </>
        ) : (
          <span className="text-tx-bright font-medium truncate">zk-code-editor</span>
        )}
      </div>
    </div>
  );
}
