import type { ReactNode } from "react";

/** Fixed-width sidebar shell shared by the Explorer and Search panels. */
export function SidebarPanel({ children }: { children: ReactNode }) {
  return (
    <div className="w-[258px] shrink-0 bg-bg-1 border-r border-bd-2 flex flex-col">
      {children}
    </div>
  );
}
