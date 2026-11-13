#!/usr/bin/env node
// Past de native projecten (alleen in de werkmap, bv. op een CI-runner) aan voor een variant van de app, zoals "dev"
// (Ringtools Dev, eigen bundle-ID/application-ID, eigen Universal Links/App Links-host). De productiebestanden in Git blijven ongewijzigd:
// dit script draait nooit lokaal tegen de productieconfiguratie en wordt alleen in de dev-workflows aangeroepen.
//
// Gebruik:  node scripts/configure-variant.mjs dev            # past de bestanden aan
//           node scripts/configure-variant.mjs dev --print-env  # schrijft RINGTOOLS_APP_ID/-NAME/-HOST en VITE_API_URL (voor $GITHUB_ENV)
// Test: RINGTOOLS_NATIVE_ROOT wijst naar een kopie van de mobile-map.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.env.RINGTOOLS_NATIVE_ROOT || here;
const PROD_ID = "nl.ringapeldoorn.ringtools";
const PROD_NAME = "Ringtools";
const PROD_HOST = "ringapeldoorn.nl";

const name = process.argv[2];
if (!name || !/^[a-z]+$/.test(name)) {
  console.error("Gebruik: configure-variant.mjs <variant> [--print-env]");
  process.exit(1);
}
const variant = JSON.parse(readFileSync(join(here, "variants", `${name}.json`), "utf8"));
const { appId, appName, host, apiUrl } = variant;
if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(appId) || appId === PROD_ID) fail(`Ongeldig of productie-appId: ${appId}`);
if (!appId.startsWith(`${PROD_ID}.`)) fail(`De variant-appId moet beginnen met ${PROD_ID}. (zelfde team/prefix, naast de productieapp installeerbaar).`);
if (!/^[A-Za-z0-9 ]{1,30}$/.test(appName) || appName === PROD_NAME) fail(`Ongeldige of productienaam: ${appName}`);
if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(host) || host === PROD_HOST) fail(`Ongeldige of productiehost: ${host}`);
if (apiUrl !== `https://${host}`) fail(`apiUrl (${apiUrl}) moet https://${host} zijn: een variant praat uitsluitend met zijn eigen backend.`);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (process.argv.includes("--print-env")) {
  console.log(`RINGTOOLS_APP_ID=${appId}\nRINGTOOLS_APP_NAME=${appName}\nRINGTOOLS_APP_HOST=${host}\nVITE_API_URL=${apiUrl}\nVITE_APP_VARIANT=${name}`);
  process.exit(0);
}

function edit(rel, must, fn) {
  const p = join(root, rel);
  const before = readFileSync(p, "utf8");
  const after = fn(before);
  if (!after.includes(must)) fail(`${rel}: verwachte waarde (${must}) niet gevonden na aanpassen; het native project wijkt af van wat dit script verwacht.`);
  if (after !== before) writeFileSync(p, after);
  console.log(`${after === before ? "ongewijzigd" : "bijgewerkt  "} ${rel}`);
}

// iOS: bundle-ID (Debug en Release), weergavenaam, Universal Links en webcredentials.
edit("ios/App/App.xcodeproj/project.pbxproj", `PRODUCT_BUNDLE_IDENTIFIER = ${appId};`, (s) => s.replace(new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${PROD_ID.replace(/\./g, "\\.")};`, "g"), `PRODUCT_BUNDLE_IDENTIFIER = ${appId};`));
edit("ios/App/App/Info.plist", `<string>${appName}</string>`, (s) => s.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${appName}$2`));
edit("ios/App/App/App.entitlements", `applinks:${host}`, (s) => s.replace(/applinks:[^<]*/g, `applinks:${host}`).replace(/webcredentials:[^<]*/g, `webcredentials:${host}`));

// Android: application-ID (de namespace/R-klasse blijft gelijk, alleen het installeerbare ID verandert), naam, links.
edit("android/app/build.gradle", `applicationId "${appId}"`, (s) => s.replace(new RegExp(`applicationId "${PROD_ID.replace(/\./g, "\\.")}"`), `applicationId "${appId}"`));
edit("android/app/src/main/res/values/strings.xml", `>${appName}<`, (s) =>
  s
    .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${appName}$2`)
    .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${appName}$2`)
    .replace(/(<string name="package_name">)[^<]*(<\/string>)/, `$1${appId}$2`)
    .replace(/(<string name="custom_url_scheme">)[^<]*(<\/string>)/, `$1${appId}$2`));
edit("android/app/src/main/AndroidManifest.xml", `android:host="${host}"`, (s) => s.replace(/android:host="[^"]*"/g, `android:host="${host}"`));
// Handmatige distributiesigning (alleen in de werkkopie, nooit in Git): Release gebruikt een vast Apple Distribution-profiel dat door
// scripts/ios_distribution.py wordt geïmporteerd (RINGTOOLS_DISTRIBUTION_PROFILE_UUID komt van de opdrachtregel), met productie-APNs.
// Zo hoeft Xcode nooit nieuwe certificaten of profielen aan te maken. De productieconfiguratie in Git blijft automatisch/onaangeroerd.
if (process.argv.includes("--manual-signing")) {
  const APP_RELEASE = "504EC3181FED79650016851F";
  const PROJECT_RELEASE = "504EC3151FED79650016851F";
  const block = (s, id, fn) => {
    const re = new RegExp(`(\\t\\t${id} /\\* Release \\*/ = \\{[\\s\\S]*?\\n\\t\\t\\};)`);
    if (!re.test(s)) fail(`project.pbxproj: configuratieblok ${id} (Release) niet gevonden; het Xcode-project wijkt af van wat dit script verwacht.`);
    return s.replace(re, (m) => fn(m));
  };
  edit("ios/App/App.xcodeproj/project.pbxproj", `PROVISIONING_PROFILE_SPECIFIER = "$(RINGTOOLS_DISTRIBUTION_PROFILE_UUID)";`, (s) => {
    s = block(s, APP_RELEASE, (m) => {
      if (m.includes("RINGTOOLS_DISTRIBUTION_PROFILE_UUID")) return m;
      if (!m.includes("CODE_SIGN_STYLE = Automatic;")) fail("App-Release: CODE_SIGN_STYLE = Automatic verwacht.");
      return m.replace("CODE_SIGN_STYLE = Automatic;", `CODE_SIGN_STYLE = Manual;\n\t\t\t\tCODE_SIGN_IDENTITY = "Apple Distribution";\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "$(RINGTOOLS_DISTRIBUTION_PROFILE_UUID)";`);
    });
    return block(s, PROJECT_RELEASE, (m) => m.replace('CODE_SIGN_IDENTITY = "iPhone Developer";', 'CODE_SIGN_IDENTITY = "Apple Distribution";'));
  });
  edit("ios/App/App/App.entitlements", `<string>production</string>`, (s) => s.replace(/(<key>aps-environment<\/key>\s*<string>)[^<]*(<\/string>)/, "$1production$2"));
  console.log("Handmatige distributiesigning ingesteld (alleen werkkopie).");
}
console.log(`Variant "${name}" toegepast: ${appName} (${appId}), links ${host}, backend ${apiUrl}.`);
