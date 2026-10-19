"use client";

import { usePathname } from "next/navigation";

type NavFlags = {
  dashboard: boolean;
  roepingen: boolean;
  gebruikers: boolean;
  ringen: boolean;
  instellingen: boolean;
  profiel: boolean;
};

const ITEMS: { key: keyof NavFlags; href: string; label: string; icon: string }[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", icon: "⌂" },
  { key: "roepingen", href: "/roepingen", label: "Roepingen", icon: "☰" },
  { key: "gebruikers", href: "/gebruikers", label: "Gebruikers", icon: "⚇" },
  { key: "ringen", href: "/ringen", label: "Ringen", icon: "◎" },
  { key: "instellingen", href: "/instellingen", label: "Instellingen", icon: "⚙" },
  { key: "profiel", href: "/profiel", label: "Profiel", icon: "☺" },
];

export function BottomNav({ nav }: { nav: NavFlags }) {
  const pathname = usePathname();
  const visible = ITEMS.filter((item) => nav[item.key]);

  return (
    <nav className="bottom-nav" aria-label="Hoofdnavigatie">
      {visible.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <a key={item.href} href={item.href} className={`bottom-nav-item ${active ? "active" : ""}`}>
            <span className="text-lg leading-none">{item.icon}</span>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
