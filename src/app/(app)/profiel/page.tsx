import { requireUser } from "@/lib/session";
import { listActiveMemberships } from "@/lib/rings";
import { prisma } from "@/lib/prisma";
import { getPublicVapidKey } from "@/lib/push";
import { ROLE_LABELS } from "@/lib/format";
import { InstallPwaCard } from "@/components/InstallPwaCard";
import { PushNotificationCard } from "@/components/PushNotificationCard";
import { EmailPreferenceForm } from "./EmailPreferenceForm";
import { DeviceList } from "./DeviceList";

export default async function ProfielPage() {
  const user = await requireUser();
  const memberships = user.role === "ADMIN" ? [] : await listActiveMemberships(user.id);
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, userAgent: true, createdAt: true },
  });

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4">
      <div>
        <h1 className="text-xl font-semibold">Profiel</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {user.name}
          {user.role === "ADMIN" ? ` · ${ROLE_LABELS.ADMIN}` : ""}
        </p>
        {memberships.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-sm text-[var(--text-muted)]">
            {memberships.map((m) => (
              <li key={m.id}>
                {m.ring.name} · {ROLE_LABELS[m.role]}
                {m.churchFunction ? ` (${m.churchFunction})` : ""}
                {m.isRingManager ? " · ringbeheerder" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <a href="/profiel/beveiliging" className="glass-card flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Beveiliging</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {user.role === "ADMIN" ? "TOTP, herstelcodes en actieve sessies" : "Passkeys en actieve sessies"}
          </p>
        </div>
        <span aria-hidden>→</span>
      </a>

      <InstallPwaCard />
      <PushNotificationCard publicKey={getPublicVapidKey()} />

      <div className="glass-card space-y-3">
        <h2 className="font-semibold">Jouw apparaten</h2>
        <DeviceList subscriptions={subscriptions} />
      </div>

      <EmailPreferenceForm enabled={user.emailNotificationsEnabled} />
    </div>
  );
}
