export async function register() {
  // Alleen in de echte Node.js-serverruntime uitvoeren (niet in de Edge-runtime).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureAdminAccount, ensureSmtpSettingsRow, warnWeakEncryptionKey, warnApnsEnvironment } = await import("./lib/bootstrap");
  const { startBackgroundJobs } = await import("./lib/cron");

  warnWeakEncryptionKey();
  warnApnsEnvironment();
  await ensureAdminAccount();
  await ensureSmtpSettingsRow();
  startBackgroundJobs();
}
