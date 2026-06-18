interface Props {
  /** The active file name, or null when nothing is open. */
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
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6e7bf2"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
        </svg>
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
