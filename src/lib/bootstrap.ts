import { prisma } from "./prisma";
import { hashPassword } from "./auth";
import { env } from "./env";

/**
 * Zorgt dat het admin-account (webmin) bestaat. Dit gebeurt uitsluitend bij
 * het allereerste opstarten: zodra het account eenmaal bestaat, wordt het
 * wachtwoord NOOIT meer overschreven door BOOTSTRAP_ADMIN_PASSWORD, ook niet
 * na een herstart van de container. Zo overschrijft een later door de
 * administrator gewijzigd wachtwoord zichzelf niet opnieuw.
 */
export async function ensureAdminAccount(): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (existing) return;

  const password = env.bootstrapAdminPassword;
  if (!password) {
    console.error(
      '[bootstrap] Er bestaat nog geen admin-account en BOOTSTRAP_ADMIN_PASSWORD is niet gezet. ' +
        "Zet BOOTSTRAP_ADMIN_USERNAME en BOOTSTRAP_ADMIN_PASSWORD in de environment variables en herstart de applicatie."
    );
    return;
  }

  const username = env.bootstrapAdminUsername;
  const passwordHash = await hashPassword(password);

  await prisma.user.create({
    data: {
      name: username,
      email: `${username}@admin.local`,
      role: "ADMIN",
      active: true,
      passwordHash,
    },
  });

  console.log(`[bootstrap] Admin-account "${username}" aangemaakt.`);
}

export async function ensureSmtpSettingsRow(): Promise<void> {
  await prisma.smtpSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}
