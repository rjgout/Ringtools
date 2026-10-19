import { RingSwitcher } from "./RingSwitcher";
import { logoutAction } from "@/lib/actions/auth.actions";
import { NotificationBell } from "./NotificationBell";

type NavFlags = {
  dashboard: boolean;
  roepingen: boolean;
  gebruikers: boolean;
  ringen: boolean;
  instellingen: boolean;
  profiel: boolean;
};

const LINKS: { key: keyof NavFlags; href: string; label: string }[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "roepingen", href: "/roepingen", label: "Roepingen" },
  { key: "gebruikers", href: "/gebruikers", label: "Gebruikers" },
  { key: "ringen", href: "/ringen", label: "Ringen" },
  { key: "instellingen", href: "/instellingen", label: "Instellingen" },
  { key: "profiel", href: "/profiel", label: "Profiel" },
];

export function TopBar({
  user,
  subtitle,
  rings,
  activeRingId,
  nav,
}: {
  user: { name: string };
  subtitle: string;
  rings: { id: string; name: string }[];
  activeRingId: string | null;
  nav: NavFlags;
}) {
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
        {rings.length > 1 && activeRingId && <RingSwitcher rings={rings} activeRingId={activeRingId} />}
        <NotificationBell />
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
