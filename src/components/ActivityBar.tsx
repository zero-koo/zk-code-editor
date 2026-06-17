interface Props {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
}

export function ActivityBar({ sidebarVisible, onToggleSidebar }: Props) {
  return (
    <div className="activitybar">
      <button
        aria-label="Explorer"
        aria-pressed={sidebarVisible}
        className={sidebarVisible ? "active" : ""}
        onClick={onToggleSidebar}
      >
        🗂
      </button>
    </div>
  );
}
