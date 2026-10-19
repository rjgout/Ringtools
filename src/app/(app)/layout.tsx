import { requireUser } from "@/lib/session";
import { canManageUsers, canManageSettings, canManageWorkflow } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { AppBadgeUpdater } from "@/components/AppBadgeUpdater";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const nav = {
    dashboard: true,
    roepingen: canManageWorkflow(user.role),
    gebruikers: canManageUsers(user.role),
    instellingen: canManageSettings(user.role),
    profiel: true,
  };

  return (
    <div className="min-h-dvh app-content-padding">
      <TopBar user={{ name: user.name, role: user.role }} nav={nav} />
      <main className="mx-auto max-w-5xl px-4 pt-4 sm:px-6">{children}</main>
      <BottomNav nav={nav} />
      <AppBadgeUpdater />
    </div>
  );
}
