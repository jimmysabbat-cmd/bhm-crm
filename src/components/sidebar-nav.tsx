"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, CheckSquare, Settings, Wallet, PhoneCall } from "lucide-react";

const icons = {
  tresorerie: LayoutDashboard,
  dossiers: FolderKanban,
  taches: CheckSquare,
  finances: Wallet,
  parametrage: Settings,
  leads: PhoneCall,
};

export type SidebarLink = {
  href: string;
  label: string;
  icon: keyof typeof icons;
};

export function SidebarNav({ links }: { links: SidebarLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {links.map((link) => {
        const Icon = icons[link.icon];
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-emerald-500/15 text-emerald-300"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
