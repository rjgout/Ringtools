import { logoutAction } from "@/lib/actions/auth.actions";

// Bovenbalk van de webmin (systeembeheerder).
const LINKS: { href: string; label: string }[] = [
  { href: "/dashboard", label: "Overzicht" },
  { href: "/ringen", label: "Ringen" },
  { href: "/instellingen", label: "Instellingen" },
  { href: "/profiel", label: "Profiel" },
];

export function TopBar({ user, subtitle }: { user: { name: string }; subtitle: string }) {
  return (
    <header className="glass sticky top-0 z-30 flex items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-4 py-3 sm:px-6">
      <div className="flex items-center gap-6">
        <a href="/dashboard" className="text-base font-semibold">
          Ringtools
        </a>
        <nav className="hidden items-center gap-4 sm:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="text-xs text-[var(--text-muted)]">{subtitle}</div>
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
