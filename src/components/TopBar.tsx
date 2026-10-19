import type { Role } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/format";
import { logoutAction } from "@/lib/actions/auth.actions";

type NavFlags = { dashboard: boolean; roepingen: boolean; gebruikers: boolean; instellingen: boolean; profiel: boolean };

const LINKS: { key: keyof NavFlags; href: string; label: string }[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "roepingen", href: "/roepingen", label: "Roepingen" },
  { key: "gebruikers", href: "/gebruikers", label: "Gebruikers" },
  { key: "instellingen", href: "/instellingen", label: "Instellingen" },
  { key: "profiel", href: "/profiel", label: "Profiel" },
];

export function TopBar({ user, nav }: { user: { name: string; role: Role }; nav: NavFlags }) {
  return (
    <header className="glass sticky top-0 z-30 flex items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-4 py-3 sm:px-6">
      <div className="flex items-center gap-6">
        <a href="/dashboard" className="text-base font-semibold">
          Ringtools
        </a>
        <nav className="hidden items-center gap-4 sm:flex">
          {LINKS.filter((l) => nav[l.key]).map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="text-xs text-[var(--text-muted)]">{ROLE_LABELS[user.role]}</div>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn-ghost !min-h-[38px] !px-4 text-sm">
            Uitloggen
          </button>
        </form>
      </div>
    </header>
  );
}
