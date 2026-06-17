type View = "explorer" | "search";

interface Props {
  activeView: View;
  sidebarVisible: boolean;
  onActivate: (view: View) => void;
}

export function ActivityBar({ activeView, sidebarVisible, onActivate }: Props) {
  const isActive = (v: View) => sidebarVisible && activeView === v;
  return (
    <div className="w-[54px] shrink-0 bg-titlebar border-r border-bd-2 flex flex-col items-center py-2.5 gap-1">
      <button
        aria-label="Explorer"
        aria-pressed={isActive("explorer")}
        onClick={() => onActivate("explorer")}
        className={`relative w-[38px] h-[38px] rounded-[9px] flex items-center justify-center ${
          isActive("explorer") ? "bg-accent/15 text-accent-soft" : "text-tx-3 hover:bg-white/5 hover:text-tx-bright"
        }`}
      >
        {isActive("explorer") && (
          <span className="absolute left-[-10px] top-[9px] w-[2.5px] h-5 rounded bg-accent" />
        )}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </button>
      <button
        aria-label="Search"
        aria-pressed={isActive("search")}
        onClick={() => onActivate("search")}
        className={`relative w-[38px] h-[38px] rounded-[9px] flex items-center justify-center ${
          isActive("search") ? "bg-accent/15 text-accent-soft" : "text-tx-3 hover:bg-white/5 hover:text-tx-bright"
        }`}
      >
        {isActive("search") && (
          <span className="absolute left-[-10px] top-[9px] w-[2.5px] h-5 rounded bg-accent" />
        )}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>
    </div>
  );
}
