import { prisma } from "./prisma";
import { hashPassword } from "./auth";
import { env } from "./env";

const PLACEHOLDER = /^verander-dit-in/i;

/** Waarom een opgegeven geheim te zwak is (of null als het acceptabel lijkt). */
export function weakSecretReason(value: string, minLength: number): string | null {
  if (PLACEHOLDER.test(value)) return "het is de voorbeeldwaarde uit .env.example";
  if (value.length < minLength) return `korter dan ${minLength} tekens`;
  return null;
}

/** Waarschuwt (zonder te stoppen) bij een zwakke SETTINGS_ENCRYPTION_KEY; wijzigen zou bestaande versleutelde gegevens onleesbaar maken. */
export function warnWeakEncryptionKey(): void {
  const key = env.settingsEncryptionKey;
  const hex64 = /^[0-9a-fA-F]{64}$/.test(key);
  const reason = hex64 ? null : weakSecretReason(key, 32);
  if (reason) {
    console.warn(`[bootstrap] WAARSCHUWING: SETTINGS_ENCRYPTION_KEY is zwak (${reason}). Gebruik een willekeurige sleutel van 64 hexadecimale tekens (openssl rand -hex 32).`);
  }
}

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

  const weak = weakSecretReason(password, 10);
  if (weak) {
    console.error(`[bootstrap] BOOTSTRAP_ADMIN_PASSWORD is niet toegestaan (${weak}). Kies een uniek wachtwoord van minstens 10 tekens en herstart; het admin-account is nog niet aangemaakt.`);
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
