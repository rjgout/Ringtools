function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Ontbrekende verplichte environment variable "${name}". Zet deze in je .env (lokaal) of in de Portainer-stack.`
    );
  }
  return value;
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
  get cookieSecure() {
    return (process.env.COOKIE_SECURE ?? "true") === "true";
  },
  get timezone() {
    return "Europe/Amsterdam";
  },
  /** Firebase Cloud Messaging (Android-app): service-account-JSON (ruw of base64) uit FCM_SERVICE_ACCOUNT_JSON. */
  get fcm() {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    try {
      const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
      const sa = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string };
      if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
      return { projectId: sa.project_id, serviceAccount: { client_email: sa.client_email, private_key: sa.private_key } };
    } catch {
      return null;
    }
  },
  /** Apple Push Notification service (iOS-app): .p8-sleutel (ruw of base64) plus sleutel-ID, team-ID en bundle-ID. */
  get apns() {
    const key = process.env.APNS_KEY_P8;
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
