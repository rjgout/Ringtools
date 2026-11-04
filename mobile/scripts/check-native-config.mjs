#!/usr/bin/env node
// Controleert de native configuratie zonder native tooling: identiteit, links, privacy en geheimen.
// Draait lokaal en in CI; faalt bij een inconsistentie.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const errors = [];
const ok = (cond, msg) => cond || errors.push(msg);

// 1. Capacitor-configuratie: gebundelde assets, geen externe-websitewrapper.
const cfg = read("capacitor.config.ts");
ok(!/server\s*:\s*\{[^}]*\burl\s*:/s.test(cfg), "capacitor.config.ts mag geen server.url bevatten (geen wrapper om een externe website).");
ok(/webDir:\s*"dist"/.test(cfg), 'capacitor.config.ts: webDir moet "dist" zijn (gebundelde assets).');
ok(/allowNavigation:\s*\[\s*\]/.test(cfg), "capacitor.config.ts: allowNavigation moet leeg zijn.");

// 2. Identiteit consistent tussen config, Android en iOS.
const idDefault = /process\.env\.RINGTOOLS_APP_ID \|\| "([^"]+)"/.exec(cfg)?.[1];
const gradle = read("android/app/build.gradle");
const appIdAndroid = /applicationId "([^"]+)"/.exec(gradle)?.[1];
const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
const appIdsIos = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
ok(idDefault && appIdAndroid === idDefault, `applicationId (${appIdAndroid}) ≠ appId in capacitor.config.ts (${idDefault}).`);
ok(appIdsIos.length === 2 && appIdsIos.every((i) => i === idDefault), `iOS bundle-ID's (${appIdsIos.join(", ")}) ≠ ${idDefault}.`);

