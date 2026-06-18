import { FolderOpenIcon, SearchIcon, KeyboardIcon } from "./icons";
import { IconButton } from "./IconButton";

type View = "explorer" | "search";

interface Props {
  activeView: View;
  sidebarVisible: boolean;
  onActivate: (view: View) => void;
  onOpenShortcuts: () => void;
}

export function ActivityBar({ activeView, sidebarVisible, onActivate, onOpenShortcuts }: Props) {
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
        <FolderOpenIcon size={19} strokeWidth={1.8} />
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
        <SearchIcon size={19} strokeWidth={1.8} />
      </button>
      <IconButton
        label="Keyboard Shortcuts"
        onClick={onOpenShortcuts}
        className="mt-auto w-[38px] h-[38px] rounded-[9px] text-tx-3 hover:bg-white/5 hover:text-tx-bright"
      >
        <KeyboardIcon size={19} strokeWidth={1.8} />
      </IconButton>
    </div>
  );
}
