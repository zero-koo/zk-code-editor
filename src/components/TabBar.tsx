import type { Tab } from "../api/types";

interface Props {
  tabs: Tab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export function TabBar({ tabs, activePath, onSelect, onClose }: Props) {
  return (
    <div
      className="h-[42px] shrink-0 flex items-stretch bg-bg-1 border-b border-bd-2"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={active}
            className={`relative flex items-center gap-2 pl-3.5 pr-3 cursor-pointer border-r border-bd-2 text-[12.5px] ${
              active
                ? "text-white bg-bg-2 font-medium"
                : "text-tx-2 hover:text-tx-bright hover:bg-white/[0.02]"
            }`}
            onClick={() => onSelect(tab.path)}
          >
            {active && (
              <span className="absolute top-0 left-0 right-0 h-0.5 bg-accent" />
            )}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={active ? "#7aa2f7" : "#5b6da8"}
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <span className="tab-name">{tab.name}</span>
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
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
