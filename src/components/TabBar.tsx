import { useEffect, useRef } from "react";
import type { Tab } from "../api/types";
import { FileIcon, CloseIcon } from "./icons";

interface Props {
  tabs: Tab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export function TabBar({ tabs, activePath, onSelect, onClose }: Props) {
  const activeRef = useRef<HTMLDivElement>(null);

  // Reveal the active tab when it changes — it may be scrolled out of view in
  // the horizontally-scrolling tab bar (e.g. opened from a search result).
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [activePath]);

  return (
    <div
      className="h-[42px] shrink-0 flex items-stretch overflow-x-auto overflow-y-hidden bg-bg-1 border-b border-bd-2"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        return (
          <div
            key={tab.path}
            ref={active ? activeRef : undefined}
            role="tab"
            aria-selected={active}
            className={`relative flex items-center gap-2 pl-3.5 pr-3 cursor-pointer border-r border-bd-2 text-[12.5px] shrink-0 whitespace-nowrap ${
              active
                ? "text-white bg-bg-2 font-medium"
                : "text-tx-2 hover:text-tx-bright hover:bg-white/[0.02]"
            }`}
            onClick={() => onSelect(tab.path)}
          >
            {active && (
              <span className="absolute top-0 left-0 right-0 h-0.5 bg-accent" />
            )}
            <FileIcon size={14} stroke={active ? "#7aa2f7" : "#5b6da8"} className="shrink-0" />
            <span className="tab-name truncate max-w-[160px]">{tab.name}</span>
            {tab.dirty && (
              <span
                data-testid={`dirty-${tab.path}`}
                className="w-2 h-2 rounded-full bg-[#d4d4dc]"
              />
            )}
            <button
              aria-label={`Close ${tab.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.path);
              }}
              className="flex w-[17px] h-[17px] items-center justify-center rounded-[5px] text-tx-faint hover:bg-[#2a2a32] hover:text-tx-1"
            >
              <CloseIcon size={11} strokeWidth={2.2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
