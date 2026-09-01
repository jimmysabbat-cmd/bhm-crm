import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary:
    "bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 focus-visible:ring-emerald-500/40",
  secondary:
    "bg-white text-slate-700 border border-slate-200 shadow-sm hover:bg-slate-50 focus-visible:ring-slate-500/30",
  ghost:
    "text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus-visible:ring-slate-500/30",
  danger:
    "text-red-600 hover:text-white hover:bg-red-600 focus-visible:ring-red-500/40",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
