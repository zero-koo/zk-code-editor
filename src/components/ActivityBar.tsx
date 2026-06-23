import { FolderOpenIcon, SearchIcon, KeyboardIcon, GitBranchIcon } from "./icons";
import { IconButton } from "./IconButton";
import { useGitStore } from "../store/gitStore";

type View = "explorer" | "search" | "git";

interface Props {
  activeView: View;
  sidebarVisible: boolean;
  onActivate: (view: View) => void;
  onOpenShortcuts: () => void;
}

export function ActivityBar({ activeView, sidebarVisible, onActivate, onOpenShortcuts }: Props) {
  const gitCount = useGitStore((s) => s.changes?.files.length ?? 0);
  const isActive = (v: View) =>
    v === "git" ? activeView === "git" : sidebarVisible && activeView === v;
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
      <button
        aria-label="Source Control"
        aria-pressed={isActive("git")}
        onClick={() => onActivate("git")}
        className={`relative w-[38px] h-[38px] rounded-[9px] flex items-center justify-center ${
          isActive("git") ? "bg-accent/15 text-accent-soft" : "text-tx-3 hover:bg-white/5 hover:text-tx-bright"
        }`}
      >
        {isActive("git") && (
          <span className="absolute left-[-10px] top-[9px] w-[2.5px] h-5 rounded bg-accent" />
        )}
        <GitBranchIcon size={19} strokeWidth={1.8} />
        {gitCount > 0 && (
          <span className="absolute -bottom-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-white text-[10px] leading-none font-medium flex items-center justify-center">
            {gitCount > 99 ? "99+" : gitCount}
          </span>
        )}
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
