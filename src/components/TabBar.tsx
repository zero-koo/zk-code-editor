import type { Tab } from "../api/types";

interface Props {
  tabs: Tab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export function TabBar({ tabs, activePath, onSelect, onClose }: Props) {
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          role="tab"
          aria-selected={tab.path === activePath}
          className={`tab${tab.path === activePath ? " active" : ""}`}
          onClick={() => onSelect(tab.path)}
        >
          <span className="tab-name">{tab.name}</span>
          {tab.dirty && <span data-testid={`dirty-${tab.path}`} className="dirty">●</span>}
          <button
            className="tab-close"
            aria-label={`Close ${tab.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.path);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
