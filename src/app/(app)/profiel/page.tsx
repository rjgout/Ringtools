import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getPublicVapidKey } from "@/lib/push";
import { ROLE_LABELS } from "@/lib/format";
import { InstallPwaCard } from "@/components/InstallPwaCard";
import { PushNotificationCard } from "@/components/PushNotificationCard";
import { EmailPreferenceForm } from "./EmailPreferenceForm";
import { DeviceList } from "./DeviceList";

export default async function ProfielPage() {
  const user = await requireUser();
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
          {user.name} · {ROLE_LABELS[user.role]}
        </p>
      </div>

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
