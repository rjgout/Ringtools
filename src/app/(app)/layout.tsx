import { requireUser } from "@/lib/session";
import { canManageUsers, canManageSettings, canManageWorkflow } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const nav = {
    dashboard: true,
    roepingen: canManageWorkflow(user.role),
    gebruikers: canManageUsers(user.role),
    instellingen: canManageSettings(user.role),
  };

  return (
    <div className="min-h-dvh pb-24 sm:pb-6">
      <TopBar user={{ name: user.name, role: user.role }} nav={nav} />
      <main className="mx-auto max-w-5xl px-4 pt-4 sm:px-6">{children}</main>
      <BottomNav nav={nav} />
    </div>
  );
}
