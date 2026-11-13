"use client";

import { usePathname } from "next/navigation";

// Onderbalk van de webmin (systeembeheerder). Gewone gebruikers hebben de navigatie van de gedeelde interface onder /app.
const ITEMS: { href: string; label: string; icon: string }[] = [
  { href: "/dashboard", label: "Overzicht", icon: "⌂" },
  { href: "/ringen", label: "Ringen", icon: "◎" },
  { href: "/instellingen", label: "Instellingen", icon: "⚙" },
  { href: "/profiel", label: "Profiel", icon: "☺" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav" aria-label="Hoofdnavigatie">
      {ITEMS.map((item) => {
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
