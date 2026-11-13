#!/usr/bin/env node
// Zet het domein voor Universal Links / Android App Links in de native projecten.
// Gebruik: RINGTOOLS_APP_HOST=ringapeldoorn.nl node scripts/configure-native.mjs
// (Standaard: ringapeldoorn.nl.) Idempotent; de waarde moet gelijk zijn aan de host van APP_BASE_URL op de server.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = (process.env.RINGTOOLS_APP_HOST || "ringapeldoorn.nl").toLowerCase();
if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes(".")) {
  console.error(`Ongeldige host: ${host}`);
  process.exit(1);
}

function edit(rel, fn) {
  const p = join(root, rel);
  const before = readFileSync(p, "utf8");
  const after = fn(before);
  if (after !== before) writeFileSync(p, after);
  console.log(`${after === before ? "ongewijzigd" : "bijgewerkt  "} ${rel}`);
}

edit("android/app/src/main/AndroidManifest.xml", (s) => s.replace(/android:host="[^"]*"/g, `android:host="${host}"`));
for (const file of ["App.entitlements", "App-Store.entitlements"]) {
  edit(`ios/App/App/${file}`, (s) => s.replace(/applinks:[^<]*/g, `applinks:${host}`).replace(/webcredentials:[^<]*/g, `webcredentials:${host}`));
}
