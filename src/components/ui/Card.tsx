import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/50 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold text-slate-900">{children}</h2>;
}
