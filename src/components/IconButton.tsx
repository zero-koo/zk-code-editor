import type { MouseEvent, ReactNode } from "react";

interface Props {
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: ReactNode;
}

/** Square, centered icon button. Size/rounding/colors come from `className`. */
export function IconButton({ label, onClick, className = "", children }: Props) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`flex items-center justify-center ${className}`}
    >
      {children}
    </button>
  );
}
