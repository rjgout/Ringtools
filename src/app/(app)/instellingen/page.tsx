import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SmtpForm, TestMailForm, ChangePasswordForm } from "./SettingsForms";

export default async function InstellingenPage() {
  const admin = await requireRole(["ADMIN"]);
  const settings = await prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } });

  return (
    <div className="space-y-5 py-4">
      <h1 className="text-xl font-semibold">Instellingen</h1>

      <SmtpForm
        current={{
          host: settings.host || "",
          port: settings.port,
          security: settings.security,
          username: settings.username || "",
          fromAddress: settings.fromAddress,
          fromName: settings.fromName,
        }}
      />

      <TestMailForm adminEmail={admin.email} />
      <ChangePasswordForm />
    </div>
  );
}