// 3. Link-domein gelijk in Android, iOS en de client-standaard.
const manifest = read("android/app/src/main/AndroidManifest.xml");
const androidHosts = [...new Set([...manifest.matchAll(/android:host="([^"]+)"/g)].map((m) => m[1]))];
const iosHosts = [...read("ios/App/App/App.entitlements").matchAll(/applinks:([^<]+)</g)].map((m) => m[1]);
ok(androidHosts.length === 1, `Android App Links: precies één host verwacht, gevonden: ${androidHosts.join(", ")}.`);
ok(iosHosts.length === 1 && iosHosts[0] === androidHosts[0], `iOS-host (${iosHosts}) ≠ Android-host (${androidHosts}).`);
ok(/android:autoVerify="true"/.test(manifest), "AndroidManifest: autoVerify ontbreekt.");
ok(/android:pathPrefix="\/open\/"/.test(manifest) && /android:pathPrefix="\/roepingen\/"/.test(manifest), "AndroidManifest: paden /open/ en /roepingen/ ontbreken.");
ok(/android:allowBackup="false"/.test(manifest), "AndroidManifest: allowBackup moet false zijn.");
ok(/android:usesCleartextTraffic="false"/.test(manifest), "AndroidManifest: cleartext-verkeer moet uit.");
ok(/<key>aps-environment<\/key>/.test(read("ios/App/App/App.entitlements")), "iOS-entitlements: aps-environment ontbreekt.");
ok(/CODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/.test(pbx), "iOS-project: CODE_SIGN_ENTITLEMENTS ontbreekt.");
ok(/<key>ITSAppUsesNonExemptEncryption<\/key>/.test(read("ios/App/App/Info.plist")), "Info.plist: ITSAppUsesNonExemptEncryption ontbreekt.");

// 3b. Personal Team-testconfiguratie (iOS): zonder Push/Associated Domains, productie-entitlements onaangetast.
const cfgBlocks = [...pbx.matchAll(/\t\t[0-9A-F]{24} \/\* ([^*]+) \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;([\s\S]*?)\n\t\t\};/g)].map((m) => ({ name: m[1].trim(), body: m[2] }));
const targetBlocks = cfgBlocks.filter((b) => /INFOPLIST_FILE = App\/Info.plist/.test(b.body));
const byName = (n) => targetBlocks.find((b) => b.name === n);
ok(byName("Debug") && byName("Release") && byName("Debug-PersonalTeam"), "iOS-project: configuraties Debug, Release en Debug-PersonalTeam ontbreken.");
for (const n of ["Debug", "Release"]) ok(byName(n) && /CODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/.test(byName(n).body), `iOS-configuratie ${n} moet de productie-entitlements (App/App.entitlements) behouden.`);
ok(byName("Debug-PersonalTeam") && !/CODE_SIGN_ENTITLEMENTS/.test(byName("Debug-PersonalTeam").body), "Debug-PersonalTeam mag in het project geen CODE_SIGN_ENTITLEMENTS zetten (het xcconfig maakt het leeg).");
ok(/XCConfigurationList[\s\S]*Debug-PersonalTeam/.test(pbx) && (pbx.match(/\/\* Debug-PersonalTeam \*\/,/g) || []).length === 2, "Debug-PersonalTeam moet in de configuratielijsten van project én target staan.");
const personalXc = read("ios/PersonalTeam.xcconfig");
ok(/^CODE_SIGN_ENTITLEMENTS =\s*$/m.test(personalXc), "PersonalTeam.xcconfig: CODE_SIGN_ENTITLEMENTS moet leeg zijn.");
ok(/^RINGTOOLS_BUILD_PROFILE = personal-team$/m.test(personalXc), "PersonalTeam.xcconfig: RINGTOOLS_BUILD_PROFILE = personal-team ontbreekt.");
const personalId = /^PRODUCT_BUNDLE_IDENTIFIER = (\S+)$/m.exec(personalXc)?.[1];
ok(personalId && personalId !== idDefault, "PersonalTeam.xcconfig: gebruik een afwijkende bundle-ID zodat de productie-ID niet door een Personal Team wordt geclaimd.");
ok(!/^(aps-environment|applinks)/m.test(personalXc), "PersonalTeam.xcconfig mag geen push/associated-domains-configuratie bevatten.");
const scheme = read("ios/App/App.xcodeproj/xcshareddata/xcschemes/App-PersonalTeam.xcscheme");
ok(/<LaunchAction\s+buildConfiguration = "Debug-PersonalTeam"/.test(scheme) && /<ArchiveAction\s+buildConfiguration = "Release"/.test(scheme), "Scheme App-PersonalTeam: Run moet Debug-PersonalTeam en Archive moet Release gebruiken.");
ok(/Local\.xcconfig/.test(read(".gitignore")), "mobile/.gitignore moet ios/Local.xcconfig negeren.");
ok(/profile:"standard"/.test(read("public/ringtools-build.js")), "public/ringtools-build.js moet het standaardprofiel zetten.");
ok(/script src="\.\/ringtools-build\.js"/.test(read("index.html")), "index.html moet ringtools-build.js laden.");

// 4. Content-Security-Policy aanwezig, geen inline scripts toegestaan.
const html = read("index.html");
ok(/Content-Security-Policy/.test(html) && /script-src 'self'/.test(html), "index.html: strikte CSP met script-src 'self' ontbreekt.");

// 5. Geen geheimen of ondertekeningsbestanden in de werkmap (los van .gitignore).
const forbidden = /\.(jks|keystore|p8|p12|mobileprovision|pem|key)$|^google-services\.json$|^GoogleService-Info\.plist$|^keystore\.properties$/;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", "Pods", "build", ".gradle"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (forbidden.test(name)) errors.push(`Geheim/ondertekeningsbestand in de projectmap: ${relative(root, p)} (niet committen).`);
  }
})(root);

// 6. Assets aanwezig.
ok(existsSync(join(root, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png")), "Android-app-icoon ontbreekt (npm run assets).");
ok(existsSync(join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset")), "iOS-app-icoon ontbreekt (npm run assets).");

if (errors.length) {
  console.error("Native configuratie: FOUT\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log(`Native configuratie OK (appId ${idDefault}, link-host ${androidHosts[0]}).`);
