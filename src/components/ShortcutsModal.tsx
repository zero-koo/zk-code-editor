import { useEffect, useRef, useState } from "react";
import { SHORTCUTS, formatCombo, isMac } from "../lib/shortcuts";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ open, onClose }: Props) {
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement;
      inputRef.current?.focus();
    } else {
      setFilter("");
      (prevFocus.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);

  if (!open) return null;

  const q = filter.trim().toLowerCase();
  const visible = SHORTCUTS.filter(
    (sc) =>
      q === "" ||
      sc.label.toLowerCase().includes(q) ||
      formatCombo(sc.combo, isMac).join(" ").toLowerCase().includes(q)
  );
  const groups: string[] = [];
  for (const sc of visible) if (!groups.includes(sc.group)) groups.push(sc.group);

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-label="Keyboard Shortcuts"
        className="mt-[8vh] w-[540px] max-w-[92%] bg-bg-1 border border-[#2c2c34] rounded-[14px] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.75)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-bd-2">
          <span className="flex-1 text-sm font-semibold text-tx-1">Keyboard Shortcuts</span>
          <button
            aria-label="Close"
            onClick={onClose}
            className="flex w-6 h-6 items-center justify-center rounded-md text-tx-2 hover:bg-white/5 hover:text-tx-1"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-4 pt-3 pb-1.5">
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or key…"
            className="w-full bg-bg-0 border border-bd-hover rounded-md px-2.5 py-1.5 text-[13px] text-tx-1 outline-none placeholder:text-tx-3"
          />
        </div>
        <div className="zk-scroll px-2 pb-3 max-h-[60vh] overflow-auto">
          {groups.map((group) => (
            <div key={group}>
              <div className="px-2.5 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-tx-3">
                {group}
              </div>
              {visible
                .filter((sc) => sc.group === group)
                .map((sc) => (
                  <div key={sc.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg">
                    <span className="flex-1 text-[13px] text-tx-1">{sc.label}</span>
                    <span className="flex gap-1">
                      {formatCombo(sc.combo, isMac).map((tok, i) => (
                        <kbd
                          key={i}
                          className="font-mono text-[11px] text-tx-bright bg-bg-3 border border-bd-hover rounded-[5px] px-1.5 py-0.5"
                        >
                          {tok}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
            </div>
          ))}
          {visible.length === 0 && (
            <div className="px-2.5 py-6 text-center text-[12.5px] text-tx-3">No matching shortcuts</div>
          )}
        </div>
      </div>
    </div>
  );
}
