import type { ReactNode } from "react";

/** Uppercase sidebar section header label (Explorer, Search, …). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold tracking-[0.13em] uppercase text-tx-3">
      {children}
    </span>
  );
}
