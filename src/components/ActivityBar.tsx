interface Props {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
}

export function ActivityBar({ sidebarVisible, onToggleSidebar }: Props) {
  return (
    <div className="w-[54px] shrink-0 bg-titlebar border-r border-bd-2 flex flex-col items-center py-2.5">
      <button
        aria-label="Explorer"
        aria-pressed={sidebarVisible}
        onClick={onToggleSidebar}
        className={`relative w-[38px] h-[38px] rounded-[9px] flex items-center justify-center ${
          sidebarVisible
            ? "bg-accent/15 text-accent-soft"
            : "text-tx-3 hover:bg-white/5 hover:text-tx-bright"
        }`}
      >
        {sidebarVisible && (
          <span className="absolute left-[-10px] top-[9px] w-[2.5px] h-5 rounded bg-accent" />
        )}
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </button>
    </div>
  );
}
