import { readFileSync } from "fs";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Ontbrekende verplichte environment variable "${name}". Zet deze in je .env (lokaal) of in de Portainer-stack.`
    );
  }
  return value;
}

/** Leest een geheim uit een bestand (bijv. Docker secret / gemounte file), zodat de sleutel niet in een env-var of in GitHub hoeft. */
function readSecretFile(variable: string): string | null {
  const path = process.env[variable];
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`[env] ${variable} verwijst naar een bestand dat niet gelezen kan worden.`);
    return null;
  }
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get bootstrapAdminUsername() {
    return process.env.BOOTSTRAP_ADMIN_USERNAME || "webmin";
  },
  get bootstrapAdminPassword() {
    return process.env.BOOTSTRAP_ADMIN_PASSWORD || null;
  },
  get settingsEncryptionKey() {
    return required("SETTINGS_ENCRYPTION_KEY");
  },
  get appBaseUrl() {
    return (process.env.APP_BASE_URL || "http://localhost:2809").replace(/\/+$/, "");
  },
  /** Optioneel supportadres voor de publieke pagina's (bijv. beheer@…). Wordt niet verzonnen: zonder instelling verwijst de site naar de ringbeheerder. */
  get contactEmail(): string | null {
    const v = (process.env.PUBLIC_CONTACT_EMAIL || "").trim();
    return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v) ? v : null;
  },
  /**
   * Native passkeys in de app (C5.2). Standaard UIT: pas aanzetten na verificatie op fysieke toestellen met
   * geverifieerde Associated Domains (iOS, `webcredentials:`) en Digital Asset Links (Android, `get_login_creds`).
   * Uit = een account met passkey-verificatie kan niet via de app inloggen (veilige melding, geen omzeiling).
   */
  get nativePasskeysEnabled() {
    return process.env.NATIVE_PASSKEYS_ENABLED === "true";
  },
  /**
   * E2.1: authenticator-app (TOTP) als tweede factor voor gewone webgebruikers. Standaard UIT: zonder deze vlag is er geen enkel
   * gedrag veranderd (gewone gebruikers kennen alleen passkeys; TOTP blijft beperkt tot het beheerdersaccount).
   */
  get webTotpEnabled() {
    return process.env.WEB_TOTP_ENABLED === "true";
  },
  /** SHA-256-vingerafdrukken van het app-ondertekeningscertificaat (hex, met dubbele punten), ook gebruikt voor de Digital Asset Links. */
  get androidCertFingerprints() {
    return (process.env.ANDROID_SHA256_FINGERPRINTS || "")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  },
  get cookieSecure() {
    return (process.env.COOKIE_SECURE ?? "true") === "true";
  },
  get timezone() {
    return "Europe/Amsterdam";
  },
  /** Firebase Cloud Messaging (Android-app): service-account-JSON (ruw of base64) uit FCM_SERVICE_ACCOUNT_JSON. */
  get fcm() {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON || readSecretFile("FCM_SERVICE_ACCOUNT_FILE");
    if (!raw) return null;
    try {
      const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
      const sa = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string; private_key_id?: string };
      if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
      return { projectId: sa.project_id, serviceAccount: { client_email: sa.client_email, private_key: sa.private_key, private_key_id: sa.private_key_id } };
    } catch {
      return null;
    }
  },
  /** Apple Push Notification service (iOS-app): .p8-sleutel (ruw of base64) plus sleutel-ID, team-ID en bundle-ID. */
  get apns() {
    const key = process.env.APNS_KEY_P8 || readSecretFile("APNS_KEY_P8_FILE");
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const bundleId = process.env.APNS_BUNDLE_ID;
    if (!key || !keyId || !teamId || !bundleId) return null;
    const keyP8 = key.includes("BEGIN PRIVATE KEY") ? key : Buffer.from(key, "base64").toString("utf8");
    return { keyP8, keyId, teamId, bundleId, production: (process.env.APNS_PRODUCTION ?? "true") === "true" };
  },
  get vapid() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) return null;
    return { publicKey, privateKey, subject };
  },
};
