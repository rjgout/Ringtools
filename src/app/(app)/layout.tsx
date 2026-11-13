import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { SessionKeepAlive } from "@/components/SessionKeepAlive";
import { webAppTargetFor } from "@/lib/webAppRedirect";

/**
 * Beveiligde website voor de systeembeheerder (webmin): overzicht, ringbeheer, instellingen en profiel.
 * Gewone gebruikers werken in de gedeelde interface onder /app (dezelfde React-client als de iOS-app); de vroegere adressen van hun
 * webpagina's blijven bestaan en verwijzen daarheen door (zie `src/lib/webAppRedirect.ts`).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const target = webAppTargetFor((await headers()).get("x-ringtools-path"), { isAdmin: user.role === "ADMIN" });
  if (target) redirect(target);

  return (
    <div className="min-h-dvh app-content-padding">
      <TopBar user={{ name: user.name }} subtitle="Systeembeheerder" />
      <main className="mx-auto max-w-5xl px-4 pt-4 sm:px-6">{children}</main>
      <BottomNav />
      <SessionKeepAlive />
    </div>
  );
}
