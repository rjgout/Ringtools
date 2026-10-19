import { requireUser } from "@/lib/session";
import { getRingContext } from "@/lib/ringContext";
import { canManageRingUsers, canManageSettings, canManageWorkflow } from "@/lib/rbac";
import { ROLE_LABELS } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { AppBadgeUpdater } from "@/components/AppBadgeUpdater";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const ctx = await getRingContext();
  const isAdmin = user.role === "ADMIN";

  const nav = {
    dashboard: true,
    roepingen: !!ctx && canManageWorkflow(ctx.membership.role),
    gebruikers: !!ctx && canManageRingUsers(user.role, ctx.membership),
    ringen: isAdmin,
    instellingen: canManageSettings(user.role),
    profiel: true,
  };

  const subtitle = isAdmin
    ? "Systeembeheerder"
    : ctx
      ? `${ctx.ring.name} · ${ROLE_LABELS[ctx.membership.role]}`
      : "Geen actieve ring";

  return (
    <div className="min-h-dvh app-content-padding">
      <TopBar
        user={{ name: user.name }}
        subtitle={subtitle}
        rings={ctx ? ctx.memberships.map((m) => ({ id: m.ringId, name: m.ring.name })) : []}
        activeRingId={ctx?.ring.id ?? null}
        nav={nav}
      />
      <main className="mx-auto max-w-5xl px-4 pt-4 sm:px-6">{children}</main>
      <BottomNav nav={nav} />
      <AppBadgeUpdater />
    </div>
  );
}
