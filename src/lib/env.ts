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
  get vapid() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) return null;
    return { publicKey, privateKey, subject };
  },
};
